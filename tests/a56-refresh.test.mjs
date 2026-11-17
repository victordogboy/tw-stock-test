import {test} from 'node:test';import assert from 'node:assert/strict';
import {A56RefreshState,a56RefreshRoute,refreshView} from '../src/c26/a56-refresh.mjs';
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


test('delayed queue reports the real wait without losing the pending request',()=>{
 const now=Date.parse('2026-11-17T16:48:00Z'),s={state:'queued',request_id:'keep',requested_at:'2026-11-17T07:25:00Z',phase:'queued'};
 const v=refreshView(s,now);assert.equal(v.delayed,true);assert.equal(v.state,'queued');assert.equal(v.request_id,'keep');assert.ok(v.wait_seconds>600);assert.ok(v.phase.includes('尚未接手'));assert.equal(s.phase,'queued');
 assert.equal(refreshView({...s,requested_at:new Date(now-30000).toISOString()},now).delayed,false);
});
test('running refresh exposes the exact workflow run for diagnosis',async()=>{
 const data=new Map(),service=new A56RefreshState({storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)}});
 const r=await service.fetch(new Request('https://test/a56-internal/begin',{method:'POST',body:JSON.stringify({run_id:'12345'})}));const s=await r.json();assert.equal(s.state,'running');assert.equal(s.workflow_url,'https://github.com/victordogboy/tw-stock-test/actions/runs/12345');
});
