import { describe, expect, it } from "vitest";
import { irishPublicHolidays } from "./holidays";

const dates = (y: number) => irishPublicHolidays(y).map((h) => h.date);

describe("Irish public holidays", () => {
  it("2026", () => {
    expect(dates(2026)).toEqual([
      "2026-01-01", "2026-02-02", "2026-03-17", "2026-04-06", "2026-05-04",
      "2026-06-01", "2026-08-03", "2026-10-26", "2026-12-25", "2026-12-26",
    ]);
  });
  it("2027 (St Brigid on Monday 1 Feb, Easter Monday 29 Mar)", () => {
    expect(dates(2027)).toEqual([
      "2027-01-01", "2027-02-01", "2027-03-17", "2027-03-29", "2027-05-03",
      "2027-06-07", "2027-08-02", "2027-10-25", "2027-12-25", "2027-12-26",
    ]);
  });
  it("St Brigid is 1 Feb when it falls on a Friday (2030)", () => {
    expect(irishPublicHolidays(2030).find((h) => h.name === "St Brigid's Day")?.date).toBe("2030-02-01");
  });
});
