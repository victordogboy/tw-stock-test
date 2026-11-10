// Next-session direction from completed observations only; no fabricated current K.
import {r26DailyPreopenFeatures} from './r26-daily-features.mjs';
import {coreR26FromFeatures,tower3Update} from './r26-core-replay.mjs';
export function nextCoreState(result,target){
 const ss=result.sessions,days=ss.filter(s=>s.sid===1),last=ss.at(-1),d=days.at(-1);
 if(!last||!d||!target||!['day','night'].includes(target.session))throw Error('INVALID_NEXT_SESSION');
 if(!(last.sid===0?target.session==='day'&&target.trade_date===last.date:target.session==='night'&&target.trade_date>last.date))throw Error('NEXT_SESSION_NOT_ADJACENT');
 if(d.date>=target.trade_date||days.length<150)throw Error('INCOMPLETE_CAUSAL_DAILY_HISTORY');
 const ema={'20':days[0].cl,'50':days[0].cl,'150':days[0].cl},e50=[],tr=[];
 let gain=0,loss=0;
 for(let i=0;i<days.length;i++){
  const x=days[i],prev=i?days[i-1].cl:x.op;
  tr.push(Math.max(x.hi-x.lo,Math.abs(x.hi-prev),Math.abs(x.lo-prev)));
  if(i){const delta=x.cl-prev;gain=i===1?Math.max(delta,0):(13*gain+Math.max(delta,0))/14;loss=i===1?Math.max(-delta,0):(13*loss+Math.max(-delta,0))/14;
   for(const n of [20,50,150])ema[n]=x.cl*2/(n+1)+ema[n]*(1-2/(n+1));}
  e50.push(ema['50']);
 }
 const daily=r26DailyPreopenFeatures({asof_day:d.date,last_completed_day_close:d.cl,last_30_tr:tr.slice(-30),last_12_daily_close:days.slice(-12).map(s=>s.cl),last_10_high:days.slice(-10).map(s=>s.hi),last_4_ema50_after_day:e50.slice(-4),last_ema_after_completed_day:ema,rsi14_ewm_gain_asof:gain,rsi14_ewm_loss_asof:loss});
 const prior=ss.slice(-4,-1),tower=tower3Update(last.tower,last.cl,prior.map(s=>s.hi),prior.map(s=>s.lo));
 const shadow=result.shadow.rows.slice(-4);
 if(shadow.length!==4||shadow.at(-1).date!==last.date||shadow.at(-1).sid!==last.sid)throw Error('SHADOW_HISTORY_NOT_ALIGNED');
 const features={...daily,session:target.session,prior_benchmark_pnl:last.market,prior_session_tower3:tower,shadow_last4:shadow.map(r=>r.pnl)};
 return {trade_date:target.trade_date,session:target.session,completed_as_of:last.date+' '+(last.sid?'day':'night'),daily,features,core:coreR26FromFeatures(features),paper_only:true,tradeable:false};
}
