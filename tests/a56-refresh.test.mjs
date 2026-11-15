import {test} from 'node:test';import assert from 'node:assert/strict';
import {A56RefreshState,a56RefreshRoute} from '../src/c26/a56-refresh.mjs';
test('refresh requests deduplicate, retain progress and enforce completion generation',async()=>{
 const data=new Map(),service=new A56RefreshState({storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)}});
 const call=(action,body)=>service.fetch(new Request('https://test/a56-internal/'+action,{method:action==='status'?'GET':'POST',body:body&&JSON.stringify(body)})).then(async r=>({status:r.status,data:await r.json()}));
 const a=await call('request'),b=await call('request');assert.equal(a.data.request_id,b.data.request_id);
 assert.equal((await call('begin')).data.state,'running');assert.equal((await call('request')).data.state,'running');
 assert.equal((await call('finish',{request_id:'wrong',outcome:'success'})).status,409);
 assert.equal((await call('finish',{request_id:a.data.request_id,outcome:'success'})).data.state,'completed');
 assert.equal((await call('request')).data.state,'completed');
});
test('unauthenticated visitors cannot mark replay begin or success',async()=>{
 for(const action of ['begin','finish']){
  const r=await a56RefreshRoute(new Request('https://test/api/c26/a56/'+action,{method:'POST'}),{});assert.equal(r.status,403);
 }
 assert.equal((await a56RefreshRoute(new Request('https://test/api/c26/a56/refresh'),{})).status,405);
});
