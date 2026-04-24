import type { Env } from "./env.js";

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
