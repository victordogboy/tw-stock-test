import test from 'node:test';
import assert from 'node:assert/strict';
import {nextR11P193Checkpoint} from '../public/r11/causal-checkpoint.mjs';
function seed(){
 const rows=[],date0=Date.parse('2021-10-22T00:00:00Z');
 for(let i=0;i<2428;i++){
  const date=i>=2426?'2026-10-22':new Date(date0+Math.floor(i/2)*86400000).toISOString().slice(0,10);
  rows.push({i,date,session:i%2===0?'night':'day',atr20:200,core:1,
   p40_pnl:0,market_move:0,r26_pnl:1e6}); // intentionally different: R26 cannot contaminate P40
 }
 const last60=[...Array(30).fill(778/30),...Array(10).fill(1649/10),
   ...Array(5).fill(-1033/5),...Array(7).fill(-1704/7),...Array(8).fill(-1253.5/8)];
 for(let i=0;i<60;i++)rows[2428-60+i].market_move=last60[i];
 for(let i=0;i<15;i++)rows[2428-15+i].p40_pnl=i<10?-1768/10:-476.5/5;
 return {manifest:{schema:'R11_CAUSAL_SEED_V1',sessions:2428,verified_date_and_atr_alignment:true},sessions:rows};
}
const day={asof_day:'2026-10-22',atr20:795.45,prevclose:46272,verified_daily_ohlc:true};
test('2026-10-23 first session P193 frozen oracle: w0 night h+0.4, day h+0.1',()=>{
 const s=seed(),night=nextR11P193Checkpoint(s,day,{trade_date:'2026-10-23',session:'night'});
 const d=nextR11P193Checkpoint(s,day,{trade_date:'2026-10-23',session:'day'});
 assert.equal(night.w,0);assert.equal(night.h,0.4);
 assert.equal(d.w,0);assert.equal(d.h,0.1);
 assert.equal(night.archived_sessions,2428);assert.equal(night.atr20,795.45);
 assert.equal(night.prior_session_reference_price,46272);
 assert.equal(night.tradeable,false);assert.equal(night.entry,null);
 assert.equal(night.p40_source,'ORIGINAL_ARCHIVED_P40_PNL_NOT_R26_PNL');
});
test('missing daily verification, invalid seed or future ATR all fail closed',()=>{
 const s=seed(),target={trade_date:'2026-10-23',session:'night'};
 assert.throws(()=>nextR11P193Checkpoint(s,{...day,verified_daily_ohlc:false},target));
 assert.throws(()=>nextR11P193Checkpoint(s,{...day,asof_day:'2026-10-23'},target));
 assert.throws(()=>nextR11P193Checkpoint(s,day,{...target,trade_date:'2026-10-22'}));
 const broken=seed();broken.sessions[2427].p40_pnl='not-a-number';
 assert.throws(()=>nextR11P193Checkpoint(broken,day,target));
});
