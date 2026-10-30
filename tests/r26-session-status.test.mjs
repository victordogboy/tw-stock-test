import test from 'node:test';import assert from 'node:assert/strict';
import {physicalSessions} from '../public/r26-engine/live.mjs';
import {assessSession,positionPublication} from '../public/r26-engine/session-status.mjs';
const now=s=>Date.parse(s+'+08:00');
const row=(timestamp_tpe,key,source='TAIFEX official ticks')=>({timestamp_tpe,session_key:key,contract_date:'202611',contract_verified:true,open:46000,high:46010,low:45990,close:46001,source});
const day={key:'day:2026-10-30',date:'2026-10-30',sid:1,start:'2026-10-30 08:45:00',end:'2026-10-30 13:45:00'};
const night=physicalSessions(['2026-10-30','2026-11-02'],'2026-10-29',now('2026-10-31T02:23:00')).at(-1);
test('13:44 beginning bar completes the day at 13:45; old closed timestamps are not stale',()=>{
 const s=assessSession(day,[row('2026-10-30 08:45:00',day.key),row('2026-10-30 13:44:00',day.key)],now('2026-10-31T02:23:00'));
 assert.equal(s.marketState,'closed');assert.equal(s.dataState,'complete');assert.equal(s.lastBarEndsAt,'2026-10-30 13:45:00');assert.equal(s.dataReady,true);
});
test('Friday night remains trading on Saturday 02:23 and belongs to Monday Nov02',()=>{
 assert.equal(night.date,'2026-11-02');assert.equal(night.start,'2026-10-30 15:00:00');assert.equal(night.end,'2026-10-31 05:00:00');
 const s=assessSession(night,[row(night.start,night.key,'Yahoo WTXX6'),row('2026-10-31 02:22:00',night.key,'Yahoo WTXX6')],now('2026-10-31T02:23:00'));
 assert.equal(s.dataState,'updating');assert.equal(s.historicalMissing,false);assert.equal(s.dataReady,true);
});
test('no current night bars is pending live data, never a missing closed session before 05:00',()=>{
 const s=assessSession(night,[],now('2026-10-31T02:23:00'));assert.equal(s.marketState,'trading');assert.equal(s.dataState,'pending');assert.equal(s.historicalMissing,false);assert.equal(s.dataReady,false);
 const closed=assessSession(night,[],now('2026-10-31T05:00:00'));assert.equal(closed.marketState,'closed');assert.equal(closed.dataState,'missing');assert.equal(closed.historicalMissing,true);
});
test('04:59 is a complete final night candle at 05:00 with official proof',()=>{
 const s=assessSession(night,[row(night.start,night.key),row('2026-10-31 04:59:00',night.key)],now('2026-10-31T05:00:00'));
 assert.equal(s.dataState,'complete');assert.equal(s.lastBarEndsAt,'2026-10-31 05:00:00');
});
test('unverified closed data is not claimed to be proven missing or complete',()=>{
 const s=assessSession(day,[row(day.start,day.key,'FinMind TaiwanFuturesKBar'),row('2026-10-30 13:44:00',day.key,'FinMind TaiwanFuturesKBar')],now('2026-10-30T14:00:00'));
 assert.equal(s.dataState,'unverified');assert.equal(s.historicalMissing,false);assert.equal(s.dataReady,false);
});
test('position publication independently blocks instructions on unknown position or closed market',()=>{
 assert.deepEqual(positionPublication(false,[{marketState:'trading',dataReady:true}]),{positionConfirmed:false,signalAllowed:false,positionStatus:'unknown'});
 assert.equal(positionPublication(true,[{marketState:'closed',dataReady:true}]).signalAllowed,false);
 assert.equal(positionPublication(true,[{marketState:'trading',dataReady:true}]).signalAllowed,true);
});
