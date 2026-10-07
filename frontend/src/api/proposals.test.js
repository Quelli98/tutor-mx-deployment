import { beforeEach,expect,it,vi } from 'vitest'
import * as proposals from './proposals'
const fetch=vi.hoisted(()=>vi.fn())
vi.mock('./client',()=>({fetchWithBearerToken:fetch}))
beforeEach(()=>fetch.mockReset().mockResolvedValue({data:{ok:true}}))
it('uses the proposal planning endpoints',async()=>{const token=vi.fn(),input={preset:'BALANCED'};await proposals.previewProposal(input,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/proposals/preview',{method:'POST',body:JSON.stringify(input)},token);await proposals.compareProposalStrategies(input,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/proposals/compare',{method:'POST',body:JSON.stringify(input)},token);await proposals.generateProposal(input,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/proposals/generate',{method:'POST',body:JSON.stringify(input)},token);await proposals.getProposalExplanations(9,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/proposals/9/explanations',{},token);await proposals.adjustProposal(9,input,token);expect(fetch).toHaveBeenLastCalledWith('/api/organiser/proposals/9/adjust',{method:'POST',body:JSON.stringify(input)},token)})
it('fails safely on malformed response envelopes',async()=>{fetch.mockResolvedValue({});await expect(proposals.generateProposal({},'token')).rejects.toThrow('proposal response')})
