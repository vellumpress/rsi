import { describe, expect, it } from "vitest";
import { addMonths, elapsedMonthDates, isFriday, nextFriday } from "./dates";

describe("dates", () => {
  it("builds the playbook calendar from 2 Oct 2026", () => {
    expect(addMonths("2026-10-02", 1)).toBe("2026-11-02");
    expect(addMonths("2026-10-02", 2)).toBe("2026-12-02");
    expect(addMonths("2026-10-02", 12)).toBe("2027-10-02");
    expect(isFriday("2026-10-02")).toBe(true);
    expect(isFriday("2026-10-01")).toBe(false);
    expect(nextFriday("2026-10-02")).toBe("2026-10-02");
    expect(nextFriday("2026-10-01")).toBe("2026-10-02");
  });

  it("clamps month-ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("lists elapsed scorecard and quarter dates", () => {
    expect(elapsedMonthDates("2026-10-02", "2026-10-02", 1, 1)).toEqual([]);
    expect(elapsedMonthDates("2026-10-02", "2026-11-02", 1, 1)).toEqual(["2026-11-02"]);
    expect(elapsedMonthDates("2026-10-02", "2027-10-02", 3, 3)).toEqual([
      "2027-01-02",
      "2027-04-02",
      "2027-07-02",
      "2027-10-02",
    ]);
  });
});
