"""Bank statement PDF parser.

Strategy (works for most Indian bank statements without bank-specific code):
0. Read the top of page 1 to tell which bank it is (banks.py). A bank you pick yourself wins.
1. Column-aware reader for passbook-style PDFs where one entry spans several lines (Canara ePassbook).
2. pdfplumber table extraction, mapping columns by header names (many aliases: Txn Date, Narration,
   Particulars, Transaction Remarks, Withdrawal Amt., Debit, Dr/Cr ...). Handles separate debit and credit
   columns, one amount column with a Dr/Cr marker or type column, and balances marked (Cr) or Dr.
3. Line parsing, using the running balance to decide whether a row is a debit or a credit.

Whatever layer reads the rows, the result is put in oldest-first order by checking which direction the
running balance reconciles (many banks list newest first), then checked row by row.

Output: list of dicts {date, description, debit, credit, balance}.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Iterable, Optional

import pdfplumber

from core import banks

DATE_FORMATS = [
    "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y", "%d.%m.%Y",
    "%d %b %Y", "%d-%b-%Y", "%d %b %y", "%d-%b-%y", "%d %B %Y", "%d-%B-%Y",
    "%Y-%m-%d", "%d/%b/%Y", "%d %b, %Y",
]
DATE_RE = re.compile(
    r"^\s*(?:\d{1,5}\s+)?(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[ \-/][A-Za-z]{3,9}[ \-/,]*\d{2,4}|\d{4}-\d{2}-\d{2})"
)
AMOUNT_RE = re.compile(r"(?<![\w/])\d[\d,]*\.\d{2}(?!\d)")
# an amount with an optional Dr/Cr marker after it: 1,234.00 Dr   1,234.00(Cr)   1,234.00 CR.
AMOUNT_SIDE_RE = re.compile(r"(?<![\w/])(\d[\d,]*\.\d{2})(?!\d)\s*(?:\(\s*(Dr|Cr)\s*\)|\b(Dr|Cr)\b\.?)?", re.I)
SUFFIX_RE = re.compile(r"\s*(?:\(\s*(Dr|Cr)\s*\)|\b(Dr|Cr)\b\.?)\s*$", re.I)


class StatementError(Exception):
    pass


def parse_date(text: str) -> Optional[date]:
    t = re.sub(r"\s+", " ", (text or "").strip().replace(",", " ")).strip()
    t = t.split(" ")[0] if re.match(r"^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", t) else t
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None


def amount_side(text) -> Optional[str]:
    """'cr' or 'dr' when the amount carries a Dr/Cr marker, else None."""
    m = SUFFIX_RE.search(str(text or "").strip())
    if not m:
        return None
    return (m.group(1) or m.group(2)).lower()


def parse_amount(text) -> Optional[float]:
    if text is None:
        return None
    t = str(text).strip().replace(",", "").replace("₹", "").replace("Rs.", "").replace("INR", "")
    t = SUFFIX_RE.sub("", t).strip()
    if not t or t in {"-", "--"}:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def parse_balance(text) -> Optional[float]:
    """A balance; one marked Dr is overdrawn, so it is negative."""
    v = parse_amount(text)
    return -abs(v) if v is not None and amount_side(text) == "dr" else v


# --------------------------------------------------------------------------
# Table based parsing
# --------------------------------------------------------------------------
def _norm(cell) -> str:
    return re.sub(r"\s+", " ", (cell or "")).strip().lower()


TYPE_HEADS = {"dr/cr", "cr/dr", "dr / cr", "type", "txn type", "transaction type", "cr/dr indicator"}
DESC_HEADS = ("narration", "description", "particulars", "details", "remarks")
DEBIT_HEADS = ("withdrawal", "debit", "paid out", "dr amount")
CREDIT_HEADS = ("deposit", "credit", "paid in", "cr amount")


def _map_header(row) -> Optional[dict]:
    cols: dict = {}
    for i, cell in enumerate(row):
        c = _norm(cell)
        if not c:
            continue
        if c in TYPE_HEADS and "type" not in cols:
            cols["type"] = i
        elif (("withdrawal" in c and "deposit" in c) or ("debit" in c and "credit" in c)) and "amount" not in cols:
            cols["amount"] = i  # Kotak: one column headed Withdrawal(Dr)/Deposit(Cr), direction marked on each amount
        elif "date" in c and "value" not in c and "date" not in cols:
            cols["date"] = i
        elif "date" in c and "value" in c and "value_date" not in cols:
            cols["value_date"] = i
        elif any(k in c for k in DESC_HEADS) and "desc" not in cols:
            cols["desc"] = i
        elif any(k in c for k in DEBIT_HEADS) and "debit" not in cols:
            cols["debit"] = i
        elif any(k in c for k in CREDIT_HEADS) and "credit" not in cols:
            cols["credit"] = i
        elif "balance" in c and "balance" not in cols:
            cols["balance"] = i
        elif (c in {"amount", "amount (inr)", "transaction amount"} or c.startswith("amount")) and "amount" not in cols:
            cols["amount"] = i
    if "date" not in cols and "value_date" in cols:
        cols["date"] = cols["value_date"]
    if "date" in cols and "desc" in cols and (("debit" in cols and "credit" in cols) or "amount" in cols):
        return cols
    return None


def _cell(row, i):
    return row[i] if i is not None and i < len(row) else None


OPENING_RE = re.compile(r"opening\s+balance[^\d\n-]{0,25}(-?\d[\d,]*\.\d{2})", re.I)


def _opening_hint(pdf) -> Optional[float]:
    """An 'Opening Balance 25,000.00' line in the statement header, when there is one (used in memory only)."""
    for page in pdf.pages[:2]:
        m = OPENING_RE.search(page.extract_text() or "")
        if m:
            return parse_amount(m.group(1))
    return None


def _resolve_sides(entries: list, opening: Optional[float] = None) -> None:
    """Fill in debit or credit for entries whose amount has no marker, from how the balance moved.

    Done in time order, so a statement listed newest first is not read backwards.
    """
    descending = len(entries) > 1 and entries[0]["date"] > entries[-1]["date"]
    prev = opening
    for e in (entries[::-1] if descending else entries):
        if e["side"] is None:
            if prev is not None and e["balance"] is not None:
                e["side"] = "cr" if e["balance"] > prev else "dr"
            else:
                e["side"] = "cr" if re.search(r"\bcr\b|credit|salary|refund|interest|received", e["description"], re.I) else "dr"
        if e["balance"] is not None:
            prev = e["balance"]


def _to_rows(entries: list) -> list:
    out = []
    for e in entries:
        amt = abs(e["amount"])
        out.append({"date": e["date"], "description": e["description"], "debit": amt if e["side"] == "dr" else 0.0,
                    "credit": amt if e["side"] == "cr" else 0.0, "balance": e["balance"]})
    return out


def _rows_from_tables(pdf) -> list:
    entries: list = []
    cols = None
    for page in pdf.pages:
        for table in page.extract_tables() or []:
            for row in table:
                if not row:
                    continue
                header = _map_header(row)
                if header:
                    cols = header
                    continue
                if not cols:
                    continue
                d = parse_date(_cell(row, cols["date"]) or "")
                if d is None:
                    # continuation of the previous narration
                    if entries and _cell(row, cols["desc"]):
                        entries[-1]["description"] += " " + re.sub(r"\s+", " ", row[cols["desc"]]).strip()
                    continue
                desc = re.sub(r"\s+", " ", _cell(row, cols["desc"]) or "").strip()
                bal_raw = _cell(row, cols.get("balance"))
                balance = parse_balance(bal_raw) if bal_raw is not None else None
                if "debit" in cols and "credit" in cols:
                    debit, credit = parse_amount(_cell(row, cols["debit"])), parse_amount(_cell(row, cols["credit"]))
                    if not debit and not credit:
                        continue
                    amount, side = (credit, "cr") if credit and not debit else (debit, "dr")
                    if credit and debit:  # both filled: trust the balance, resolved below
                        amount, side = max(credit, debit), None
                else:
                    raw = _cell(row, cols["amount"])
                    amount = parse_amount(raw)
                    if not amount:
                        continue
                    side = amount_side(raw)
                    if side is None and "type" in cols:
                        t = _norm(_cell(row, cols["type"]))
                        side = "cr" if t.startswith("c") else "dr" if t.startswith("d") else None
                entries.append({"date": d, "description": desc, "amount": amount, "side": side, "balance": balance})
    _resolve_sides(entries, _opening_hint(pdf))
    return _to_rows(entries)


# --------------------------------------------------------------------------
# Text based fallback
# --------------------------------------------------------------------------
def _rows_from_text(pdf) -> list:
    entries: list = []
    for page in pdf.pages:
        text = page.extract_text() or ""
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            m = DATE_RE.match(line)
            found = [(mm.group(1), (mm.group(2) or mm.group(3) or "").lower(), mm) for mm in AMOUNT_SIDE_RE.finditer(line)]
            if m and len(found) >= 2 and parse_date(m.group(1)):
                d = parse_date(m.group(1))
                bal_txt, bal_mark, _ = found[-1]
                amt_txt, amt_mark, amt_m = found[-2]
                balance = parse_amount(bal_txt)
                if bal_mark == "dr":
                    balance = -balance
                # description = text between the date and the first amount
                desc = line[m.end():found[0][2].start()].strip()
                desc = re.sub(r"^\s*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s+", "", desc)  # a second leading date (value date)
                desc = re.sub(r"\s+\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s*$", "", desc).strip()  # trailing value date
                entries.append({"date": d, "description": re.sub(r"\s+", " ", desc), "amount": parse_amount(amt_txt),
                                "side": amt_mark or None, "balance": balance})
            elif entries and not m and not found and len(line) < 80 and not re.search(r"page|statement|opening|closing", line, re.I):
                entries[-1]["description"] += " " + line
    _resolve_sides(entries, _opening_hint(pdf))
    return _to_rows(entries)


# --------------------------------------------------------------------------
# Column-aware parser (Canara-style passbooks and similar)
#
# In these PDFs each entry is a tall, wrapped narration with the date and
# amounts vertically centred, and every entry ends with a "Chq: <ref>" line.
# Plain table/line parsing scrambles them, so we read words by x-position.
# --------------------------------------------------------------------------
NUM_RE = re.compile(r"^-?\d[\d,]*\.\d{2}$")
DESC_HEAD = ("particulars", "narration", "description", "details", "remarks")
CREDIT_HEAD = ("deposits", "deposit", "credit", "credits", "cr")
DEBIT_HEAD = ("withdrawals", "withdrawal", "debit", "debits", "dr")


def _group_lines(words, tol: float = 2.5):
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if lines and abs(lines[-1][0]["top"] - w["top"]) <= tol:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(l, key=lambda w: w["x0"]) for l in lines]


def _header_columns(line):
    """Return {'date','desc','credit','debit','balance'} -> x-centre, or None if this is not a header line."""
    cols = {}
    for w in line:
        t = w["text"].lower().strip(".:")
        c = (w["x0"] + w["x1"]) / 2
        if t == "date" and "date" not in cols:
            cols["date"] = c
        elif t in DESC_HEAD and "desc" not in cols:
            cols["desc"] = c
        elif t in CREDIT_HEAD and "credit" not in cols:
            cols["credit"] = c
        elif t in DEBIT_HEAD and "debit" not in cols:
            cols["debit"] = c
        elif t == "balance" and "balance" not in cols:
            cols["balance"] = c
    return cols if {"date", "desc", "credit", "debit", "balance"} <= set(cols) else None


def _column_of(x_centre: float, cols: dict) -> str:
    return min(cols, key=lambda k: abs(cols[k] - x_centre))


def _rows_from_positions(pdf):
    """Returns (rows, meta). rows is empty when the layout has no 'Chq:' terminators."""
    rows: list[dict] = []
    meta = {"opening_balance": None, "closing_balance": None}
    cols = None
    cur = None
    finished = False

    def fresh():
        return {"date": None, "lines": [], "credit": None, "debit": None, "balance": None}

    for page in pdf.pages:
        if finished:
            break
        in_table = False
        cur = cur or fresh()
        for line in _group_lines(page.extract_words(keep_blank_chars=False, use_text_flow=False)):
            text = " ".join(w["text"] for w in line)
            low = text.lower()
            hdr = _header_columns(line)
            if hdr:
                cols, in_table = hdr, True
                continue
            if not in_table or not cols:
                continue
            if "opening balance" in low or "closing balance" in low:
                nums = [parse_amount(w["text"]) for w in line if NUM_RE.match(w["text"])]
                if nums:
                    key = "opening_balance" if "opening" in low else "closing_balance"
                    meta[key] = nums[-1]
                if "closing balance" in low:
                    finished = True
                    break
                continue
            if low.startswith("page ") or low.startswith("disclaimer"):
                continue
            desc_words = []
            right = {k: cols[k] for k in ("credit", "debit", "balance")}
            for w in line:
                t, centre = w["text"], (w["x0"] + w["x1"]) / 2
                if NUM_RE.match(t) and centre > cols["desc"]:
                    cur[_column_of(centre, right)] = parse_amount(t)  # amounts: nearest of the three right-hand columns
                elif centre < cols["desc"] and re.match(r"^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$", t) and parse_date(t):
                    cur["date"] = parse_date(t)  # the Date column sits left of the narration
                else:
                    desc_words.append(t)
            if desc_words and desc_words[0].lower().startswith("chq"):
                # end of this entry
                if cur["date"] and (cur["credit"] is not None or cur["debit"] is not None):
                    rows.append(_finish_entry(cur))
                cur = fresh()
            elif desc_words:
                cur["lines"].append(" ".join(desc_words))
    return rows, meta


def _finish_entry(cur: dict) -> dict:
    lines = cur["lines"]
    joined = "".join(lines) if lines and lines[0].upper().startswith("UPI") else " ".join(lines)
    desc = re.sub(r"\s+", " ", joined).strip()
    debit, credit = cur["debit"] or 0.0, cur["credit"] or 0.0
    reversal = False
    if debit < 0:  # negative withdrawal = money returned (e.g. UPI/REV/...)
        credit, debit, reversal = -debit, 0.0, True
    if re.match(r"^UPI/REV/", desc, re.I):
        reversal = True
    ref = None
    m = re.match(r"^UPI/(?:DR|CR|REV)/(\d+)/", desc, re.I)
    if m:
        ref = m.group(1)
    return {"date": cur["date"], "description": desc, "debit": debit, "credit": credit,
            "balance": cur["balance"], "ref": ref, "is_reversal": reversal}


def reconcile(rows: list, opening: Optional[float]) -> int:
    """Count rows whose running balance does not follow from the previous balance."""
    bad, prev = 0, opening
    for r in rows:
        if prev is not None and r.get("balance") is not None:
            if abs(prev + r["credit"] - r["debit"] - r["balance"]) > 0.015:
                bad += 1
        if r.get("balance") is not None:
            prev = r["balance"]
    return bad



def orient(rows: list) -> tuple:
    """Put rows oldest-first. Banks differ (many list newest first), so rather than assume, see which
    direction the running balance reconciles in; with no balances, fall back to the dates."""
    if len(rows) < 2:
        return rows, "oldest_first"
    if all(r.get("balance") is not None for r in rows):
        if reconcile(rows[::-1], None) < reconcile(rows, None):
            return rows[::-1], "newest_first"
        return rows, "oldest_first"
    if rows[0]["date"] > rows[-1]["date"]:
        return rows[::-1], "newest_first"
    return rows, "oldest_first"


def _head_text(pdf) -> str:
    """The text above the first transaction on page 1: where the bank names itself. Used in memory only."""
    try:
        lines = (pdf.pages[0].extract_text() or "").splitlines()
    except Exception:
        return ""
    out = []
    for ln in lines:
        if DATE_RE.match(ln) and len(AMOUNT_RE.findall(ln)) >= 2:
            break
        out.append(ln)
        if sum(len(x) for x in out) > 3000:
            break
    return "\n".join(out)


def parse_statement_ex(path: str, password: Optional[str] = None, bank: Optional[str] = None) -> tuple:
    """Parse a statement. Returns (rows, meta); rows are oldest first. `bank` is a banks.py id you picked, or None to detect."""
    try:
        pdf = pdfplumber.open(path, password=password)
    except Exception as exc:  # wrong/missing password, corrupt file
        # pdfminer's password errors carry no message, so the exception's own name is the reliable signal.
        # pdfplumber wraps the original error, so look through its args and cause too.
        inner = [exc, exc.__cause__, *[a for a in exc.args if isinstance(a, BaseException)]]
        said = " ".join(type(e).__name__ + " " + str(e) for e in inner if e is not None).lower()
        if "password" in said or "encrypt" in said:
            if password:
                raise StatementError("That password did not open the PDF. Check it and try again.")
            raise StatementError("This PDF is password protected. Enter the password (often your date of birth or customer ID) and try again.")
        raise StatementError(f"Could not open the PDF: {exc or type(exc).__name__}")
    meta: dict = {"opening_balance": None, "closing_balance": None}
    with pdf:
        detected = banks.detect_bank(_head_text(pdf))
        rows, found = _rows_from_positions(pdf)
        if rows:
            meta.update(found)
            meta["layout"] = "passbook"
            meta["order"] = "oldest_first"
        else:
            rows = _rows_from_tables(pdf)
            meta["layout"] = "table"
            if len(rows) < 2:
                rows = _rows_from_text(pdf)
                meta["layout"] = "text"
            if rows:
                rows, meta["order"] = orient(rows)
                first, last = rows[0], rows[-1]
                if first["balance"] is not None:
                    meta["opening_balance"] = round(first["balance"] - first["credit"] + first["debit"], 2)
                    meta["closing_balance"] = last["balance"]
    if not rows:
        raise StatementError(
            "No transactions found. The PDF may be a scanned image (OCR needed) or use an unusual layout. "
            "Try downloading the statement as a text-based PDF from net banking."
        )
    meta["bank_detected"] = detected
    meta["bank"] = bank if bank and bank != "auto" else detected
    # Keep the statement's own order: entries can post out of date order, and the running balance only reconciles in file order.
    meta["balance_mismatches"] = reconcile(rows, meta.get("opening_balance"))
    meta["rows"] = len(rows)
    return rows, meta


def parse_statement(path: str, password: Optional[str] = None) -> list:
    return parse_statement_ex(path, password)[0]
