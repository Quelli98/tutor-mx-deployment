import { act,fireEvent,render,screen } from '@testing-library/react'
import { beforeEach,expect,it,vi } from 'vitest'
import MutualAvailability from './MutualAvailability'
const mocks=vi.hoisted(()=>({token:vi.fn(),discover:vi.fn(),search:vi.fn(),terms:vi.fn()}))
vi.mock('@auth0/auth0-react',()=>({useAuth0:()=>({getAccessTokenSilently:mocks.token})}))
vi.mock('../api/planning',()=>({discoverTutoring:mocks.discover,findMutualAvailability:mocks.search}))
vi.mock('../api/timetableImport',()=>({listPublishedAcademicTerms:mocks.terms}))
beforeEach(()=>{
 vi.clearAllMocks()
 mocks.discover.mockResolvedValue({choices:[{courseId:1,courseCode:'COMS',courseName:'Computing',tutorId:3,tutorName:'Tutor One'}],truncated:false})
 mocks.terms.mockResolvedValue([{id:1,name:'Term Three'}])
 mocks.search.mockResolvedValue({slots:[],durationMinutes:60,truncated:false,policy:'Availability is not a reservation.'})
})
async function ready(){render(<MutualAvailability/>);await screen.findByRole('option',{name:/Tutor One/})}
function fill(){for(const [label,value] of [['Course and tutor','1:3'],['Academic term','1'],['Search from','2030-09-02T08:00'],['Search until','2030-09-02T12:00']])fireEvent.change(screen.getByLabelText(label),{target:{value}})}
it('submits Johannesburg instants without a client-selected student and displays the no-common-time state',async()=>{
 await ready();fill();fireEvent.click(screen.getByRole('button',{name:'Find shared times'}));await screen.findByText(/No common time found/)
 expect(mocks.search).toHaveBeenCalledWith({courseId:1,tutorId:3,termId:1,startsAt:'2030-09-02T06:00:00.000Z',endsAt:'2030-09-02T10:00:00.000Z',durationMinutes:60,dailyStartHour:8,dailyEndHour:18},mocks.token)
 expect(screen.queryByRole('button',{name:/book/i})).not.toBeInTheDocument()
})
it('shows bounded results and invalidates them when the search changes',async()=>{
 mocks.search.mockResolvedValue({slots:[{startsAt:'2030-09-02T06:00:00Z',endsAt:'2030-09-02T07:00:00Z'}],durationMinutes:60,truncated:true,policy:'No reservation'})
 await ready();fill();fireEvent.click(screen.getByRole('button',{name:'Find shared times'}));await screen.findByRole('region',{name:'Available session times'});expect(screen.getByText(/Showing the first 80/)).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Session length (minutes)'),{target:{value:'30'}});expect(screen.queryByRole('region',{name:'Available session times'})).not.toBeInTheDocument()
})
it('does not show stale async results after inputs change',async()=>{
 let resolve;mocks.search.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await ready();fill();fireEvent.click(screen.getByRole('button',{name:'Find shared times'}));fireEvent.change(screen.getByLabelText('Session length (minutes)'),{target:{value:'30'}})
 await act(async()=>resolve({slots:[],durationMinutes:60,policy:'stale'}));expect(screen.queryByText('stale')).not.toBeInTheDocument()
})
it('can retry failed discovery and recover from a search failure',async()=>{
 mocks.discover.mockRejectedValueOnce(new Error('Try again'))
 render(<MutualAvailability/>);fireEvent.click(await screen.findByRole('button',{name:'Retry'}));await screen.findByRole('option',{name:/Tutor One/});fill()
 mocks.search.mockRejectedValueOnce(new Error('Choice changed'));fireEvent.click(screen.getByRole('button',{name:'Find shared times'}));expect(await screen.findByRole('alert')).toHaveTextContent('Choice changed')
 fireEvent.click(screen.getByRole('button',{name:'Find shared times'}));await screen.findByText(/No common time found/)
})
it('handles empty discovery and terms safely',async()=>{
 mocks.discover.mockResolvedValue({choices:[],truncated:false});mocks.terms.mockResolvedValue([]);render(<MutualAvailability/>);await screen.findByText('No eligible tutors are available yet.');expect(screen.getByRole('button',{name:'Find shared times'})).toBeDisabled()
})
