import test from 'node:test';
import assert from 'node:assert/strict';
import {r26DayFromMinutes,previewR26FromMinutes} from '../public/r11/r26-phone-replay.mjs';
import checkpoint from '../public/r11/r26-daily-checkpoint-20261022.json' with {type:'json'};
const day='2026-10-23',contract='202611';
const b=(d,m,month=contract)=>({timestamp_tpe:d+' '+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')+':00',
  contract_date:month,open:46000,high:46080,low:45950,close:46020,volume:12});
const whole=(d=day)=>Array.from({length:300},(_,i)=>b(d,525+i));
const provider=(days=[day])=>({ok:true,source_type:'provider_observed_days_not_official_holiday_calendar',
  trading_days:days,contracts_by_day:Object.fromEntries(days.map(x=>[x,[contract]]))});
test('all 300 verified day K advance archived R26 EMA/RSI/ATR once, as paper-only',()=>{
 const raw=whole(),a=r26DayFromMinutes(day,raw,[contract],Date.parse('2026-10-23T14:00:00+08:00'));
 assert.equal(a.ok,true);assert.equal(a.bars,300);assert.equal(a.bar.open,46000);assert.equal(a.bar.high,46080);
 const x=previewR26FromMinutes(checkpoint,raw,provider(),Date.parse('2026-10-23T14:00:00+08:00'));
 assert.equal(x.ok,true);assert.equal(x.last_replayed,day);assert.equal(x.days_replayed,1);
 assert.equal(x.tradeable,false);assert.equal(x.daily_features.tradeable,false);
 const prior=checkpoint.last_ema_after_completed_day['20'];
 const expected=prior+(2/21)*(46020-prior);
 assert.ok(Math.abs(x.daily_features.ema20-expected)<1e-8);
 assert.equal(x.checkpoint.last_completed_day_close,46020);
 assert.equal(x.calendar_provenance,'provider_observed_days_not_official_holiday_calendar');
 assert.ok(x.missing.includes('R26_A_SHADOW_REPLAY'));
});
test('one genuinely absent minute blocks, never forward fills',()=>{
 const raw=whole().filter(x=>x.timestamp_tpe.slice(11,16)!=='10:30');
 const x=previewR26FromMinutes(checkpoint,raw,provider(),Date.parse('2026-10-23T14:00:00+08:00'));
 assert.equal(x.ok,false);assert.equal(x.last_replayed,'2026-10-22');
 assert.equal(x.next_missing_day,day);assert.equal(x.reason,'GAP_OR_DUPLICATE_BETWEEN_DAY_MINUTES');
 assert.equal(x.tradeable,false);
});
test('night minute cannot update R26 day, and unknown calendar/contract never unlocks',()=>{
 const x=previewR26FromMinutes(checkpoint,[b(day,900)],provider());
 assert.equal(x.ok,false);
 const n=previewR26FromMinutes(checkpoint,whole(),{...provider(),ok:false});
 assert.equal(n.tradeable,false);assert.equal(n.ok,false);
 const invalid=previewR26FromMinutes(checkpoint,whole(),{...provider(),contracts_by_day:{[day]:['202612']}});
 assert.equal(invalid.reason,'CONTRACT_ROLL_OR_MONTH_NOT_CONFIRMED');
});
test('when following day K missing, factor replay stops at exact first missing exchange date',()=>{
 const next='2026-10-26';
 const x=previewR26FromMinutes(checkpoint,whole(),provider([day,next]),Date.parse('2026-10-27T14:00:00+08:00'));
 assert.equal(x.ok,false);assert.equal(x.days_replayed,1);
 assert.equal(x.last_replayed,day);assert.equal(x.next_missing_day,next);
 assert.equal(x.reason,'NO_TX_MINUTE_BARS_FOR_COMPLETED_DAY');
});
test('unfinished current day is never marked complete',()=>{
 const r=r26DayFromMinutes(day,whole(),[contract],Date.parse('2026-10-23T12:00:00+08:00'));
 assert.equal(r.ok,false);assert.equal(r.reason,'DAY_NOT_FINISHED');
});
