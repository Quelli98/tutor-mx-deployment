import {findAllocationCandidates,getTutorHourSummary,toNaiveUtcText,type QueryClient} from './allocation-queries.js';
import {exactFields,inPlanningTransaction,invalid,positiveId,type PlanningStore} from './planning-store.js';
import {digest,history,missing,note,recordEvent,schedulingActor,schedulingNotification,stale} from './scheduling-common.js';
import {createRouteError} from '../http/errors.js';
interface Allocation {id:number;tutorId:number;courseId:number;startsAt:Date;endsAt:Date;allocatedHours:number;status:string;updatedAt:Date;protected:boolean;courseCode:string;courseName:string;tutorName:string}
interface Swap {id:number;allocationId:number;requesterId:number;replacementId:number;replacementAllocationId:number|null;allocationRevision:string;snapshot:Record<string,unknown>;reason:string;status:string;version:number;requesterName:string;replacementName:string;createdAt:Date;updatedAt:Date}
async function allocation(client:QueryClient,id:number,lock=false){
 const {rows}=await client.query<Allocation>(`SELECT a.*,a."allocatedHours"::float8 AS "allocatedHours",c."code" AS "courseCode",c."name" AS "courseName",p."fullName" AS "tutorName",(EXISTS(SELECT 1 FROM "WorkLog" w WHERE w."allocationId"=a."id") OR EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id") OR EXISTS(SELECT 1 FROM "OverflowWork" o WHERE o."sourceAllocationId"=a."id")) AS protected FROM "Allocation" a JOIN "Course" c ON c."id"=a."courseId" JOIN "Profile" p ON p."id"=a."tutorId" WHERE a."id"=$1${lock?' FOR UPDATE OF a':''}`,[id]);if(!rows[0])throw missing();return rows[0];
}
const revision=(a:Allocation)=>digest([a.id,a.tutorId,a.courseId,a.startsAt,a.endsAt,a.allocatedHours,a.status,a.updatedAt,a.protected]);
function eligibleSource(a:Allocation,now:Date){if(a.status!=='CONFIRMED'||new Date(a.startsAt)<=now||a.protected)throw createRouteError(409,'SWAP_SOURCE_CHANGED','Only a future confirmed allocation without attendance, work-log or overflow history can be swapped. Refresh your sessions.');}
async function candidates(client:QueryClient,a:Allocation){return findAllocationCandidates(client,{courseId:a.courseId,startsAt:new Date(a.startsAt),endsAt:new Date(a.endsAt),requestedHours:a.allocatedHours,minimumMark:50});}
const select=`SELECT s.*,a."fullName" AS "requesterName",r."fullName" AS "replacementName" FROM "TutorSwap" s JOIN "Profile" a ON a."id"=s."requesterId" JOIN "Profile" r ON r."id"=s."replacementId"`;
async function own(client:QueryClient,id:number,actor:{id:number;role:string},lock=false){const {rows}=await client.query<Swap>(select+` WHERE s."id"=$1 AND ($3='ORGANISER' OR s."requesterId"=$2 OR s."replacementId"=$2)${lock?' FOR UPDATE OF s':''}`,[id,actor.id,actor.role]);if(!rows[0])throw missing();return rows[0];}
export function createSwapService(store:PlanningStore,clock=()=>new Date()){
 const detail=async(client:QueryClient,id:number,actor:{id:number;role:string})=>({swap:await own(client,id,actor),history:await history(client,'Swap',id)});
 return {
  async list(subject:string,page=1){return inPlanningTransaction(store,async client=>{const actor=await schedulingActor(client,subject,['TUTOR','ORGANISER']);positiveId(page);if(page>10000)invalid('Choose a valid page.');const {rows}=await client.query<Swap>(select+` WHERE $2='ORGANISER' OR s."requesterId"=$1 OR s."replacementId"=$1 ORDER BY CASE WHEN s."status" IN ('REQUESTED','ACCEPTED') THEN 0 ELSE 1 END,s."createdAt" DESC,s."id" DESC LIMIT 21 OFFSET $3`,[actor.id,actor.role,(page-1)*20]);return {items:rows.slice(0,20),page,hasMore:rows.length>20,actorId:actor.id};});},
  async get(subject:string,id:number){return inPlanningTransaction(store,async client=>{const actor=await schedulingActor(client,subject,['TUTOR','ORGANISER']);return detail(client,positiveId(id),actor);});},
  async options(subject:string,id:number){return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['TUTOR']),a=await allocation(client,positiveId(id));if(a.tutorId!==actor.id)throw missing();eligibleSource(a,clock());
   const week=new Date(a.startsAt);week.setUTCHours(0,0,0,0);week.setUTCDate(week.getUTCDate()-(week.getUTCDay()+6)%7);
   const workload=await getTutorHourSummary(client,actor.id,week);
   return {allocation:{id:a.id,courseCode:a.courseCode,courseName:a.courseName,startsAt:a.startsAt,endsAt:a.endsAt,allocatedHours:a.allocatedHours},allocationRevision:revision(a),requesterHoursBefore:workload?.usedHours??null,requesterHoursAfter:workload?Math.max(0,workload.usedHours-a.allocatedHours):null,choices:(await candidates(client,a)).filter(c=>c.isEligible&&c.tutorId!==actor.id).map(c=>({tutorId:c.tutorId,fullName:c.fullName,hoursBefore:c.usedHours,hoursAfter:c.usedHours+a.allocatedHours}))};
  });},
  async create(subject:string,raw:unknown){const input=exactFields(raw,['allocationId','replacementId','allocationRevision','reason']),id=positiveId(input.allocationId),replacementId=positiveId(input.replacementId),reason=note(input.reason,true);return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['TUTOR']),a=await allocation(client,id,true);if(a.tutorId!==actor.id)throw missing();eligibleSource(a,clock());if(revision(a)!==input.allocationRevision)throw stale();
   const replacement=(await candidates(client,a)).find(c=>c.tutorId===replacementId&&c.tutorId!==actor.id&&c.isEligible);if(!replacement)throw createRouteError(409,'SWAP_INELIGIBLE','That replacement is no longer eligible. Refresh the replacement list.');
   const week=new Date(a.startsAt);week.setUTCHours(0,0,0,0);week.setUTCDate(week.getUTCDate()-(week.getUTCDay()+6)%7);const workload=await getTutorHourSummary(client,actor.id,week);
   const snapshot={courseId:a.courseId,courseCode:a.courseCode,courseName:a.courseName,startsAt:a.startsAt,endsAt:a.endsAt,allocatedHours:a.allocatedHours,requesterHoursBefore:workload?.usedHours??null,requesterHoursAfter:workload?Math.max(0,workload.usedHours-a.allocatedHours):null,replacementHoursBefore:replacement.usedHours,replacementHoursAfter:replacement.usedHours+a.allocatedHours};
   const {rows}=await client.query<{id:number}>(`INSERT INTO "TutorSwap" ("allocationId","requesterId","replacementId","allocationRevision","snapshot","reason") VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING "id"`,[id,actor.id,replacementId,revision(a),JSON.stringify(snapshot),reason]);const swapId=rows[0]!.id;
   await recordEvent(client,'Swap',swapId,actor.id,'REQUESTED',1,reason);await schedulingNotification(client,[replacementId],'SWAP_REQUESTED','swap',swapId,1,'Replacement requested for a tutoring session');return detail(client,swapId,actor);
  });},
  async change(subject:string,id:number,raw:unknown){const input=exactFields(raw,['action','version','note']),version=positiveId(input.version),text=note(input.note??'');return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['TUTOR','ORGANISER']),swap=await own(client,positiveId(id),actor,true);
   if(swap.version!==version)throw stale();const action=input.action;
   const permitted=(action==='cancel'&&actor.id===swap.requesterId&&actor.role==='TUTOR'&&['REQUESTED','ACCEPTED'].includes(swap.status))||(['accept','decline'].includes(String(action))&&actor.id===swap.replacementId&&actor.role==='TUTOR'&&swap.status==='REQUESTED')||(action==='approve'&&actor.role==='ORGANISER'&&swap.status==='ACCEPTED')||(action==='reject'&&actor.role==='ORGANISER'&&['REQUESTED','ACCEPTED'].includes(swap.status));
   if(!permitted)throw createRouteError(409,'SWAP_ACTION_UNAVAILABLE','That action is not available in the current state. Refresh the request.');
   const statuses:Record<string,string>={cancel:'CANCELLED',accept:'ACCEPTED',decline:'DECLINED',approve:'APPROVED',reject:'REJECTED'},status=statuses[String(action)]!;
   if(action==='accept'||action==='approve'){
    const a=await allocation(client,swap.allocationId,true);eligibleSource(a,clock());if(revision(a)!==swap.allocationRevision)throw stale();
    const candidate=(await candidates(client,a)).find(c=>c.tutorId===swap.replacementId&&c.isEligible);if(!candidate)throw createRouteError(409,'SWAP_INELIGIBLE','Eligibility, capacity or the replacement timetable changed. Refresh before deciding.');
    if(action==='approve'){
     await client.query(`UPDATE "Allocation" SET "status"='CANCELLED',"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[a.id,actor.id]);
     const {rows}=await client.query<{id:number}>(`INSERT INTO "Allocation" ("tutorId","courseId","startsAt","endsAt","allocatedHours","status","updatedAt") VALUES ($1,$2,$3::timestamp,$4::timestamp,$5,'PROPOSED',CURRENT_TIMESTAMP) RETURNING "id"`,[swap.replacementId,a.courseId,toNaiveUtcText(new Date(a.startsAt)),toNaiveUtcText(new Date(a.endsAt)),a.allocatedHours]);
     await client.query(`UPDATE "Allocation" SET "status"='CONFIRMED',"reviewedById"=$2,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[rows[0]!.id,actor.id]);
     await client.query('UPDATE "TutorSwap" SET "replacementAllocationId"=$2 WHERE "id"=$1',[id,rows[0]!.id]);
    }
   }
   await client.query('UPDATE "TutorSwap" SET "status"=$2,"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1',[id,status]);await recordEvent(client,'Swap',id,actor.id,status,version+1,text);
   const recipients=[swap.requesterId,swap.replacementId];if(status==='ACCEPTED')recipients.push(...(await client.query<{id:number}>(`SELECT "id" FROM "Profile" WHERE "role"='ORGANISER'`)).rows.map(x=>x.id));
   await schedulingNotification(client,recipients,'SWAP_UPDATED','swap',id,version+1,`Tutor swap ${status.toLowerCase()}`);return detail(client,id,actor);
  });},
 };
}
export type SwapService=ReturnType<typeof createSwapService>;
