// Reconstructed from archived R26 R7/R8/R9/R10/R13 startup.py, 2026-10-28.
// Direction signal ONLY. NO minute trade/fill computation or live order authorization.
// All feature inputs derive from completed daily/session observations; last four shadow
// P&Ls must come from the ORIGINAL A strategy, NOT price returns or R11 trades.
export const R26_CORE_VERSION='R26_CAUSAL_DIRECTION_STAGE1_20261110';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function tower3Update(previous,completedClose,prior3Highs,prior3Lows){
 if(![-1,0,1].includes(previous)||!finite(completedClose)||!Array.isArray(prior3Highs)||!Array.isArray(prior3Lows)||prior3Highs.length!==3||prior3Lows.length!==3||![...prior3Highs,...prior3Lows].every(finite))throw Error('INCOMPLETE_PREVIOUS_TOWER');
 if(completedClose>Math.max(...prior3Highs))return 1;
 if(completedClose<Math.min(...prior3Lows))return -1;
 return previous;
}
export function coreR26FromFeatures(f){
 if(!f||!['night','day'].includes(f.session))throw Error('BAD_SESSION');
 const needed=['atr20','prevclose','ema20','ema150','ema50','ema50slope3','mom3','mom5','mom10','prior_ret','rsi14','atr5over20','dist50','slope50','dd10','atr20slope','prior_benchmark_pnl'];
 for(const k of needed)if(!finite(f[k]))throw Error('MISSING_VERIFIED_R26_FEATURE_'+k.toUpperCase());
 if(f.atr20<=0||![-1,0,1].includes(f.prior_session_tower3)||!Array.isArray(f.shadow_last4)||f.shadow_last4.length!==4||!f.shadow_last4.every(finite))throw Error('MISSING_VERIFIED_PREVIOUS_SHADOW_OR_TOWER');
 const day=f.session==='day',night=!day,A=f.atr20;
 // model_core.py BASE_PARAM (20,150,band=.2), then its sequential overrides.
 const delt=f.ema20-f.ema150;
 let signal=delt>.2*A?1:delt<-.2*A?-1:0;
 if(f.prevclose>f.ema50&&f.ema50slope3>0&&f.mom5>0)signal=1;
 if(day&&f.prior_ret< -2)signal=-1;
 if(night&&f.mom3<-.5)signal=-1;
 if(night&&f.mom10< -2)signal=1;
 if(day&&f.rsi14>45)signal=1;
 if(day&&f.atr5over20<.9)signal=-1;
 if(signal===-1&&(f.mom10>.5||f.atr5over20<.8||Math.abs(f.mom10)<.15))signal=0;
 // r8_core.py R7: ordered overrides
 if(signal===0&&f.mom5>.5)signal=1;
 if(signal===-1&&night&&f.dist50>-1)signal=0;
 if(signal===1&&day&&f.rsi14<35)signal=0;
 if(signal===0&&night&&f.prior_ret< -1)signal=-1;
 if(signal===0&&night&&f.mom5<0&&f.prevclose<f.ema50)signal=-1;
 const r7=signal;
 // verify_r9_valve.py source A, then replay_r10.py *only long restoration*
 if(signal===1&&f.mom5>3)signal=0;
 if(signal===-1&&f.dd10< -4)signal=0;
 if(signal===-1&&f.atr20slope<-.1)signal=0;
 const A_signal=signal;
 const scoreLong=Number(f.slope50>.2)+Number(f.dist50>1.5)+Number(f.atr5over20>1.1)+Number(f.mom10>1);
 if(r7===1&&A_signal===0&&scoreLong>=3&&f.slope50>0&&f.dist50>.5&&f.atr5over20>.85&&f.mom5>0)signal=1;
 const r10=signal;
 const shortGuard=r10===-1&&f.atr5over20<.85&&f.dd10< -1.5;
 const bounce=f.prior_benchmark_pnl/A>.35&&f.dd10< -1.5;
 const add=r10===0&&bounce&&f.prior_session_tower3===1&&f.atr5over20>1&&!shortGuard;
 const raw_signal=add?1:r10;
 const q=f.shadow_last4;
 // "prev2" from original shadow A strategy, current & preceding two alarms.
 const alarm=(q[2]+q[3]<-750)||(q[1]+q[2]<-750)||(q[0]+q[1]<-750);
 const blocked=!add&&(alarm||shortGuard);
 return {version:R26_CORE_VERSION,paper_only:true,tradeable:false,raw_signal,
  core_signal:blocked?0:raw_signal,blocked,r7,A_signal,r10,add,short_guard:shortGuard,
  shadow_pause_alarm:alarm,regime_dd10:f.dd10< -1.5,scoreLong,
  warning:'Not yet verified as a complete R26 live engine: upstream daily indicators and A shadow replay must be independently validated.'};
}
