// R11 browser-only R26 daily continuation from private FinMind minute vault.
// Day calendar cross-checked via INDEPENDENT TaiwanFuturesDaily dataset;
// this is not a TAIFEX official holiday-calendar certification, nor A-shadow/P40.
// Stops at first genuinely missing date, minute gap, roll ambiguity or partial day.
import {replayR26CompletedDays} from './r26-daily-continuation.mjs';
const validDate=x=>/^20\d{2}-\d{2}-\d{2}$/.test(x||'');
const clock=t=>t.slice(11,16);
const parse=t=>Date.parse(t.replace(' ','T')+'+08:00');
const okBar=b=>b&&validDate(b.timestamp_tpe?.slice(0,10))&&/^\d\d:\d\d:00$/.test(b.timestamp_tpe.slice(11))&&
  ['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)&&
  b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&/^20\d{2}(0[1-9]|1[0-2])$/.test(b.contract_date||'');
export function r26DayFromMinutes(date,raw,allowedContracts,nowMs=Date.now()){
 if(!validDate(date))throw Error('INVALID_DAY_DATE');
 const bars=raw.filter(b=>b.timestamp_tpe?.slice(0,10)===date&&clock(b.timestamp_tpe)>='08:45'&&clock(b.timestamp_tpe)<='13:45');
 if(!bars.length)return {ok:false,date,reason:'NO_TX_MINUTE_BARS_FOR_COMPLETED_DAY',bars:0};
 if(bars.some(b=>!okBar(b)))return {ok:false,date,reason:'INVALID_TX_MINUTE_OHLC'};
 const contracts=[...new Set(bars.map(b=>b.contract_date))];
 if(contracts.length!==1||!allowedContracts.includes(contracts[0]))
  return {ok:false,date,reason:'CONTRACT_ROLL_OR_MONTH_NOT_CONFIRMED',contract_candidates:contracts};
 bars.sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 const times=bars.map(b=>clock(b.timestamp_tpe));
 if(times[0]!=='08:45'||!['13:44','13:45'].includes(times.at(-1)))
   return {ok:false,date,reason:'DAY_OPEN_OR_CLOSE_MINUTE_MISSING',first:times[0],last:times.at(-1)};
 for(let i=1;i<bars.length;i++)if(parse(bars[i].timestamp_tpe)-parse(bars[i-1].timestamp_tpe)!==60000)
  return {ok:false,date,reason:'GAP_OR_DUPLICATE_BETWEEN_DAY_MINUTES',after:bars[i-1].timestamp_tpe,before:bars[i].timestamp_tpe};
 if(bars.length!==300&&bars.length!==301)
  return {ok:false,date,reason:'DAY_MINUTE_COUNT_NOT_300_OR_301',bars:bars.length};
 if(nowMs<Date.parse(date+'T13:46:00+08:00'))return {ok:false,date,reason:'DAY_NOT_FINISHED'};
 const bar={session:'day',date,open:bars[0].open,high:Math.max(...bars.map(x=>x.high)),
  low:Math.min(...bars.map(x=>x.low)),close:bars.at(-1).close,
  complete_verified:true,calendar_verified:true,contract_verified:true,
  roll_verified:true,source_gap:false,contract_date:contracts[0]};
 return {ok:true,date,bar,bars:bars.length,contract:contracts[0],source:'private FinMind minute vault',
  provider_daily_calendar_crosschecked:true,taifex_official_holiday_calendar_verified:false};
}
export function previewR26FromMinutes(seed,raw,independentDaily,nowMs=Date.now()){
 if(!seed?.asof_day||!Array.isArray(raw)||!independentDaily?.ok||
    independentDaily.source_type!=='provider_observed_days_not_official_holiday_calendar')
  return {ok:false,status:'BLOCKED',reason:'MISSING_CHECKPOINT_OR_INDEPENDENT_DAILY_REPORT',tradeable:false};
 const days=[...new Set(independentDaily.trading_days||[])].sort().filter(x=>x>seed.asof_day);
 if(!days.length)return {ok:false,status:'BLOCKED',reason:'NO_NEW_COMPLETED_TRADING_DAYS',tradeable:false};
 const calendar=[seed.asof_day,...days],selected=[],audit=[];
 for(const day of days){
  const s=r26DayFromMinutes(day,raw,independentDaily.contracts_by_day?.[day]||[],nowMs);
  if(!s.ok){
   const calc=replayR26CompletedDays(seed,selected,calendar);
   return {ok:false,status:'BLOCKED_AT_FIRST_MISSING_DAY',last_replayed:calc.last_asof,
    next_missing_day:day,reason:s.reason,details:s,
    daily_features:calc.daily_features,days_replayed:selected.length,
    calendar_provenance:independentDaily.source_type,tradeable:false,paper_only:true,
    missing:['ORIGINAL_P40_MINUTE_REPLAY','R26_A_SHADOW_REPLAY','TAIFEX_OFFICIAL_HOLIDAY_CALENDAR','BROKER_POSITION']};
  }
  selected.push(s.bar);audit.push({date:day,bars:s.bars,contract:s.contract});
 }
 const calc=replayR26CompletedDays(seed,selected,calendar);
 return {ok:true,status:'INDICATOR_REPLAY_ONLY',last_replayed:calc.last_asof,
  next_missing_day:null,daily_features:calc.daily_features,checkpoint:calc.checkpoint,
  days_replayed:calc.completed_days_replayed,audit,
  calendar_provenance:independentDaily.source_type,tradeable:false,paper_only:true,
  missing:['ORIGINAL_P40_MINUTE_REPLAY','R26_A_SHADOW_REPLAY','TAIFEX_OFFICIAL_HOLIDAY_CALENDAR','BROKER_POSITION']};
}
