"""A stand-in for the browser's storage, so the Python tests can play the part of the app: save what /api/parse returns,
remember category choices, and hand rows back in statement order. (The real storage is frontend/src/store.js.)"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import ingest


class MemStore:
    def __init__(self):
        self.rows = []
        self.overrides = {}
        self._next = 1

    def insert(self, parsed, bank=None, account_type=None):
        p = ingest.prepare(parsed, bank, account_type, self.overrides, [r["merchant"] for r in self.rows])
        for r in self.rows:
            r["merchant"] = p["rename"].get(r["merchant"], r["merchant"])
        self.overrides = p["overrides"]
        have = {r["uid"]: r for r in self.rows}
        added = skipped = 0
        base = max([r["seq"] for r in self.rows] or [-1]) + 1
        for t in p["transactions"]:
            if t["uid"] in have:
                skipped += 1
                if not have[t["uid"]]["account"] and t["account"]:
                    have[t["uid"]]["account"] = t["account"]
                continue
            self.rows.append({**t, "id": self._next, "seq": t["seq"]})
            self._next += 1
            added += 1
        return {"added": added, "duplicates_skipped": skipped}

    def list(self, q=None, order="file"):
        rows = [r for r in self.rows if not q or q.lower() in r["description"].lower() or q.lower() in r["merchant"].lower()]
        return rows if order == "file" else sorted(rows, key=lambda r: (r["date"], r["id"]), reverse=True)

    def analytics_rows(self):
        return [{**r, "date": date.fromisoformat(r["date"])} for r in self.rows]

    def set_category(self, tx_id, category, apply_all):
        tx = next(r for r in self.rows if r["id"] == tx_id)
        if apply_all:
            self.overrides[tx["merchant"].lower()] = category
            hit = [r for r in self.rows if r["merchant"].lower() == tx["merchant"].lower() and r["kind"] == "debit" and r["category"] != "Reversed"]
        else:
            hit = [tx]
        for r in hit:
            r["category"] = category
        return len(hit)
