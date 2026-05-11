import csv as _csv
import os
import secrets
import sqlite3
import time
from io import StringIO

from . import codenames
from .hashing import name_addr_hash, name_zip_hash, phone_hash
from .normalize import normalize_phone_e164

SCHEMA = """
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jurisdiction TEXT,
  salt TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  admin_code TEXT NOT NULL UNIQUE,
  voter_file_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_districts_campaign ON districts(campaign_id);

CREATE TABLE IF NOT EXISTS voter_records (
  voter_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  district_id TEXT NOT NULL,
  first_name TEXT, last_name TEXT,
  address TEXT, city TEXT, zip TEXT,
  party TEXT, last_voted TEXT,
  phone_hash TEXT, name_zip_hash TEXT, name_addr_hash TEXT,
  PRIMARY KEY (campaign_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_voter_phone ON voter_records(campaign_id, phone_hash);
CREATE INDEX IF NOT EXISTS idx_voter_namezip ON voter_records(campaign_id, name_zip_hash);
CREATE INDEX IF NOT EXISTS idx_voter_nameaddr ON voter_records(campaign_id, name_addr_hash);
CREATE INDEX IF NOT EXISTS idx_voter_district ON voter_records(district_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volunteers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  phone TEXT NOT NULL,
  codename TEXT,
  terms_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, campaign_id),
  UNIQUE (campaign_id, codename)
);
CREATE INDEX IF NOT EXISTS idx_volunteers_user ON volunteers(user_id);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
  voter_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  match_type TEXT NOT NULL CHECK (match_type IN ('phone','name_zip','name_addr')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  relationship_tag TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (volunteer_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_volunteer ON matches(volunteer_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  volunteer_id TEXT,
  campaign_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
"""


def now_ms():
    return int(time.time() * 1000)


def random_id(prefix, n_bytes=5):
    return f"{prefix}-{secrets.token_hex(n_bytes)}"


def connect(path):
    conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn):
    conn.executescript(SCHEMA)


def seed_demo(conn):
    """Insert a demo campaign if no campaigns exist yet."""
    row = conn.execute("SELECT COUNT(*) AS n FROM campaigns").fetchone()
    if row["n"] > 0:
        return
    conn.execute(
        "INSERT INTO campaigns (id, name, jurisdiction, salt, access_code, admin_code, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("camp-demo", "Demo Campaign", "HI-HD50",
         "demo-salt-rotate-me", "DEMO01", "ADMIN1", now_ms()),
    )
    for did, name in (("dist-hd50", "HD50"), ("dist-hd51", "HD51")):
        conn.execute(
            "INSERT INTO districts (id, campaign_id, name) VALUES (?, ?, ?)",
            (did, "camp-demo", name),
        )


def record_audit(conn, *, volunteer_id, campaign_id, action, target_id=None, metadata=None):
    import json
    conn.execute(
        "INSERT INTO audit_log (id, volunteer_id, campaign_id, action, target_id, metadata, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (random_id("aud"), volunteer_id, campaign_id, action,
         target_id, json.dumps(metadata) if metadata else None, now_ms()),
    )


def upsert_user_by_phone(conn, phone):
    row = conn.execute("SELECT id FROM users WHERE phone = ?", (phone,)).fetchone()
    if row:
        return row["id"]
    uid = random_id("usr")
    conn.execute("INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)",
                 (uid, phone, now_ms()))
    return uid


def allocate_codename(conn, campaign_id):
    for _ in range(50):
        c = codenames.generate()
        taken = conn.execute(
            "SELECT 1 FROM volunteers WHERE campaign_id = ? AND codename = ?",
            (campaign_id, c),
        ).fetchone()
        if not taken:
            return c
    # Fall back to a numeric suffix if we somehow can't find one.
    return f"{codenames.generate()}-{secrets.token_hex(2)}"


# --- Voter file ingest --------------------------------------------------------

REQUIRED_COLUMNS = ("first_name", "last_name", "phone")
KNOWN_COLUMNS = (
    "voter_id", "first_name", "last_name", "address", "city",
    "zip", "phone", "party", "district", "last_voted",
)
MAX_VOTER_ROWS = 20000


def parse_voter_csv(text):
    reader = _csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        return []
    headers = [h.strip().lower() for h in reader.fieldnames]
    missing = [c for c in REQUIRED_COLUMNS if c not in headers]
    if missing:
        raise ValueError(f"Voter file missing required column: {missing[0]}")
    # rebuild reader with normalized headers
    reader = _csv.DictReader(StringIO(text))
    out = []
    for idx, raw in enumerate(reader):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        if not (row.get("first_name") and row.get("last_name") and row.get("phone")):
            continue
        record = {c: row.get(c, "") for c in KNOWN_COLUMNS}
        if not record["voter_id"]:
            record["voter_id"] = f"row-{idx + 1}"
        out.append(record)
        if len(out) > MAX_VOTER_ROWS:
            raise ValueError(f"Voter file exceeds maximum of {MAX_VOTER_ROWS} records")
    return out


def ingest_voter_file(conn, campaign_id, salt, csv_text):
    rows = parse_voter_csv(csv_text)
    version = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Districts: keep existing ids, add any new ones.
    district_ids = {}
    for r in conn.execute("SELECT id, name FROM districts WHERE campaign_id = ?",
                          (campaign_id,)):
        district_ids[r["name"]] = r["id"]
    for r in rows:
        d = r["district"]
        if d and d not in district_ids:
            did = random_id("dist", 4)
            district_ids[d] = did
            conn.execute("INSERT INTO districts (id, campaign_id, name) VALUES (?, ?, ?)",
                         (did, campaign_id, d))

    # Replace voter set for this campaign.
    conn.execute("BEGIN")
    try:
        conn.execute("DELETE FROM voter_records WHERE campaign_id = ?", (campaign_id,))
        for r in rows:
            e164 = normalize_phone_e164(r["phone"])
            ph = phone_hash(salt, e164) if e164 else None
            nz = (name_zip_hash(salt, r["first_name"], r["last_name"], r["zip"])
                  if r["first_name"] and r["last_name"] and r["zip"] else None)
            na = (name_addr_hash(salt, r["first_name"], r["last_name"], r["address"])
                  if r["first_name"] and r["last_name"] and r["address"] else None)
            conn.execute(
                "INSERT INTO voter_records (voter_id, campaign_id, district_id, first_name, last_name, "
                "address, city, zip, party, last_voted, phone_hash, name_zip_hash, name_addr_hash) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (r["voter_id"], campaign_id, district_ids.get(r["district"], ""),
                 r["first_name"], r["last_name"], r["address"], r["city"], r["zip"],
                 r["party"], r["last_voted"], ph, nz, na),
            )
        conn.execute("UPDATE campaigns SET voter_file_version = ? WHERE id = ?",
                     (version, campaign_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    return {
        "version": version,
        "total_rows": len(rows),
        "inserted": len(rows),
        "districts": sorted({r["district"] for r in rows if r["district"]}),
    }
