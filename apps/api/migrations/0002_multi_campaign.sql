-- Multi-campaign volunteer accounts.
-- A single phone-number-based identity (users) can join many campaigns;
-- volunteers becomes a per-campaign membership with a friendly codename.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

ALTER TABLE volunteers ADD COLUMN user_id TEXT;
ALTER TABLE volunteers ADD COLUMN codename TEXT;

-- Backfill: one user per distinct phone, link existing volunteers to it.
-- Codenames are NOT backfilled here; the API assigns one on next login if
-- still NULL (the wordlist lives in TypeScript, not SQL).
INSERT OR IGNORE INTO users (id, phone, created_at)
  SELECT 'usr-' || lower(hex(randomblob(5))), phone, MIN(created_at)
  FROM volunteers
  GROUP BY phone;

UPDATE volunteers
  SET user_id = (SELECT id FROM users WHERE users.phone = volunteers.phone)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_volunteers_user ON volunteers(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_volunteers_user_campaign ON volunteers(user_id, campaign_id);
-- NULL codenames are allowed (SQLite treats NULLs as distinct in UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_volunteers_codename_campaign ON volunteers(campaign_id, codename);
