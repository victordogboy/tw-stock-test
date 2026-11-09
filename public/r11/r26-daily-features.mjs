// R26 completed-day daily indicators, exact pandas/Numpy recurrence from original
// model_core.py, test_event.py, r8_core.py. Historical reference: 214 sessions,
// 3424 independent numeric comparisons to the frozen Python original (zero diff).
// Deterministic pure functions; NO present-session OHLC or broker order capability.
export const R26_DAY_VERSION='R26_DAILY_FACTOR_REPLAY_20261110';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const sum=a=>a.reduce((acc,x)=>acc+x,0);
const tail=(a,n)=>a.slice(-n);
export function validateR26DailyState(s){
 if(!s||!/^20\d\d-\d\d-\d\d$/.test(s.asof_day||''))throw Error('DAILY_ASOF_DATE_UNVERIFIED');
 if(!finite(s.last_completed_day_close)||s.last_completed_day_close<=0)throw Error('INVALID_PREVIOUS_DAILY_CLOSE');
 for(const [k,n] of [['last_30_tr',30],['last_12_daily_close',12],['last_10_high',10],['last_4_ema50_after_day',4]]){
  if(!Array.isArray(s[k])||s[k].length!==n||!s[k].every(v=>finite(v)&&v>0))throw Error('MISSING_COMPLETED_DAY_HISTORY_'+k);
 }
 for(const k of ['20','50','150'])if(!finite(s.last_ema_after_completed_day?.[k])||s.last_ema_after_completed_day[k]<=0)throw Error('MISSING_EMA_'+k);
 for(const k of ['rsi14_ewm_gain_asof','rsi14_ewm_loss_asof'])if(!finite(s[k])||s[k]<0)throw Error('MISSING_OR_INVALID_RSI_EWM');
 return true;
}
export function r26DailyPreopenFeatures(s){
 validateR26DailyState(s);
 const tr=s.last_30_tr,c=s.last_12_daily_close,A=sum(tail(tr,20))/20,P=c.at(-1);
 const ema20=s.last_ema_after_completed_day['20'],ema50=s.last_ema_after_completed_day['50'],ema150=s.last_ema_after_completed_day['150'];
 const slope50=(ema50-s.last_4_ema50_after_day[0])/A,dist50=(P-ema50)/A,
       g=s.rsi14_ewm_gain_asof,l=s.rsi14_ewm_loss_asof;
 return {version:R26_DAY_VERSION,paper_only:true,tradeable:false,daily_asof:s.asof_day,
  atr20:A,prevclose:P,ema20,ema50,ema150,ema50slope3:slope50,slope50,
  mom3:(P-c.at(-4))/A,mom5:(P-c.at(-6))/A,mom10:(P-c.at(-11))/A,
  prior_ret:(P-c.at(-2))/A,
  rsi14:100-100/(1+(g/(l+1e-9))),
  atr5over20:(sum(tail(tr,5))/5)/A,
  dist50,dd10:(P-Math.max(...s.last_10_high))/A,
  atr20slope:A/(sum(tr.slice(0,20))/20)-1};
}
// Advance ONLY after a separately verified full DAY session and calendar/contract.
// The R26 night session may update shadow/tower, but MUST NOT update daily EMA/TR.
export function appendVerifiedCompletedDay(s,bar){
 validateR26DailyState(s);
 if(!bar||bar.session!=='day'||bar.complete_verified!==true||bar.calendar_verified!==true)throw Error('NEW_DAY_NOT_VERIFIED_COMPLETED');
 if(!/^20\d\d-\d\d-\d\d$/.test(bar.date||'')||bar.date<=s.asof_day)throw Error('NEW_DAY_DATE_NOT_AFTER_ASOF');
 const o=Number(bar.open),h=Number(bar.high),l=Number(bar.low),c=Number(bar.close);
 if(![o,h,l,c].every(finite)||Math.min(o,h,l,c)<=0||h<Math.max(o,c)||l>Math.min(o,c))throw Error('INVALID_NEW_DAY_OHLC');
 const last=s.last_completed_day_close,delta=c-last,
  tr=Math.max(h-l,Math.abs(h-last),Math.abs(l-last)),
  gain=(13*s.rsi14_ewm_gain_asof+Math.max(delta,0))/14,
  loss=(13*s.rsi14_ewm_loss_asof+Math.max(-delta,0))/14;
 const em={...s.last_ema_after_completed_day};
 for(const n of [20,50,150]){const key=String(n);em[key]=em[key]+(2/(n+1))*(c-em[key]);}
 return {...s,asof_day:bar.date,last_completed_day_close:c,last_ema_after_completed_day:em,
  last_4_ema50_after_day:[...s.last_4_ema50_after_day.slice(1),em['50']],
  last_30_tr:[...s.last_30_tr.slice(1),tr],
  last_12_daily_close:[...s.last_12_daily_close.slice(1),c],
  last_10_high:[...s.last_10_high.slice(1),h],
  rsi14_ewm_gain_asof:gain,rsi14_ewm_loss_asof:loss};
}
