import test from 'node:test';import assert from 'node:assert/strict';
import {pendingR26OfficialDownloads,physicalFinMindDates} from '../public/r26-engine/backfill-plan.mjs';
const sessions=[
 {date:'2026-10-27',sid:0,key:'night:2026-10-22',start:'2026-10-22 15:00:00',complete:true},
 {date:'2026-10-27',sid:1,key:'day:2026-10-27',start:'2026-10-27 08:45:00',complete:true},
 {date:'2026-11-10',sid:0,key:'night:2026-11-09',start:'2026-11-09 15:00:00',complete:true},
 {date:'2026-11-10',sid:1,key:'day:2026-11-10',start:'2026-11-10 08:45:00',complete:true},
 {date:'2026-11-11',sid:0,key:'night:2026-11-10',start:'2026-11-10 15:00:00',complete:false}
];
test('official ZIP naming uses trade date while real night ticks retain physical date',()=>{
 const jobs=pendingR26OfficialDownloads(sessions,[]);
 assert.deepEqual(jobs.map(j=>j.date),['2026-10-27','2026-11-10']);
 assert.deepEqual(jobs.map(j=>j.contract),['202611','202611']);
 assert.deepEqual(jobs[0].sessions,['night:2026-10-22','day:2026-10-27']);
 assert.deepEqual(jobs[0].finmind_dates,['2026-10-22','2026-10-23','2026-10-27']);
 assert.deepEqual(jobs[1].finmind_dates,['2026-11-09','2026-11-10']);
});
test('verified official sessions do not trigger pointless re-download; intraday is not marked complete',()=>{
 const jobs=pendingR26OfficialDownloads(sessions,[{session_key:'night:2026-11-09',source:'TAIFEX official ticks'}]);
 assert.equal(jobs.length,2);
 assert.deepEqual(jobs[1].sessions,['day:2026-11-10']);
 assert.deepEqual(physicalFinMindDates('2026-11-11'),['2026-11-11','2026-11-12']);
});
