import { findAllocationCandidates, toNaiveUtcText, type AllocationCandidate, type QueryClient } from './allocation-queries.js';
import { createRouteError } from '../http/errors.js';
import { exactFields, instant, invalid, positiveId, requireProfile, type PlanningStore } from './planning-store.js';
import type { ScenarioService } from './scenario-service.js';
import { writeAudit } from './audit-service.js';

export const PROPOSAL_PRESETS = ['BALANCED','STRONGEST_MATCH','FAIR_WORKLOAD','BUDGET_AWARE'] as const;
export type ProposalPreset = typeof PROPOSAL_PRESETS[number];

type Requirement = { id:number; courseId:number; courseCode:string; startsAt:Date; endsAt:Date; tutorsNeeded:number; hourlyRate:number|null; budget:number|null };
type PlanItem = { id?:number; sourceAllocationId:number|null; tutorId:number; tutorName:string; courseId:number; courseCode:string; startsAt:Date; endsAt:Date; allocatedHours:number; minimumMark:number; locked:boolean };
type CandidateExplanation = { tutorId:number; fullName:string; eligible:boolean; chosen:boolean; hardFailures:string[]; softScore:number|null; factors:string[]; reason:string };
type ProposalAssignment = { requirementId:number; courseId:number; courseCode:string; tutorId:number; tutorName:string; startsAt:string; endsAt:string; allocatedHours:number; minimumMark:number; explanation:CandidateExplanation[] };

const HOUR=3_600_000, WEEK=7*24*HOUR;
const round=(n:number)=>Math.round(n*100)/100;
const overlap=(a:PlanItem,start:Date,end:Date)=>Math.max(0,Math.min(+a.endsAt,+end)-Math.max(+a.startsAt,+start))/HOUR;
const monday=(d:Date)=>{const x=new Date(d);x.setUTCHours(0,0,0,0);const day=x.getUTCDay();x.setUTCDate(x.getUTCDate()-(day===0?6:day-1));return x;};
function preset(raw:unknown):ProposalPreset { if(typeof raw!=='string'||!PROPOSAL_PRESETS.includes(raw as ProposalPreset)) invalid('Choose Balanced, Strongest Match, Fair Workload or Budget Aware.'); return raw as ProposalPreset; }
function name(raw:unknown){if(typeof raw!=='string'||!raw.trim()||raw.trim().length>120)invalid('Enter a proposal name of 1–120 characters.');return raw.trim();}
function reason(raw:unknown){if(typeof raw!=='string'||raw.trim().length<3||raw.trim().length>500)invalid('Enter a short reason (3–500 characters).');return raw.trim();}
function score(c:AllocationCandidate,p:ProposalPreset){
  const mark=(c.mark??0)/100;
  const fairness=Number.isFinite(c.capacityShare)?Math.max(0,1-c.capacityShare):0;
  const weights=p==='STRONGEST_MATCH'?[0.9,0.1]:p==='FAIR_WORKLOAD'?[0.2,0.8]:[0.55,0.45];
  return round(mark*weights[0]!+fairness*weights[1]!);
}
function factors(c:AllocationCandidate,p:ProposalPreset){
  const xs=[`${c.mark??'No'}% course mark`,`${round(c.usedHours)} of ${round(c.weeklyLimit)} weekly hours already used`,`${round(c.remainingHours)} hours remaining`];
  if(p==='STRONGEST_MATCH')xs.push('Preset strongly favours the higher course mark.');
  if(p==='FAIR_WORKLOAD')xs.push('Preset strongly favours the tutor with more unused weekly capacity.');
  if(p==='BUDGET_AWARE')xs.push('Tutor choice never changes a course hourly rate; this preset prioritises lower-cost requirements first.');
  if(p==='BALANCED')xs.push('Preset balances course mark with unused weekly capacity.');
  return xs;
}
function candidateOrder(candidates:AllocationCandidate[],p:ProposalPreset){return [...candidates].sort((a,b)=>score(b,p)-score(a,p)||(b.mark??0)-(a.mark??0)||a.tutorId-b.tutorId);}
function planClash(items:PlanItem[], tutorId:number, start:Date,end:Date){return items.some(i=>i.tutorId===tutorId && +i.startsAt<+end && +i.endsAt>+start);}
function proposedWeekHours(items:PlanItem[], tutorId:number, start:Date){const w=+monday(start);return round(items.filter(i=>i.tutorId===tutorId && +monday(i.startsAt)===w && i.sourceAllocationId===null).reduce((s,i)=>s+i.allocatedHours,0));}

async function requirements(client:QueryClient,start:Date,end:Date){
  const {rows}=await client.query<Requirement>(`SELECT r."id",r."courseId",c."code" AS "courseCode",r."startsAt",r."endsAt",r."tutorsNeeded",c."hourlyRate"::float8 AS "hourlyRate",c."budget"::float8 AS budget FROM "StaffingRequirement" r JOIN "Course" c ON c."id"=r."courseId" WHERE r."status"='OPEN' AND r."startsAt">=$1::timestamp AND r."endsAt"<=$2::timestamp ORDER BY r."startsAt",r."id" LIMIT 201`,[toNaiveUtcText(start),toNaiveUtcText(end)]);
  if(rows.length>200)throw createRouteError(422,'PROPOSAL_TOO_LARGE','Choose a smaller planning window (maximum 200 open requirements).');
  return rows.map(r=>({...r,startsAt:new Date(r.startsAt),endsAt:new Date(r.endsAt)}));
}
async function readScenarioItems(client:QueryClient,id:number){
  const {rows}=await client.query<PlanItem>(`SELECT i."id",i."sourceAllocationId",i."tutorId",p."fullName" AS "tutorName",i."courseId",c."code" AS "courseCode",i."startsAt",i."endsAt",i."allocatedHours"::float8 AS "allocatedHours",i."minimumMark"::float8 AS "minimumMark",i."locked" FROM "ScenarioItem" i JOIN "Profile" p ON p."id"=i."tutorId" JOIN "Course" c ON c."id"=i."courseId" WHERE i."scenarioId"=$1 ORDER BY i."startsAt",i."id" LIMIT 201`,[id]);
  if(rows.length>200)throw createRouteError(422,'PROPOSAL_TOO_LARGE','Choose a smaller planning context.');
  return rows.map(i=>({...i,startsAt:new Date(i.startsAt),endsAt:new Date(i.endsAt)}));
}
async function liveItems(client:QueryClient,start:Date,end:Date){
  const {rows}=await client.query<PlanItem>(`SELECT a."id",a."id" AS "sourceAllocationId",a."tutorId",p."fullName" AS "tutorName",a."courseId",c."code" AS "courseCode",a."startsAt",a."endsAt",a."allocatedHours"::float8 AS "allocatedHours",a."minimumMark"::float8 AS "minimumMark",false AS "locked" FROM "Allocation" a JOIN "Profile" p ON p."id"=a."tutorId" JOIN "Course" c ON c."id"=a."courseId" WHERE a."status"='CONFIRMED' AND a."startsAt">=$1::timestamp AND a."startsAt"<$2::timestamp AND NOT EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED') ORDER BY a."startsAt",a."id" LIMIT 201`,[toNaiveUtcText(start),toNaiveUtcText(end)]);
  if(rows.length>200)throw createRouteError(422,'PROPOSAL_TOO_LARGE','Choose a smaller planning context.');
  return rows.map(i=>({...i,startsAt:new Date(i.startsAt),endsAt:new Date(i.endsAt)}));
}
function requirementOrder(rs:Requirement[],p:ProposalPreset,base:PlanItem[]){
  const shortage=(r:Requirement)=>Math.max(0,r.tutorsNeeded*(+r.endsAt-+r.startsAt)/HOUR-base.filter(i=>i.courseId===r.courseId).reduce((s,i)=>s+overlap(i,r.startsAt,r.endsAt),0));
  return [...rs].sort((a,b)=>{
    if(p==='BUDGET_AWARE') return (a.hourlyRate??Number.MAX_SAFE_INTEGER)-(b.hourlyRate??Number.MAX_SAFE_INTEGER)||+a.startsAt-+b.startsAt||a.id-b.id;
    return shortage(b)-shortage(a)||+a.startsAt-+b.startsAt||a.id-b.id;
  });
}
async function build(client:QueryClient,start:Date,end:Date,p:ProposalPreset,base:PlanItem[]){
  const rs=requirementOrder(await requirements(client,start,end),p,base), items=[...base], assignments:ProposalAssignment[]=[];
  const shortages:Array<{requirementId:number;courseCode:string;hours:number}>=[];
  for(const r of rs){
    const duration=round((+r.endsAt-+r.startsAt)/HOUR); if(duration<=0||duration>8)continue;
    let assigned=items.filter(i=>i.courseId===r.courseId).reduce((s,i)=>s+overlap(i,r.startsAt,r.endsAt),0);
    const required=round(duration*r.tutorsNeeded);
    const usedForRequirement=new Set(items.filter(i=>i.courseId===r.courseId && overlap(i,r.startsAt,r.endsAt)>0).map(i=>i.tutorId));
    while(assigned+0.009<required){
      const candidates=await findAllocationCandidates(client,{courseId:r.courseId,startsAt:r.startsAt,endsAt:r.endsAt,minimumMark:50,requestedHours:duration});
      const explain:CandidateExplanation[]=candidates.map(c=>{
        const hard:string[]=[...c.reasonCodes];
        if(planClash(items,c.tutorId,r.startsAt,r.endsAt)&&!hard.includes('schedule-clash')) hard.push('proposal-clash');
        if(usedForRequirement.has(c.tutorId)) hard.push('already-assigned-to-requirement');
        if(proposedWeekHours(items,c.tutorId,r.startsAt)+duration>c.remainingHours+0.009) hard.push('proposal-hour-limit');
        const eligible=hard.length===0;
        return {tutorId:c.tutorId,fullName:c.fullName,eligible,chosen:false,hardFailures:hard,softScore:eligible?score(c,p):null,factors:factors(c,p),reason:eligible?'Eligible; ranked by the selected preset.':`Not eligible: ${hard.join(', ')}.`};
      });
      const eligible=candidateOrder(candidates.filter(c=>explain.find(e=>e.tutorId===c.tutorId)?.eligible),p);
      const chosen=eligible[0];
      if(!chosen)break;
      const x=explain.find(e=>e.tutorId===chosen.tutorId)!;x.chosen=true;x.reason='Chosen because all hard rules pass and this tutor has the highest deterministic soft score for the selected preset.';
      for(const e of explain)if(e.eligible&&!e.chosen)e.reason='Why not: all hard rules pass, but this tutor has a lower soft score than the chosen tutor for this preset.';
      const item:PlanItem={sourceAllocationId:null,tutorId:chosen.tutorId,tutorName:chosen.fullName,courseId:r.courseId,courseCode:r.courseCode,startsAt:r.startsAt,endsAt:r.endsAt,allocatedHours:duration,minimumMark:50,locked:false};
      items.push(item);usedForRequirement.add(chosen.tutorId);assigned=round(assigned+duration);
      assignments.push({requirementId:r.id,courseId:r.courseId,courseCode:r.courseCode,tutorId:chosen.tutorId,tutorName:chosen.fullName,startsAt:r.startsAt.toISOString(),endsAt:r.endsAt.toISOString(),allocatedHours:duration,minimumMark:50,explanation:explain});
    }
    if(assigned+0.009<required)shortages.push({requirementId:r.id,courseCode:r.courseCode,hours:round(required-assigned)});
  }
  const spend=round(items.filter(i=>i.sourceAllocationId===null).reduce((sum,i)=>{const r=rs.find(r=>r.courseId===i.courseId);return sum+i.allocatedHours*(r?.hourlyRate??0);},0));
  const tutorHours=new Map<number,number>();for(const i of items.filter(i=>i.sourceAllocationId===null))tutorHours.set(i.tutorId,round((tutorHours.get(i.tutorId)??0)+i.allocatedHours));
  const workload=[...tutorHours.entries()].map(([tutorId,hours])=>({tutorId,tutorName:items.find(i=>i.tutorId===tutorId)!.tutorName,hours})).sort((a,b)=>a.tutorId-b.tutorId);
  return {preset:p,assignments,shortages,metrics:{proposedAssignments:assignments.length,coveredTutorHours:round(assignments.reduce((s,a)=>s+a.allocatedHours,0)),shortageHours:round(shortages.reduce((s,x)=>s+x.hours,0)),projectedAddedSpend:spend,workload}};
}

export function createProposalService(store:PlanningStore,scenarios:ScenarioService){
  async function context(subject:string,raw:unknown){
    const input=exactFields(raw,['name','startsAt','endsAt','preset','baseScenarioId']);
    const startsAt=instant(input.startsAt),endsAt=instant(input.endsAt),p=preset(input.preset);
    if(endsAt<=startsAt||+endsAt-+startsAt>28*24*HOUR||startsAt<=new Date())invalid('Choose a future planning window of up to 28 days.');
    let baseScenarioId:number|null=null;if(input.baseScenarioId!==undefined&&input.baseScenarioId!==null)baseScenarioId=positiveId(input.baseScenarioId);
    return {name:name(input.name??`${p.replaceAll('_',' ')} proposal`),startsAt,endsAt,p,baseScenarioId};
  }
  async function preview(subject:string,raw:unknown){const c=await context(subject,raw);await requireProfile(store,subject,'ORGANISER');let base=await liveItems(store,c.startsAt,c.endsAt);if(c.baseScenarioId){const d=await scenarios.get(subject,c.baseScenarioId);if(+new Date(d.scenario.startsAt)!==+c.startsAt||+new Date(d.scenario.endsAt)!==+c.endsAt)invalid('The locked base scenario must use the same planning window.');base=d.items as PlanItem[];}return build(store,c.startsAt,c.endsAt,c.p,base);}
  return {
    preview,
    async compare(subject:string,raw:unknown){const input=exactFields(raw,['name','startsAt','endsAt','baseScenarioId']);return Promise.all(PROPOSAL_PRESETS.map(p=>preview(subject,{...input,name:input.name??'Strategy comparison',preset:p})));},
    async generate(subject:string,raw:unknown){
      const c=await context(subject,raw);let created;
      if(c.baseScenarioId){const base=await scenarios.get(subject,c.baseScenarioId);if(+new Date(base.scenario.startsAt)!==+c.startsAt||+new Date(base.scenario.endsAt)!==+c.endsAt)invalid('The locked base scenario must use the same planning window.');created=await scenarios.change(subject,c.baseScenarioId,{action:'duplicate',version:base.scenario.version,name:c.name});}
      else created=await scenarios.create(subject,{name:c.name,notes:`Generated by ${c.p} proposal preset.`,startsAt:c.startsAt.toISOString(),endsAt:c.endsAt.toISOString()});
      const built=await build(store,c.startsAt,c.endsAt,c.p,created.items as PlanItem[]);let detail=created;
      for(const a of built.assignments){detail=await scenarios.change(subject,detail.scenario.id,{action:'save-item',version:detail.scenario.version,item:{id:null,tutorId:a.tutorId,courseId:a.courseId,startsAt:a.startsAt,endsAt:a.endsAt,allocatedHours:a.allocatedHours,minimumMark:a.minimumMark}});}
      return {scenario:detail.scenario,items:detail.items,proposal:built};
    },
    async explain(subject:string,id:number){await requireProfile(store,subject,'ORGANISER');const detail=await scenarios.get(subject,positiveId(id));const p=(String(detail.scenario.notes).match(/Generated by ([A-Z_]+) proposal preset/)?.[1]??'BALANCED') as ProposalPreset;const generated=(detail.items as PlanItem[]).filter(i=>i.sourceAllocationId===null);const assignments=[];for(const item of generated){const candidates=await findAllocationCandidates(store,{courseId:item.courseId,startsAt:new Date(item.startsAt),endsAt:new Date(item.endsAt),minimumMark:item.minimumMark,requestedHours:item.allocatedHours});const ex=candidates.map(c=>({tutorId:c.tutorId,fullName:c.fullName,eligible:c.reasonCodes.length===0,chosen:c.tutorId===item.tutorId,hardFailures:c.reasonCodes,softScore:c.reasonCodes.length?null:score(c,p),factors:factors(c,p),reason:c.tutorId===item.tutorId?'Chosen in this proposal.':c.reasonCodes.length?`Why not: ${c.reasonCodes.join(', ')}.`:'Why not: lower soft score for this preset.'}));assignments.push({...item,startsAt:new Date(item.startsAt).toISOString(),endsAt:new Date(item.endsAt).toISOString(),explanation:ex});}return {preset:p,scenario:detail.scenario,assignments};},
    async adjust(subject:string,id:number,raw:unknown){const input=exactFields(raw,['version','itemId','tutorId','reason']);const r=reason(input.reason),detail=await scenarios.get(subject,positiveId(id));const item=(detail.items as PlanItem[]).find(i=>i.id===positiveId(input.itemId));if(!item)throw createRouteError(404,'PROPOSAL_ITEM_NOT_FOUND','This proposal assignment is no longer available.');if(item.locked)throw createRouteError(409,'ITEM_LOCKED','Unlock this assignment before changing it.');const candidates=await findAllocationCandidates(store,{courseId:item.courseId,startsAt:new Date(item.startsAt),endsAt:new Date(item.endsAt),minimumMark:item.minimumMark,requestedHours:item.allocatedHours,excludeAllocationId:item.sourceAllocationId??undefined});const candidate=candidates.find(c=>c.tutorId===positiveId(input.tutorId));const otherItems=(detail.items as PlanItem[]).filter(i=>i.id!==item.id);const draftClash=planClash(otherItems,positiveId(input.tutorId),new Date(item.startsAt),new Date(item.endsAt));const extraWeek=proposedWeekHours(otherItems,positiveId(input.tutorId),new Date(item.startsAt));if(!candidate||!candidate.isEligible||draftClash||extraWeek+item.allocatedHours>candidate.remainingHours+0.009)throw createRouteError(409,'PROPOSAL_RULE_FAILED','Choose another Tutor who currently passes mark, clash and selected-week capacity rules in both live data and this draft.');const changed=await scenarios.change(subject,id,{action:'save-item',version:positiveId(input.version),item:{id:item.id,tutorId:candidate.tutorId,courseId:item.courseId,startsAt:new Date(item.startsAt).toISOString(),endsAt:new Date(item.endsAt).toISOString(),allocatedHours:item.allocatedHours,minimumMark:item.minimumMark}});const actor=await requireProfile(store,subject,'ORGANISER');await writeAudit(store,actor.id,'PROPOSAL_MANUAL_ADJUSTMENT','scenario',id,{itemId:item.id,tutorId:item.tutorId},{itemId:item.id,tutorId:candidate.tutorId,reason:r});return changed;},
  };
}
export type ProposalService=ReturnType<typeof createProposalService>;
