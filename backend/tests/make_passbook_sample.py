"""Fake passbook-style statement (Canara ePassbook layout) for tests. All data is invented.

Layout copied from the real thing: columns Date | Particulars | Deposits | Withdrawals | Balance,
narration wrapped mid-word in a narrow column, date and amounts vertically centred on each entry,
a "Chq: <ref>" line closing every entry, Opening/Closing Balance rows, "page N" footers, and a few
entries posted out of date order.

  python tests/make_passbook_sample.py out.pdf
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

W, H = A4
X_DATE, X_DESC, X_CR, X_DR, X_BAL = 56, 107, 395, 490, 581  # centre / left / right edges
HEAD_X = {"Date": 56, "Particulars": 195, "Deposits": 344, "Withdrawals": 446, "Balance": 538}
LINE = 11
WRAP = 26


def upi(direction, ref, name, bank, vpa, tail):
    return f"UPI/{direction}/{ref}/{name}/{bank}/{vpa}/PAYMENT//AXL{tail}/{{d}}/{{m}}/2026 12:00:00"


# (date dd-mm-2026, narration template or plain text, debit, credit)
ENTRIES = [
    ("01-10-2026", upi("DR", "100000000001", "KFCK261", "HDFC", "**21501@HDFCBANK", "29A4C60E3CC64A7B89FB"), 366.45, 0),
    ("01-10-2026", upi("DR", "100000000002", "AMAZONPA", "YESB", "**N-POD@YAPL", "F10DF2CE31456"), 1666.00, 0),
    ("02-10-2026", upi("CR", "100000000003", "HEMANTHS", "CNRB", "**84326@AXL", "0AEA27A135CD48A1A115"), 0, 60.00),
    ("02-10-2026", upi("DR", "100000000004", "NAVEENCH", "YESB", "**CTNIK@PTY", "95492AEDB5CC40FE8E27"), 120.00, 0),
    ("03-10-2026", upi("DR", "100000000005", "BLINKITC", "HDFC", "**PAYTM@HDFCBANK", "E1257757E2A481B84B2B"), 385.00, 0),
    ("04-10-2026", "APY CONTRI FOR(500000000001)10-2026", 42.00, 0),
    ("05-10-2026", upi("DR", "100000000006", "ARJUNKU", "FINO", "**11287@AXL", "766B73A658184F7FAB9A0"), 10000.00, 0),
    ("05-10-2026", upi("REV", "100000000006", "NISHANTH", "CNRB", "**90944@AXL", "766B73A658184F7FAB9A0"), 0, 10000.00),
    ("06-10-2026", upi("DR", "100000000007", "ARJUNKU", "FINO", "**11287@YBL", "F481F6A1443E4A5B90B3F"), 10000.00, 0),
    ("07-10-2026", upi("CR", "100000000008", "DINESHKU", "HDFC", "**19000@AXL", "73124F78D8BD43EABB18"), 0, 2000.00),
    ("08-10-2026", "NETFLIX*COM MUMBAI-08/10/26 18:39:09/3476", 199.00, 0),
    ("09-10-2026", "ATM / IMPS TRANSACTION CHARGES", 5.90, 0),
    ("04-10-2026", upi("DR", "100000000009", "NEW TAJH", "YESB", "**64788@YBL", "A339521A88EF4026A3EEB"), 55.00, 0),  # posted late
] * 3  # repeat to force several pages


def wrap(text):
    return [text[i:i + WRAP] for i in range(0, len(text), WRAP)]


def fmt(x):
    return f"{x:,.2f}"


def build(path):
    c = canvas.Canvas(path, pagesize=A4)
    page = 1

    def header(y):
        c.setFont("Helvetica", 9)
        for label, x in HEAD_X.items():
            c.drawCentredString(x, y, label)
        c.line(10, y + 12, W - 10, y + 12)
        c.line(10, y - 6, W - 10, y - 6)

    def footer():
        c.setFont("Helvetica", 9)
        c.drawString(W - 80, 30, f"page {page}")

    # Page 1 has an account-holder block above the table (fake, and ignored by the parser).
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, H - 60, "Statement for A/c XXXXXXXX0000 for the period 01-Oct-2026 to 09-Oct-2026")
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 90, "Name  TEST USER      Branch  SAMPLE BRANCH      Product  SB GENERAL")
    y = H - 140
    header(y)
    y -= 26
    balance = 5000.00
    c.setFont("Helvetica", 9)
    c.drawCentredString(330, y, "Opening Balance")
    c.drawRightString(X_BAL, y, fmt(balance))
    y -= 30

    for i, (date, narr, debit, credit) in enumerate(ENTRIES):
        d, m, _ = date.split("-")
        text = narr.format(d=d, m=m, ref=i) if "{d}" in narr else narr
        lines = wrap(text)
        block = (len(lines) + 2) * LINE + 14
        if y - block < 60:
            footer()
            c.showPage()
            page += 1
            y = H - 40
            header(y)
            y -= 26
        balance += credit - debit
        top = y
        c.setFont("Helvetica", 9)
        for j, ln in enumerate(lines):
            c.drawString(X_DESC, top - j * LINE, ln)
        mid = top - (len(lines) // 2) * LINE - 4
        c.drawCentredString(X_DATE, mid, date)
        if credit:
            c.drawRightString(X_CR, mid, fmt(credit))
        if debit:
            c.drawRightString(X_DR, mid, fmt(debit))
        c.drawRightString(X_BAL, mid, fmt(balance))
        c.drawString(X_DESC, top - (len(lines) + 1) * LINE, f"Chq: {1000000 + i}")
        y = top - (len(lines) + 2) * LINE - 14

    c.drawCentredString(330, y, "Closing Balance")
    c.drawRightString(X_BAL, y, fmt(balance))
    footer()
    c.save()
    return balance, len(ENTRIES)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "sample_passbook.pdf"
    bal, n = build(out)
    print(f"{n} entries, closing balance {bal:,.2f} -> {out}")
