"""Turn freshly parsed statement rows into the transactions the browser stores.

The server keeps nothing: this is a pure function. The browser sends what it already knows (its remembered category
choices and the payee names it has saved) and gets back the new rows plus any payee renames to apply to what it holds.
"""
from __future__ import annotations

import hashlib
from typing import Iterable, Optional

from . import categorizer


def uid(row: dict, occurrence: int) -> str:
    raw = f"{row['date']}|{row['description']}|{row['debit']}|{row['credit']}|{row['balance']}|{occurrence}"
    return hashlib.sha1(raw.encode()).hexdigest()


def prepare(rows: list[dict], bank: Optional[str], account_type: Optional[str], overrides: Optional[dict] = None,
            saved_merchants: Iterable[str] = ()) -> dict:
    """Returns {"transactions": [...], "rename": {old payee: new payee}, "overrides": {...renamed...}}.

    Every row keeps its position in the statement (`seq`), because the running balance only reconciles in the bank's
    own order. A reversal (UPI/REV/<ref>) and the failed payment that shares its reference are both tagged "Reversed"
    so neither counts as spending or income. Payee spellings are folded together with the ones already saved.
    """
    saved = list(saved_merchants)
    names = {r["description"]: categorizer.merchant_name(r["description"]) for r in rows}
    fold = categorizer.fold_payees(list(names.values()) + saved)
    rename = {n: fold[n] for n in dict.fromkeys(saved) if fold.get(n, n) != n}
    # category choices follow a renamed payee
    ov = {}
    for key, cat in (overrides or {}).items():
        new = next((v.lower() for k, v in rename.items() if k.lower() == key.lower()), key.lower())
        ov[new] = cat
    reversed_refs = {r["ref"] for r in rows if r.get("is_reversal") and r.get("ref")}
    account = f"{bank}|{account_type or 'savings'}" if bank else ""
    seen: dict[str, int] = {}
    out = []
    for seq, r in enumerate(rows):
        key = f"{r['date']}|{r['description']}|{r['debit']}|{r['credit']}|{r['balance']}"
        seen[key] = seen.get(key, 0) + 1
        is_credit = r["credit"] > 0 and r["debit"] == 0
        merchant = fold[names[r["description"]]]
        if r.get("is_reversal") or (r.get("ref") in reversed_refs):
            category = "Reversed"
        else:
            category = categorizer.categorize(r["description"], is_credit, ov, merchant)
        out.append({
            "uid": uid(r, seen[key]), "date": r["date"].isoformat(), "description": r["description"], "merchant": merchant,
            "amount": r["credit"] if is_credit else r["debit"], "kind": "credit" if is_credit else "debit",
            "category": category, "balance": r["balance"], "seq": seq, "account": account,
        })
    return {"transactions": out, "rename": rename, "overrides": ov}
