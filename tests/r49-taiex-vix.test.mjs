import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCboeVixCsv,latestTaiwanVixByDay,taiexVixRoute} from '../src/taiex-vix.mjs';

test('Cboe CSV parses US market dates, close, invalid rows and sorts',()=>{
 const csv='DATE,OPEN,HIGH,LOW,CLOSE\n10/16/2026,18,20,15,17.54\n10/15/2026,17,19,15,16.2\n10/14/2026,0,0,0,-1\n';
 assert.deepEqual(parseCboeVixCsv(csv,'2026-10-15','2026-10-16'),[
  {date:'2026-10-15',value:16.2},{date:'2026-10-16',value:17.54}
 ]);
 assert.throws(()=>parseCboeVixCsv('date,x\n1,2','2026-01-01','2026-10-16'));
});

test('Taiwan intraday picks last valid daytime observation, never invents a close',()=>{
 const r=latestTaiwanVixByDay([
  {date:'2026-10-15',time:'09:00:00',vix:30},
  {date:'2026-10-15',time:'13:43:30',vix:23.2},
  {date:'2026-10-15',time:'14:00:00',vix:99},
  {date:'2026-10-15',time:'13:45:00',vix:22.81},
  {date:'2026-10-16',time:'13:45:00',vix:0},
 ],'2026-10-15','2026-10-16');
 assert.deepEqual(r,[{date:'2026-10-15',time:'13:45:00',value:22.81}]);
});

test('VIX endpoint enforces parameters and Taiwan sponsor credentials',async()=>{
 const a=await taiexVixRoute(new Request('https://foo.test/api/futures/taiex/vix?market=tw&start_date=2026-10-01&end_date=2026-10-05'));
 assert.equal(a.status,401);
 const b=await taiexVixRoute(new Request('https://foo.test/api/futures/taiex/vix?market=tw&start_date=2025-10-01&end_date=2025-10-05'));
 assert.equal(b.status,400);
 const c=await taiexVixRoute(new Request('https://foo.test/api/futures/taiex/vix?market=tw&start_date=2026-10-01&end_date=2026-10-31'));
 assert.equal(c.status,400);
});

test('VIX endpoint normalizes Cboe US daily CSV and reports provenance',async()=>{
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('DATE,OPEN,HIGH,LOW,CLOSE\n10/15/2026,18,20,16,18.30\n10/16/2026,16,21,14,19.50\n');
  const res=await taiexVixRoute(new Request('https://foo.test/api/futures/taiex/vix?market=us&start_date=2026-10-01&end_date=2026-10-19'));
  assert.equal(res.status,200);
  const p=await res.json();
  assert.equal(p.source,'Cboe VIX_History.csv');
  assert.deepEqual(p.data.map(x=>x.date),['2026-10-15','2026-10-16']);
 }finally{globalThis.fetch=saved;}
});

test('VIX endpoint reduces FinMind intraday rows to daily observation',async()=>{
 const saved=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   assert.match(String(url),/dataset=TaiwanOptionVix/);
   return Response.json({status:200,data:[
    {date:'2026-10-16',time:'09:00:00',vix:20},
    {date:'2026-10-16',time:'13:44:45',vix:18.52}
   ]});
  };
  const res=await taiexVixRoute(new Request('https://foo.test/api/futures/taiex/vix?market=tw&start_date=2026-10-15&end_date=2026-10-16',{headers:{Authorization:'Bearer testing'}}));
  assert.equal(res.status,200);
  const p=await res.json();
  assert.deepEqual(p.data,[{date:'2026-10-16',time:'13:44:45',value:18.52}]);
 }finally{globalThis.fetch=saved;}
});
