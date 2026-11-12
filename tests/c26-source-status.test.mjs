import test from 'node:test';
import assert from 'node:assert/strict';
import {c26StatusRoute} from '../src/c26/status.mjs';
function fakeEnv(){
 return {SCAN_JOBS:{idFromName:n=>n,get:()=>({fetch:async request=>{
  if(new URL(request.url).pathname.endsWith('/refresh'))return Response.json({state:'queued',progress:{state:'queued',data_as_of:'2026-11-11'}});
  return Response.json({model_version:'FC23',market_as_of:'2026-11-11',data_as_of:'2026-11-11',sync_status:'blocked',lastError:{date:'2026-11-12',message:'FINMIND_TOKEN unavailable'},plan:{actions:[{side:'BUY',code:'1234'}]},orders:[{side:'BUY'}],snapshots:[{holdings:[{code:'1234'}]}]});
 }})}};
}
test('C26 source report cannot leak FC23 trade, position, or pretend to be ready',async()=>{
 const rsp=await c26StatusRoute(new Request('https://worker.test/api/c26/status'),fakeEnv());
 assert.equal(rsp.status,200);assert.equal(rsp.headers.get('X-C26-Plan-Ready'),'false');
 const body=await rsp.json();
 assert.equal(body.model_version,'C26');assert.equal(body.historical_as_of,'2026-10-27');
 assert.equal(body.latest_market_data_as_of,'2026-11-11');
 assert.equal(body.plan.readiness,'blocked');assert.deepEqual(body.plan.actions,[]);
 assert.equal(body.no_live_positions,true);assert.equal(body.no_broker_orders,true);
 assert.equal(body.data_requirements.frozen_python_engine,'archived_not_runnable_on_worker');
 assert.ok(!('orders' in body));assert.ok(!('snapshots' in body));
 assert.ok(!JSON.stringify(body).includes('1234'));
});
test('C26 refresh only schedules shared raw source refresh, never publishes C26 plan',async()=>{
 const rsp=await c26StatusRoute(new Request('https://worker.test/api/c26/refresh',{method:'POST'}),fakeEnv());
 const body=await rsp.json();assert.equal(body.refresh_market_only,true);
 assert.equal(body.plan.readiness,'blocked');assert.deepEqual(body.plan.actions,[]);
});
test('wrong HTTP method cannot trigger refresh or trade',async()=>{
 const rsp=await c26StatusRoute(new Request('https://worker.test/api/c26/refresh'),fakeEnv());assert.equal(rsp.status,405);
});