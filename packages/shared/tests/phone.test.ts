import { describe, expect, it } from "vitest";
import { normalizeAddress, normalizeName, normalizePhoneE164, normalizeZip } from "../src/phone.js";

describe("normalizePhoneE164", () => {
  it("normalizes bare 10-digit US", () => {
    expect(normalizePhoneE164("5551234567")).toBe("+15551234567");
  });

  it("normalizes hyphenated US", () => {
    expect(normalizePhoneE164("(555) 123-4567")).toBe("+15551234567");
  });

  it("normalizes 11-digit with leading 1", () => {
    expect(normalizePhoneE164("1-555-123-4567")).toBe("+15551234567");
  });

  it("strips extensions", () => {
    expect(normalizePhoneE164("555-123-4567 x123")).toBe("+15551234567");
    expect(normalizePhoneE164("555-123-4567 ext. 9")).toBe("+15551234567");
    expect(normalizePhoneE164("555-123-4567 extension 10")).toBe("+15551234567");
  });

  it("keeps international + prefix", () => {
    expect(normalizePhoneE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for empty/unparseable", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
    expect(normalizePhoneE164("abc")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
  });

  it("handles plus with short digits by returning null", () => {
    expect(normalizePhoneE164("+123")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeName("O'Brien")).toBe("obrien");
  });

  it("strips diacritics", () => {
    expect(normalizeName("Zoë")).toBe("zoe");
    expect(normalizeName("Renée")).toBe("renee");
  });

  it("handles empty", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
  });
});

describe("normalizeZip", () => {
  it("keeps first 5 digits", () => {
    expect(normalizeZip("96734")).toBe("96734");
    expect(normalizeZip("96734-1234")).toBe("96734");
    expect(normalizeZip("  96734 ")).toBe("96734");
  });
});

describe("normalizeAddress", () => {
  it("normalizes street suffixes", () => {
    expect(normalizeAddress("123 Main Street")).toBe("123mainst");
    expect(normalizeAddress("45 Ocean Boulevard")).toBe("45oceanblvd");
  });
});
