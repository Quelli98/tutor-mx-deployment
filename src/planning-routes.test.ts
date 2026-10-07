import request from 'supertest';
import { describe,expect,it,vi } from 'vitest';
import { createApp,type AppDependencies } from './app.js';
import { createRouteError } from './http/errors.js';
import type { TutorRole } from './auth/contract.js';
function app(role:TutorRole,configured=true){
 const planning={list:vi.fn().mockResolvedValue([]),create:vi.fn().mockResolvedValue({scenario:{id:1}}),get:vi.fn().mockResolvedValue({scenario:{id:1}}),compare:vi.fn().mockResolvedValue({version:1}),presence:vi.fn().mockResolvedValue([]),change:vi.fn().mockResolvedValue({deleted:true})};
 const mutual={discover:vi.fn().mockResolvedValue({choices:[],truncated:false}),search:vi.fn().mockResolvedValue({slots:[]})};
 // Only authentication and the services exercised by these routes are injected.
 const dependencies={verifyAccessToken:async()=>({subject:'test|session',role,claims:{sub:'test|session'}}),findProfileByAuth0Id:async()=>({id:7,role,email:'test@example.test',fullName:'Tester'}),...(configured?{scenarioService:planning,mutualAvailabilityService:mutual}:{})} as unknown as AppDependencies;
 return {server:createApp(async()=>undefined,dependencies),planning,mutual};
}
const routes=[['get','/api/organiser/scenarios','ORGANISER'],['post','/api/organiser/scenarios','ORGANISER'],['get','/api/organiser/scenarios/1','ORGANISER'],['get','/api/organiser/scenarios/1/compare','ORGANISER'],['post','/api/organiser/scenarios/1/presence','ORGANISER'],['post','/api/organiser/scenarios/1/actions','ORGANISER'],['get','/api/student/tutoring-options','STUDENT'],['post','/api/student/mutual-availability','STUDENT']] as const;
describe('planning and availability HTTP authorization',()=>{
 it.each(routes)('%s %s requires sign-in and a current database role',async(method,path,role)=>{
  const {server}=app(role==='ORGANISER'?'STUDENT':'ORGANISER');expect((await request(server)[method](path)).status).toBe(401);
  expect((await request(server)[method](path).set('Authorization','Bearer test-token').send({})).status).toBe(403);
 });
 it.each(routes)('%s %s fails closed when its service is unavailable',async(method,path,role)=>{
  const {server}=app(role,false);const response=await request(server)[method](path).set('Authorization','Bearer test-token').send({});expect(response.status).toBe(503);
 });
 it('passes versioned mutations and the authenticated subject to the scenario service',async()=>{
  const {server,planning}=app('ORGANISER');const call=request(server);const token=['Authorization','Bearer test-token'] as const;
  expect((await call.get('/api/organiser/scenarios?status=ARCHIVED').set(...token)).status).toBe(200);expect(planning.list).toHaveBeenCalledWith('test|session','ARCHIVED');
  const body={name:'Plan',startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-03T00:00:00Z'};
  expect((await call.post('/api/organiser/scenarios').set(...token).send(body)).status).toBe(201);expect(planning.create).toHaveBeenCalledWith('test|session',body);
  for(const [method,path] of [['get',''],['get','/compare'],['post','/presence']] as const)expect((await call[method]('/api/organiser/scenarios/1'+path).set(...token)).status).toBe(200);
  expect(planning.get).toHaveBeenCalledWith('test|session',1);expect(planning.compare).toHaveBeenCalledWith('test|session',1);expect(planning.presence).toHaveBeenCalledWith('test|session',1);
  const mutation={action:'metadata',version:2,name:'Reviewed',notes:'x'};await call.post('/api/organiser/scenarios/1/actions').set(...token).send(mutation);expect(planning.change).toHaveBeenCalledWith('test|session',1,mutation);
  planning.change.mockRejectedValueOnce(createRouteError(409,'SCENARIO_STALE','Refresh the draft.'));const stale=await call.post('/api/organiser/scenarios/1/actions').set(...token).send(mutation);expect(stale.status).toBe(409);expect(stale.body.error.code).toBe('SCENARIO_STALE');
 });
 it('rejects malformed scenario identifiers and duplicate status values',async()=>{
  const {server,planning}=app('ORGANISER');for(const path of ['/api/organiser/scenarios/nope','/api/organiser/scenarios?status=DRAFT&status=ARCHIVED'])expect((await request(server).get(path).set('Authorization','Bearer test-token')).status).toBe(400);expect(planning.get).not.toHaveBeenCalled();expect(planning.list).not.toHaveBeenCalled();
 });
 it('keeps availability reads bound to the signed-in student and masks unexpected failures',async()=>{
  const {server,mutual}=app('STUDENT');expect((await request(server).get('/api/student/tutoring-options').set('Authorization','Bearer test-token')).status).toBe(200);expect(mutual.discover).toHaveBeenCalledWith('test|session');
  const body={tutorId:3};expect((await request(server).post('/api/student/mutual-availability').set('Authorization','Bearer test-token').send(body)).status).toBe(200);expect(mutual.search).toHaveBeenCalledWith('test|session',body);
  mutual.search.mockRejectedValueOnce(new Error('secret database detail'));const failed=await request(server).post('/api/student/mutual-availability').set('Authorization','Bearer test-token').send(body);expect(failed.status).toBe(500);expect(JSON.stringify(failed.body)).not.toContain('secret database detail');
 });
});
