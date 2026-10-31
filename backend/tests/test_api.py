"""Run: python tests/test_api.py <dir> [path/to/real_statement.pdf]

Calls every endpoint through FastAPI's test client. The server is stateless: the test plays the part of the browser
and keeps the rows itself (tests/memstore.py). With a real statement
it reports counts and totals only (never narrations or names).
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
out_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
real_pdf = sys.argv[2] if len(sys.argv) > 2 else None

from fastapi.testclient import TestClient

import make_passbook_sample as mk
import main

c = TestClient(main.app)


def ok(r, code=200):
    assert r.status_code == code, (r.request.method, r.request.url.path, r.status_code, r.text[:300])
    return r


from memstore import MemStore


class Browser:
    """What the website does: save what /api/parse returns, and send its saved rows with every request."""

    def __init__(self):
        self.store = MemStore()

    def parse(self, path, code=200, **data):
        data = dict(data)
        data.setdefault("overrides", __import__("json").dumps(self.store.overrides))
        data.setdefault("saved_merchants", __import__("json").dumps(sorted({r["merchant"] for r in self.store.rows})))
        r = ok(c.post("/api/parse", files={"file": (os.path.basename(path), open(path, "rb"), "application/pdf")}, data=data), code)
        return r.json()

    def upload(self, path, **data):
        res = self.parse(path, **data)
        rows = res["transactions"]
        rename, self.store.overrides = res["rename"], res["overrides"]
        for r in self.store.rows:
            r["merchant"] = rename.get(r["merchant"], r["merchant"])
        have = {r["uid"] for r in self.store.rows}
        added = 0
        for t in rows:
            if t["uid"] in have:
                continue
            self.store.rows.append({**t, "id": self.store._next})
            self.store._next += 1
            added += 1
        res["added"], res["duplicates_skipped"] = added, len(rows) - added
        return res

    def body(self, **kw):
        return {"rows": self.store.rows, **kw}

    def post(self, path, code=200, **kw):
        return ok(c.post(path, json=self.body(**kw)), code)


# ---- nothing is kept on the server -------------------------------------------------------------------------------
assert ok(c.post("/api/summary", json={"rows": []})).json() == {"empty": True}
assert ok(c.post("/api/passbook", json={"rows": []})).json()["empty"] is True
assert len(ok(c.get("/api/categories")).json()) == 17
for gone_route in ("/api/transactions", "/api/notes", "/api/reminders", "/api/budgets", "/api/ledger", "/api/accounts"):
    assert c.get(gone_route).status_code in (404, 405), gone_route + " must not exist: the server stores nothing"
files_before = set(os.listdir(os.path.dirname(HERE)))

# ---- parse (fake passbook), re-upload, bad input ------------------------------------------------------------------
path = os.path.join(out_dir, "sample_passbook.pdf")
closing, n = mk.build(path)
me = Browser()
up = me.upload(path)
assert up["added"] == n and up["balance_check_passed"] and up["balance_mismatches"] == 0 and up["layout"] == "passbook", up
assert {"uid", "date", "merchant", "amount", "kind", "category", "balance", "seq", "account"} <= set(up["transactions"][0])
again = me.upload(path)
assert again["added"] == 0 and again["duplicates_skipped"] == n, again
ok(c.post("/api/parse", files={"file": ("x.txt", b"hi", "text/plain")}), 400)
ok(c.post("/api/parse", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}), 422)
ok(c.post("/api/parse", files={"file": ("x.pdf", b"%PDF", "application/pdf")}, data={"overrides": "[1,2]"}), 400)

# ---- password-protected statement: asks for the password, then reads it -----------------------------------
from reportlab.lib import pdfencrypt
from reportlab.pdfgen import canvas

locked = os.path.join(out_dir, "locked.pdf")
cv = canvas.Canvas(locked, encrypt=pdfencrypt.StandardEncryption("secret42", strength=128))
cv.setFont("Helvetica", 9)
cv.drawString(40, 800, "Date Narration Withdrawal Deposit Balance")
for i, line in enumerate(["01/10/2026 UPI/DR/123456789012/Swiggy/HDFC 250.00 9,750.00", "02/10/2026 UPI/CR/123456789013/Salary/HDFC 1,000.00 10,750.00",
                          "03/10/2026 UPI/DR/123456789014/Zomato/HDFC 300.00 10,450.00"]):
    cv.drawString(40, 784 - 16 * i, line)
cv.save()
r = me.parse(locked, 422)
assert "password" in r["detail"].lower()
r = me.parse(locked, 422, password="nope")
assert "password" in r["detail"].lower() and "did not" in r["detail"]
assert len(me.parse(locked, password="secret42")["transactions"]) == 3
print("password-protected upload OK")

# ---- passbook view: statement order, opening/closing, reconciliation -----------------------------
pb = me.post("/api/passbook").json()
assert pb["entry_count"] == n and len(pb["entries"]) == n and pb["balance_check_passed"] is True
assert abs(pb["closing_balance"] - closing) < 0.01 and pb["opening_balance"] == 5000.0
assert abs(pb["opening_balance"] + pb["total_in"] - pb["total_out"] - pb["closing_balance"]) < 0.01
dates = [e["date"] for e in pb["entries"]]
assert dates != sorted(dates), "passbook must keep the statement's own order, not date order"
assert all((e["deposit"] is None) != (e["withdrawal"] is None) for e in pb["entries"])
assert me.post("/api/passbook", category="Food").json()["filtered"] is True
assert all(e["category"] == "Food" for e in me.post("/api/passbook", category="Food").json()["entries"])

# ---- summary, budgets, rings data -----------------------------------------------------------------
s = me.post("/api/summary").json()
assert not s["empty"] and s["daily"][-1]["balance"] is not None
assert abs(s["daily"][-1]["balance"] - closing) < 0.01, "daily balance series must end at the closing balance"
assert abs(sum(d["amount"] for d in s["daily"]) - s["total_spent"]) < 0.01
assert {"by_category", "largest", "count", "balance"} <= set(s["daily"][0]) and "start" in s["weekly"][0] and "end" in s["monthly"][0]
assert s["budget_status"]["overall"] is None and s["no_spend"]["target"] == 7
budgets = {"overall": 20000, "savings_goal": 5000, "categories": {"Food": 3000, "Groceries": 1500}}
bs = me.post("/api/summary", budgets=budgets).json()["budget_status"]
assert bs["overall"]["monthly"] == 20000 and {x["category"] for x in bs["categories"]} == {"Food", "Groceries"} and bs["savings_goal"]

# ---- period switching + custom range -------------------------------------------------------------
month = s["monthly"][-1]
sm = me.post("/api/summary", start=month["start"], end=month["end"]).json()
assert sm["start"] >= month["start"] and sm["end"] <= month["end"]
me.post("/api/summary", 400, start="nope")
avg = me.post("/api/average-daily", start=s["start"], end=s["end"]).json()
assert abs(avg["avg_daily_spend"] - s["avg_daily_spend"]) < 0.01
wide = me.post("/api/average-daily", start="2000-01-01", end="2100-01-01").json()
assert wide["days"] == s["days"] and wide["note"], "days outside the statement must not be averaged in"
me.post("/api/average-daily", 400, start="2026-02-01", end="2026-01-01")

# ---- a remembered category choice reaches the next upload --------------------------------------------
person = next(t for t in me.store.rows if t["category"] == "Person")
assert me.store.set_category(person["id"], "Education", True) >= 1
me.store.rows = []  # the same person clears their data and uploads again: the choice is sent along with the PDF
me.store._next = 1
again = me.upload(path)
assert all(t["category"] == "Education" for t in me.store.rows if t["merchant"] == person["merchant"] and t["kind"] == "debit" and t["category"] != "Reversed"), \
    "override must follow the payee into a fresh upload"

# ---- PDF report ------------------------------------------------------------------------------------
note = {"title": "Plan", "body": "Cook more", "created_at": "2026-10-01T10:00:00"}
pdf = me.post("/api/report", budgets=budgets, notes=[note])
assert pdf.content[:4] == b"%PDF" and pdf.headers["content-type"] == "application/pdf"
open(os.path.join(out_dir, "api_report.pdf"), "wb").write(pdf.content)
me.post("/api/report", 400, budgets={"overall": "lots"})
print("fake passbook: every endpoint OK")

# ---- the real statement: counts and totals only -----------------------------------------------------
if real_pdf and os.path.exists(real_pdf):
    real = Browser()
    up = real.upload(real_pdf)
    assert up["parsed"] == 106 and up["balance_mismatches"] == 0 and up["balance_check_passed"], up
    assert up["reversals"] == 1, up
    pb = real.post("/api/passbook").json()
    assert abs(up["closing_balance"] - pb["closing_balance"]) < 0.01
    again = real.upload(real_pdf)
    assert again["added"] == 0 and again["duplicates_skipped"] == 106
    s = real.post("/api/summary").json()
    assert pb["entry_count"] == 106 and pb["reversed_pairs"] == 1 and pb["balance_check_passed"]
    reversed_rows = [e for e in pb["entries"] if e["reversed"]]
    assert len(reversed_rows) == 2 and {e["kind"] for e in reversed_rows} == {"debit", "credit"}
    print(f"real statement: {up['parsed']} entries, {up['balance_mismatches']} balance mismatches, "
          f"{pb['reversed_pairs']} reversal pair ({len(reversed_rows)} rows excluded from totals); "
          f"in {pb['total_in']:,.2f}, out {pb['total_out']:,.2f}; counted spend {s['total_spent']:,.2f}, income {s['total_income']:,.2f}; "
          f"closing {pb['closing_balance']:,.2f}; re-upload added {again['added']}")

# ---- two people never see each other's data ---------------------------------------------------------------------
import make_bank_samples as bk

files = {m[1:]: m[0] for m in bk.make(out_dir)}  # (bank, newest, style) -> path
hdfc, axis = files[("hdfc", True, "table")], files[("axis", False, "table")]
alice, bob = Browser(), Browser()
alice.upload(hdfc, bank="hdfc", account_type="savings")
bob.upload(axis, bank="axis", account_type="current")
a_sum, b_sum = alice.post("/api/summary").json(), bob.post("/api/summary").json()
assert a_sum["transactions"] == len(alice.store.rows) and b_sum["transactions"] == len(bob.store.rows), "each summary counts only the rows sent with it"
assert ok(c.post("/api/summary", json={"rows": []})).json() == {"empty": True}, "nothing from earlier requests is remembered"
print("two people stay separate OK")

# ---- banks, accounts, sorting and filtering -------------------------------------------------------------------
listing = ok(c.get("/api/banks")).json()
ids = {b["id"] for b in listing["banks"]}
assert {"sbi", "hdfc", "icici", "axis", "kotak", "pnb", "bob", "canara", "union", "other"} <= ids and len(ids) >= 20
assert {t["id"] for t in listing["account_types"]} >= {"savings", "current", "salary"}
assert all(b["confidence"] in ("real", "layout", "public") and b["columns"] and b["narration"] for b in listing["banks"])

two = Browser()
up = two.upload(hdfc, bank="hdfc", account_type="savings")
assert up["account"] == "hdfc|savings" and up["bank_detected"] == "hdfc" and up["order"] == "newest_first" and up["balance_check_passed"] and not up["bank_warning"]
wrong = two.upload(axis, bank="sbi", account_type="current")
assert wrong["bank_warning"] and "Axis" in wrong["bank_warning"] and wrong["account"] == "sbi|current"
two.parse(axis, 400, bank="nope")
two.parse(axis, 400, account_type="nope")
# several accounts mixed: balances do not chain, so nothing is shown that would be wrong; one account at a time is exact
mixed = two.post("/api/passbook").json()
assert mixed["balances_mixed"] and mixed["balance_check_passed"] is None and mixed["opening_balance"] is None
assert two.post("/api/summary").json()["daily"][0]["balance"] is None
one = two.post("/api/passbook", account="hdfc|savings").json()
assert one["balance_check_passed"] is True and one["opening_balance"] == bk.OPENING and one["accounts"] == ["HDFC Bank, savings account"]
assert two.post("/api/summary", account="hdfc|savings").json()["daily"][-1]["balance"] == bk.build_rows("hdfc")[-1]["balance"]

# sorting: every order, ties keep statement order; filters combine
solo = Browser()
solo.upload(hdfc, bank="hdfc")
pb = lambda **kw: solo.post("/api/passbook", **kw).json()
base = pb()
assert base["sorted"] is False and base["filtered"] is False
amounts = [e["amount"] for e in pb(sort="amount_desc")["entries"]]
assert amounts == sorted(amounts, reverse=True) and [e["amount"] for e in pb(sort="amount_asc")["entries"]] == sorted(amounts)
dates = [e["date"] for e in pb(sort="date_desc")["entries"]]
assert dates == sorted(dates, reverse=True) and [e["date"] for e in pb(sort="date_asc")["entries"]] == sorted(dates)
names = [e["merchant"].lower() for e in pb(sort="payee_asc")["entries"]]
assert names == sorted(names) and [e["merchant"].lower() for e in pb(sort="payee_desc")["entries"]] == sorted(names, reverse=True)
cats = [e["category"] for e in pb(sort="category")["entries"]]
assert cats == sorted(cats)
same_day = [e["id"] for e in pb(sort="date_asc")["entries"] if e["date"] == base["entries"][0]["date"]]
assert same_day == [e["id"] for e in base["entries"] if e["date"] == base["entries"][0]["date"]], "ties must keep statement order"
ins = pb(kind="in")
assert ins["filtered"] and ins["entries"] and all(e["kind"] == "credit" for e in ins["entries"])
assert all(e["kind"] == "debit" for e in pb(kind="out")["entries"])
mid = pb(min_amount=300, max_amount=1500, kind="out", sort="amount_desc")
assert mid["entries"] and all(300 <= e["amount"] <= 1500 for e in mid["entries"])
assert abs(mid["shown_out"] - sum(e["amount"] for e in mid["entries"] if not e["reversed"])) < 0.01 and mid["shown_in"] == 0
assert pb(q="swiggy")["entries"] and all("swiggy" in e["merchant"].lower() for e in pb(q="swiggy")["entries"])
assert pb(min_amount=10**8)["entries"] == [] and pb(min_amount=10**8)["empty"] is False
solo.post("/api/passbook", 400, sort="sideways")
solo.post("/api/passbook", 400, kind="both")
print("banks, accounts, sorting and filtering OK")

# ---- headers and limits ----------------------------------------------------------------------------------------
r = ok(c.get("/api/banks"))
assert r.headers["cache-control"] == "no-store" and r.headers["x-content-type-options"] == "nosniff"
assert c.post("/api/summary", content=b"x", headers={"content-length": str(40 * 1024 * 1024), "content-type": "application/json"}).status_code == 413
assert c.get("/docs").status_code == 404, "no public API docs"
assert set(os.listdir(os.path.dirname(HERE))) == files_before, "the server must not write any file"
print("API CHECKS PASSED")

# ---- the same code, called the way the browser calls it (core/api.call), gives the same answers --------------------------
import json as _json
from core import api as core_api

assert _json.loads(core_api.call("categories", ""))["result"] == ok(c.get("/api/categories")).json()
direct = _json.loads(core_api.call("summary", _json.dumps(me.body(budgets=budgets))))
assert direct["ok"] and direct["result"] == me.post("/api/summary", budgets=budgets).json()
assert _json.loads(core_api.call("passbook", _json.dumps({"rows": [{"kind": "oops"}]})))["status"] == 400
assert _json.loads(core_api.call("nope", ""))["ok"] is False
print("browser entry point matches the server OK")
