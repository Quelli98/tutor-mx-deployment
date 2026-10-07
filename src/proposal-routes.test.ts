import request from 'supertest';
import { describe,expect,it,vi } from 'vitest';
import { createApp,type AppDependencies } from './app.js';
import type { TutorRole } from './auth/contract.js';
function app(role:TutorRole,configured=true){
 const proposals={preview:vi.fn().mockResolvedValue({preset:'BALANCED'}),compare:vi.fn().mockResolvedValue([]),generate:vi.fn().mockResolvedValue({scenario:{id:4}}),explain:vi.fn().mockResolvedValue({assignments:[]}),adjust:vi.fn().mockResolvedValue({scenario:{id:4,version:2}})};
 const dependencies={verifyAccessToken:async()=>({subject:'test|organiser',role,claims:{sub:'test|organiser'}}),findProfileByAuth0Id:async()=>({id:7,role,email:'test@example.test',fullName:'Tester'}),...(configured?{proposalService:proposals}:{})} as unknown as AppDependencies;
 return {server:createApp(async()=>undefined,dependencies),proposals};
}
const routes=[['post','/api/organiser/proposals/preview'],['post','/api/organiser/proposals/compare'],['post','/api/organiser/proposals/generate'],['get','/api/organiser/proposals/4/explanations'],['post','/api/organiser/proposals/4/adjust']] as const;
describe('proposal HTTP routes',()=>{
 it.each(routes)('%s %s is organiser-only',async(method,path)=>{const {server}=app('STUDENT');expect((await request(server)[method](path)).status).toBe(401);expect((await request(server)[method](path).set('Authorization','Bearer test-token').send({})).status).toBe(403);});
 it.each(routes)('%s %s fails closed without the service',async(method,path)=>{const {server}=app('ORGANISER',false);expect((await request(server)[method](path).set('Authorization','Bearer test-token').send({})).status).toBe(503);});
 it('passes the authenticated subject and proposal inputs to the service',async()=>{const {server,proposals}=app('ORGANISER');const call=request(server),token=['Authorization','Bearer test-token'] as const;const body={name:'Plan',startsAt:'2030-10-10T08:00:00Z',endsAt:'2030-10-17T08:00:00Z',preset:'BALANCED'};expect((await call.post('/api/organiser/proposals/preview').set(...token).send(body)).status).toBe(200);expect(proposals.preview).toHaveBeenCalledWith('test|organiser',body);expect((await call.post('/api/organiser/proposals/generate').set(...token).send(body)).status).toBe(201);expect(proposals.generate).toHaveBeenCalledWith('test|organiser',body);await call.get('/api/organiser/proposals/4/explanations').set(...token);expect(proposals.explain).toHaveBeenCalledWith('test|organiser',4);const adjust={version:1,itemId:2,tutorId:5,reason:'Balances the team workload'};await call.post('/api/organiser/proposals/4/adjust').set(...token).send(adjust);expect(proposals.adjust).toHaveBeenCalledWith('test|organiser',4,adjust);});
 it('rejects malformed proposal identifiers before calling the service',async()=>{const {server,proposals}=app('ORGANISER');expect((await request(server).get('/api/organiser/proposals/nope/explanations').set('Authorization','Bearer test-token')).status).toBe(400);expect(proposals.explain).not.toHaveBeenCalled();});
});
