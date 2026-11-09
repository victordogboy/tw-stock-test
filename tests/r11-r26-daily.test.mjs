import test from 'node:test';
import assert from 'node:assert/strict';
import {r26DailyPreopenFeatures,appendVerifiedCompletedDay} from '../public/r11/r26-daily-features.mjs';
// Exact rolling state reconstructed from ORIGINAL Python daily TX K, as of 2026-10-21,
// to compare next 2026-10-22 preopen features to the frozen original R26 startup.py.
const seed={asof_day:'2026-10-21',last_completed_day_close:46992,
 last_ema_after_completed_day:{'20':47758.937266774024,'50':46949.059988778805,'150':42941.75360795569},
 last_4_ema50_after_day:[46978.10761308211,46970.29947139262,46947.307335259575,46949.059988778805],
 last_30_tr:[868,659,612,681,1090,916,452,635,959,1019,673,912,400,539,564,879,551,330,1426,474,275,646,684,1069,800,1909,655,852,758,1066],
 last_12_daily_close:[49949,50060,49979,49349,49309,48400,48792,46979,47242,46779,46384,46992],
 last_10_high:[50117,49692,49594,48793,49200,47720,47634,46902,46920,47450],
 rsi14_ewm_gain_asof:236.78834727814137,rsi14_ewm_loss_asof:285.48992705989787};
const oracle={atr20:773.1,prevclose:46992,ema20:47758.937266774024,ema150:42941.75360795569,ema50:46949.059988778805,
 ema50slope3:-.037572919807663266,mom3:-.32337343163885657,mom5:-2.328288707799767,mom10:-3.9684387530720473,
 prior_ret:.7864441857456991,rsi14:45.33758322185716,atr5over20:1.3555814254300866,dist50:.05554263513283555,
 slope50:-.037572919807663266,dd10:-4.042167895485707,atr20slope:.05621968713709946};
test('Pandas original 2026-10-22 R26 daily preopen 16 factors exact',()=>{
 const r=r26DailyPreopenFeatures(seed);
 for(const [k,v] of Object.entries(oracle))assert.ok(Math.abs(r[k]-v)<1e-9,k+': '+r[k]+' vs '+v);
 assert.equal(r.daily_asof,'2026-10-21');assert.equal(r.tradeable,false);
});
test('2026-10-22 completed day appends EMA / day OHLC only after coverage+calendar verification',()=>{
 const next=appendVerifiedCompletedDay(seed,{session:'day',date:'2026-10-22',open:47164,high:47337,low:46217,close:46272,complete_verified:true,calendar_verified:true});
 assert.equal(next.last_completed_day_close,46272);assert.equal(next.asof_day,'2026-10-22');
 assert.ok(Math.abs(next.last_ema_after_completed_day['20']-47617.32419374793)<1e-8);
 assert.ok(Math.abs(next.last_ema_after_completed_day['50']-46922.50861666983)<1e-8);
 assert.ok(Math.abs(next.last_ema_after_completed_day['150']-42985.862831691375)<1e-8);
 assert.equal(next.last_30_tr.at(-1),1120);
 assert.equal(next.last_10_high.at(-1),47337);
 assert.equal(next.last_12_daily_close.at(-1),46272);
 assert.equal(next.last_4_ema50_after_day.at(-1),next.last_ema_after_completed_day['50']);
});
test('night K or unverified day must never contaminate completed-day indicators',()=>{
 assert.throws(()=>appendVerifiedCompletedDay(seed,{session:'night',date:'2026-10-22',open:47164,high:47337,low:46217,close:46272,complete_verified:true,calendar_verified:true}));
 assert.throws(()=>appendVerifiedCompletedDay(seed,{session:'day',date:'2026-10-22',open:47164,high:47337,low:46217,close:46272,complete_verified:false,calendar_verified:true}));
 assert.throws(()=>appendVerifiedCompletedDay(seed,{session:'day',date:'2026-10-22',open:47164,high:47337,low:46217,close:46272,complete_verified:true,calendar_verified:false}));
 assert.throws(()=>r26DailyPreopenFeatures({...seed,last_30_tr:[]}));
});
