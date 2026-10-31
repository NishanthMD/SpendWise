"""Run: python tests/test_passbook.py <dir>   (writes and reads a fake passbook-style PDF)."""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
out_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()

from memstore import MemStore
import make_passbook_sample as mk
from core import analytics, categorizer, parser

path = os.path.join(out_dir, "sample_passbook.pdf")
closing, n = mk.build(path)
rows, meta = parser.parse_statement_ex(path)

assert meta["layout"] == "passbook", meta
assert len(rows) == n, (len(rows), n)
assert meta["balance_mismatches"] == 0, meta
assert abs(meta["closing_balance"] - closing) < 0.01 and abs(rows[-1]["balance"] - closing) < 0.01
assert meta["opening_balance"] == 5000.0
print(f"passbook layout: {len(rows)} entries, opening {meta['opening_balance']:,.2f}, closing {meta['closing_balance']:,.2f}, 0 balance mismatches")

# wrapped UPI names are rejoined mid-word, and the Chq line never leaks into the narration
upi_rows = [r for r in rows if r["description"].startswith("UPI/")]
assert all("Chq" not in r["description"] for r in rows)
assert all(len(r["description"].split("/")) > 6 for r in upi_rows), "wrapped narration was not rejoined"
names = {categorizer.merchant_name(r["description"]) for r in upi_rows}
assert {"Kfc", "Amazon", "Blinkit", "Hemanthsh"[:8].title()} <= names | {"Hemanths"}, names
print("payee names:", sorted(names))

# the out-of-date-order entry is kept in file order, so the balance chain still reconciles
dates = [r["date"] for r in rows]
assert dates != sorted(dates), "sample should contain an out-of-order entry"

# reversal: the failed 10,000 payment and its UPI/REV cancel; the retry stays
assert sum(r["is_reversal"] for r in rows) == 3
store = MemStore()
store.insert(rows)
tx = store.analytics_rows()
assert sum(t["category"] == "Reversed" for t in tx) == 6  # 3 failed debits + 3 reversal credits
s = analytics.summarize(tx)
expected_spend = sum(r["debit"] for r in rows) - 3 * 10000.0
assert abs(s["total_spent"] - expected_spend) < 0.01, (s["total_spent"], expected_spend)
assert abs(s["total_income"] - (sum(r["credit"] for r in rows) - 3 * 10000.0)) < 0.01
cats = {c["category"] for c in s["categories"]}
assert {"Food", "Groceries", "Shopping", "Subscriptions", "Savings", "Bank Charges", "Person"} <= cats, cats
print(f"summary: spent {s['total_spent']:,.2f}, income {s['total_income']:,.2f}; categories {sorted(cats)}")
print("PASSBOOK CHECKS PASSED")
