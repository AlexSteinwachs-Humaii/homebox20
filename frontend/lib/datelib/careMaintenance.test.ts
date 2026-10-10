import { describe, expect, test } from "vitest";
import { careMaintenanceUpdate } from "./careMaintenance";

const entry = {
  id: "task",
  name: "Filter",
  description: "replace every 90 days",
  cost: "42.50",
  scheduledDate: "2026-10-03",
  completedDate: "",
};
const today = new Date(2026, 9, 9, 23, 45);

describe("Care maintenance actions", () => {
  test("done uses today's local calendar date and preserves all other fields", () => {
    expect(careMaintenanceUpdate(entry, "done", today)).toEqual({
      name: entry.name,
      description: entry.description,
      cost: entry.cost,
      scheduledDate: entry.scheduledDate,
      completedDate: "2026-10-09",
    });
  });
  test("snooze moves a future date seven calendar days, across month boundaries", () => {
    expect(careMaintenanceUpdate({ ...entry, scheduledDate: "2026-10-29" }, "snooze", today)).toEqual({
      name: entry.name,
      description: entry.description,
      cost: entry.cost,
      scheduledDate: "2026-11-05",
      completedDate: "",
    });
  });
  test("today can be snoozed without completion", () => {
    expect(careMaintenanceUpdate({ ...entry, scheduledDate: "2026-10-09" }, "snooze", today).scheduledDate).toBe(
      "2026-10-16"
    );
  });
  test("stale overdue snoozes and completed entries are refused", () => {
    expect(() => careMaintenanceUpdate(entry, "snooze", today)).toThrow("overdue");
    for (const action of ["done", "snooze"] as const) {
      expect(() => careMaintenanceUpdate({ ...entry, completedDate: "2026-10-09" }, action, today)).toThrow(
        "already completed"
      );
    }
  });
});
