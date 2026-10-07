import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { createMutualAvailabilityService,readBookingBusy } from './mutual-availability.js';
import { createScenarioService } from './scenario-service.js';
import { type PlanningStore, inPlanningTransaction, positiveId, instant, exactFields } from './planning-store.js';
import type { QueryClient } from './allocation-queries.js';

let db:PGlite,store:PlanningStore,service:ReturnType<typeof createScenarioService>;
const org='test|org',second='test|org2';
const create=()=>service.create(org,{name:'Alternative staffing',startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-09T00:00:00Z'});
const edit=(id:number,version:number,extra:Record<string,unknown>)=>service.change(org,id,{version,...extra});
const item=(tutorId=4)=>({tutorId,courseId:1,startsAt:'2030-09-02T11:00:00Z',endsAt:'2030-09-02T12:00:00Z',allocatedHours:1,minimumMark:50});
const rows=async()=> (await db.query('SELECT * FROM "Allocation" ORDER BY "id"')).rows;
beforeAll(async()=>{
 db=new PGlite({parsers:{1114:value=>new Date(value.replace(' ','T')+'Z')}});const dir=new URL('../../prisma/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).sort())if(name!=='migration_lock.toml')await db.exec(await readFile(new URL(name+'/migration.sql',dir),'utf8'));
 const adapter=(queryable:Pick<PGlite,'query'>):QueryClient=>({async query<Row>(sql:string,params:unknown[]=[]){return {rows:(await queryable.query(sql,params)).rows as Row[]};}});
 store={...adapter(db),transaction:work=>db.transaction(tx=>work(adapter(tx)))};
 service=createScenarioService(store,()=>new Date('2030-09-01T00:00:00Z'));
});
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec(`TRUNCATE "Profile","Course","AcademicTerm" RESTART IDENTITY CASCADE;
 INSERT INTO "Profile" ("auth0Id","email","fullName","role") VALUES ('test|org','org@test.example','Organiser One','ORGANISER'),('test|org2','org2@test.example','Organiser Two','ORGANISER'),('test|tutor','tutor@test.example','Tutor One','TUTOR'),('test|tutor2','tutor2@test.example','Tutor Two','TUTOR'),('test|low','low@test.example','Low Mark','TUTOR'),('test|student','student@test.example','Student','STUDENT');
 INSERT INTO "Course" ("code","name","hourlyRate","budget") VALUES ('COMS','Computer Science',100,1000);
 INSERT INTO "TutorMark" ("tutorId","courseId","mark") VALUES (3,1,80),(4,1,75),(5,1,30);
 INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (3,20),(4,20),(5,20);
 INSERT INTO "AcademicTerm" ("name","startsOn","endsOn","published","updatedAt") VALUES ('Term 3','2030-09-01','2030-09-30',true,CURRENT_TIMESTAMP);
 INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours") VALUES (3,1,'2030-09-02 08:00','2030-09-02 10:00',2);
 UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=1,"reviewedAt"=CURRENT_TIMESTAMP;
 INSERT INTO "StaffingRequirement" ("courseId","startsAt","endsAt","tutorsNeeded","createdById","updatedAt") VALUES (1,'2030-09-02 08:00','2030-09-02 10:00',2,1,CURRENT_TIMESTAMP);`);
});
describe('scenario lifecycle and independent drafts',()=>{
 it('copies live and compares workload, shortage, budget and assignments without writing live',async()=>{
  const before=await rows(),draft=await create();expect(draft.items).toHaveLength(1);
  const original=draft.items[0]!;
  await edit(draft.scenario.id,1,{action:'save-item',item:{...item(4),id:original.id,startsAt:'2030-09-02T08:00:00Z',endsAt:'2030-09-02T10:00:00Z'}});
  const diff=await service.compare(org,draft.scenario.id);
  expect(diff.diff.changed).toHaveLength(1);expect(diff.liveMetrics).toMatchObject({hours:2,shortageHours:2,projectedCost:200});expect(diff.draftMetrics).toMatchObject({hours:1,shortageHours:3,projectedCost:100});
  expect(diff.draftMetrics.courses[0]).toMatchObject({budgetRemaining:900});expect(diff.draftMetrics.workload[0]).toMatchObject({tutorId:4,hours:1});
  expect(await rows()).toEqual(before);expect(await service.list(org)).toHaveLength(1);
 });
 it('locks block changes and removal until an explicit versioned unlock',async()=>{
  const d=await create(),id=d.scenario.id,itemId=d.items[0]!.id;
  await edit(id,1,{action:'lock',itemId,locked:true});
  await expect(edit(id,2,{action:'remove-item',itemId})).rejects.toMatchObject({code:'ITEM_LOCKED'});
  await expect(edit(id,2,{action:'save-item',item:{...item(),id:itemId}})).rejects.toMatchObject({code:'ITEM_LOCKED'});
  await edit(id,2,{action:'lock',itemId,locked:false});await edit(id,3,{action:'remove-item',itemId});
  expect((await service.get(org,id)).items).toEqual([]);expect((await service.compare(org,id)).diff.removed).toHaveLength(1);
 });
 it('supports notes, rename, duplicate, archive, reopen and delete without touching live',async()=>{
  const before=await rows(),d=await create(),id=d.scenario.id;
  await edit(id,1,{action:'metadata',name:'Balanced',notes:'Keep morning cover'});
  const copy=await edit(id,2,{action:'duplicate',name:'Second option'});
  expect(copy).toHaveProperty('scenario.name','Second option');
  await edit(id,2,{action:'archive'});expect(await service.list(org,'ARCHIVED')).toHaveLength(1);
  await expect(edit(id,3,{action:'metadata',name:'No',notes:''})).rejects.toMatchObject({code:'SCENARIO_READ_ONLY'});
  await edit(id,3,{action:'reopen'});expect((await service.get(org,id)).scenario.status).toBe('DRAFT');
  await edit(id,4,{action:'delete'});await expect(service.get(org,id)).rejects.toMatchObject({status:404});expect(await rows()).toEqual(before);
 });
 it('two organiser sessions cannot overwrite the same version',async()=>{
  const d=await create(),id=d.scenario.id;
  const one=await service.get(org,id),two=await service.get(second,id);
  await service.change(org,id,{action:'metadata',version:one.scenario.version,name:'First editor',notes:'Saved'});
  await expect(service.change(second,id,{action:'metadata',version:two.scenario.version,name:'Stale editor',notes:'Lost'})).rejects.toMatchObject({status:409,code:'SCENARIO_STALE'});
  const current=await service.get(second,id);expect(current.scenario.name).toBe('First editor');
  await service.change(second,id,{action:'metadata',version:current.scenario.version,name:'Reviewed version',notes:'Merged intentionally'});
  expect((await service.get(org,id)).scenario.updatedByName).toBe('Organiser Two');
 });
 it('presence expires and never authorizes a wrong role',async()=>{
  const d=await create();await service.presence(org,d.scenario.id);expect(await service.presence(second,d.scenario.id)).toHaveLength(2);
  await db.exec(`UPDATE "ScenarioPresence" SET "lastSeenAt"=CURRENT_TIMESTAMP-interval '2 minutes' WHERE "profileId"=1`);
  const people=await service.presence(second,d.scenario.id);expect(people).toHaveLength(1);
  await expect(service.presence('test|student',d.scenario.id)).rejects.toMatchObject({status:403});
  await expect(service.get('test|tutor',d.scenario.id)).rejects.toMatchObject({status:403});
  await expect(service.create('test|student',{name:'x',startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-03T00:00:00Z'})).rejects.toMatchObject({status:403});
 });
});
describe('atomic scenario publishing',()=>{
 it('publishes a changed assignment and a new assignment, with notifications, and is read-only afterwards',async()=>{
  const d=await create(),id=d.scenario.id;
  await edit(id,1,{action:'save-item',item:{...item(4),id:d.items[0]!.id,startsAt:'2030-09-02T08:00:00Z',endsAt:'2030-09-02T10:00:00Z',allocatedHours:2}});
  await edit(id,2,{action:'save-item',item:item(3)});
  const comparison=await service.compare(org,id);
  expect(comparison.diff.added).toHaveLength(1);
  await edit(id,3,{action:'publish',liveRevision:comparison.liveRevision});
  const allocations=await db.query<{status:string}>('SELECT "status" FROM "Allocation" ORDER BY "id"');expect(allocations.rows.map(x=>x.status)).toEqual(['CANCELLED','CONFIRMED','CONFIRMED']);
  expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(3);
  const audit=(await db.query<{action:string;actorId:number}>('SELECT * FROM "AuditEvent" ORDER BY "id"')).rows;expect(audit.some(e=>e.action==='SCENARIO_PUBLISH'&&e.actorId===1)).toBe(true);expect(audit.filter(e=>e.action==='ALLOCATION_SCENARIO_CREATED')).toHaveLength(2);
  expect((await service.get(org,id)).scenario.status).toBe('PUBLISHED');expect(await service.list(org,'PUBLISHED')).toHaveLength(1);
  await expect(edit(id,4,{action:'archive'})).rejects.toMatchObject({code:'SCENARIO_READ_ONLY'});
 });
 it('rejects a live change after Compare and rolls back all writes when a later item fails',async()=>{
  const d=await create(),id=d.scenario.id;
  const comparison=await service.compare(org,id);
  await db.exec(`UPDATE "Allocation" SET "allocatedHours"=1.5,"updatedAt"=CURRENT_TIMESTAMP`);
  await expect(edit(id,1,{action:'publish',liveRevision:comparison.liveRevision})).rejects.toMatchObject({code:'LIVE_PLAN_STALE'});
  expect((await service.compare(org,id)).liveChanged).toBe(true);
  await edit(id,1,{action:'save-item',item:item(4)});
  await edit(id,2,{action:'save-item',item:{...item(5),startsAt:'2030-09-02T13:00:00Z',endsAt:'2030-09-02T14:00:00Z'}});
  const before=await rows(),auditBefore=(await db.query('SELECT * FROM "AuditEvent" ORDER BY "id"')).rows,ready=await service.compare(org,id);
  await expect(edit(id,3,{action:'publish',liveRevision:ready.liveRevision})).rejects.toMatchObject({code:'SCENARIO_RULE_FAILED'});
  expect((await db.query('SELECT * FROM "AuditEvent" ORDER BY "id"')).rows).toEqual(auditBefore);
  expect(await rows()).toEqual(before);expect((await db.query('SELECT * FROM "Notification"')).rows).toHaveLength(0);expect((await service.get(org,id)).scenario.version).toBe(3);
 });
 it.each(['clash','capacity'])('rechecks %s changes after draft creation',async mode=>{
  const d=await create(),id=d.scenario.id;await edit(id,1,{action:'save-item',item:item(4)});
  if(mode==='clash')await db.exec(`INSERT INTO "TimeSlot" ("tutorId","type","startsAt","endsAt") VALUES (4,'BUSY','2030-09-02 11:30','2030-09-02 12:30')`);
  else await db.exec(`UPDATE "TutorHourLimit" SET "weeklyHours"=0.5 WHERE "tutorId"=4`);
  const comparison=await service.compare(org,id);await expect(edit(id,2,{action:'publish',liveRevision:comparison.liveRevision})).rejects.toMatchObject({code:'SCENARIO_RULE_FAILED'});
 });
 it('checks new assignments against one another, and preserves existing history',async()=>{
  const d=await create(),id=d.scenario.id;
  await edit(id,1,{action:'save-item',item:item(4)});await edit(id,2,{action:'save-item',item:{...item(4),startsAt:'2030-09-02T11:30:00Z',endsAt:'2030-09-02T12:30:00Z'}});
  const comparison=await service.compare(org,id);await expect(edit(id,3,{action:'publish',liveRevision:comparison.liveRevision})).rejects.toMatchObject({code:'SCENARIO_RULE_FAILED'});
  await db.exec(`INSERT INTO "Excuse" ("tutorId","allocationId","reason") VALUES (3,1,'Private reason')`);
  await edit(id,3,{action:'remove-item',itemId:d.items[0]!.id});const fresh=await service.compare(org,id);
  await expect(edit(id,4,{action:'publish',liveRevision:fresh.liveRevision})).rejects.toMatchObject({code:'ALLOCATION_HISTORY_PROTECTED'});
 });
 it('publishes a removal and does not change unrelated allocations outside the scope',async()=>{
  const d=await create(),id=d.scenario.id;await edit(id,1,{action:'remove-item',itemId:d.items[0]!.id});
  await db.exec(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours") VALUES (4,1,'2030-09-20 08:00','2030-09-20 09:00',1);UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=1,"reviewedAt"=CURRENT_TIMESTAMP WHERE "id"=2`);
  const ready=await service.compare(org,id);await edit(id,2,{action:'publish',liveRevision:ready.liveRevision});
  expect((await db.query<{status:string}>('SELECT "status" FROM "Allocation" WHERE "id"=2')).rows[0]!.status).toBe('CONFIRMED');
 });
 it('reports missing rates as unknown rather than zero',async()=>{
  await db.exec('UPDATE "Course" SET "hourlyRate"=NULL,"budget"=NULL');const d=await create();const comparison=await service.compare(org,d.scenario.id);expect(comparison.liveMetrics.projectedCost).toBeNull();expect(comparison.liveMetrics.courses[0]!.budgetRemaining).toBeNull();
 });
});
describe('planning validation',()=>{
 it.each([0,-1,1.5,2147483648,'1',null])('rejects invalid identifiers %j',value=>expect(()=>positiveId(value)).toThrow());
 it.each(['2020-01-01','bad','2030-09-01T12:00:00'])('requires explicit time zone %s',value=>expect(()=>instant(value)).toThrow());
 it('rejects unknown payload fields, missing versions, missing assignments and invalid windows',async()=>{
  expect(()=>exactFields([],[])).toThrow();await expect(service.create(org,{name:'x',startsAt:'2030-09-02T00:00:00Z',endsAt:'2031-01-01T00:00:00Z'})).rejects.toMatchObject({status:400});
  const d=await create();await expect(service.change(org,d.scenario.id,{action:'archive'})).rejects.toMatchObject({status:400});
  await expect(edit(d.scenario.id,1,{action:'save-item',item:{...item(),locked:true}})).rejects.toMatchObject({status:400});
  await expect(edit(d.scenario.id,1,{action:'remove-item',itemId:999})).rejects.toMatchObject({status:404});
  await expect(edit(d.scenario.id,1,{action:'save-item',item:{...item(),allocatedHours:5}})).rejects.toMatchObject({status:400});
  await expect(edit(d.scenario.id,1,{action:'save-item',item:item(6)})).rejects.toMatchObject({status:404});
  await expect(edit(d.scenario.id,1,{action:'publish',liveRevision:'unknown'})).rejects.toMatchObject({status:400});
  await expect(service.list(org,'ALL')).rejects.toMatchObject({status:400});
 });
 it('maps database serialization failures to safe conflict responses',async()=>{
  const broken:PlanningStore={...store,transaction:async()=>{throw {code:'40001'};}};
  await expect(inPlanningTransaction(broken,async()=>null)).rejects.toMatchObject({status:409,code:'PLANNING_CONFLICT'});
  const unexpected=new Error('internal');broken.transaction=async()=>{throw unexpected;};await expect(inPlanningTransaction(broken,async()=>null)).rejects.toBe(unexpected);
 });
});

describe('student availability database privacy and integration',()=>{
 const searchInput={courseId:1,tutorId:3,termId:1,startsAt:'2030-09-02T06:00:00Z',endsAt:'2030-09-02T12:00:00Z',durationMinutes:60};
 const availability=()=>createMutualAvailabilityService(store,()=>new Date('2030-09-01T00:00:00Z'));
 it('exposes only safe eligible choices and derives the student from authentication',async()=>{
  const result=await availability().discover('test|student');expect(result.choices).toHaveLength(2);
  expect(Object.keys(result.choices[0]!).sort()).toEqual(['courseCode','courseId','courseName','tutorId','tutorName']);
  await expect(availability().discover(org)).rejects.toMatchObject({status:403});
  await expect(availability().search('test|student',{...searchInput,studentId:3})).rejects.toMatchObject({status:400});
  await expect(availability().search('test|tutor',searchInput)).rejects.toMatchObject({status:403});
 });
 it('combines own busy schedule, tutor recurrence and confirmed allocations without exposing labels',async()=>{
  await db.exec(`INSERT INTO "TimeSlot" ("tutorId","type","startsAt","endsAt","label","recurrence") VALUES (6,'BUSY','2030-09-02 06:00','2030-09-02 07:00','PRIVATE student therapy',NULL),(3,'BUSY','2030-08-26 10:00','2030-08-26 11:00','PRIVATE tutor event','WEEKLY');`);
  const result=await availability().search('test|student',searchInput);
  expect(result.slots.map(x=>x.startsAt)).toEqual(['2030-09-02T07:00:00.000Z','2030-09-02T11:00:00.000Z']);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|therapy|email|auth0|mark/);
 });
 it('returns no slots outside the term, during teaching breaks, or for too-long sessions',async()=>{
  await db.exec(`UPDATE "AcademicTerm" SET "teachingBreaks"='[{"startsOn":"2030-09-02","endsOn":"2030-09-02"}]'::jsonb`);
  expect((await availability().search('test|student',searchInput)).slots).toEqual([]);
  expect((await availability().search('test|student',{...searchInput,startsAt:'2030-10-01T06:00:00Z',endsAt:'2030-10-01T12:00:00Z'})).slots).toEqual([]);
  await db.exec(`UPDATE "AcademicTerm" SET "teachingBreaks"='[]'::jsonb`);
  expect((await availability().search('test|student',{...searchInput,durationMinutes:180})).slots).toEqual([]);
 });
 it('uses selected daily hours, caps results, and handles stale choices',async()=>{
  const result=await availability().search('test|student',{...searchInput,endsAt:'2030-09-10T12:00:00Z',durationMinutes:15,dailyStartHour:9,dailyEndHour:17});
  expect(result.slots).toHaveLength(80);expect(result.truncated).toBe(true);expect(result.slots[0]!.startsAt).toBe('2030-09-02T07:00:00.000Z');
  await expect(availability().search('test|student',{...searchInput,tutorId:5})).rejects.toMatchObject({status:404});
  await db.exec('UPDATE "AcademicTerm" SET "published"=false');await expect(availability().search('test|student',searchInput)).rejects.toMatchObject({status:404});
 });
 it.each([{durationMinutes:14},{durationMinutes:181},{durationMinutes:'60'},{dailyStartHour:18,dailyEndHour:8},{dailyStartHour:-1},{dailyEndHour:25},{endsAt:'2030-10-01T00:00:00Z'},{startsAt:'2031-04-01T00:00:00Z',endsAt:'2031-04-02T00:00:00Z'},{startsAt:'2030-08-01T00:00:00Z',endsAt:'2030-08-02T00:00:00Z'}])('rejects invalid or unbounded searches %j',async extra=>{
  await expect(availability().search('test|student',{...searchInput,...extra})).rejects.toMatchObject({status:400});
 });
 it('reads existing bookings for either party, ignores cancelled bookings, and rechecks them at publish',async()=>{
  await db.exec(`INSERT INTO "Profile" ("id","auth0Id","email","fullName","role") VALUES (99,'test|other-student','other@test.example','Other Student','STUDENT');`);
  try {
   await db.exec(`INSERT INTO "TutoringBooking" ("studentId","tutorId","courseId","termId","startsAt","endsAt","status","occurrenceStatus","requestKey","requestHash") VALUES (6,4,1,1,'2030-09-02 07:00','2030-09-02 08:00','CONFIRMED','SCHEDULED','m2-fixture-1','hash'),(99,3,1,1,'2030-09-02 11:00','2030-09-02 12:00','CONFIRMED','SCHEDULED','m2-fixture-2','hash'),(6,3,1,1,'2030-09-02 06:00','2030-09-02 07:00','CANCELLED','SCHEDULED','m2-fixture-3','hash'),(6,3,1,1,'2030-09-02 10:00','2030-09-02 11:00','CONFIRMED','EXCUSED','m2-fixture-4','hash');`);
   expect((await availability().search('test|student',searchInput)).slots.map(x=>x.startsAt)).toEqual(['2030-09-02T06:00:00.000Z','2030-09-02T10:00:00.000Z']);
   expect(await readBookingBusy(store,[100],{startsAt:new Date(searchInput.startsAt),endsAt:new Date(searchInput.endsAt)})).toEqual([]);
   const draft=await create();await edit(draft.scenario.id,1,{action:'save-item',item:item(3)});const comparison=await service.compare(org,draft.scenario.id);
   await expect(edit(draft.scenario.id,2,{action:'publish',liveRevision:comparison.liveRevision})).rejects.toMatchObject({code:'SCENARIO_RULE_FAILED'});
  } finally {await db.exec('TRUNCATE "TutoringBooking" CASCADE');}
 });
 it('removes excused sessions from availability and shortage cover without erasing history',async()=>{
  const draft=await create(),reviewed=await service.compare(org,draft.scenario.id);
  await db.exec(`INSERT INTO "Excuse" ("tutorId","allocationId","reason","createdAt") VALUES (3,1,'Private illness','2030-09-01 08:00');UPDATE "Excuse" SET "status"='APPROVED',"reviewedById"=1,"reviewedAt"='2030-09-01 09:00';`);
  const fresh=await service.compare(org,draft.scenario.id);expect(fresh.liveMetrics.shortageHours).toBe(4);expect(fresh.draftMetrics.shortageHours).toBe(4);
  expect(fresh.liveRevision).not.toBe(reviewed.liveRevision);
  const result=await availability().search('test|student',searchInput);expect(result.slots.some(x=>x.startsAt==='2030-09-02T08:00:00.000Z')).toBe(true);expect(JSON.stringify(result)).not.toContain('illness');
  expect((await rows())).toHaveLength(1);
 });
 it('counts carry-in allocations in shortage coverage while preserving the start-based editing scope',async()=>{
  await db.exec(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours") VALUES (4,1,'2030-09-02 07:00','2030-09-02 09:00',2);UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=1,"reviewedAt"=CURRENT_TIMESTAMP WHERE "id"=2`);
  const draft=await service.create(org,{name:"Carry-in",startsAt:"2030-09-02T08:00:00Z",endsAt:"2030-09-09T00:00:00Z"}),comparison=await service.compare(org,draft.scenario.id);
  expect(draft.items).toHaveLength(1);expect(comparison.liveMetrics.shortageHours).toBe(1);expect(comparison.draftMetrics.shortageHours).toBe(1);
 });
});
