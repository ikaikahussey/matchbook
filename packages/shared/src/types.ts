export type Confidence = "high" | "medium" | "low";
export type MatchType = "phone" | "name_zip" | "name_addr";
export type RelationshipTag = "family" | "coworker" | "neighbor" | "friend" | "acquaintance";

export interface Campaign {
  id: string;
  name: string;
  jurisdiction: string | null;
  salt: string;
  voter_file_version: string | null;
  created_at: number;
}

export interface VoterRecord {
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

export interface ContactCandidate {
  localId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  phones: string[];
  addresses: Array<{ street?: string; zip?: string }>;
}

export interface HashBundle {
  phone: string[];
  nameZip: string[];
  nameAddr: string[];
  // Reverse index so the client can re-associate a hash with the local contact
  // that produced it, without ever sending the raw contact to the server.
  byHash: Record<string, { localId: string; type: MatchType }>;
}

export interface MatchRequest {
  hashes: {
    phone: string[];
    nameZip: string[];
    nameAddr: string[];
  };
}

export interface MatchedVoter {
  matchId: string;
  voter: VoterRecord;
  matchType: MatchType;
  confidence: Confidence;
  matchedHash: string;
}

export interface MatchResponse {
  matches: MatchedVoter[];
}

export interface MyListEntry {
  matchId: string;
  voter: VoterRecord;
  confirmed: boolean;
  relationshipTag: RelationshipTag | null;
  notes: string | null;
  createdAt: number;
}

export interface SessionInfo {
  volunteerId: string;
  campaignId: string;
  campaignName: string;
  salt: string;
  role: "volunteer" | "admin";
  termsAccepted: boolean;
  codename?: string | null;
}

export interface CampaignMembership {
  volunteerId: string;
  campaignId: string;
  campaignName: string;
  codename: string | null;
  isCurrent: boolean;
}

export interface RelationshipEntry {
  matchId: string;
  voterId: string;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  zip: string | null;
  district: string | null;
  relationshipTag: RelationshipTag | null;
  notes: string | null;
  updatedAt: number;
}

export interface CampaignRelationships {
  campaignId: string;
  campaignName: string;
  codename: string | null;
  relationships: RelationshipEntry[];
}

export interface AdminStats {
  volunteersEnrolled: number;
  uniqueVotersWithRelationship: number;
  coverageByPrecinct: Array<{ district: string; total: number; covered: number; percent: number }>;
}
