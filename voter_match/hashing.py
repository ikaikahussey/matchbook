import hashlib

from .normalize import normalize_address, normalize_name, normalize_zip


def _sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def salted_hash(salt, value):
    return _sha256_hex(f"{salt}|{value}")


def phone_hash(salt, phone_e164):
    return salted_hash(salt, f"phone:{phone_e164}")


def name_zip_hash(salt, first, last, zip_code):
    key = f"namezip:{normalize_name(first)}:{normalize_name(last)}:{normalize_zip(zip_code)}"
    return salted_hash(salt, key)


def name_addr_hash(salt, first, last, address):
    key = f"nameaddr:{normalize_name(first)}:{normalize_name(last)}:{normalize_address(address)}"
    return salted_hash(salt, key)
