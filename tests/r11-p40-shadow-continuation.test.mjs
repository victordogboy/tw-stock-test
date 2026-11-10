import test from 'node:test';
import assert from 'node:assert/strict';
import {continueOriginalShadowSessions} from '../public/r11/p40-shadow-continuation.mjs';
const prior={
  asof_trade_date:'2026-10-22',
  p40:{pos:0,equity:71601,last_close:46272,last_contract:'202610',has_prior:true},
  a_shadow:{pos:0,equity:56098,last_close:46272,last_contract:'202610',has_prior:true},
  p40_pnl_history:Array(2428).fill(0),
  a_shadow_last4:[-50,20,-70,30]
};
function bars(openDate,session){
 const st=Date.parse(openDate+(session==='night'?'T15:00:00+08:00':'T08:45:00+08:00'));
 const n=session==='night'?840:300;
 return Array.from({length:n},(_,i)=>{
  const at=new Date(st+i*60000+8*3600000).toISOString().slice(0,19).replace('T',' ');
  return {timestamp_tpe:at,open:46272,high:46280,low:46260,close:46270,volume:2};
 });
}
function entry(date='2026-10-23',session='night',overrides={}){
 const physical=session==='night'?'2026-10-22':date;
 return {trade_date:date,session,contract:'202611',bars:bars(physical,session),levels:[46000,46100,46160,46200,46300,46400,46700],
  atr20:750,p40_signal:1,a_shadow_signal:0,r26_blocked:false,entrygate:false,
  signals_frozen_at_tpe:physical+(session==='night'?' 14:59:00':' 08:44:00'),
  exchange_calendar_verified:true,contract_roll_verified:true,raw_minute_coverage_verified:true,
  p40_levels_verified:true,atr20_verified:true,r26_core_verified:true,
  r26_a_shadow_signal_verified:true,upstream_completed_before_open:true,...overrides};
}
test('next first night and then day carry two INDEPENDENT ledgers through 1140 historical-style minutes',()=>{
 const result=continueOriginalShadowSessions(prior,[entry(),entry('2026-10-23','day')]);
 assert.equal(result.ok,true);
 assert.equal(result.sessions_replayed,2);
 assert.equal(result.results[0].minutes,840);
 assert.equal(result.results[1].minutes,300);
 assert.equal(result.p40_pnl_history.length,2430);
 assert.equal(result.a_shadow_last4.length,4);
 assert.equal(result.a_shadow_last4.at(-1),result.results[1].a_shadow_pnl);
 assert.equal(result.p40_checkpoint.equity,result.results[1].p40_equity);
 assert.equal(result.a_shadow_checkpoint.equity,result.results[1].a_shadow_equity);
 assert.equal(result.tradeable,false);
 assert.notEqual(result.results[0].p40_pnl,result.results[0].a_shadow_pnl);
});
test('no original A shadow bootstrap is an explicit blocker, never treated as P40 return',()=>{
 const broken={...prior,a_shadow_last4:undefined};
 const result=continueOriginalShadowSessions(broken,[entry()]);
 assert.equal(result.ok,false);
 assert.equal(result.code,'UNVERIFIED_OR_INCOMPLETE_ORIGINAL_SHADOW_BOOTSTRAP');
});
test('missing R26 preopen core or shadow verified signal stops BEFORE replay',()=>{
 const x=continueOriginalShadowSessions(prior,[entry('2026-10-23','night',{r26_a_shadow_signal_verified:false})]);
 assert.equal(x.ok,false);assert.equal(x.stopped_index,0);
 assert.equal(x.code,'REQUIRED_INDEPENDENT_SOURCE_VERIFICATION_MISSING');
 assert.equal(x.p40_checkpoint.equity,71601);
});
test('cannot use current session minute as a preopen signal',()=>{
 const x=continueOriginalShadowSessions(prior,[entry('2026-10-23','night',{signals_frozen_at_tpe:'2026-10-22 15:00:00'})]);
 assert.equal(x.code,'LOOKAHEAD_OR_INVALID_SIGNAL_FREEZE_TIME');
});
test('cannot skip day after first night even when next night has fresh K',()=>{
 const x=continueOriginalShadowSessions(prior,[entry(),entry('2026-10-24','night',
   {bars:bars('2026-10-23','night'),signals_frozen_at_tpe:'2026-10-23 14:59:00'})]);
 assert.equal(x.ok,false);assert.equal(x.completed_sessions,1);
 assert.equal(x.code,'MISSING_PRECEDING_DAY_OR_NIGHT_SESSION');
});
test('gap, duplicate or shortened minutes must NOT modify original P40/Shadow state',()=>{
 const damaged=entry();damaged.bars=damaged.bars.slice(0,839);
 const x=continueOriginalShadowSessions(prior,[damaged]);
 assert.equal(x.code,'FULL_EXCHANGE_SESSION_OPEN_CLOSE_COVERAGE_UNVERIFIED');
 const dup=entry();dup.bars[50]={...dup.bars[49]};
 const y=continueOriginalShadowSessions(prior,[dup]);
 assert.equal(y.code,'UNSORTED_DUPLICATE_INVALID_OR_SYNTHETIC_OHLC');
 assert.equal(y.completed_sessions,0);
});
test('month roll remains a DISTINCT prior-contract state, not silently reset to flat',()=>{
 const carry={...prior,p40:{...prior.p40,pos:1},a_shadow:{...prior.a_shadow,pos:-1}};
 const x=continueOriginalShadowSessions(carry,[entry('2026-10-23','night',{p40_signal:0,a_shadow_signal:0})]);
 assert.equal(x.ok,true);assert.equal(x.results.length,1);
 assert.ok(x.results[0].p40_equity<carry.p40.equity);
 assert.ok(x.results[0].a_shadow_equity<carry.a_shadow.equity);
});
