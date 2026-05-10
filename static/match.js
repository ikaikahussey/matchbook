// Browser-side parse + hash. Mirrors voter_match/normalize.py and hashing.py
// so server-side voter-file hashes line up with client-side contact hashes.

const SALT = window.VM_SALT;
const MAX_HASHES = window.VM_MAX_HASHES;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("contact-file").addEventListener("change", onFile);
});

async function onFile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const status = $("status");
  const error = $("error");
  error.hidden = true;
  status.textContent = "Parsing…";
  try {
    const text = await file.text();
    const contacts = file.name.toLowerCase().endsWith(".csv")
      ? parseContactsCsv(text)
      : parseVCard(text);
    status.textContent = `Parsed ${contacts.length} contacts. Hashing…`;

    const bundle = await hashContacts(SALT, contacts);
    const total = bundle.phone.length + bundle.nameZip.length + bundle.nameAddr.length;
    status.textContent = `${contacts.length} contacts → ${total} hashes. Matching…`;

    if (total === 0) {
      showError("No usable phone numbers or name+address pairs found.");
      return;
    }
    if (total > MAX_HASHES) {
      showError(`This file produced ${total} hashes (limit ${MAX_HASHES}). Split it.`);
      return;
    }

    const resp = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: bundle }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `match failed (${resp.status})`);
    }
    const data = await resp.json();
    const byLocal = new Map(contacts.map((c) => [c.localId, c]));
    render(data.matches, bundle.byHash, byLocal);
    status.textContent = `${data.matches.length} matches.`;
  } catch (err) {
    showError(err.message || String(err));
    status.textContent = "";
  }
}

function showError(msg) {
  const error = $("error");
  error.textContent = msg;
  error.hidden = false;
}

function render(matches, byHash, byLocal) {
  const wrap = $("results");
  const list = $("match-list");
  list.innerHTML = "";
  wrap.hidden = matches.length === 0;
  const tpl = $("match-tpl");
  for (const m of matches) {
    const node = tpl.content.cloneNode(true);
    const v = m.voter;
    node.querySelector(".who").textContent = `${v.first_name || ""} ${v.last_name || ""}`.trim();
    node.querySelector(".addr").textContent = [v.address, v.city, v.zip].filter(Boolean).join(", ");
    node.querySelector(".meta").textContent =
      `Party: ${v.party || "N/A"} · Last voted: ${v.last_voted || "N/A"}`;
    node.querySelector(".confidence").textContent = m.confidence;
    node.querySelector(".tier").textContent = m.matchType;
    const origin = byHash[m.matchedHash];
    if (origin) {
      const c = byLocal.get(origin.localId);
      if (c) node.querySelector(".contact-label").textContent = `Matched your contact: ${c.displayName}`;
    }
    const article = node.querySelector(".match");
    const tagSel = node.querySelector(".tag");
    const notesIn = node.querySelector(".notes");
    const stateEl = node.querySelector(".state");
    node.querySelector(".confirm").addEventListener("click", async () => {
      stateEl.textContent = "saving…";
      const r = await fetch(`/api/matches/${m.matchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationshipTag: tagSel.value || null, notes: notesIn.value || null }),
      });
      stateEl.textContent = r.ok ? "confirmed" : "error";
      if (r.ok) article.classList.add("ok");
    });
    node.querySelector(".reject").addEventListener("click", async () => {
      stateEl.textContent = "saving…";
      const r = await fetch(`/api/matches/${m.matchId}/reject`, { method: "POST" });
      stateEl.textContent = r.ok ? "rejected" : "error";
      if (r.ok) article.style.opacity = 0.5;
    });
    list.appendChild(node);
  }
}

// ---------- normalize ----------
function normalizeName(s) {
  return (s || "").toLowerCase().normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/[^a-z0-9]/g, "").trim();
}
function normalizeZip(s) { return ((s || "").replace(/\D+/g, "")).slice(0, 5); }
function normalizeAddress(s) {
  if (!s) return "";
  return s.toLowerCase()
    .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd").replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr").replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct").replace(/\bapartment\b/g, "apt")
    .replace(/[^a-z0-9]/g, "").trim();
}
function normalizePhoneE164(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, "");
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return "+" + digits;
  }
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length >= 11 && digits.length <= 15) return "+" + digits;
  return null;
}

// ---------- hash ----------
async function sha256Hex(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const phoneHash = (salt, e) => sha256Hex(`${salt}|phone:${e}`);
const nameZipHash = (salt, f, l, z) =>
  sha256Hex(`${salt}|namezip:${normalizeName(f)}:${normalizeName(l)}:${normalizeZip(z)}`);
const nameAddrHash = (salt, f, l, a) =>
  sha256Hex(`${salt}|nameaddr:${normalizeName(f)}:${normalizeName(l)}:${normalizeAddress(a)}`);

async function hashContacts(salt, contacts) {
  const bundle = { phone: [], nameZip: [], nameAddr: [], byHash: {} };
  const seen = { phone: new Set(), nameZip: new Set(), nameAddr: new Set() };
  for (const c of contacts) {
    const first = c.firstName || splitFirst(c.displayName);
    const last = c.lastName || splitLast(c.displayName);
    for (const raw of c.phones) {
      const e164 = normalizePhoneE164(raw);
      if (!e164) continue;
      const h = await phoneHash(salt, e164);
      if (!seen.phone.has(h)) { seen.phone.add(h); bundle.phone.push(h); }
      bundle.byHash[h] = { localId: c.localId, type: "phone" };
    }
    if (first && last) {
      for (const a of c.addresses) {
        if (a.zip) {
          const h = await nameZipHash(salt, first, last, a.zip);
          if (!seen.nameZip.has(h)) { seen.nameZip.add(h); bundle.nameZip.push(h); }
          bundle.byHash[h] = { localId: c.localId, type: "name_zip" };
        }
        if (a.street) {
          const h = await nameAddrHash(salt, first, last, a.street);
          if (!seen.nameAddr.has(h)) { seen.nameAddr.add(h); bundle.nameAddr.push(h); }
          bundle.byHash[h] = { localId: c.localId, type: "name_addr" };
        }
      }
    }
  }
  return bundle;
}
const splitFirst = (n) => (n || "").trim().split(/\s+/)[0] || "";
const splitLast = (n) => {
  const p = (n || "").trim().split(/\s+/);
  return p.length > 1 ? p[p.length - 1] : "";
};

// ---------- vCard ----------
function unfold(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else out.push(line);
  }
  return out;
}
function findColon(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (s[i] === ":" && !q) return i;
  }
  return -1;
}
function parseVCard(text) {
  const lines = unfold(text);
  const out = [];
  let cur = null, n = 0;
  for (const line of lines) {
    if (!line) continue;
    const u = line.toUpperCase();
    if (u.startsWith("BEGIN:VCARD")) {
      cur = { localId: `vcf-${n++}`, displayName: "", phones: [], addresses: [] };
      continue;
    }
    if (u.startsWith("END:VCARD")) {
      if (cur) {
        if (!cur.displayName) cur.displayName = [cur.firstName, cur.lastName].filter(Boolean).join(" ");
        out.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = findColon(line);
    if (colon === -1) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(";")[0].toUpperCase();
    if (name === "FN") cur.displayName = value.trim();
    else if (name === "N") {
      const p = value.split(";");
      cur.lastName = (p[0] || "").trim() || undefined;
      cur.firstName = (p[1] || "").trim() || undefined;
    } else if (name === "TEL") {
      if (value.trim()) cur.phones.push(value.trim());
    } else if (name === "ADR") {
      const p = value.split(";");
      cur.addresses.push({ street: (p[2] || "").trim() || undefined,
                           zip: (p[5] || "").trim() || undefined });
    }
  }
  return out;
}

// ---------- contacts CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}
function parseContactsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...c) => { for (const x of c) { const i = header.indexOf(x); if (i !== -1) return i; } return -1; };
  const firstIdx = find("first name", "given name");
  const lastIdx = find("last name", "family name");
  const nameIdx = find("name", "display name", "full name");
  const phoneIdxs = []; const streetIdxs = []; const zipIdxs = [];
  for (let i = 0; i < header.length; i++) {
    if (/phone/.test(header[i]) && !/type|label/.test(header[i])) phoneIdxs.push(i);
    if (/address\s*1|street/.test(header[i]) && !/type|label|country|po box/.test(header[i])) streetIdxs.push(i);
    if (/postal code|zip/.test(header[i])) zipIdxs.push(i);
  }
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const first = firstIdx !== -1 ? (row[firstIdx] || "").trim() : "";
    const last = lastIdx !== -1 ? (row[lastIdx] || "").trim() : "";
    const name = nameIdx !== -1 ? (row[nameIdx] || "").trim() : "";
    const displayName = name || [first, last].filter(Boolean).join(" ");
    if (!displayName && phoneIdxs.every((i) => !(row[i] || "").trim())) continue;
    const phones = [];
    for (const i of phoneIdxs) {
      const v = (row[i] || "").trim();
      if (v) for (const p of v.split(/[:;,]+/)) { const q2 = p.trim(); if (q2) phones.push(q2); }
    }
    const addresses = [];
    const pairs = Math.max(streetIdxs.length, zipIdxs.length);
    for (let i = 0; i < pairs; i++) {
      const street = streetIdxs[i] !== undefined ? (row[streetIdxs[i]] || "").trim() : undefined;
      const zip = zipIdxs[i] !== undefined ? (row[zipIdxs[i]] || "").trim() : undefined;
      if (street || zip) addresses.push({ street: street || undefined, zip: zip || undefined });
    }
    out.push({ localId: `csv-${r}`, displayName, firstName: first || undefined,
               lastName: last || undefined, phones, addresses });
  }
  return out;
}
