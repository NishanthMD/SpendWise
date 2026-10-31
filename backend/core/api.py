"""The whole SpendWise "server", as plain functions on plain dicts.

The same code runs in two places: in the browser (Pyodide, inside a Web Worker: the default, so a public site needs no
server at all) and behind FastAPI (main.py, for local development or an optional hosted reader). It keeps nothing: every
call gets the data it needs and returns an answer.
"""
from __future__ import annotations

import json
import math
from datetime import date
from typing import Optional

from . import analytics, banks, categorizer, ingest, parser
from .report import build_report

PAGE_FIT_TOLERANCE = 0.015
MAX_ROWS = 200_000


class ApiError(Exception):
    """A problem to show the user. `status` follows HTTP (400 bad input, 422 unreadable statement)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _d(s: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        raise ApiError(400, f"Invalid date '{s}', use YYYY-MM-DD")


def _scope(account: Optional[str]) -> Optional[str]:
    """The account filter as stored: None means every account, "" the rows with no bank set ("none" in requests)."""
    return "" if account == "none" else account or None


def _num(v, what: str, allow_none: bool = False) -> Optional[float]:
    if v is None and allow_none:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ApiError(400, f"{what} must be a number.")
    return float(v)


def _rows(body: dict) -> list[dict]:
    raw = body.get("rows") or []
    if not isinstance(raw, list) or len(raw) > MAX_ROWS:
        raise ApiError(400, "Too many rows in one request." if isinstance(raw, list) else "rows must be a list.")
    out = []
    for r in raw:
        if not isinstance(r, dict) or r.get("kind") not in ("debit", "credit") or not isinstance(r.get("date"), str):
            raise ApiError(400, "A transaction is not in the expected shape.")
        out.append({
            "id": int(r.get("id") or 0), "date": r["date"], "description": str(r.get("description") or ""),
            "merchant": str(r.get("merchant") or ""), "amount": _num(r.get("amount"), "An amount"), "kind": r["kind"],
            "category": str(r.get("category") or "Other"), "balance": _num(r.get("balance"), "A balance", allow_none=True),
            "account": str(r.get("account") or ""), "seq": int(r.get("seq") or 0),
        })
    return out


def _several_accounts(rows: list[dict]) -> bool:
    return len({r["account"] for r in rows}) > 1


def _analytics_rows(rows: list[dict], account: Optional[str]) -> list[dict]:
    """Rows for the sums. Running balances only chain within one account, so with several accounts mixed together the
    balances are left out rather than shown wrong."""
    scoped = _scope(account)
    mine = [r for r in rows if scoped is None or r["account"] == scoped]
    out = [{**r, "date": _d(r["date"])} for r in mine]
    if scoped is None and _several_accounts(rows):
        out = [{**r, "balance": None} for r in out]
    return out


def clean_budgets(b) -> dict:
    b = b if isinstance(b, dict) else {}
    cats = b.get("categories") if isinstance(b.get("categories"), dict) else {}
    return {
        "overall": _num(b.get("overall"), "The monthly budget", True), "savings_goal": _num(b.get("savings_goal"), "The savings goal", True),
        "categories": {str(k): _num(v, f"The {k} budget") for k, v in cats.items() if v is not None},
    }


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
def parse_pdf(path: str, password: Optional[str] = None, bank: Optional[str] = None, account_type: Optional[str] = None,
              overrides: Optional[dict] = None, saved_merchants: Optional[list] = None) -> dict:
    """Read a statement PDF at `path` and return its transactions. `overrides` ({payee: category}) and `saved_merchants`
    ([payee, ...]) are what the caller already knows, so new rows follow your earlier choices and payee spellings fold
    into the ones you have saved."""
    if not isinstance(overrides or {}, dict) or not isinstance(saved_merchants or [], list):
        raise ApiError(400, "Could not read the remembered choices sent with the statement.")
    if bank and bank != "auto" and bank not in banks.BY_ID:
        raise ApiError(400, "Unknown bank.")
    if account_type and account_type not in {t["id"] for t in banks.ACCOUNT_TYPES}:
        raise ApiError(400, "Unknown account type.")
    try:
        rows, meta = parser.parse_statement_ex(path, password or None, bank)
    except parser.StatementError as exc:
        raise ApiError(422, str(exc))
    bank_id = meta.get("bank") or "other"
    kind = account_type or "savings"
    prepared = ingest.prepare(rows, bank_id, kind, overrides or {}, [str(m) for m in (saved_merchants or [])])
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


def bank_list() -> dict:
    """Banks and account types you can pick, with what is known about how each lays out its statements."""
    return banks.public_list()


def category_list() -> list:
    return categorizer.CATEGORIES


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


def passbook(body: dict) -> dict:
    """The period laid out like a passbook: opening and closing balance, money in and out, entries in statement order
    (or sorted and filtered the way you ask)."""
    rows = _rows(body)
    start, end = body.get("start") or None, body.get("end") or None
    _d(start), _d(end)
    sort, kind = body.get("sort") or "statement", body.get("kind") or None
    if sort not in SORTS:
        raise ApiError(400, f"sort must be one of: {', '.join(SORTS)}")
    if kind not in (None, "", "in", "out"):
        raise ApiError(400, "kind must be 'in' or 'out'")
    category, q = body.get("category") or None, body.get("q") or None
    min_amount, max_amount = _num(body.get("min_amount"), "The minimum amount", True), _num(body.get("max_amount"), "The maximum amount", True)
    scoped = _scope(body.get("account"))
    period = [r for r in rows if (scoped is None or r["account"] == scoped) and (not start or r["date"] >= start) and (not end or r["date"] <= end)]
    if not period:
        return {"empty": True, "entries": []}
    first, last = period[0], period[-1]
    signed = lambda r: r["amount"] if r["kind"] == "credit" else -r["amount"]
    mixed = scoped is None and _several_accounts(rows)  # balances of different accounts do not chain
    has_balances = all(r["balance"] is not None for r in period) and not mixed
    opening = round(first["balance"] - signed(first), 2) if has_balances else None

    bad, prev = 0, opening
    for r in period:
        if has_balances and prev is not None and abs(prev + signed(r) - r["balance"]) > PAGE_FIT_TOLERANCE:
            bad += 1
        if r["balance"] is not None:
            prev = r["balance"]

    entries = period
    if category:
        entries = [r for r in entries if r["category"] == category]
    if q:
        needle = str(q).lower()
        entries = [r for r in entries if needle in r["description"].lower() or needle in r["merchant"].lower()]
    if kind:
        entries = [r for r in entries if r["kind"] == ("credit" if kind == "in" else "debit")]
    if min_amount is not None:
        entries = [r for r in entries if r["amount"] >= min_amount]
    if max_amount is not None:
        entries = [r for r in entries if r["amount"] <= max_amount]
    if SORTS[sort]:
        entries = sorted(entries, key=SORTS[sort], reverse=sort in REVERSE)  # stable: ties keep statement order
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
        "filtered": bool(category or q or kind or min_amount is not None or max_amount is not None),
        "sorted": sort != "statement",
        "sort": sort,
        "shown_in": round(sum(r["amount"] for r in entries if r["kind"] == "credit" and r["category"] != "Reversed"), 2),
        "shown_out": round(sum(r["amount"] for r in entries if r["kind"] == "debit" and r["category"] != "Reversed"), 2),
        "entries": [_decorate(r) for r in entries[:5000]],
    }


# --------------------------------------------------------------- analysis ---
def summary(body: dict) -> dict:
    s = analytics.summarize(_analytics_rows(_rows(body), body.get("account")), _d(body.get("start")), _d(body.get("end")))
    if not s.get("empty"):
        s["budget_status"] = analytics.budget_status(s, clean_budgets(body.get("budgets")))
    return s


def average_daily(body: dict) -> dict:
    s, e = _d(body.get("start")), _d(body.get("end"))
    if not s or not e:
        raise ApiError(400, "Pick a start and an end date.")
    if s > e:
        raise ApiError(400, "The start date must not be after the end date.")
    return analytics.average_daily(_analytics_rows(_rows(body), body.get("account")), s, e)


def report(body: dict) -> bytes:
    s = summary(body)
    notes = [{"title": str(n.get("title") or ""), "body": str(n.get("body") or ""), "created_at": str(n.get("created_at") or "")}
             for n in (body.get("notes") or []) if isinstance(n, dict)]
    return build_report(s, notes or None)


# ---------------------------------------------------------------- the browser's entry point ---
def call(op: str, payload_json: str) -> str:
    """What the browser worker calls: JSON in, JSON out. (Reports and statement files are handled by the worker.)"""
    try:
        data = json.loads(payload_json) if payload_json else {}
        table = {"summary": summary, "passbook": passbook, "average_daily": average_daily}
        if op in table:
            return json.dumps({"ok": True, "result": table[op](data)})
        if op == "banks":
            return json.dumps({"ok": True, "result": bank_list()})
        if op == "categories":
            return json.dumps({"ok": True, "result": category_list()})
        raise ApiError(400, f"Unknown operation '{op}'.")
    except ApiError as e:
        return json.dumps({"ok": False, "status": e.status, "message": e.message})
