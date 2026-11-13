/** C26 source-readiness endpoint, NOT a port of frozen Python strategy.
 * Only publishes manual-review orders after strict frozen engine + forward replay
 * parity is externally attested; otherwise emits zero buy/sell signals.
 * Never reuses any FC23 or R1494-A position or strategy signal.
 */
import {fc23Stub} from '../fc23/service.mjs';
import {validateC26NextDayPlan} from './live-plan-gate.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-C26-Plan-Ready':data?.plan?.readiness==='ready_for_manual_review'?'true':'false','X-C26-Frozen-Lock':'C26-EVENT-CORR-LOCK-20261112'}});
const HIST='2026-10-27';
// A paper plan is no longer actionable after the Taiwan regular session ends.
 // It can remain in the archive, but must not pass the current T+1 trade gate.
export function isCurrentC26PaperPlan(tradeDate,taipeiIso){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(tradeDate||''))||
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(taipeiIso||'')))return false;
 const date=taipeiIso.slice(0,10),clock=taipeiIso.slice(11,16);
 return tradeDate>date||(tradeDate===date&&clock<'13:30');
}

// Read ONLY the sanitized GitHub Actions coverage report. Licensed FinMind
// raw price/chip records are never returned through this public API.
async function publicForwardCoverage(env){
 if(!env?.ASSETS?.fetch)return null;
 try{
  const response=await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/c26/data/forward-status.json'));
  if(!response.ok)return null;
  const d=await response.json();
  if(d.lock_id!=='C26-EVENT-CORR-LOCK-20261112'||d.live_plan_readiness!=='BLOCKED'||d.public_raw_data!==false)return null;
  const last=d.days?.filter(x=>x.date===d.full_market_last_verified).at(-1)||null;
  return {state:d.state,source_as_of:d.full_market_last_verified||null,checked_at:d.checked_at||null,
    next_exchange_trade_date:d.next_exchange_trade_date||null,
    days:(d.days||[]).map(x=>({date:x.date,state:x.state})),
    expected_pool:233,staged_trade_dates:d.staged_trade_dates||0,available_trade_dates:d.available_trade_dates||0,
    latest_price_valid:last?.price_valid??null,latest_price_missing:last?.missing_count??null,
    latest_institutional_codes:last?.institutional_codes??null,latest_errors:last?.source_errors?.length??null,
    checkpoint_ohlc_parity:d.checkpoint_ohlc_parity||null,
    latest_missing_codes:d.latest_missing_codes||[],
    private_storage_verified:d.private_storage_verified===true,
    private_storage_as_of:d.private_storage_verified===true?(d.private_storage_as_of||null):null,
    feature_parity:'NOT_VERIFIED',portfolio_replay:'NOT_REPLAYED',raw_public:false};
 }catch{return null}
}
export async function c26StatusRoute(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/c26/status','/api/c26/refresh'].includes(path))return json({error:'Unknown C26 path'},404);
 if(path.endsWith('/refresh')&&request.method!=='POST')return json({error:'POST required'},405);
 if(path.endsWith('/status')&&request.method!=='GET')return json({error:'GET required'},405);
 let upstream=null,err=null;
 const forward=await publicForwardCoverage(env);
 let publishedPlan=null,planGate='No fully validated frozen C26 forward plan published';
 if(forward?.next_exchange_trade_date&&env?.ASSETS?.fetch){
  try{
   const resp=await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/c26/data/verified-next-day-plan.json'));
   if(resp.ok){
    const checked=validateC26NextDayPlan(await resp.json(),{
     state:forward.state,checkpoint_ohlc_parity:forward.checkpoint_ohlc_parity,
     full_market_last_verified:forward.source_as_of,
     days:forward.days,
     next_exchange_trade_date:forward.next_exchange_trade_date
    });
    if(checked.ok&&isCurrentC26PaperPlan(checked.plan.trade_date,new Date(Date.now()+8*3600000).toISOString()))publishedPlan=checked.plan;
    else if(checked.ok)planGate='Published C26 paper plan has expired (Taiwan trading session ended or date passed)';
    else planGate=checked.reason;
   }
  }catch{planGate='Failed to validate frozen C26 live-plan asset'}
 }
 if(publishedPlan&&forward){forward.feature_parity='VERIFIED_C26_BOUNDARY_AND_FORWARD';forward.portfolio_replay='VERIFIED_THROUGH_'+publishedPlan.signal_as_of;}
 try{
  const endpoint=path.endsWith('/refresh')?'refresh':'snapshot';
  const method=endpoint==='refresh'?'POST':'GET';
  const response=await fc23Stub(env).fetch(new Request('https://fc23.internal/fc23/'+endpoint,{method}));
  if(!response.ok)throw Error('上游市場資料狀態 HTTP '+response.status);
  upstream=await response.json();
 }catch(e){err=String(e?.message||e)}
 const source=upstream?.progress||upstream||{}, sourceError=upstream?.lastError||upstream?.progress?.phase||err;
 const latestMarket=upstream?.market_as_of||upstream?.data_as_of||source.market_as_of||source.data_as_of||null;
 return json({
  model_version:'C26',lock_id:'C26-EVENT-CORR-LOCK-20261112',
  historical_as_of:HIST,source_status:err?'unavailable':source.state||upstream?.sync_status||'unknown',
  latest_market_data_as_of:latestMarket,source_error:sourceError||null,
  forward_coverage:forward,
  refresh_market_only:path.endsWith('/refresh'),
  execution_pipeline:{
   summary:publishedPlan?'verified_paper_plan':'source_ready_model_not_replayed',
   latest_completed_eod:forward?.source_as_of||null,
   frozen_historical_as_of:HIST,
   eod_source:{state:forward?.state==='source_staged'?'verified_source_only':'needs_source_review',
     available_dates:forward?.available_trade_dates||0,expected_pool:233,
     missing_codes:forward?.latest_missing_codes||[],
     halted_3714_not_a_source_failure:forward?.source_as_of>='2026-11-05'&&forward?.source_as_of<='2026-11-13'&&forward?.latest_missing_codes?.includes('3714')||false},
   private_source_persistence:forward?.private_storage_verified===true?'verified':'not_verified',
   frozen_python_historical_replay:'historical_verified_through_2026_10_27',
   python_forward_factor_rebuild:publishedPlan?'verified':'not_published',
   python_forward_portfolio_replay:publishedPlan?'verified':'not_published',
   next_day_plan:publishedPlan?'ready_for_manual_review':'blocked',
   source_refresh_does_not_execute_c26:true,
   next_required_action:publishedPlan?null:'在受控 Python 執行環境重建全部 C26 原始因子，接續2026-10-27持倉、現金及委託；通過逐日一致性後才發布隔日計畫',
  },
  data_requirements:{
   frozen_python_engine:publishedPlan?'verified_frozen_python_replay':'archived_not_runnable_on_worker',
   post_archive_ohlc:publishedPlan?'verified':forward?.state==='source_staged'?'raw_source_coverage_staged_feature_parity_pending':'not_verified_for_c26',
   post_archive_three_institutional:publishedPlan?'verified':forward?.state==='source_staged'?'raw_source_coverage_staged_feature_parity_pending':'not_verified_for_c26',
   post_archive_dynamic_peers:publishedPlan?'verified_original_C26_formula':'not_verified_for_c26',
   post_archive_portfolio_state:publishedPlan?'verified':'not_replayed',
   next_day_plan_engine_parity:publishedPlan?'verified':'not_verified'
  },
  plan:publishedPlan||{readiness:'blocked',actions:[],signal_as_of:null,trade_date:forward?.next_exchange_trade_date||null,
   reason:'C26尚未以凍結原始引擎重算2026-10-28以後的盤後資料與持倉；禁止沿用FC23/R1494-A訊號。',plan_gate_error:planGate},
  no_live_positions:!publishedPlan,no_broker_orders:true,updated_at:new Date().toISOString()
 });
}
