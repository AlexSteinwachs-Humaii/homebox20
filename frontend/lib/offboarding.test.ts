import { describe, expect, it } from "vitest";
import { calendarDate, dispositions, needsRecipient, salePrefill } from "./offboarding";

describe("offboarding form defaults", () => {
  it("offers only the five whole-entity dispositions with applicable recipients", () => {
    expect(dispositions).toEqual(["sold", "destroyed", "given_away", "donated", "lost_or_stolen"]);
    expect(dispositions.filter(needsRecipient)).toEqual(["sold", "given_away", "donated"]);
  });

  it("prefills all legacy sale fields, including hidden notes and zero value", () => {
    expect(
      salePrefill({ soldTo: "Buyer", soldPrice: 0, soldDate: "2025-03-09", soldNotes: "Paid in cash" }, "2026-10-09")
    ).toEqual({ recipient: "Buyer", value: "0", date: "2025-03-09", notes: "Paid in cash" });
  });

  it("falls back to today for unset legacy dates without UTC day shifting", () => {
    expect(calendarDate("0001-01-01T00:00:00Z", "2026-10-09")).toBe("2026-10-09");
    expect(calendarDate("2025-03-09T00:00:00Z", "2026-10-09")).toBe("2025-03-09");
    expect(calendarDate(new Date(2025, 2, 9), "2026-10-09")).toBe("2025-03-09");
    expect(calendarDate(new Date(NaN), "2026-10-09")).toBe("2026-10-09");
  });
});
