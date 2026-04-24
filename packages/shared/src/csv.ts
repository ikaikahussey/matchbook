/**
 * Tiny RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes,
 * embedded newlines and commas. Not intended for arbitrary dialects —
 * voter files and MiniVAN exports stick to the common subset.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Trailing field/row (file without terminating newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Array<Record<string, string | number | null | undefined>>, columns: string[]): string {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export interface VoterFileRow {
  voter_id: string;
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  party: string;
  district: string;
  last_voted: string;
}

const REQUIRED_COLUMNS: Array<keyof VoterFileRow> = [
  "voter_id",
  "first_name",
  "last_name",
  "address",
  "city",
  "zip",
  "phone",
  "party",
  "district",
  "last_voted",
];

export function parseVoterFile(text: string): VoterFileRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) {
    const i = header.indexOf(col);
    if (i === -1) throw new Error(`Voter file missing required column: ${col}`);
    idx[col] = i;
  }

  const out: VoterFileRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (c: keyof VoterFileRow) => (row[idx[c]] ?? "").trim();
    if (!get("voter_id")) continue;
    out.push({
      voter_id: get("voter_id"),
      first_name: get("first_name"),
      last_name: get("last_name"),
      address: get("address"),
      city: get("city"),
      zip: get("zip"),
      phone: get("phone"),
      party: get("party"),
      district: get("district"),
      last_voted: get("last_voted"),
    });
  }
  return out;
}
