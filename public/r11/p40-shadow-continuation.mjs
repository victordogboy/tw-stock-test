// Research-only P40/R26 A-shadow post-archive state continuation.
// DO NOT derive R26 A-shadow realized PnL from historical R26_pnl, a price return,
// P40 PnL, or R11 execution PnL. These four are different ledgers.
// No execution and no live R11 signal from this module.
import {replayP40Session} from './p40-shadow-engine.mjs';
export const VERSION='R11_P40_A_SHADOW_SESSION_STATE_CHAIN_20261110';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const dates=/^20\d{2}-\d{2}-\d{2}$/;
const months=/^20\d{2}(0[1-9]|1[0-2])$/;
const validState=s=>s&&[-1,0,1].includes(s.pos)&&finite(s.equity)&&finite(s.last_close)&&s.last_close>0&&months.test(String(s.last_contract||''))&&s.has_prior===true;
function clockValue(t){
 if(!/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(String(t||'')))return NaN;
 return Date.parse(t.replace(' ','T')+'+08:00');
}
const orderKey=s=>s.trade_date+'|'+(s.session==='night'?'0':'1');
export function continueOriginalShadowSessions(initial,sessionBatch){
 if(!initial||!dates.test(initial.asof_trade_date||'')||
    !validState(initial.p40)||!validState(initial.a_shadow)||
    !Array.isArray(initial.a_shadow_last4)||initial.a_shadow_last4.length!==4||
    !initial.a_shadow_last4.every(finite)||
    !Array.isArray(initial.p40_pnl_history)||initial.p40_pnl_history.length<60||
    !initial.p40_pnl_history.every(finite))
  return {ok:false,code:'UNVERIFIED_OR_INCOMPLETE_ORIGINAL_SHADOW_BOOTSTRAP',tradeable:false};
 if(!Array.isArray(sessionBatch))return {ok:false,code:'INVALID_SESSION_BATCH',tradeable:false};
 let p40={...initial.p40},shadow={...initial.a_shadow},
     last4=initial.a_shadow_last4.slice(),pnls=initial.p40_pnl_history.slice(),lastKey=initial.asof_trade_date+'|1';
 const results=[];
 for(let i=0;i<sessionBatch.length;i++){
  const s=sessionBatch[i],key=orderKey(s||{trade_date:'',session:''});
  const fail=(code,details='')=>({
    ok:false,status:'BLOCKED_AT_FIRST_UNVERIFIED_SESSION',code,details,
    stopped_index:i,stopped_at:s?.trade_date||null,
    completed_sessions:results.length,results,p40_checkpoint:p40,a_shadow_checkpoint:shadow,
    a_shadow_last4:last4,p40_pnl_history:pnls,tradeable:false,paper_only:true
  });
  if(!s||!dates.test(s.trade_date||'')||!['night','day'].includes(s.session)||
     key<=lastKey||!months.test(String(s.contract||'')))return fail('BAD_OR_OUT_OF_ORDER_TRADING_DATE_OR_CONTRACT');
  if(!(s.exchange_calendar_verified&&s.contract_roll_verified&&s.raw_minute_coverage_verified&&
       s.p40_levels_verified&&s.atr20_verified&&s.r26_core_verified&&
       s.r26_a_shadow_signal_verified&&s.upstream_completed_before_open))
    return fail('REQUIRED_INDEPENDENT_SOURCE_VERIFICATION_MISSING');
  if(![-1,0,1].includes(s.p40_signal)||![-1,0,1].includes(s.a_shadow_signal)||
     !finite(s.atr20)||s.atr20<=0||!Array.isArray(s.levels)||s.levels.length<2||
     !s.levels.every(v=>finite(v)&&v>0)||!Array.isArray(s.bars)||s.bars.length<2)
    return fail('INVALID_SIGNALS_LEVELS_ATR_OR_BAR_SET');
  // The shadow must not see any part of this session before signals were frozen.
  const first=clockValue(s.bars[0].timestamp_tpe),last=clockValue(s.bars.at(-1).timestamp_tpe),
        frozen=clockValue(s.signals_frozen_at_tpe);
  if(!Number.isFinite(first)||!Number.isFinite(last)||!Number.isFinite(frozen)||
     frozen>=first||first>=last||s.bars[0].timestamp_tpe> s.bars.at(-1).timestamp_tpe)
    return fail('LOOKAHEAD_OR_INVALID_SIGNAL_FREEZE_TIME');
  const compact=[];
  let previous=NaN;
  for(const b of s.bars){
    const t=clockValue(b?.timestamp_tpe);
    const vals=[b?.open,b?.high,b?.low,b?.close];
    if(!Number.isFinite(t)||t<=previous||vals.some(x=>!finite(x)||x<=0)||
       b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||
       (finite(b.volume)&&b.volume<0))
      return fail('UNSORTED_DUPLICATE_INVALID_OR_SYNTHETIC_OHLC');
    // Exact contiguous minutes required to prevent silent omission of stop triggers.
    if(Number.isFinite(previous)&&t-previous!==60000)
      return fail('GAP_BETWEEN_VERIFIED_MINUTES',b.timestamp_tpe);
    compact.push(vals);previous=t;
  }
  const common={session:s.session,contract:String(s.contract),atr:s.atr20,
    levels:s.levels,bars:compact,
    blocked:!!s.r26_blocked,entrygate:s.entrygate===true,
    signal_verified:true,bars_verified:true,contract_verified:true,
    calendar_verified:true,atr_verified:true,levels_verified:true};
  try{
    const nextP40=replayP40Session({...common,signal:s.p40_signal},p40,'P40');
    const nextShadow=replayP40Session({...common,signal:s.a_shadow_signal,blocked:false,entrygate:false},shadow,'A_SHADOW');
    p40=nextP40.state;shadow=nextShadow.state;
    pnls.push(nextP40.pnl);last4=[...last4.slice(1),nextShadow.pnl];
    results.push({trade_date:s.trade_date,session:s.session,contract:s.contract,
      p40_pnl:nextP40.pnl,p40_pos_end:p40.pos,p40_equity:p40.equity,
      a_shadow_pnl:nextShadow.pnl,a_shadow_pos_end:shadow.pos,a_shadow_equity:shadow.equity,
      first_minute:s.bars[0].timestamp_tpe,last_minute:s.bars.at(-1).timestamp_tpe,
      minutes:s.bars.length,tradeable:false,paper_only:true});
    lastKey=key;
  }catch(e){return fail('ORIGINAL_ENGINE_REJECTED_INPUT',String(e.message||e));}
 }
 return {ok:true,status:'REPLAYED_VERIFIED_SHADOW_STATES_ONLY',version:VERSION,
  sessions_replayed:results.length,results,p40_checkpoint:p40,
  a_shadow_checkpoint:shadow,a_shadow_last4:last4,
  p40_pnl_history:pnls,tradeable:false,paper_only:true,
  warning:'This replays only already verified R26 and P40 inputs; it does not generate the new R26 signal, original 50-day P40 levels, TAIFEX calendar, or broker holdings.'};
}
