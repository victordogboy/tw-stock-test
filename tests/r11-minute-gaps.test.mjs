import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRows,r11BackfillRoute} from '../src/r11-backfill.mjs';
const bar=(date,minute,contract='202611')=>({date,minute,futures_id:'TX',contract_date:contract,open:30000,high:30002,low:29999,close:30001,volume:2});
const tm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')+':00';
test('midnight window left boundary is not a real source gap',()=>{
 const rows=[];for(let i=0;i<300;i++)rows.push(bar('2026-10-23',tm(i)));
 const a=summarizeRows(rows,'2026-10-23','2026-10-23','202611',Date.parse('2026-10-24T08:00:00+08:00'));
 assert.equal(a.sessions.length,1);
 const x=a.sessions[0];assert.equal(x.session_key,'night:2026-10-22');
 assert.equal(x.bars,300);assert.equal(x.missing_bars,540);assert.equal(x.boundary_partial,true);
 assert.equal(x.gap_cause,'QUERY_START_BOUNDARY');assert.equal(x.source_gap,false);
 assert.equal(a.boundary_sessions,1);assert.equal(a.partial_sessions,0);
 assert.equal(x.missing_ranges[0].start,'2026-10-22 15:00');
 assert.equal(x.missing_ranges[0].end,'2026-10-22 23:59');
});
test('298 of 840 on query-start midnight means 540 boundary minutes AND 2 real missing',()=>{
 const rows=[];
 for(let m=0;m<300;m++)if(m!==2&&m!==100)rows.push(bar('2026-10-23',tm(m)));
 const a=summarizeRows(rows,'2026-10-23','2026-10-23','202611',Date.parse('2026-10-24T08:00:00+08:00'));
 const x=a.sessions[0];
 assert.equal(x.bars,298);assert.equal(x.missing_bars,542);
 assert.equal(x.boundary_missing_bars,540);assert.equal(x.source_missing_bars,2);
 assert.equal(x.source_gap,true);assert.equal(x.boundary_partial,true);
 assert.equal(x.gap_cause,'QUERY_BOUNDARY_AND_SOURCE_GAP');
 assert.equal(x.missing_ranges[0].cause,'QUERY_BOUNDARY');
 assert.equal(x.missing_ranges[1].cause,'SOURCE_MISSING');
 assert.equal(a.partial_sessions,1);assert.equal(a.boundary_sessions,1);
});
test('single genuine missing minute is pinpointed without inventing a bar',()=>{
 const rows=[];
 for(let m=525;m<825;m++)if(m!==630)rows.push(bar('2026-10-23',tm(m)));
 const a=summarizeRows(rows,'2026-10-23','2026-10-23','202611',Date.parse('2026-10-24T08:00:00+08:00'));
 assert.equal(a.sessions[0].missing_bars,1);
 assert.equal(a.sessions[0].gap_cause,'SOURCE_MINUTES_MISSING');
 assert.equal(a.sessions[0].missing_ranges[0].start,'2026-10-23 10:30');
 assert.equal(a.sessions[0].missing_ranges[0].end,'2026-10-23 10:30');
 assert.equal(a.sessions[0].source_gap,true);
});
test('night split across physical dates is complete once both sides exist',()=>{
 const rows=[];
 for(let m=900;m<1440;m++)rows.push(bar('2026-10-22',tm(m)));
 for(let m=0;m<300;m++)rows.push(bar('2026-10-23',tm(m)));
 const a=summarizeRows(rows,'2026-10-22','2026-10-23','202611',Date.parse('2026-10-24T08:00:00+08:00'));
 assert.equal(a.complete_sessions,1);assert.equal(a.partial_sessions,0);
 assert.equal(a.sessions[0].missing_bars,0);assert.equal(a.sessions[0].source_gap,false);
});
test('mode=bars sends requested contract only for browser-private storage',async()=>{
 const req=new Request('https://api.test/api/r11/backfill?start=2026-10-23&end=2026-10-23&contract=202611&mode=bars',{headers:{authorization:'Bearer test-private'}});
 const fixture=[bar('2026-10-23','08:45:00'),bar('2026-10-23','08:45:00','202612')];
 const resp=await r11BackfillRoute(req,{},async()=>Response.json({status:200,data:fixture}));
 const body=await resp.json();
 assert.equal(resp.status,200);assert.equal(body.mode,'bars');
 assert.equal(body.raw_bars.length,1);assert.equal(body.raw_bars[0].contract_date,'202611');
 assert.equal(body.raw_bars[0].timestamp_tpe,'2026-10-23 08:45:00');
 assert.equal(body.durable_object_writes,0);assert.equal(body.tradeable,false);
 assert.ok(!JSON.stringify(body).includes('test-private'));
});
test('invalid mode rejects before any provider calls',async()=>{
 const req=new Request('https://api.test/api/r11/backfill?start=2026-10-23&end=2026-10-23&contract=202611&mode=execute');
 const r=await r11BackfillRoute(req,{},async()=>{throw Error('should not call');});
 assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_MODE');
});
