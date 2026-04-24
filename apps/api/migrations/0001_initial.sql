CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jurisdiction TEXT,
  salt TEXT NOT NULL,
  access_code TEXT NOT NULL,
  admin_code TEXT NOT NULL,
  voter_file_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_access_code ON campaigns(access_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_admin_code ON campaigns(admin_code);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_districts_campaign ON districts(campaign_id);

CREATE TABLE IF NOT EXISTS voter_records (
  voter_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  district_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  address TEXT,
  city TEXT,
  zip TEXT,
  party TEXT,
  last_voted TEXT,
  phone_hash TEXT,
  name_zip_hash TEXT,
  name_addr_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_voter_phone_hash ON voter_records(phone_hash);
CREATE INDEX IF NOT EXISTS idx_voter_name_zip_hash ON voter_records(name_zip_hash);
CREATE INDEX IF NOT EXISTS idx_voter_name_addr_hash ON voter_records(name_addr_hash);
CREATE INDEX IF NOT EXISTS idx_voter_campaign ON voter_records(campaign_id);
CREATE INDEX IF NOT EXISTS idx_voter_district ON voter_records(district_id);

CREATE TABLE IF NOT EXISTS volunteers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  terms_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_volunteers_campaign ON volunteers(campaign_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_volunteers_phone_campaign ON volunteers(campaign_id, phone);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  volunteer_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  match_type TEXT NOT NULL CHECK (match_type IN ('phone','name_zip','name_addr')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  relationship_tag TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (volunteer_id) REFERENCES volunteers(id),
  FOREIGN KEY (voter_id) REFERENCES voter_records(voter_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_volunteer ON matches(volunteer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_vol_voter ON matches(volunteer_id, voter_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  volunteer_id TEXT,
  campaign_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_volunteer ON audit_log(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_audit_campaign ON audit_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
