import { generateCodename, isValidCodename } from "@voter-match/shared";
import type { Env } from "./env.js";
import { randomId } from "./id.js";

export interface CampaignRow {
  id: string;
  name: string;
  jurisdiction: string | null;
  salt: string;
  access_code: string;
  admin_code: string;
  voter_file_version: string | null;
  created_at: number;
}

export interface VoterRow {
  voter_id: string;
  campaign_id: string;
  district_id: string;
  first_name: string | null;
  last_name: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  party: string | null;
  last_voted: string | null;
}

export async function findCampaignByAccessCode(
  env: Env,
  code: string,
): Promise<CampaignRow | null> {
  return env.DB.prepare("SELECT * FROM campaigns WHERE access_code = ?")
    .bind(code)
    .first<CampaignRow>();
}

export async function findCampaignByAdminCode(
  env: Env,
  code: string,
): Promise<CampaignRow | null> {
  return env.DB.prepare("SELECT * FROM campaigns WHERE admin_code = ?")
    .bind(code)
    .first<CampaignRow>();
}

export async function getCampaign(env: Env, id: string): Promise<CampaignRow | null> {
  return env.DB.prepare("SELECT * FROM campaigns WHERE id = ?").bind(id).first<CampaignRow>();
}

export async function getVoter(env: Env, voterId: string): Promise<VoterRow | null> {
  return env.DB.prepare(
    "SELECT voter_id, campaign_id, district_id, first_name, last_name, address, city, zip, party, last_voted FROM voter_records WHERE voter_id = ?",
  )
    .bind(voterId)
    .first<VoterRow>();
}

export interface UserRow {
  id: string;
  phone: string;
  created_at: number;
}

export interface VolunteerRow {
  id: string;
  campaign_id: string;
  user_id: string | null;
  phone: string;
  codename: string | null;
  terms_accepted_at: number | null;
  created_at: number;
}

/** Upsert a user keyed by phone. Returns the canonical user row. */
export async function upsertUserByPhone(env: Env, phone: string): Promise<UserRow> {
  const existing = await env.DB.prepare("SELECT * FROM users WHERE phone = ?")
    .bind(phone)
    .first<UserRow>();
  if (existing) return existing;
  const id = `usr-${randomId(10).toLowerCase()}`;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)")
    .bind(id, phone, now)
    .run();
  return { id, phone, created_at: now };
}

/**
 * Pick a codename not already taken in the campaign. Bounded retry — with a
 * wordlist of 45*51 = 2,295 combinations the chance of needing many tries is
 * tiny for any realistic campaign size.
 */
export async function allocateCodename(env: Env, campaignId: string): Promise<string> {
  for (let i = 0; i < 32; i++) {
    const candidate = generateCodename();
    const taken = await env.DB.prepare(
      "SELECT 1 FROM volunteers WHERE campaign_id = ? AND codename = ?",
    )
      .bind(campaignId, candidate)
      .first();
    if (!taken) return candidate;
  }
  // Fall back to a numeric suffix if every candidate collided (extremely rare).
  return `${generateCodename()}-${randomId(4).toLowerCase()}`;
}

export async function getVolunteer(env: Env, id: string): Promise<VolunteerRow | null> {
  return env.DB.prepare("SELECT * FROM volunteers WHERE id = ?")
    .bind(id)
    .first<VolunteerRow>();
}

export { isValidCodename };

export async function recordAudit(
  env: Env,
  input: {
    id: string;
    volunteerId: string | null;
    campaignId: string;
    action: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_log (id, volunteer_id, campaign_id, action, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      input.id,
      input.volunteerId,
      input.campaignId,
      input.action,
      input.targetId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      Date.now(),
    )
    .run();
}
