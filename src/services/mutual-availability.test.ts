import { describe,expect,it } from 'vitest';
import { availableStarts,expandBusySlots,mergeIntervals,type BusySlot } from './mutual-availability.js';
const d=(v:string)=>new Date(v);
const window={startsAt:d('2030-09-02T08:00:00Z'),endsAt:d('2030-09-02T12:00:00Z')};
const slot=(extra:Partial<BusySlot>={}):BusySlot=>({...window,recurrence:null,recurrenceUntil:null,teachingBreaks:[],exceptions:[],...extra});
describe('shared availability recurrence and boundaries',()=>{
 it('merges overlapping and touching busy intervals without mutating inputs',()=>{
  const input=[{startsAt:d('2030-09-02T09:00Z'),endsAt:d('2030-09-02T10:00Z')},{startsAt:d('2030-09-02T08:00Z'),endsAt:d('2030-09-02T09:00Z')},{startsAt:d('2030-09-02T08:30Z'),endsAt:d('2030-09-02T09:30Z')}];
  expect(mergeIntervals(input)).toEqual([{startsAt:d('2030-09-02T08:00Z'),endsAt:d('2030-09-02T10:00Z')}]);expect(input[0]!.endsAt).toEqual(d('2030-09-02T10:00Z'));
 });
 it.each([15,60,180])('fits %i minute sessions exactly into a window and excludes past starts',minutes=>{
  const now=d('2030-09-02T07:59:59Z'), end=new Date(+window.startsAt+minutes*60000);
  expect(availableStarts([{...window,endsAt:end}],[],minutes,now).slots).toEqual([{...window,endsAt:end}]);
  expect(availableStarts([{...window,endsAt:end}],[],minutes,window.startsAt).slots).toEqual([]);
 });
 it('permits touching busy boundaries but excludes even partial overlap',()=>{
  const busy=[{startsAt:d('2030-09-02T09:00Z'),endsAt:d('2030-09-02T11:00Z')}];
  expect(availableStarts([window],busy,60,d('2030-09-01')).slots.map(x=>x.startsAt.toISOString())).toEqual(['2030-09-02T08:00:00.000Z','2030-09-02T11:00:00.000Z']);
  expect(availableStarts([window],[window],15,d('2030-09-01')).slots).toEqual([]);
 });
 it('limits results with an explicit truncation flag',()=>{
  expect(availableStarts([window],[],15,d('2030-09-01'),2)).toMatchObject({truncated:true,slots:[{startsAt:window.startsAt},{startsAt:d('2030-09-02T08:15Z')}]});
 });
 it.each(['WEEKLY','FORTNIGHTLY'])('expands %s from its anchor and respects expiry',recurrence=>{
  const query={startsAt:d('2030-09-16T00:00Z'),endsAt:d('2030-09-17T00:00Z')};
  expect(expandBusySlots([slot({recurrence})],query)).toHaveLength(1);
  expect(expandBusySlots([slot({recurrence,recurrenceUntil:d('2030-09-15T23:59Z')})],query)).toEqual([]);
  expect(expandBusySlots([slot({recurrence})],{startsAt:d('2030-08-01'),endsAt:d('2030-08-02')})).toEqual([]);
 });
 it('respects fortnightly off-weeks, term dates, teaching breaks and cancelled occurrences',()=>{
  const query={startsAt:d('2030-09-09T00:00Z'),endsAt:d('2030-09-10T00:00Z')};
  for(const extra of [{recurrence:'FORTNIGHTLY'},{recurrence:'WEEKLY',termEndsOn:'2030-09-08'},{recurrence:'WEEKLY',termStartsOn:'2030-09-10'},{recurrence:'WEEKLY',teachingBreaks:[{startsOn:'2030-09-09',endsOn:'2030-09-09'}]},{recurrence:'WEEKLY',exceptions:[{occurrenceDate:'2030-09-09',exceptionType:'CANCELLED'}]}]) expect(expandBusySlots([slot(extra)],query)).toEqual([]);
 });
 it('moves an occurrence into a different week without retaining its old time',()=>{
  const moved=slot({recurrence:'WEEKLY',exceptions:[{occurrenceDate:'2030-09-02',exceptionType:'MOVED',newStartsAt:'2030-09-10T08:00Z',newEndsAt:'2030-09-10T09:00Z'}]});
  expect(expandBusySlots([moved],window)).toEqual([]);
  expect(expandBusySlots([moved],{startsAt:d('2030-09-10'),endsAt:d('2030-09-11')})).toEqual([{startsAt:d('2030-09-10T08:00Z'),endsAt:d('2030-09-10T09:00Z')}]);
 });
});
