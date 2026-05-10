import re
import unicodedata

_EXT_RE = re.compile(r"\s*(?:x|ext\.?|extension)\s*\d+\s*$", re.IGNORECASE)
_NON_DIGIT = re.compile(r"\D+")
_NON_ALNUM = re.compile(r"[^a-z0-9]")
_COMBINING = re.compile(r"[̀-ͯ]")

_ADDR_WORDS = [
    (re.compile(r"\bstreet\b"), "st"),
    (re.compile(r"\bavenue\b"), "ave"),
    (re.compile(r"\bboulevard\b"), "blvd"),
    (re.compile(r"\broad\b"), "rd"),
    (re.compile(r"\bdrive\b"), "dr"),
    (re.compile(r"\blane\b"), "ln"),
    (re.compile(r"\bcourt\b"), "ct"),
    (re.compile(r"\bapartment\b"), "apt"),
]


def normalize_phone_e164(raw):
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = _EXT_RE.sub("", s)
    has_plus = s.startswith("+")
    digits = _NON_DIGIT.sub("", s)
    if not digits:
        return None
    if has_plus:
        if len(digits) < 8 or len(digits) > 15:
            return None
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    if 11 <= len(digits) <= 15:
        return "+" + digits
    return None


def normalize_name(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).lower()
    s = _COMBINING.sub("", s)
    return _NON_ALNUM.sub("", s).strip()


def normalize_zip(s):
    if not s:
        return ""
    return _NON_DIGIT.sub("", s)[:5]


def normalize_address(s):
    if not s:
        return ""
    s = s.lower()
    for pat, repl in _ADDR_WORDS:
        s = pat.sub(repl, s)
    return _NON_ALNUM.sub("", s).strip()
