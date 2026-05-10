# Voter Match

Cross-reference volunteer phone contacts against a campaign voter file,
privately. Hashing happens in the browser; raw contacts never leave the device.

A single Python (Flask) process backed by SQLite. Run it on a laptop, a tiny
VPS, or anywhere you can install Python 3.10+.

## Stack

- **Backend**: Flask + sqlite3 (stdlib). One process. WAL mode.
- **Frontend**: server-rendered HTML + a single vanilla-JS file
  (`static/match.js`) that parses contacts and SHA-256-hashes them in the
  browser using the Web Crypto API.
- **Persistence**: one SQLite database file, plus raw uploaded voter-file
  CSVs stashed alongside it for audit purposes.

No build step. No bundler. No Workers, KV, R2, D1, or Pages.

## Layout

```
matchbook/
├── app.py                     Flask app, all routes
├── voter_match/
│   ├── normalize.py           phone / name / zip / address normalization
│   ├── hashing.py             salted SHA-256 helpers (server-side ingest)
│   ├── codenames.py           two-word handle wordlist
│   ├── walk_sheet.py          dependency-free PDF generator
│   └── db.py                  schema, seed, voter-file ingest
├── templates/                 Jinja2 HTML
├── static/
│   ├── match.js               browser-side parser + hasher + UI
│   └── style.css
└── requirements.txt
```

## Run

Requires Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# First run creates voter_match.db and seeds a demo campaign.
VOTER_MATCH_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')" \
  python app.py
```

Visit http://localhost:8000.

The seed creates one demo campaign with:
- **Access code** (volunteers): `DEMO01`
- **Admin code**: `ADMIN1`
- **Salt**: `demo-salt-rotate-me` — **rotate before any shared use** by
  editing the `campaigns` row directly.

### Environment variables

| Variable             | Default              | Notes |
| -------------------- | -------------------- | ----- |
| `VOTER_MATCH_DB`     | `voter_match.db`     | SQLite path. |
| `VOTER_MATCH_SECRET` | `dev-secret-...`     | Flask session signing key. **Set this in production.** |
| `HOST`               | `0.0.0.0`            | Bind address. |
| `PORT`               | `8000`               | Bind port. |
| `DEBUG`              | unset                | Set to `1` to enable Flask debug mode. |

## Typical flow

1. Admin signs in with code `ADMIN1`, uploads a voter-file CSV. The server
   parses it, computes `phone_hash`, `name_zip_hash`, `name_addr_hash` with the
   campaign salt, and writes voter records to SQLite. The raw CSV is also
   stashed under `voter_files/` next to the database for audit.
2. Volunteer signs in with `DEMO01` + their phone number. They get assigned
   a two-word codename (e.g. `azure-falcon`).
3. Volunteer accepts the terms, then uploads a vCard or Google/Apple Contacts
   CSV. The browser parses + hashes locally, and `POST /api/match` sends only
   hashes (capped at 5,000 per request).
4. Matches come back grouped by confidence tier. The volunteer confirms,
   rejects, tags relationships (family / friend / neighbor / coworker /
   acquaintance), and adds notes.
5. Confirmed matches appear on **My List**, filterable by precinct and tag,
   exportable as a MiniVAN-compatible CSV or a walk-sheet PDF.

## Voter file CSV format

```
voter_id,first_name,last_name,address,city,zip,phone,party,district,last_voted
```

All columns required. Empty cells are tolerated, but rows missing `voter_id`
are skipped.

## Privacy & security

- Client-side hashing only. Raw contacts never leave the browser.
- SHA-256 with a per-campaign salt; salt differs across campaigns so hashes
  don't cross-link.
- Volunteers can only read voter records that matched their hashes. No
  endpoint enumerates voters.
- All match actions (login, match search, confirm, reject, exports) are
  written to `audit_log`.
- Match requests are capped at 5,000 hashes to deter enumeration attacks.
- Terms-of-use gate on first login; acceptance timestamp recorded in SQLite.

## Production hardening (when you put this on a server)

- Run behind a real WSGI server, e.g. `gunicorn -w 2 -b 0.0.0.0:8000 app:app`,
  fronted by nginx or Caddy with HTTPS.
- Set `VOTER_MATCH_SECRET` to a long random value (rotate to invalidate
  sessions).
- Mount the DB on persistent storage and back it up. SQLite WAL mode is on
  by default; `sqlite3 voter_match.db ".backup my-backup.db"` is a safe
  online snapshot.
- Rotate the demo `salt` and access codes before letting anyone else log in.

## Out of scope

- Native device Contacts API (use file upload).
- SMS OTP login.
- Real-time volunteer collaboration.
- Sharded/horizontal scaling (this is a one-process app on purpose).
