import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {c26StatusRoute} from '../src/c26/status.mjs';
import {loadC26MonitorSnapshot} from '../public/r1494a/c26/inline-adapter.mjs';
const actualNow=Date.now;after(()=>{Date.now=actualNow});
const read=p=>fs.readFileSync('public'+p);
const env={ASSETS:{fetch:async req=>{try{return new Response(read(new URL(req.url).pathname))}catch{return new Response('',{status:404})}}},SCAN_JOBS:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({market_as_of:'2026-11-12',sync_status:'current'})})}};
const plan=JSON.parse(read('/r1494a/c26/data/verified-next-day-plan.json'));
const ledger=JSON.parse(read('/r1494a/c26/data/forward-replay.json'));
const before=()=>Date.parse(plan.trade_date+'T00:00:00Z');
Date.now=before;
test('Published original C26 plan passes the real source calendar and cash/inventory gate',async()=>{
 const response=await c26StatusRoute(new Request('https://test/api/c26/status'),env);const body=await response.json();
 assert.equal(body.plan.readiness,'ready_for_manual_review');assert.equal(response.headers.get('X-C26-Plan-Ready'),'true');
 assert.equal(body.plan.signal_as_of,plan.signal_as_of);assert.equal(body.plan.trade_date,plan.trade_date);
 assert.equal(body.plan.factors.independent_forward_factors.passed,true);
 assert.deepEqual(body.plan.actions,plan.actions);
 assert.ok(body.plan.actions.every(x=>x.execute_date===plan.trade_date));
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
  assert.equal(d.snapshots.length,1407+ledger.snapshots.length);assert.equal(d.orders.length,1758+ledger.orders.length);assert.equal(d.dates.at(-1),plan.signal_as_of);
  assert.equal(d.plan.readiness,'ready_for_manual_review');assert.equal(d.status.sync_status,'current');assert.equal(d.status.lastError,null);
  assert.equal(crypto.createHash('sha256').update(read('/r1494a/c26/data/forward-replay.json')).digest('hex'),plan.forward_asset_sha256);
  corrupt=true;const blocked=await loadC26MonitorSnapshot({dates:[],curves:{old49:[],market:[]}});
  assert.equal(blocked.plan.readiness,'blocked');assert.equal(blocked.snapshots.length,1407);
 }finally{globalThis.fetch=prior}
});

test('Expired paper plan never erases verified inventory, and never exposes stale orders',async()=>{
 const prior=globalThis.fetch;
 Date.now=()=>Date.parse(plan.trade_date+'T06:00:00Z'); // 14:00 Taipei: plan expired
 globalThis.fetch=async url=>{
  const path=new URL(url,'https://test').pathname;
  if(path==='/api/c26/status')return c26StatusRoute(new Request('https://test'+path),env);
  try{return new Response(read(path))}catch{return new Response('',{status:404})}
 };
 try{
  const state=await c26StatusRoute(new Request('https://test/api/c26/status'),env).then(r=>r.json());
  assert.equal(state.plan.readiness,'blocked');assert.deepEqual(state.plan.actions,[]);
  assert.equal(state.model_archive.as_of,plan.signal_as_of);
  const d=await loadC26MonitorSnapshot({dates:[],curves:{old49:[],market:[]}});
  assert.equal(d.dates.at(-1),plan.signal_as_of);
  assert.equal(d.snapshots.length,1407+ledger.snapshots.length);
  assert.equal(d.status.sync_status,'model_pending');
  assert.equal(d.plan.readiness,'blocked');assert.deepEqual(d.plan.actions,[]);
  assert.deepEqual(d.snapshots.at(-1).holdings.map(h=>h.code),ledger.snapshots.at(-1).holdings.map(h=>h.code));
 }finally{Date.now=before;globalThis.fetch=prior}
});
