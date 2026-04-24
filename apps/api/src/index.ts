import { MAX_HASHES_PER_REQUEST } from "@voter-match/shared";
import type { MatchResponse, MatchedVoter, VoterRecord } from "@voter-match/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  type AppEnv,
  clearSessionCookie,
  requireAdmin,
  requireSession,
  sessionPayload,
  sessionTtlSeconds,
  setSessionCookie,
} from "./auth.js";
import {
  findCampaignByAccessCode,
  findCampaignByAdminCode,
  getCampaign,
  recordAudit,
} from "./db.js";
import { randomId } from "./id.js";
import { ingestVoterFile, kvKey } from "./ingest.js";
import { safeEqual, signJwt } from "./jwt.js";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------

app.post("/api/auth/login", async (c) => {
  const body = (await c.req
    .json<{ accessCode?: string; phone?: string }>()
    .catch(() => ({}) as { accessCode?: string; phone?: string }));
  const code = (body.accessCode ?? "").trim().toUpperCase();
  const rawPhone = (body.phone ?? "").trim();
  if (!code || !rawPhone) return c.json({ error: "accessCode and phone required" }, 400);

  const campaign = await findCampaignByAccessCode(c.env, code);
  if (!campaign) return c.json({ error: "invalid access code" }, 401);
  if (!safeEqual(campaign.access_code, code)) return c.json({ error: "invalid access code" }, 401);

  // Upsert volunteer by (campaign, phone).
  const existing = await c.env.DB.prepare(
    "SELECT * FROM volunteers WHERE campaign_id = ? AND phone = ?",
  )
    .bind(campaign.id, rawPhone)
    .first<{ id: string; terms_accepted_at: number | null }>();

  let volunteerId: string;
  let termsAccepted = false;
  if (existing) {
    volunteerId = existing.id;
    termsAccepted = existing.terms_accepted_at !== null;
  } else {
    volunteerId = `vol-${randomId(10).toLowerCase()}`;
    await c.env.DB.prepare(
      "INSERT INTO volunteers (id, campaign_id, phone, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(volunteerId, campaign.id, rawPhone, Date.now())
      .run();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: volunteerId,
      campaignId: campaign.id,
      role: "volunteer",
      iat: now,
      exp: now + sessionTtlSeconds(),
    },
    c.env.JWT_SECRET,
  );
  setSessionCookie(c, token);

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId,
    campaignId: campaign.id,
    action: "login",
  });

  return c.json({
    volunteerId,
    campaignId: campaign.id,
    campaignName: campaign.name,
    salt: campaign.salt,
    role: "volunteer",
    termsAccepted,
  });
});

app.post("/api/auth/admin", async (c) => {
  const body = (await c.req
    .json<{ adminCode?: string }>()
    .catch(() => ({}) as { adminCode?: string }));
  const code = (body.adminCode ?? "").trim().toUpperCase();
  if (!code) return c.json({ error: "adminCode required" }, 400);

  const campaign = await findCampaignByAdminCode(c.env, code);
  if (!campaign || !safeEqual(campaign.admin_code, code)) {
    return c.json({ error: "invalid admin code" }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const adminSub = `admin-${campaign.id}`;
  const token = await signJwt(
    {
      sub: adminSub,
      campaignId: campaign.id,
      role: "admin",
      iat: now,
      exp: now + sessionTtlSeconds(),
    },
    c.env.JWT_SECRET,
  );
  setSessionCookie(c, token);

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: null,
    campaignId: campaign.id,
    action: "admin_login",
  });

  return c.json({
    campaignId: campaign.id,
    campaignName: campaign.name,
    salt: campaign.salt,
    role: "admin",
    termsAccepted: true,
  });
});

app.post("/api/auth/logout", requireSession, async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", requireSession, async (c) => {
  const s = sessionPayload(c);
  const campaign = await getCampaign(c.env, s.campaignId);
  if (!campaign) return c.json({ error: "campaign not found" }, 404);

  let termsAccepted = true;
  if (s.role === "volunteer") {
    const v = await c.env.DB.prepare("SELECT terms_accepted_at FROM volunteers WHERE id = ?")
      .bind(s.sub)
      .first<{ terms_accepted_at: number | null }>();
    termsAccepted = v?.terms_accepted_at != null;
  }

  return c.json({
    volunteerId: s.sub,
    campaignId: campaign.id,
    campaignName: campaign.name,
    salt: campaign.salt,
    role: s.role,
    termsAccepted,
  });
});

app.post("/api/auth/accept-terms", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  await c.env.DB.prepare("UPDATE volunteers SET terms_accepted_at = ? WHERE id = ?")
    .bind(Date.now(), s.sub)
    .run();
  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "terms_accepted",
  });
  return c.json({ ok: true });
});

// -----------------------------------------------------------------------------
// Match
// -----------------------------------------------------------------------------

app.post("/api/match", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);

  // Require terms accepted before serving matches.
  const volunteer = await c.env.DB.prepare(
    "SELECT terms_accepted_at FROM volunteers WHERE id = ?",
  )
    .bind(s.sub)
    .first<{ terms_accepted_at: number | null }>();
  if (!volunteer?.terms_accepted_at) return c.json({ error: "terms not accepted" }, 403);

  type MatchBody = { hashes?: { phone?: string[]; nameZip?: string[]; nameAddr?: string[] } };
  const body = (await c.req.json<MatchBody>().catch(() => ({}) as MatchBody));
  const phone = body.hashes?.phone ?? [];
  const nameZip = body.hashes?.nameZip ?? [];
  const nameAddr = body.hashes?.nameAddr ?? [];
  const total = phone.length + nameZip.length + nameAddr.length;

  if (total === 0) return c.json<MatchResponse>({ matches: [] });
  if (total > MAX_HASHES_PER_REQUEST) {
    return c.json({ error: `too many hashes (max ${MAX_HASHES_PER_REQUEST})` }, 400);
  }
  for (const h of [...phone, ...nameZip, ...nameAddr] as string[]) {
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) {
      return c.json({ error: "hashes must be 64-char hex strings" }, 400);
    }
  }

  const toLookup: Array<{ hash: string; type: "phone" | "name_zip" | "name_addr" }> = [
    ...phone.map((h) => ({ hash: h, type: "phone" as const })),
    ...nameZip.map((h) => ({ hash: h, type: "name_zip" as const })),
    ...nameAddr.map((h) => ({ hash: h, type: "name_addr" as const })),
  ];

  const kvResults = await Promise.all(
    toLookup.map((entry) => {
      const k = kvKey(
        s.campaignId,
        entry.type === "phone" ? "p" : entry.type === "name_zip" ? "nz" : "na",
        entry.hash,
      );
      return c.env.HASH_INDEX.get(k);
    }),
  );

  // Dedup to one match per voter; keep the highest-confidence tier seen.
  const tierRank: Record<string, number> = { phone: 3, name_addr: 2, name_zip: 1 };
  const bestByVoter = new Map<
    string,
    { voterId: string; matchType: "phone" | "name_zip" | "name_addr"; matchedHash: string }
  >();
  for (let i = 0; i < kvResults.length; i++) {
    const voterId = kvResults[i];
    if (!voterId) continue;
    const entry = toLookup[i];
    const existing = bestByVoter.get(voterId);
    if (!existing || tierRank[entry.type] > tierRank[existing.matchType]) {
      bestByVoter.set(voterId, { voterId, matchType: entry.type, matchedHash: entry.hash });
    }
  }

  if (bestByVoter.size === 0) return c.json<MatchResponse>({ matches: [] });

  // Hydrate voter records, scoped to campaign.
  const voterIds = [...bestByVoter.keys()];
  const placeholders = voterIds.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT voter_id, campaign_id, district_id, first_name, last_name, address, city, zip, party, last_voted
     FROM voter_records WHERE campaign_id = ? AND voter_id IN (${placeholders})`,
  )
    .bind(s.campaignId, ...voterIds)
    .all<VoterRecord>();

  const voterMap = new Map<string, VoterRecord>();
  for (const v of results ?? []) voterMap.set(v.voter_id, v);

  // Persist the match row once per (volunteer, voter); return its id so the
  // UI can post confirm/reject against a stable handle.
  const matches: MatchedVoter[] = [];
  const now = Date.now();
  for (const { voterId, matchType, matchedHash } of bestByVoter.values()) {
    const voter = voterMap.get(voterId);
    if (!voter) continue;
    const confidence = matchType === "phone" || matchType === "name_addr" ? "high" : "medium";

    const existing = await c.env.DB.prepare(
      "SELECT id FROM matches WHERE volunteer_id = ? AND voter_id = ?",
    )
      .bind(s.sub, voterId)
      .first<{ id: string }>();

    let matchId: string;
    if (existing) {
      matchId = existing.id;
      await c.env.DB.prepare(
        "UPDATE matches SET match_type = ?, confidence = ?, updated_at = ? WHERE id = ?",
      )
        .bind(matchType, confidence, now, matchId)
        .run();
    } else {
      matchId = `mat-${randomId(10).toLowerCase()}`;
      await c.env.DB.prepare(
        `INSERT INTO matches (id, volunteer_id, voter_id, confidence, match_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(matchId, s.sub, voterId, confidence, matchType, now, now)
        .run();
    }

    matches.push({ matchId, voter, matchType, confidence, matchedHash });
  }

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "match_search",
    metadata: { hashCount: total, matched: matches.length },
  });

  return c.json<MatchResponse>({ matches });
});

// -----------------------------------------------------------------------------
// Confirm / Reject / Tag
// -----------------------------------------------------------------------------

app.post("/api/matches/:id/confirm", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  const id = c.req.param("id");
  const body = await c.req
    .json<{ relationshipTag?: string; notes?: string }>()
    .catch(() => ({} as { relationshipTag?: string; notes?: string }));

  const allowedTags = new Set(["family", "coworker", "neighbor", "friend", "acquaintance"]);
  if (body.relationshipTag && !allowedTags.has(body.relationshipTag)) {
    return c.json({ error: "invalid relationshipTag" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id FROM matches WHERE id = ? AND volunteer_id = ?",
  )
    .bind(id, s.sub)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "match not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE matches SET confirmed = 1, rejected = 0, relationship_tag = ?, notes = ?, updated_at = ?
     WHERE id = ? AND volunteer_id = ?`,
  )
    .bind(body.relationshipTag ?? null, body.notes ?? null, Date.now(), id, s.sub)
    .run();

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "match_confirm",
    targetId: id,
    metadata: { relationshipTag: body.relationshipTag },
  });

  return c.json({ ok: true });
});

app.post("/api/matches/:id/reject", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare(
    "SELECT id FROM matches WHERE id = ? AND volunteer_id = ?",
  )
    .bind(id, s.sub)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "match not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE matches SET confirmed = 0, rejected = 1, updated_at = ? WHERE id = ? AND volunteer_id = ?",
  )
    .bind(Date.now(), id, s.sub)
    .run();

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "match_reject",
    targetId: id,
  });

  return c.json({ ok: true });
});

// -----------------------------------------------------------------------------
// My List
// -----------------------------------------------------------------------------

interface MyListRow {
  match_id: string;
  voter_id: string;
  confirmed: number;
  rejected: number;
  relationship_tag: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  party: string | null;
  last_voted: string | null;
  district_id: string;
  district_name: string | null;
  confidence: string;
  match_type: string;
}

async function fetchMyList(
  c: import("hono").Context<AppEnv>,
  opts: { volunteerId: string; precinct?: string; tag?: string; includeUnconfirmed?: boolean },
): Promise<MyListRow[]> {
  const conds = ["m.volunteer_id = ?", "m.rejected = 0"];
  const args: unknown[] = [opts.volunteerId];
  if (!opts.includeUnconfirmed) conds.push("m.confirmed = 1");
  if (opts.precinct) {
    conds.push("d.name = ?");
    args.push(opts.precinct);
  }
  if (opts.tag) {
    conds.push("m.relationship_tag = ?");
    args.push(opts.tag);
  }
  const sql = `SELECT m.id as match_id, m.voter_id, m.confirmed, m.rejected, m.relationship_tag, m.notes,
                      m.created_at, m.updated_at, m.confidence, m.match_type,
                      v.first_name, v.last_name, v.address, v.city, v.zip, v.party, v.last_voted,
                      v.district_id, d.name as district_name
               FROM matches m
               JOIN voter_records v ON v.voter_id = m.voter_id
               LEFT JOIN districts d ON d.id = v.district_id
               WHERE ${conds.join(" AND ")}
               ORDER BY m.updated_at DESC`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(...args)
    .all<MyListRow>();
  return results ?? [];
}

app.get("/api/my-list", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  const precinct = c.req.query("precinct") || undefined;
  const tag = c.req.query("tag") || undefined;
  const includeUnconfirmed = c.req.query("pending") === "1";
  const rows = await fetchMyList(c, { volunteerId: s.sub, precinct, tag, includeUnconfirmed });
  return c.json({
    entries: rows.map((r) => ({
      matchId: r.match_id,
      confirmed: r.confirmed === 1,
      rejected: r.rejected === 1,
      confidence: r.confidence,
      matchType: r.match_type,
      relationshipTag: r.relationship_tag,
      notes: r.notes,
      createdAt: r.created_at,
      voter: {
        voter_id: r.voter_id,
        campaign_id: s.campaignId,
        district_id: r.district_id,
        first_name: r.first_name,
        last_name: r.last_name,
        address: r.address,
        city: r.city,
        zip: r.zip,
        party: r.party,
        last_voted: r.last_voted,
      },
      district: r.district_name,
    })),
  });
});

app.get("/api/my-list/export.csv", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  const precinct = c.req.query("precinct") || undefined;
  const tag = c.req.query("tag") || undefined;
  const rows = await fetchMyList(c, { volunteerId: s.sub, precinct, tag });

  // MiniVAN-compatible columns (subset used by their walk-list importer).
  const columns = [
    "VanID",
    "LastName",
    "FirstName",
    "StreetAddress",
    "City",
    "Zip5",
    "Party",
    "RelationshipTag",
    "Notes",
  ];
  const { csvEscape } = await import("@voter-match/shared");
  const header = columns.join(",");
  const body = rows
    .map((r) =>
      [
        r.voter_id,
        r.last_name ?? "",
        r.first_name ?? "",
        r.address ?? "",
        r.city ?? "",
        r.zip ?? "",
        r.party ?? "",
        r.relationship_tag ?? "",
        r.notes ?? "",
      ]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "my_list_export_csv",
    metadata: { count: rows.length },
  });

  return new Response(`${header}\n${body}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="my-list.csv"',
    },
  });
});

app.get("/api/my-list/export.pdf", requireSession, async (c) => {
  const s = sessionPayload(c);
  if (s.role !== "volunteer") return c.json({ error: "volunteers only" }, 403);
  const precinct = c.req.query("precinct") || undefined;
  const tag = c.req.query("tag") || undefined;
  const rows = await fetchMyList(c, { volunteerId: s.sub, precinct, tag });

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: s.sub,
    campaignId: s.campaignId,
    action: "my_list_export_pdf",
    metadata: { count: rows.length },
  });

  const pdf = buildWalkSheetPdf(rows);
  // Wrap in a new ArrayBuffer copy so TS sees a plain ArrayBuffer (not a
  // shared-buffer Uint8Array) for BodyInit.
  const body = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(body).set(pdf);
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="walk-sheet.pdf"',
    },
  });
});

// -----------------------------------------------------------------------------
// Admin
// -----------------------------------------------------------------------------

app.post("/api/admin/voter-file", requireSession, requireAdmin, async (c) => {
  const s = sessionPayload(c);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file field missing" }, 400);

  const csvText = await file.text();
  const campaign = await getCampaign(c.env, s.campaignId);
  if (!campaign) return c.json({ error: "campaign not found" }, 404);

  // Stash raw CSV in R2. Key includes campaign and timestamp so past versions
  // remain auditable. Raw bytes are never exposed to volunteers.
  const objectKey = `campaigns/${campaign.id}/voter-file-${Date.now()}.csv`;
  await c.env.VOTER_FILES.put(objectKey, csvText, {
    httpMetadata: { contentType: "text/csv" },
  });

  const result = await ingestVoterFile(c.env, campaign.id, campaign.salt, csvText);

  await recordAudit(c.env, {
    id: `aud-${randomId(10).toLowerCase()}`,
    volunteerId: null,
    campaignId: campaign.id,
    action: "voter_file_upload",
    targetId: objectKey,
    metadata: { inserted: result.inserted, version: result.version },
  });

  return c.json({ objectKey, ...result });
});

app.get("/api/admin/stats", requireSession, requireAdmin, async (c) => {
  const s = sessionPayload(c);
  const volunteers = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM volunteers WHERE campaign_id = ?",
  )
    .bind(s.campaignId)
    .first<{ n: number }>();

  const uniqueVoters = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT m.voter_id) as n
     FROM matches m JOIN voter_records v ON v.voter_id = m.voter_id
     WHERE v.campaign_id = ? AND m.confirmed = 1`,
  )
    .bind(s.campaignId)
    .first<{ n: number }>();

  const perDistrict = await c.env.DB.prepare(
    `SELECT d.name as district,
            COUNT(DISTINCT v.voter_id) as total,
            COUNT(DISTINCT CASE WHEN m.confirmed = 1 THEN m.voter_id END) as covered
     FROM districts d
     LEFT JOIN voter_records v ON v.district_id = d.id
     LEFT JOIN matches m ON m.voter_id = v.voter_id
     WHERE d.campaign_id = ?
     GROUP BY d.id, d.name`,
  )
    .bind(s.campaignId)
    .all<{ district: string; total: number; covered: number }>();

  const coverage = (perDistrict.results ?? []).map((r) => ({
    district: r.district,
    total: r.total,
    covered: r.covered,
    percent: r.total === 0 ? 0 : Math.round((r.covered / r.total) * 1000) / 10,
  }));

  return c.json({
    volunteersEnrolled: volunteers?.n ?? 0,
    uniqueVotersWithRelationship: uniqueVoters?.n ?? 0,
    coverageByPrecinct: coverage,
  });
});

// -----------------------------------------------------------------------------
// PDF generation (minimal, dependency-free)
// -----------------------------------------------------------------------------

function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildWalkSheetPdf(rows: MyListRow[]): Uint8Array {
  const title = "Voter Match — Walk Sheet";
  const lines: string[] = [`${title}`, `Generated ${new Date().toISOString()}`, ""];
  if (rows.length === 0) {
    lines.push("No confirmed matches yet.");
  } else {
    for (const r of rows) {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
      const addr = [r.address, r.city, r.zip].filter(Boolean).join(", ");
      lines.push(`- ${name}  (${r.party ?? "N/A"})`);
      lines.push(`    ${addr}`);
      lines.push(`    tag: ${r.relationship_tag ?? "-"}  last voted: ${r.last_voted ?? "-"}`);
      if (r.notes) lines.push(`    notes: ${r.notes}`);
      lines.push("");
    }
  }

  const content =
    `BT /F1 12 Tf 54 770 Td 14 TL ` +
    lines
      .map((l, i) => (i === 0 ? `(${escapePdfString(l)}) Tj` : `T* (${escapePdfString(l)}) Tj`))
      .join(" ") +
    " ET";

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  );
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export default app;
