"""Indian states for GST: CGST + SGST inside one state, IGST across states.

The supply was judged inter-state by comparing the state text exactly, so "TN", "Tamilnadu", "tamil nadu " and
"Tamil Nadu" counted as different states and a Tamil Nadu customer could be billed IGST. Everything is reduced to the
two-digit GST state code first: a GSTIN's first two digits win, then a code, then the state's name or short form.
"""
import re
from typing import Optional

CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
    "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
    "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
    "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
}
SAME_AS = {"25": "26", "28": "37"}   # old Daman & Diu, old (undivided) Andhra Pradesh codes

ALIASES = {
    "jk": "01", "jammukashmir": "01", "hp": "02", "pb": "03", "ch": "04", "uk": "05", "ut": "05", "uttaranchal": "05",
    "hr": "06", "dl": "07", "newdelhi": "07", "nctofdelhi": "07", "nctdelhi": "07", "rj": "08", "up": "09", "br": "10",
    "sk": "11", "ar": "12", "nl": "13", "mn": "14", "mz": "15", "tr": "16", "ml": "17", "as": "18", "wb": "19",
    "jh": "20", "od": "21", "or": "21", "orissa": "21", "cg": "22", "ct": "22", "chattisgarh": "22", "mp": "23",
    "gj": "24", "dd": "26", "dn": "26", "dnhdd": "26", "damananddiu": "26", "dadranagarhaveli": "26", "dadraandnagarhaveli": "26",
    "mh": "27", "ka": "29", "ga": "30", "ld": "31", "kl": "32", "tn": "33", "tamilnadu": "33", "py": "34",
    "pondicherry": "34", "pondy": "34", "an": "35", "andamanandnicobar": "35", "andamannicobar": "35", "ts": "36",
    "tg": "36", "ap": "37", "la": "38",
}
_BY_NAME = {re.sub(r"[^a-z]", "", n.lower()): c for c, n in CODES.items()}
_GSTIN = re.compile(r"^\s*(\d{2})[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z]{3}\s*$")


def state_code(value) -> Optional[str]:
    """Two-digit GST state code for a GSTIN, a code ("33", 33) or a state's name / short form; None if unknown."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    m = _GSTIN.match(text)
    if m:
        code = m.group(1)
    elif re.fullmatch(r"\d{1,2}", text):
        code = text.zfill(2)
    else:
        key = re.sub(r"[^a-z]", "", text.lower())
        code = _BY_NAME.get(key) or ALIASES.get(key)
        if not code and key.endswith("islands"):
            code = ALIASES.get(key[:-7])
    code = SAME_AS.get(code, code) if code else None
    return code if code in CODES else None


def is_inter_state(supplier_state=None, supplier_gstin=None, recipient_state=None, recipient_gstin=None) -> bool:
    """True when the supply crosses a state border (IGST). GSTINs decide when present; otherwise the state names,
    compared by code; if a side is still unknown, the plain text (spaces and case ignored), as before."""
    a = state_code(supplier_gstin) or state_code(supplier_state)
    b = state_code(recipient_gstin) or state_code(recipient_state)
    if a and b:
        return a != b
    def norm(v):
        return re.sub(r"\s+", " ", str(v or "")).strip().lower()
    return norm(recipient_state) != norm(supplier_state)
