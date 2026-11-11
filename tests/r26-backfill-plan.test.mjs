import test from 'node:test';import assert from 'node:assert/strict';
import {pendingR26OfficialDownloads,physicalFinMindDates} from '../public/r26-engine/backfill-plan.mjs';
const sessions=[
 {date:'2026-10-30',sid:0,key:'night:2026-10-29',start:'2026-10-29 15:00:00',complete:true},
 {date:'2026-10-30',sid:1,key:'day:2026-10-30',start:'2026-10-30 08:45:00',complete:true},
 {date:'2026-11-02',sid:0,key:'night:2026-10-30',start:'2026-10-30 15:00:00',complete:true},
 {date:'2026-11-02',sid:1,key:'day:2026-11-02',start:'2026-11-02 08:45:00',complete:false}
];
test('night official ZIP fetches physical day, not the following trade date',()=>{
 const jobs=pendingR26OfficialDownloads(sessions,[]);
 assert.deepEqual(jobs.map(j=>j.date),['2026-10-29','2026-10-30']);
 assert.equal(jobs[0].contract,'202611');
 assert.deepEqual(jobs[0].sessions,['night:2026-10-29']);
 assert.deepEqual(jobs[1].sessions,['day:2026-10-30','night:2026-10-30']);
});
test('official nights are skipped and intraday/old months remain isolated',()=>{
 const jobs=pendingR26OfficialDownloads(sessions,[{session_key:'night:2026-10-29',source:'TAIFEX official ticks'}]);
 assert.equal(jobs.length,1);
 assert.equal(jobs[0].date,'2026-10-30');
 assert.deepEqual(physicalFinMindDates('2026-11-11'),['2026-11-11','2026-11-12']);
});
