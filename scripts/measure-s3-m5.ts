/** Reproducible local measurements; PGlite is not a production latency claim. */
import { readFile, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { createReportingService } from '../src/services/reporting-service.js';
import { createSearchService } from '../src/services/search-service.js';
import { findAllocationCandidates, type QueryClient } from '../src/services/allocation-queries.js';
import { parseTimetableImport } from '../src/services/timetable-import.js';

const db = new PGlite();
const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
try {
  for (const entry of (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await db.exec(await readFile(new URL(`${entry.name}/migration.sql`, migrationRoot), 'utf8'));
  }
  await db.exec(`
    INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt")
      SELECT n, 'bench|' || n, 't' || n || '@example.invalid', 'Tutor ' || lpad(n::text,4,'0'), 'TUTOR', now() FROM generate_series(1,1000) n;
    INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES (2001,'bench|organiser','o@example.invalid','Organiser','ORGANISER',now());
    INSERT INTO "Course" ("id","code","name","hourlyRate","budget","updatedAt")
      SELECT n, 'COURSE' || n, 'Course ' || n, 100, 10000, now() FROM generate_series(1,50) n;
    INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") SELECT n,20 FROM generate_series(1,1000) n;
    INSERT INTO "TutorMark" ("tutorId","courseId","mark") SELECT n,1,65+n%35 FROM generate_series(1,1000) n;
    INSERT INTO "Allocation" ("id","tutorId","courseId","startsAt","endsAt","allocatedHours","updatedAt")
      SELECT n,n,1,'2025-09-01 10:00'::timestamp,'2025-09-01 12:00'::timestamp,2,now() FROM generate_series(1,500) n;
    UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=2001,"reviewedAt"=now();
    INSERT INTO "Timesheet" ("id","tutorId","weekStart","updatedAt") SELECT n,n,'2025-09-01'::date,now() FROM generate_series(1,250) n;
    INSERT INTO "WorkLog" ("tutorId","allocationId","timesheetId","workDate","hours","description","updatedAt")
      SELECT n,n,n,'2025-09-01'::date,2,'Tutorial',now() FROM generate_series(1,250) n;
    UPDATE "Timesheet" SET "status"='SUBMITTED',"submittedAt"=now();
    UPDATE "Timesheet" SET "status"='APPROVED',"reviewedById"=2001,"reviewedAt"=now();
    UPDATE "WorkLog" SET "approvedHourlyRate"=100;
    ANALYZE;
  `);
  let queries = 0;
  const client: QueryClient = { async query<Row>(sql: string, parameters: unknown[] = []) {
    queries += 1;
    return { rows: (await db.query(sql, parameters)).rows as Row[] };
  } };
  const reports = createReportingService(client);
  const search = createSearchService(client);
  const reportQuery = { weekStart: new Date('2025-09-01T00:00:00Z'), weeks: 1 };
  const csv = 'date,start,end,label,repeat\n' + Array.from({ length: 400 }, (_, i) => `2025-09-01,09:00,10:00,Session ${i},once`).join('\n');
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['workload report', () => reports.workloadReport(reportQuery)],
    ['payroll export', () => reports.payrollExport(reportQuery)],
    ['organiser search', () => search.search({ id: 2001, role: 'ORGANISER' }, { term: 'Tutor', categories: ['course','person','timesheet'], page: 1, pageSize: 25 })],
    ['candidate ranking', () => findAllocationCandidates(client, { courseId: 1, startsAt: new Date('2025-09-02T10:00:00Z'), endsAt: new Date('2025-09-02T12:00:00Z'), minimumMark: 65, requestedHours: 2 })],
    ['400-row import parsing', async () => parseTimetableImport({ source: 'CSV', text: csv, timeZone: 'UTC', term: { id: 1, name: 'Benchmark', startsOn: '2025-09-01', endsOn: '2025-12-01' } })],
  ];
  const measurements = [];
  for (const [name, operation] of cases) {
    await operation(); // warm-up
    const durations: number[] = [];
    const startQueries = queries;
    for (let i = 0; i < 7; i += 1) {
      const start = performance.now(); await operation(); durations.push(performance.now() - start);
    }
    durations.sort((a,b) => a-b);
    measurements.push({ name, runs: 7, medianMs: Number(durations[3]!.toFixed(2)), maxMs: Number(durations[6]!.toFixed(2)), queriesPerRun: (queries - startQueries) / 7 });
  }
  const report = await reports.workloadReport(reportQuery);
  if (report.tutors.length !== 1000 || report.courses.length !== 50 || report.courses[0]?.approvedWorkedHours !== 500) throw new Error('Benchmark fixture totals did not reconcile');
  console.log(JSON.stringify({ engine: 'PGlite; local warm measurements, not Neon/Render network latency', dataset: { tutors: 1000, courses: 50, allocations: 500, approvedWorkLogs: 250, importRows: 400 }, measurements }, null, 2));
} finally { await db.close(); }
