/**
 * Normalize US-centric phone numbers to E.164.
 * Handles: formatted US numbers, extensions (stripped), international with +,
 * 10-digit US, 11-digit 1-prefixed US. Returns null when input is unparseable.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = String(raw).trim();
  if (!s) return null;

  // Strip extensions: "x1234", "ext. 1234", ", ext 5", etc.
  s = s.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, "");

  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;

  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return null;
}

export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function normalizeZip(s: string | null | undefined): string {
  const digits = (s ?? "").replace(/\D+/g, "");
  return digits.slice(0, 5);
}

export function normalizeAddress(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bapartment\b/g, "apt")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
