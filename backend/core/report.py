"""Downloadable PDF report built with reportlab (no matplotlib needed). Amounts are written "Rs." because the
built-in PDF fonts have no rupee sign."""
from __future__ import annotations

import io
from datetime import date
from typing import Optional

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#14234a")
MUTED = colors.HexColor("#53627f")
RULE = colors.HexColor("#c5d0e2")
PAPER = colors.HexColor("#e2e9f3")
BLUE = colors.HexColor("#2a5fd0")
GREEN = colors.HexColor("#1b8a6b")
RED = colors.HexColor("#b42318")

# The same colours the app uses for each category.
CATEGORY_COLORS = {
    "Food": "#E07A1F", "Entertainment": "#7B4FD1", "Local Shops": "#1B8A6B", "Person": "#2563C9", "Transport": "#0E9CB5",
    "Shopping": "#C23B73", "Bills & Utilities": "#6B7A8C", "Health": "#C8362E", "Subscriptions": "#9A6B12", "Cash": "#4B5563",
    "Other": "#A3AEBB", "Income": "#2F855A", "Groceries": "#8AA61F", "Education": "#5B5BD6", "Savings": "#0F8F5A",
    "Bank Charges": "#8B6B5A", "Reversed": "#B8C2CC",
}


def _color(cat: str):
    return colors.HexColor(CATEGORY_COLORS.get(cat, "#A3AEBB"))


def _rs(x: float, digits: int = 2) -> str:
    return f"Rs. {x:,.{digits}f}"


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9 * mm, f"SpendWise report, made on {date.today().isoformat()}. Built on your computer from the statement you uploaded.")
    canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_report(summary: dict, notes: Optional[list] = None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                            title="Spending report", author="SpendWise")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=22, textColor=INK, spaceAfter=2, leading=26)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=INK, spaceBefore=14, spaceAfter=6)
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=10, leading=14, textColor=INK)
    muted = ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=9)

    story = [Paragraph("Spending report", h1)]
    if summary.get("empty"):
        story.append(Paragraph("No transactions in the selected period.", body))
        doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
        return buf.getvalue()

    story.append(Paragraph(
        f"{summary['start']} to {summary['end']} &nbsp;|&nbsp; {summary['days']} days &nbsp;|&nbsp; {summary['transactions']} transactions", muted))
    story.append(Spacer(1, 8))

    # ---- key numbers
    rate = summary.get("savings_rate")
    ns = summary.get("no_spend") or {}
    cells = [
        ("Total spent", _rs(summary["total_spent"])), ("Total income", _rs(summary["total_income"])), ("Net", _rs(summary["net"])),
        ("Average per day", _rs(summary["avg_daily_spend"])),
        ("Savings rate", f"{rate * 100:.0f}%" if rate is not None else "n/a"),
        ("Longest no-spend streak", f"{ns.get('best', 0)} days"),
    ]
    rows = [[c[0] for c in cells[:3]], [c[1] for c in cells[:3]], [c[0] for c in cells[3:]], [c[1] for c in cells[3:]]]
    t = Table(rows, colWidths=[58 * mm] * 3)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PAPER), ("BACKGROUND", (0, 2), (-1, 2), PAPER),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, 0), 8), ("FONTSIZE", (0, 2), (-1, 2), 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK), ("TEXTCOLOR", (0, 0), (-1, 0), MUTED), ("TEXTCOLOR", (0, 2), (-1, 2), MUTED),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"), ("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, 1), 12), ("FONTSIZE", (0, 3), (-1, 3), 12),
        ("BOX", (0, 0), (-1, -1), 0.8, INK), ("LINEBELOW", (0, 1), (-1, 1), 0.4, RULE), ("LINEBEFORE", (1, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)

    # ---- category chart + table
    cats = summary["categories"]
    if cats:
        story.append(Paragraph("Where the money went", h2))
        d = Drawing(174 * mm, 60 * mm)
        pie = Pie()
        pie.x, pie.y, pie.width, pie.height = 4 * mm, 3 * mm, 54 * mm, 54 * mm
        pie.data = [c["amount"] for c in cats]
        pie.labels = None
        pie.sideLabels = False
        pie.simpleLabels = True
        for i, c in enumerate(cats):
            pie.slices[i].fillColor = _color(c["category"])
            pie.slices[i].strokeColor = colors.white
            pie.slices[i].strokeWidth = 1
        d.add(pie)
        y = 56 * mm
        for c in cats[:11]:
            d.add(Rect(70 * mm, y - 1, 3 * mm, 3 * mm, fillColor=_color(c["category"]), strokeColor=None))
            d.add(String(76 * mm, y, f"{c['category']}  {c['percent']}%  ({_rs(c['amount'], 0)})", fontName="Helvetica", fontSize=8.5, fillColor=INK))
            y -= 5 * mm
        story.append(d)

        rows = [["Category", "Payments", "Amount", "Share"]] + [
            [c["category"], str(c["count"]), _rs(c["amount"]), f"{c['percent']}%"] for c in cats
        ]
        ct = Table(rows, colWidths=[62 * mm, 30 * mm, 46 * mm, 30 * mm], repeatRows=1)
        ct.setStyle(_grid_style())
        story.append(ct)

    # ---- monthly chart: spent and income side by side
    if summary["monthly"]:
        d = Drawing(174 * mm, 62 * mm)
        bc = VerticalBarChart()
        bc.x, bc.y, bc.width, bc.height = 16 * mm, 12 * mm, 150 * mm, 40 * mm
        bc.data = [[m["total"] for m in summary["monthly"]], [m["income"] for m in summary["monthly"]]]
        bc.categoryAxis.categoryNames = [m["period"] for m in summary["monthly"]]
        bc.categoryAxis.labels.fontSize = 7.5
        bc.valueAxis.labels.fontSize = 7
        bc.valueAxis.valueMin = 0
        peak = max(max(row) for row in bc.data) or 1
        step = 10 ** (len(str(int(peak))) - 1) / (2 if peak / 10 ** (len(str(int(peak))) - 1) < 3 else 1)
        bc.valueAxis.valueStep = step
        bc.valueAxis.valueMax = step * (int(peak / step) + 1)
        bc.valueAxis.labelTextFormat = lambda v: f"{v / 1000:.0f}k" if v >= 1000 else f"{v:.0f}"
        bc.bars[0].fillColor = BLUE
        bc.bars[1].fillColor = GREEN
        bc.bars.strokeColor = None
        for axis in (bc.categoryAxis, bc.valueAxis):
            axis.labels.fontName = "Helvetica"
            axis.strokeColor = RULE
            axis.labels.fillColor = MUTED
        bc.valueAxis.gridStrokeColor = RULE
        bc.valueAxis.visibleGrid = True
        bc.barWidth = 9
        bc.groupSpacing = 10
        d.add(bc)
        lg = Legend()
        lg.x, lg.y = 18 * mm, 60 * mm
        lg.alignment = "right"
        lg.fontSize = 8
        lg.fontName = "Helvetica"
        lg.deltax = 40
        lg.columnMaximum = 1
        lg.colorNamePairs = [(BLUE, "Spent"), (GREEN, "Income")]
        d.add(lg)
        story.append(KeepTogether([Paragraph("Month by month", h2), d]))

    # ---- top payees
    if summary["top_merchants"]:
        rows = [["Payee", "Category", "Payments", "Amount"]] + [
            [_esc(m["merchant"])[:34], m["category"], str(m["count"]), _rs(m["amount"])] for m in summary["top_merchants"]
        ]
        mt = Table(rows, colWidths=[62 * mm, 44 * mm, 26 * mm, 36 * mm], repeatRows=1)
        mt.setStyle(_grid_style())
        story.append(KeepTogether([Paragraph("Top payees", h2), mt]))

    # ---- budgets, when the user set any
    b = summary.get("budget_status") or {}
    budget_rows = []
    if b.get("overall"):
        o = b["overall"]
        budget_rows.append(["All spending", _rs(o["monthly"], 0), _rs(b["month_spent"], 0), f"{o['ratio'] * 100:.0f}%"])
    for c in b.get("categories", []):
        budget_rows.append([c["category"], _rs(c["monthly"], 0), _rs(c["spent"], 0), f"{c['ratio'] * 100:.0f}%"])
    if b.get("savings_goal"):
        g = b["savings_goal"]
        budget_rows.append(["Savings goal", _rs(g["monthly"], 0), _rs(max(g["saved"], 0), 0), f"{g['ratio'] * 100:.0f}%"])
    if budget_rows:
        bt = Table([["Budget (monthly)", "Target", "This month", "Used"]] + budget_rows, colWidths=[62 * mm, 40 * mm, 40 * mm, 26 * mm], repeatRows=1)
        style = _grid_style()
        for i, r in enumerate(budget_rows, start=1):
            if float(r[3].rstrip("%")) > 100 and r[0] != "Savings goal":
                style.add("TEXTCOLOR", (3, i), (3, i), RED)
        bt.setStyle(style)
        story.append(KeepTogether([Paragraph(f"Budgets, {b['month']}", h2), bt]))

    # ---- highlights
    facts = []
    if summary.get("highest_spend_day"):
        h = summary["highest_spend_day"]
        facts.append(f"Busiest day: {h['date']} ({_rs(h['amount'])}, {h['count']} payments)")
    if summary.get("largest_transaction"):
        l = summary["largest_transaction"]
        facts.append(f"Largest payment: {_esc(l['merchant'])} on {l['date']} ({_rs(l['amount'])})")
    if ns:
        facts.append(f"{ns['days']} of {summary['days']} days had no spending; the longest run was {ns['best']} days")
    if summary.get("closing_balance") is not None:
        facts.append(f"Balance at the end of the period: {_rs(summary['closing_balance'])}")
    if summary.get("reversed_entries"):
        facts.append(f"{summary['reversed_entries']} entries (a failed payment and its refund) were left out of every total")
    if facts:
        story.append(Paragraph("Highlights", h2))
        for f in facts:
            story.append(Paragraph("&bull; " + f, body))

    # ---- optional notes
    if notes:
        story.append(Paragraph("Notes", h2))
        for n in notes:
            story.append(Paragraph(f"<b>{_esc(n['title'] or 'Note')}</b> ({n['created_at'][:10]}): {_esc(n['body'])}", body))
            story.append(Spacer(1, 3))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def _grid_style() -> TableStyle:
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PAPER), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (-2, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.25, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])
