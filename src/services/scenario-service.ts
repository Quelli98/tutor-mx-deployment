import {auditAllocation,writeAudit} from './audit-service.js';
import { createHash } from 'node:crypto';
import { findAllocationCandidates, toNaiveUtcText, type QueryClient } from './allocation-queries.js';
import { requiredHoursFor } from './staffing-requirement-service.js';
import { readBookingBusy } from './mutual-availability.js';
import { exactFields, inPlanningTransaction, instant, invalid, positiveId, requireProfile, type PlanningStore } from './planning-store.js';
import { createRouteError } from '../http/errors.js';

interface ScenarioRow { id: number; name: string; notes: string; startsAt: Date; endsAt: Date; status: string; version: number; baseLiveRevision: string; updatedAt: Date; updatedByName: string | null }
export interface PlanItem { id: number; sourceAllocationId: number | null; tutorId: number; tutorName: string; courseId: number; courseCode: string; startsAt: Date; endsAt: Date; allocatedHours: number; minimumMark: number; locked: boolean; updatedAt?: Date; protected?: boolean; excused?: boolean }
const normaliseItem = (x: PlanItem): PlanItem => ({ ...x, startsAt: new Date(x.startsAt), endsAt: new Date(x.endsAt), allocatedHours: Number(x.allocatedHours), minimumMark: Number(x.minimumMark) });
const signature = (x: PlanItem) => JSON.stringify([x.tutorId,x.courseId,new Date(x.startsAt).toISOString(),new Date(x.endsAt).toISOString(),Number(x.allocatedHours),Number(x.minimumMark)]);
const revision = (items: PlanItem[]) => createHash('sha256').update(JSON.stringify(items.map(x => [x.id,signature(x),x.updatedAt,x.protected,x.excused]))).digest('hex');
const notFound = () => createRouteError(404, 'SCENARIO_NOT_FOUND', 'This scenario or assignment is no longer available.');
const conflict = () => createRouteError(409, 'SCENARIO_STALE', 'Someone changed this scenario. Refresh, compare your changes, then retry.');
const round = (n: number) => Math.round(n*100)/100;
function textInput(value: unknown, max: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalid(`Enter ${allowEmpty ? 'up to' : '1–'}${max} characters.`);
  return value.trim();
}
async function readScenario(client: QueryClient, id: number, lock = false) {
  const { rows } = await client.query<ScenarioRow>(`SELECT s.*,p."fullName" AS "updatedByName" FROM "Scenario" s LEFT JOIN "Profile" p ON p."id"=s."updatedById" WHERE s."id"=$1${lock ? ' FOR UPDATE OF s' : ''}`, [id]);
  if (!rows[0]) throw notFound();
  return { ...rows[0], startsAt: new Date(rows[0].startsAt), endsAt: new Date(rows[0].endsAt), updatedAt: new Date(rows[0].updatedAt) };
}
async function readItems(client: QueryClient, id: number) {
  const { rows } = await client.query<PlanItem>(`SELECT i.*,p."fullName" AS "tutorName",c."code" AS "courseCode" FROM "ScenarioItem" i JOIN "Profile" p ON p."id"=i."tutorId" JOIN "Course" c ON c."id"=i."courseId" WHERE i."scenarioId"=$1 ORDER BY i."startsAt",i."id" LIMIT 201`, [id]);
  if (rows.length > 200) throw createRouteError(422, 'SCENARIO_TOO_LARGE', 'Use a smaller planning window (maximum 200 assignments).');
  return rows.map(normaliseItem);
}
async function liveItems(client: QueryClient, scenario: Pick<ScenarioRow,'startsAt'|'endsAt'>) {
  const { rows } = await client.query<PlanItem>(`SELECT a.*,a."id" AS "sourceAllocationId",false AS "locked",p."fullName" AS "tutorName",c."code" AS "courseCode",
    (EXISTS(SELECT 1 FROM "WorkLog" w WHERE w."allocationId"=a."id") OR EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id") OR EXISTS(SELECT 1 FROM "OverflowWork" o WHERE o."sourceAllocationId"=a."id")) AS protected,
    EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED') AS excused
    FROM "Allocation" a JOIN "Profile" p ON p."id"=a."tutorId" JOIN "Course" c ON c."id"=a."courseId"
    WHERE a."status"='CONFIRMED' AND a."startsAt">=$1::timestamp AND a."startsAt"<$2::timestamp ORDER BY a."startsAt",a."id" LIMIT 201`, [toNaiveUtcText(scenario.startsAt),toNaiveUtcText(scenario.endsAt)]);
  if (rows.length > 200) throw createRouteError(422, 'SCENARIO_TOO_LARGE', 'Use a smaller planning window (maximum 200 live assignments).');
  return rows.map(normaliseItem);
}
async function copyItems(client: QueryClient, id: number, items: PlanItem[]) {
  for (const item of items) await client.query(`INSERT INTO "ScenarioItem" ("scenarioId","sourceAllocationId","tutorId","courseId","startsAt","endsAt","allocatedHours","minimumMark","locked") VALUES ($1,$2,$3,$4,$5::timestamp,$6::timestamp,$7,$8,$9)`, [id,item.sourceAllocationId,item.tutorId,item.courseId,toNaiveUtcText(item.startsAt),toNaiveUtcText(item.endsAt),item.allocatedHours,item.minimumMark,item.locked]);
}
async function capacity(client: QueryClient) {
  const { rows } = await client.query<{ count: number }>(`SELECT count(*)::integer AS count FROM "Scenario" WHERE "status"='DRAFT'`);
  if (rows[0]!.count >= 100) throw createRouteError(422, 'SCENARIO_LIBRARY_FULL', 'Archive an existing draft before creating another (maximum 100 drafts).');
}
export function scenarioDiff(live: PlanItem[], draft: PlanItem[]) {
  const added = draft.filter(x => !x.sourceAllocationId || !live.some(l => l.id === x.sourceAllocationId));
  const removed = live.filter(x => !draft.some(d => d.sourceAllocationId === x.id));
  const changed = draft.flatMap(after => { const before = live.find(x => x.id === after.sourceAllocationId); return before && signature(before) !== signature(after) ? [{ before, after }] : []; });
  return { added, removed, changed };
}
async function compare(client: QueryClient, scenario: ScenarioRow) {
  const live = await liveItems(client, scenario), draft = await readItems(client, scenario.id);
  const { rows: courses } = await client.query<{ id: number; code: string; hourlyRate: number | null; budget: number | null }>('SELECT "id","code","hourlyRate"::float8 AS "hourlyRate","budget"::float8 AS budget FROM "Course" ORDER BY "id" LIMIT 5001');
  const { rows: requirements } = await client.query<{ courseId: number; startsAt: Date; endsAt: Date; tutorsNeeded: number }>(`SELECT "courseId","startsAt","endsAt","tutorsNeeded" FROM "StaffingRequirement" WHERE "status"='OPEN' AND "startsAt">=$1::timestamp AND "endsAt"<=$2::timestamp LIMIT 1001`, [toNaiveUtcText(scenario.startsAt),toNaiveUtcText(scenario.endsAt)]);
  if (courses.length > 5000 || requirements.length > 1000) throw createRouteError(422,'SCENARIO_TOO_LARGE','Choose a smaller planning context.');
  const {rows: carryIn} = await client.query<PlanItem>(`SELECT a.* FROM "Allocation" a WHERE a."status"='CONFIRMED' AND a."startsAt"<$1::timestamp AND a."endsAt">$1::timestamp AND NOT EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED') LIMIT 201`,[toNaiveUtcText(scenario.startsAt)]);
  if(carryIn.length>200) throw createRouteError(422,'SCENARIO_TOO_LARGE','Choose a smaller planning context.');
  const metrics = (items: PlanItem[]) => {
    const coverage = [...items.filter(i=>!live.some(l=>l.id===i.sourceAllocationId && l.excused && signature(l)===signature(i))),...carryIn.map(normaliseItem)];
    const coursesUsed = courses.filter(c => items.some(i => i.courseId === c.id));
    const costs = coursesUsed.map(c => ({ courseId:c.id, courseCode:c.code, hours:round(items.filter(i => i.courseId===c.id).reduce((sum,i)=>sum+i.allocatedHours,0)), hourlyRate:c.hourlyRate, budget:c.budget }));
    const workload = [...new Set(items.map(x=>x.tutorId))].map(tutorId=>({tutorId,tutorName:items.find(x=>x.tutorId===tutorId)!.tutorName,hours:round(items.filter(x=>x.tutorId===tutorId).reduce((sum,x)=>sum+x.allocatedHours,0))}));
    const shortageHours = requirements.reduce((sum,r)=> {
      const start=+new Date(r.startsAt), end=+new Date(r.endsAt);
      const assigned=coverage.filter(i=>i.courseId===r.courseId).reduce((total,i)=>{
        const overlap=Math.max(0,Math.min(+i.endsAt,end)-Math.max(+i.startsAt,start));
        return total + i.allocatedHours * overlap/(+i.endsAt-+i.startsAt);
      },0);
      return sum+Math.max(0,requiredHoursFor(new Date(r.startsAt),new Date(r.endsAt),r.tutorsNeeded)-assigned);
    },0);
    return { hours:round(items.reduce((sum,i)=>sum+i.allocatedHours,0)),shortageHours:round(shortageHours),projectedCost:costs.some(c=>c.hourlyRate===null)?null:round(costs.reduce((sum,c)=>sum+c.hours*c.hourlyRate!,0)),workload,courses:costs.map(c=>({...c,projectedCost:c.hourlyRate===null?null:round(c.hours*c.hourlyRate),budgetRemaining:c.hourlyRate===null||c.budget===null?null:round(c.budget-c.hours*c.hourlyRate)})) };
  };
  return { version:scenario.version,liveRevision:revision(live),liveChanged:revision(live)!==scenario.baseLiveRevision,live,draft,diff:scenarioDiff(live,draft),liveMetrics:metrics(live),draftMetrics:metrics(draft) };
}
async function notifyAllocation(client: QueryClient, item: PlanItem, allocationId: number, scenario: ScenarioRow, changed: boolean) {
  await client.query(`INSERT INTO "Notification" ("recipientProfileId","type","title","body","linkPath","targetType","targetId","eventKey") VALUES ($1,$2::"NotificationType",$3,$4,'/tutor','allocation',$5,$6) ON CONFLICT ("eventKey") DO NOTHING`, [item.tutorId,changed?'ALLOCATION_CHANGED':'ALLOCATION_CREATED',changed?'Allocation changed':'Allocation confirmed',`An organiser published scenario ${scenario.name}. Open your workspace for the current allocation.`,allocationId,`scenario:${scenario.id}:${scenario.version}:${changed?'removed':'added'}:${allocationId}`]);
}
async function publish(client: QueryClient, scenario: ScenarioRow, subjectId: number, input: Record<string,unknown>, now: Date) {
  if (typeof input.liveRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.liveRevision)) invalid('Compare with Live before publishing.');
  const live=await liveItems(client,scenario),draft=await readItems(client,scenario.id);
  if (revision(live)!==input.liveRevision) throw createRouteError(409,'LIVE_PLAN_STALE','Live assignments changed since your comparison. Compare again before publishing.');
  const diff=scenarioDiff(live,draft);
  const replaced=[...diff.removed,...diff.changed.map(x=>x.before)];
  if (replaced.some(x=>x.protected || x.startsAt<=now) || diff.added.some(x=>x.startsAt<=now) || diff.changed.some(x=>x.after.startsAt<=now)) throw createRouteError(409,'ALLOCATION_HISTORY_PROTECTED','Past assignments and assignments with work logs, excuses or overflow history cannot be changed by a scenario.');
  // Cancel old identities, never delete payroll/attendance history. A later failure rolls all of this back.
  for (const item of replaced) {
    const before=(await client.query('SELECT *,"allocatedHours"::float8 AS "allocatedHours" FROM "Allocation" WHERE "id"=$1',[item.id])).rows[0];
    await client.query(`UPDATE "Allocation" SET "status"='CANCELLED',"updatedAt"=CURRENT_TIMESTAMP,"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[item.id,subjectId]);
    await auditAllocation(client,subjectId,item.id,before,'ALLOCATION_SCENARIO_CANCELLED');
    await notifyAllocation(client,item,item.id,scenario,true);
  }
  for (const item of draft) {
    const unchanged=live.find(x=>x.id===item.sourceAllocationId && signature(x)===signature(item));
    if (unchanged && item.startsAt<=now) continue;
    const candidates=await findAllocationCandidates(client,{courseId:item.courseId,startsAt:item.startsAt,endsAt:item.endsAt,requestedHours:item.allocatedHours,minimumMark:item.minimumMark,...(unchanged?{excludeAllocationId:unchanged.id}:{})});
    const candidate=candidates.find(x=>x.tutorId===item.tutorId);
    if (!candidate?.isEligible) throw createRouteError(409,'SCENARIO_RULE_FAILED',`${item.tutorName} cannot be published for ${item.courseCode}: ${candidate?.reasonCodes.join(', ') || 'tutor/course eligibility changed'}. Refresh and adjust the draft.`);
    if ((await readBookingBusy(client,[item.tutorId],item)).length) throw createRouteError(409,'SCENARIO_RULE_FAILED','A tutoring booking now overlaps a draft assignment. Refresh and adjust the draft.');
    if (unchanged) continue;
    const {rows}=await client.query<{id:number}>(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours","status","updatedAt","minimumMark") VALUES ($1,$2,$3::timestamp,$4::timestamp,$5,'PROPOSED',CURRENT_TIMESTAMP,$6) RETURNING "id"`,[item.tutorId,item.courseId,toNaiveUtcText(item.startsAt),toNaiveUtcText(item.endsAt),item.allocatedHours,item.minimumMark]);
    await client.query(`UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[rows[0]!.id,subjectId]);
    await auditAllocation(client,subjectId,rows[0]!.id,{},'ALLOCATION_SCENARIO_CREATED','',item.minimumMark);
    await notifyAllocation(client,item,rows[0]!.id,scenario,false);
  }
  await client.query(`UPDATE "Scenario" SET "status"='PUBLISHED' WHERE "id"=$1`,[scenario.id]);
}
export function createScenarioService(store: PlanningStore, clock=()=>new Date()) {
  const audit=async(client:QueryClient,actorId:number,id:number,before:unknown,action:string)=>writeAudit(client,actorId,action,'scenario',id,before,{...await readScenario(client,id),items:await readItems(client,id)});
  const detail=async(client:QueryClient,id:number)=>({scenario:await readScenario(client,id),items:await readItems(client,id)});
  return {
    async list(subject:string, status:string='DRAFT') {
      await requireProfile(store,subject,'ORGANISER');
      if (!['DRAFT','ARCHIVED','PUBLISHED'].includes(status)) invalid('Choose Draft, Archived or Published.');
      const {rows}=await store.query(`SELECT s.*,p."fullName" AS "updatedByName",(SELECT count(*)::integer FROM "ScenarioItem" i WHERE i."scenarioId"=s."id") AS "itemCount" FROM "Scenario" s LEFT JOIN "Profile" p ON p."id"=s."updatedById" WHERE s."status"=$1 ORDER BY s."updatedAt" DESC,s."id" DESC LIMIT 100`,[status]);
      return rows;
    },
    async create(subject:string,raw:unknown) {
      const input=exactFields(raw,['name','notes','startsAt','endsAt']);
      const name=textInput(input.name,120),notes=textInput(input.notes??'',2000,true),startsAt=instant(input.startsAt),endsAt=instant(input.endsAt);
      if (endsAt<=startsAt || +endsAt-+startsAt>28*86400000 || startsAt<=clock()) invalid('Choose a future planning window of up to 28 days.');
      return inPlanningTransaction(store,async client=>{
        const owner=await requireProfile(client,subject,'ORGANISER');await capacity(client);
        const live=await liveItems(client,{startsAt,endsAt});
        const {rows}=await client.query<{id:number}>(`INSERT INTO "Scenario" ("name","notes","startsAt","endsAt","baseLiveRevision","createdById","updatedById") VALUES ($1,$2,$3::timestamp,$4::timestamp,$5,$6,$6) RETURNING "id"`,[name,notes,toNaiveUtcText(startsAt),toNaiveUtcText(endsAt),revision(live),owner.id]);
        await copyItems(client,rows[0]!.id,live);await audit(client,owner.id,rows[0]!.id,{},'SCENARIO_CREATED');return detail(client,rows[0]!.id);
      });
    },
    async get(subject:string,id:number) { return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');return detail(client,positiveId(id));}); },
    async compare(subject:string,id:number) { return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');return compare(client,await readScenario(client,positiveId(id)));}); },
    async presence(subject:string,id:number) {
      return inPlanningTransaction(store,async client=>{
        const owner=await requireProfile(client,subject,'ORGANISER');await readScenario(client,positiveId(id));
        await client.query(`DELETE FROM "ScenarioPresence" WHERE "lastSeenAt" < CURRENT_TIMESTAMP - interval '90 seconds'`);
        await client.query(`INSERT INTO "ScenarioPresence" ("scenarioId","profileId","lastSeenAt") VALUES ($1,$2,CURRENT_TIMESTAMP) ON CONFLICT ("scenarioId","profileId") DO UPDATE SET "lastSeenAt"=CURRENT_TIMESTAMP`,[id,owner.id]);
        return (await client.query(`SELECT p."id" AS "profileId",p."fullName",s."lastSeenAt" FROM "ScenarioPresence" s JOIN "Profile" p ON p."id"=s."profileId" WHERE s."scenarioId"=$1 AND s."lastSeenAt">=CURRENT_TIMESTAMP-interval '90 seconds' AND p."role"='ORGANISER' ORDER BY p."fullName"`,[id])).rows;
      });
    },
    async change(subject:string,id:number,raw:unknown) {
      const input=exactFields(raw,['action','version','name','notes','item','itemId','locked','liveRevision']);
      const version=positiveId(input.version),action=input.action;
      if (typeof action!=='string' || !['metadata','duplicate','archive','reopen','delete','save-item','remove-item','lock','publish'].includes(action)) invalid('Choose a supported scenario action.');
      const actionFields:Record<string,string[]>={metadata:['name','notes'],duplicate:['name'],archive:[],reopen:[],delete:[],'save-item':['item'],'remove-item':['itemId'],lock:['itemId','locked'],publish:['liveRevision']};
      exactFields(input,['action','version',...actionFields[action]!]);
      return inPlanningTransaction(store,async client=>{
        const owner=await requireProfile(client,subject,'ORGANISER');
        const scenario=await readScenario(client,positiveId(id),true);
        const before={...scenario,items:await readItems(client,id)};
        if (scenario.version!==version) throw conflict();
        if (action==='duplicate') {
          await capacity(client);const name=textInput(input.name,120);
          const {rows}=await client.query<{id:number}>(`INSERT INTO "Scenario" ("name","notes","startsAt","endsAt","baseLiveRevision","createdById","updatedById") VALUES ($1,$2,$3::timestamp,$4::timestamp,$5,$6,$6) RETURNING "id"`,[name,scenario.notes,toNaiveUtcText(scenario.startsAt),toNaiveUtcText(scenario.endsAt),scenario.baseLiveRevision,owner.id]);
          await copyItems(client,rows[0]!.id,await readItems(client,id));await audit(client,owner.id,rows[0]!.id,{},'SCENARIO_DUPLICATED');return detail(client,rows[0]!.id);
        }
        if (scenario.status==='PUBLISHED') throw createRouteError(409,'SCENARIO_READ_ONLY','Published scenarios are read-only. Duplicate to plan another version.');
        if (action==='delete') {await writeAudit(client,owner.id,'SCENARIO_DELETED','scenario',id,before,{});await client.query('DELETE FROM "Scenario" WHERE "id"=$1',[id]);return {deleted:true};}
        if (action==='reopen') {
          if(scenario.status!=='ARCHIVED') throw conflict();await capacity(client);
          await client.query(`UPDATE "Scenario" SET "status"='DRAFT' WHERE "id"=$1`,[id]);
        } else {
          if(scenario.status!=='DRAFT') throw createRouteError(409,'SCENARIO_READ_ONLY','Reopen this archived scenario before editing.');
          if(action==='metadata') await client.query('UPDATE "Scenario" SET "name"=$2,"notes"=$3 WHERE "id"=$1',[id,textInput(input.name,120),textInput(input.notes??'',2000,true)]);
          if(action==='archive') await client.query(`UPDATE "Scenario" SET "status"='ARCHIVED' WHERE "id"=$1`,[id]);
          if(action==='save-item') {
            const item=exactFields(input.item,['id','tutorId','courseId','startsAt','endsAt','allocatedHours','minimumMark']);
            const items=await readItems(client,id),itemId=item.id==null?null:positiveId(item.id),old=items.find(x=>x.id===itemId);
            if(itemId && !old) throw notFound();
            if(old?.locked) throw createRouteError(409,'ITEM_LOCKED','Unlock this assignment explicitly before changing it.');
            if(!itemId && items.length>=200) invalid('Maximum 200 assignments per scenario.');
            const start=instant(item.startsAt),end=instant(item.endsAt),hours=Number(item.allocatedHours),mark=Number(item.minimumMark);
            if(start<scenario.startsAt || start>=scenario.endsAt || end<=start || +end-+start>8*3600000 || typeof item.allocatedHours!=='number' || hours<=0 || hours>(+end-+start)/3600000 || round(hours)!==hours || typeof item.minimumMark!=='number' || !Number.isFinite(mark) || mark<0 || mark>100) invalid('Use a start inside the planning window, an end within 8 hours, hours within that session, and a mark between 0 and 100.');
            const tutorId=positiveId(item.tutorId),courseId=positiveId(item.courseId);
            const tutors=await client.query(`SELECT "id" FROM "Profile" WHERE "id"=$1 AND "role"='TUTOR'`,[tutorId]);if(!tutors.rows.length) throw createRouteError(404,'TUTOR_NOT_FOUND','Choose a current Tutor.');
            if(itemId) await client.query(`UPDATE "ScenarioItem" SET "tutorId"=$3,"courseId"=$4,"startsAt"=$5::timestamp,"endsAt"=$6::timestamp,"allocatedHours"=$7,"minimumMark"=$8 WHERE "id"=$2 AND "scenarioId"=$1`,[id,itemId,tutorId,courseId,toNaiveUtcText(start),toNaiveUtcText(end),hours,mark]);
            else await client.query(`INSERT INTO "ScenarioItem" ("scenarioId","tutorId","courseId","startsAt","endsAt","allocatedHours","minimumMark") VALUES ($1,$2,$3,$4::timestamp,$5::timestamp,$6,$7)`,[id,tutorId,courseId,toNaiveUtcText(start),toNaiveUtcText(end),hours,mark]);
          }
          if(action==='remove-item'||action==='lock') {
            const itemId=positiveId(input.itemId),item=(await readItems(client,id)).find(x=>x.id===itemId);if(!item)throw notFound();
            if(action==='lock') {if(typeof input.locked!=='boolean')invalid('Choose locked or unlocked.');await client.query('UPDATE "ScenarioItem" SET "locked"=$2 WHERE "id"=$1',[itemId,input.locked]);}
            else {if(item.locked)throw createRouteError(409,'ITEM_LOCKED','Unlock this assignment before removing it.');await client.query('DELETE FROM "ScenarioItem" WHERE "id"=$1',[itemId]);}
          }
          if(action==='publish') await publish(client,scenario,owner.id,input,clock());
        }
        await client.query('UPDATE "Scenario" SET "version"="version"+1,"updatedById"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1',[id,owner.id]);
        await audit(client,owner.id,id,before,`SCENARIO_${action.toUpperCase().replaceAll('-','_')}`);
        return detail(client,id);
      });
    },
  };
}
export type ScenarioService=ReturnType<typeof createScenarioService>;
