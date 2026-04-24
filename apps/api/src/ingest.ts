import {
  nameAddrHash,
  nameZipHash,
  normalizePhoneE164,
  parseVoterFile,
  phoneHash,
} from "@voter-match/shared";
import type { VoterFileRow } from "@voter-match/shared";
import type { Env } from "./env.js";
import { randomId } from "./id.js";

interface IngestResult {
  version: string;
  totalRows: number;
  inserted: number;
  districts: string[];
}

/**
 * Ingest a voter file CSV: parse, hash, write to D1 + KV.
 *
 * Runs synchronously inside the admin upload request. D1 batches are capped
 * at 1k statements per batch (Workers limit); we chunk accordingly. Large
 * files should be split by the caller or moved behind a queue later.
 */
export async function ingestVoterFile(
  env: Env,
  campaignId: string,
  salt: string,
  csvText: string,
): Promise<IngestResult> {
  const rows = parseVoterFile(csvText);
  const version = new Date().toISOString();
  const districts = new Set<string>();

  // Ensure a districts row exists for every district in the file.
  const existing = await env.DB.prepare(
    "SELECT name FROM districts WHERE campaign_id = ?",
  )
    .bind(campaignId)
    .all<{ name: string }>();
  const existingDistricts = new Map<string, string>();
  const allDistricts = await env.DB.prepare(
    "SELECT id, name FROM districts WHERE campaign_id = ?",
  )
    .bind(campaignId)
    .all<{ id: string; name: string }>();
  for (const d of allDistricts.results ?? []) existingDistricts.set(d.name, d.id);
  void existing;

  const districtInserts: Array<{ id: string; name: string }> = [];
  for (const r of rows) {
    districts.add(r.district);
    if (r.district && !existingDistricts.has(r.district)) {
      const id = `dist-${randomId(8).toLowerCase()}`;
      existingDistricts.set(r.district, id);
      districtInserts.push({ id, name: r.district });
    }
  }
  if (districtInserts.length > 0) {
    const stmts = districtInserts.map((d) =>
      env.DB.prepare("INSERT OR IGNORE INTO districts (id, campaign_id, name) VALUES (?, ?, ?)").bind(
        d.id,
        campaignId,
        d.name,
      ),
    );
    await env.DB.batch(stmts);
  }

  // Replace the campaign's voter set atomically enough for our purposes:
  // delete then insert. KV keys are namespaced by campaign+hash so stale
  // entries from prior versions stay addressable but no longer point to
  // rows that exist in D1. We sweep them below by writing new keys — old
  // KV entries expire with the explicit TTL we set on write.
  await env.DB.prepare("DELETE FROM voter_records WHERE campaign_id = ?").bind(campaignId).run();

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const stmts: D1PreparedStatement[] = [];
    const kvWrites: Array<Promise<unknown>> = [];

    for (const r of slice) {
      const districtId = existingDistricts.get(r.district) ?? "";
      const hashes = await computeHashes(salt, r);
      stmts.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO voter_records
           (voter_id, campaign_id, district_id, first_name, last_name, address, city, zip, party, last_voted, phone_hash, name_zip_hash, name_addr_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          r.voter_id,
          campaignId,
          districtId,
          r.first_name,
          r.last_name,
          r.address,
          r.city,
          r.zip,
          r.party,
          r.last_voted,
          hashes.phoneHash,
          hashes.nameZipHash,
          hashes.nameAddrHash,
        ),
      );

      if (hashes.phoneHash) {
        kvWrites.push(
          env.HASH_INDEX.put(kvKey(campaignId, "p", hashes.phoneHash), r.voter_id, {
            expirationTtl: 60 * 60 * 24 * 400,
          }),
        );
      }
      if (hashes.nameZipHash) {
        kvWrites.push(
          env.HASH_INDEX.put(kvKey(campaignId, "nz", hashes.nameZipHash), r.voter_id, {
            expirationTtl: 60 * 60 * 24 * 400,
          }),
        );
      }
      if (hashes.nameAddrHash) {
        kvWrites.push(
          env.HASH_INDEX.put(kvKey(campaignId, "na", hashes.nameAddrHash), r.voter_id, {
            expirationTtl: 60 * 60 * 24 * 400,
          }),
        );
      }
    }

    await env.DB.batch(stmts);
    await Promise.all(kvWrites);
    inserted += slice.length;
  }

  await env.DB.prepare("UPDATE campaigns SET voter_file_version = ? WHERE id = ?")
    .bind(version, campaignId)
    .run();

  return {
    version,
    totalRows: rows.length,
    inserted,
    districts: [...districts],
  };
}

async function computeHashes(salt: string, r: VoterFileRow) {
  const e164 = normalizePhoneE164(r.phone);
  return {
    phoneHash: e164 ? await phoneHash(salt, e164) : null,
    nameZipHash:
      r.first_name && r.last_name && r.zip
        ? await nameZipHash(salt, r.first_name, r.last_name, r.zip)
        : null,
    nameAddrHash:
      r.first_name && r.last_name && r.address
        ? await nameAddrHash(salt, r.first_name, r.last_name, r.address)
        : null,
  };
}

export function kvKey(campaignId: string, kind: "p" | "nz" | "na", hash: string): string {
  return `c:${campaignId}:${kind}:${hash}`;
}
