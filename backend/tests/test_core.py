"""Run: python tests/test_core.py <dir-with-sample_table.pdf-and-sample_text.pdf>
Framework-free checks of parser -> categorizer -> DB -> analytics -> report."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sample_dir = sys.argv[1]

from memstore import MemStore
from core import analytics, categorizer, parser
from core.report import build_report

store = MemStore()
results = {}
for name in ("sample_table.pdf", "sample_text.pdf"):
    rows = parser.parse_statement(os.path.join(sample_dir, name))
    results[name] = rows
    print(f"{name}: parsed {len(rows)} rows, {rows[0]['date']} -> {rows[-1]['date']}")

a, b = results["sample_table.pdf"], results["sample_text.pdf"]
assert len(a) == len(b) == 113, (len(a), len(b))
for x, y in zip(a, b):
    assert x["date"] == y["date"] and abs(x["debit"] - y["debit"]) < 0.01 and abs(x["credit"] - y["credit"]) < 0.01, (x, y)
print("table parser and text-fallback parser agree on all rows")

# insert twice -> second must be all duplicates
r1 = store.insert(a)
r2 = store.insert(a)
print("first insert:", r1, "| second insert:", r2)
assert r1["added"] == 113 and r2["added"] == 0

txns = store.analytics_rows()
cats = {}
for t in txns:
    cats.setdefault(t["category"], set()).add(t["merchant"])
for c, m in sorted(cats.items()):
    print(f"  {c:18s} {sorted(m)[:5]}")

expect = {"SWIGGY": "Food", "ZOMATO": "Food", "Ramesh Kumar": "Person", "Priya Sharma": "Person",
          "Bookmyshow": "Entertainment", "Uber": "Transport", "Netflix": "Subscriptions"}
by_m = {t["merchant"]: t["category"] for t in txns}
for m, c in expect.items():
    got = by_m.get(m) or by_m.get(m.title())
    assert got == c, (m, c, got, sorted(by_m.items()))
assert any(c == "Local Shops" for c in by_m.values()), "no local shops categorized"
assert any(c == "Cash" for c in by_m.values())
print("category expectations OK")

s = analytics.summarize(txns)
total_debit = round(sum(r["debit"] for r in a), 2)
assert abs(s["total_spent"] - total_debit) < 0.01, (s["total_spent"], total_debit)
assert abs(s["avg_daily_spend"] - s["total_spent"] / s["days"]) < 0.01
assert abs(sum(c["amount"] for c in s["categories"]) - s["total_spent"]) < 0.05
assert abs(sum(d["amount"] for d in s["daily"]) - s["total_spent"]) < 0.05
print(f"summary OK: spent {s['total_spent']:,.2f} over {s['days']} days, avg/day {s['avg_daily_spend']:,.2f}, "
      f"top={s['top_category']['category']} ({s['top_category']['percent']}%), months={[m['period'] for m in s['monthly']]}")

# override: re-categorize a merchant and make sure it applies to all its debits
tid = next(t["id"] for t in txns if t["merchant"] == "Ramesh Kumar")
n = store.set_category(tid, "Food", True)
assert n >= 1 and all(t["category"] == "Food" for t in store.list(q="Ramesh Kumar") if t["kind"] == "debit")
print(f"override applied to {n} transaction(s)")

# custom-range average
r = analytics.average_daily(txns, txns[0]["date"], txns[0]["date"])
print("avg-daily custom range:", r)

pdf = build_report(s, [{"title": "Test", "body": "remember to cut Swiggy", "created_at": "2026-10-01T10:00:00"}])
assert pdf[:4] == b"%PDF" and len(pdf) > 3000
out = os.path.join(sample_dir, "report.pdf")
open(out, "wb").write(pdf)
print(f"report PDF: {len(pdf):,} bytes -> {out}")
print("ALL CHECKS PASSED")
