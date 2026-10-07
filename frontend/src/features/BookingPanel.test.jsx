import {fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {beforeEach,expect,it,vi} from 'vitest'
import BookingPanel from './BookingPanel'
import MyTimetable from './MyTimetable'
const mocks=vi.hoisted(()=>({token:vi.fn(),list:vi.fn(),get:vi.fn(),cancel:vi.fn(),changed:vi.fn()}))
vi.mock('@auth0/auth0-react',()=>({useAuth0:()=>({getAccessTokenSilently:mocks.token,user:{sub:'participant'}})}))
vi.mock('../api/scheduling',()=>({listBookings:mocks.list,getBooking:mocks.get,cancelBooking:mocks.cancel}))
vi.mock('../api/availability',()=>({listOwnTimeSlots:vi.fn(async()=>[])}))
vi.mock('../api/tutorDashboard',()=>({fetchTutorDashboard:vi.fn(async()=>({allocations:[]}))}))
vi.mock('./ScheduleEntryPanel',()=>({default:()=>null}))
const booking={id:1,studentName:'Student One',tutorName:'Tutor One',courseCode:'COMS',courseName:'Computing',startsAt:'2030-09-02T11:00:00Z',endsAt:'2030-09-02T12:00:00Z',status:'CONFIRMED',occurrenceStatus:'SCHEDULED',version:1}
const detail={booking,canCancel:true,history:[{id:1,action:'CONFIRMED',actorName:'Student One',createdAt:'2030-09-01T10:00:00Z',note:''}]}
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue({items:[booking],page:1,hasMore:false});mocks.get.mockResolvedValue(detail);mocks.cancel.mockResolvedValue({...detail,booking:{...booking,status:'CANCELLED',version:2},canCancel:false});window.history.replaceState({},'','/')})
async function open(){render(<BookingPanel onChanged={mocks.changed}/>);fireEvent.click(await screen.findByRole('button',{name:'Booking details #1'}));await screen.findByRole('heading',{name:'COMS — Computing'})}
it('confirms cancellation, includes the version, refreshes the calendar and hides cancelled actions',async()=>{
 await open();fireEvent.change(screen.getByLabelText('Cancellation note (optional)'),{target:{value:'Cannot attend'}});fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));expect(mocks.cancel).not.toHaveBeenCalled();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm cancellation'}));await screen.findByText(/Booking cancelled/);await waitFor(()=>expect(mocks.changed).toHaveBeenCalledOnce());expect(mocks.cancel).toHaveBeenCalledWith(1,{version:1,note:'Cannot attend'},mocks.token);expect(screen.queryByRole('button',{name:'Cancel booking'})).not.toBeInTheDocument()
})
it('refreshes server truth after a stale cancellation',async()=>{
 await open();mocks.cancel.mockRejectedValueOnce(Object.assign(new Error('Session changed'),{status:409}));mocks.get.mockResolvedValue({...detail,booking:{...booking,status:'CANCELLED',version:2},canCancel:false});fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm cancellation'}));expect(await screen.findByRole('alert')).toHaveTextContent('Latest booking loaded');expect(screen.queryByRole('button',{name:'Cancel booking'})).not.toBeInTheDocument()
})
it('opens a notification target and shows history without a cancellation action for a started session',async()=>{
 window.history.replaceState({},'','/?booking=1');mocks.get.mockResolvedValue({...detail,canCancel:false});render(<BookingPanel/>);await screen.findByRole('heading',{name:'Booking history'});expect(mocks.get).toHaveBeenCalledWith(1,mocks.token);expect(screen.queryByRole('button',{name:'Cancel booking'})).not.toBeInTheDocument()
})
it.each(['STUDENT','TUTOR'])('projects confirmed bookings on the %s shared calendar and refreshes the selected week',async role=>{
 render(<MyTimetable role={role}/>);await screen.findByRole('heading',{name:'My timetable'});fireEvent.change(screen.getByLabelText('Jump to week'),{target:{value:'2030-09-02'}});const calendar=screen.getByRole('region',{name:'My timetable'});await waitFor(()=>expect(within(calendar).getByRole('article')).toHaveTextContent('COMS booking'));expect(within(calendar).getByRole('article')).toHaveTextContent(role==='STUDENT'?'Tutor One':'Student One');fireEvent.click(within(calendar).getByRole('button',{name:'Next week'}));await waitFor(()=>expect(mocks.list.mock.calls.some(([q])=>q.startsAt === new Date('2030-09-09T00:00:00').toISOString())).toBe(true))
})
it('does not duplicate a cancellation during an in-flight response',async()=>{
 let finish;mocks.cancel.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));await open();fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));const button=within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm cancellation'});fireEvent.click(button);fireEvent.click(button);expect(mocks.cancel).toHaveBeenCalledOnce();finish({...detail,canCancel:false});await screen.findByText(/Booking cancelled/)
})

it('updates a notification detail target without remounting the timetable',async()=>{
 const view=render(<BookingPanel bookingId={1}/>);await screen.findByRole('heading',{name:'COMS — Computing'});mocks.get.mockResolvedValue({...detail,booking:{...booking,id:2,courseCode:'MATH',courseName:'Mathematics'}});view.rerender(<BookingPanel bookingId={2}/>);await screen.findByRole('heading',{name:'MATH — Mathematics'});expect(mocks.get).toHaveBeenLastCalledWith(2,mocks.token)
})
