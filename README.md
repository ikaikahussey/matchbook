# Voter Match

Cross-reference volunteer phone contacts against a campaign voter file, privately. Hashing happens in the browser; raw contacts never leave the device.

## Stack

- **Frontend**: React 18 + Vite + Tailwind + TypeScript (`apps/web`)
- **Backend**: Hono on Cloudflare Workers (`apps/api`)
- **Database**: Cloudflare D1 (SQLite)
- **Object storage**: Cloudflare R2 (raw voter-file CSVs)
- **KV**: Cloudflare KV (hash → voter-id lookup)
- **Shared**: hashing utilities, phone normalization, vCard/CSV parsers (`packages/shared`)
- **Monorepo**: pnpm workspaces + Turborepo

## Layout

```
voter-match/
├── apps/
│   ├── api/          Hono Worker: auth, match, admin endpoints, D1/KV/R2 bindings
│   └── web/          React app: login, upload, match review, My List, admin dashboard
└── packages/
    └── shared/       Types, SHA-256 salted hashing, phone E.164, vCard + CSV parsers
```

## Local setup

Requires Node 20+ and pnpm 9+.

```bash
cd voter-match
pnpm install

# Copy secrets template and fill in a JWT secret
cp apps/api/.dev.vars.example apps/api/.dev.vars
# Generate a strong secret:
#   openssl rand -hex 32
```

### D1 setup

```bash
cd apps/api

# Create a local D1 database (wrangler will prompt to add the id to wrangler.toml)
pnpm dlx wrangler d1 create voter_match
# Paste the returned database_id into wrangler.toml [[d1_databases]].database_id

# Apply schema and seed the demo campaign
pnpm db:migrate:local
pnpm db:seed:local
```

The seed creates one demo campaign with:
- **Access code** (volunteers): `DEMO01`
- **Admin code**: `ADMIN1`
- **Salt**: `demo-salt-rotate-me` — **rotate before any shared use**

### KV + R2

```bash
pnpm dlx wrangler kv namespace create HASH_INDEX
pnpm dlx wrangler kv namespace create HASH_INDEX --preview
# Paste the two ids into wrangler.toml [[kv_namespaces]]

pnpm dlx wrangler r2 bucket create voter-match-files
pnpm dlx wrangler r2 bucket create voter-match-files-preview
```

### Run

```bash
# Terminal 1 – API worker on :8787
cd apps/api && pnpm dev

# Terminal 2 – Vite dev server on :5173 (proxies /api to :8787)
cd apps/web && pnpm dev
```

Visit http://localhost:5173.

## Typical flow

1. Admin logs in with code `ADMIN1`, uploads a voter-file CSV. The worker:
   - stores the raw CSV in R2
   - parses it, computes `phone_hash`, `name_zip_hash`, `name_addr_hash` with the campaign salt
   - writes voter records to D1 and hash→voter_id entries to KV
2. Volunteer logs in with `DEMO01` + their phone, accepts terms.
3. Volunteer uploads a vCard or Google Contacts CSV. The browser parses + hashes locally, then `POST /api/match` sends only hashes (capped at 5,000 per request).
4. Matches come back grouped by confidence tier. Volunteer confirms, rejects, tags relationships (family/coworker/neighbor/friend/acquaintance), and adds notes.
5. Confirmed matches appear on **My List**, filterable by precinct and tag, exportable as MiniVAN-compatible CSV or walk-sheet PDF.

## CSV format

Expected columns for the voter file upload:

```
voter_id,first_name,last_name,address,city,zip,phone,party,district,last_voted
```

## Privacy & security

- Client-side hashing only. Raw contacts never leave the browser.
- SHA-256 with a per-campaign salt; salt differs across campaigns so hashes don't cross-link.
- Volunteers can only read voter records that matched their hashes. There is no endpoint that enumerates voters.
- All match actions (login, match search, confirm, reject, exports) are written to `audit_log` for compliance.
- Match requests are capped at 5,000 hashes to deter enumeration attacks.
- On logout the client clears local and IndexedDB contact caches.
- Terms-of-use gate on first login; acceptance timestamp recorded in D1.

## Tests

```bash
# Run the full suite
pnpm test

# Or per-workspace
pnpm --filter @voter-match/shared test
pnpm --filter @voter-match/api test     # spins up Miniflare with D1/KV/R2
pnpm --filter @voter-match/web test
```

What's covered:

- **phone** — US-formatted, extensions (`x123`, `ext. 9`), 11-digit with leading `1`, international `+`, empty/unparseable
- **hash** — determinism, salt isolation (same input + different salt → different hash), cross-type non-collision, known-answer SHA-256
- **csv / vcard** — RFC-4180 quoted fields, CRLF, escape, Google/Apple exports, line unfolding
- **integration (shared)** — parse voter file CSV → hash → hash a vCard → verify matches land in the expected tier
- **integration (API)** — admin login → voter-file upload → volunteer login → terms → match by phone hash → confirm → My List → CSV export

## Deployment

### Manual (one-time bootstrap)

```bash
cd apps/api
pnpm dlx wrangler secret put JWT_SECRET
pnpm db:migrate:remote
pnpm exec wrangler deploy

# For the web app: point it at your Worker's URL and deploy to Pages, Workers
# Sites, or any static host. The Vite build output lives in apps/web/dist.
cd apps/web
VITE_API_BASE=https://voter-match-api.<subdomain>.workers.dev/api pnpm build
pnpm dlx wrangler pages deploy dist --project-name=voter-match
```

### CI (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main` (and via
`workflow_dispatch`). It applies D1 migrations, deploys the Worker, builds the
web app, and deploys it to Cloudflare Pages.

One-time setup:

1. **Provision Cloudflare resources** locally and paste the returned IDs into
   `apps/api/wrangler.toml`:
   ```bash
   cd apps/api
   pnpm dlx wrangler d1 create voter_match
   pnpm dlx wrangler kv namespace create HASH_INDEX
   pnpm dlx wrangler kv namespace create HASH_INDEX --preview
   pnpm dlx wrangler r2 bucket create voter-match-files
   pnpm dlx wrangler r2 bucket create voter-match-files-preview
   ```
2. **Set the JWT secret on the deployed Worker** (after the first deploy):
   ```bash
   pnpm dlx wrangler secret put JWT_SECRET
   ```
3. **Create the Pages project** (empty is fine — CI uploads builds into it):
   ```bash
   pnpm dlx wrangler pages project create voter-match --production-branch=main
   ```
4. **Add repo secrets** (Settings → Secrets and variables → Actions → Secrets):
   - `CLOUDFLARE_API_TOKEN` — scoped to `Account: Workers Scripts Edit`,
     `Account: D1 Edit`, `Account: Workers KV Storage Edit`,
     `Account: Workers R2 Storage Edit`, and `Account: Pages Edit`.
   - `CLOUDFLARE_ACCOUNT_ID` — your account ID (sidebar on the Cloudflare
     dashboard).
5. **Add repo variables** (Settings → Secrets and variables → Actions →
   Variables):
   - `VITE_API_BASE` — full Worker URL including the `/api` prefix, e.g.
     `https://voter-match-api.<subdomain>.workers.dev/api`. Leave unset only
     if the Worker and Pages share an origin (custom domain or a
     `_redirects` proxy rewrite).
   - `CF_PAGES_PROJECT` — optional; defaults to `voter-match`.

Cross-origin note: the session cookie is `SameSite=Lax`, so the browser
will only send it to the Worker when the web app and Worker share the same
registrable domain (e.g. both on `example.com`), or when `/api/*` is served
same-origin via a Pages `_redirects` proxy rewrite.

## Out of scope for v1

- Native device Contacts API (use file upload for now)
- SMS OTP
- Multi-campaign volunteer accounts
- Relationship graph visualization
- Real-time volunteer collaboration
