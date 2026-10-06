import { DUE_REMINDER_THRESHOLDS } from "./notifications.js";
import { sessionDay } from "./session-attendance.js";

/**
 * "A dashboard telling a tutor what they owe and when" (project brief, Basic).
 *
 * Nothing here invents a new deadline. Hours are logged against the session's
 * own week, because a work log joins that week's timesheet; a timesheet is owed
 * once its week has ended; and a returned timesheet is due again after the
 * same resubmit threshold the reminder job already uses.
 */

export type TutorObligationKind = "LOG_HOURS" | "SUBMIT_TIMESHEET" | "RESUBMIT_TIMESHEET";

export interface TutorObligation {
  kind: TutorObligationKind;
  title: string;
  /** Sunday (Johannesburg date) of the timesheet week the obligation belongs to. */
  weekEnding: string;
  /** A real deadline, when the workflow has one; otherwise null. */
  dueAt: string | null;
  overdue: boolean;
  allocationId: number | null;
  timesheetId: number | null;
}

export interface ObligationSession {
  id: number;
  courseCode: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  workLogEligible: boolean;
  logged: boolean;
}

export interface ObligationTimesheet {
  id: number;
  weekStart: Date;
  status: string;
  reviewedAt: Date | null;
  workLogCount: number;
}

const DAY_MS = 86_400_000;

function mondayOf(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function sundayOf(weekStart: Date): string {
  return new Date(weekStart.valueOf() + 6 * DAY_MS).toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function computeTutorObligations(input: {
  now: Date;
  sessions: ObligationSession[];
  timesheets: ObligationTimesheet[];
  resubmitHours?: number;
}): TutorObligation[] {
  const resubmitHours = input.resubmitHours ?? DUE_REMINDER_THRESHOLDS.timesheetResubmitHours;
  const today = sessionDay(input.now);
  const obligations: TutorObligation[] = [];

  for (const session of input.sessions) {
    if (
      session.status !== "CONFIRMED" ||
      !session.workLogEligible ||
      session.logged ||
      session.endsAt > input.now
    ) {
      continue;
    }
    const day = sessionDay(session.startsAt);
    const weekEnding = sundayOf(mondayOf(day));
    obligations.push({
      kind: "LOG_HOURS",
      title: `Log your hours for ${session.courseCode} on ${dayLabel(day)}`,
      weekEnding,
      dueAt: null,
      overdue: weekEnding < today,
      allocationId: session.id,
      timesheetId: null,
    });
  }

  for (const timesheet of input.timesheets) {
    const weekEnding = sundayOf(timesheet.weekStart);
    if (timesheet.status === "RETURNED") {
      const dueAt = timesheet.reviewedAt
        ? new Date(timesheet.reviewedAt.valueOf() + resubmitHours * 3_600_000)
        : null;
      obligations.push({
        kind: "RESUBMIT_TIMESHEET",
        title: `Fix and resubmit your timesheet for the week ending ${dayLabel(weekEnding)}`,
        weekEnding,
        dueAt: dueAt?.toISOString() ?? null,
        overdue: dueAt !== null && dueAt <= input.now,
        allocationId: null,
        timesheetId: timesheet.id,
      });
    } else if (timesheet.status === "DRAFT" && timesheet.workLogCount > 0 && weekEnding < today) {
      obligations.push({
        kind: "SUBMIT_TIMESHEET",
        title: `Submit your timesheet for the week ending ${dayLabel(weekEnding)}`,
        weekEnding,
        dueAt: null,
        overdue: true,
        allocationId: null,
        timesheetId: timesheet.id,
      });
    }
  }

  // Overdue first, then oldest week first, so the most pressing item leads.
  return obligations.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) ||
    (a.dueAt ?? a.weekEnding).localeCompare(b.dueAt ?? b.weekEnding));
}
