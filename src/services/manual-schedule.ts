import type { PrismaClient } from '../generated/prisma/client.js';
import type { TutorTimeSlotWriteInput } from '../app.js';
import { createRouteError } from '../http/errors.js';
import { scheduleFingerprint, timeSlotDedupeKey } from './schedule-identity.js';
import { sessionDay } from './session-attendance.js';
import { toDateOnly } from './academic-terms.js';

/** Manual and imported entries share TimeSlot, comparison rules and a unique hash. */
export async function saveManualSchedule(prisma: PrismaClient, tutorId: number, input: TutorTimeSlotWriteInput, id?: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (id && !await tx.timeSlot.findFirst({ where: { id, tutorId }, select: { id: true } })) {
          throw createRouteError(404, 'TIME_SLOT_NOT_FOUND', 'The requested time slot could not be found.');
        }
        const day = new Date(`${sessionDay(input.startsAt)}T00:00:00Z`);
        const matches = await tx.academicTerm.findMany({
          where: { published: true, startsOn: { lte: day }, endsOn: { gte: day } },
        });
        const match = matches.length === 1 ? matches[0] : undefined;
        const term = match ? { id: match.id, endsOn: toDateOnly(match.endsOn) } : undefined;
        const recurring = input.recurrence === 'WEEKLY' || input.recurrence === 'FORTNIGHTLY';
        const recurrenceUntil = recurring ? input.recurrenceUntil ?? (term ? new Date(`${term.endsOn}T23:59:59.999+02:00`) : null) : null;
        const data = {
          tutorId, type: input.type, startsAt: input.startsAt, endsAt: input.endsAt,
          recurrence: recurring ? input.recurrence : null, label: input.label?.trim() || null,
          recurrenceUntil, category: input.category ?? 'UNAVAILABLE', seriesId: input.seriesId ?? null,
          termId: term?.id ?? null,
        };
        const existing = await tx.timeSlot.findMany({ where: { tutorId, type: input.type, startsAt: input.startsAt } });
        const equivalent = existing.find((slot) => slot.id !== id && timeSlotDedupeKey(slot, term) === timeSlotDedupeKey(data, term));
        if (equivalent) {
          throw createRouteError(409, 'TIME_SLOT_DUPLICATE', 'Already in your timetable — no duplicate was added.');
        }
        const write = { ...data, dedupeKey: scheduleFingerprint(tutorId, data, term) };
        const include = { term: { select: { teachingBreaks: true } }, exceptions: true } as const;
        return id ? tx.timeSlot.update({ where: { id, tutorId }, data: write, include }) : tx.timeSlot.create({ data: write, include });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? error.code : null;
      if ((code === 'P2034' || code === 'P2002') && attempt < 2) continue;
      if (code === 'P2002') throw createRouteError(409, 'TIME_SLOT_DUPLICATE', 'Already in your timetable — no duplicate was added.');
      throw error;
    }
  }
  throw createRouteError(409, 'TIME_SLOT_CONFLICT', 'The schedule changed. Please retry.');
}
