"""Generate fake bank statement PDFs for testing (no real data).

  python tests/make_sample_statement.py out_dir
Creates sample_table.pdf (ruled table layout) and sample_text.pdf (plain text layout).
"""
import os
import sys
from datetime import date, timedelta
import random

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

random.seed(7)

# (narration, debit, credit)
TEMPLATES = [
    ("UPI/DR/412345/SWIGGY/ybl/Order", (180, 520), 0),
    ("UPI/DR/412346/ZOMATO/ybl/Food", (150, 480), 0),
    ("UPI/DR/412347/RAMESH KUMAR/okaxis/Sent", (200, 3000), 0),
    ("UPI/DR/412348/PRIYA SHARMA/okhdfcbank/Sent", (100, 1500), 0),
    ("UPI/DR/412349/SRI LAKSHMI PROVISION STORE/paytmqr/Pay", (60, 700), 0),
    ("UPI/DR/412350/NEW MEDICAL STORES/ybl/Pay", (80, 600), 0),
    ("UPI/DR/412351/BOOKMYSHOW/ybl/Tickets", (300, 900), 0),
    ("UPI/DR/412352/UBER INDIA/ybl/Ride", (90, 450), 0),
    ("UPI/DR/412353/AMAZON PAY/apl/Order", (300, 2500), 0),
    ("UPI/DR/412354/NETFLIX/ybl/Sub", (199, 199), 0),
    ("ATM CASH WDL BLR MG ROAD", (500, 2000), 0),
]


def make_rows(n_days=75):
    rows, bal = [], 42000.00
    start = date(2026, 8, 1)
    rows.append((start, "SALARY CREDIT ACME PVT LTD", 0.0, 38000.00, bal + 38000.00))
    bal += 38000.00
    for i in range(n_days):
        d = start + timedelta(days=i)
        for _ in range(random.choice([0, 1, 1, 2, 3])):
            narr, (lo, hi), _c = random.choice(TEMPLATES)
            amt = float(random.randint(lo, hi))
            bal -= amt
            rows.append((d, narr, amt, 0.0, round(bal, 2)))
        if d.day == 1 and i > 0:
            bal += 38000
            rows.append((d, "SALARY CREDIT ACME PVT LTD", 0.0, 38000.00, round(bal, 2)))
    return rows


def fmt(x):
    return f"{x:,.2f}" if x else ""


def table_pdf(path, rows):
    doc = SimpleDocTemplate(path, pagesize=A4)
    data = [["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]]
    for d, n, dr, cr, b in rows:
        data.append([d.strftime("%d/%m/%Y"), n, fmt(dr), fmt(cr), f"{b:,.2f}"])
    t = Table(data, repeatRows=1, colWidths=[60, 230, 70, 60, 70])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 6.5)]))
    doc.build([t])


def text_pdf(path, rows):
    c = canvas.Canvas(path, pagesize=A4)
    y = 800
    c.setFont("Helvetica", 7)
    c.drawString(30, y, "Statement of Account  Date  Narration  Withdrawals  Deposits  Balance")
    y -= 14
    for d, n, dr, cr, b in rows:
        amt = fmt(dr or cr)
        c.drawString(30, y, f"{d.strftime('%d %b %Y')}  {n}  {amt}  {b:,.2f}")
        y -= 11
        if y < 40:
            c.showPage(); c.setFont("Helvetica", 7); y = 800
    c.save()


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    rows = make_rows()
    table_pdf(os.path.join(out, "sample_table.pdf"), rows)
    text_pdf(os.path.join(out, "sample_text.pdf"), rows)
    print(f"{len(rows)} rows written to {out}")
