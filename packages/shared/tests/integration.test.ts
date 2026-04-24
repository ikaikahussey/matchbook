import { describe, expect, it } from "vitest";
import { parseVoterFile } from "../src/csv.js";
import { hashContacts } from "../src/contactHasher.js";
import { nameAddrHash, nameZipHash, phoneHash } from "../src/hash.js";
import { parseVCard } from "../src/vcard.js";

/**
 * End-to-end flow that mirrors what the API ingestion job and client
 * hashing will each do. We build a voter file, hash it the way the server
 * will, then hash a vCard the way the browser will, and verify matches land
 * with the expected tier.
 */
describe("integration: voter file ↔ contact hashing", () => {
  const salt = "test-salt-12345";
  const voterCsv = [
    "voter_id,first_name,last_name,address,city,zip,phone,party,district,last_voted",
    "V1,Jane,Doe,123 Main St,Kailua,96734,808-555-1212,DEM,HD50,2024-11",
    "V2,John,Roe,45 Ocean Blvd,Kailua,96734,808-555-9999,REP,HD50,2022-11",
    "V3,Sam,Smith,9 Beach Rd,Kailua,96734,,NP,HD50,2020-11",
  ].join("\n");

  it("phone, name+zip, and name+addr all match", async () => {
    const voters = parseVoterFile(voterCsv);

    // Build server-side hash indexes.
    const byPhone = new Map<string, string>();
    const byNameZip = new Map<string, string>();
    const byNameAddr = new Map<string, string>();
    for (const v of voters) {
      if (v.phone) {
        // Server normalizes phone the same way client does before hashing.
        const e164 = v.phone
          .replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, "")
          .replace(/\D+/g, "");
        const normalized = e164.length === 10 ? `+1${e164}` : `+${e164}`;
        byPhone.set(await phoneHash(salt, normalized), v.voter_id);
      }
      if (v.first_name && v.last_name && v.zip) {
        byNameZip.set(await nameZipHash(salt, v.first_name, v.last_name, v.zip), v.voter_id);
      }
      if (v.first_name && v.last_name && v.address) {
        byNameAddr.set(
          await nameAddrHash(salt, v.first_name, v.last_name, v.address),
          v.voter_id,
        );
      }
    }

    // Volunteer's "contacts" arrive as a vCard file.
    const vcf = [
      "BEGIN:VCARD",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "TEL;TYPE=CELL:(808) 555-1212",
      "ADR;TYPE=HOME:;;123 Main Street;Kailua;HI;96734;USA",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Sam Smith",
      "N:Smith;Sam;;;",
      "ADR;TYPE=HOME:;;9 Beach Road;Kailua;HI;96734;USA",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Unrelated Person",
      "TEL:212-555-0000",
      "END:VCARD",
    ].join("\n");

    const contacts = parseVCard(vcf);
    const bundle = await hashContacts(salt, contacts);

    const phoneMatches = bundle.phone.filter((h) => byPhone.has(h)).map((h) => byPhone.get(h));
    const nzMatches = bundle.nameZip.filter((h) => byNameZip.has(h)).map((h) => byNameZip.get(h));
    const naMatches = bundle.nameAddr.filter((h) => byNameAddr.has(h)).map((h) => byNameAddr.get(h));

    expect(phoneMatches).toContain("V1"); // Jane Doe by phone
    expect(nzMatches).toContain("V1"); // Jane Doe by name+zip
    expect(nzMatches).toContain("V3"); // Sam Smith by name+zip
    expect(naMatches).toContain("V1"); // Jane Doe by name+addr (St/Street)
    expect(naMatches).toContain("V3"); // Sam Smith by name+addr (Rd/Road)
  });
});
