import type { QueryClient } from './allocation-queries.js';
import { toNaiveUtcText } from './allocation-queries.js';
import { sessionDay } from './session-attendance.js';
import { RECURRENCE_MAX_MS } from './time-slot-rules.js';
import { exactFields, instant, invalid, positiveId, requireProfile } from './planning-store.js';
import { createRouteError } from '../http/errors.js';

export interface Interval { startsAt: Date; endsAt: Date }
export interface BusySlot extends Interval {
  recurrence: string | null;
  recurrenceUntil: Date | null;
  termStartsOn?: string | null; termEndsOn?: string | null;
  teachingBreaks: Array<{ startsOn: string; endsOn: string }>;
  exceptions: Array<{ occurrenceDate: string; exceptionType: string; newStartsAt?: string | null; newEndsAt?: string | null }>;
}
export interface AvailabilityInput { courseId: number; tutorId: number; termId: number; startsAt: string; endsAt: string; durationMinutes: number }
const DAY = 86400000;
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const ordered = intervals.filter(x => x.endsAt > x.startsAt).map(x => ({ ...x })).sort((a,b) => +a.startsAt - +b.startsAt);
  const merged: Interval[] = [];
  for (const current of ordered) {
    const last = merged.at(-1);
    if (last && current.startsAt <= last.endsAt) last.endsAt = new Date(Math.max(+last.endsAt, +current.endsAt));
    else merged.push(current);
  }
  return merged;
}
/** Shared TimeSlot recurrence, Johannesburg days, teaching breaks and moved/cancelled occurrences. */
export function expandBusySlots(slots: BusySlot[], window: Interval): Interval[] {
  const intervals: Interval[] = [];
  const add = (startsAt: Date, endsAt: Date) => { if (startsAt < window.endsAt && endsAt > window.startsAt) intervals.push({ startsAt, endsAt }); };
  for (const slot of slots) {
    const period = slot.recurrence === 'WEEKLY' || slot.recurrence === 'FORTNIGHTLY' ? RECURRENCE_MAX_MS[slot.recurrence] : 0;
    // A moved occurrence may enter this window from a different week.
    for (const exception of slot.exceptions) if (exception.exceptionType !== 'CANCELLED' && exception.newStartsAt && exception.newEndsAt) add(new Date(exception.newStartsAt), new Date(exception.newEndsAt));
    let step = period ? Math.max(0, Math.floor((+window.startsAt - +slot.endsAt) / period) + 1) : 0;
    for (let count = 0; count < 10; count++, step++) {
      const start = new Date(+slot.startsAt + step * period), end = new Date(+slot.endsAt + step * period);
      if (start >= window.endsAt || (period && slot.recurrenceUntil && start > slot.recurrenceUntil)) break;
      const day = sessionDay(start);
      const skipped = slot.exceptions.some(x => x.occurrenceDate === day && (x.exceptionType === 'CANCELLED' || x.newStartsAt));
      const outsideTerm = period && ((slot.termStartsOn && day < slot.termStartsOn) || (slot.termEndsOn && day > slot.termEndsOn));
      const paused = period && slot.teachingBreaks.some(x => day >= x.startsOn && day <= x.endsOn);
      if (!skipped && !paused && !outsideTerm) add(start, end);
      if (!period) break;
    }
  }
  return mergeIntervals(intervals);
}
export function availableStarts(windows: Interval[], busy: Interval[], durationMinutes: number, now: Date, limit = 80) {
  const blocks = mergeIntervals(busy);
  const duration = durationMinutes * 60000;
  const starts: Interval[] = [];
  let truncated = false;
  for (const window of windows) {
    // Quarter-hour starts, at least one millisecond in the future.
    for (let time = Math.ceil(Math.max(+window.startsAt, +now + 1) / 900000) * 900000; time + duration <= +window.endsAt; time += 900000) {
      if (!blocks.some(x => +x.startsAt < time + duration && +x.endsAt > time)) {
        if (starts.length === limit) { truncated = true; return { slots: starts, truncated }; }
        starts.push({ startsAt: new Date(time), endsAt: new Date(time + duration) });
      }
    }
  }
  return { slots: starts, truncated };
}
/** Member 3 adds the booking table. This adapter also works inside that member's write transaction. */
export async function readBookingBusy(client: QueryClient, profileIds: number[], window: Interval): Promise<Interval[]> {
  const { rows: tables } = await client.query<{ exists: boolean }>(`SELECT to_regclass('"TutoringBooking"') IS NOT NULL AS "exists"`);
  if (!tables[0]?.exists) return [];
  const { rows } = await client.query<Interval>(`SELECT "startsAt","endsAt" FROM "TutoringBooking" b
    WHERE ("studentId"=ANY($1::integer[]) OR "tutorId"=ANY($1::integer[])) AND "startsAt"<$3::timestamp AND "endsAt">$2::timestamp
    AND COALESCE(to_jsonb(b)->>'status','CONFIRMED') NOT IN ('CANCELLED','EXCUSED')
    AND COALESCE(to_jsonb(b)->>'occurrenceStatus','SCHEDULED') <> 'EXCUSED' LIMIT 2001`, [profileIds, toNaiveUtcText(window.startsAt), toNaiveUtcText(window.endsAt)]);
  if (rows.length > 2000) throw createRouteError(422, 'WINDOW_TOO_BUSY', 'Choose a shorter search window.');
  return rows.map(x => ({ startsAt: new Date(x.startsAt), endsAt: new Date(x.endsAt) }));
}
export async function readBusyIntervals(client: QueryClient, profileIds: number[], window: Interval) {
  const { rows } = await client.query<BusySlot>(`SELECT ts."startsAt",ts."endsAt",ts."recurrence",ts."recurrenceUntil",
    to_char(t."startsOn",'YYYY-MM-DD') AS "termStartsOn",to_char(t."endsOn",'YYYY-MM-DD') AS "termEndsOn",
    COALESCE(t."teachingBreaks",'[]'::jsonb) AS "teachingBreaks",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('occurrenceDate',to_char(e."occurrenceDate",'YYYY-MM-DD'),'exceptionType',e."exceptionType",'newStartsAt',to_char(e."newStartsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'newEndsAt',to_char(e."newEndsAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) FROM "OccurrenceException" e WHERE e."timeSlotId"=ts."id"),'[]'::jsonb) AS exceptions
    FROM "TimeSlot" ts LEFT JOIN "AcademicTerm" t ON t."id"=ts."termId"
    WHERE ts."tutorId"=ANY($1::integer[]) AND ts."type"='BUSY' LIMIT 2001`, [profileIds]);
  if (rows.length > 2000) throw createRouteError(422, 'WINDOW_TOO_BUSY', 'Too many timetable entries to calculate safely.');
  const slots = rows.map(x => ({ ...x, startsAt: new Date(x.startsAt), endsAt: new Date(x.endsAt), recurrenceUntil: x.recurrenceUntil ? new Date(x.recurrenceUntil) : null }));
  const { rows: allocations } = await client.query<Interval>(`SELECT a."startsAt",a."endsAt" FROM "Allocation" a
    WHERE a."tutorId"=ANY($1::integer[]) AND a."status"='CONFIRMED' AND a."startsAt"<$3::timestamp AND a."endsAt">$2::timestamp
    AND NOT EXISTS (SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED')
    UNION ALL SELECT w."startsAt",w."endsAt" FROM "VolunteerClaim" v JOIN "OverflowWork" w ON w."id"=v."overflowWorkId"
    WHERE v."studentId"=ANY($1::integer[]) AND v."status"='ACCEPTED' AND w."startsAt"<$3::timestamp AND w."endsAt">$2::timestamp LIMIT 2001`, [profileIds, toNaiveUtcText(window.startsAt), toNaiveUtcText(window.endsAt)]);
  if (allocations.length > 2000) throw createRouteError(422, 'WINDOW_TOO_BUSY', 'Choose a shorter search window.');
  return mergeIntervals([...expandBusySlots(slots, window), ...allocations.map(x => ({ startsAt: new Date(x.startsAt), endsAt: new Date(x.endsAt) })), ...await readBookingBusy(client, profileIds, window)]);
}
export function createMutualAvailabilityService(client: QueryClient, clock = () => new Date()) {
  return {
    async discover(subject: string) {
      await requireProfile(client, subject, 'STUDENT');
      // No email, mark, auth identifier, private timetable or budget is returned.
      const { rows } = await client.query<{ tutorId: number; tutorName: string; courseId: number; courseCode: string; courseName: string }>(`SELECT p."id" AS "tutorId",p."fullName" AS "tutorName",c."id" AS "courseId",c."code" AS "courseCode",c."name" AS "courseName"
        FROM "TutorMark" m JOIN "Profile" p ON p."id"=m."tutorId" JOIN "Course" c ON c."id"=m."courseId"
        WHERE p."role"='TUTOR' AND m."mark">=50 ORDER BY c."code",p."fullName",p."id" LIMIT 501`);
      return { choices: rows.slice(0,500), truncated: rows.length > 500 };
    },
    async search(subject: string, raw: unknown) {
      const student = await requireProfile(client, subject, 'STUDENT');
      const input = exactFields(raw, ['courseId','tutorId','termId','startsAt','endsAt','durationMinutes','dailyStartHour','dailyEndHour']);
      const courseId = positiveId(input.courseId), tutorId = positiveId(input.tutorId), termId = positiveId(input.termId);
      const startsAt = instant(input.startsAt), endsAt = instant(input.endsAt), now = clock();
      const durationMinutes = Number(input.durationMinutes);
      const dailyStartHour = input.dailyStartHour ?? 8, dailyEndHour = input.dailyEndHour ?? 18;
      if (!Number.isInteger(dailyStartHour) || !Number.isInteger(dailyEndHour) || Number(dailyStartHour)<0 || Number(dailyEndHour)>24 || Number(dailyStartHour)>=Number(dailyEndHour)) invalid('Choose daily start/end hours between 0 and 24.');
      if (!Number.isInteger(durationMinutes) || typeof input.durationMinutes !== 'number' || durationMinutes < 15 || durationMinutes > 180 || endsAt <= startsAt || +endsAt - +startsAt > 14*DAY || +endsAt > +now + 180*DAY || endsAt <= now) invalid('Choose a future window of up to 14 days, within the next 180 days, and a duration of 15–180 minutes.');
      const eligible = await client.query(`SELECT p."id" FROM "Profile" p JOIN "TutorMark" m ON m."tutorId"=p."id" WHERE p."id"=$1 AND p."role"='TUTOR' AND m."courseId"=$2 AND m."mark">=50`, [tutorId, courseId]);
      if (!eligible.rows.length) throw createRouteError(404, 'TUTOR_UNAVAILABLE', 'This tutor/course choice is no longer available. Refresh the list.');
      const { rows: terms } = await client.query<{ startsOn: string; endsOn: string; teachingBreaks: Array<{startsOn: string; endsOn: string}> }>(`SELECT to_char("startsOn",'YYYY-MM-DD') AS "startsOn",to_char("endsOn",'YYYY-MM-DD') AS "endsOn","teachingBreaks" FROM "AcademicTerm" WHERE "id"=$1 AND "published"=true`, [termId]);
      const term = terms[0];
      if (!term) throw createRouteError(404, 'TERM_UNAVAILABLE', 'Choose a published academic term.');
      const bounds = { startsAt: new Date(Math.max(+startsAt, +new Date(term.startsOn+'T00:00:00+02:00'))), endsAt: new Date(Math.min(+endsAt, +new Date(term.endsOn+'T00:00:00+02:00')+DAY)) };
      const windows: Interval[] = [];
      // Requested daily hours are interpreted in Johannesburg time, including weekends.
      for (let day = +new Date(sessionDay(bounds.startsAt)+'T00:00:00+02:00'); day < +bounds.endsAt; day += DAY) {
        const date = sessionDay(new Date(day));
        if (term.teachingBreaks.some(x => date >= x.startsOn && date <= x.endsOn)) continue;
        windows.push({ startsAt: new Date(Math.max(day+Number(dailyStartHour)*3600000,+bounds.startsAt)), endsAt: new Date(Math.min(day+Number(dailyEndHour)*3600000,+bounds.endsAt)) });
      }
      const busy = bounds.endsAt > bounds.startsAt ? await readBusyIntervals(client, [student.id, tutorId], bounds) : [];
      const result = availableStarts(windows, busy, durationMinutes, now);
      return { slots: result.slots.map(x => ({ startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() })), truncated: result.truncated, timeZone: 'Africa/Johannesburg', durationMinutes, policy: `Daily hours ${String(dailyStartHour).padStart(2,'0')}:00–${String(dailyEndHour).padStart(2,'0')}:00; 15-minute start increments. Availability is not a reservation.` };
    },
  };
}
export type MutualAvailabilityService = ReturnType<typeof createMutualAvailabilityService>;
