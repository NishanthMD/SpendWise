"""Fake statements in the layouts public sample statements show for common Indian banks (no real data).

  python tests/make_bank_samples.py out_dir

Each layout is written four ways: oldest first and newest first, as a ruled table and as plain text lines.
Column names, date styles, Dr/Cr conventions and narration shapes follow publicly shared samples and bank
documents, so these test that the parser adapts to them, not that real files from those banks parse.
"""
import os
import sys
from datetime import date, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet

OPENING = 25000.00
# (day offset, kind, amount, party)
EVENTS = [
    (0, "cr", 38000.00, "ACME PVT LTD"), (0, "dr", 250.00, "SWIGGY"), (1, "dr", 1200.00, "RAMESH KUMAR"), (1, "dr", 480.50, "ZOMATO"),
    (3, "dr", 5000.00, "MEHTA STEELS"), (4, "cr", 1500.00, "PRIYA SHARMA"), (6, "dr", 320.00, "UBER"), (7, "dr", 899.00, "AMAZON"),
    (9, "dr", 2200.00, "SRI LAKSHMI TRADERS"), (10, "cr", 700.00, "RAMESH KUMAR"), (12, "dr", 150.00, "NETFLIX"), (14, "dr", 3100.00, "PRIYA SHARMA"),
]
START = date(2026, 10, 1)
BANK_NAMES = {"sbi": "State Bank of India", "hdfc": "HDFC Bank", "icici": "ICICI Bank", "kotak": "Kotak Mahindra Bank", "pnb": "Punjab National Bank", "axis": "Axis Bank"}
HEADERS = {
    "sbi": ["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
    "hdfc": ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    "icici": ["S No.", "Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Withdrawal Amount (INR)", "Deposit Amount (INR)", "Balance (INR)"],
    "kotak": ["Date", "Narration", "Chq/Ref No", "Withdrawal(Dr)/Deposit(Cr)", "Balance"],
    "pnb": ["Date", "Instrument ID", "Amount", "Type", "Balance", "Remarks"],
    "axis": ["Tran Date", "Chq No", "Particulars", "Debit", "Credit", "Balance", "Init. Br"],
}


def title(p):
    return " ".join(w.capitalize() for w in p.split())


def narration(bank, kind, party, i):
    """(narration as the bank writes it, the payee we expect to read from it)"""
    ref12, p = f"4{i:011d}", party
    handle = p.lower().replace(" ", ".")
    if bank == "sbi":
        if i % 5 == 4:
            return f"TO TRANSFER-NEFT*SBIN0001234*SBIN{ref12}*{p}*", title(p)
        return (f"TO TRANSFER-UPI/DR/{ref12}/{p}/UTIB/{handle}@axis/Pay" if kind == "dr" else f"BY TRANSFER-UPI/CR/{ref12}/{p}/UTIB/{handle}@axis/Pay"), title(p)
    if bank == "hdfc":
        return (f"UPI-{p}-{handle}@oksbi-SBIN0001234-{ref12}-UPI" if kind == "dr" else f"NEFT CR-HDFC0000001-{p}-N{ref12}"), title(p)
    if bank == "icici":
        return (f"UPI/{ref12}/Payment/{handle}@oksbi/State Bank Of I" if kind == "dr" else f"MMT/IMPS/{ref12}/Refund/{p}/HDFC BANK"), title(p)
    if bank == "kotak":
        return f"UPI/{p}/{ref12}/Sent from UPI", title(p)
    if bank == "pnb":
        return f"UPI/{ref12}/{kind.upper()}/{p}/HDFC", title(p)
    if bank == "axis":
        if kind == "cr":
            return f"MOB/TPFT/{p}/{ref12[:10]}", title(p)
        return (f"NEFT/MB/AXOMB{ref12}/{p}/UNION BANK OF INDIA/" if i % 2 else f"IMPS/P2A/{ref12}/{p}/X000002/UNIONBANKOFINDIA/"), title(p)
    raise ValueError(bank)


def build_rows(bank):
    """Oldest-first list of dicts, with the narration, expected payee and running balance."""
    rows, bal = [], OPENING
    for i, (off, kind, amt, party) in enumerate(EVENTS):
        bal = round(bal + amt if kind == "cr" else bal - amt, 2)
        text, payee = narration(bank, kind, party, i)
        rows.append({"date": START + timedelta(days=off), "kind": kind, "amount": amt, "narration": text, "payee": payee, "balance": bal})
    return rows


def money(x):
    return f"{x:,.2f}"


def datestr(bank, d):
    return {"sbi": f"{d.day} {d:%b %Y}", "hdfc": d.strftime("%d/%m/%y"), "icici": d.strftime("%d/%m/%Y"), "kotak": d.strftime("%d-%m-%Y"),
            "pnb": d.strftime("%d-%m-%Y"), "axis": d.strftime("%d-%m-%Y")}[bank]


def table_row(bank, i, r):
    d, n, a, b = datestr(bank, r["date"]), r["narration"], money(r["amount"]), money(r["balance"])
    dr, cr = (a, "") if r["kind"] == "dr" else ("", a)
    if bank == "sbi":
        return [d, d, n, "TRANSFER", dr, cr, b]
    if bank == "hdfc":
        return [d, n, "0000000000", d, dr, cr, b]
    if bank == "icici":
        return [str(i + 1), d, d, "", n, dr, cr, b]
    if bank == "kotak":
        return [d, n, "UPI-REF", f"{a}({'Dr' if r['kind'] == 'dr' else 'Cr'})", f"{b}(Cr)"]
    if bank == "pnb":
        return [d, "", a, r["kind"].upper(), b, n]
    return [d, "", n, dr, cr, b, "1234"]


def write_table(path, bank, rows):
    page = landscape(A4)
    doc = SimpleDocTemplate(path, pagesize=page, leftMargin=20, rightMargin=20)
    st = getSampleStyleSheet()
    story = [Paragraph(f"{BANK_NAMES[bank]} Statement of Account", st["Title"]), Paragraph("Branch IFSC and customer details", st["Normal"]), Spacer(1, 10)]
    data = [HEADERS[bank]] + [table_row(bank, i, r) for i, r in enumerate(rows)]
    widths = {"sbi": [55, 55, 260, 80, 55, 55, 65], "hdfc": [50, 280, 60, 50, 65, 65, 70], "icici": [28, 55, 60, 65, 220, 95, 95, 65],
              "kotak": [60, 300, 70, 110, 90], "pnb": [60, 60, 70, 40, 70, 330], "axis": [60, 45, 300, 60, 60, 70, 40]}[bank]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 6.5)]))
    story.append(t)
    doc.build(story)


def text_line(bank, i, r):
    d, n, a, b = datestr(bank, r["date"]), r["narration"], money(r["amount"]), money(r["balance"])
    if bank == "kotak":
        return f"{d} {n} {a}({'Dr' if r['kind'] == 'dr' else 'Cr'}) {b}(Cr)"
    if bank == "icici":
        return f"{i + 1} {d} {d} {n} {a} {b}"
    return f"{d} {n} {a} {b}"


def write_text(path, bank, rows):
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont("Helvetica", 7)
    y = 800
    for line in (f"{BANK_NAMES[bank]} Statement of Account", "Branch IFSC and customer details", f"Opening Balance {money(OPENING)}", " ".join(HEADERS[bank])):
        c.drawString(30, y, line)
        y -= 12
    for i, r in enumerate(rows):
        c.drawString(30, y, text_line(bank, i, r))
        y -= 11
    c.save()


def make(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for bank in HEADERS:
        for newest in (False, True):
            rows = build_rows(bank)
            listed = rows[::-1] if newest else rows
            for style, writer in (("table", write_table), ("text", write_text)):
                if style == "text" and bank == "pnb":
                    continue  # PNB prints the Dr/Cr marker in its own column, which only the table reader sees
                path = os.path.join(out_dir, f"bank_{bank}_{'newest' if newest else 'oldest'}_{style}.pdf")
                writer(path, bank, listed)
                made.append((path, bank, newest, style))
    return made


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    print(f"{len(make(out))} statements written to {out}")
