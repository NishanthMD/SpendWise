"""The old single-user SQLite storage, kept ONLY so tools/export_backup.py can turn an existing spendwise.db into a
backup file the browser app can import. The web app itself no longer stores anything on the server."""
from __future__ import annotations

import hashlib
import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from typing import Iterable, Optional

DB_PATH = os.getenv("SPENDWISE_DB", os.path.join(os.path.dirname(__file__), "spendwise.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    merchant TEXT NOT NULL,
    amount REAL NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('debit','credit')),
    category TEXT NOT NULL,
    balance REAL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS overrides (merchant TEXT PRIMARY KEY, category TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, first_date TEXT, last_date TEXT,
    bank TEXT, account_type TEXT, order_found TEXT, layout TEXT
);
CREATE TABLE IF NOT EXISTS budgets (key TEXT PRIMARY KEY, amount REAL NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('they_owe','i_owe')),
    amount REAL NOT NULL, note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, due_date TEXT,
    tx_id INTEGER, split_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, date TEXT NOT NULL, total REAL NOT NULL,
    my_share REAL NOT NULL, paid_by TEXT NOT NULL, tx_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, due_date TEXT NOT NULL,
    amount REAL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
"""


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


PAYEE_LOGIC = 2


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
        # Older databases predate statement order: add the columns that keep the bank's own row order.
        have = {r["name"] for r in c.execute("PRAGMA table_info(transactions)")}
        if "upload_id" not in have:
            c.execute("ALTER TABLE transactions ADD COLUMN upload_id INTEGER")
        if "seq" not in have:
            c.execute("ALTER TABLE transactions ADD COLUMN seq INTEGER NOT NULL DEFAULT 0")
        if "account" not in have:  # which bank account a row belongs to ("" until you say)
            c.execute("ALTER TABLE transactions ADD COLUMN account TEXT NOT NULL DEFAULT ''")
        up_have = {r["name"] for r in c.execute("PRAGMA table_info(uploads)")}
        for col in ("bank", "account_type", "order_found", "layout"):
            if col not in up_have:
                c.execute(f"ALTER TABLE uploads ADD COLUMN {col} TEXT")
        # Payee reading improved (Axis-style NEFT/IMPS/RTGS narrations): re-read saved narrations once.
        row = c.execute("SELECT value FROM meta WHERE key='payee_logic'").fetchone()
        if not row or int(row["value"]) < PAYEE_LOGIC:
            rebuild_merchants(c)
            c.execute("INSERT INTO meta(key, value) VALUES('payee_logic', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(PAYEE_LOGIC),))


def _uid(row: dict, occurrence: int) -> str:
    raw = f"{row['date']}|{row['description']}|{row['debit']}|{row['credit']}|{row['balance']}|{occurrence}"
    return hashlib.sha1(raw.encode()).hexdigest()


def get_overrides() -> dict:
    with conn() as c:
        return {r["merchant"]: r["category"] for r in c.execute("SELECT * FROM overrides")}


def _rename_merchants(c, mapping: dict) -> None:
    for old, new in mapping.items():
        if old != new:
            c.execute("UPDATE transactions SET merchant=? WHERE merchant=?", (new, old))
            c.execute("UPDATE OR REPLACE overrides SET merchant=? WHERE merchant=?", (new.lower(), old.lower()))


def rebuild_merchants(c) -> None:
    """Re-derive every payee from its saved narration, fold truncated spellings together, and refile the
    payments whose payee changed. Categories you chose yourself stay where they are for unchanged payees."""
    from core import categorizer

    overrides = {r["merchant"]: r["category"] for r in c.execute("SELECT * FROM overrides")}
    rows = c.execute("SELECT id, description, merchant, category, kind FROM transactions").fetchall()
    fresh = {r["id"]: categorizer.merchant_name(r["description"]) for r in rows}
    fold = categorizer.fold_payees(fresh.values())
    for r in rows:
        name = fold[fresh[r["id"]]]
        if name == r["merchant"]:
            continue
        category = r["category"]
        if r["kind"] == "debit" and category != "Reversed":
            category = categorizer.categorize(r["description"], False, overrides, name)
        c.execute("UPDATE transactions SET merchant=?, category=? WHERE id=?", (name, category, r["id"]))


def insert_transactions(rows: list[dict], categorize, merchant_name, bank: Optional[str] = None, account_type: Optional[str] = None,
                        order_found: Optional[str] = None, layout: Optional[str] = None) -> dict:
    """Insert parsed rows, skipping duplicates (re-uploading the same statement is safe).

    Every row keeps its position in the statement (`seq`) because the running balance only reconciles
    in the bank's own order, which is not always date order.
    """
    overrides = get_overrides()
    added = skipped = 0
    seen: dict[str, int] = {}
    # A reversal (UPI/REV/<ref>) cancels the failed payment that shares its reference number.
    # Both rows are tagged "Reversed" so neither counts as spending or income.
    reversed_refs = {r["ref"] for r in rows if r.get("is_reversal") and r.get("ref")}
    from core.categorizer import fold_payees

    with conn() as c:
        # Fold this statement's payee spellings together with the ones already saved.
        names = {r["description"]: merchant_name(r["description"]) for r in rows}
        saved = [x["merchant"] for x in c.execute("SELECT DISTINCT merchant FROM transactions")]
        fold = fold_payees(list(names.values()) + saved)
        _rename_merchants(c, {n: fold[n] for n in saved})
        account = f"{bank}|{account_type or 'savings'}" if bank else ""
        upload_id = c.execute("INSERT INTO uploads(created_at, bank, account_type, order_found, layout) VALUES(?,?,?,?,?)",
                              (now(), bank, account_type, order_found, layout)).lastrowid
        for seq, r in enumerate(rows):
            key = f"{r['date']}|{r['description']}|{r['debit']}|{r['credit']}|{r['balance']}"
            seen[key] = seen.get(key, 0) + 1
            is_credit = r["credit"] > 0 and r["debit"] == 0
            amount = r["credit"] if is_credit else r["debit"]
            if r.get("is_reversal") or (r.get("ref") in reversed_refs):
                category = "Reversed"
            else:
                category = categorize(r["description"], is_credit, overrides, fold[names[r["description"]]])
            cur = c.execute(
                "INSERT OR IGNORE INTO transactions (uid,date,description,merchant,amount,kind,category,balance,upload_id,seq,account) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (_uid(r, seen[key]), r["date"].isoformat(), r["description"], fold[names[r["description"]]], amount,
                 "credit" if is_credit else "debit", category, r["balance"], upload_id, seq, account),
            )
            if not cur.rowcount and account:  # already saved: it only needs to learn which account it is from
                c.execute("UPDATE transactions SET account=? WHERE uid=? AND account=''", (account, _uid(r, seen[key])))
            added += cur.rowcount
            skipped += 1 - cur.rowcount
        if added:
            c.execute("UPDATE uploads SET first_date=(SELECT MIN(date) FROM transactions WHERE upload_id=?), "
                      "last_date=(SELECT MAX(date) FROM transactions WHERE upload_id=?) WHERE id=?", (upload_id, upload_id, upload_id))
        else:
            c.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
    return {"added": added, "duplicates_skipped": skipped}


FILE_ORDER = "COALESCE(u.first_date, t.date), COALESCE(t.upload_id, 0), t.seq, t.id"


def list_transactions(start: Optional[str] = None, end: Optional[str] = None, category: Optional[str] = None,
                      q: Optional[str] = None, limit: int = 1000, order: str = "recent", account: Optional[str] = None) -> list[dict]:
    """order="recent": newest first. order="file": the statement's own order (what a passbook shows)."""
    sql = "SELECT t.* FROM transactions t LEFT JOIN uploads u ON u.id = t.upload_id WHERE 1=1"
    args: list = []
    if start:
        sql += " AND t.date >= ?"; args.append(start)
    if end:
        sql += " AND t.date <= ?"; args.append(end)
    if category:
        sql += " AND t.category = ?"; args.append(category)
    if q:
        sql += " AND (t.description LIKE ? OR t.merchant LIKE ?)"; args += [f"%{q}%", f"%{q}%"]
    if account is not None:
        sql += " AND t.account = ?"; args.append(account)
    sql += f" ORDER BY {FILE_ORDER}" if order == "file" else " ORDER BY t.date DESC, t.id DESC"
    sql += " LIMIT ?"
    args.append(limit)
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args)]


def as_analytics_rows(rows: Iterable[dict]) -> list[dict]:
    return [{**r, "date": date.fromisoformat(r["date"])} for r in rows]


def list_accounts() -> list[dict]:
    """Each bank account you have uploaded (plus rows not yet assigned), with its date span and count."""
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT account, COUNT(*) AS count, MIN(date) AS first_date, MAX(date) AS last_date FROM transactions GROUP BY account ORDER BY account")]


def assign_account(from_account: str, to_account: str) -> int:
    with conn() as c:
        return c.execute("UPDATE transactions SET account=? WHERE account=?", (to_account, from_account)).rowcount


def last_upload_for(account: str) -> Optional[dict]:
    bank, _, kind = account.partition("|")
    with conn() as c:
        row = c.execute("SELECT * FROM uploads WHERE bank=? AND COALESCE(account_type,'savings')=? ORDER BY id DESC LIMIT 1", (bank, kind)).fetchone()
        return dict(row) if row else None


def get_transaction(tx_id: int) -> Optional[dict]:
    with conn() as c:
        row = c.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
        return dict(row) if row else None


def set_category(tx_id: int, category: str, apply_to_merchant: bool) -> int:
    with conn() as c:
        row = c.execute("SELECT merchant FROM transactions WHERE id=?", (tx_id,)).fetchone()
        if not row:
            return 0
        if apply_to_merchant:
            c.execute("INSERT INTO overrides(merchant,category) VALUES(?,?) ON CONFLICT(merchant) DO UPDATE SET category=excluded.category",
                      (row["merchant"].lower(), category))
            cur = c.execute("UPDATE transactions SET category=? WHERE lower(merchant)=? AND kind='debit' AND category!='Reversed'",
                            (category, row["merchant"].lower()))
            return cur.rowcount
        return c.execute("UPDATE transactions SET category=? WHERE id=?", (category, tx_id)).rowcount


def clear_transactions() -> None:
    with conn() as c:
        c.execute("DELETE FROM transactions")
        c.execute("DELETE FROM uploads")


def reset_all(include_notes: bool = False) -> dict:
    with conn() as c:
        gone = {"transactions": c.execute("DELETE FROM transactions").rowcount}
        for table in ("uploads", "overrides", "budgets"):
            gone[table] = c.execute(f"DELETE FROM {table}").rowcount
        if include_notes:
            gone["notes"] = c.execute("DELETE FROM notes").rowcount
            gone["reminders"] = c.execute("DELETE FROM reminders").rowcount
            for table in ("ledger", "ledger_payments", "splits"):
                gone[table] = c.execute(f"DELETE FROM {table}").rowcount
        c.execute("DELETE FROM sqlite_sequence WHERE name IN ('transactions','uploads')")
    return gone


# ---- budgets --------------------------------------------------------------
def get_budgets() -> dict:
    """{"overall": float|None, "savings_goal": float|None, "categories": {name: monthly amount}}"""
    out: dict = {"overall": None, "savings_goal": None, "categories": {}}
    with conn() as c:
        for r in c.execute("SELECT key, amount FROM budgets ORDER BY key"):
            if r["key"] in ("overall", "savings_goal"):
                out[r["key"]] = r["amount"]
            elif r["key"].startswith("cat:"):
                out["categories"][r["key"][4:]] = r["amount"]
    return out


def set_budget(key: str, amount: Optional[float]) -> None:
    """A missing or zero amount removes the budget."""
    with conn() as c:
        if amount:
            c.execute("INSERT INTO budgets(key, amount) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET amount=excluded.amount", (key, amount))
        else:
            c.execute("DELETE FROM budgets WHERE key=?", (key,))


# ---- notes ----------------------------------------------------------------
def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def add_note(title: str, body: str) -> int:
    with conn() as c:
        return c.execute("INSERT INTO notes(title,body,created_at) VALUES(?,?,?)", (title, body, now())).lastrowid


def list_notes() -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM notes ORDER BY id DESC")]


def update_note(note_id: int, title: str, body: str) -> int:
    with conn() as c:
        return c.execute("UPDATE notes SET title=?, body=? WHERE id=?", (title, body, note_id)).rowcount


def delete_note(note_id: int) -> int:
    with conn() as c:
        return c.execute("DELETE FROM notes WHERE id=?", (note_id,)).rowcount


# ---- reminders ------------------------------------------------------------
def add_reminder(title: str, due_date: str, amount: Optional[float]) -> int:
    with conn() as c:
        return c.execute("INSERT INTO reminders(title,due_date,amount,created_at) VALUES(?,?,?,?)", (title, due_date, amount, now())).lastrowid


def list_reminders() -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM reminders ORDER BY done, due_date")]


def set_reminder_done(rid: int, done: bool) -> int:
    with conn() as c:
        return c.execute("UPDATE reminders SET done=? WHERE id=?", (1 if done else 0, rid)).rowcount


def delete_reminder(rid: int) -> int:
    with conn() as c:
        return c.execute("DELETE FROM reminders WHERE id=?", (rid,)).rowcount


# ---- owed money and split bills -------------------------------------------
def person_key(name: str) -> str:
    return " ".join(name.split()).title() if name.islower() or name.isupper() else " ".join(name.split())


def add_ledger(person: str, direction: str, amount: float, note: str, on: str, due: Optional[str],
               tx_id: Optional[int] = None, split_id: Optional[int] = None) -> int:
    with conn() as c:
        return c.execute(
            "INSERT INTO ledger(person,direction,amount,note,date,due_date,tx_id,split_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (person_key(person), direction, amount, note, on, due, tx_id, split_id, now())).lastrowid


def add_split(title: str, on: str, total: float, my_share: float, paid_by: str, tx_id: Optional[int],
              owes: list[tuple[str, float]], due: Optional[str]) -> dict:
    """Record a shared bill. If you paid, each friend owes you their share; if a friend paid, you owe them yours."""
    with conn() as c:
        sid = c.execute("INSERT INTO splits(title,date,total,my_share,paid_by,tx_id,created_at) VALUES(?,?,?,?,?,?,?)",
                        (title, on, total, my_share, paid_by, tx_id, now())).lastrowid
    ids = []
    if paid_by == "me":
        for name, share in owes:
            ids.append(add_ledger(name, "they_owe", share, title, on, due, tx_id, sid))
    elif my_share > 0:
        ids.append(add_ledger(paid_by, "i_owe", my_share, title, on, due, tx_id, sid))
    return {"split_id": sid, "entries": ids}


def list_ledger() -> list[dict]:
    with conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM ledger ORDER BY date DESC, id DESC")]
        pays: dict[int, list] = {}
        for p in c.execute("SELECT * FROM ledger_payments ORDER BY date, id"):
            pays.setdefault(p["ledger_id"], []).append(dict(p))
    for r in rows:
        r["payments"] = pays.get(r["id"], [])
        r["paid"] = round(sum(p["amount"] for p in r["payments"]), 2)
        r["remaining"] = round(r["amount"] - r["paid"], 2)
    return rows


def get_ledger(lid: int) -> Optional[dict]:
    return next((r for r in list_ledger() if r["id"] == lid), None)


def add_payment(lid: int, amount: float, on: str) -> None:
    with conn() as c:
        c.execute("INSERT INTO ledger_payments(ledger_id,amount,date) VALUES(?,?,?)", (lid, amount, on))


def delete_ledger(lid: int) -> int:
    with conn() as c:
        c.execute("DELETE FROM ledger_payments WHERE ledger_id=?", (lid,))
        return c.execute("DELETE FROM ledger WHERE id=?", (lid,)).rowcount
