import { parseCsv } from "./csv.js";
import type { ContactCandidate } from "./types.js";

/**
 * Unfold vCard lines: lines that start with a space or tab are continuations
 * of the previous logical line per RFC 6350.
 */
function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface VCardProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProperty(line: string): VCardProperty | null {
  const colon = findUnquotedColon(line);
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf("=");
    if (eq === -1) {
      params.TYPE = (params.TYPE ? `${params.TYPE},` : "") + p.toUpperCase();
    } else {
      const k = p.slice(0, eq).toUpperCase();
      const v = p.slice(eq + 1).replace(/"/g, "");
      params[k] = k === "TYPE" ? v.toUpperCase() : v;
    }
  }
  return { name, params, value };
}

function findUnquotedColon(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) return i;
  }
  return -1;
}

export function parseVCard(text: string): ContactCandidate[] {
  const lines = unfold(text);
  const contacts: ContactCandidate[] = [];
  let current: ContactCandidate | null = null;
  let counter = 0;

  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      current = {
        localId: `vcf-${counter++}`,
        displayName: "",
        phones: [],
        addresses: [],
      };
      continue;
    }
    if (upper.startsWith("END:VCARD")) {
      if (current) {
        if (!current.displayName) {
          current.displayName = [current.firstName, current.lastName].filter(Boolean).join(" ");
        }
        contacts.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = parseProperty(line);
    if (!prop) continue;

    switch (prop.name) {
      case "FN":
        current.displayName = prop.value.trim();
        break;
      case "N": {
        // N: family;given;additional;prefix;suffix
        const parts = prop.value.split(";");
        current.lastName = parts[0]?.trim() || undefined;
        current.firstName = parts[1]?.trim() || undefined;
        break;
      }
      case "TEL":
        if (prop.value.trim()) current.phones.push(prop.value.trim());
        break;
      case "ADR": {
        // ADR: pobox;extended;street;locality;region;postal;country
        const parts = prop.value.split(";");
        current.addresses.push({
          street: parts[2]?.trim() || undefined,
          zip: parts[5]?.trim() || undefined,
        });
        break;
      }
    }
  }

  return contacts;
}

/**
 * Parse a contact CSV export (e.g., Google Contacts). Best-effort: we sniff
 * columns by common header names used by Google/Apple exports.
 */
export function parseContactsCsv(text: string): ContactCandidate[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());

  const findCol = (...candidates: string[]): number => {
    for (const c of candidates) {
      const i = header.indexOf(c);
      if (i !== -1) return i;
    }
    return -1;
  };

  const firstIdx = findCol("first name", "given name");
  const lastIdx = findCol("last name", "family name");
  const nameIdx = findCol("name", "display name", "full name");

  const phoneIdxs: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (/phone/.test(header[i]) && !/type|label/.test(header[i])) phoneIdxs.push(i);
  }

  const streetIdxs: number[] = [];
  const zipIdxs: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (/address\s*1|street/.test(header[i]) && !/type|label|country|po box/.test(header[i])) {
      streetIdxs.push(i);
    }
    if (/postal code|zip/.test(header[i])) zipIdxs.push(i);
  }

  const out: ContactCandidate[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const first = firstIdx !== -1 ? row[firstIdx]?.trim() : "";
    const last = lastIdx !== -1 ? row[lastIdx]?.trim() : "";
    const name = nameIdx !== -1 ? row[nameIdx]?.trim() : "";
    const displayName = name || [first, last].filter(Boolean).join(" ");
    if (!displayName && phoneIdxs.every((i) => !row[i]?.trim())) continue;

    const phones: string[] = [];
    for (const i of phoneIdxs) {
      const v = row[i]?.trim();
      if (v) {
        for (const p of v.split(/[:;,]+/)) {
          const q = p.trim();
          if (q) phones.push(q);
        }
      }
    }

    const addresses: Array<{ street?: string; zip?: string }> = [];
    const pairs = Math.max(streetIdxs.length, zipIdxs.length);
    for (let i = 0; i < pairs; i++) {
      const street = streetIdxs[i] !== undefined ? row[streetIdxs[i]]?.trim() : undefined;
      const zip = zipIdxs[i] !== undefined ? row[zipIdxs[i]]?.trim() : undefined;
      if (street || zip) addresses.push({ street, zip });
    }

    out.push({
      localId: `csv-${r}`,
      displayName,
      firstName: first || undefined,
      lastName: last || undefined,
      phones,
      addresses,
    });
  }
  return out;
}
