import {writeAudit} from './audit-service.js';
import {retryKey,priorReceipt,saveReceipt} from './mutation-receipts.js';
import type {QueryClient} from './allocation-queries.js';
import {toNaiveUtcText} from './allocation-queries.js';
import {exactFields,inPlanningTransaction,invalid,positiveId,type PlanningStore} from './planning-store.js';
import {missing,note,recordEvent,schedulingActor,schedulingNotification,stale} from './scheduling-common.js';
interface Booking {id:number;studentId:number;tutorId:number;startsAt:Date;status:string;occurrenceStatus:string;version:number}
interface SickNote {id:number;bookingId:number;reason:string;status:string;version:number;reviewNote:string;reviewedAt:Date|null;createdAt:Date}
export const bookingAbsenceStatus=(startsAt:Date,approvedAt:Date)=>approvedAt<startsAt?'EXCUSED':'SKIPPED';
export async function bookingSickNotes(client:QueryClient,id:number){return (await client.query<SickNote>('SELECT "id","bookingId","reason","status","version","reviewNote","reviewedAt","createdAt" FROM "StudentSickNote" WHERE "bookingId"=$1 ORDER BY "id" DESC',[id])).rows;}
async function lockBooking(client:QueryClient,id:number){const b=(await client.query<Booking>('SELECT * FROM "TutoringBooking" WHERE "id"=$1 FOR UPDATE',[id])).rows[0];if(!b)throw missing();return b;}
export function createStudentSickNoteService(store:PlanningStore,clock=()=>new Date()){
 return {
  async submit(subject:string,id:number,raw:unknown){const input=exactFields(raw,['bookingVersion','reason','requestKey']),version=positiveId(input.bookingVersion),reason=note(input.reason,true),key=retryKey(input.requestKey),payload={bookingVersion:version,reason};return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['STUDENT']),b=await lockBooking(client,positiveId(id));if(b.studentId!==actor.id)throw missing();
   const previous=await priorReceipt(client,actor.id,`sick-submit:${id}`,key,payload);if(previous)return (await bookingSickNotes(client,id)).find(n=>n.id===previous)!;
   if(b.version!==version||b.status!=='CONFIRMED'||b.occurrenceStatus!=='SCHEDULED'||(await bookingSickNotes(client,id)).some(n=>n.status==='PENDING'))throw stale();
   const n=(await client.query<SickNote>('INSERT INTO "StudentSickNote" ("bookingId","reason") VALUES ($1,$2) RETURNING *',[id,reason])).rows[0]!;
   await client.query('UPDATE "TutoringBooking" SET "version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1',[id]);
   await recordEvent(client,'Booking',id,actor.id,'ABSENCE_PENDING',version+1,'',b);
   await writeAudit(client,actor.id,'SICK_NOTE_SUBMITTED','sick-note',n.id,{},n);await saveReceipt(client,actor.id,`sick-submit:${id}`,key,payload,n.id);
   const organisers=(await client.query<{id:number}>(`SELECT "id" FROM "Profile" WHERE "role"='ORGANISER'`)).rows.map(p=>p.id);
   await schedulingNotification(client,organisers,'STUDENT_SICK_SUBMITTED','sick-note',id,version+1,'Student sick note awaiting review');return n;
  });},
  async list(subject:string,raw:unknown={}){const input=exactFields(raw,['page']),page=input.page===undefined?1:positiveId(Number(input.page));if(page>10000)invalid('Choose a valid page.');return inPlanningTransaction(store,async client=>{
   await schedulingActor(client,subject,['ORGANISER']);const rows=(await client.query(`SELECT n.*,b."version" AS "bookingVersion",b."startsAt",b."endsAt",b."occurrenceStatus",s."fullName" AS "studentName",t."fullName" AS "tutorName",c."code" AS "courseCode" FROM "StudentSickNote" n JOIN "TutoringBooking" b ON b."id"=n."bookingId" JOIN "Profile" s ON s."id"=b."studentId" JOIN "Profile" t ON t."id"=b."tutorId" JOIN "Course" c ON c."id"=b."courseId" ORDER BY CASE WHEN n."status"='PENDING' THEN 0 ELSE 1 END,n."id" DESC LIMIT 21 OFFSET $1`,[(page-1)*20])).rows;
   const count=(await client.query<{count:number}>(`SELECT count(*)::integer AS count FROM "StudentSickNote" WHERE "status"='PENDING'`)).rows[0]!.count;return {items:rows.slice(0,20),page,hasMore:rows.length>20,pendingCount:count};
  });},
  async decide(subject:string,id:number,raw:unknown){const input=exactFields(raw,['version','bookingVersion','decision','reviewNote','requestKey']),version=positiveId(input.version),bookingVersion=positiveId(input.bookingVersion);if(!['APPROVED','REJECTED'].includes(String(input.decision)))invalid('Choose approve or reject.');const review=note(input.reviewNote??'',input.decision==='REJECTED'),key=retryKey(input.requestKey),payload={version,bookingVersion,decision:input.decision,review};return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['ORGANISER']);const candidate=(await client.query<SickNote>('SELECT * FROM "StudentSickNote" WHERE "id"=$1',[positiveId(id)])).rows[0];if(!candidate)throw missing();
   // Always lock the booking first, as submit and cancel do.
   const b=await lockBooking(client,candidate.bookingId),n=(await client.query<SickNote>('SELECT * FROM "StudentSickNote" WHERE "id"=$1 FOR UPDATE',[id])).rows[0]!;
   const previous=await priorReceipt(client,actor.id,`sick-decision:${id}`,key,payload);if(previous)return n;
   if(n.status!=='PENDING'||n.version!==version||b.version!==bookingVersion||b.status!=='CONFIRMED'||b.occurrenceStatus!=='SCHEDULED')throw stale();
   const at=clock(),attendance=input.decision==='APPROVED'?bookingAbsenceStatus(new Date(b.startsAt),at):'SCHEDULED';
   await client.query('UPDATE "StudentSickNote" SET "status"=$2,"reviewNote"=$3,"reviewedById"=$4,"reviewedAt"=$5::timestamp,"version"="version"+1 WHERE "id"=$1',[id,input.decision,review,actor.id,toNaiveUtcText(at)]);
   await client.query('UPDATE "TutoringBooking" SET "occurrenceStatus"=$2,"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1',[b.id,attendance]);
   await recordEvent(client,'Booking',b.id,actor.id,input.decision==='APPROVED'?attendance:'ABSENCE_REJECTED',b.version+1,'',b);
   await writeAudit(client,actor.id,`SICK_NOTE_${input.decision}`,'sick-note',id,n,{...n,status:input.decision,version:n.version+1,reviewedById:actor.id,reviewedAt:at});await saveReceipt(client,actor.id,`sick-decision:${id}`,key,payload,id);
   await schedulingNotification(client,[b.studentId],'STUDENT_SICK_DECIDED','booking',b.id,b.version+1,'Your sick note was reviewed');
   if(input.decision==='APPROVED')await schedulingNotification(client,[b.tutorId],'BOOKING_ATTENDANCE_CHANGED','booking',b.id,b.version+1,'Booking attendance updated');
   return (await bookingSickNotes(client,b.id)).find(x=>x.id===id)!;
  });},
 };
}
export type StudentSickNoteService=ReturnType<typeof createStudentSickNoteService>;
