import {createAuditService,writeAudit,auditSnapshot,redactText,csvCell} from './audit-service.js';
import {createAllocationRestoreService} from './allocation-restore-service.js';
import {createStudentSickNoteService,bookingAbsenceStatus} from './student-sick-note-service.js';
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
 await db.exec(`SET TIME ZONE 'UTC'`);
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

describe('Student sick notes: ownership, privacy, attendance and competing actions',()=>{
 const sick=()=>createStudentSickNoteService(store,()=>now);
 const report=async()=>{const b=await bookings.create('student',book());return sick().submit('student',b.booking.id,{bookingVersion:1,reason:'Private illness reason'});};
 const decision=(extra:Record<string,unknown>={})=>({version:1,bookingVersion:2,decision:'APPROVED',reviewNote:'Reviewed privately',...extra});
 it('submits only an owned eligible booking, pauses cancellation and limits private details',async()=>{
  const b=await bookings.create('student',book());
  await expect(sick().submit('student2',b.booking.id,{bookingVersion:1,reason:'Ill'})).rejects.toMatchObject({status:404});
  await expect(sick().submit('tutor',b.booking.id,{bookingVersion:1,reason:'Ill'})).rejects.toMatchObject({status:403});
  const n=await sick().submit('student',b.booking.id,{bookingVersion:1,reason:'Private illness reason'});expect(n.status).toBe('PENDING');
  const student=await bookings.get('student',b.booking.id),tutor=await bookings.get('tutor',b.booking.id);expect(student).toMatchObject({canCancel:false,canSubmitSickNote:false,sickNotePending:true});expect(student.sickNotes).toHaveLength(1);expect(tutor.sickNotes).toBeUndefined();expect(JSON.stringify(tutor)).not.toContain('Private illness');
  await expect(bookings.cancel('tutor',b.booking.id,{version:2})).rejects.toMatchObject({status:409});
  await expect(sick().submit('student',b.booking.id,{bookingVersion:2,reason:'Again'})).rejects.toMatchObject({status:409});
  expect((await sick().list('org')).pendingCount).toBe(1);await expect(sick().list('student')).rejects.toMatchObject({status:403});
  const notifications=(await db.query('SELECT * FROM "Notification"')).rows;expect(notifications).toHaveLength(4);expect(JSON.stringify(notifications)).not.toContain('Private illness');
  expect(await resolveNavigation(store,'org',{targetType:'sick-note',targetId:b.booking.id})).toMatchObject({linkPath:'/organiser/approvals'});await expect(resolveNavigation(store,'tutor',{targetType:'sick-note',targetId:b.booking.id})).rejects.toMatchObject({status:404});
 });
 it.each(['2030-09-02T10:59:59Z','2030-09-02T11:00:00Z','2030-09-03T12:00:00Z'])('uses approval instant %s and retains history',async at=>{
  const n=await report();now=new Date(at);await sick().decide('org',n.id,decision());const d=await bookings.get('student',n.bookingId),expected=at<'2030-09-02T11:00:00Z'?'EXCUSED':'SKIPPED';expect(d.booking.occurrenceStatus).toBe(expected);expect(d.canSubmitSickNote).toBe(false);expect(d.history).toHaveLength(3);expect(d.sickNotes?.[0]).toMatchObject({status:'APPROVED',reviewNote:'Reviewed privately'});
  const calendar=await bookings.list('student',{startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-03T00:00:00Z'});expect(calendar.items).toHaveLength(expected==='EXCUSED'?0:1);
  expect(JSON.stringify(await bookings.get('tutor',n.bookingId))).not.toMatch(/Private illness|Reviewed privately/);
  if(expected==='EXCUSED')await expect(bookings.create('student2',book({requestKey:'released-time'}))).resolves.toBeDefined();
  await expect(sick().decide('org2',n.id,decision())).rejects.toMatchObject({status:409});expect((await db.query(`SELECT * FROM "Notification" WHERE "type"='STUDENT_SICK_DECIDED'`)).rows).toHaveLength(1);
 });
 it('requires a rejection note, keeps the booking busy and permits a new request',async()=>{
  const n=await report();await expect(sick().decide('org',n.id,decision({decision:'REJECTED',reviewNote:'  '}))).rejects.toMatchObject({status:400});
  await sick().decide('org',n.id,decision({decision:'REJECTED',reviewNote:'Please clarify date'}));const d=await bookings.get('student',n.bookingId);expect(d).toMatchObject({booking:{occurrenceStatus:'SCHEDULED',version:3},canCancel:true,canSubmitSickNote:true});expect(d.sickNotes?.[0]).toMatchObject({status:'REJECTED',reviewNote:'Please clarify date'});
  await expect(bookings.create('student2',book({requestKey:'still-busy'}))).rejects.toMatchObject({status:409});await sick().submit('student',n.bookingId,{bookingVersion:3,reason:'Clarified'});expect((await bookings.get('student',n.bookingId)).sickNotes).toHaveLength(2);
  expect((await db.query('SELECT * FROM "Notification" WHERE "recipientProfileId"=3')).rows).toHaveLength(1);
 });
 it.each(['report-first','cancel-first'])('converges report versus cancellation: %s',async order=>{
  const b=await bookings.create('student',book());const reportAction=()=>sick().submit('student',b.booking.id,{bookingVersion:1,reason:'Ill'}),cancelAction=()=>bookings.cancel('tutor',b.booking.id,{version:1});const actions=order==='report-first'?[reportAction,cancelAction]:[cancelAction,reportAction];const result=await Promise.allSettled(actions.map(action=>action()));expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);const state=await bookings.get('student',b.booking.id);expect(state.booking.version).toBe(2);expect(state.history).toHaveLength(2);expect(state.booking.status==='CANCELLED'?state.sickNotes?.length===0:state.sickNotePending).toBe(true);
 });
 it('two Organiser decisions produce one outcome and one Student notification',async()=>{
  const n=await report();const results=await Promise.allSettled([sick().decide('org',n.id,decision()),sick().decide('org2',n.id,decision({decision:'REJECTED'}))]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await bookings.get('student',n.bookingId)).history).toHaveLength(3);expect((await db.query(`SELECT * FROM "Notification" WHERE "type"='STUDENT_SICK_DECIDED'`)).rows).toHaveLength(1);
 });
 it('rejects malformed, forged, missing and stale mutations without side effects',async()=>{
  const b=await bookings.create('student',book());for(const payload of [{bookingVersion:1,reason:''},{bookingVersion:1,reason:'x'.repeat(1001)},{bookingVersion:1,reason:'Ill',studentId:7},{bookingVersion:0,reason:'Ill'}])await expect(sick().submit('student',b.booking.id,payload)).rejects.toMatchObject({status:400});
  await expect(sick().submit('student',999,{bookingVersion:1,reason:'Ill'})).rejects.toMatchObject({status:404});const n=await sick().submit('student',b.booking.id,{bookingVersion:1,reason:'Ill'});
  await expect(sick().decide('student',n.id,decision())).rejects.toMatchObject({status:403});await expect(sick().decide('org',999,decision())).rejects.toMatchObject({status:404});await expect(sick().decide('org',n.id,decision({decision:'BAD'}))).rejects.toMatchObject({status:400});await expect(sick().decide('org',n.id,decision({bookingVersion:1}))).rejects.toMatchObject({status:409});await expect(sick().list('org',{page:10001})).rejects.toMatchObject({status:400});
  expect((await sick().list('org',{page:2})).items).toEqual([]);
 });
 it('database guards prevent deleting history, duplicate active notes and bypassing pending cancellation',async()=>{
  const n=await report();await expect(db.query('DELETE FROM "StudentSickNote" WHERE "id"=$1',[n.id])).rejects.toThrow(/immutable/);await expect(db.query(`INSERT INTO "StudentSickNote" ("bookingId","reason") VALUES ($1,'Again')`,[n.bookingId])).rejects.toThrow();await expect(db.query(`UPDATE "TutoringBooking" SET "status"='CANCELLED' WHERE "id"=$1`,[n.bookingId])).rejects.toThrow(/pending/);
  await sick().decide('org',n.id,decision());await expect(db.query(`UPDATE "StudentSickNote" SET "reason"='changed' WHERE "id"=$1`,[n.id])).rejects.toThrow(/immutable/);await expect(db.query(`UPDATE "TutoringBooking" SET "occurrenceStatus"='SCHEDULED' WHERE "id"=$1`,[n.bookingId])).rejects.toThrow(/immutable/);
 });
 it('classifies the exact approval boundary independently of submission date',()=>{expect(bookingAbsenceStatus(new Date(1000),new Date(999))).toBe('EXCUSED');expect(bookingAbsenceStatus(new Date(1000),new Date(1000))).toBe('SKIPPED');});
});

describe('Sprint 4 audit, restore and retry hardening',()=>{
 const audit=()=>createAuditService(store);
 const restore=()=>createAllocationRestoreService(store,()=>now);
 const events=async()=> (await db.query<{id:number;action:string;actorId:number;targetId:number;before:Record<string,unknown>;after:Record<string,unknown>;reason:string}>('SELECT * FROM "AuditEvent" ORDER BY "id"')).rows;
 async function historic(){const a=(await db.query('SELECT *,"allocatedHours"::float8 AS "allocatedHours" FROM "Allocation" WHERE "id"=1')).rows[0];await writeAudit(store,1,'ALLOCATION_CREATED','allocation',1,{},a,'Manual choice');return (await events())[0]!;}
 it('allowlists snapshots and redacts credentials without storing arbitrary request bodies',()=>{
  const raw={id:1,status:'PENDING',reason:'Private illness',reviewNote:'Private review',requestBody:{secret:'private'},token:'private',email:'private',auth0Id:'private'};
  expect(auditSnapshot('sick-note',raw)).toEqual({id:1,status:'PENDING'});expect(auditSnapshot('booking',raw)).toEqual({id:1,status:'PENDING'});expect(auditSnapshot('scenario',{id:1,notes:'private',items:[{id:2,tutorId:3,secret:'private'}]})).toEqual({id:1,items:[{id:2,tutorId:3}]});expect(redactText('Manual reason token=abc Bearer xyz https://private.test')).toBe('Manual reason [REDACTED] [REDACTED] [REDACTED URL]');expect(csvCell(' =SUM(A1)')).toBe('"\' =SUM(A1)"');
 });
 it('audits successful booking status changes once with actor and before/after values',async()=>{
  const b=await bookings.create('student',book());await bookings.create('student',book());await bookings.cancel('tutor',b.booking.id,{version:1});const rows=await events();expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({action:'BOOKING_CONFIRMED',actorId:6,targetId:b.booking.id});expect(rows[1]).toMatchObject({actorId:3,before:{status:'CONFIRMED',version:1},after:{status:'CANCELLED',version:2}});
  await expect(bookings.cancel('student',b.booking.id,{version:1})).rejects.toMatchObject({status:409});expect(await events()).toHaveLength(2);
 });
 it('rolls back audit, events, notifications and domain rows together',async()=>{
  const failing:PlanningStore={...store,transaction:work=>store.transaction(async client=>{const result=await work(client);throw new Error(`Injected failure after ${Boolean(result)}`);})};await expect(createBookingService(failing,()=>now).create('student',book())).rejects.toThrow('Injected');expect(await events()).toEqual([]);expect((await db.query('SELECT * FROM "TutoringBooking"')).rows).toEqual([]);expect((await db.query('SELECT * FROM "Notification"')).rows).toEqual([]);
 });
 it('restricts audit, detail, export and restore to fresh Organiser roles',async()=>{
  const e=await historic();for(const subject of ['student','tutor']){await expect(audit().list(subject)).rejects.toMatchObject({status:403});await expect(audit().get(subject,e.id)).rejects.toMatchObject({status:403});await expect(audit().export(subject)).rejects.toMatchObject({status:403});await expect(restore().history(subject,1)).rejects.toMatchObject({status:403});await expect(restore().preview(subject,1,{eventId:e.id,side:'after'})).rejects.toMatchObject({status:403});}
  await db.exec(`UPDATE "Profile" SET "role"='STUDENT' WHERE "id"=1`);await expect(audit().get('org',e.id)).rejects.toMatchObject({status:403});
 });
 it('filters by actor, action, target and dates, and exports the same redacted fields',async()=>{
  const e=await historic();await bookings.create('student',book());expect((await audit().list('org',{actorId:1,action:'ALLOCATION_CREATED',targetType:'allocation',targetId:1})).items).toHaveLength(1);expect((await audit().list('org',{actorId:2})).items).toEqual([]);expect((await audit().list('org',{from:'2030-01-01T00:00:00Z',to:'2030-01-02T00:00:00Z'})).items).toEqual([]);
  expect(await audit().get('org',e.id)).toMatchObject({reason:'Manual choice'});const csv=await audit().export('org',{targetType:'allocation'});expect(csv.count).toBe(1);expect(csv.csv).toContain('Manual choice');expect(csv.csv).not.toMatch(/auth0|token|email/);await expect(audit().get('org',999)).rejects.toMatchObject({status:404});
 });
 it.each([{from:'bad'},{page:0},{actorId:'x'},{action:'bad action'},{targetType:'profile'},{secret:'x'},{from:'2020-01-01T00:00:00Z',to:'2030-01-01T00:00:00Z'}])('bounds audit input %j',async input=>{await expect(audit().list('org',input)).rejects.toMatchObject({status:400});});
 it('paginates without truncation and refuses oversized CSV exports',async()=>{
  await db.exec(`INSERT INTO "AuditEvent" ("actorId","action","targetType","targetId") SELECT 1,'BOOKING_CONFIRMED','booking',x FROM generate_series(1,1001) x`);
  const first=await audit().list('org'),second=await audit().list('org',{page:2});expect(first.items).toHaveLength(50);expect(first.hasMore).toBe(true);expect(second.items).toHaveLength(50);expect(second.items[0]).not.toEqual(first.items[0]);await expect(audit().export('org')).rejects.toMatchObject({code:'AUDIT_EXPORT_LIMIT'});
 });
 it('previews history, restores as a new identity and preserves immutable source events',async()=>{
  const e=await historic();await db.exec(`UPDATE "Allocation" SET "startsAt"='2030-09-02 09:00',"endsAt"='2030-09-02 10:00',"allocatedHours"=1 WHERE "id"=1`);const preview=await restore().preview('org',1,{eventId:e.id,side:'after'});expect(preview.canRestore).toBe(true);expect(preview.current.allocatedHours).toBe(1);expect(preview.historical.allocatedHours).toBe(2);
  const result=await restore().restore('org',1,{eventId:e.id,side:'after',expectedVersion:preview.expectedVersion,reason:'Correct mistaken hours'});expect(result.allocationId).not.toBe(1);const rows=await live();expect(rows).toMatchObject([{id:1,status:'CANCELLED'},{id:result.allocationId,status:'CONFIRMED'}]);expect((await events())[0]).toEqual(e);expect((await events()).map(x=>x.action)).toEqual(['ALLOCATION_CREATED','ALLOCATION_RESTORE_REPLACED','ALLOCATION_RESTORED']);expect((await restore().history('org',1)).items).toHaveLength(2);expect((await restore().preview('org',1,{eventId:e.id,side:'after'})).canRestore).toBe(false);expect((await events())[2]?.after).toMatchObject({sourceAllocationId:1,restoredFromEventId:e.id,restoredFromSide:'after'});
  await expect(restore().restore('org',1,{eventId:e.id,side:'after',expectedVersion:preview.expectedVersion,reason:'Retry'})).rejects.toMatchObject({code:'RESTORE_STALE'});await expect(db.exec(`UPDATE "AuditEvent" SET "reason"='rewrite'`)).rejects.toThrow(/immutable/);
 });
 it.each(['mark','clash','capacity','past','history'])('refuses restore when current %s rules fail',async mode=>{
  const e=await historic();if(mode==='mark')await db.exec(`UPDATE "TutorMark" SET "mark"=20 WHERE "tutorId"=3`);if(mode==='clash')await db.exec(`INSERT INTO "TimeSlot" ("tutorId","type","startsAt","endsAt","label") VALUES (3,'BUSY','2030-09-02 08:00','2030-09-02 10:00','Private class')`);if(mode==='capacity')await db.exec(`UPDATE "TutorHourLimit" SET "weeklyHours"=1 WHERE "tutorId"=3`);if(mode==='past')now=new Date('2030-09-03T00:00:00Z');if(mode==='history')await propose();
  const preview=await restore().preview('org',1,{eventId:e.id,side:'after'}),before=await live(),count=(await events()).length;expect(preview.canRestore).toBe(false);await expect(restore().restore('org',1,{eventId:e.id,side:'after',expectedVersion:preview.expectedVersion,reason:'Try restore'})).rejects.toMatchObject({code:'RESTORE_RULE_FAILED'});expect(await live()).toEqual(before);expect(await events()).toHaveLength(count);
 });
 it('preserves a stricter current minimum mark instead of restoring weaker eligibility',async()=>{
  const e=await historic();await db.exec(`UPDATE "Allocation" SET "minimumMark"=90 WHERE "id"=1`);const p=await restore().preview('org',1,{eventId:e.id,side:'after'});expect(p.requiredMark).toBe(90);expect(p.canRestore).toBe(false);expect(p.reasons).toContain('insufficient-mark');
 });
 it('rolls back a restore after writes and audit insertion fail to commit',async()=>{
  const e=await historic(),preview=await restore().preview('org',1,{eventId:e.id,side:'after'}),before=await live();const failing:PlanningStore={...store,transaction:work=>store.transaction(async client=>{await work(client);throw new Error('Abort commit');})};await expect(createAllocationRestoreService(failing,()=>now).restore('org',1,{eventId:e.id,side:'after',expectedVersion:preview.expectedVersion,reason:'Correct'})).rejects.toThrow('Abort commit');expect(await live()).toEqual(before);expect(await events()).toHaveLength(1);expect((await db.query('SELECT * FROM "Notification"')).rows).toEqual([]);
 });
 it('two concurrent restores create only one replacement and one restore outcome',async()=>{
  const e=await historic(),p=await restore().preview('org',1,{eventId:e.id,side:'after'}),input={eventId:e.id,side:'after',expectedVersion:p.expectedVersion,reason:'Correct'};const results=await Promise.allSettled([restore().restore('org',1,input),restore().restore('org2',1,input)]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await live()).length).toBe(2);expect((await events()).filter(x=>x.action==='ALLOCATION_RESTORED')).toHaveLength(1);
 });
 it('rejects missing, mismatched and invalid historical targets without writing',async()=>{
  const e=await historic();await expect(restore().preview('org',999,{eventId:e.id,side:'after'})).rejects.toMatchObject({status:404});await expect(restore().preview('org',1,{eventId:999,side:'after'})).rejects.toMatchObject({status:404});await expect(restore().preview('org',1,{eventId:e.id,side:'before'})).rejects.toMatchObject({status:409});await expect(restore().preview('org',1,{eventId:e.id,side:'raw'})).rejects.toMatchObject({status:400});await expect(restore().restore('org',1,{eventId:e.id,side:'after',expectedVersion:2,reason:''})).rejects.toMatchObject({status:400});
 });
 it('attributes swap transitions and both allocation changes to their actual actors',async()=>{
  const d=await accept();await swaps.change('org',d.swap.id,{action:'approve',version:2,note:'Cover approved'});const audit=await events();expect(audit.filter(e=>e.action.startsWith('SWAP_')).map(e=>[e.action,e.actorId])).toEqual([['SWAP_REQUESTED',3],['SWAP_ACCEPTED',4],['SWAP_APPROVED',1]]);expect(audit.filter(e=>e.action.startsWith('ALLOCATION_SWAP_'))).toHaveLength(2);expect(audit.find(e=>e.action==='SWAP_APPROVED')?.reason).toBe('Cover approved');
 });
 it('replays an uncertain sick-note submit and decision without duplicate audit or notifications',async()=>{
  const sick=createStudentSickNoteService(store,()=>now),b=await bookings.create('student',book()),input={bookingVersion:1,reason:'Private illness',requestKey:'submit-retry'};const n=await sick.submit('student',b.booking.id,input);await sick.submit('student',b.booking.id,input);await expect(sick.submit('student',b.booking.id,{...input,reason:'Changed'})).rejects.toMatchObject({status:409});const decision={version:1,bookingVersion:2,decision:'APPROVED',reviewNote:'Private review',requestKey:'review-retry'};await sick.decide('org',n.id,decision);await sick.decide('org',n.id,decision);await expect(sick.decide('org',n.id,{...decision,decision:'REJECTED'})).rejects.toMatchObject({status:409});
  expect((await events()).filter(x=>x.action==='SICK_NOTE_APPROVED')).toHaveLength(1);expect(JSON.stringify(await events())).not.toMatch(/Private illness|Private review|requestKey/);expect((await db.query(`SELECT * FROM "Notification" WHERE "type"='STUDENT_SICK_DECIDED'`)).rows).toHaveLength(1);await expect(sick.submit('student',b.booking.id,{...input,requestKey:'x'})).rejects.toMatchObject({status:400});
 });
});
