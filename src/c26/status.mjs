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
 let publishedPlan=null,modelArchive=null,planGate='No fully validated frozen C26 forward plan published';
 if(env?.ASSETS?.fetch){
  try{
   const resp=await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/c26/data/verified-next-day-plan.json'));
   if(resp.ok){
    const saved=await resp.json();
    // Check the previously published model independently of today's source date.
    // An expired plan must never erase an intact, already verified inventory.
    const archiveCheck=validateC26NextDayPlan(saved,{
     state:'source_staged',checkpoint_ohlc_parity:{pass:true},
     full_market_last_verified:saved.signal_as_of,next_exchange_trade_date:saved.trade_date,
     days:(saved.forward_replay?.verified_dates||[]).map(date=>({date,state:'available'}))
    });
    if(archiveCheck.ok&&/^[a-f0-9]{64}$/.test(saved.forward_asset_sha256||'')){
     const ledgerRsp=await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/c26/data/forward-replay.json'));
     if(!ledgerRsp.ok)throw Error('Verified C26 ledger asset unavailable');
     const bytes=await ledgerRsp.arrayBuffer();
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
     const ledger=JSON.parse(new TextDecoder().decode(bytes));
     if(hash!==saved.forward_asset_sha256||ledger.lock_id!==saved.lock_id||ledger.audited!==true||ledger.last_date!==saved.signal_as_of||JSON.stringify(ledger.verified_dates)!==JSON.stringify(saved.forward_replay.verified_dates)||ledger.snapshots?.length!==saved.forward_replay.trading_days||Math.abs(ledger.snapshots.at(-1).nav*3000000-saved.positions.equity_ntd)>.01)throw Error('Verified C26 ledger integrity mismatch');
     modelArchive={as_of:saved.signal_as_of,asset_sha256:hash,verified_dates:ledger.verified_dates,
      trading_days:ledger.snapshots.length,additional_order_rows:ledger.orders.length,equity_ntd:saved.positions.equity_ntd,
      model_not_broker_account:true};
    }
    const checked=validateC26NextDayPlan(saved,forward?{
     state:forward.state,checkpoint_ohlc_parity:forward.checkpoint_ohlc_parity,
     full_market_last_verified:forward.source_as_of,days:forward.days,
     next_exchange_trade_date:forward.next_exchange_trade_date
    }:null);
    if(checked.ok&&modelArchive&&isCurrentC26PaperPlan(checked.plan.trade_date,new Date(Date.now()+8*3600000).toISOString()))publishedPlan=checked.plan;
    else if(checked.ok)planGate=modelArchive?'Published C26 paper plan has expired (Taiwan trading session ended or date passed)':'Verified C26 model ledger unavailable';
    else planGate=checked.reason;
   }
  }catch{planGate='Failed to validate frozen C26 model/plan asset'}
 }
 if(modelArchive&&forward){
  forward.portfolio_replay='VERIFIED_THROUGH_'+modelArchive.as_of;
  if(modelArchive.as_of===forward.source_as_of)forward.feature_parity='VERIFIED_C26_BOUNDARY_AND_FORWARD';
 }
 try{
  const endpoint=path.endsWith('/refresh')?'refresh':'snapshot';
  const method=endpoint==='refresh'?'POST':'GET';
  const response=await fc23Stub(env).fetch(new Request('https://fc23.internal/fc23/'+endpoint,{method}));
  if(!response.ok)throw Error('上游市場資料狀態 HTTP '+response.status);
  upstream=await response.json();
 }catch(e){err=String(e?.message||e)}
 const source=upstream?.progress||upstream||{}, sourceError=upstream?.lastError||upstream?.progress?.phase||err;
 // C26's verified source must not inherit the independent FC23 feed error.
 const ownSourceVerified=forward?.state==='source_staged'&&forward.private_storage_verified===true&&
   forward.latest_price_valid>=230&&forward.source_as_of;
 const sharedMarket=upstream?.market_as_of||upstream?.data_as_of||source.market_as_of||source.data_as_of||null;
 const latestMarket=ownSourceVerified?forward.source_as_of:sharedMarket;
 return json({
  model_version:'C26',lock_id:'C26-EVENT-CORR-LOCK-20261112',
  historical_as_of:HIST,source_status:ownSourceVerified?'source_staged':err?'unavailable':source.state||upstream?.sync_status||'unknown',
  latest_market_data_as_of:latestMarket,source_error:ownSourceVerified?null:sourceError||null,
  shared_fc23_market_as_of:sharedMarket,shared_fc23_sync_status:err?'unavailable':source.state||upstream?.sync_status||'unknown',
  shared_fc23_error:sourceError||null,
  forward_coverage:forward,model_archive:modelArchive,
  archived_plan:modelArchive?{signal_as_of:modelArchive.as_of,trade_date:forward?.next_exchange_trade_date||null,
    verified:true,not_current_trading_order:!publishedPlan}:null,
  refresh_market_only:path.endsWith('/refresh'),
  execution_pipeline:{
   summary:publishedPlan?'verified_paper_plan':modelArchive?'verified_model_plan_pending':'source_ready_model_not_replayed',
   latest_completed_eod:forward?.source_as_of||null,
   frozen_historical_as_of:HIST,
   eod_source:{state:forward?.state==='source_staged'?'verified_source_only':'needs_source_review',
     available_dates:forward?.available_trade_dates||0,expected_pool:233,
     missing_codes:forward?.latest_missing_codes||[],
     halted_3714_not_a_source_failure:forward?.source_as_of>='2026-11-05'&&forward?.source_as_of<='2026-11-13'&&forward?.latest_missing_codes?.includes('3714')||false},
   private_source_persistence:forward?.private_storage_verified===true?'verified':'not_verified',
   frozen_python_historical_replay:'historical_verified_through_2026_10_27',
   python_forward_factor_rebuild:publishedPlan?'verified':'not_published',
   python_forward_portfolio_replay:modelArchive?'verified_through_'+modelArchive.as_of:'not_published',
   next_day_plan:publishedPlan?'ready_for_manual_review':'blocked',
   source_refresh_does_not_execute_c26:true,
   automatic_original_engine_replay:true,
   automatic_replay_taipei:['交易日21:50','交易日07:30'],
   next_required_action:publishedPlan?null:'等待自動排程完成原C26重播與對帳；保留最後已驗證持倉，不沿用過期委託',
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
   reason:modelArchive?'模型持倉已核對至 '+modelArchive.as_of+'；最新盤前計畫待自動重播，不沿用過期委託。':'C26原引擎資料尚未完成驗證；暫不發布新委託。',plan_gate_error:planGate},
  no_live_positions:!modelArchive,no_broker_orders:true,updated_at:new Date().toISOString()
 });
}
