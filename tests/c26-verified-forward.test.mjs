import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {c26StatusRoute} from '../src/c26/status.mjs';
import {loadC26MonitorSnapshot} from '../public/r1494a/c26/inline-adapter.mjs';
const actualNow=Date.now;Date.now=()=>Date.parse('2026-11-13T00:00:00Z');after(()=>{Date.now=actualNow});
const read=p=>fs.readFileSync('public'+p);
const env={ASSETS:{fetch:async req=>{try{return new Response(read(new URL(req.url).pathname))}catch{return new Response('',{status:404})}}},SCAN_JOBS:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({market_as_of:'2026-11-12',sync_status:'current'})})}};
const plan=JSON.parse(read('/r1494a/c26/data/verified-next-day-plan.json'));
test('Published original C26 plan passes the real source calendar and cash/inventory gate',async()=>{
 const response=await c26StatusRoute(new Request('https://test/api/c26/status'),env);const body=await response.json();
 assert.equal(body.plan.readiness,'ready_for_manual_review');assert.equal(response.headers.get('X-C26-Plan-Ready'),'true');
 assert.equal(body.plan.signal_as_of,'2026-11-12');assert.equal(body.plan.trade_date,'2026-11-13');
 assert.equal(body.plan.factors.independent_forward_factors.passed,true);
 assert.deepEqual(body.plan.actions.map(x=>[x.stock_id,x.action]),[['2801','HOLD']]);
 assert.equal(body.plan.no_future_execution_prices,true);
});
test('Original monitor appends only hash-verified C26 results; corrupted data cannot create a plan',async()=>{
 const prior=globalThis.fetch;let corrupt=false;
 globalThis.fetch=async url=>{
  const path=new URL(url,'https://test').pathname;
  if(path==='/api/c26/status')return c26StatusRoute(new Request('https://test'+path),env);
  try{const raw=read(path);return new Response(corrupt&&path.endsWith('forward-replay.json')?Buffer.from('corrupted'):raw)}catch{return new Response('',{status:404})}
 };
 try{
  const d=await loadC26MonitorSnapshot({dates:[],curves:{old49:[],market:[]}});
  assert.equal(d.snapshots.length,1419);assert.equal(d.orders.length,1776);assert.equal(d.dates.at(-1),'2026-11-12');
  assert.equal(d.plan.readiness,'ready_for_manual_review');
  assert.equal(crypto.createHash('sha256').update(read('/r1494a/c26/data/forward-replay.json')).digest('hex'),plan.forward_asset_sha256);
  corrupt=true;const blocked=await loadC26MonitorSnapshot({dates:[],curves:{old49:[],market:[]}});
  assert.equal(blocked.plan.readiness,'blocked');assert.equal(blocked.snapshots.length,1407);
 }finally{globalThis.fetch=prior}
});
