import { describe, expect, it } from "vitest";
import { parseContactsCsv, parseVCard } from "../src/vcard.js";

describe("parseVCard", () => {
  it("parses a single card with FN, N, TEL, ADR", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jane Doe",
      "N:Doe;Jane;;;",
      "TEL;TYPE=CELL:(808) 555-1212",
      "ADR;TYPE=HOME:;;123 Main St;Kailua;HI;96734;USA",
      "END:VCARD",
    ].join("\n");
    const contacts = parseVCard(vcf);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].displayName).toBe("Jane Doe");
    expect(contacts[0].firstName).toBe("Jane");
    expect(contacts[0].lastName).toBe("Doe");
    expect(contacts[0].phones).toEqual(["(808) 555-1212"]);
    expect(contacts[0].addresses[0]).toEqual({ street: "123 Main St", zip: "96734" });
  });

  it("parses multiple cards", () => {
    const vcf = [
      "BEGIN:VCARD\nFN:Alice A\nTEL:5550001\nEND:VCARD",
      "BEGIN:VCARD\nFN:Bob B\nTEL:5550002\nEND:VCARD",
    ].join("\n");
    expect(parseVCard(vcf)).toHaveLength(2);
  });

  it("unfolds continuation lines", () => {
    const vcf = "BEGIN:VCARD\nFN:Very Long\n Name Here\nEND:VCARD";
    const contacts = parseVCard(vcf);
    expect(contacts[0].displayName).toBe("Very LongName Here");
  });
});

describe("parseContactsCsv", () => {
  it("parses Google-style export", () => {
    const csv = [
      "Name,Given Name,Family Name,Phone 1 - Value,Address 1 - Street,Address 1 - Postal Code",
      "Jane Doe,Jane,Doe,808-555-1212,123 Main St,96734",
    ].join("\n");
    const contacts = parseContactsCsv(csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].phones).toEqual(["808-555-1212"]);
    expect(contacts[0].addresses[0]).toEqual({ street: "123 Main St", zip: "96734" });
  });
});
