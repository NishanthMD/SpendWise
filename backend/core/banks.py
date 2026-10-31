"""What is known about how Indian banks lay out their statements, and how to tell them apart.

There is no national standard (RBI does not prescribe one, and NPCI only asks banks to standardise UPI
narrations), so each profile is a set of hints, not a rule: the parser always works out the real columns,
date format, Dr/Cr convention and row order from the PDF itself. A profile adds three things:
  - detection: IFSC prefix and name words found at the top of the statement
  - a plain-language description of the layout, shown to you so you can see how it will be read
  - `confidence`, which says where the knowledge came from:
        "real"     built against a statement of this bank that was read and reconciled to the rupee
        "layout"   the column layout and narration shapes of a statement of this bank were checked
        "public"   taken from publicly shared sample statements and bank documents, not yet checked on a file
"""
from __future__ import annotations

import re
from typing import Optional

ACCOUNT_TYPES = [
    {"id": "savings", "name": "Savings account", "note": "Personal spending. Everything is read as personal spending and income."},
    {"id": "salary", "name": "Salary account", "note": "Like savings. Regular credits are shown as income."},
    {"id": "student", "name": "Student or zero-balance account", "note": "Like savings."},
    {"id": "current", "name": "Current account", "note": "A business account. Company names (traders, industries, Pvt Ltd) are filed as shops, not people."},
    {"id": "other", "name": "Other", "note": "Anything else."},
]

# Shapes shared by many banks, used in the profiles below.
SPLIT = "Separate Withdrawal and Deposit columns"
SINGLE_DRCR = "One amount column with a Dr or Cr marker"


def _bank(id, name, ifsc, words, columns, amounts, dates, narration, order, confidence, notes=""):
    return {"id": id, "name": name, "ifsc": ifsc, "words": words, "columns": columns, "amounts": amounts, "dates": dates,
            "narration": narration, "order": order, "confidence": confidence, "notes": notes}


BANKS = [
    _bank("sbi", "State Bank of India", "SBIN", ["state bank of india"],
          "Txn Date | Value Date | Description | Ref No./Cheque No. | Debit | Credit | Balance", SPLIT, "1 Oct 2025 or 01-10-2025",
          "TO TRANSFER-UPI/DR/<ref>/<NAME>/<bank>/<vpa>/<note>; BY TRANSFER-NEFT*<IFSC>*<UTR>*<NAME>", "Oldest first", "public",
          "The TO TRANSFER and BY TRANSFER prefixes are stripped before the payee is read."),
    _bank("hdfc", "HDFC Bank", "HDFC", ["hdfc bank"],
          "Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance", SPLIT, "01/10/25",
          "UPI-<NAME>-<vpa>-<IFSC>-<ref>-<note>; NEFT CR-<IFSC>-<NAME>-<ref>; IMPS-<ref>-<NAME>-<bank>-<acct>", "Oldest first", "public",
          "Narrations use hyphens, not slashes, and wrap onto a second line."),
    _bank("icici", "ICICI Bank", "ICIC", ["icici bank"],
          "S No. | Value Date | Transaction Date | Cheque Number | Transaction Remarks | Withdrawal Amount (INR) | Deposit Amount (INR) | Balance (INR)",
          SPLIT, "01/10/2025", "UPI/<ref>/<note>/<vpa>/<bank>; MMT/IMPS/<ref>/<note>/<NAME>/<bank>; INF/NEFT/<UTR>/<IFSC>/<NAME>", "Check from balances",
          "public", "ICICI UPI lines carry the payee's handle, not a name, so the handle is used as the payee."),
    _bank("axis", "Axis Bank", "UTIB", ["axis bank"],
          "Tran Date | Chq No | Particulars | Debit | Credit | Balance | Init. Br", SPLIT, "01-10-2025",
          "NEFT/MB/<UTR>/<NAME>/<bank>; IMPS/P2A/<ref>/<NAME>/<code>/<bank>; MOB/TPFT/<NAME>/<ref>; RTGS/<UTR>/<NAME>/<bank>; UPI/P2A/<ref>/<NAME>/<bank>",
          "Check from balances", "layout", "MB, P2A and TPFT are channel codes, never the payee."),
    _bank("kotak", "Kotak Mahindra Bank", "KKBK", ["kotak mahindra", "kotak bank"],
          "Date | Narration | Chq/Ref No | Withdrawal(Dr)/Deposit(Cr) | Balance", SINGLE_DRCR + ", and (Dr) or (Cr) after the balance", "01-10-2025",
          "UPI/<NAME>/<ref>/<note>; UPI/P2M/<ref>/<MERCHANT>", "Check from balances", "public"),
    _bank("pnb", "Punjab National Bank", "PUNB", ["punjab national bank"],
          "Date | Instrument ID | Amount | Type (DR/CR) | Balance | Remarks", "One amount column plus a DR or CR type column", "01-10-2025",
          "UPI/<ref>/<DR or CR>/<NAME>/<bank>", "Check from balances", "public"),
    _bank("bob", "Bank of Baroda", "BARB", ["bank of baroda"],
          "Date | Narration | Chq.No. | Withdrawals | Deposits | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<DR or CR>/<NAME>/<bank>", "Check from balances", "public"),
    _bank("canara", "Canara Bank", "CNRB", ["canara bank"],
          "Date | Particulars | Deposits | Withdrawals | Balance (ePassbook, each entry ends with a Chq: line)", SPLIT, "01-10-2026",
          "UPI/DR/<ref>/<NAME>/<bank>/<vpa>/<note>//<txn id>; UPI/REV/<ref> for refunds; card purchases MERCHANT*DESC CITY-dd/mm/yy", "Oldest first, not always in date order",
          "real", "Read by word position because the narration wraps mid-word and the date and amounts sit mid-entry."),
    _bank("union", "Union Bank of India", "UBIN", ["union bank of india"],
          "Date | Particulars | Chq No | Withdrawals | Deposits | Balance", SPLIT, "01/10/2025", "UPI/DR/<ref>/<NAME>/<bank>/<vpa>", "Check from balances", "public"),
    _bank("boi", "Bank of India", "BKID", ["bank of india"], "Date | Narration | Chq No | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<DR or CR>/<NAME>/<bank>", "Check from balances", "public"),
    _bank("indian", "Indian Bank", "IDIB", ["indian bank"], "Date | Particulars | Chq No | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<NAME>/<bank>", "Check from balances", "public"),
    _bank("cbi", "Central Bank of India", "CBIN", ["central bank of india"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<NAME>/<bank>", "Check from balances", "public"),
    _bank("iob", "Indian Overseas Bank", "IOBA", ["indian overseas bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("uco", "UCO Bank", "UCBA", ["uco bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("indusind", "IndusInd Bank", "INDB", ["indusind bank"], "Date | Particulars | Chq No | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<NAME>/<note>", "Check from balances", "public"),
    _bank("yes", "Yes Bank", "YESB", ["yes bank"], "Transaction Date | Value Date | Narration | Withdrawals | Deposits | Running Balance", SPLIT, "01-10-2025",
          "UPI/<ref>/<NAME>/<note>", "Check from balances", "public"),
    _bank("idfc", "IDFC FIRST Bank", "IDFB", ["idfc first", "idfc bank"], "Transaction Date | Value Date | Particulars | Cheque No | Debit | Credit | Balance",
          SPLIT, "01-Oct-2025", "UPI/DR/<ref>/<NAME>/<bank>/<vpa>", "Check from balances", "public"),
    _bank("federal", "Federal Bank", "FDRL", ["federal bank"], "Date | Particulars | Chq No | Debit | Credit | Balance", SPLIT, "01/10/2025",
          "UPI/<ref>/<NAME>/<note>", "Check from balances", "public"),
    _bank("sib", "South Indian Bank", "SIBL", ["south indian bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("karnataka", "Karnataka Bank", "KARB", ["karnataka bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("bandhan", "Bandhan Bank", "BDBL", ["bandhan bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("rbl", "RBL Bank", "RATN", ["rbl bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("au", "AU Small Finance Bank", "AUBL", ["au small finance"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("paytm", "Paytm Payments Bank", "PYTM", ["paytm payments bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("ippb", "India Post Payments Bank", "IPOS", ["india post payments bank"], "Date | Narration | Debit | Credit | Balance", SPLIT, "01/10/2025", "UPI/<ref>/<NAME>", "Check from balances", "public"),
    _bank("other", "Other bank", "", [], "Anything with Date, Narration or Particulars, amount columns and a Balance column",
          "Separate columns, or one amount with Dr or Cr", "Any common Indian date style", "Slash-, hyphen- or star-separated narrations", "Check from balances",
          "layout", "The reader finds the columns itself."),
]

BY_ID = {b["id"]: b for b in BANKS}
BY_IFSC = {b["ifsc"]: b["id"] for b in BANKS if b["ifsc"]}
IFSC_RE = re.compile(r"\b([A-Z]{4})0[A-Z0-9]{6}\b")


def detect_bank(head: str) -> Optional[str]:
    """Guess the bank from the text at the top of the statement (never from narrations, which name other banks)."""
    text = head.lower()
    # Earliest mention wins: "Bank of India" sits inside "State Bank of India" and "Union Bank of India", but later in the text.
    hits = sorted((text.find(w), -len(w), b["id"]) for b in BANKS for w in b["words"] if w in text)
    if hits:
        return hits[0][2]
    m = IFSC_RE.search(head)
    return BY_IFSC.get(m.group(1)) if m else None


def account_id(bank: Optional[str], account_type: Optional[str]) -> str:
    return f"{bank or 'other'}|{account_type or 'savings'}"


def account_label(account: str) -> str:
    if not account:
        return "Bank not set"
    bank, _, kind = account.partition("|")
    b = BY_ID.get(bank, BY_ID["other"])
    t = next((x["name"] for x in ACCOUNT_TYPES if x["id"] == kind), kind)
    return f"{b['name']}, {t.lower()}"


def public_list() -> dict:
    return {"banks": BANKS, "account_types": ACCOUNT_TYPES}
