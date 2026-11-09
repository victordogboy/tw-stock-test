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
test('phone merge retains two genuine missing minutes behind a 540-minute midnight boundary',()=>{
 const from=html.indexOf('function mergeBackfillChunks(chunks,contract,start,end){');
 const to=html.indexOf('// Browser-private raw minute cache.',from);
 assert.ok(from>0&&to>from);
 const merge=new Function('prevDay',html.slice(from,to)+';return mergeBackfillChunks;')((s,n)=>
  new Date(Date.parse(s+'T00:00:00Z')-n*86400000).toISOString().slice(0,10));
 const minute=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const raw=[];
 for(let m=0;m<300;m++)if(m!==2&&m!==100)raw.push({timestamp_tpe:'2026-10-23 '+minute(m)+':00',contract_date:'202611'});
 const chunk={contract:'202611',sessions:[{contract:'202611',session:'night',
  session_key:'night:2026-10-22',open_date:'2026-10-22',
  first_bar:'2026-10-23 00:00',last_bar:'2026-10-23 04:59',
  bars:298,expected_bars:840,concluded:true,first_bar_verified:false,
  last_bar_verified:true,open:30000,high:30002,low:29999,close:30001}],
  raw_bars:raw,source_contracts:['202611'],failed_dates:[]};
 const x=merge([chunk],'202611','2026-10-23','2026-10-23');
 assert.equal(x.sessions[0].boundary_missing_bars,540);
 assert.equal(x.sessions[0].source_missing_bars,2);
 assert.equal(x.sessions[0].source_gap,true);assert.equal(x.partial_sessions,1);
 assert.equal(x.sessions[0].missing_ranges[0].cause,'QUERY_BOUNDARY');
 assert.equal(x.sessions[0].missing_ranges[1].cause,'SOURCE_MISSING');
});
test('browser waits for IndexedDB transaction commit and resumes recent days',()=>{
 assert.ok(html.includes('tx.oncomplete=()=>resolve(data)'));
 assert.ok(html.includes('prevDay(saved.end,2)'));
 assert.ok(html.includes("const vaultId=contract+':'+a+':'+b;"));
 assert.ok(html.includes('raw_bars:data'));
});
