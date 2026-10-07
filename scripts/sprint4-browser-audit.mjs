/** Run only against a dedicated test environment with synthetic fixtures.
 * Usage: node scripts/sprint4-browser-audit.mjs /private/s4-browser-config.json
 * Requires Playwright + Chromium; never stores tokens or storage-state files.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
 ?require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`):require('playwright');
if(!process.argv[2])throw new Error('Pass a private browser configuration file; see docs/sprint4-member4-browser-checks.md.');
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const base=new URL(config.baseURL);assert(['http:','https:'].includes(base.protocol));
const out=resolve('docs/evidence/s4-m4/browser');await mkdir(out,{recursive:true});
const results=[];const browser=await chromium.launch({headless:true});
const contexts=[];
async function pageFor(role,path){const context=await browser.newContext({storageState:config.states[role]});contexts.push(context);const page=await context.newPage();await page.goto(new URL(path,base).href);await page.locator('#main-content').waitFor();return page;}
async function race(name,a,b,pathA,pathB,clickA,clickB){
 const responses=[a.waitForResponse(r=>['POST','PATCH'].includes(r.request().method())&&new URL(r.url()).pathname===pathA),b.waitForResponse(r=>['POST','PATCH'].includes(r.request().method())&&new URL(r.url()).pathname===pathB)];
 await Promise.all([clickA(),clickB()]);const received=await Promise.all(responses);const statuses=received.map(r=>r.status());
 assert.equal(statuses.filter(s=>s>=200&&s<300).length,1,`${name}: exactly one winner`);assert.equal(statuses.filter(s=>s===409).length,1,`${name}: stale action must conflict`);
 results.push({name,statuses});
}
try {
 // Two Students see the same free interval before either reserves it.
 const search=config.fixtures.availability;
 const [studentA,studentB]=await Promise.all([pageFor('student','/student/availability'),pageFor('student2','/student/availability')]);
 for(const page of [studentA,studentB]){
  await page.getByLabel('Course and tutor',{exact:true}).selectOption(`${search.courseId}:${search.tutorId}`);await page.getByLabel('Academic term',{exact:true}).selectOption(String(search.termId));
  await page.getByLabel('Search from',{exact:true}).fill(search.startsAtLocal);await page.getByLabel('Search until',{exact:true}).fill(search.endsAtLocal);await page.getByLabel('Session length (minutes)',{exact:true}).fill(String(search.durationMinutes));await page.getByRole('button',{name:'Find shared times',exact:true}).click();
  const choice=page.getByRole('button',{name:'Book this time',exact:true});await choice.first().waitFor();assert.equal(await choice.count(),1,'Use an exact, free, one-session search interval');await choice.click();
 }
 await race('competing-bookings',studentA,studentB,'/api/student/bookings','/api/student/bookings',()=>studentA.getByRole('button',{name:'Confirm booking',exact:true}).click(),()=>studentB.getByRole('button',{name:'Confirm booking',exact:true}).click());
 for(const page of [studentA,studentB]){await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Book this time',exact:true}).waitFor({state:'hidden'});}
 // Both participants load the same booking version before either writes.
 const id=config.fixtures.bookingId;
 const [student,tutor]=await Promise.all([pageFor('student',`/student/timetable?booking=${id}`),pageFor('tutor',`/tutor/timetable?booking=${id}`)]);
 await student.getByLabel('Reason for sick note').fill('Synthetic browser race check');await student.getByRole('button',{name:'Submit sick note',exact:true}).click();
 await tutor.getByRole('button',{name:'Cancel booking',exact:true}).click();
 await race('report-versus-cancel',student,tutor,`/api/student/bookings/${id}/sick-notes`,`/api/me/bookings/${id}/cancel`,()=>student.getByRole('button',{name:'Confirm sick note',exact:true}).click(),()=>tutor.getByRole('button',{name:'Confirm cancellation',exact:true}).click());
 await Promise.all([student.getByRole('dialog').waitFor({state:'hidden'}),tutor.getByRole('dialog').waitFor({state:'hidden'})]);
 await student.getByRole('button',{name:'Refresh booking details',exact:true}).click();await tutor.getByRole('button',{name:'Refresh booking details',exact:true}).click();
 // Two independent Organiser browser contexts review the same pending request.
 const noteId=config.fixtures.pendingSickNoteId;
 const [orgA,orgB]=await Promise.all([pageFor('organiser','/organiser/approvals'),pageFor(config.states.organiser2?'organiser2':'organiser','/organiser/approvals')]);
 await orgA.getByRole('button',{name:`Approve request #${noteId}`,exact:true}).click();await orgB.getByLabel(`Review note for request #${noteId}`,{exact:true}).fill('Synthetic competing rejection');await orgB.getByRole('button',{name:`Reject request #${noteId}`,exact:true}).click();
 const decisionPath=`/api/organiser/student-sick-notes/${noteId}/decision`;
 await race('competing-sick-note-decisions',orgA,orgB,decisionPath,decisionPath,()=>orgA.getByRole('button',{name:'Confirm decision',exact:true}).click(),()=>orgB.getByRole('button',{name:'Confirm decision',exact:true}).click());
 for(const page of [orgA,orgB]){await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:`Approve request #${noteId}`,exact:true}).waitFor({state:'hidden'});}
 // Overflow approval versus Student withdrawal. Fixture has exactly one pending
 // claim for the course in this Student's request list.
 const claimId=config.fixtures.overflowClaimId,course=config.fixtures.overflowCourseCode;
 const overflow=await pageFor('student','/student');await orgA.reload();
 const card=overflow.locator('article').filter({hasText:course}).filter({has:overflow.getByRole('button',{name:'Withdraw',exact:true})});assert.equal(await card.count(),1,'Use a unique pending overflow fixture course');await card.getByRole('button',{name:'Withdraw',exact:true}).click();
 const approval=orgA.locator('article').filter({has:orgA.locator(`#claim-${claimId}-reason`)});
 // Exact endpoints are read from the fixture config to match the deployed API.
 await race('overflow-approve-versus-withdraw',orgA,overflow,`/api/volunteer-claims/${claimId}/decision`,`/api/student/volunteer-requests/${claimId}/withdraw`,()=>approval.getByRole('button',{name:'Approve claim',exact:true}).click(),()=>overflow.getByRole('dialog').getByRole('button',{name:'Withdraw',exact:true}).click());
 // Responsive and compact-mode audit of the actual signed-in pages.
 const pages=[['student',`/student/timetable?booking=${id}`],['student','/student/availability'],['organiser','/organiser/approvals'],['organiser','/organiser/scenarios'],['organiser','/organiser/staffing/bulk'],['organiser','/organiser/command-centre'],['organiser','/organiser']];
 for(const [role,path] of pages){const page=await pageFor(role,path);for(const width of [360,768,1440])for(const compact of [false,true]){
   await page.setViewportSize({width,height:1000});await page.getByRole('checkbox',{name:'Compact mode',exact:true}).setChecked(compact);
   const dimensions=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert(dimensions.page<=dimensions.viewport+1,`${path} overflows at ${width}px compact=${compact}`);
   for(const button of await page.locator('main button:visible').all()){const box=await button.boundingBox();if(box)assert(box.x>=-1&&box.x+box.width<=width+1,`Action clipped: ${await button.innerText()}`);}
   const file=`${path.replaceAll(/[^a-z0-9]/gi,'-')}-${width}-${compact?'compact':'comfortable'}.png`;await page.screenshot({path:resolve(out,file),fullPage:true});results.push({path,width,compact,...dimensions,screenshot:file});
 }}
 await writeFile(resolve(out,'results.json'),JSON.stringify({passed:true,results},null,2));
 console.log('Browser races and responsive checks passed. Evidence: docs/evidence/s4-m4/browser');
} catch(error){await writeFile(resolve(out,'results.json'),JSON.stringify({passed:false,results,error:String(error)},null,2));throw error;}
finally{for(const context of contexts)await context.close();await browser.close();}
