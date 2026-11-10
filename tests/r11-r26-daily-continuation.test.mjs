import test from 'node:test';
import assert from 'node:assert/strict';
import {replayR26CompletedDays} from '../public/r11/r26-daily-continuation.mjs';
import {r26DailyPreopenFeatures} from '../public/r11/r26-daily-features.mjs';
const seed={asof_day:'2026-09-30',last_completed_day_close:48330,
 last_ema_after_completed_day:{'20':47084.10927570318,'50':45985.561484953214,'150':41833.15745202101},
 last_4_ema50_after_day:[45718.97716547125,45813.252570746896,45889.87011699212,45985.561484953214],
 last_30_tr:[907,785,674,728,683,949,1162,511,502,942,1237,1078,758,919,868,659,612,681,1090,916,452,635,959,1019,673,912,400,539,564,879],
 last_12_daily_close:[46218,45780,45607,46078,46445,47418,48077,48243,48336,48123,47767,48330],
 last_10_high:[45964,46242,47037,47464,48091,48946,48623,48275,48194,48646],
 rsi14_ewm_gain_asof:296.7101006910294,rsi14_ewm_loss_asof:177.56986435406765};
const data=[
 ['2026-10-01',48398,48719,48168,48685],['2026-10-02',48552,48802,48472,48671],
 ['2026-10-05',49470,50097,49461,49949],['2026-10-06',50180,50194,49720,50060],
 ['2026-10-07',50050,50117,49842,49979],['2026-10-08',49480,49692,49333,49349],
 ['2026-10-12',48975,49594,48910,49309],['2026-10-13',48606,48793,48240,48400],
 ['2026-10-14',48789,49200,48650,48792],['2026-10-15',47716,47720,46883,46979],
 ['2026-10-16',47228,47634,47140,47242],['2026-10-19',46627,46902,46390,46779],
 ['2026-10-20',46434,46920,46162,46384],['2026-10-21',47388,47450,46872,46992],
 ['2026-10-22',47164,47337,46217,46272]];
const calendar=['2026-09-30',...data.map(x=>x[0])];
const bars=data.map(([date,open,high,low,close])=>({date,open,high,low,close,
 session:'day',complete_verified:true,calendar_verified:true,contract_verified:true,roll_verified:true,source_gap:false}));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-11,label+': got '+a+' expected '+b);
test('15 historical complete R26 day bars reconstruct true Pandas EWM/RSI and ATR checkpoint with zero future leakage',()=>{
 const x=replayR26CompletedDays(seed,bars,calendar),s=x.checkpoint,f=x.daily_features;
 assert.equal(x.completed_days_replayed,15);assert.equal(x.last_asof,'2026-10-22');
 assert.equal(x.tradeable,false);assert.equal(f.tradeable,false);
 assert.equal(s.last_completed_day_close,46272);
 for(const [k,v] of Object.entries({'20':47617.32419374793,'50':46922.50861666983,'150':42985.862831691375}))
  near(s.last_ema_after_completed_day[k],v,'ema'+k);
 near(s.rsi14_ewm_gain_asof,219.8748939011313,'RSI gain');
 near(s.rsi14_ewm_loss_asof,316.52636084133377,'RSI loss');
 near(f.atr20,795.45,'atr20');near(f.rsi14,40.99074936099598,'rsi14');
 near(f.ema50slope3,-.06008027496735847,'slope50');
 near(f.mom10,-4.660255201458294,'mom10');
 near(f.atr5over20,1.1191149663712363,'atr5over20');
 near(f.dist50,-.8177869340245535,'dist50');
 near(f.dd10,-4.299453139732226,'dd10');
 near(f.atr20slope,.13263562580094002,'atr20slope');
 assert.equal(x.audits.length,15);
 assert.equal(seed.asof_day,'2026-09-30','input seed immutable');
});
test('missing full completed prior exchange day is rejected rather than silently skipping',()=>{
 assert.throws(()=>replayR26CompletedDays(seed,[bars[1]],[calendar[0],...calendar.slice(1)]),/MISSING_PREVIOUS_TRADING_DAY/);
});
test('night, contract roll, future/invalid gap, and incomplete minute bar cannot update daily state',()=>{
 for(const key of ['complete_verified','calendar_verified','contract_verified','roll_verified']){
  assert.throws(()=>replayR26CompletedDays(seed,[{...bars[0],[key]:false}],calendar));
 }
 assert.throws(()=>replayR26CompletedDays(seed,[{...bars[0],session:'night'}],calendar));
 assert.throws(()=>replayR26CompletedDays(seed,[{...bars[0],source_gap:true}],calendar));
});
test('no unknown future exchange calendar should be silently inferred from current clock',()=>{
 assert.throws(()=>replayR26CompletedDays(seed,[bars[0]],['2026-09-30']),/UNKNOWN_OR_DUPLICATE_EXCHANGE_DAY/);
 assert.throws(()=>replayR26CompletedDays(seed,[bars[0]],['2026-10-01','2026-09-30']));
});
