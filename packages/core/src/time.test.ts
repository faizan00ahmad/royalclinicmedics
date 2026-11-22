import { describe, expect, it } from "vitest";
import { dublinToUtc, formatDublin } from "./time";
import { assertCents, formatEuro } from "./money";

describe("Dublin time and DST", () => {
  it("winter: Dublin equals UTC", () => {
    expect(dublinToUtc("2026-01-15 10:00").toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });
  it("summer: Dublin is UTC+1", () => {
    expect(dublinToUtc("2026-07-15 10:00").toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
  it("spring forward day 29 Mar 2026 (clocks go 01:00 to 02:00)", () => {
    expect(dublinToUtc("2026-03-29 12:00").toISOString()).toBe("2026-03-29T11:00:00.000Z");
  });
  it("autumn back day 25 Oct 2026", () => {
    expect(dublinToUtc("2026-10-25 12:00").toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });
  it("formats like the SRS example", () => {
    expect(formatDublin(new Date("2026-11-24T10:30:00Z"))).toBe("Tue 24 Nov 2026, 10:30");
  });
});

describe("money", () => {
  it("rejects non-integer cents", () => {
    expect(() => assertCents(10.5)).toThrow();
  });
  it("formats euro", () => {
    expect(formatEuro(5000)).toContain("50.00");
  });
});
