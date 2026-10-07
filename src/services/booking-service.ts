import {toNaiveUtcText} from './allocation-queries.js';
import {createMutualAvailabilityService} from './mutual-availability.js';
import {exactFields,inPlanningTransaction,instant,invalid,positiveId,type PlanningStore} from './planning-store.js';
import {digest,history,missing,note,recordEvent,schedulingActor,schedulingNotification,stale} from './scheduling-common.js';
import {createRouteError} from '../http/errors.js';
import type {QueryClient} from './allocation-queries.js';
interface Booking {id:number;studentId:number;tutorId:number;courseId:number;termId:number;studentName:string;tutorName:string;courseCode:string;courseName:string;startsAt:Date;endsAt:Date;status:string;occurrenceStatus:string;version:number;createdAt:Date;updatedAt:Date}
const select=`SELECT b."id",b."studentId",b."tutorId",b."courseId",b."termId",b."startsAt",b."endsAt",b."status",b."occurrenceStatus",b."version",b."createdAt",b."updatedAt",s."fullName" AS "studentName",t."fullName" AS "tutorName",c."code" AS "courseCode",c."name" AS "courseName" FROM "TutoringBooking" b JOIN "Profile" s ON s."id"=b."studentId" JOIN "Profile" t ON t."id"=b."tutorId" JOIN "Course" c ON c."id"=b."courseId"`;
async function own(client:QueryClient,id:number,actorId:number,lock=false){
 const {rows}=await client.query<Booking>(select+` WHERE b."id"=$1 AND (b."studentId"=$2 OR b."tutorId"=$2)${lock?' FOR UPDATE OF b':''}`,[id,actorId]);if(!rows[0])throw missing();return rows[0];
}
export function createBookingService(store:PlanningStore,clock=()=>new Date()){
 const detail=async(client:QueryClient,id:number,actorId:number)=>{const booking=await own(client,id,actorId);return {booking,history:await history(client,'Booking',id),canCancel:booking.status==='CONFIRMED'&&booking.occurrenceStatus==='SCHEDULED'&&new Date(booking.startsAt)>clock()};};
 return {
  async list(subject:string,raw:unknown={}){return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['STUDENT','TUTOR']);const input=exactFields(raw,['page','startsAt','endsAt']);
   if(input.startsAt!==undefined||input.endsAt!==undefined){
    const start=instant(input.startsAt),end=instant(input.endsAt);if(end<=start||+end-+start>28*86400000)invalid('Choose a calendar window of up to 28 days.');
    const {rows}=await client.query<Booking>(select+` WHERE (b."studentId"=$1 OR b."tutorId"=$1) AND b."status"='CONFIRMED' AND b."occurrenceStatus"<>'EXCUSED' AND b."startsAt"<$3::timestamp AND b."endsAt">$2::timestamp ORDER BY b."startsAt",b."id" LIMIT 501`,[actor.id,toNaiveUtcText(start),toNaiveUtcText(end)]);
    if(rows.length>500)throw createRouteError(422,'TOO_MANY_SESSIONS','Choose a shorter calendar window.');return {items:rows,page:1,hasMore:false};
   }
   const page=input.page===undefined?1:positiveId(Number(input.page));if(page>10000)invalid('Choose a valid page.');
   const {rows}=await client.query<Booking>(select+` WHERE b."studentId"=$1 OR b."tutorId"=$1 ORDER BY CASE WHEN b."status"='CONFIRMED' AND b."startsAt">$2::timestamp THEN 0 ELSE 1 END,CASE WHEN b."startsAt">$2::timestamp THEN b."startsAt" END ASC,b."startsAt" DESC,b."id" DESC LIMIT 21 OFFSET $3`,[actor.id,toNaiveUtcText(clock()),(page-1)*20]);return {items:rows.slice(0,20),page,hasMore:rows.length>20};
  });},
  async get(subject:string,id:number){return inPlanningTransaction(store,async client=>{const actor=await schedulingActor(client,subject,['STUDENT','TUTOR']);return detail(client,positiveId(id),actor.id);});},
  async create(subject:string,raw:unknown){
   const input=exactFields(raw,['tutorId','courseId','termId','startsAt','endsAt','requestKey']);
   const tutorId=positiveId(input.tutorId),courseId=positiveId(input.courseId),termId=positiveId(input.termId),start=instant(input.startsAt),end=instant(input.endsAt);
   if(typeof input.requestKey!=='string'||! /^[a-zA-Z0-9_-]{8,128}$/.test(input.requestKey))invalid('Use a valid retry key.');
   const key=input.requestKey,hash=digest([tutorId,courseId,termId,start.toISOString(),end.toISOString()]);
   return inPlanningTransaction(store,async client=>{
    const actor=await schedulingActor(client,subject,['STUDENT']);
    const previous=(await client.query<{id:number;requestHash:string}>('SELECT "id","requestHash" FROM "TutoringBooking" WHERE "studentId"=$1 AND "requestKey"=$2',[actor.id,key])).rows[0];
    if(previous){if(previous.requestHash!==hash)throw stale();return detail(client,previous.id,actor.id);}
    // Claim both schedules before the recheck. A competing serializable writer
    // receives a conflict, and a retry always evaluates current availability.
    await client.query('UPDATE "Profile" SET "scheduleRevision"="scheduleRevision"+1 WHERE "id" IN (SELECT "id" FROM "Profile" WHERE "id"=ANY($1::integer[]) ORDER BY "id" FOR UPDATE)',[[actor.id,tutorId]]);
    const available=await createMutualAvailabilityService(client,clock).search(subject,{tutorId,courseId,termId,startsAt:start.toISOString(),endsAt:end.toISOString(),durationMinutes:(+end-+start)/60000,dailyStartHour:0,dailyEndHour:24});
    if(!available.slots.some(x=>x.startsAt===start.toISOString()&&x.endsAt===end.toISOString()))throw createRouteError(409,'BOOKING_UNAVAILABLE','That time is no longer available. Search again for a shared time.');
    const {rows}=await client.query<{id:number}>(`INSERT INTO "TutoringBooking" ("studentId","tutorId","courseId","termId","startsAt","endsAt","requestKey","requestHash") VALUES ($1,$2,$3,$4,$5::timestamp,$6::timestamp,$7,$8) RETURNING "id"`,[actor.id,tutorId,courseId,termId,toNaiveUtcText(start),toNaiveUtcText(end),key,hash]);const id=rows[0]!.id;
    await recordEvent(client,'Booking',id,actor.id,'CONFIRMED',1);await schedulingNotification(client,[actor.id,tutorId],'BOOKING_CONFIRMED','booking',id,1,'Tutoring booking confirmed');return detail(client,id,actor.id);
   });
  },
  async cancel(subject:string,id:number,raw:unknown){const input=exactFields(raw,['version','note']),version=positiveId(input.version),text=note(input.note??'');return inPlanningTransaction(store,async client=>{
   const actor=await schedulingActor(client,subject,['STUDENT','TUTOR']),booking=await own(client,positiveId(id),actor.id,true);
   if(booking.version!==version||booking.status!=='CONFIRMED'||booking.occurrenceStatus!=='SCHEDULED')throw stale();
   if(new Date(booking.startsAt)<=clock())throw createRouteError(409,'BOOKING_STARTED','Only a future booking can be cancelled.');
   await client.query(`UPDATE "TutoringBooking" SET "status"='CANCELLED',"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,[id]);
   await recordEvent(client,'Booking',id,actor.id,'CANCELLED',version+1,text);await schedulingNotification(client,[booking.studentId,booking.tutorId],'BOOKING_CANCELLED','booking',id,version+1,'Tutoring booking cancelled');return detail(client,id,actor.id);
  });},
 };
}
export type BookingService=ReturnType<typeof createBookingService>;
