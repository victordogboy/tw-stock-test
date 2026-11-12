import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSession} from '../public/r26-engine/session-status.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const now=Date.parse('2026-11-12T19:31:00+08:00');
const day={key:'day:2026-11-12',date:'2026-11-12',sid:1,
  start:'2026-11-12 08:45:00',end:'2026-11-12 13:45:00'};
const tpe=(m)=>new Date(Date.parse(day.start.replace(' ','T')+'+08:00')+m*60000+8*3600000).toISOString().slice(0,19).replace('T',' ');
const row=(timestamp,source='Yahoo WTXX6')=>({timestamp_tpe:timestamp,session_key:day.key,contract_date:'202611',
 contract_verified:true,source,open:43200,high:43205,low:43195,close:43202});
const yahoo289=Array.from({length:289},(_,i)=>row(tpe(i)));
test('Nov12 19:31: 289 bars ending 13:33 means 11 missing closing minutes; do not confirm paper position',()=>{
 const x=assessSession(day,yahoo289,now);
 assert.equal(x.marketState,'closed');assert.equal(x.dataState,'unverified');assert.equal(x.dataReady,false);
 assert.equal(x.count,289);assert.equal(x.last,'2026-11-12 13:33:00');
 assert.equal(x.tailMissingMinutes,11);assert.equal(x.tailMissingFrom,'2026-11-12 13:34:00');
 assert.equal(x.expectedFinalBar,'2026-11-12 13:44:00');
 assert.match(x.label,/尾段缺 11 根分K/);assert.match(x.reason,/13:34–13:44/);
});
test('Do not silently call 300 Yahoo bars official: origin proof still required',()=>{
 const x=assessSession(day,Array.from({length:300},(_,i)=>row(tpe(i))),now);
 assert.equal(x.tailMissingMinutes,0);assert.equal(x.dataReady,false);
 assert.match(x.reason,/尚未通過整盤官方逐筆CRC核對/);
});
test('Verified 300-bar official day is accepted after 13:45, not earlier',()=>{
 const official=Array.from({length:300},(_,i)=>row(tpe(i),'TAIFEX official ticks'));
 const closed=assessSession(day,official,now);
 assert.equal(closed.dataReady,true);assert.equal(closed.dataState,'complete');
 assert.equal(closed.tailMissingMinutes,0);
 const before=assessSession(day,official,Date.parse('2026-11-12T13:33:30+08:00'));
 assert.equal(before.marketState,'trading');assert.equal(before.dataReady,true);
});
test('Night of Nov12 belongs to Nov13, stays open at 19:31, not reported as a missing closed session',()=>{
 const target=physicalSessions(['2026-11-12','2026-11-13'],'2026-11-11',now).at(-1);
 assert.equal(target.key,'night:2026-11-12');assert.equal(target.date,'2026-11-13');assert.equal(target.complete,false);
 const minutes=Array.from({length:271},(_,i)=>{const ms=Date.parse(target.start.replace(' ','T')+'+08:00')+60000*i;
  return {timestamp_tpe:new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' '),session_key:target.key,
   contract_date:'202611',contract_verified:true,source:'Yahoo WTXX6',open:43200,high:43205,low:43195,close:43202};
 });
 const state=assessSession(target,minutes,now);
 assert.equal(state.marketState,'trading');assert.equal(state.historicalMissing,false);
 assert.equal(state.dataState,'updating');assert.equal(state.tailMissingMinutes,0);
});
