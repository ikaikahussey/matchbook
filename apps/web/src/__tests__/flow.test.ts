import {
  hashContacts,
  nameAddrHash,
  nameZipHash,
  parseVCard,
  phoneHash,
} from "@voter-match/shared";
import { describe, expect, it } from "vitest";

/**
 * End-to-end client-side flow: parse vCard → hash → verify the hashes
 * we'd post match the ones the server indexes on voter-file ingestion.
 */
describe("client hashing pipeline", () => {
  it("produces server-equivalent hashes", async () => {
    const salt = "demo-salt-rotate-me";
    const vcf = [
      "BEGIN:VCARD",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "TEL;TYPE=CELL:(808) 555-1212",
      "ADR;TYPE=HOME:;;123 Main Street;Kailua;HI;96734;USA",
      "END:VCARD",
    ].join("\n");

    const contacts = parseVCard(vcf);
    const bundle = await hashContacts(salt, contacts);

    const expectedPhone = await phoneHash(salt, "+18085551212");
    const expectedNz = await nameZipHash(salt, "Jane", "Doe", "96734");
    const expectedNa = await nameAddrHash(salt, "Jane", "Doe", "123 Main St");

    expect(bundle.phone).toContain(expectedPhone);
    expect(bundle.nameZip).toContain(expectedNz);
    expect(bundle.nameAddr).toContain(expectedNa);
    // The reverse map should let us re-associate hashes with the local contact.
    expect(bundle.byHash[expectedPhone]).toEqual({ localId: contacts[0].localId, type: "phone" });
  });
});
