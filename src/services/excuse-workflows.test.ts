import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { createExcuseWorkflowService } from './excuse-workflows.js';
import { allocationAttendance, sessionDay, sickOccurrenceStatus } from './session-attendance.js';

const start = new Date('2026-09-29T08:00:00Z'); // Tuesday 10:00 Johannesburg
const end = new Date('2026-09-29T09:00:00Z');
let row: Record<string, unknown>;
let role: string;
const tx = {
  profile: { findUnique: vi.fn() },
  excuse: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  overflowWork: { upsert: vi.fn() },
  notification: { createMany: vi.fn() },
  $transaction: vi.fn(),
};
const service = (now = new Date('2026-09-29T06:00:00Z')) => createExcuseWorkflowService(tx as unknown as PrismaClient, () => now);
beforeEach(() => {
  vi.resetAllMocks(); role = 'ORGANISER';
  row = { id: 12, tutorId: 7, allocationId: 4, reason: 'Sick', status: 'PENDING', reviewReason: null,
    occurrenceStatus: null, absenceReason: 'SICK', reviewedAt: null, reviewedById: null,
    createdAt: new Date('2026-09-28T18:00:00Z'), updatedAt: new Date('2026-09-28T18:00:00Z'),
    allocation: { id: 4, courseId: 9, status: 'CONFIRMED', startsAt: start, endsAt: end, allocatedHours: 1 } };
  tx.profile.findUnique.mockImplementation(async () => ({ id: role === 'TUTOR' ? 7 : 2, role }));
  tx.excuse.findUnique.mockImplementation(async () => row);
  tx.excuse.findFirst.mockImplementation(async ({ where }) => where.tutorId === row.tutorId ? row : null);
  tx.excuse.updateMany.mockImplementation(async ({ data }) => {
    if (row.status !== 'PENDING') return { count: 0 };
    row = { ...row, ...data }; return { count: 1 };
  });
  tx.$transaction.mockImplementation(async (operation) => operation(tx));
});

describe('approved sick occurrence classification', () => {
  it.each([
    ['previous-day approval', '2026-09-28T10:00Z', '2026-09-28T12:00Z', 'EXCUSED'],
    ['next-day approval before session', '2026-09-28T18:00Z', '2026-09-29T06:00Z', 'EXCUSED'],
    ['same-day submission', '2026-09-29T04:00Z', '2026-09-29T06:00Z', 'SKIPPED'],
    ['retrospective submission', '2026-09-30T04:00Z', '2026-09-30T06:00Z', 'SKIPPED'],
    ['advance submission, late approval', '2026-09-28T04:00Z', '2026-09-29T09:01Z', 'SKIPPED'],
    ['exact end is historical', '2026-09-28T04:00Z', '2026-09-29T09:00Z', 'SKIPPED'],
    ['UTC previous day, local same day', '2026-09-28T22:01Z', '2026-09-29T06:00Z', 'SKIPPED'],
    ['one minute before local midnight', '2026-09-28T21:59Z', '2026-09-29T06:00Z', 'EXCUSED'],
  ])('%s', async (_name, submitted, approved, expected) => {
    row.createdAt = new Date(submitted);
    expect(sickOccurrenceStatus(new Date(submitted), start, end, new Date(approved))).toBe(expected);
    const result = await service(new Date(approved)).decide(12, { decision: 'APPROVE' }, 'auth0|organiser');
    expect(result).toMatchObject({ status: 'APPROVED', occurrenceStatus: expected, absenceReason: 'SICK', reviewedById: 2, reviewedAt: new Date(approved).toISOString() });
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(tx.overflowWork.upsert).toHaveBeenCalledTimes(new Date(approved) < end ? 1 : 0);
    expect(row.allocation).toMatchObject({ id: 4, status: 'CONFIRMED', startsAt: start, endsAt: end });
  });
  it('uses the application calendar day, independent of UTC', () => {
    expect(sessionDay(new Date('2026-09-28T22:00Z'))).toBe('2026-09-29');
  });
});

describe('excuse workflow', () => {
  it('pending and rejected requests retain a normal session and work eligibility', async () => {
    expect(allocationAttendance([{ id: 12, status: 'PENDING' }])).toMatchObject({ occurrenceStatus: 'SCHEDULED', excusePending: true, workLogEligible: true });
    await service().decide(12, { decision: 'REJECT', reason: '  Evidence insufficient  ' }, 'auth0|organiser');
    expect(row).toMatchObject({ status: 'REJECTED', occurrenceStatus: null, reviewReason: 'Evidence insufficient' });
    expect(allocationAttendance([row as never])).toMatchObject({ occurrenceStatus: 'SCHEDULED', excusePending: false, workLogEligible: true });
    expect(tx.overflowWork.upsert).not.toHaveBeenCalled();
  });
  it('double approval returns the original result and creates one notification/replacement', async () => {
    const first = await service().decide(12, { decision: 'APPROVE' }, 'auth0|organiser');
    const second = await service(new Date('2026-10-02')).decide(12, { decision: 'APPROVE' }, 'auth0|organiser');
    expect(second).toEqual(first);
    expect(tx.excuse.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
    expect(tx.overflowWork.upsert).toHaveBeenCalledTimes(1);
  });
  it('does not change following occurrences or replacement eligibility', async () => {
    await service().decide(12, { decision: 'APPROVE' }, 'auth0|organiser');
    expect(allocationAttendance([row as never]).workLogEligible).toBe(false);
    expect(allocationAttendance([])).toMatchObject({ occurrenceStatus: 'SCHEDULED', workLogEligible: true });
    expect(tx.excuse.updateMany.mock.calls[0]?.[0].where).toEqual({ id: 12, status: 'PENDING' });
  });
  it.each(['TUTOR', 'STUDENT'])('rejects %s decisions at the service boundary', async (value) => {
    role = value;
    await expect(service().decide(12, { decision: 'APPROVE' }, 'wrong')).rejects.toMatchObject({ status: 403 });
    expect(tx.excuse.updateMany).not.toHaveBeenCalled();
  });
  it('only returns the authenticated tutor request', async () => {
    role = 'TUTOR';
    await expect(service().getStatus('tutor', 12)).resolves.toMatchObject({ id: 12, status: 'PENDING' });
    row.tutorId = 99;
    await expect(service().getStatus('tutor', 12)).rejects.toMatchObject({ status: 404 });
  });
  it.each(['STUDENT', 'ORGANISER'])('denies %s access to tutor history', async (value) => {
    role = value;
    await expect(service().getStatus('wrong', 12)).rejects.toMatchObject({ status: 404 });
  });
  it.each([{ decision: 'REJECT' }, { decision: 'REJECT', reason: ' ' }, { decision: 'REJECT', reason: 'x'.repeat(1001) }, { decision: 'OTHER' }])('validates decisions %#', async (input) => {
    await expect(service().decide(12, input as never, 'organiser')).rejects.toMatchObject({ status: 400 });
  });
  it('returns 404 for an absent request', async () => {
    tx.excuse.findUnique.mockResolvedValue(null);
    await expect(service().decide(12, { decision: 'APPROVE' }, 'organiser')).rejects.toMatchObject({ status: 404 });
  });
  it('does not reverse an existing decision', async () => {
    row.status = 'REJECTED';
    await expect(service().decide(12, { decision: 'APPROVE' }, 'organiser')).rejects.toMatchObject({ status: 409 });
  });
  it('retries a serialization conflict', async () => {
    tx.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await expect(service().decide(12, { decision: 'APPROVE' }, 'organiser')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(tx.notification.createMany).toHaveBeenCalledTimes(1);
  });
  it('rolls back approval when atomic notification persistence fails', async () => {
    const failure = new Error('notification persistence');
    tx.notification.createMany.mockRejectedValue(failure);
    await expect(service().decide(12, { decision: 'APPROVE' }, 'organiser')).rejects.toBe(failure);
    expect(tx.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
});
