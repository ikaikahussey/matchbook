import { normalizeAddress, normalizeName, normalizeZip } from "./phone.js";

/**
 * Resolve a Web Crypto SubtleCrypto in both browser and Workers runtimes.
 * Node 20+ also exposes globalThis.crypto. We throw loudly if it's missing
 * so callers see a clear error rather than a silent empty string.
 */
function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto SubtleCrypto is not available in this runtime");
  }
  return c.subtle;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await getSubtle().digest("SHA-256", data);
  return toHex(digest);
}

export async function saltedHash(salt: string, value: string): Promise<string> {
  return sha256Hex(`${salt}|${value}`);
}

export async function phoneHash(salt: string, phoneE164: string): Promise<string> {
  return saltedHash(salt, `phone:${phoneE164}`);
}

export async function nameZipHash(
  salt: string,
  firstName: string,
  lastName: string,
  zip: string,
): Promise<string> {
  const key = `namezip:${normalizeName(firstName)}:${normalizeName(lastName)}:${normalizeZip(zip)}`;
  return saltedHash(salt, key);
}

export async function nameAddrHash(
  salt: string,
  firstName: string,
  lastName: string,
  address: string,
): Promise<string> {
  const key = `nameaddr:${normalizeName(firstName)}:${normalizeName(lastName)}:${normalizeAddress(address)}`;
  return saltedHash(salt, key);
}
