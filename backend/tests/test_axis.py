"""Run: python tests/test_axis.py   (fake narrations in the shapes Axis and similar banks write)

The payee of NEFT/IMPS/RTGS/MOB narrations is the first field after the channel code and reference, never
the channel itself ('MB', 'P2A', 'TPFT').
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from memstore import MemStore
from core import categorizer as c

CASES = [
    # narration, payee, category
    ("NEFT/MB/AXOMB26402076909/SRI KENCHAMBA CERAMICS/UNION BANK OF INDIA/", "Sri Kenchamba Ceramics", "Local Shops"),
    ("IMPS/P2A/626414723490/SRIKENCHAMBACERAMIC/X000002/UNIONBANKOFINDIA/", "Srikenchambaceramic", None),
    ("IMPS/P2A/123456789012/RAMESH KUMAR/HDFC0001234/HDFC BANK LTD/", "Ramesh Kumar", "Person"),   # 'LTD' is the bank's
    ("MOB/TPFT/DINESH KUMAR R/1234567890", "Dinesh Kumar R", "Person"),
    ("RTGS/AXISR12345678/ACME TRADERS/STATE BANK OF INDIA//SBIN0001234", "Acme Traders", "Local Shops"),
    ("NEFT/AXISP00123456789/MEHTA STEELS/HDFC BANK/", "Mehta Steels", "Local Shops"),
    ("UPI/P2M/412345678901/SWIGGY/Order", "Swiggy", "Food"),
    ("GST @18% ON SERVICE CHARGES FOR SEP-26", "Bank Charges", "Bank Charges"),
    # Canara layout is unchanged
    ("UPI/DR/975205789157/KFCK261/HDFC/**21501@HDFCBANK/PAYMENT//AXL29A4C", "Kfc", "Food"),
]
for desc, payee, cat in CASES:
    assert c.merchant_name(desc) == payee, (desc, c.merchant_name(desc))
    if cat:
        assert c.categorize(desc) == cat, (desc, c.categorize(desc))
for channel in ("MB", "P2A", "TPFT", "IB"):
    assert all(c.merchant_name(d).upper() != channel for d, _, _ in CASES)
print("payee and category from structured narrations OK")

# truncated and squashed spellings fold to the fullest one; short names never merge
fold = c.fold_payees(["Srikenchambaceramic", "Sri Kenchamba Ceramics", "Priyanka", "Priyanka S", "Mb"])
assert fold["Srikenchambaceramic"] == "Sri Kenchamba Ceramics" and fold["Priyanka"] == "Priyanka" and fold["Priyanka S"] == "Priyanka S"
print("payee folding OK")

# end to end: both spellings, uploaded together, become one payee that follows your category choice
rows = [
    {"date": date(2026, 9, 21), "description": CASES[0][0], "debit": 49900.0, "credit": 0.0, "balance": 100.0},
    {"date": date(2026, 9, 22), "description": CASES[1][0], "debit": 100.0, "credit": 0.0, "balance": 0.0},
]
store = MemStore()
store.insert(rows)
saved = store.list()
assert {t["merchant"] for t in saved} == {"Sri Kenchamba Ceramics"}, {t["merchant"] for t in saved}
assert {t["category"] for t in saved} == {"Local Shops"}
store.set_category(saved[0]["id"], "Other", True)
more = [{"date": date(2026, 9, 23), "description": CASES[1][0], "debit": 5.0, "credit": 0.0, "balance": -5.0}]
store.insert(more)
assert {t["category"] for t in store.list()} == {"Other"}, "a remembered category must apply to the squashed spelling too"
print("folding in storage OK")

print("AXIS CHECKS PASSED")
