/** C26 source-readiness endpoint, NOT a port of frozen Python strategy.
 * Only publishes manual-review orders after strict frozen engine + forward replay
 * parity is externally attested; otherwise emits zero buy/sell signals.
 * Never reuses any FC23 or R1494-A position or strategy signal.
 */
import {fc23Stub} from '../fc23/service.mjs';
import {validateC26NextDayPlan} from './live-plan-gate.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-C26-Plan-Ready':'false','X-C26-Frozen-Lock':'C26-EVENT-CORR-LOCK-20261112'}});
const HIST='2026-10-27';
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
    expected_pool:233,staged_trade_dates:d.staged_trade_dates||0,available_trade_dates:d.available_trade_dates||0,
    latest_price_valid:last?.price_valid??null,latest_price_missing:last?.missing_count??null,
    latest_institutional_codes:last?.institutional_codes??null,latest_errors:last?.source_errors?.length??null,
    checkpoint_ohlc_parity:d.checkpoint_ohlc_parity||null,
    latest_missing_codes:d.latest_missing_codes||[],
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
     next_exchange_trade_date:forward.next_exchange_trade_date
    });
    if(checked.ok)publishedPlan=checked.plan;
    else planGate=checked.reason;
   }
  }catch{planGate='Failed to validate frozen C26 live-plan asset'}
 }
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
  data_requirements:{
   frozen_python_engine:'archived_not_runnable_on_worker',
   post_archive_ohlc:forward?.state==='source_staged'?'raw_source_coverage_staged_feature_parity_pending':'not_verified_for_c26',
   post_archive_three_institutional:forward?.state==='source_staged'?'raw_source_coverage_staged_feature_parity_pending':'not_verified_for_c26',
   post_archive_dynamic_peers:'not_verified_for_c26',
   post_archive_portfolio_state:'not_replayed',
   next_day_plan_engine_parity:'not_verified'
  },
  plan:publishedPlan||{readiness:'blocked',actions:[],signal_as_of:null,trade_date:forward?.next_exchange_trade_date||null,
   reason:'C26尚未以凍結原始引擎重算2026-10-28以後的盤後資料與持倉；禁止沿用FC23/R1494-A訊號。',plan_gate_error:planGate},
  no_live_positions:!publishedPlan,no_broker_orders:true,updated_at:new Date().toISOString()
 });
}