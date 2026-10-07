import type {QueryClient} from './allocation-queries.js';
import {toNaiveUtcText} from './allocation-queries.js';
import {exactFields,inPlanningTransaction,instant,invalid,positiveId,requireProfile,type PlanningStore} from './planning-store.js';
import {createRouteError} from '../http/errors.js';
export const AUDIT_TARGETS=['allocation','scenario','swap','booking','sick-note','timesheet'] as const;
export type AuditTarget=typeof AUDIT_TARGETS[number];
const fields:Record<AuditTarget,string[]>={
 allocation:['id','tutorId','courseId','startsAt','endsAt','allocatedHours','status','version','minimumMark','replacementAllocationId','sourceAllocationId','locked','restoredFromEventId','restoredFromSide'],
 scenario:['id','name','startsAt','endsAt','status','version','itemCount'],
 swap:['id','allocationId','requesterId','replacementId','replacementAllocationId','status','version'],
 booking:['id','studentId','tutorId','courseId','termId','startsAt','endsAt','status','occurrenceStatus','version'],
 'sick-note':['id','bookingId','status','version','reviewedById','reviewedAt'],
 timesheet:['id','tutorId','weekStart','status','reviewedById','reviewedAt'],
};
/** No arbitrary bodies or nested objects: only explicit operational fields. */
export function redactText(value:string){return value.slice(0,1000).replace(/\bBearer\s+\S+/gi,'[REDACTED]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]').replace(/\b(?:password|secret|token|api[_ -]?key|authorization)\s*[:=]\s*\S+/gi,'[REDACTED]').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,'[REDACTED URL]');}
export function auditSnapshot(target:AuditTarget,value:unknown){
 const result:Record<string,unknown>={};if(!value||typeof value!=='object')return result;
 const row=value as Record<string,unknown>;
 for(const key of fields[target]){const v=row[key];if(v instanceof Date)result[key]=v.toISOString();else if(typeof v==='string')result[key]=redactText(v);else if(typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||v===null)result[key]=v;}
 if(target==='scenario'&&Array.isArray(row.items))result.items=row.items.slice(0,200).map(item=>auditSnapshot('allocation',item));
 return result;
}
export async function writeAudit(client:QueryClient,actorId:number,action:string,targetType:AuditTarget,targetId:number,before:unknown,after:unknown,reason=''){
 await client.query('INSERT INTO "AuditEvent" ("actorId","action","targetType","targetId","before","after","reason") VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[actorId,action,targetType,targetId,JSON.stringify(auditSnapshot(targetType,before)),JSON.stringify(auditSnapshot(targetType,after)),targetType==='sick-note'?'':redactText(reason)]);
}
export async function auditAllocation(client:QueryClient,actorId:number,id:number,before:unknown,action:string,reason='',minimumMark?:number,context:Record<string,unknown>={}){
 const after=(await client.query<Record<string,unknown>>('SELECT *,"allocatedHours"::float8 AS "allocatedHours" FROM "Allocation" WHERE "id"=$1',[id])).rows[0];
 await writeAudit(client,actorId,action,'allocation',id,before,{...after,minimumMark:minimumMark??after?.minimumMark??50,...context},reason);
}
function publicEvent(row:Record<string,unknown>):Record<string,unknown>{const target=row.targetType as AuditTarget;return {...row,actorName:redactText(String(row.actorName??'')),reason:target==='sick-note'?'':redactText(String(row.reason??'')),before:AUDIT_TARGETS.includes(target)?auditSnapshot(target,row.before):{},after:AUDIT_TARGETS.includes(target)?auditSnapshot(target,row.after):{}};}
const select=`SELECT e.*,p."fullName" AS "actorName" FROM "AuditEvent" e JOIN "Profile" p ON p."id"=e."actorId"`;
export function csvCell(value:unknown){const text=typeof value==='object'?JSON.stringify(value):String(value??'');return '"'+(/^[\s]*[=+@-]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';}
function filters(raw:unknown,now:Date){const input=exactFields(raw,['from','to','actorId','action','targetType','targetId','page']);
 const to=input.to===undefined?new Date(+now+1000):instant(input.to),from=input.from===undefined?new Date(+to-90*86400000):instant(input.from);if(to<=from||+to-+from>366*86400000)invalid('Choose a date range of up to 366 days.');
 const params:unknown[]=[toNaiveUtcText(from),toNaiveUtcText(to)],clauses=['e."createdAt">=$1::timestamp','e."createdAt"<$2::timestamp'];
 for(const key of ['actorId','action','targetType','targetId'] as const){if(input[key]===undefined||input[key]==='')continue;let value=input[key];if(key==='actorId'||key==='targetId')value=positiveId(Number(value));else if(key==='targetType'){if(!AUDIT_TARGETS.includes(value as AuditTarget))invalid('Choose a valid audit target.');}else if(typeof value!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/.test(value))invalid('Choose a valid action.');params.push(value);clauses.push(`e."${key}"=$${params.length}`);}
 const page=input.page===undefined?1:positiveId(Number(input.page));if(page>10000)invalid('Choose a valid page.');return {params,where:' WHERE '+clauses.join(' AND '),page};
}
export function createAuditService(store:PlanningStore,clock=()=>new Date()){
 return {
  async list(subject:string,raw:unknown={}){const f=filters(raw,clock());return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');const rows=(await client.query<Record<string,unknown>>(select+f.where+` ORDER BY e."createdAt" DESC,e."id" DESC LIMIT 51 OFFSET $${f.params.length+1}`,[...f.params,(f.page-1)*50])).rows;return {items:rows.slice(0,50).map(publicEvent),page:f.page,hasMore:rows.length>50};});},
  async get(subject:string,id:number){return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');const row=(await client.query<Record<string,unknown>>(select+' WHERE e."id"=$1',[positiveId(id)])).rows[0];if(!row)throw createRouteError(404,'AUDIT_NOT_FOUND','This audit event is unavailable.');return publicEvent(row);});},
  async export(subject:string,raw:unknown={}){const f=filters(raw,clock());return inPlanningTransaction(store,async client=>{await requireProfile(client,subject,'ORGANISER');const rows=(await client.query<Record<string,unknown>>(select+f.where+' ORDER BY e."createdAt" DESC,e."id" DESC LIMIT 1001',f.params)).rows;if(rows.length>1000)throw createRouteError(422,'AUDIT_EXPORT_LIMIT','Narrow the filters to export at most 1,000 events.');const keys=['id','createdAt','actorId','actorName','action','targetType','targetId','reason','before','after'];const csv=[keys.map(csvCell).join(','),...rows.map(publicEvent).map(row=>keys.map(key=>csvCell(row[key] instanceof Date?(row[key] as Date).toISOString():row[key])).join(','))].join('\r\n')+'\r\n';if(Buffer.byteLength(csv,'utf8')>5_000_000)throw createRouteError(422,'AUDIT_EXPORT_LIMIT','Narrow the filters to keep the export under 5 MB.');return {filename:'tutor-mx-audit.csv',csv,count:rows.length};});},
 };
}
export type AuditService=ReturnType<typeof createAuditService>;
