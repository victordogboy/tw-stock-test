import test from 'node:test';
import assert from 'node:assert/strict';
import {r26MarketRoute} from '../src/r26-market.mjs';
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
test('recent TAIFEX trade-date ZIP must bypass stale CDN Worker cache and never be cached for 24h',async()=>{
 const previous=globalThis.caches, calls={match:0,put:0,upstream:0};
 globalThis.caches={default:{
  async match(){calls.match++;return Response.json({stale:true})},
  async put(){calls.put++}
 }};
 try{
  const raw=new Uint8Array(150);raw.set([0x50,0x4b,0x03,0x04],0);
  const url='https://test.example/api/r26/official-zip?date='+day+'&contract=202611';
  const rsp=await r26MarketRoute(new Request(url),{},async()=>{
   calls.upstream++;return new Response(raw,{status:200});
  });
  assert.equal(rsp.status,200);assert.equal(rsp.headers.get('cache-control'),'no-store');
  assert.equal(rsp.headers.get('X-R26-Recent-Official'),'true');
  assert.equal(calls.upstream,1);assert.equal(calls.match,0);assert.equal(calls.put,0);
 }finally{globalThis.caches=previous}
});
test('older official ZIPs can still use immutable versioned cache',async()=>{
 const previous=globalThis.caches,calls={match:0,upstream:0};
 globalThis.caches={default:{
  async match(){calls.match++;return new Response(new Uint8Array([0x50,0x4b,0x03,0x04]))},
  async put(){}
 }};
 try{
  const oldDate=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const url='https://test.example/api/r26/official-zip?date='+oldDate+'&contract=202611';
  const rsp=await r26MarketRoute(new Request(url),{},async()=>{calls.upstream++;throw Error('should not fetch')});
  assert.equal(rsp.status,200);assert.equal(calls.match,1);assert.equal(calls.upstream,0);
 }finally{globalThis.caches=previous}
});