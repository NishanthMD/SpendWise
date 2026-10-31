"""Run: python tests/test_banks.py <dir>

Reads the fake per-bank statements (make_bank_samples.py) and checks that, whatever the column names, date
style, Dr/Cr convention, narration shape or row order, the result is the same: the right rows, oldest first,
reconciling to the rupee, with the right payee on every row and the bank detected from the page header.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
out_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()

import make_bank_samples as mk
from core import banks, categorizer, parser

made = mk.make(out_dir)
failures = []
for path, bank, newest, style in made:
    label = f"{bank} {'newest-first' if newest else 'oldest-first'} {style}"
    expected = mk.build_rows(bank)
    try:
        rows, meta = parser.parse_statement_ex(path)
        assert len(rows) == len(expected), f"{len(rows)} rows, expected {len(expected)}"
        assert meta["layout"] == ("table" if style == "table" else "text"), meta["layout"]
        assert meta["order"] == ("newest_first" if newest else "oldest_first"), meta["order"]
        assert meta["balance_mismatches"] == 0, f"{meta['balance_mismatches']} balance mismatches"
        assert meta["opening_balance"] == mk.OPENING and meta["closing_balance"] == expected[-1]["balance"], (meta["opening_balance"], meta["closing_balance"])
        for got, want in zip(rows, expected):
            assert got["date"] == want["date"], (got["date"], want["date"])
            amount = got["credit"] or got["debit"]
            assert abs(amount - want["amount"]) < 0.005 and (got["credit"] > 0) == (want["kind"] == "cr"), (got, want["kind"], want["amount"])
            assert got["balance"] == want["balance"]
            payee = categorizer.merchant_name(got["description"])
            assert payee == want["payee"], f"payee {payee!r}, expected {want['payee']!r} from {want['narration']!r}"
        assert meta["bank_detected"] == bank, f"detected {meta['bank_detected']!r}"
    except AssertionError as exc:
        failures.append(f"{label}: {exc}")
        continue
    print(f"ok  {label}")

if failures:
    print("\nFAILED:")
    print("\n".join(failures))
    sys.exit(1)

# a bank you pick wins over detection, and "auto" falls back to it
_, meta = parser.parse_statement_ex(made[0][0], bank="kotak")
assert meta["bank"] == "kotak" and meta["bank_detected"] == made[0][1]
_, meta = parser.parse_statement_ex(made[0][0], bank="auto")
assert meta["bank"] == meta["bank_detected"]
print("bank choice OK")

# header-only detection helper
assert banks.detect_bank("Statement for HDFC0001234 savings") == "hdfc" and banks.detect_bank("welcome") is None
assert banks.account_label("axis|current") == "Axis Bank, current account" and banks.account_label("") == "Bank not set"
print(f"BANK LAYOUT CHECKS PASSED ({len(made)} statements)")

# the website's copy of the bank list and categories must match core/
import json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import export_static
with open(export_static.PATH, encoding="utf-8") as _f:
    assert json.load(_f) == json.loads(json.dumps(export_static.build())), "frontend/src/data/static.json is out of date: run tools/export_static.py"
print("website bank list is in sync")
