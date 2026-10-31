"""SpendWise API. Run:  uvicorn main:app --reload --port 8000

This server is STATELESS. It has no database and no accounts: it reads a statement PDF and does the sums, and every
request carries the data it needs (the browser keeps each person's transactions, budgets, notes and owed money in
that person's own browser storage). Nothing a request contains is written to disk, logged, or shared between people.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
from datetime import date
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core import analytics, banks, categorizer, ingest, parser
from core.report import build_report

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_BODY_BYTES = 30 * 1024 * 1024
MAX_ROWS = 200_000
PAGE_FIT_TOLERANCE = 0.015

app = FastAPI(title="SpendWise", docs_url=None, redoc_url=None, openapi_url=None)
# Where the website is served from. Set SPENDWISE_ORIGINS="https://your-site.pages.dev,https://your.domain" in production.
_origins = [o.strip() for o in os.getenv("SPENDWISE_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST"], allow_headers=["*"])


@app.middleware("http")
async def limits_and_headers(request: Request, call_next):
    size = request.headers.get("content-length")
    if size and size.isdigit() and int(size) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "That request is too large."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else response.headers.get("Cache-Control", "")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _d(s: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        raise HTTPException(400, f"Invalid date '{s}', use YYYY-MM-DD")


def _scope(account: Optional[str]) -> Optional[str]:
    """The account filter as stored: None means every account, "" the rows with no bank set ("none" in requests)."""
    return "" if account == "none" else account or None


# ------------------------------------------------------------- the data a request carries ---
class Tx(BaseModel):
    """One saved transaction, exactly as the browser holds it."""
    id: int = 0
    date: str
    description: str = ""
    merchant: str = ""
    amount: float
    kind: Literal["debit", "credit"]
    category: str = "Other"
    balance: Optional[float] = None
    account: str = ""
    seq: int = 0


class Budgets(BaseModel):
    overall: Optional[float] = None
    savings_goal: Optional[float] = None
    categories: Dict[str, float] = {}


class Note(BaseModel):
    title: str = ""
    body: str = ""
    created_at: str = ""


class Scope(BaseModel):
    rows: List[Tx] = Field(default=[], max_length=MAX_ROWS)  # in statement order, as the browser keeps them
    start: Optional[str] = None
    end: Optional[str] = None
    account: Optional[str] = None


class SummaryIn(Scope):
    budgets: Budgets = Budgets()


class PassbookIn(Scope):
    category: Optional[str] = None
    q: Optional[str] = None
    sort: str = "statement"
    kind: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None


class ReportIn(SummaryIn):
    notes: List[Note] = []


def _several_accounts(rows: List[Tx]) -> bool:
    return len({r.account for r in rows}) > 1


def _analytics_rows(body: Scope) -> list[dict]:
    """Rows for the sums. Running balances only chain within one account, so with several accounts mixed together the
    balances are left out rather than shown wrong."""
    scoped = _scope(body.account)
    rows = [r.model_dump() for r in body.rows if scoped is None or r.account == scoped]
    out = [{**r, "date": _d(r["date"])} for r in rows]
    if scoped is None and _several_accounts(body.rows):
        out = [{**r, "balance": None} for r in out]
    return out


def _clean_budgets(b: Budgets) -> dict:
    return {"overall": b.overall, "savings_goal": b.savings_goal, "categories": dict(b.categories)}


def _summary(body: SummaryIn) -> dict:
    s = analytics.summarize(_analytics_rows(body), _d(body.start), _d(body.end))
    if not s.get("empty"):
        s["budget_status"] = analytics.budget_status(s, _clean_budgets(body.budgets))
    return s


def _decorate(r: dict) -> dict:
    """A transaction plus the bits a passbook row needs."""
    credit = r["kind"] == "credit"
    return {
        **r,
        "remark": categorizer.remark(r["description"]),
        "deposit": r["amount"] if credit else None,
        "withdrawal": None if credit else r["amount"],
        "reversed": r["category"] == "Reversed",
    }


# ------------------------------------------------------------------ reading a statement ---
@app.post("/api/parse")
async def parse(file: UploadFile = File(...), password: Optional[str] = Form(None), bank: Optional[str] = Form(None),
                account_type: Optional[str] = Form(None), overrides: Optional[str] = Form(None),
                saved_merchants: Optional[str] = Form(None)):
    """Read a statement PDF and return its transactions. The PDF is read from a temporary file that is deleted at once;
    nothing is stored. `overrides` ({payee: category}) and `saved_merchants` ([payee, ...]) are what the browser already
    knows, so new rows follow your earlier choices and payee spellings fold into the ones you have saved."""
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Please upload a PDF bank statement.")
    try:
        ov = json.loads(overrides) if overrides else {}
        saved = json.loads(saved_merchants) if saved_merchants else []
        assert isinstance(ov, dict) and isinstance(saved, list)
    except (ValueError, AssertionError):
        raise HTTPException(400, "Could not read the remembered choices sent with the statement.")
    size = 0
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        path = tmp.name
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                tmp.close()
                os.unlink(path)
                raise HTTPException(413, "That PDF is larger than 20 MB. Download a shorter date range from your bank.")
            tmp.write(chunk)
    try:
        if bank and bank != "auto" and bank not in banks.BY_ID:
            raise HTTPException(400, "Unknown bank.")
        if account_type and account_type not in {t["id"] for t in banks.ACCOUNT_TYPES}:
            raise HTTPException(400, "Unknown account type.")
        try:
            rows, meta = parser.parse_statement_ex(path, password or None, bank)
        except parser.StatementError as exc:
            raise HTTPException(422, str(exc))
    finally:
        os.unlink(path)
    bank_id = meta.get("bank") or "other"
    kind = account_type or "savings"
    prepared = ingest.prepare(rows, bank_id, kind, ov, [str(m) for m in saved])
    mismatches = meta.get("balance_mismatches", 0)
    detected = meta.get("bank_detected")
    return {
        **prepared,
        "account": banks.account_id(bank_id, kind), "account_label": banks.account_label(banks.account_id(bank_id, kind)),
        "bank": bank_id, "bank_detected": detected, "account_type": kind, "order": meta.get("order"),
        # You chose one bank but the statement says it is another: worth a second look.
        "bank_warning": (f"You chose {banks.BY_ID[bank]['name']}, but this statement looks like {banks.BY_ID[detected]['name']}."
                         if bank and bank not in ("auto", "other") and detected and detected != bank and detected != "other" else None),
        "parsed": len(rows),
        "from": min(r["date"] for r in rows).isoformat(),
        "to": max(r["date"] for r in rows).isoformat(),
        "reversals": sum(1 for r in rows if r.get("is_reversal")),
        "opening_balance": meta.get("opening_balance"),
        "closing_balance": meta.get("closing_balance"),
        "layout": meta.get("layout"),
        # True when every row's running balance follows from the one before it: a strong sign nothing was misread.
        "balance_check_passed": mismatches == 0,
        "balance_mismatches": mismatches,
    }


@app.get("/api/banks")
def bank_list():
    """Banks and account types you can pick, with what is known about how each lays out its statements."""
    return banks.public_list()


@app.get("/api/categories")
def categories():
    return categorizer.CATEGORIES


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------- passbook ---
SORTS = {
    "statement": None,
    "date_desc": lambda r: r["date"],
    "date_asc": lambda r: r["date"],
    "payee_asc": lambda r: r["merchant"].lower(),
    "payee_desc": lambda r: r["merchant"].lower(),
    "amount_desc": lambda r: r["amount"],
    "amount_asc": lambda r: r["amount"],
    "category": lambda r: (r["category"], -r["amount"]),
}
REVERSE = {"date_desc", "payee_desc", "amount_desc"}


@app.post("/api/passbook")
def passbook(body: PassbookIn):
    """The period laid out like a passbook: opening and closing balance, money in and out, entries in statement order
    (or sorted and filtered the way you ask)."""
    _d(body.start), _d(body.end)
    if body.sort not in SORTS:
        raise HTTPException(400, f"sort must be one of: {', '.join(SORTS)}")
    if body.kind not in (None, "", "in", "out"):
        raise HTTPException(400, "kind must be 'in' or 'out'")
    scoped = _scope(body.account)
    period = [r.model_dump() for r in body.rows
              if (scoped is None or r.account == scoped) and (not body.start or r.date >= body.start) and (not body.end or r.date <= body.end)]
    if not period:
        return {"empty": True, "entries": []}
    first, last = period[0], period[-1]
    signed = lambda r: r["amount"] if r["kind"] == "credit" else -r["amount"]
    mixed = scoped is None and _several_accounts(body.rows)  # balances of different accounts do not chain
    has_balances = all(r["balance"] is not None for r in period) and not mixed
    opening = round(first["balance"] - signed(first), 2) if has_balances else None

    bad, prev = 0, opening
    for r in period:
        if has_balances and prev is not None and abs(prev + signed(r) - r["balance"]) > PAGE_FIT_TOLERANCE:
            bad += 1
        if r["balance"] is not None:
            prev = r["balance"]

    entries = period
    if body.category:
        entries = [r for r in entries if r["category"] == body.category]
    if body.q:
        needle = body.q.lower()
        entries = [r for r in entries if needle in r["description"].lower() or needle in r["merchant"].lower()]
    if body.kind:
        entries = [r for r in entries if r["kind"] == ("credit" if body.kind == "in" else "debit")]
    if body.min_amount is not None:
        entries = [r for r in entries if r["amount"] >= body.min_amount]
    if body.max_amount is not None:
        entries = [r for r in entries if r["amount"] <= body.max_amount]
    if SORTS[body.sort]:
        entries = sorted(entries, key=SORTS[body.sort], reverse=body.sort in REVERSE)  # stable: ties keep statement order
    labels = sorted({banks.account_label(r["account"]) for r in period})
    return {
        "empty": False,
        "start": min(r["date"] for r in period), "end": max(r["date"] for r in period),
        "opening_balance": opening,
        "closing_balance": last["balance"] if has_balances else None,
        "total_in": round(sum(r["amount"] for r in period if r["kind"] == "credit"), 2),
        "total_out": round(sum(r["amount"] for r in period if r["kind"] == "debit"), 2),
        "entry_count": len(period),
        "reversed_pairs": sum(1 for r in period if r["category"] == "Reversed" and r["kind"] == "credit"),
        "balance_check_passed": (bad == 0) if has_balances else None,
        "balance_mismatches": bad if has_balances else None,
        "balances_mixed": mixed,
        "accounts": labels,
        "filtered": bool(body.category or body.q or body.kind or body.min_amount is not None or body.max_amount is not None),
        "sorted": body.sort != "statement",
        "sort": body.sort,
        "shown_in": round(sum(r["amount"] for r in entries if r["kind"] == "credit" and r["category"] != "Reversed"), 2),
        "shown_out": round(sum(r["amount"] for r in entries if r["kind"] == "debit" and r["category"] != "Reversed"), 2),
        "entries": [_decorate(r) for r in entries[:5000]],
    }


# --------------------------------------------------------------- analysis ---
@app.post("/api/summary")
def summary(body: SummaryIn):
    return _summary(body)


class AverageIn(Scope):
    start: str
    end: str


@app.post("/api/average-daily")
def average_daily(body: AverageIn):
    s, e = _d(body.start), _d(body.end)
    if s > e:
        raise HTTPException(400, "The start date must not be after the end date.")
    return analytics.average_daily(_analytics_rows(body), s, e)


@app.post("/api/report")
def report(body: ReportIn):
    s = _summary(body)
    notes = [n.model_dump() for n in body.notes] or None
    pdf = build_report(s, notes)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="spending-report.pdf"'})


# After `npm run build`, the API also serves the built app, so one process is enough.
_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
