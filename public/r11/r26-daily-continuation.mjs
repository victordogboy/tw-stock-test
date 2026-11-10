// R11/R26 day-state continuation. The initial state is a frozen replay of the
// original canonical R26 minute archive. Update only after a fully verified
// completed DAY; never feed a current session, a night bar or a guessed holiday.
// A prior-day EMA/ATR/RSI feature state does NOT authorize R26 core until the
// original R26 A-shadow PnL, tower3 and prior benchmark PnL are reconstructed.
import {appendVerifiedCompletedDay,r26DailyPreopenFeatures,validateR26DailyState} from './r26-daily-features.mjs';
export const R11_R26_DAY_CONTINUATION_VERSION='20261110-r26-verified-day-sequential';
const exact=(date,days)=>days.includes(date);
export function replayR26CompletedDays(seed,verifiedDayBars,officialCalendar){
 validateR26DailyState(seed);
 if(seed.asof_day<'2026-10-22')throw Error('R26_STATE_OLDER_THAN_FROZEN_RESEARCH_CUTOFF');
 if(!Array.isArray(officialCalendar)||!officialCalendar.length||
    officialCalendar.some((d,i)=>!/^20\d{2}-\d{2}-\d{2}$/.test(d)||(i&&d<=officialCalendar[i-1])))
   throw Error('OFFICIAL_SORTED_EXCHANGE_CALENDAR_REQUIRED');
 if(!exact(seed.asof_day,officialCalendar))throw Error('SEED_DAY_NOT_IN_EXCHANGE_CALENDAR');
 if(!Array.isArray(verifiedDayBars))throw Error('COMPLETED_DAY_BARS_REQUIRED');
 let checkpoint=structuredClone(seed);
 const audits=[],before=checkpoint.asof_day;
 const futureDays=officialCalendar.filter(day=>day>before),used=new Set();
 for(const bar of verifiedDayBars){
  if(!bar||bar.session!=='day'||bar.complete_verified!==true||
     bar.calendar_verified!==true||bar.contract_verified!==true||
     bar.source_gap===true||bar.roll_verified!==true)
   throw Error('NEW_DAY_FAILED_EXCHANGE_CONTRACT_OR_KBAR_COVERAGE');
  if(!exact(bar.date,officialCalendar)||used.has(bar.date))
   throw Error('UNKNOWN_OR_DUPLICATE_EXCHANGE_DAY');
  const expected=futureDays[audits.length];
  if(bar.date!==expected)throw Error('MISSING_PREVIOUS_TRADING_DAY_BEFORE_'+bar.date);
  const prior=checkpoint.asof_day;
  checkpoint=appendVerifiedCompletedDay(checkpoint,bar);
  used.add(bar.date);
  const factors=r26DailyPreopenFeatures(checkpoint);
  audits.push({prior_asof:prior,asof:checkpoint.asof_day,atr20:factors.atr20,prevclose:factors.prevclose,
   ema20:factors.ema20,ema50:factors.ema50,ema150:factors.ema150,rsi14:factors.rsi14,
   paper_only:true,tradeable:false});
 }
 return {version:R11_R26_DAY_CONTINUATION_VERSION,checkpoint,completed_days_replayed:audits.length,audits,
  last_asof:checkpoint.asof_day,next_expected_exchange_date:futureDays[audits.length]||null,
  daily_features:r26DailyPreopenFeatures(checkpoint),paper_only:true,tradeable:false,
  blocker:'R26 original A-shadow/benchmark/tower and P40 minute pnl still lack verified continuation'};
}
