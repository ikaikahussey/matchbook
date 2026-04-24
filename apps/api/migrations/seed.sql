-- Seed a single test campaign for local development. Codes are intentionally
-- easy to type; rotate them before any shared-environment use.
INSERT OR IGNORE INTO campaigns (id, name, jurisdiction, salt, access_code, admin_code, created_at)
VALUES (
  'camp-demo',
  'Demo Campaign',
  'HI-HD50',
  'demo-salt-rotate-me',
  'DEMO01',
  'ADMIN1',
  strftime('%s', 'now') * 1000
);

INSERT OR IGNORE INTO districts (id, campaign_id, name) VALUES
  ('dist-hd50', 'camp-demo', 'HD50'),
  ('dist-hd51', 'camp-demo', 'HD51');
