import { beforeEach,expect,it,vi } from 'vitest'
import * as planning from './planning'
const fetch=vi.hoisted(()=>vi.fn())
vi.mock('./client',()=>({fetchWithBearerToken:fetch}))
beforeEach(()=>fetch.mockReset().mockResolvedValue({data:{ok:true}}))
it('sends versioned writes and presence through authenticated requests',async()=>{
 const token=vi.fn();const input={version:3,action:'archive'}
 expect(await planning.changeScenario(7,input,token)).toEqual({ok:true});expect(fetch).toHaveBeenLastCalledWith('/api/organiser/scenarios/7/actions',{method:'POST',body:JSON.stringify(input)},token)
 await planning.heartbeatScenario(7,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/scenarios/7/presence',{method:'POST',body:'{}'},token)
 await planning.createScenario(input,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/scenarios',{method:'POST',body:JSON.stringify(input)},token)
 await planning.findMutualAvailability(input,token);expect(fetch).toHaveBeenLastCalledWith('/api/student/mutual-availability',{method:'POST',body:JSON.stringify(input)},token)
})
it('uses correct read endpoints and rejects malformed envelopes',async()=>{
 for(const [fn,args,path] of [[planning.listScenarios,['DRAFT','token'],'/api/organiser/scenarios?status=DRAFT'],[planning.getScenario,[7,'token'],'/api/organiser/scenarios/7'],[planning.compareScenario,[7,'token'],'/api/organiser/scenarios/7/compare'],[planning.discoverTutoring,['token'],'/api/student/tutoring-options']]){await fn(...args);expect(fetch).toHaveBeenLastCalledWith(path,{},'token')}
 fetch.mockResolvedValue({});await expect(planning.getScenario(7,'token')).rejects.toThrow('planning response')
})
