import { fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { beforeEach,expect,it,vi } from 'vitest'
import ScenarioPlanning from './ScenarioPlanning'
const mocks=vi.hoisted(()=>({token:vi.fn(),list:vi.fn(),create:vi.fn(),get:vi.fn(),compare:vi.fn(),change:vi.fn(),heartbeat:vi.fn(),courses:vi.fn(),tutors:vi.fn(),candidates:vi.fn()}))
vi.mock('@auth0/auth0-react',()=>({useAuth0:()=>({getAccessTokenSilently:mocks.token})}))
vi.mock('../api/planning',()=>({listScenarios:mocks.list,createScenario:mocks.create,getScenario:mocks.get,compareScenario:mocks.compare,changeScenario:mocks.change,heartbeatScenario:mocks.heartbeat}))
vi.mock('../api/organiser',()=>({listCourses:mocks.courses,listTutors:mocks.tutors,listAllocationCandidates:mocks.candidates}))
const item={id:2,sourceAllocationId:9,tutorId:3,tutorName:'Tutor One',courseId:1,courseCode:'COMS',startsAt:'2030-09-02T08:00:00Z',endsAt:'2030-09-02T10:00:00Z',allocatedHours:2,minimumMark:50,locked:false}
const scenario={id:1,name:'Option A',notes:'Morning cover',status:'DRAFT',version:1,startsAt:'2030-09-02T00:00:00Z',endsAt:'2030-09-09T00:00:00Z',updatedAt:'2030-09-01T12:00:00Z',updatedByName:'Organiser One',itemCount:1}
const metrics={hours:2,shortageHours:2,projectedCost:200,workload:[{tutorId:3,tutorName:'Tutor One',hours:2}],courses:[{courseId:1,courseCode:'COMS',hourlyRate:100,budget:1000,projectedCost:200,budgetRemaining:800}]}
beforeEach(()=>{
 vi.clearAllMocks();mocks.list.mockResolvedValue([scenario]);mocks.get.mockResolvedValue({scenario,items:[item]});mocks.heartbeat.mockResolvedValue([{fullName:'Organiser Two'}]);mocks.courses.mockResolvedValue([{id:1,code:'COMS',name:'Computing'}]);mocks.tutors.mockResolvedValue([{id:3,fullName:'Tutor One'}]);mocks.candidates.mockResolvedValue([])
 mocks.compare.mockResolvedValue({version:1,liveRevision:'a'.repeat(64),liveChanged:false,liveMetrics:metrics,draftMetrics:metrics,diff:{added:[],removed:[],changed:[]}})
 mocks.change.mockImplementation(async(id,payload)=>({scenario:{...scenario,version:payload.version+1},items:[item]}))
})
async function open(){render(<ScenarioPlanning/>);fireEvent.click(await screen.findByRole('button',{name:'Option A'}));await screen.findByRole('heading',{name:'Draft assignments'})}
it('requires comparison and explicit confirmation before publishing the reviewed version',async()=>{
 await open();expect(screen.queryByRole('button',{name:'Publish scenario'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Compare with Live'}));fireEvent.click(await screen.findByRole('button',{name:'Publish scenario'}));expect(mocks.change).not.toHaveBeenCalled()
 const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('button',{name:'Cancel'})).toHaveFocus();fireEvent.click(within(dialog).getByRole('button',{name:'Confirm publish'}));await screen.findByText(/Scenario published/)
 expect(mocks.change).toHaveBeenCalledWith(1,{action:'publish',version:1,liveRevision:'a'.repeat(64)},mocks.token)
})
it('handles a second organiser stale version and preserves unsaved inputs while refreshing',async()=>{
 await open();fireEvent.change(screen.getByLabelText('Scenario name'),{target:{value:'My unsaved change'}});mocks.change.mockRejectedValueOnce(new Error('Someone changed this scenario. Refresh, compare your changes, then retry.'))
 fireEvent.click(screen.getByRole('button',{name:'Save name and notes'}));await screen.findByRole('alert');mocks.get.mockResolvedValue({scenario:{...scenario,name:'Other organiser edit',version:2},items:[item]})
 fireEvent.click(screen.getAllByRole('button',{name:'Refresh latest scenario'})[0]);await screen.findByRole('heading',{name:'Other organiser edit'});expect(screen.getByLabelText('Scenario name')).toHaveValue('My unsaved change')
 fireEvent.click(screen.getByRole('button',{name:'Save name and notes'}));await waitFor(()=>expect(mocks.change).toHaveBeenLastCalledWith(1,{action:'metadata',version:2,name:'My unsaved change',notes:'Morning cover'},mocks.token))
})
it('blocks locked assignment controls until explicitly unlocked',async()=>{
 mocks.get.mockResolvedValue({scenario,items:[{...item,locked:true}]});await open();expect(screen.getByRole('button',{name:'Edit assignment'})).toBeDisabled();expect(screen.getByRole('button',{name:'Remove from draft'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Unlock'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith(1,{action:'lock',version:1,itemId:2,locked:false},mocks.token))
})
it('does not allow publishing a stale comparison and treats presence as informational',async()=>{
 mocks.compare.mockResolvedValue({version:2});mocks.heartbeat.mockRejectedValue(new Error('offline'));await open();fireEvent.click(screen.getByRole('button',{name:'Compare with Live'}));expect(await screen.findByRole('alert')).toHaveTextContent('Refresh the scenario');expect(screen.queryByRole('button',{name:'Publish scenario'})).not.toBeInTheDocument();expect(screen.getByText('Collaborator presence is temporarily unavailable.')).toBeInTheDocument()
})
it('confirms deleting a draft and keeps archived drafts read-only until reopened',async()=>{
 mocks.get.mockResolvedValue({scenario:{...scenario,status:'ARCHIVED'},items:[item]});await open();expect(screen.queryByRole('button',{name:'Save name and notes'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Reopen draft'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Delete scenario'}));mocks.change.mockResolvedValue({deleted:true});fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete scenario'}));await waitFor(()=>expect(screen.queryByRole('heading',{name:'Draft assignments'})).not.toBeInTheDocument())
})
it('creates a draft with South African input times and duplicates using the current version',async()=>{
 mocks.create.mockResolvedValue({scenario,items:[item]});render(<ScenarioPlanning/>);await screen.findByRole('button',{name:'Option A'})
 for(const [label,value] of [['New scenario name','New plan'],['Planning from','2030-09-02T08:00'],['Planning until','2030-09-09T08:00']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Create draft'}));await screen.findByRole('heading',{name:'Draft assignments'});expect(mocks.create).toHaveBeenCalledWith({name:'New plan',startsAt:'2030-09-02T06:00:00.000Z',endsAt:'2030-09-09T06:00:00.000Z'},mocks.token)
 fireEvent.click(screen.getByRole('button',{name:'Duplicate scenario'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith(1,{action:'duplicate',version:1,name:'Option A copy'},mocks.token))
})
