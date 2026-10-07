import request from 'supertest';
import {describe,expect,it,vi} from 'vitest';
import {createApp,type AppDependencies} from './app.js';
import type {TutorRole} from './auth/contract.js';
import {createRouteError} from './http/errors.js';
function fixture(role:TutorRole,configured=true){
 const sickNotes={submit:vi.fn().mockResolvedValue({id:1,status:'PENDING'}),list:vi.fn().mockResolvedValue({items:[]}),decide:vi.fn().mockResolvedValue({id:1,status:'APPROVED'})};
 const bookings={list:vi.fn().mockResolvedValue({items:[]}),get:vi.fn().mockResolvedValue({booking:{id:1}}),create:vi.fn().mockResolvedValue({booking:{id:1}}),cancel:vi.fn().mockResolvedValue({booking:{id:1,status:'CANCELLED'}})};
 const swaps={list:vi.fn().mockResolvedValue({items:[]}),get:vi.fn().mockResolvedValue({swap:{id:1}}),options:vi.fn().mockResolvedValue({choices:[]}),create:vi.fn().mockResolvedValue({swap:{id:1}}),change:vi.fn().mockResolvedValue({swap:{id:1}})};
 const dependencies={verifyAccessToken:async()=>({subject:'session-user',role,claims:{sub:'session-user'}}),findProfileByAuth0Id:async()=>({id:7,role,email:'fixture@example.test',fullName:'Fixture'}),...(configured?{bookingService:bookings,swapService:swaps,studentSickNoteService:sickNotes}:{})} as unknown as AppDependencies;
 return {app:createApp(async()=>undefined,dependencies),bookings,swaps,sickNotes};
}
const routes=[['post','/api/student/bookings/1/sick-notes','STUDENT'],['get','/api/organiser/student-sick-notes','ORGANISER'],['post','/api/organiser/student-sick-notes/1/decision','ORGANISER'],['get','/api/me/bookings','STUDENT'],['get','/api/me/bookings/1','TUTOR'],['post','/api/student/bookings','STUDENT'],['post','/api/me/bookings/1/cancel','TUTOR'],['get','/api/swaps','ORGANISER'],['get','/api/swaps/1','TUTOR'],['get','/api/tutor/allocations/1/replacements','TUTOR'],['post','/api/tutor/swaps','TUTOR'],['post','/api/swaps/1/actions','ORGANISER']] as const;
describe('booking and swap HTTP boundary',()=>{
 it.each(routes)('%s %s authenticates and fails closed when unconfigured',async(method,path,role)=>{const {app}=fixture(role,false);expect((await request(app)[method](path)).status).toBe(401);expect((await request(app)[method](path).set('Authorization','Bearer example')).status).toBe(503);});
 it.each(routes)('%s %s rejects an unrelated role',async(method,path)=>{const wrong=path.includes('bookings')?'ORGANISER':path.includes('/api/tutor/')?'STUDENT':'STUDENT';const {app}=fixture(wrong);expect((await request(app)[method](path).set('Authorization','Bearer example')).status).toBe(403);});
 it('passes the verified subject and request version to participant booking actions',async()=>{
  const {app,bookings}=fixture('STUDENT');const auth=['Authorization','Bearer example'] as const;
  await request(app).get('/api/me/bookings?page=2').set(...auth);expect(bookings.list).toHaveBeenCalledWith('session-user',{page:'2'});
  await request(app).get('/api/me/bookings/1').set(...auth);expect(bookings.get).toHaveBeenCalledWith('session-user',1);
  const payload={tutorId:3,requestKey:'example-key'};expect((await request(app).post('/api/student/bookings').set(...auth).send(payload)).status).toBe(201);expect(bookings.create).toHaveBeenCalledWith('session-user',payload);
  await request(app).post('/api/me/bookings/1/cancel').set(...auth).send({version:2});expect(bookings.cancel).toHaveBeenCalledWith('session-user',1,{version:2});
  bookings.cancel.mockRejectedValueOnce(createRouteError(409,'SCHEDULING_STALE','Refresh.'));expect((await request(app).post('/api/me/bookings/1/cancel').set(...auth).send({version:1})).status).toBe(409);
 });
 it('passes swap proposals, replacement lists and versioned decisions without accepting a supplied identity',async()=>{
  const {app,swaps}=fixture('TUTOR');const auth=['Authorization','Bearer example'] as const;
  await request(app).get('/api/swaps?page=2').set(...auth);expect(swaps.list).toHaveBeenCalledWith('session-user',2);
  await request(app).get('/api/swaps/1').set(...auth);expect(swaps.get).toHaveBeenCalledWith('session-user',1);
  await request(app).get('/api/tutor/allocations/1/replacements').set(...auth);expect(swaps.options).toHaveBeenCalledWith('session-user',1);
  expect((await request(app).post('/api/tutor/swaps').set(...auth).send({allocationId:1})).status).toBe(201);expect(swaps.create).toHaveBeenCalledWith('session-user',{allocationId:1});
  await request(app).post('/api/swaps/1/actions').set(...auth).send({action:'accept',version:1});expect(swaps.change).toHaveBeenCalledWith('session-user',1,{action:'accept',version:1});
  expect((await request(app).get('/api/swaps/bad').set(...auth)).status).toBe(400);expect((await request(app).get('/api/swaps?page=bad').set(...auth)).status).toBe(400);
 });
});

it('passes sick-note actions through the authenticated boundary',async()=>{
 const auth=['Authorization','Bearer example'] as const;const student=fixture('STUDENT'),org=fixture('ORGANISER');
 const report={bookingVersion:1,reason:'Ill'};expect((await request(student.app).post('/api/student/bookings/1/sick-notes').set(...auth).send(report)).status).toBe(201);expect(student.sickNotes.submit).toHaveBeenCalledWith('session-user',1,report);
 await request(org.app).get('/api/organiser/student-sick-notes?page=2').set(...auth);expect(org.sickNotes.list).toHaveBeenCalledWith('session-user',{page:'2'});
 const decision={version:1,bookingVersion:2,decision:'APPROVED'};await request(org.app).post('/api/organiser/student-sick-notes/1/decision').set(...auth).send(decision);expect(org.sickNotes.decide).toHaveBeenCalledWith('session-user',1,decision);
 org.sickNotes.decide.mockRejectedValueOnce(createRouteError(409,'SCHEDULING_STALE','Refresh.'));expect((await request(org.app).post('/api/organiser/student-sick-notes/1/decision').set(...auth).send(decision)).status).toBe(409);
 expect((await request(org.app).post('/api/organiser/student-sick-notes/bad/decision').set(...auth).send(decision)).status).toBe(400);
});
