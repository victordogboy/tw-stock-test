/** C26 source-readiness endpoint, not a port of the frozen Python strategy.
 * Never emits positions, buy/sell signals, prices or a readiness:true plan.
 * The source used for market freshness is only the shared upstream data ingest;
 * its FC23 strategy decisions are never read or copied into a C26 plan.
 */
import {fc23Stub} from '../fc23/service.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-C26-Plan-Ready':'false','X-C26-Frozen-Lock':'C26-EVENT-CORR-LOCK-20261112'}});
const HIST='2026-10-27';
export async function c26StatusRoute(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/c26/status','/api/c26/refresh'].includes(path))return json({error:'Unknown C26 path'},404);
 if(path.endsWith('/refresh')&&request.method!=='POST')return json({error:'POST required'},405);
 if(path.endsWith('/status')&&request.method!=='GET')return json({error:'GET required'},405);
 let upstream=null,err=null;
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
  refresh_market_only:path.endsWith('/refresh'),
  data_requirements:{
   frozen_python_engine:'archived_not_runnable_on_worker',
   post_archive_ohlc:'not_verified_for_c26',
   post_archive_three_institutional:'not_verified_for_c26',
   post_archive_dynamic_peers:'not_verified_for_c26',
   post_archive_portfolio_state:'not_replayed',
   next_day_plan_engine_parity:'not_verified'
  },
  plan:{readiness:'blocked',actions:[],signal_as_of:null,trade_date:null,
   reason:'C26尚未以凍結原始引擎重算2026-10-28以後的盤後資料與持倉；禁止沿用FC23/R1494-A訊號。'},
  no_live_positions:true,no_broker_orders:true,updated_at:new Date().toISOString()
 });
}