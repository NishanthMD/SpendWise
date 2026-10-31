"""Run: python tests/test_analytics.py   (pure Python, no PDF or database needed)

Checks the framework-free analytics on hand-made transactions: statement order vs date order, the balance
series, reversals, no-spend streaks, clipping to the days a statement covers, and budget status.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import analytics


def tx(d, kind, amount, balance, category="Food", merchant="Shop"):
    return {"date": date.fromisoformat(d), "kind": kind, "amount": amount, "balance": balance, "category": category, "merchant": merchant}


# Statement order: the 4 Oct entry posted late, after the 5 Oct one, so file order is not date order.
rows = [
    tx("2026-10-01", "credit", 1000.0, 11000.0, "Income", "Salary"),     # opening was 10,000
    tx("2026-10-02", "debit", 200.0, 10800.0, "Food", "Swiggy"),
    tx("2026-10-05", "debit", 300.0, 10500.0, "Groceries", "Blinkit"),
    tx("2026-10-04", "debit", 100.0, 10400.0, "Food", "Zomato"),         # late posting
    tx("2026-10-06", "debit", 500.0, 9900.0, "Reversed", "Amazon"),      # failed payment ...
    tx("2026-10-06", "credit", 500.0, 10400.0, "Reversed", "Amazon"),    # ... and its refund
]

s = analytics.summarize(rows)
assert s["start"] == "2026-10-01" and s["end"] == "2026-10-06" and s["days"] == 6
assert s["total_spent"] == 600.0 and s["total_income"] == 1000.0 and s["net"] == 400.0, "the reversed pair must not count"
assert s["transactions"] == 4 and s["reversed_entries"] == 2
assert s["opening_balance"] == 10000.0 and s["closing_balance"] == 10400.0
by = {d["date"]: d for d in s["daily"]}
assert by["2026-10-01"]["balance"] == 11000.0 and by["2026-10-02"]["balance"] == 10800.0
assert by["2026-10-04"]["balance"] == 10700.0, "balance is rebuilt by date, so the late entry lands on its own day"
assert by["2026-10-05"]["balance"] == 10400.0 and by["2026-10-06"]["balance"] == 10400.0
assert by["2026-10-02"]["by_category"] == {"Food": 200.0} and by["2026-10-02"]["largest"]["merchant"] == "Swiggy"
assert by["2026-10-03"]["count"] == 0 and by["2026-10-03"]["amount"] == 0
assert abs(s["savings_rate"] - 0.4) < 1e-9
print("summary, reversals and balance series OK")

# no-spend streak: 3 and 6 Oct have no spending (the 6 Oct payment was reversed), so the run is 6 Oct only... plus 3 Oct, 1 Oct
ns = s["no_spend"]
assert ns["best"] == 1 and ns["current"] == 1 and ns["days"] == 3 and ns["as_of"] == "2026-10-06", ns
print("no-spend streak OK:", ns)

# weekly/monthly buckets carry range, count, balance, and category split
assert s["monthly"][0]["start"] == "2026-10-01" and s["monthly"][0]["end"] == "2026-10-06" and s["monthly"][0]["balance"] == 10400.0
assert s["monthly"][0]["by_category"]["Food"] == 300.0 and s["weekly"][0]["period"] == "2026-09-28" and s["weekly"][0]["start"] == "2026-10-01"
print("weekly and monthly buckets OK")

# a request wider than the statement is clipped to the days it covers
w = analytics.average_daily(rows, date(2026, 1, 1), date(2026, 12, 31))
assert w["days"] == 6 and w["requested_days"] == 365 and w["note"] and abs(w["avg_daily_spend"] - 100.0) < 1e-9, w
assert analytics.average_daily(rows, date(2027, 1, 1), date(2027, 1, 5))["days"] == 0
one = analytics.average_daily(rows, date(2026, 10, 2), date(2026, 10, 2))
assert one["days"] == 1 and one["avg_daily_spend"] == 200.0 and one["note"] is None
print("average-daily clipping OK")

# month filter
m = analytics.summarize(rows, date(2026, 10, 2), date(2026, 10, 4))
assert m["total_spent"] == 300.0 and m["opening_balance"] == 11000.0 and m["closing_balance"] == 10700.0
print("custom range OK")

# budgets: the rings describe the latest month in view
b = analytics.budget_status(s, {"overall": 1200.0, "savings_goal": 300.0, "categories": {"Food": 250.0, "Transport": 100.0}})
assert b["month"] == "2026-10" and b["overall"]["ratio"] == 0.5 and b["overall"]["monthly"] == 1200.0
food = next(c for c in b["categories"] if c["category"] == "Food")
assert food["spent"] == 300.0 and food["ratio"] == 1.2, "over 100% is kept so the ring can start a second lap"
assert next(c for c in b["categories"] if c["category"] == "Transport")["ratio"] == 0.0
assert b["savings_goal"]["saved"] == 400.0 and b["savings_goal"]["ratio"] > 1
assert analytics.budget_status(s, {"overall": None, "categories": {}, "savings_goal": None})["overall"] is None
print("budget status OK")

# no balance column: charts degrade, nothing crashes
nb = analytics.summarize([{**r, "balance": None} for r in rows])
assert nb["closing_balance"] is None and nb["daily"][0]["balance"] is None and nb["total_spent"] == 600.0
print("statements without balances OK")

# empty and out-of-range
assert analytics.summarize([]) == {"empty": True}
assert analytics.summarize(rows, date(2030, 1, 1), None) == {"empty": True}

print("ANALYTICS CHECKS PASSED")
