import { describe, expect, it } from "vitest";
import { nameAddrHash, nameZipHash, phoneHash, sha256Hex } from "../src/hash.js";

describe("sha256Hex", () => {
  it("produces the known-answer test for 'abc'", async () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256Hex("abc")).toBe(expected);
  });
});

describe("salted hashes", () => {
  it("are deterministic for same inputs", async () => {
    const a = await phoneHash("saltA", "+15551234567");
    const b = await phoneHash("saltA", "+15551234567");
    expect(a).toBe(b);
  });

  it("differ across salts (salt isolation)", async () => {
    const a = await phoneHash("saltA", "+15551234567");
    const b = await phoneHash("saltB", "+15551234567");
    expect(a).not.toBe(b);
  });

  it("nameZip normalizes inputs consistently", async () => {
    const a = await nameZipHash("s", "Jane", "Doe", "96734");
    const b = await nameZipHash("s", " jane ", " DOE ", "96734-0001");
    expect(a).toBe(b);
  });

  it("nameAddr normalizes street suffixes", async () => {
    const a = await nameAddrHash("s", "Jane", "Doe", "123 Main Street");
    const b = await nameAddrHash("s", "Jane", "Doe", "123 Main St");
    expect(a).toBe(b);
  });

  it("cross-type hashes with same salt never collide", async () => {
    const p = await phoneHash("s", "+15551234567");
    const nz = await nameZipHash("s", "Jane", "Doe", "96734");
    const na = await nameAddrHash("s", "Jane", "Doe", "123 Main St");
    expect(new Set([p, nz, na]).size).toBe(3);
  });
});
