import assert from 'node:assert/strict';
import test from 'node:test';
import {r11PreopenRoute} from '../src/r11-preopen.mjs';
const request=(query='variant=RR',method='GET')=>new Request('https://worker.example/api/r11/preopen?'+query,{method});
test('R11 preopen returns BLOCKED with reasoned source coverage and no write capability',async()=>{
 let calls=0;
 const mock=async()=>{calls++;return Response.json({ok:true,contract:'202611',source:'Yahoo named monthly TX',source_time:'2026-11-08T08:00:00Z',data:[{contract_date:'202611',contract_verified:true,source_complete:true,session_key:'day:2026-11-06',timestamp_tpe:'2026-11-06 13:44',close:28001}]});};
 const r=await r11PreopenRoute(request('variant=RR&contract=202611'),{},mock),j=await r.json();
 assert.equal(r.status,200);assert.equal(j.status,'BLOCKED');assert.equal(j.tradeable,false);assert.equal(j.entry,null);assert.equal(j.durable_object_writes,0);
 assert.equal(j.source.ok,true);assert.equal(j.source.rows,1);assert.equal(j.source.completed_session_keys,1);assert.equal(j.requirements.length,8);assert.equal(calls,1);
});
test('invalid contract or strategy never reaches provider',async()=>{
 let calls=0;const mock=async()=>{calls++;throw Error('should not fetch');};
 for(const q of ['variant=BAD&contract=202611','variant=RR&contract=202613']){
  const r=await r11PreopenRoute(request(q),{},mock);assert.equal(r.status,400);assert.equal((await r.json()).tradeable,false);
 }
 assert.equal(calls,0);
});
test('provider errors fail closed and preserve diagnostics',async()=>{
 const r=await r11PreopenRoute(request('variant=MAX&contract=202611'),{},async()=>Response.json({ok:false,error:'Provider missing bars'}, {status:502}));
 const j=await r.json();assert.equal(r.status,200);assert.equal(j.status,'BLOCKED');assert.equal(j.source.ok,false);assert.match(j.source.reason,/Provider missing bars/);assert.equal(j.tradeable,false);
});
test('wrong contract and incomplete bar cannot satisfy coverage',async()=>{
 const r=await r11PreopenRoute(request('variant=RR&contract=202611'),{},async()=>Response.json({ok:true,contract:'202611',data:[{contract_date:'202612',contract_verified:true,source_complete:true,close:28000,session_key:'day:2026-11-08'},{contract_date:'202611',contract_verified:true,source_complete:false,close:28000,session_key:'day:2026-11-07'}]}));
 const j=await r.json();assert.equal(j.source.rows,2);assert.equal(j.source.completed_session_keys,0);assert.equal(j.tradeable,false);
});
test('POST method rejected',async()=>{const r=await r11PreopenRoute(request('variant=RR','POST'));assert.equal(r.status,405);assert.equal((await r.json()).tradeable,false);});
