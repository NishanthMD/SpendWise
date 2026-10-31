"""Rule-based categorizer with per-merchant user overrides.

Built against real Canara Bank ePassbook narrations such as
  UPI/DR/975205789157/KFCK261/HDFC/**21501@HDFCBANK/PAYMENT//AXL29A4C...
  ANTHROPIC*CLAUDESUBSAN FRANCISCUS-30/10/26 18:39:09/3476
  ATM / IMPS TRANSACTION CHARGES
"""
from __future__ import annotations

import re
from typing import Optional

CATEGORIES = [
    "Food", "Groceries", "Entertainment", "Local Shops", "Person", "Transport", "Shopping",
    "Bills & Utilities", "Health", "Subscriptions", "Education", "Savings", "Bank Charges",
    "Cash", "Other", "Income", "Reversed",
]

# Order matters: the first matching rule wins.
RULES: list[tuple[str, list[str]]] = [
    ("Bank Charges", ["gst @", "gst on", "charges", "chgs", "penalty", "transaction charges", "sms alert", "annual maintenance", "amc charges", "service charge", "atm / imps", "min balance", "debit card fee"]),
    ("Savings", ["apy contri", "atal pension", "mutual fund", "nps", "ppf", "zerodha", "groww", "upstox", "recurring deposit", "sip", "indmoney"]),
    ("Subscriptions", ["netflix", "spotify", "hotstar", "prime video", "youtube premium", "icloud", "google play", "apple.com", "chatgpt", "openai", "anthropic", "claude", "notion", "canva", "linkedin", "github", "midjourney"]),
    ("Education", ["wanikani", "duolingo", "coursera", "udemy", "unacademy", "byju", "skillshare", "nptel", "tuition", "college", "exam fee", "jlpt", "school fee", "language"]),
    ("Groceries", ["blinkit", "zepto", "instamart", "bigbasket", "dmart", "d mart", "reliance fresh", "spencer", "nilgiris", "jiomart", "milkbasket", "country delight", "licious", "freshtohome", "supermarket"]),
    ("Food", ["swiggy", "zomato", "dominos", "domino", "mcdonald", "kfc", "burger", "pizza", "starbucks", "cafe", "coffee", "restaurant", "biryani", "biriyani", "hotel", "bakery", "eatfit", "box8", "faasos", "behrouz", "chaayos", "tea", "chai", "juice", "canteen", "mess", "dhaba", "ice cream", "momos", "shawarma", "tiffin", "darshini", "sagar"]),
    ("Entertainment", ["bookmyshow", "pvr", "inox", "cinema", "steam", "epic games", "playstation", "xbox", "dream11", "mpl", "gaming", "game", "concert", "amusement", "bowling", "ticketnew", "district", "gamer"]),
    ("Transport", ["uber", "olacabs", "ola", "rapido", "namma yatri", "irctc", "redbus", "makemytrip", "metro", "bmtc", "ksrtc", "fuel", "petrol", "diesel", "hp pay", "indian oil", "bharat petroleum", "fastag", "parking", "yulu", "bounce", "indigo", "air india", "spicejet", "goibibo", "abhibus"]),
    ("Shopping", ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "decathlon", "croma", "reliance digital", "ikea", "lenskart", "tata cliq", "snapdeal", "h&m", "zara", "westside", "pantaloons"]),
    ("Bills & Utilities", ["electricity", "bescom", "airtel", "jio", "vodafone", "vi prepaid", "bsnl", "recharge", "broadband", "act fibernet", "gas", "water bill", "dth", "tata play", "postpaid", "insurance", "lic", "emi", "loan", "rent", "bill pay", "billdesk", "cred club", "credit card"]),
    ("Health", ["pharmacy", "apollo", "medplus", "netmeds", "1mg", "pharmeasy", "hospital", "clinic", "diagnostic", "lab", "dental", "doctor", "medical"]),
    ("Cash", ["atm", "cash withdrawal", "cash wdl", "nfs", "cwdr"]),
]

# Short, generic words must stand alone ("tea" must not match "TEAMLEASE").
STRICT = {"tea", "sip", "lic", "emi", "gas", "lab", "mess", "game", "rent", "nps", "ppf", "ola", "mpl", "atm", "chai"}

# Payee names that identify themselves exactly.
EXACT_MERCHANTS = {"more": "Groceries", "shopping": "Local Shops", "reliance": "Groceries"}

LOCAL_SHOP_WORDS = [
    "store", "stores", "mart", "kirana", "provision", "general", "traders", "trading",
    "enterprises", "enterprise", "agencies", "sweets", "fruits", "vegetables", "vegetable", "dairy", "milk",
    "stationery", "xerox", "print", "tailor", "laundry", "saloon", "salon", "barber", "hardware", "electricals",
    "mobiles", "mobile shop", "footwear", "garments", "textiles", "fancy", "juice centre", "meat", "chicken",
    "fish", "petstore", "nursery", "shop", "stall", "bhandar", "kendra", "emporium", "foods",
    # businesses that appear by company name, as on a current account
    "ceramics", "industries", "industry", "company", "pvt", "ltd", "limited", "works", "engineering", "constructions",
    "construction", "tiles", "steel", "steels", "marketing", "logistics", "associates", "services", "solutions",
    "technologies", "exports", "motors", "furniture", "paints", "agro", "foundry", "tools", "machinery", "polymers",
    "plastics", "chemicals", "textile", "textiles", "mills", "brothers", "bros", "sons", "pipes", "cements", "granites",
]
QR_MERCHANT_VPA = re.compile(r"(paytmqr|paytm-\d|q\d{6,}@|bharatpe|gpay-\d|merchant|\.rzp@|razorpay|payu@|ybl.*store)", re.I)
UPI_RE = re.compile(r"\bupi\b|\bimps\b|\bneft\b|\brtgs\b", re.I)
NOISE = {
    "upi", "dr", "cr", "rev", "payment", "pay", "from", "to", "paid", "via", "txn", "ref", "imps", "neft", "rtgs",
    "transfer", "tfr", "by", "mob", "ib", "bil", "inb", "of", "for", "the", "p2a", "p2m", "p2p", "debit", "credit",
    "ybl", "okaxis", "okhdfcbank", "oksbi", "okicici", "paytm", "apl", "axl", "ibl", "yesbank", "sbi", "hdfc",
    "icici", "axis", "kotak", "bank", "ltd", "pvt", "limited", "india", "yesb", "cnrb", "fino", "kkbk", "karb", "pty",
}


def _core(description: str) -> str:
    """The human-readable part of a narration: drop the trailing //<txn id>/<date time> block."""
    text = re.sub(r"^\s*(?:TO|BY)\s+TRANSFER\s*[-:]?\s*", "", description or "", flags=re.I)  # SBI: TO TRANSFER-UPI/DR/...
    return text.split("//")[0]


# Narrations of the form MODE/<channel>/<reference>/<NAME>/<bank>/..., as written by Axis and most other banks:
#   NEFT/MB/AXOMB26402076909/SRI KENCHAMBA CERAMICS/UNION BANK OF INDIA/
#   IMPS/P2A/626414723490/SRIKENCHAMBACERAMIC/X000002/UNIONBANKOFINDIA/
#   MOB/TPFT/DINESH KUMAR R/1234567890      RTGS/AXISR12345678/ACME TRADERS/STATE BANK OF INDIA//SBIN0001234
# The channel (MB, P2A, TPFT) and the reference are never the payee: the name is the first field left after them.
CHANNEL_CODES = {"MB", "IB", "NB", "P2A", "P2M", "P2P", "INB", "TPFT", "IFT", "IMB", "DR", "CR", "REV",
                 "INF", "INFT", "BIL", "MMT", "FT", "TXT", "NEFT", "IMPS", "RTGS", "UPI"}
MODE_WORDS = {"UPI", "IMPS", "NEFT", "RTGS", "ACH", "NACH", "ECS"}


def _tidy(name: str, words: int = 5) -> Optional[str]:
    name = re.sub(r"[^A-Za-z0-9 .&'-]", "", name).strip()
    return " ".join(name.split()[:words]).title() if len(name) >= 2 else None


def _delimited_name(description: str) -> Optional[str]:
    """Hyphen- or star-separated narrations (HDFC, SBI NEFT):
         UPI-RAMESH KUMAR-RAMESH@OKSBI-SBIN0001234-123456789012-UPI
         NEFT CR-HDFC0000001-ACME TRADERS-UTR123       IMPS-123456789012-RAMESH KUMAR-HDFC-12345-NOTE
         NEFT*SBIN0001234*SBIN123456789*RAMESH KUMAR*   ACH D- ACME LOANS-123456
    """
    core = _core(description)
    m = re.match(r"^\s*(UPI|IMPS|NEFT|RTGS|ACH|NACH|ECS)\b[^-*/]{0,6}[-*:]\s*(.*)$", core, re.I)
    if not m or "/" in core.split("-")[0].split("*")[0]:
        return None
    fields = [f.strip() for f in re.split(r"[-*]", m.group(2)) if f.strip()]
    if m.group(1).upper() == "UPI":
        return _tidy(fields[0]) if fields and "@" not in fields[0] else None
    for f in fields:
        if f.upper() in CHANNEL_CODES or _is_reference(f) or re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", f):
            continue
        return _tidy(f)
    return None


def _handle_name(parts: list) -> Optional[str]:
    """ICICI UPI lines (UPI/<ref>/<note>/<handle@bank>/<bank>) carry the payee's handle, not a name."""
    if len(parts) >= 4 and parts[0].upper() == "UPI" and re.fullmatch(r"\d{12}", parts[1]):
        vpa = next((f for f in parts[2:] if "@" in f), None)
        if vpa:
            return _tidy(re.sub(r"[._]+", " ", vpa.split("@")[0]))
    return None


def _is_reference(field: str) -> bool:
    return bool(re.search(r"\d", field)) and (" " not in field or re.search(r"\d{4,}", field) is not None)


def _structured_name(description: str) -> Optional[str]:
    """The payee of a MODE/channel/reference/NAME/bank narration, or None when it is not of that shape."""
    parts = [p.strip() for p in _core(description).split("/")]
    if len(parts) < 3 or not re.fullmatch(r"[A-Za-z]{2,5}", parts[0]):
        return _delimited_name(description)
    if parts[0].upper() == "UPI" and len(parts) > 1 and parts[1].upper() in {"DR", "CR", "REV"} and len(parts) > 3 and _is_reference(parts[2]) and not parts[3].upper() in CHANNEL_CODES:
        return None  # Canara layout UPI/DR/<ref>/<NAME>/...: the specific reader above handles it
    if parts[0].upper() == "MMT" and len(parts) >= 5:  # ICICI: MMT/IMPS/<ref>/<note>/<NAME>/<bank>
        return _tidy(parts[4])
    handle = _handle_name(parts)
    if handle:
        return handle
    for field in parts[1:]:
        if not field or field.upper() in CHANNEL_CODES or _is_reference(field):
            continue
        if re.search(r"\bbank\b", field, re.I):
            return None  # no name field, only the bank
        name = re.sub(r"[^A-Za-z0-9 .&'-]", "", field).strip()
        return " ".join(name.split()[:5]).title() if len(name) >= 2 else None
    return None


def _match_text(description: str) -> str:
    """What rules are matched against: just the payee for structured narrations, so a bank called
    'HDFC BANK LTD' cannot make a payment to a person look like a company."""
    name = _structured_name(description)
    return name.lower() if name else _core(description).lower()


def fold_payees(names) -> dict:
    """Banks truncate and squash names ('SRIKENCHAMBACERAMIC' for 'SRI KENCHAMBA CERAMICS'). Map every name
    to one canonical spelling: the fullest one, preferring a spelling that keeps its spaces."""
    squash = lambda n: re.sub(r"[^a-z0-9]", "", n.lower())
    ordered = sorted(set(names), key=lambda n: (" " not in n, -len(squash(n)), n))
    canon: list = []
    out = {}
    for n in ordered:
        sq = squash(n)
        match = next((c for c in canon if len(sq) >= 12 and squash(c).startswith(sq)), None)
        if match is None:
            canon.append(n)
            match = n
        out[n] = match
    return out


def _has(low: str, word: str) -> bool:
    pat = r"(?<![a-z])" + re.escape(word) + (r"(?![a-z])" if word in STRICT else "")
    return re.search(pat, low) is not None


def _tokens(description: str) -> list[str]:
    parts = re.split(r"[/\-@|:\\,()*]+|\s+", description or "")
    return [p for p in parts if p]


# Banks truncate payee names ("BLINKITC", "AMAZONPA", "NETFLIXC"); fold known brands back to one name.
BRANDS = [
    "blinkit", "zepto", "instamart", "bigbasket", "dmart", "swiggy", "zomato", "dominos", "kfc", "mcdonald", "starbucks",
    "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "netflix", "spotify", "hotstar", "uber", "rapido", "jio",
    "airtel", "wanikani", "duolingo", "anthropic", "openai", "bookmyshow", "burger king", "westside",
]


def _brand(name: str) -> str:
    low = name.lower().replace(" ", "")
    for b in BRANDS:
        if low.startswith(b.replace(" ", "")):
            return b.title()
    return name


def merchant_name(description: str) -> str:
    """Best-effort merchant / counterparty name from a bank narration."""
    name = _merchant_raw(description)
    return _brand(name)


def _merchant_raw(description: str) -> str:
    desc = _core(description).strip()
    if re.search(r"transaction charges|sms alert|annual maintenance|amc charges|\bgst\b *@|service charges?", desc, re.I):
        return "Bank Charges"
    # UPI/<DR|CR|REV>/<ref>/<NAME>/<bank>/<vpa>/<remark>: the name is the 4th field.
    parts = [p.strip() for p in desc.split("/")]
    if len(parts) >= 4 and parts[0].upper() == "UPI" and parts[1].upper() in {"DR", "CR", "REV"}:
        name = re.sub(r"[^A-Za-z0-9 .&']", "", parts[3]).strip()
        if len(name) >= 2:
            return " ".join(name.split()[:4]).title()
    structured = _structured_name(description)
    if structured:
        return structured
    # Generic slash-delimited narrations (older formats).
    if "/" in desc and UPI_RE.search(desc):
        for field in parts:
            low = field.lower()
            if not field or low in NOISE or "@" in field or re.search(r"\d{3,}", field):
                continue
            words = [w for w in re.split(r"\s+", field) if w and not re.search(r"\d", w)]
            if words and re.fullmatch(r"[A-Za-z .&'\-]+", " ".join(words)):
                return " ".join(words[:4]).title()
    # Card purchases: "ANTHROPIC*CLAUDESUB..." -> merchant is before the '*'.
    if "*" in desc:
        head = desc.split("*")[0].strip()
        if len(head) >= 2:
            return head.title()
    cleaned: list[str] = []
    for tok in _tokens(desc):
        low = tok.lower()
        if low in NOISE or re.search(r"\d", tok) or len(tok) < 3:
            continue
        cleaned.append(tok)
        if len(cleaned) == 3:
            break
    if not cleaned:
        return (desc[:24].strip() or "Unknown").title()
    return " ".join(cleaned).title()


GENERIC_REMARKS = {"", "payment", "upi", "pay", "paid", "payment from phone", "sent using paytm"}


def remark(description: str) -> str:
    """The sender's own note on a UPI payment (7th field), or '' when it is empty or boilerplate."""
    parts = [p.strip() for p in _core(description).split("/")]
    if len(parts) >= 7 and parts[0].upper() == "UPI" and parts[1].upper() in {"DR", "CR", "REV"}:
        note = parts[6]
        if note.lower() not in GENERIC_REMARKS:
            return note
    return ""


def looks_like_person(description: str, name: Optional[str] = None) -> bool:
    """UPI/IMPS/NEFT payment to something that looks like a human name. `name` is the folded payee, if known."""
    core = _core(description)
    structured = _structured_name(description)
    if not structured and not UPI_RE.search(core):
        return False
    low = (name or structured).lower() if structured else _match_text(description)
    if QR_MERCHANT_VPA.search(low) or any(re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low) for w in LOCAL_SHOP_WORDS):
        return False
    for _cat, words in RULES:
        if any(_has(low, w) for w in words):
            return False
    name = (name or merchant_name(description)) if structured else merchant_name(description)
    parts = name.split()
    return 1 <= len(parts) <= (4 if structured else 3) and all(p.replace(".", "").isalpha() for p in parts)


def categorize(description: str, is_credit: bool = False, overrides: Optional[dict] = None, merchant: Optional[str] = None) -> str:
    merchant = (merchant or merchant_name(description)).lower()
    structured = _structured_name(description) is not None
    low = merchant if structured else _match_text(description)  # the folded payee, so a truncated name still matches
    if is_credit:  # money in is always income, whatever the payee was filed under for payments
        return "Income"
    if overrides and merchant in overrides:
        return overrides[merchant]
    if merchant in EXACT_MERCHANTS:
        return EXACT_MERCHANTS[merchant]
    for cat, words in RULES:
        if any(_has(low, w) for w in words):
            return cat
    if QR_MERCHANT_VPA.search(low) or any(re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low) for w in LOCAL_SHOP_WORDS):
        return "Local Shops"
    if looks_like_person(description, merchant if structured else None):
        return "Person"
    return "Other"
