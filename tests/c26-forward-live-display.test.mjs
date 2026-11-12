import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='public/r1494a/c26/';
const html=fs.readFileSync(root+'index.html','utf8');
const code=fs.readFileSync(root+'forward-live.mjs','utf8');
const plan=JSON.parse(fs.readFileSync(root+'data/verified-next-day-plan.json','utf8'));
const bytes=fs.readFileSync(root+'data/forward-replay.json');
const replay=JSON.parse(bytes);
test('C26 dedicated page has a separate current-model plan and cannot borrow FC23 orders',()=>{
 assert.match(html,/id="c26-current-plan"/);
 assert.match(html,/id="c26-current-heading"/);
 assert.match(html,/id="c26-current-holdings"/);
 assert.match(html,/id="c26-current-actions"/);
 assert.match(html,/src="\.\/forward-live\.mjs"/);
 assert.match(code,/\/api\/c26\/status/);
 assert.match(code,/sha256|SHA-256/i);
 assert.doesNotMatch(code,/\/api\/fc23|\/api\/r1494a/);
 assert.doesNotMatch(code,/localStorage\.setItem|FINMIND_TOKEN|submitOrder|brokerOrders/);
 assert.match(code,/plan\.trade_date<today/);
 assert.match(code,/status\.no_broker_orders!==true/);
});
test('C26 original Python 12-session forward ledger byte hash matches verified plan',()=>{
 assert.equal(plan.model_version,'C26');
 assert.equal(plan.engine,'frozen_python_c26');
 assert.equal(plan.historical_replay.days,1407);
 assert.equal(plan.historical_replay.orders,1758);
 assert.equal(plan.transaction_cost_roundtrip_pct,0.5855);
 assert.equal(plan.forward_asset_sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(replay.lock_id,plan.lock_id);
 assert.equal(replay.simulator_sha256,plan.simulator_sha256);
 assert.equal(replay.audited,true);
 assert.equal(replay.first_date,'2026-10-28');
 assert.equal(replay.last_date,plan.signal_as_of);
 assert.equal(replay.snapshots.length,plan.forward_replay.trading_days);
 assert.deepEqual(replay.verified_dates,plan.forward_replay.verified_dates);
 assert.ok(replay.orders.length>0);
 const latest=replay.snapshots.at(-1);
 assert.equal(latest.date,plan.signal_as_of);
 assert.ok(Math.abs(latest.nav*3000000-plan.positions.equity_ntd)<.02);
 assert.equal(latest.holdings.length,plan.positions.holdings.length);
 for(const h of plan.positions.holdings){
  const row=latest.holdings.find(x=>x.code===h.stock_id);
  assert.ok(row,h.stock_id);
  assert.ok(Math.abs(row.quantity*3000000-h.quantity)<.001,h.stock_id);
 }
});
test('C26 paper plan never submits broker orders or implies stop execution',()=>{
 assert.equal(plan.model_not_broker_account,true);
 assert.equal(plan.no_future_execution_prices,true);
 for(const a of plan.actions){
  assert.equal(a.signal_date,plan.signal_as_of);
  assert.equal(a.execute_date,plan.trade_date);
  if(a.action==='HOLD')assert.equal(a.stop_active,false);
 }
});
