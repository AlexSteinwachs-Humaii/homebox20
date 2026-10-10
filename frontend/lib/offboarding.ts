import type { EntityOut, OffboardingRequest } from "./api/types/data-contracts";

export const dispositions = ["sold", "destroyed", "given_away", "donated", "lost_or_stolen"] as const;
export type Disposition = OffboardingRequest["disposition"];

export function needsRecipient(disposition: Disposition) {
  return ["sold", "given_away", "donated"].includes(disposition);
}

export function calendarDate(value: Date | string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === "string") {
    const date = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith("0001-") ? date : fallback;
  }
  if (!Number.isFinite(value.getTime()) || value.getFullYear() <= 1) return fallback;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function salePrefill(entity: Pick<EntityOut, "soldTo" | "soldDate" | "soldPrice" | "soldNotes">, today: string) {
  return {
    recipient: entity.soldTo || "",
    date: calendarDate(entity.soldDate, today),
    value: String(entity.soldPrice ?? ""),
    notes: entity.soldNotes || "",
  };
}
