import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/r11/index.html',import.meta.url),'utf8');
const start=html.indexOf('function accumulateSessionAudit(old,update){'),end=html.indexOf('\nasync function backfill(force=false){',start);
assert.ok(start>0&&end>start,'cumulative audit function present');
const accumulate=new Function(html.slice(start,end)+';return accumulateSessionAudit;')();
const session=(key,bars,complete=false,boundary=false)=>({contract:'202611',session_key:key,open_date:key.slice(6),bars,complete,boundary_partial:boundary});
test('new partial midnight boundary cannot overwrite fully saved historical night',()=>{
 const full=session('night:2026-10-22',840,true);
 const old={contract:'202611',start:'2026-10-22',end:'2026-11-09',sessions:[full],
  failed_dates:[],retrieved_at:'2026-11-09T00:00:00Z'};
 const update={contract:'202611',start:'2026-11-09',end:'2026-11-10',
  sessions:[session('night:2026-10-22',300,false,true),session('day:2026-11-09',300,true)],
  failed_dates:[],retrieved_at:'2026-11-10T00:00:00Z'};
 const actual=accumulate(old,update);
 assert.equal(actual.sessions.length,2);assert.equal(actual.sessions.find(x=>x.session_key===full.session_key).bars,840);
 assert.equal(actual.complete_sessions,2);assert.equal(actual.partial_sessions,0);
 assert.equal(actual.start,'2026-10-22');assert.equal(actual.end,'2026-11-10');
});
test('re-verified night full data upgrades an old 812/840 session',()=>{
 const previous=session('night:2026-10-27',812,false);
 const latest=session('night:2026-10-27',840,true);
 const a=accumulate({contract:'202611',start:'2026-10-22',end:'2026-11-06',sessions:[previous]},
 {contract:'202611',start:'2026-10-27',end:'2026-10-28',sessions:[latest]});
 assert.equal(a.sessions[0].bars,840);assert.equal(a.complete_sessions,1);assert.equal(a.partial_sessions,0);
});
test('browser waits for IndexedDB transaction commit and resumes recent days',()=>{
 assert.ok(html.includes('tx.oncomplete=()=>resolve(data)'));
 assert.ok(html.includes('prevDay(saved.end,2)'));
 assert.ok(html.includes("const vaultId=contract+':'+a+':'+b;"));
 assert.ok(html.includes('raw_bars:data'));
});
