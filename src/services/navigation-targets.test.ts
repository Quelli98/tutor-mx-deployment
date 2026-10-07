import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveNavigation } from './navigation-targets.js';
import { createSearchService } from './search-service.js';
import type { QueryClient } from './allocation-queries.js';

describe('shared ownership migration and live destination permission checks', () => {
  let db: PGlite;
  let client: QueryClient;
  beforeAll(async () => {
    db = new PGlite();
    const path = new URL('../../prisma/migrations/', import.meta.url);
    const dirs = (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const migration = '20261007000000_shared_profile_schedule';

    for (const dir of dirs.filter(dir => dir < migration)) await db.exec(await readFile(new URL(`${dir}/migration.sql`, path), 'utf8'));
    await db.exec(await readFile(new URL('../../prisma/seed.sql', import.meta.url), 'utf8'));
    const before = await db.query('SELECT * FROM "TimeSlot" ORDER BY "id"');
    await db.exec(await readFile(new URL(`${migration}/migration.sql`, path), 'utf8'));
    expect((await db.query('SELECT * FROM "TimeSlot" ORDER BY "id"')).rows).toEqual(before.rows);
    for (const dir of dirs.filter(dir => dir > migration)) await db.exec(await readFile(new URL(`${dir}/migration.sql`, path), 'utf8'));
    client = { async query<Row>(sql: string, parameters?: unknown[]) { return { rows: (await db.query(sql, parameters)).rows as Row[] }; } };
  });
  afterAll(async () => { await db.close(); });
  it('preserves tutor rows and permits a Student schedule while rejecting Organiser ownership', async () => {
    const sql = `INSERT INTO "TimeSlot" ("tutorId", "type", "startsAt", "endsAt") SELECT "id", 'BUSY', '2030-10-01 08:00', '2030-10-01 09:00' FROM "Profile" WHERE "auth0Id" = $1 RETURNING "id"`;
    expect((await db.query(sql, ['demo|student'])).rows).toHaveLength(1);
    await expect(db.query(sql, ['demo|organiser'])).rejects.toThrow(/Schedule owner/);
  });
  it('allows a Student timetable destination but denies a Tutor or removed destination', async () => {
    expect(await resolveNavigation(client, 'demo|student', { destinationId: 'student-timetable' })).toEqual({ linkPath: '/student/timetable', action: 'View' });
    for (const destinationId of ['tutor-forms', 'deleted-page', '__proto__']) await expect(resolveNavigation(client, 'demo|student', { destinationId })).rejects.toMatchObject({ status: 404 });
    await expect(resolveNavigation(client, 'deleted-account', { destinationId: 'settings' })).rejects.toMatchObject({ status: 404 });
  });
  it('checks a timesheet owner and rechecks after its ownership changes', async () => {
    const owner = (await db.query<{ id: number }>(`SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-pass'`)).rows[0]!.id;
    const other = (await db.query<{ id: number }>(`SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|tutor-clash'`)).rows[0]!.id;
    const id = (await db.query<{ id: number }>(`INSERT INTO "Timesheet" ("tutorId","weekStart") VALUES ($1,'2040-01-02') RETURNING "id"`, [owner])).rows[0]!.id;
    expect((await resolveNavigation(client, 'demo|tutor-pass', { targetType: 'timesheet', targetId: id })).linkPath).toBe('/tutor/forms');
    await expect(resolveNavigation(client, 'demo|student', { targetType: 'timesheet', targetId: id })).rejects.toMatchObject({ status: 404 });
    await db.query('UPDATE "Timesheet" SET "tutorId" = $2 WHERE "id" = $1', [id, other]);
    await expect(resolveNavigation(client, 'demo|tutor-pass', { targetType: 'timesheet', targetId: id })).rejects.toMatchObject({ status: 404 });
    await db.query('DELETE FROM "Timesheet" WHERE "id" = $1', [id]);
    await expect(resolveNavigation(client, 'demo|organiser', { targetType: 'timesheet', targetId: id })).rejects.toMatchObject({ status: 404 });
  });
  it('checks the current role even for saved public shortcuts', async () => {
    await db.query(`INSERT INTO "Profile" ("auth0Id","email","fullName","role") VALUES ('changed-user','changed@example.test','Changed','STUDENT')`);
    expect((await resolveNavigation(client, 'changed-user', { destinationId: 'student-timetable' })).linkPath).toBe('/student/timetable');
    await db.query(`UPDATE "Profile" SET "role" = 'ORGANISER' WHERE "auth0Id" = 'changed-user'`);
    await expect(resolveNavigation(client, 'changed-user', { destinationId: 'student-timetable' })).rejects.toMatchObject({ status: 404 });
  });
  it('rejects someone else’s notification and a missing target', async () => {
    const owner = (await db.query<{ id: number }>(`SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student'`)).rows[0]!.id;
    const id = (await db.query<{ id: number }>(`INSERT INTO "Notification" ("recipientProfileId","type","title","body","linkPath","targetType","targetId","eventKey") VALUES ($1,'VOLUNTEER_OUTCOME','Test','Test','/student','volunteer',999999,'s4-stale') RETURNING "id"`, [owner])).rows[0]!.id;
    await expect(resolveNavigation(client, 'demo|tutor-pass', { notificationId: id })).rejects.toMatchObject({ status: 404 });
    await expect(resolveNavigation(client, 'demo|student', { notificationId: id })).rejects.toMatchObject({ status: 404 });
  });
  it('fresh Student course search omits closed opportunities', async () => {
    const profile = (await db.query<{ id: number }>(`SELECT "id" FROM "Profile" WHERE "auth0Id" = 'demo|student'`)).rows[0]!;
    await db.query(`UPDATE "OverflowWork" SET "closesAt" = '2000-01-01'`);
    const result = await createSearchService(client).search({ id: profile.id, role: 'STUDENT' }, { term: 'DEMO', categories: ['course'], page: 1, pageSize: 10 });
    expect(result.groups).toEqual([]);
  });
});
