"""Pure-Python analytics over a list of transaction dicts.

Each transaction: {date: date, amount: float, kind: 'debit'|'credit',
category: str, merchant: str, balance: float|None}

Pass transactions in the statement's own (file) order: the balance series is
rebuilt from the opening balance, and a late-posted entry only reconciles in
that order. "Reversed" rows (a failed payment and its refund) cancel out, so
they are left out of spending and income but still move the balance.
"""
from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable, Optional

NO_SPEND_TARGET_DAYS = 7
AVG_MONTH_DAYS = 30.4375


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())  # Monday


def filter_range(txns: Iterable[dict], start: Optional[date], end: Optional[date]) -> list[dict]:
    return [t for t in txns if (not start or t["date"] >= start) and (not end or t["date"] <= end)]


def _signed(t: dict) -> float:
    return t["amount"] if t["kind"] == "credit" else -t["amount"]


def _bucket() -> dict:
    return {"total": 0.0, "count": 0, "income": 0.0, "cats": defaultdict(float), "largest": None}


def _add_spend(b: dict, t: dict) -> None:
    b["total"] += t["amount"]
    b["count"] += 1
    b["cats"][t["category"]] += t["amount"]
    if b["largest"] is None or t["amount"] > b["largest"]["amount"]:
        b["largest"] = {"merchant": t["merchant"], "amount": t["amount"], "category": t["category"]}


def _pack_bucket(b: dict, **extra) -> dict:
    return {
        **extra,
        "total": round(b["total"], 2), "count": b["count"], "income": round(b["income"], 2),
        "by_category": {c: round(a, 2) for c, a in sorted(b["cats"].items(), key=lambda kv: -kv[1])},
        "largest": b["largest"],
    }


def _balance_by_day(all_txns: list[dict], first: date, last: date) -> tuple[dict, Optional[float]]:
    """End-of-day balance for every day in [first, last], plus the balance at the start of `first`.

    Built from the opening balance and every entry dated up to that day, so it does not depend on
    how the bank ordered late-posted entries. Returns ({}, None) when the file carries no balances.
    """
    head = all_txns[0]
    if head.get("balance") is None or any(t.get("balance") is None for t in all_txns):
        return {}, None
    running = round(head["balance"] - _signed(head), 2)  # balance before the first entry in the file
    by_date: dict[date, float] = defaultdict(float)
    for t in all_txns:
        by_date[t["date"]] += _signed(t)
    before = sorted(d for d in by_date if d < first)
    for d in before:
        running += by_date[d]
    opening = round(running, 2)
    out, day = {}, first
    while day <= last:
        running += by_date.get(day, 0.0)
        out[day] = round(running, 2)
        day += timedelta(days=1)
    return out, opening


def summarize(txns: list[dict], start: Optional[date] = None, end: Optional[date] = None) -> dict:
    all_txns = list(txns)
    if not all_txns:
        return {"empty": True}
    cov_start, cov_end = min(t["date"] for t in all_txns), max(t["date"] for t in all_txns)
    # The statement can only speak for the days it covers, so a wider request is clipped to them.
    first = max(start, cov_start) if start else cov_start
    last = min(end, cov_end) if end else cov_end
    if first > last or not any(first <= t["date"] <= last for t in all_txns):
        return {"empty": True}
    days = (last - first).days + 1

    in_range = [t for t in all_txns if first <= t["date"] <= last]
    counted = [t for t in in_range if t["category"] != "Reversed"]
    spend = [t for t in counted if t["kind"] == "debit"]
    income = [t for t in counted if t["kind"] == "credit"]
    total_spent = round(sum(t["amount"] for t in spend), 2)
    total_income = round(sum(t["amount"] for t in income), 2)

    balances, opening_balance = _balance_by_day(all_txns, first, last)

    by_cat: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    by_merchant: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0, "category": ""})
    daily: dict[date, dict] = defaultdict(_bucket)
    weekly: dict[date, dict] = defaultdict(_bucket)
    monthly: dict[str, dict] = defaultdict(_bucket)

    for t in spend:
        c = by_cat[t["category"]]
        c["amount"] += t["amount"]
        c["count"] += 1
        m = by_merchant[t["merchant"]]
        m["amount"] += t["amount"]
        m["count"] += 1
        m["category"] = t["category"]
        _add_spend(daily[t["date"]], t)
        _add_spend(weekly[_week_start(t["date"])], t)
        _add_spend(monthly[t["date"].strftime("%Y-%m")], t)
    for t in income:
        daily[t["date"]]["income"] += t["amount"]
        weekly[_week_start(t["date"])]["income"] += t["amount"]
        monthly[t["date"].strftime("%Y-%m")]["income"] += t["amount"]

    categories = sorted(
        ({"category": k, "amount": round(v["amount"], 2), "count": v["count"],
          "percent": round(100 * v["amount"] / total_spent, 1) if total_spent else 0.0} for k, v in by_cat.items()),
        key=lambda x: -x["amount"],
    )
    merchants = sorted(
        ({"merchant": k, "amount": round(v["amount"], 2), "count": v["count"], "category": v["category"]} for k, v in by_merchant.items()),
        key=lambda x: -x["amount"],
    )[:10]

    def bal(d: date) -> Optional[float]:
        return balances.get(d)

    # Daily series, zero-filled so charts have no gaps and every day carries its balance.
    daily_series, d = [], first
    while d <= last:
        b = daily.get(d) or _bucket()
        daily_series.append(_pack_bucket(b, date=d.isoformat(), amount=round(b["total"], 2), balance=bal(d)))
        d += timedelta(days=1)

    weekly_series = []
    for k in sorted(weekly):
        s, e = max(k, first), min(k + timedelta(days=6), last)
        weekly_series.append(_pack_bucket(weekly[k], period=k.isoformat(), start=s.isoformat(), end=e.isoformat(), balance=bal(e)))
    monthly_series = []
    for k in sorted(monthly):
        y, m = map(int, k.split("-"))
        s, e = max(date(y, m, 1), first), min(date(y, m, monthrange(y, m)[1]), last)
        monthly_series.append(_pack_bucket(monthly[k], period=k, start=s.isoformat(), end=e.isoformat(), balance=bal(e)))

    top_day = max(((d, b) for d, b in daily.items() if b["total"] > 0), key=lambda kv: kv[1]["total"], default=None)
    largest = max(spend, key=lambda t: t["amount"]) if spend else None

    # No-spend streak: counted up to the last day the statement actually has an entry in this range.
    as_of = max(t["date"] for t in in_range)
    spend_days = {t["date"] for t in spend}
    best = run = 0
    zero_days, day = 0, first
    while day <= as_of:
        if day in spend_days:
            run = 0
        else:
            run += 1
            zero_days += 1
            best = max(best, run)
        day += timedelta(days=1)
    recent_from = max(first, last - timedelta(days=6))
    recent_total = sum(t["amount"] for t in spend if t["date"] >= recent_from)
    recent_days = (last - recent_from).days + 1

    return {
        "empty": False,
        "start": first.isoformat(), "end": last.isoformat(), "days": days,
        "total_spent": total_spent,
        "total_income": total_income,
        "net": round(total_income - total_spent, 2),
        "savings_rate": round((total_income - total_spent) / total_income, 4) if total_income else None,
        "avg_daily_spend": round(total_spent / days, 2),
        "recent_avg_daily_spend": round(recent_total / recent_days, 2),
        "avg_per_transaction": round(total_spent / len(spend), 2) if spend else 0.0,
        "transactions": len(counted),
        "reversed_entries": len(in_range) - len(counted),
        "top_category": categories[0] if categories else None,
        "categories": categories,
        "top_merchants": merchants,
        "weekly": weekly_series,
        "monthly": monthly_series,
        "daily": daily_series,
        "highest_spend_day": {"date": top_day[0].isoformat(), "amount": round(top_day[1]["total"], 2), "count": top_day[1]["count"]} if top_day else None,
        "largest_transaction": {"date": largest["date"].isoformat(), "merchant": largest["merchant"], "amount": largest["amount"], "category": largest["category"]} if largest else None,
        "opening_balance": opening_balance,
        "closing_balance": bal(last),
        "no_spend": {
            "current": run, "best": best, "days": zero_days, "target": NO_SPEND_TARGET_DAYS,
            "as_of": as_of.isoformat(),
        },
    }


def average_daily(txns: list[dict], start: date, end: date) -> dict:
    """Average daily expenditure calculator for an arbitrary custom range.

    Days outside the statement are not counted (nothing is known about them), and the result says so.
    """
    requested = (end - start).days + 1
    s = summarize(txns, start, end)
    if s.get("empty"):
        return {"days": 0, "requested_days": requested, "total_spent": 0.0, "avg_daily_spend": 0.0, "payments": 0,
                "note": "Your statement has no entries between these dates."}
    note = None
    if s["days"] < requested:
        note = f"Your statement covers {s['start']} to {s['end']}, so the average uses those {s['days']} days."
    return {"days": s["days"], "requested_days": requested, "total_spent": s["total_spent"],
            "avg_daily_spend": s["avg_daily_spend"], "payments": sum(c["count"] for c in s["categories"]),
            "top_category": s["top_category"], "note": note}


def budget_status(s: dict, budgets: dict) -> dict:
    """How the period stands against monthly budgets.

    Budgets are monthly, so the budget rings describe the latest month in view (the whole month when a
    month is selected). The daily-pace ring compares the period's average day with the daily budget.
    """
    if s.get("empty"):
        return {}
    month = s["end"][:7]
    cur = next((m for m in s["monthly"] if m["period"] == month), None)
    y, m = map(int, month.split("-"))
    dim = monthrange(y, m)[1]
    in_one_month = s["start"][:7] == month
    month_spent = cur["total"] if cur else 0.0
    month_income = cur["income"] if cur else 0.0

    out: dict = {"month": month, "month_spent": month_spent, "month_net": round(month_income - month_spent, 2),
                 "overall": None, "categories": [], "savings_goal": None}
    overall = budgets.get("overall")
    if overall:
        daily_budget = overall / (dim if in_one_month else AVG_MONTH_DAYS)
        out["overall"] = {
            "monthly": overall, "spent": month_spent, "ratio": round(month_spent / overall, 4),
            "daily_budget": round(daily_budget, 2), "avg_daily": s["avg_daily_spend"],
            "pace_ratio": round(s["avg_daily_spend"] / daily_budget, 4),
        }
    for cat, amount in sorted((budgets.get("categories") or {}).items()):
        spent = (cur["by_category"].get(cat, 0.0) if cur else 0.0)
        out["categories"].append({"category": cat, "monthly": amount, "spent": round(spent, 2), "ratio": round(spent / amount, 4)})
    goal = budgets.get("savings_goal")
    if goal:
        saved = out["month_net"]
        out["savings_goal"] = {"monthly": goal, "saved": saved, "ratio": round(max(saved, 0.0) / goal, 4)}
    return out
