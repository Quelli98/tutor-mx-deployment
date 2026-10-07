import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createBookingService} from './booking-service.js';
import {createSwapService} from './swap-service.js';
import {createMutualAvailabilityService} from './mutual-availability.js';
import {findAllocationCandidates,type QueryClient} from './allocation-queries.js';
import type {PlanningStore} from './planning-store.js';
import {resolveNavigation} from './navigation-targets.js';
let db:PGlite,store:PlanningStore,bookings:ReturnType<typeof createBookingService>,swaps:ReturnType<typeof createSwapService>,now:Date;
const book=(extra:Record<string,unknown>={})=>({courseId:1,tutorId:3,termId:1,startsAt:'2030-09-02T11:00:00Z',endsAt:'2030-09-02T12:00:00Z',requestKey:'request-0001',...extra});
const propose=async()=>{const options=await swaps.options('tutor',1);return swaps.create('tutor',{allocationId:1,replacementId:4,allocationRevision:options.allocationRevision,reason:'Lecture conflict'});};
const accept=async()=>{const d=await propose();await swaps.change('replacement',d.swap.id,{action:'accept',version:1});return d;};
const live=async()=> (await db.query('SELECT * FROM "Allocation" ORDER BY "id"')).rows;
beforeAll(async()=>{
 db=new PGlite({parsers:{1114:value=>new Date(value.replace(' ','T')+'Z')}});const dir=new URL('../../prisma/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).sort())if(name!=='migration_lock.toml')await db.exec(await readFile(new URL(name+'/migration.sql',dir),'utf8'));
 const adapter=(q:Pick<PGlite,'query'>):QueryClient=>({async query<Row>(sql:string,params:unknown[]=[]){return {rows:(await q.query(sql,params)).rows as Row[]};}});
 store={...adapter(db),transaction:work=>db.transaction(tx=>work(adapter(tx)))};bookings=createBookingService(store,()=>now);swaps=createSwapService(store,()=>now);
});
afterAll(async()=>db.close());
beforeEach(async()=>{
 now=new Date('2030-09-01T00:00:00Z');await db.exec(`TRUNCATE "Profile","Course","AcademicTerm" RESTART IDENTITY CASCADE;
 INSERT INTO "Profile" ("auth0Id","email","fullName","role") VALUES ('org','org@example.test','Organiser','ORGANISER'),('org2','org2@example.test','Second Organiser','ORGANISER'),('tutor','tutor@example.test','Tutor One','TUTOR'),('replacement','replacement@example.test','Tutor Two','TUTOR'),('low','low@example.test','Low Mark','TUTOR'),('student','student@example.test','Student One','STUDENT'),('student2','student2@example.test','Student Two','STUDENT');
 INSERT INTO "Course" ("code","name","hourlyRate","budget") VALUES ('COMS','Computing',100,1000);
 INSERT INTO "TutorMark" ("tutorId","courseId","mark") VALUES (3,1,80),(4,1,75),(5,1,30);
 INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (3,20),(4,20),(5,20);
 INSERT INTO "AcademicTerm" ("name","startsOn","endsOn","published","updatedAt") VALUES ('Term Three','2030-09-01','2030-09-30',true,now());
 INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours") VALUES (3,1,'2030-09-02 08:00','2030-09-02 10:00',2);
 UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=1,"reviewedAt"=now();`);
});
describe('student booking lifecycle, privacy and double-booking guards',()=>{
 it('confirms scheduling-only appointments, projects both calendars and records one event per participant',async()=>{
  const before=await live(),result=await bookings.create('student',book());expect(result.booking).toMatchObject({studentId:6,tutorId:3,status:'CONFIRMED',version:1,courseCode:'COMS'});expect(result.history).toHaveLength(1);
  for(const subject of ['student','tutor'])expect((await bookings.list(subject,{startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-03T00:00:00Z'})).items).toHaveLength(1);
  expect((await bookings.list('student2')).items).toEqual([]);await expect(bookings.get('student2',result.booking.id)).rejects.toMatchObject({status:404});await expect(bookings.get('replacement',result.booking.id)).rejects.toMatchObject({status:404});await expect(bookings.get('org',result.booking.id)).rejects.toMatchObject({status:403});
  expect(await live()).toEqual(before);expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(2);expect(JSON.stringify(result)).not.toMatch(/requestKey|requestHash|auth0|email|hourlyRate/);
  expect(await resolveNavigation(store,'student',{targetType:'booking',targetId:result.booking.id})).toMatchObject({linkPath:`/student/timetable?booking=${result.booking.id}`});await expect(resolveNavigation(store,'student2',{targetType:'booking',targetId:result.booking.id})).rejects.toMatchObject({status:404});
 });
 it('replays an uncertain create without duplicate history/notifications and rejects key reuse for different times',async()=>{
  const a=await bookings.create('student',book()),b=await bookings.create('student',book());expect(b.booking.id).toBe(a.booking.id);
  expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(2);
  await expect(bookings.create('student',book({startsAt:'2030-09-02T12:00:00Z',endsAt:'2030-09-02T13:00:00Z'}))).rejects.toMatchObject({status:409});
 });
 it('only one of two competing students can confirm the same tutor and time',async()=>{
  const results=await Promise.allSettled([bookings.create('student',book()),bookings.create('student2',book({requestKey:'request-0002'}))]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);expect((await db.query('SELECT * FROM "TutoringBooking"')).rows).toHaveLength(1);
 });
 it('rejects overlap for the same student with a different tutor and allows touching boundaries',async()=>{
  await bookings.create('student',book());await expect(bookings.create('student',book({tutorId:4,requestKey:'request-0002'}))).rejects.toMatchObject({status:409});
  await expect(bookings.create('student2',book({requestKey:'request-0002',startsAt:'2030-09-02T12:00:00Z',endsAt:'2030-09-02T13:00:00Z'}))).resolves.toBeDefined();
 });
 it.each(['student','tutor'])('allows %s to cancel before start, keeps history and releases the time',async subject=>{
  const d=await bookings.create('student',book());const cancelled=await bookings.cancel(subject,d.booking.id,{version:1,note:'No longer needed'});expect(cancelled.booking.status).toBe('CANCELLED');expect(cancelled.canCancel).toBe(false);expect(cancelled.history).toHaveLength(2);
  expect((await bookings.list('student',{startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-03T00:00:00Z'})).items).toEqual([]);
  await expect(bookings.cancel(subject,d.booking.id,{version:1})).rejects.toMatchObject({status:409});expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(4);await expect(bookings.create('student2',book({requestKey:'fresh-key'}))).resolves.toBeDefined();
 });
 it('rejects cancellation by outsiders, stale versions and at the exact start boundary',async()=>{
  const d=await bookings.create('student',book());await expect(bookings.cancel('student2',d.booking.id,{version:1})).rejects.toMatchObject({status:404});await expect(bookings.cancel('student',d.booking.id,{version:2})).rejects.toMatchObject({status:409});
  now=new Date('2030-09-02T11:00:00Z');await expect(bookings.cancel('tutor',d.booking.id,{version:1})).rejects.toMatchObject({code:'BOOKING_STARTED'});expect((await bookings.get('tutor',d.booking.id)).canCancel).toBe(false);
 });
 it.each(['class','allocation','break','mark','term'])('rechecks a changed %s before writing any booking',async mode=>{
  if(mode==='class')await db.exec(`INSERT INTO "TimeSlot" ("tutorId","type","startsAt","endsAt","label","recurrence") VALUES (6,'BUSY','2030-08-26 11:00','2030-08-26 12:00','PRIVATE CLASS','WEEKLY')`);
  if(mode==='allocation')await db.exec(`UPDATE "Allocation" SET "startsAt"='2030-09-02 11:00',"endsAt"='2030-09-02 13:00'`);
  if(mode==='break')await db.exec(`UPDATE "AcademicTerm" SET "teachingBreaks"='[{"startsOn":"2030-09-02","endsOn":"2030-09-02"}]'`);
  if(mode==='mark')await db.exec(`UPDATE "TutorMark" SET "mark"=20 WHERE "tutorId"=3`);
  if(mode==='term')await db.exec(`UPDATE "AcademicTerm" SET "published"=false`);
  await expect(bookings.create('student',book())).rejects.toBeDefined();expect((await db.query('SELECT * FROM "TutoringBooking"')).rows).toEqual([]);expect((await db.query('SELECT * FROM "Notification"')).rows).toEqual([]);
 });
 it.each([{studentId:7},{requestKey:'x'},{durationMinutes:60},{startsAt:'2030-09-02T11:01:00Z'},{endsAt:'2030-09-02T15:00:00Z'}])('validates booking fields and allowed start/duration %j',async extra=>{await expect(bookings.create('student',book(extra))).rejects.toBeDefined();});
 it('treats bookings as clashes in standard allocation ranking and direct database writes',async()=>{
  const b=await bookings.create('student',book());const ranking=await findAllocationCandidates(store,{courseId:1,startsAt:new Date(book().startsAt as string),endsAt:new Date(book().endsAt as string),requestedHours:1,minimumMark:50});expect(ranking.find(x=>x.tutorId===3)).toMatchObject({isEligible:false,hasClash:true});expect(JSON.stringify(ranking)).not.toContain('Student One');
  await db.exec(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours") VALUES (3,1,'2030-09-02 11:00','2030-09-02 12:00',1)`);await expect(db.exec(`UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=1,"reviewedAt"=now() WHERE "id"=2`)).rejects.toThrow(/booking/);
  await expect(db.query('DELETE FROM "TutoringBooking" WHERE "id"=$1',[b.booking.id])).rejects.toThrow();await expect(db.exec('UPDATE "BookingEvent" SET "note"=\'changed\'')).rejects.toThrow(/immutable/);
 });
 it('rejects direct conflicting booking inserts and interval rewrites',async()=>{
  const b=await bookings.create('student',book());await expect(db.exec(`INSERT INTO "TutoringBooking" ("studentId","tutorId","courseId","termId","startsAt","endsAt","requestKey","requestHash") VALUES (7,3,1,1,'2030-09-02 11:00','2030-09-02 12:00','raw-key-1','hash')`)).rejects.toThrow(/free/);
  await expect(db.query(`UPDATE "TutoringBooking" SET "startsAt"='2030-09-02 12:00',"endsAt"='2030-09-02 13:00' WHERE "id"=$1`,[b.booking.id])).rejects.toThrow(/immutable/);
 });
 it('accepts minimum/maximum duration and returns no private labels in subsequent availability',async()=>{
  await bookings.create('student',book({endsAt:'2030-09-02T11:15:00Z'}));await bookings.create('student2',book({requestKey:'long-key',startsAt:'2030-09-02T12:00:00Z',endsAt:'2030-09-02T15:00:00Z'}));
  const result=await createMutualAvailabilityService(store,()=>now).search('student',{courseId:1,tutorId:3,termId:1,startsAt:'2030-09-02T11:00:00Z',endsAt:'2030-09-02T16:00:00Z',durationMinutes:60});expect(result.slots.map(x=>x.startsAt)).toEqual(['2030-09-02T15:00:00.000Z']);
 });
});
describe('Tutor replacement and organiser approval workflow',()=>{
 it('previews only eligible replacements with safe fields and changes no live allocation before approval',async()=>{
  const before=await live(),options=await swaps.options('tutor',1);expect(options.choices).toEqual([{tutorId:4,fullName:'Tutor Two',hoursBefore:0,hoursAfter:2}]);expect(options).toMatchObject({requesterHoursBefore:2,requesterHoursAfter:0});expect(JSON.stringify(options)).not.toMatch(/mark|email|clashDetails|auth0/);
  const d=await accept();expect(await live()).toEqual(before);expect((await swaps.get('replacement',d.swap.id)).history).toHaveLength(2);expect((await swaps.list('low')).items).toEqual([]);await expect(swaps.get('low',d.swap.id)).rejects.toMatchObject({status:404});
  expect(await resolveNavigation(store,'org',{targetType:'swap',targetId:d.swap.id})).toMatchObject({linkPath:`/organiser/swaps?swap=${d.swap.id}`});await expect(resolveNavigation(store,'low',{targetType:'swap',targetId:d.swap.id})).rejects.toMatchObject({status:404});
 });
 it('requires replacement acceptance and atomically approves a new allocation identity with history',async()=>{
  const d=await propose();await expect(swaps.change('org',d.swap.id,{action:'approve',version:1})).rejects.toMatchObject({status:409});
  await swaps.change('replacement',d.swap.id,{action:'accept',version:1});const result=await swaps.change('org',d.swap.id,{action:'approve',version:2,note:'Approved cover'});
  expect(result.swap).toMatchObject({status:'APPROVED',version:3,replacementAllocationId:2});expect(result.history).toHaveLength(3);expect(await live()).toMatchObject([{id:1,tutorId:3,status:'CANCELLED'},{id:2,tutorId:4,status:'CONFIRMED',reviewedById:1}]);
  await expect(swaps.change('org2',d.swap.id,{action:'approve',version:2})).rejects.toMatchObject({status:409});expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(7);
 });
 it.each([['replacement','decline','DECLINED'],['tutor','cancel','CANCELLED'],['org','reject','REJECTED']])('records %s %s without changing live assignments',async(subject,action,status)=>{
  const before=await live(),d=await propose(),result=await swaps.change(subject!,d.swap.id,{action,version:1,note:'Reason'});expect(result.swap.status).toBe(status);expect(result.history).toHaveLength(2);expect(await live()).toEqual(before);
  await expect(db.exec('DELETE FROM "SwapEvent"')).rejects.toThrow(/immutable/);
 });
 it('only permits addressed replacement decisions and one active request for the allocation',async()=>{
  const d=await propose();await expect(propose()).rejects.toMatchObject({status:409});await expect(swaps.change('tutor',d.swap.id,{action:'accept',version:1})).rejects.toMatchObject({status:409});await expect(swaps.change('low',d.swap.id,{action:'accept',version:1})).rejects.toMatchObject({status:404});await expect(swaps.options('replacement',1)).rejects.toMatchObject({status:404});await expect(swaps.list('student')).rejects.toMatchObject({status:403});
 });
 it.each(['capacity','busy','mark','booking','allocation'])('rechecks changed %s and rolls back approval',async mode=>{
  const d=await accept();if(mode==='capacity')await db.exec('UPDATE "TutorHourLimit" SET "weeklyHours"=1 WHERE "tutorId"=4');if(mode==='busy')await db.exec(`INSERT INTO "TimeSlot" ("tutorId","type","startsAt","endsAt") VALUES (4,'BUSY','2030-09-02 09:00','2030-09-02 10:00')`);if(mode==='mark')await db.exec('UPDATE "TutorMark" SET "mark"=10 WHERE "tutorId"=4');if(mode==='booking')await bookings.create('student',book({tutorId:4,startsAt:'2030-09-02T08:00:00Z',endsAt:'2030-09-02T09:00:00Z'}));if(mode==='allocation')await db.exec('UPDATE "Allocation" SET "allocatedHours"=1');
  const before=await live();await expect(swaps.change('org',d.swap.id,{action:'approve',version:2})).rejects.toMatchObject({status:409});expect(await live()).toEqual(before);expect((await swaps.get('org',d.swap.id)).swap.status).toBe('ACCEPTED');
 });
 it('rejects stale proposal preview, past sessions and sessions carrying attendance history',async()=>{
  const options=await swaps.options('tutor',1);await db.exec('UPDATE "Allocation" SET "allocatedHours"=1');await expect(swaps.create('tutor',{allocationId:1,replacementId:4,allocationRevision:options.allocationRevision,reason:'Changed'})).rejects.toMatchObject({status:409});
  await db.exec(`INSERT INTO "Excuse" ("tutorId","allocationId","reason") VALUES (3,1,'Private')`);await expect(swaps.options('tutor',1)).rejects.toMatchObject({code:'SWAP_SOURCE_CHANGED'});await db.exec('DELETE FROM "Excuse"');now=new Date('2030-09-02T08:00:00Z');await expect(swaps.options('tutor',1)).rejects.toMatchObject({code:'SWAP_SOURCE_CHANGED'});
 });
 it('converges competing approve and cancel to a single terminal state',async()=>{
  const d=await accept();const results=await Promise.allSettled([swaps.change('org',d.swap.id,{action:'approve',version:2}),swaps.change('tutor',d.swap.id,{action:'cancel',version:2})]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await swaps.get('org',d.swap.id)).history).toHaveLength(3);
 });
});
