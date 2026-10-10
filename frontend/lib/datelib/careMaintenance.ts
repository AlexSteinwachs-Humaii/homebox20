import type { MaintenanceEntry, MaintenanceEntryUpdate } from "../api/types/data-contracts";
import { parseDateOnly, toDateOnlyString } from "./dateOnly";

/** A one-off entry update, never a recurrence rule or a new occurrence. */
export function careMaintenanceUpdate(
  entry: MaintenanceEntry,
  action: "done" | "snooze",
  now = new Date()
): MaintenanceEntryUpdate {
  if (toDateOnlyString(entry.completedDate)) throw new Error("Entry is already completed");
  const today = toDateOnlyString(now);
  const scheduledDate = toDateOnlyString(entry.scheduledDate);
  const scheduled = parseDateOnly(scheduledDate);
  if (!scheduled) throw new Error("Entry has no valid scheduled date");
  if (action === "snooze" && scheduledDate < today) throw new Error("Cannot snooze an overdue entry");
  if (action === "snooze") scheduled.setDate(scheduled.getDate() + 7);
  return {
    name: entry.name,
    description: entry.description,
    cost: entry.cost,
    scheduledDate: action === "snooze" ? toDateOnlyString(scheduled) : scheduledDate,
    completedDate: action === "done" ? today : "",
  };
}
