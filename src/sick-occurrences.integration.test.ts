import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  for (const name of (await readdir(migrationPath)).sort()) {
    if (name !== 'migration_lock.toml') await db.exec(await readFile(`${migrationPath}/${name}/migration.sql`, 'utf8'));
  }
  await db.exec(`INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES
    (701,'sick|tutor','sick@example.test','Original Tutor','TUTOR',now()),
    (702,'sick|replacement','replacement@example.test','Replacement Tutor','TUTOR',now()),
    (703,'sick|organiser','organiser@example.test','Organiser','ORGANISER',now());
    INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (701,20),(702,20);
    INSERT INTO "Course" ("id","code","name","updatedAt") VALUES (701,'SICK701','Sick workflow',now());`);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`DELETE FROM "WorkLog"; DELETE FROM "Excuse"; DELETE FROM "Timesheet"; DELETE FROM "Allocation";
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt") VALUES
    (701,701,701,'2026-09-29 08:00','2026-09-29 09:00',1,now()),
    (702,701,701,'2026-10-06 08:00','2026-10-06 09:00',1,now()),
    (703,702,701,'2026-09-29 08:00','2026-09-29 09:00',1,now());
    UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=703,"reviewedAt"=now();`);
});
async function submit(createdAt = '2026-09-28 10:00') {
  return (await db.query<{ id: number }>(`INSERT INTO "Excuse" ("tutorId","allocationId","reason","createdAt","updatedAt") VALUES (701,701,'Sick',$1,$1) RETURNING "id"`, [createdAt])).rows[0]!.id;
}
async function approve(reviewedAt: string) {
  await db.query(`UPDATE "Excuse" SET "status"='APPROVED', "reviewedAt"=$1,"reviewedById"=703`, [reviewedAt]);
  return (await db.query<{ occurrenceStatus: string }>(`SELECT "occurrenceStatus" FROM "Excuse"`)).rows[0]!.occurrenceStatus;
}
async function workLog(tutorId: number, allocationId: number, day = '2026-09-29') {
  return db.query(`INSERT INTO "WorkLog" ("tutorId","allocationId","workDate","hours","description","updatedAt") VALUES ($1,$2,$3,1,'Worked',now())`, [tutorId, allocationId, day]);
}
describe('sick occurrence database guarantees', () => {
  it('pending and rejected leave the exact session and following occurrence unchanged', async () => {
    await submit();
    expect((await db.query(`SELECT "status","occurrenceStatus" FROM "Excuse"`)).rows).toEqual([{ status: 'PENDING', occurrenceStatus: null }]);
    await db.exec(`UPDATE "Excuse" SET "status"='REJECTED',"reviewReason"='Evidence insufficient'`);
    expect((await db.query(`SELECT "status","occurrenceStatus" FROM "Excuse"`)).rows).toEqual([{ status: 'REJECTED', occurrenceStatus: null }]);
    await expect(workLog(701,701)).resolves.toBeDefined();
    expect((await db.query(`SELECT "status" FROM "Allocation" WHERE "tutorId"=701 ORDER BY "id"`)).rows).toEqual([{ status: 'CONFIRMED' },{ status: 'CONFIRMED' }]);
  });
  it.each([
    ['2026-09-28 10:00','2026-09-28 11:00','EXCUSED'],
    ['2026-09-28 10:00','2026-09-29 07:00','EXCUSED'],
    ['2026-09-29 01:00','2026-09-29 07:00','SKIPPED'],
    ['2026-09-30 01:00','2026-09-30 07:00','SKIPPED'],
    ['2026-09-28 10:00','2026-09-29 09:01','SKIPPED'],
    ['2026-09-28 22:00','2026-09-29 07:00','SKIPPED'],
  ])('classifies submission %s approved %s as %s', async (submitted, approved, status) => {
    await submit(submitted);
    expect(await approve(approved)).toBe(status);
    await expect(workLog(701,701)).rejects.toThrow('approved sick sessions cannot have worked hours');
    await expect(workLog(702,703)).resolves.toBeDefined();
    await expect(workLog(701,702,'2026-10-06')).resolves.toBeDefined();
    expect((await db.query(`SELECT count(*)::int AS total FROM "Allocation"`)).rows[0]).toEqual({ total: 3 });
  });
  it('does not allow a request to be attached to another tutor occurrence', async () => {
    await expect(db.query(`INSERT INTO "Excuse" ("tutorId","allocationId","reason","updatedAt") VALUES (702,701,'Wrong owner',now())`)).rejects.toBeDefined();
  });
  it('preserves existing log evidence but blocks timesheet submission after sickness approval', async () => {
    const sheet = (await db.query<{ id: number }>(`INSERT INTO "Timesheet" ("tutorId","weekStart","updatedAt") VALUES (701,'2026-09-28',now()) RETURNING "id"`)).rows[0]!.id;
    await workLog(701,701);
    await db.query(`UPDATE "WorkLog" SET "timesheetId"=$1`, [sheet]);
    await submit(); await approve('2026-09-30 08:00');
    expect((await db.query(`SELECT count(*)::int AS count FROM "WorkLog"`)).rows[0]).toEqual({ count: 1 });
    await expect(db.query(`UPDATE "Timesheet" SET "status"='SUBMITTED' WHERE "id"=$1`, [sheet])).rejects.toThrow('approved sick session');
  });
  it('uses the local session date for work logs at midnight', async () => {
    await db.exec(`UPDATE "Allocation" SET "startsAt"='2026-09-28 22:30',"endsAt"='2026-09-28 23:30' WHERE "id"=701`);
    await expect(workLog(701,701,'2026-09-28')).rejects.toThrow('workDate must match');
    await expect(workLog(701,701,'2026-09-29')).resolves.toBeDefined();
  });
  it('protects occurrence identity and unique request history', async () => {
    await submit();
    await expect(submit()).rejects.toBeDefined();
    await expect(db.exec(`UPDATE "Allocation" SET "startsAt"='2026-09-29 07:00' WHERE "id"=701`)).rejects.toThrow('cannot be moved');
  });
  it('creates four unique year/term slots and rejects duplicate Term 4', async () => {
    for (const n of [1,2,3,4]) await db.query(`INSERT INTO "AcademicTerm" ("name","year","termNumber","startsOn","endsOn","updatedAt") VALUES ($1,2040,$2,$3,$3,now())`, [`Term ${n}, 2040`,n,`2040-0${n}-01`]);
    await expect(db.query(`INSERT INTO "AcademicTerm" ("name","year","termNumber","startsOn","endsOn","updatedAt") VALUES ('Duplicate 4',2040,4,'2040-09-01','2040-10-01',now())`)).rejects.toBeDefined();
  });
});
