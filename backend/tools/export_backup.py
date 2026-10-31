"""Turn an old single-user spendwise.db into a backup file the website can import (Restore backup).

    python tools/export_backup.py [path/to/spendwise.db] [out.json]

Prints only counts, never what is in your transactions. The backup is plain JSON on your own disk: keep it private.
"""
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

if len(sys.argv) > 1:
    os.environ["SPENDWISE_DB"] = sys.argv[1]
import legacy_db as db  # noqa: E402


def export() -> dict:
    db.init()
    with db.conn() as c:
        rows = lambda sql: [dict(r) for r in c.execute(sql)]
        return {
            "app": "spendwise", "version": 1, "exported_at": datetime.now().isoformat(timespec="seconds"),
            "uploads": rows("SELECT * FROM uploads ORDER BY id"),
            "transactions": rows("SELECT * FROM transactions ORDER BY id"),
            "overrides": {r["merchant"]: r["category"] for r in c.execute("SELECT * FROM overrides")},
            "budgets": db.get_budgets(),
            "notes": rows("SELECT * FROM notes ORDER BY id"),
            "reminders": rows("SELECT * FROM reminders ORDER BY id"),
            "ledger": rows("SELECT * FROM ledger ORDER BY id"),
            "payments": rows("SELECT * FROM ledger_payments ORDER BY id"),
            "splits": rows("SELECT * FROM splits ORDER BY id"),
        }


if __name__ == "__main__":
    out = sys.argv[2] if len(sys.argv) > 2 else "spendwise-backup.json"
    data = export()
    with open(out, "w") as f:
        json.dump(data, f)
    print(f"wrote {out}: " + ", ".join(f"{len(v)} {k}" for k, v in data.items() if isinstance(v, list)))
