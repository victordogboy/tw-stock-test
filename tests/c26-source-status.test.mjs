import test from 'node:test';
import assert from 'node:assert/strict';
import {c26StatusRoute,isCurrentC26PaperPlan} from '../src/c26/status.mjs';
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
 assert.equal(body.execution_pipeline.python_forward_factor_rebuild,'not_published');
 assert.equal(body.execution_pipeline.python_forward_portfolio_replay,'not_published');
 assert.equal(body.execution_pipeline.source_refresh_does_not_execute_c26,true);
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
test('C26 status exposes sanitized EOD coverage only, never raw licensed FinMind records or trades',async()=>{
 const env=fakeEnv();
 env.ASSETS={fetch:async()=>Response.json({
  lock_id:'C26-EVENT-CORR-LOCK-20261112',live_plan_readiness:'BLOCKED',public_raw_data:false,
  state:'source_staged',full_market_last_verified:'2026-11-12',checked_at:'2026-11-12T17:30:54Z',
  staged_trade_dates:12,available_trade_dates:12,
  days:[{date:'2026-11-12',price_valid:232,missing_count:1,institutional_codes:232,source_errors:[]}],
  FINMIND_RAW_SENTINEL:'must-not-leak',token:'must-not-leak'
 })};
 const response=await c26StatusRoute(new Request('https://worker.test/api/c26/status'),env);
 assert.equal(response.status,200);
 const d=await response.json();
 assert.equal(d.forward_coverage.source_as_of,'2026-11-12');
 assert.equal(d.forward_coverage.latest_price_valid,232);
 assert.equal(d.forward_coverage.available_trade_dates,12);
 assert.equal(d.forward_coverage.raw_public,false);
 assert.equal(d.execution_pipeline.latest_completed_eod,'2026-11-12');
 assert.equal(d.execution_pipeline.eod_source.state,'verified_source_only');
 assert.equal(d.execution_pipeline.next_day_plan,'blocked');
 assert.equal(d.data_requirements.post_archive_ohlc,'raw_source_coverage_staged_feature_parity_pending');
 assert.equal(d.plan.readiness,'blocked');assert.deepEqual(d.plan.actions,[]);
 assert.equal(d.no_live_positions,true);
 assert.ok(!JSON.stringify(d).includes('must-not-leak'));
});

test('C26 paper plan expires at Taipei regular session close, no stale orders',()=>{
 assert.equal(isCurrentC26PaperPlan('2026-11-13','2026-11-13T08:44:59.000Z'),true);
 assert.equal(isCurrentC26PaperPlan('2026-11-13','2026-11-13T13:29:59.000Z'),true);
 assert.equal(isCurrentC26PaperPlan('2026-11-13','2026-11-13T13:30:00.000Z'),false);
 assert.equal(isCurrentC26PaperPlan('2026-11-13','2026-11-13T23:19:00.000Z'),false);
 assert.equal(isCurrentC26PaperPlan('2026-11-13','2026-11-16T08:00:00.000Z'),false);
 assert.equal(isCurrentC26PaperPlan('2026-11-16','2026-11-13T23:19:00.000Z'),true);
 assert.equal(isCurrentC26PaperPlan('garbage','2026-11-13T09:00:00.000Z'),false);
});
