import request from 'supertest';
import {describe,expect,it,vi} from 'vitest';
import {createApp,type AppDependencies} from './app.js';
import {createRouteError} from './http/errors.js';
import type {TutorRole} from './auth/contract.js';
function fixture(role:TutorRole='ORGANISER',configured=true,profileRole=role){
 const audit={list:vi.fn().mockResolvedValue({items:[],page:1,hasMore:false}),get:vi.fn().mockResolvedValue({id:1}),export:vi.fn().mockResolvedValue({csv:'redacted',count:1})};
 const restore={history:vi.fn().mockResolvedValue({items:[]}),preview:vi.fn().mockResolvedValue({canRestore:true,expectedVersion:2}),restore:vi.fn().mockResolvedValue({allocationId:2})};
 const deps={verifyAccessToken:async()=>({subject:'verified-user',role,claims:{sub:'verified-user'}}),findProfileByAuth0Id:async()=>({id:7,role:profileRole,email:'fixture@example.test',fullName:'Fixture'}),...(configured?{auditService:audit,allocationRestoreService:restore}:{})} as unknown as AppDependencies;
 return {app:createApp(async()=>undefined,deps),audit,restore};
}
const routes=[['get','/api/organiser/audit'],['get','/api/organiser/audit/export'],['get','/api/organiser/audit/1'],['get','/api/organiser/allocations/1/history'],['post','/api/organiser/allocations/1/restore-preview'],['post','/api/organiser/allocations/1/restore']] as const;
describe('Audit and restore HTTP contracts',()=>{
 it.each(routes)('%s %s enforces bearer auth and Organiser access',async(method,path)=>{
  expect((await request(fixture().app)[method](path)).status).toBe(401);
  for(const role of ['STUDENT','TUTOR'] as const)expect((await request(fixture(role).app)[method](path).set('Authorization','Bearer fixture').send({})).status).toBe(403);
 });
 it.each(routes)('%s %s fails closed without a service',async(method,path)=>{expect((await request(fixture('ORGANISER',false).app)[method](path).set('Authorization','Bearer fixture').send({})).status).toBe(503);});
 it('passes only the verified subject to filters, export, detail and versioned restore',async()=>{
  const {app,audit,restore}=fixture(),auth=['Authorization','Bearer fixture'] as const;
  await request(app).get('/api/organiser/audit?actorId=7&targetType=allocation').set(...auth);expect(audit.list).toHaveBeenCalledWith('verified-user',{actorId:'7',targetType:'allocation'});
  await request(app).get('/api/organiser/audit/export?action=ALLOCATION_RESTORED').set(...auth);expect(audit.export).toHaveBeenCalledWith('verified-user',{action:'ALLOCATION_RESTORED'});
  await request(app).get('/api/organiser/audit/1').set(...auth);expect(audit.get).toHaveBeenCalledWith('verified-user',1);
  await request(app).get('/api/organiser/allocations/1/history').set(...auth);expect(restore.history).toHaveBeenCalledWith('verified-user',1);
  await request(app).post('/api/organiser/allocations/1/restore-preview').set(...auth).send({eventId:2,side:'after'});expect(restore.preview).toHaveBeenCalledWith('verified-user',1,{eventId:2,side:'after'});
  const body={eventId:2,side:'after',expectedVersion:2,reason:'Correct hours'};await request(app).post('/api/organiser/allocations/1/restore').set(...auth).send(body);expect(restore.restore).toHaveBeenCalledWith('verified-user',1,body);
 });
 it('maps invalid IDs, missing records, stale writes and unexpected errors safely',async()=>{
  const {app,audit,restore}=fixture(),auth=['Authorization','Bearer fixture'] as const;expect((await request(app).get('/api/organiser/audit/bad').set(...auth)).status).toBe(400);
  audit.get.mockRejectedValueOnce(createRouteError(404,'AUDIT_NOT_FOUND','Unavailable.'));expect((await request(app).get('/api/organiser/audit/99').set(...auth)).status).toBe(404);
  restore.restore.mockRejectedValueOnce(createRouteError(409,'RESTORE_STALE','Preview again.'));expect((await request(app).post('/api/organiser/allocations/1/restore').set(...auth).send({})).status).toBe(409);
  audit.export.mockRejectedValueOnce(new Error('secret SQL'));const response=await request(app).get('/api/organiser/audit/export').set(...auth);expect(response.status).toBe(500);expect(JSON.stringify(response.body)).not.toContain('secret SQL');
  expect((await request(fixture('ORGANISER',true,'STUDENT').app).get('/api/organiser/audit').set(...auth)).status).toBe(403);
 });
});
const matrix=[
 ['get','/api/me/time-slots','ORGANISER'],['post','/api/me/time-slots','ORGANISER'],['patch','/api/me/time-slots/1','ORGANISER'],['delete','/api/me/time-slots/1','ORGANISER'],['post','/api/me/time-slots/import/preview','ORGANISER'],['post','/api/me/time-slots/import/commit','ORGANISER'],
 ['get','/api/student/tutoring-options','TUTOR'],['post','/api/student/mutual-availability','TUTOR'],['get','/api/me/bookings','ORGANISER'],['get','/api/me/bookings/1','ORGANISER'],['post','/api/student/bookings','TUTOR'],['post','/api/me/bookings/1/cancel','ORGANISER'],['post','/api/student/bookings/1/sick-notes','TUTOR'],['get','/api/organiser/student-sick-notes','STUDENT'],['post','/api/organiser/student-sick-notes/1/decision','STUDENT'],
 ['get','/api/organiser/scenarios','STUDENT'],['post','/api/organiser/scenarios','STUDENT'],['get','/api/organiser/scenarios/1','STUDENT'],['get','/api/organiser/scenarios/1/compare','STUDENT'],['post','/api/organiser/scenarios/1/presence','STUDENT'],['post','/api/organiser/scenarios/1/actions','STUDENT'],
 ['get','/api/swaps','STUDENT'],['get','/api/swaps/1','STUDENT'],['get','/api/tutor/allocations/1/replacements','STUDENT'],['post','/api/tutor/swaps','STUDENT'],['post','/api/swaps/1/actions','STUDENT'],
] as const;
it.each(matrix)('Sprint 4 role matrix %s %s rejects missing auth and %s',async(method,path,wrong)=>{const {app}=fixture(wrong);expect((await request(app)[method](path)).status).toBe(401);expect((await request(app)[method](path).set('Authorization','Bearer fixture').send({})).status).toBe(403);});
