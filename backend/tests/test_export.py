"""Run: python tests/test_export.py   (the old database -> backup file; also the old one-time payee re-read)"""
import os
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tools"))
os.environ["SPENDWISE_DB"] = os.path.join(tempfile.mkdtemp(), "old.db")
import legacy_db as db
import export_backup
from core import categorizer as c

db.init()
rows = [
    {"date": date(2026, 9, 21), "description": "NEFT/MB/AXOMB26402076909/SRI KENCHAMBA CERAMICS/UNION BANK OF INDIA/", "debit": 499.0, "credit": 0.0, "balance": 100.0},
    {"date": date(2026, 9, 22), "description": "IMPS/P2A/626414723490/SRIKENCHAMBACERAMIC/X000002/UNIONBANKOFINDIA/", "debit": 100.0, "credit": 0.0, "balance": 0.0},
]
db.insert_transactions(rows, c.categorize, c.merchant_name, "axis", "current", "oldest_first", "table")
db.add_note("n", "body")
db.add_reminder("r", "2026-10-10", 5.0)
db.set_budget("overall", 1000)
lid = db.add_ledger("Asha", "they_owe", 300, "dinner", "2026-10-01", None)
db.add_payment(lid, 100, "2026-10-02")

data = export_backup.export()
assert data["app"] == "spendwise" and data["version"] == 1
assert len(data["transactions"]) == 2 and len(data["uploads"]) == 1 and len(data["notes"]) == 1 and len(data["reminders"]) == 1
assert len(data["ledger"]) == 1 and len(data["payments"]) == 1 and data["budgets"]["overall"] == 1000
assert {t["merchant"] for t in data["transactions"]} == {"Sri Kenchamba Ceramics"}
assert {"id", "uid", "date", "merchant", "amount", "kind", "category", "balance", "upload_id", "seq", "account"} <= set(data["transactions"][0])
print("export OK")

# a database saved by the older reader is re-read once, on start-up
with db.conn() as k:
    k.execute("UPDATE transactions SET merchant='Mb'")
    k.execute("DELETE FROM meta")
db.init()
assert {t["merchant"] for t in db.list_transactions()} == {"Sri Kenchamba Ceramics"}
print("one-time re-read of saved narrations OK")
print("EXPORT CHECKS PASSED")
