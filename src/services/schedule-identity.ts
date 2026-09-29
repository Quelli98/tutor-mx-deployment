import { createHash } from "node:crypto";
import { sessionDay } from "./session-attendance.js";
export interface ScheduleIdentity {
  startsAt: string | Date; endsAt: string | Date; recurrence?: string | null;
  label?: string | null; recurrenceUntil?: string | Date | null; termId?: number | null; type?: string;
}
export function timeSlotDedupeKey(slot: ScheduleIdentity, term?: { id: number; endsOn: string }): string {
  const recurrence = slot.recurrence === "WEEKLY" || slot.recurrence === "FORTNIGHTLY" ? slot.recurrence : "ONCE";
  const untilDay = slot.recurrenceUntil ? sessionDay(new Date(slot.recurrenceUntil)) : term?.endsOn;
  // Use the last occurrence day, so a manually selected midnight and a CSV's
  // inclusive end-of-day are equivalent. Different recurrence lengths remain distinct.
  const startDay = sessionDay(new Date(slot.startsAt));
  const period = recurrence === "WEEKLY" ? 7 : 14;
  const days = untilDay ? Math.floor((Date.parse(untilDay) - Date.parse(startDay)) / 86400000 / period) * period : null;
  return JSON.stringify([
    slot.type ?? "BUSY", slot.termId ?? term?.id ?? null,
    (slot.label ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*[-–—]\s*/g, " - "),
    new Date(slot.startsAt).toISOString(), new Date(slot.endsAt).toISOString(),
    recurrence, recurrence === "ONCE" ? null : days,
  ]);
}
export function scheduleFingerprint(tutorId: number, slot: ScheduleIdentity, term?: { id: number; endsOn: string }): string {
  return createHash("sha256").update(`${tutorId}|${timeSlotDedupeKey(slot, term)}`).digest("hex");
}
