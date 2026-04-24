import { nameAddrHash, nameZipHash, phoneHash } from "./hash.js";
import { normalizePhoneE164 } from "./phone.js";
import type { ContactCandidate, HashBundle } from "./types.js";

export const MAX_HASHES_PER_REQUEST = 5000;

/**
 * Given a list of contacts parsed client-side, produce the bundle of hashes
 * we send to the server. Raw PII never leaves this function's caller.
 *
 * The `byHash` reverse map lives only in memory so the match response can be
 * re-associated with the contact's local display name for the review UI.
 */
export async function hashContacts(
  salt: string,
  contacts: ContactCandidate[],
): Promise<HashBundle> {
  const bundle: HashBundle = { phone: [], nameZip: [], nameAddr: [], byHash: {} };
  const phoneSeen = new Set<string>();
  const nameZipSeen = new Set<string>();
  const nameAddrSeen = new Set<string>();

  for (const c of contacts) {
    const first = c.firstName ?? splitFirst(c.displayName);
    const last = c.lastName ?? splitLast(c.displayName);

    for (const rawPhone of c.phones) {
      const e164 = normalizePhoneE164(rawPhone);
      if (!e164) continue;
      const h = await phoneHash(salt, e164);
      if (!phoneSeen.has(h)) {
        phoneSeen.add(h);
        bundle.phone.push(h);
      }
      bundle.byHash[h] = { localId: c.localId, type: "phone" };
    }

    if (first && last) {
      for (const addr of c.addresses) {
        if (addr.zip) {
          const h = await nameZipHash(salt, first, last, addr.zip);
          if (!nameZipSeen.has(h)) {
            nameZipSeen.add(h);
            bundle.nameZip.push(h);
          }
          bundle.byHash[h] = { localId: c.localId, type: "name_zip" };
        }
        if (addr.street) {
          const h = await nameAddrHash(salt, first, last, addr.street);
          if (!nameAddrSeen.has(h)) {
            nameAddrSeen.add(h);
            bundle.nameAddr.push(h);
          }
          bundle.byHash[h] = { localId: c.localId, type: "name_addr" };
        }
      }
    }
  }

  return bundle;
}

function splitFirst(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts[0] ?? "";
}

function splitLast(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}
