import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(path.join(__dirname, "../migrations/0001_initial.sql"), "utf-8");
const SEED = readFileSync(path.join(__dirname, "../migrations/seed.sql"), "utf-8");

let mf: Miniflare;
let cookie = "";

beforeAll(async () => {
  // Bundle the TS Worker so Miniflare can run it as a single JS module.
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, "../src/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "neutral",
    conditions: ["worker", "browser"],
    write: false,
    external: ["cloudflare:*"],
  });

  mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2024-06-20",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { JWT_SECRET: "test-secret-for-vitest-32chars-xx" },
    d1Databases: { DB: "voter_match_test" },
    kvNamespaces: ["HASH_INDEX"],
    r2Buckets: ["VOTER_FILES"],
  });

  // Apply migration + seed directly against the D1 binding.
  const db = await mf.getD1Database("DB");
  const stripped = [MIGRATION, SEED]
    .join("\n")
    .replace(/--[^\n]*\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const stmt of stripped.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
});

afterAll(async () => {
  await mf.dispose();
});

async function req(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; cookie?: string } = {},
) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie ?? cookie) headers["Cookie"] = init.cookie ?? cookie;
  const res = await mf.dispatchFetch(`https://api.test${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    body: init.body ? JSON.stringify(init.body) : undefined,
    headers,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

describe("health", () => {
  it("returns ok", async () => {
    const res = await req("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("auth", () => {
  it("rejects bad access code", async () => {
    const res = await req("/api/auth/login", { body: { accessCode: "NOPE01", phone: "5551" } });
    expect(res.status).toBe(401);
  });

  it("accepts seeded access code and sets cookie", async () => {
    const res = await req("/api/auth/login", {
      body: { accessCode: "DEMO01", phone: "+18085551212" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; salt: string };
    expect(body.role).toBe("volunteer");
    expect(body.salt).toBe("demo-salt-rotate-me");
    expect(cookie).toContain("vm_session=");
  });

  it("returns /me after login", async () => {
    const res = await req("/api/auth/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { termsAccepted: boolean };
    expect(body.termsAccepted).toBe(false);
  });

  it("accept-terms flips flag", async () => {
    const res = await req("/api/auth/accept-terms", { method: "POST" });
    expect(res.status).toBe(200);
    const me = await req("/api/auth/me");
    const body = (await me.json()) as { termsAccepted: boolean };
    expect(body.termsAccepted).toBe(true);
  });
});

describe("match rejects enumeration", () => {
  it("rejects non-hex hashes", async () => {
    const res = await req("/api/match", { body: { hashes: { phone: ["not-a-hash"] } } });
    expect(res.status).toBe(400);
  });

  it("rejects oversized bundle", async () => {
    const many = Array.from({ length: 5001 }, () => "0".repeat(64));
    const res = await req("/api/match", { body: { hashes: { phone: many } } });
    expect(res.status).toBe(400);
  });

  it("returns empty on no hashes", async () => {
    const res = await req("/api/match", { body: { hashes: {} } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [] });
  });
});

describe("admin voter file upload and match flow", () => {
  let adminCookie = "";
  let volunteerCookie = "";

  it("admin logs in", async () => {
    const res = await req("/api/auth/admin", {
      body: { adminCode: "ADMIN1" },
      cookie: "",
    });
    expect(res.status).toBe(200);
    const set = res.headers.get("set-cookie");
    adminCookie = set!.split(";")[0];
  });

  it("admin uploads voter file", async () => {
    const csv =
      "voter_id,first_name,last_name,address,city,zip,phone,party,district,last_voted\n" +
      "V1,Jane,Doe,123 Main St,Kailua,96734,808-555-1212,DEM,HD50,2024-11\n" +
      "V2,John,Roe,45 Ocean Blvd,Kailua,96734,808-555-9999,REP,HD50,2022-11\n";
    const form = new FormData();
    form.append("file", new File([csv], "voters.csv", { type: "text/csv" }));
    const res = await mf.dispatchFetch("https://api.test/api/admin/voter-file", {
      method: "POST",
      body: form as unknown as BodyInit,
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: number };
    expect(body.inserted).toBe(2);
  });

  it("volunteer logs in fresh, accepts terms, matches phone", async () => {
    const loginRes = await req("/api/auth/login", {
      body: { accessCode: "DEMO01", phone: "+18085551212" },
      cookie: "",
    });
    expect(loginRes.status).toBe(200);
    volunteerCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    const terms = await req("/api/auth/accept-terms", { method: "POST", cookie: volunteerCookie });
    expect(terms.status).toBe(200);

    const { phoneHash } = await import("@voter-match/shared");
    const h = await phoneHash("demo-salt-rotate-me", "+18085551212");
    const match = await req("/api/match", {
      body: { hashes: { phone: [h] } },
      cookie: volunteerCookie,
    });
    expect(match.status).toBe(200);
    const body = (await match.json()) as {
      matches: Array<{ matchId: string; confidence: string; matchType: string }>;
    };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].confidence).toBe("high");
    expect(body.matches[0].matchType).toBe("phone");

    const confirm = await req(`/api/matches/${body.matches[0].matchId}/confirm`, {
      body: { relationshipTag: "friend", notes: "knows Jane from school" },
      cookie: volunteerCookie,
    });
    expect(confirm.status).toBe(200);

    const list = await req("/api/my-list", { cookie: volunteerCookie });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { entries: Array<{ confirmed: boolean }> };
    expect(listBody.entries).toHaveLength(1);
    expect(listBody.entries[0].confirmed).toBe(true);

    const csvExport = await req("/api/my-list/export.csv", { cookie: volunteerCookie });
    expect(csvExport.status).toBe(200);
    const text = await csvExport.text();
    expect(text).toContain("VanID");
    expect(text).toContain("V1");
  });
});
