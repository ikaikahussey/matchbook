import { describe, expect, it } from "vitest";
import { csvEscape, parseCsv, parseVoterFile, toCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses basic rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsv('a,"b,c",d\n1,"2,3",4')).toEqual([
      ["a", "b,c", "d"],
      ["1", "2,3", "4"],
    ]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('a,"b""c",d')).toEqual([["a", 'b"c', "d"]]);
  });

  it("handles CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csvEscape", () => {
  it("quotes fields with commas", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("escapes embedded quotes", () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("leaves plain values unquoted", () => {
    expect(csvEscape("plain")).toBe("plain");
  });
});

describe("toCsv", () => {
  it("writes header and rows in column order", () => {
    const csv = toCsv([{ a: 1, b: "x" }, { a: 2, b: "y,z" }], ["a", "b"]);
    expect(csv).toBe('a,b\n1,x\n2,"y,z"\n');
  });
});

describe("parseVoterFile", () => {
  const header = "voter_id,first_name,last_name,address,city,zip,phone,party,district,last_voted";

  it("parses rows with all required columns", () => {
    const csv = `${header}\nV1,Jane,Doe,123 Main St,Kailua,96734,808-555-1212,DEM,HD50,2024-11`;
    const rows = parseVoterFile(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].voter_id).toBe("V1");
    expect(rows[0].zip).toBe("96734");
  });

  it("throws if required column is missing", () => {
    expect(() => parseVoterFile("voter_id,first_name\nV1,Jane")).toThrow(/missing required column/);
  });

  it("skips empty voter_id rows", () => {
    const csv = `${header}\n,,,,,,,,,\nV2,John,Roe,1 A St,Kailua,96734,808-555-0000,REP,HD50,2022-11`;
    const rows = parseVoterFile(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].voter_id).toBe("V2");
  });
});
