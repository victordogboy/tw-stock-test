// Causal continuation from 2,428 archived P40/R26 research states.
// The P40 ledger and R26 core/ A-shadow PnL are DIFFERENT processes.
// Historical seed must be supplied from a private local file, not a public GitHub asset.
// This module computes P193 weights from verified PRIOR sessions; it never trades.
import {auditR11Seed} from './seed-audit.mjs';
import {p193Weights} from './p193-weights.mjs';
export const CAUSAL_CHECKPOINT_VERSION='R11_ARCHIVE_P40_CONTINUATION_20261110';
const validDate=s=>/^20\d\d-\d\d-\d\d$/.test(s||'');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function nextR11P193Checkpoint(seed, daily, target){
 const audit=auditR11Seed(seed);
 if(!audit.ok)throw Error('ARCHIVED_P40_R26_SEED_NOT_VERIFIED:'+audit.errors.join(','));
 if(!daily||daily.verified_daily_ohlc!==true||!validDate(daily.asof_day)||
    !finite(daily.atr20)||daily.atr20<=0||!finite(daily.prevclose)||daily.prevclose<=0)
    throw Error('PREVIOUS_COMPLETED_DAY_ATR_OR_REFERENCE_MISSING');
 if(!target||!validDate(target.trade_date)||!['night','day'].includes(target.session))
   throw Error('INVALID_NEXT_TRADING_SESSION');
 const rows=seed.sessions,last=rows.at(-1),targetIndex=target.trade_date+'|'+target.session;
 if(daily.asof_day<last.date||daily.asof_day>=target.trade_date||
    target.trade_date<=last.date||rows.some(x=>x.date+'|'+x.session===targetIndex))
   throw Error('FUTURE_DATA_OR_NONMONOTONIC_ARCHIVE_EXTENSION');
 const weights=p193Weights(daily.atr20,target.session,
   rows.map(r=>r.p40_pnl),rows.map(r=>r.market_move));
 return {version:CAUSAL_CHECKPOINT_VERSION,status:'P193_WEIGHTS_CAUSALLY_RECONSTRUCTED',paper_only:true,tradeable:false,
   archived_sessions:rows.length,historic_cutoff:last.date,trade_date:target.trade_date,session:target.session,
   asof_day:daily.asof_day,atr20:daily.atr20,prior_session_reference_price:daily.prevclose,
   w:weights.w,h:weights.h,
   p40_source:'ORIGINAL_ARCHIVED_P40_PNL_NOT_R26_PNL',
   blockers:['ORIGINAL_P40_NEXT_SESSION_MINUTE_REPLAY','R26_A_SHADOW_NEXT_SESSION_REPLAY',
     'R26_CORE_SIGNAL_LIVE_PARITY','OFFICIAL_CALENDAR_AND_CONTRACT','BROKER_POSITION'],
   decision:'BLOCKED',entry:null,stop_loss:null,take_profit:null};
}
