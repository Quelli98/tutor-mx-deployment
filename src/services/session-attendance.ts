/** The institution's timetable uses Johannesburg calendar days, regardless of server/browser locale. */
export const TIMETABLE_TIME_ZONE = "Africa/Johannesburg";
export function sessionDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMETABLE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const read = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}
export function sickOccurrenceStatus(submittedAt: Date, startsAt: Date, endsAt: Date, approvedAt: Date): "EXCUSED" | "SKIPPED" {
  return sessionDay(submittedAt) < sessionDay(startsAt) && endsAt > approvedAt ? "EXCUSED" : "SKIPPED";
}
export const attendanceSelection = {
  id: true, status: true, occurrenceStatus: true, absenceReason: true,
  createdAt: true, reviewedAt: true, reviewReason: true,
} as const;
export function allocationAttendance(excuses: Array<{
  id: number; status: string; occurrenceStatus?: "EXCUSED" | "SKIPPED" | null;
  absenceReason?: "SICK"; createdAt?: Date; reviewedAt?: Date | null; reviewReason?: string | null;
}> = []) {
  const excuse = excuses[0];
  return {
    occurrenceStatus: excuse?.status === "APPROVED" ? (excuse.occurrenceStatus ?? "SKIPPED") : "SCHEDULED",
    absenceReason: excuse?.status === "APPROVED" ? "SICK" : null,
    excusePending: excuse?.status === "PENDING",
    workLogEligible: excuse?.status !== "APPROVED",
    excuse: excuse ? {
      id: excuse.id, status: excuse.status, reviewReason: excuse.reviewReason ?? null,
      submittedAt: excuse.createdAt?.toISOString(), reviewedAt: excuse.reviewedAt?.toISOString() ?? null,
    } : null,
  };
}
