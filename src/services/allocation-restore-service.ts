import {findAllocationCandidates,toNaiveUtcText,type QueryClient} from './allocation-queries.js';
import {auditAllocation,auditSnapshot,writeAudit} from './audit-service.js';
import {exactFields,inPlanningTransaction,instant,invalid,positiveId,requireProfile,type PlanningStore} from './planning-store.js';
import {createRouteError} from '../http/errors.js';
import {note} from './scheduling-common.js';
interface Allocation {id:number;tutorId:number;courseId:number;startsAt:Date;endsAt:Date;allocatedHours:number;minimumMark:number;status:string;version:number;protected:boolean}
const unavailable=()=>createRouteError(404,'RESTORE_NOT_FOUND','This allocation or historical version is unavailable.');
async function current(client:QueryClient,id:number){const row=(await client.query<Allocation>(`SELECT a.*,a."allocatedHours"::float8 AS "allocatedHours",(EXISTS(SELECT 1 FROM "WorkLog" WHERE "allocationId"=a."id") OR EXISTS(SELECT 1 FROM "Excuse" WHERE "allocationId"=a."id") OR EXISTS(SELECT 1 FROM "OverflowWork" WHERE "sourceAllocationId"=a."id") OR EXISTS(SELECT 1 FROM "AuditEvent" WHERE "targetType"='allocation' AND "targetId"=a."id" AND "action"='ALLOCATION_RESTORE_REPLACED') OR EXISTS(SELECT 1 FROM "TutorSwap" WHERE "allocationId"=a."id" OR "replacementAllocationId"=a."id")) AS protected FROM "Allocation" a WHERE a."id"=$1 FOR UPDATE OF a`,[id])).rows[0];if(!row)throw unavailable();return row;}
async function historical(client:QueryClient,id:number,eventId:number,side:string){const event=(await client.query<{before:Record<string,unknown>;after:Record<string,unknown>}>('SELECT "before","after" FROM "AuditEvent" WHERE "id"=$1 AND "targetType"=\'allocation\' AND "targetId"=$2',[eventId,id])).rows[0];if(!event)throw unavailable();const value=side==='before'?event.before:event.after;
 if(value.id!==id||!['CONFIRMED','PROPOSED'].includes(String(value.status)))throw createRouteError(409,'RESTORE_INVALID_SNAPSHOT','Choose a historical Proposed or Confirmed allocation snapshot.');
 const tutorId=positiveId(value.tutorId),courseId=positiveId(value.courseId),startsAt=instant(value.startsAt),endsAt=instant(value.endsAt),hours=Number(value.allocatedHours),minimumMark=Math.max(50,Number(value.minimumMark??50));
 if(!Number.isFinite(hours)||hours<=0||endsAt<=startsAt||+endsAt-+startsAt>8*3600000||hours>(+endsAt-+startsAt)/3600000||!Number.isFinite(minimumMark)||minimumMark>100)throw createRouteError(409,'RESTORE_INVALID_SNAPSHOT','This historical snapshot cannot be restored.');
 return {id,tutorId,courseId,startsAt,endsAt,allocatedHours:hours,status:String(value.status),minimumMark};
}
function selection(raw:unknown,write=false){const input=exactFields(raw,write?['eventId','side','expectedVersion','reason']:['eventId','side']);if(input.side!=='before'&&input.side!=='after')invalid('Choose the before or after snapshot.');return {eventId:positiveId(input.eventId),side:input.side,expectedVersion:input.expectedVersion,reason:input.reason};}
async function assess(client:QueryClient,allocation:Allocation,target:Awaited<ReturnType<typeof historical>>,now:Date){
 const reasons:string[]=[];if(allocation.protected)reasons.push('Attendance, work-log, overflow, swap or prior restore history protects this allocation.');
 if(new Date(allocation.startsAt)<=now||target.startsAt<=now)reasons.push('Only future allocations and future historical times can be restored.');
 const candidate=(await findAllocationCandidates(client,{courseId:target.courseId,startsAt:target.startsAt,endsAt:target.endsAt,requestedHours:target.allocatedHours,minimumMark:Math.max(target.minimumMark,allocation.minimumMark),excludeAllocationId:allocation.id})).find(c=>c.tutorId===target.tutorId);
 if(!candidate?.isEligible)reasons.push(...(candidate?.reasonCodes??['Tutor/course eligibility is unavailable.']));return reasons;
}
export function createAllocationRestoreService(store:PlanningStore,clock=()=>new Date()){
 return {
  async history(subject:string,id:number){return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');await current(client,positiveId(id));return {items:(await client.query('SELECT "id","action","before","after","reason","createdAt","actorId" FROM "AuditEvent" WHERE "targetType"=\'allocation\' AND "targetId"=$1 ORDER BY "id" DESC LIMIT 100',[id])).rows};});},
  async preview(subject:string,id:number,raw:unknown){const input=selection(raw);return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');const allocation=await current(client,positiveId(id)),target=await historical(client,id,input.eventId,input.side),reasons=await assess(client,allocation,target,clock());return {current:auditSnapshot('allocation',allocation),historical:target,expectedVersion:allocation.version,eventId:input.eventId,side:input.side,requiredMark:Math.max(target.minimumMark,allocation.minimumMark),canRestore:!reasons.length,reasons};});},
  async restore(subject:string,id:number,raw:unknown){const input=selection(raw,true),version=positiveId(input.expectedVersion),reason=note(input.reason,true);return inPlanningTransaction(store,async client=>{
   const actor=await requireProfile(client,subject,'ORGANISER'),allocation=await current(client,positiveId(id));if(allocation.version!==version)throw createRouteError(409,'RESTORE_STALE','This allocation changed. Preview it again before restoring.');const target=await historical(client,id,input.eventId,input.side);
   const reasons=await assess(client,allocation,target,clock());if(reasons.length)throw createRouteError(409,'RESTORE_RULE_FAILED',`Restore is unavailable: ${reasons.join(' ')}`);
   // Preserve old identities, including cancelled records. Updating the source
   // increments its database version even if it was already cancelled.
   await client.query(`UPDATE "Allocation" SET "status"='CANCELLED',"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[id,actor.id]);
   const result=(await client.query<{id:number}>(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours","status","overrideReason","updatedAt","minimumMark") VALUES ($1,$2,$3::timestamp,$4::timestamp,$5,'PROPOSED',$6,CURRENT_TIMESTAMP,$7) RETURNING "id"`,[target.tutorId,target.courseId,toNaiveUtcText(target.startsAt),toNaiveUtcText(target.endsAt),target.allocatedHours,reason,Math.max(target.minimumMark,allocation.minimumMark)])).rows[0]!;
   if(target.status==='CONFIRMED')await client.query(`UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[result.id,actor.id]);
   await writeAudit(client,actor.id,'ALLOCATION_RESTORE_REPLACED','allocation',id,allocation,{...allocation,status:'CANCELLED',version:version+1,replacementAllocationId:result.id},reason);
   await auditAllocation(client,actor.id,result.id,{},'ALLOCATION_RESTORED',reason,Math.max(target.minimumMark,allocation.minimumMark),{sourceAllocationId:id,restoredFromEventId:input.eventId,restoredFromSide:input.side});
   for(const [recipient,targetId] of [[allocation.tutorId,id],[target.tutorId,result.id]])await client.query(`INSERT INTO "Notification" ("recipientProfileId","type","title","body","linkPath","targetType","targetId","eventKey") VALUES ($1,'ALLOCATION_CHANGED','Allocation restored','An Organiser restored a historical allocation. Open your timetable for the current details.','/tutor','allocation',$2,$3) ON CONFLICT("eventKey") DO NOTHING`,[recipient,targetId,`restore:${id}:${version}:${recipient}`]);
   return {sourceAllocationId:id,allocationId:result.id,sourceVersion:version+1};
  });},
 };
}
export type AllocationRestoreService=ReturnType<typeof createAllocationRestoreService>;
