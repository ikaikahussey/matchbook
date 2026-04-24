import type {
  AdminStats,
  MatchResponse,
  MyListEntry,
  RelationshipTag,
  SessionInfo,
} from "@voter-match/shared";

const BASE = "/api";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error bodies are fine */
    }
    throw new Error(msg);
  }
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  login(accessCode: string, phone: string) {
    return req<SessionInfo>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ accessCode, phone }),
    });
  },
  loginAdmin(adminCode: string) {
    return req<SessionInfo>("/auth/admin", {
      method: "POST",
      body: JSON.stringify({ adminCode }),
    });
  },
  logout() {
    return req<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },
  me() {
    return req<SessionInfo>("/auth/me");
  },
  acceptTerms() {
    return req<{ ok: boolean }>("/auth/accept-terms", { method: "POST" });
  },
  match(hashes: { phone: string[]; nameZip: string[]; nameAddr: string[] }) {
    return req<MatchResponse>("/match", {
      method: "POST",
      body: JSON.stringify({ hashes }),
    });
  },
  confirmMatch(id: string, input: { relationshipTag?: RelationshipTag; notes?: string }) {
    return req<{ ok: boolean }>(`/matches/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  rejectMatch(id: string) {
    return req<{ ok: boolean }>(`/matches/${id}/reject`, { method: "POST" });
  },
  myList(filters: { precinct?: string; tag?: string } = {}) {
    const q = new URLSearchParams();
    if (filters.precinct) q.set("precinct", filters.precinct);
    if (filters.tag) q.set("tag", filters.tag);
    const suffix = q.toString() ? `?${q}` : "";
    return req<{ entries: (MyListEntry & { district: string | null })[] }>(`/my-list${suffix}`);
  },
  uploadVoterFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    return req<{ inserted: number; version: string; districts: string[] }>(
      "/admin/voter-file",
      { method: "POST", body: form },
    );
  },
  adminStats() {
    return req<AdminStats>("/admin/stats");
  },
};
