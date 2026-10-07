import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {beforeEach,expect,it,vi} from 'vitest'
import SwapWorkspace from './SwapWorkspace'
const mocks=vi.hoisted(()=>({token:vi.fn(),list:vi.fn(),get:vi.fn(),options:vi.fn(),create:vi.fn(),change:vi.fn(),dashboard:vi.fn()}))
vi.mock('@auth0/auth0-react',()=>({useAuth0:()=>({getAccessTokenSilently:mocks.token})}))
vi.mock('../api/scheduling',()=>({listSwaps:mocks.list,getSwap:mocks.get,replacementOptions:mocks.options,createSwap:mocks.create,changeSwap:mocks.change}))
vi.mock('../api/tutorDashboard',()=>({fetchTutorDashboard:mocks.dashboard}))
const snapshot={courseCode:'COMS',startsAt:'2030-09-02T08:00:00Z',endsAt:'2030-09-02T10:00:00Z',allocatedHours:2,requesterHoursBefore:2,requesterHoursAfter:0,replacementHoursBefore:0,replacementHoursAfter:2}
const swap={id:1,requesterId:3,replacementId:4,requesterName:'Original Tutor',replacementName:'Replacement Tutor',reason:'Lecture',snapshot,status:'REQUESTED',version:1}
const detail={swap,history:[{id:1,action:'REQUESTED',actorName:'Original Tutor',createdAt:'2030-09-01T00:00:00Z',note:'Lecture'}]}
beforeEach(()=>{vi.clearAllMocks();window.history.replaceState({},'','/');mocks.list.mockResolvedValue({items:[swap],actorId:4,page:1,hasMore:false});mocks.get.mockResolvedValue(detail);mocks.dashboard.mockResolvedValue({allocations:[{id:9,...snapshot,status:'CONFIRMED'}]});mocks.options.mockResolvedValue({allocation:{id:9,...snapshot},allocationRevision:'revision-1',requesterHoursBefore:2,requesterHoursAfter:0,choices:[{tutorId:4,fullName:'Replacement Tutor',hoursBefore:0,hoursAfter:2}]});mocks.create.mockResolvedValue(detail);mocks.change.mockResolvedValue({...detail,swap:{...swap,status:'ACCEPTED',version:2}})})
async function open(role='TUTOR'){render(<SwapWorkspace role={role}/>);fireEvent.click(await screen.findByRole('button',{name:'Swap details #1'}));await screen.findByRole('region',{name:'Swap details'})}
it('lets only the addressed replacement accept or decline and records the current version',async()=>{
 await open();expect(screen.queryByRole('button',{name:'Cancel swap'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Approve swap'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Accept swap'}));expect(mocks.change).not.toHaveBeenCalled();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm decision'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith(1,{action:'accept',version:1,note:''},mocks.token));expect(await screen.findByRole('heading',{name:'Swap #1 · ACCEPTED'})).toBeInTheDocument()
})
it('exposes Organiser approval only after acceptance and displays before/after hours',async()=>{
 mocks.get.mockResolvedValue({...detail,swap:{...swap,status:'ACCEPTED',version:2}});await open('ORGANISER');expect(screen.queryByRole('heading',{name:'Request a replacement'})).not.toBeInTheDocument();expect(screen.getByRole('region',{name:'Swap before and after'})).toHaveTextContent('Original Tutor weekly hours');fireEvent.click(screen.getByRole('button',{name:'Approve swap'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm decision'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledWith(1,{action:'approve',version:2,note:''},mocks.token))
})
it('creates from the server preview without changing the live calendar',async()=>{
 mocks.list.mockResolvedValue({items:[],actorId:3,page:1,hasMore:false});render(<SwapWorkspace/>);await screen.findByRole('option',{name:/COMS/});fireEvent.change(screen.getByLabelText('Your session'),{target:{value:'9'}});await screen.findByRole('option',{name:'Replacement Tutor'});fireEvent.change(screen.getByLabelText('Replacement Tutor'),{target:{value:'4'}});fireEvent.change(screen.getByLabelText('Reason for swap'),{target:{value:'Lecture clash'}});expect(screen.getByRole('region',{name:'Swap before and after'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Request swap'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm decision'}));await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith({allocationId:9,replacementId:4,allocationRevision:'revision-1',reason:'Lecture clash'},mocks.token))
})
it('refreshes after a concurrent decision and removes obsolete actions',async()=>{
 await open();mocks.change.mockRejectedValueOnce(Object.assign(new Error('Request changed'),{status:409}));mocks.get.mockResolvedValue({...detail,swap:{...swap,status:'CANCELLED',version:2}});fireEvent.click(screen.getByRole('button',{name:'Accept swap'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm decision'}));expect(await screen.findByRole('alert')).toHaveTextContent('Latest state loaded');expect(screen.queryByRole('button',{name:'Accept swap'})).not.toBeInTheDocument()
})
it('opens an addressed notification request and permits the requester to cancel',async()=>{
 window.history.replaceState({},'','/?swap=1');mocks.list.mockResolvedValue({items:[swap],actorId:3,page:1,hasMore:false});render(<SwapWorkspace/>);await screen.findByRole('button',{name:'Cancel swap'});expect(screen.queryByRole('button',{name:'Accept swap'})).not.toBeInTheDocument()
})
