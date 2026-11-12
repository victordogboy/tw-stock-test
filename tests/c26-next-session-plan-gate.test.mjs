import test from 'node:test';
import assert from 'node:assert/strict';
import {validateC26NextDayPlan,C26_ENGINE_SHA,C26_LOCK} from '../src/c26/live-plan-gate.mjs';
const source={
 state:'source_staged',
 full_market_last_verified:'2026-11-12',
 next_exchange_trade_date:'2026-11-13',
 checkpoint_ohlc_parity:{pass:true}
};
const dates=['2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03','2026-11-04',
 '2026-11-05','2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12'];
const valid=()=>({
 model_version:'C26',lock_id:C26_LOCK,simulator_sha256:C26_ENGINE_SHA,
 engine:'frozen_python_c26',strategy_source:'original_C26_LOCK',
 historical_replay:{days:1407,orders:1758,passed:true,net_return_pct:1720.495844396837,max_drawdown_pct:-17.989769234703846},
 signal_as_of:'2026-11-12',trade_date:'2026-11-13',
 forward_replay:{first_date:'2026-10-28',last_date:'2026-11-12',trading_days:12,verified_dates:[...dates],complete:true},
 factors:{full_parity:true,causal_previous_close:true},
 positions:{inventory_parity:true,cash_parity:true,holdings:[{stock_id:'2330',quantity:200}],cash_ntd:100000,equity_ntd:1000000},
 orders_frozen_same_day_check:true,
 transaction_cost_roundtrip_pct:0.5855,
 actions:[{action:'BUY',stock_id:'2330',signal_date:'2026-11-12',execute_date:'2026-11-13',order_type:'BUY_STOP_BREAKOUT',notional_ntd:120000,limit_or_stop_ntd:999}]
});
test('C26 T+1 plan rejected without true 12-day portfolio and factor parity',()=>{
 for(const [mutate,reason] of [
  [p=>p.forward_replay.complete=false,/forward replay/],
  [p=>p.factors.full_parity=false,/factor\/portfolio/],
  [p=>p.positions.inventory_parity=false,/factor\/portfolio/],
  [p=>p.orders_frozen_same_day_check=false,/factor\/portfolio/],
  [p=>p.engine='fc23',/borrowed/],
  [p=>p.simulator_sha256='wrong',/wrong frozen/],
  [p=>p.signal_as_of='2026-11-13',/signal or exchange/],
  [p=>p.actions[0].execute_date='2026-11-12',/misdated/],
  [p=>p.actions[0].notional_ntd=1000,/misdated/],
  [p=>p.transaction_cost_roundtrip_pct=.8855,/fees/],
  [p=>p.positions.holdings=Array.from({length:9},()=>({stock_id:'2330',quantity:1})),/fees/]
 ]){
  const p=valid();mutate(p);assert.match(validateC26NextDayPlan(p,source).reason,reason);
 }
});
test('C26 frozen verified plan is a paper plan, never an automated broker order',()=>{
 const result=validateC26NextDayPlan(valid(),source);
 assert.equal(result.ok,true);
 assert.equal(result.plan.readiness,'ready_for_manual_review');
 assert.equal(result.plan.live_trading_enabled,false);
 assert.equal(result.plan.broker_orders_submitted,false);
});
test('Missing or unverified upstream market data blocks any C26 plan',()=>{
 assert.equal(validateC26NextDayPlan(valid(),null).ok,false);
 assert.equal(validateC26NextDayPlan(valid(),{...source,checkpoint_ohlc_parity:{pass:false}}).ok,false);
});
