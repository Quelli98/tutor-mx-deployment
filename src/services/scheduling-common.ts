import {createHash} from 'node:crypto';
import type {QueryClient} from './allocation-queries.js';
import {createRouteError} from '../http/errors.js';
import {invalid} from './planning-store.js';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function note(value:unknown,required=false){if(typeof value!=='string'||value.length>1000||(required&&!value.trim()))invalid('Enter a note of up to 1,000 characters.');return value.trim();}
export const stale=()=>createRouteError(409,'SCHEDULING_STALE','This session changed. Refresh to see the latest state before retrying.');
export const missing=()=>createRouteError(404,'SESSION_NOT_FOUND','This session is unavailable or you do not have access.');
export async function schedulingActor(client:QueryClient,subject:string,roles:string[]){
 const {rows}=await client.query<{id:number;role:string;fullName:string}>('SELECT "id","role","fullName" FROM "Profile" WHERE "auth0Id"=$1',[subject]);
 if(!rows[0]||!roles.includes(rows[0].role))throw createRouteError(403,'FORBIDDEN','This action is unavailable for your current account.');return rows[0];
}
export async function history(client:QueryClient,kind:'Booking'|'Swap',id:number){
 return (await client.query(`SELECT e."id",e."action",e."version",e."note",e."createdAt",p."fullName" AS "actorName" FROM "${kind}Event" e JOIN "Profile" p ON p."id"=e."actorId" WHERE e."${kind==='Booking'?'bookingId':'swapId'}"=$1 ORDER BY e."version"`,[id])).rows;
}
export async function recordEvent(client:QueryClient,kind:'Booking'|'Swap',id:number,actorId:number,action:string,version:number,text=''){
 await client.query(`INSERT INTO "${kind}Event" ("${kind==='Booking'?'bookingId':'swapId'}","actorId","action","version","note") VALUES ($1,$2,$3,$4,$5)`,[id,actorId,action,version,text]);
}
export async function schedulingNotification(client:QueryClient,recipients:number[],type:string,target:'booking'|'swap',id:number,version:number,title:string){
 for(const recipient of new Set(recipients))await client.query(`INSERT INTO "Notification" ("recipientProfileId","type","title","body","linkPath","targetType","targetId","eventKey") SELECT "id",$2::"NotificationType",$3,'Open the session for the latest details.',CASE WHEN $4='booking' THEN CASE WHEN "role"='STUDENT' THEN '/student/timetable' ELSE '/tutor/timetable' END ELSE CASE WHEN "role"='ORGANISER' THEN '/organiser/swaps' ELSE '/tutor/swaps' END END,$4,$5,$6 FROM "Profile" WHERE "id"=$1 ON CONFLICT("eventKey") DO NOTHING`,[recipient,type,title,target,id,`${target}:${id}:${version}:${recipient}`]);
}
