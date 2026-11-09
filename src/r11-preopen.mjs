// R11 preopen coverage diagnostics: read-only, no Durable Object or account secrets.
// This endpoint is deliberately not a trading-signal engine; historical core P40/R26
// and broker holdings must be checked before any tradeable plan can be emitted.
import {r26MarketRoute} from './r26-market.mjs';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const ymd=d=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const validContract=s=>/^20\d{2}(0[1-9]|1[0-2])$/.test(String(s||''));
function isoTpe(d){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d).replace(' ','T')+'+08:00';}
export async function r11PreopenRoute(request,env={},marketRoute=r26MarketRoute){
 if(request.method!=='GET')return json({ok:false,status:'BLOCKED',tradeable:false,error:'Method not allowed'},405);
 const u=new URL(request.url),variant=u.searchParams.get('variant')||'RR';
 if(!['RR','MAX'].includes(variant))return json({ok:false,status:'BLOCKED',tradeable:false,error:'請選擇 RR 或 MAX'},400);
 const now=new Date(),localDate=ymd(now),candidate=u.searchParams.get('contract')||localDate.slice(0,4)+localDate.slice(5,7);
 if(!validContract(candidate))return json({ok:false,status:'BLOCKED',tradeable:false,error:'合約月份格式 YYYYMM'},400);
 const time=isoTpe(now),day=now.getUTCDay(),clock=time.slice(11,16),minute=Number(clock.slice(0,2))*60+Number(clock.slice(3,5));
 // Weekend/holiday status is NOT inferred solely from weekday. Exchange calendar is required.
 const weekend=day===0||day===6;
 const marketState=weekend?'週末：需要期交所交易日曆確認':minute<525?'夜盤尾聲／日盤前（仍須核對交易日）':minute<825?'日盤時間（仍須核對盤前時點）':minute<900?'日夜盤休息時間':minute<1440?'夜盤時間（仍須核對盤前時點）':'交易時間未知';
 const needs=[
  {id:'tx_120_completed_sessions',label:'至少120個已完成交易盤及合約連續性',ready:false},
  {id:'tx_1m_gap_and_roll',label:'跨週六分鐘K缺口、契約換月與連續資料稽核',ready:false},
  {id:'p40_ledger',label:'因果 P40 歷史持倉與前盤盈虧',ready:false},
  {id:'p193_w_h',label:'原 P193 w / h 逐盤重現',ready:false},
  {id:'r26_core_signal',label:'原 R26 core_signal 盤前重建',ready:false},
  {id:'broker_position',label:'券商實際 TX -1/0/+1 持倉',ready:false},
  {id:'exchange_calendar',label:'台灣期交所交易日曆與到期月份',ready:false},
  {id:'full_price_parity',label:'R11 完整歷史盤前計價核對',ready:false}
 ];
 let source={ok:false,reason:'named-contract 1m K 尚未查詢',rows:0,completed_session_keys:0,contract_candidate:candidate,contract_verified:false,age_seconds:null};
 try{
  const resp=await marketRoute(new Request(u.origin+'/api/r26/intraday?contract='+encodeURIComponent(candidate)),env);
  let body;try{body=await resp.json()}catch{body=null}
  if(resp.ok&&body?.ok===true&&body.contract===candidate&&Array.isArray(body.data)){
   const valid=body.data.filter(x=>x.contract_date===candidate&&x.contract_verified===true&&x.source_complete===true&&x.session_key&&Number.isFinite(Number(x.close)));
   const keys=[...new Set(valid.map(x=>x.session_key))];
   const newest=valid.length?valid.at(-1).timestamp_tpe:null;
   source={ok:true,reason:keys.length<120?'資料來源提供少於120個已驗證完整交易盤，不能取代前期完整特徵資料':'即使行情來源完整仍須核對 P40/R26、合約及持倉',
    rows:body.data.length,completed_bars:valid.length,completed_session_keys:keys.length,
    newest_completed_bar_tpe:newest,contract_candidate:candidate,
    contract_verified:true,provider:body.source||'Yahoo named monthly TX',
    upstream_as_of:body.source_time||null,retrieved_at:body.retrieved_at||null};
  }else source.reason='Yahoo 指定合約分K尚未可核實：'+String(body?.error||('HTTP '+resp.status)).slice(0,160);
 }catch(e){source.reason='Yahoo 指定合約分K暫時無法使用：'+String(e?.message||e).slice(0,140);}
 // Absolute rule: never claim valid trading instructions with R11 missing causal replay.
 return json({ok:false,status:'BLOCKED',code:'R11_CAUSAL_FEATURES_NOT_READY',tradeable:false,paper_only:true,
  version:'R11-'+variant+'-PAPER-PREOPEN-DIAGNOSTIC-20261108',strategy:'P193衍生日夜盤獨立當盤強制平倉',
  checked_at_tpe:time,market_state:marketState,source,requirements:needs,
  decision:'BLOCKED',entry:null,stop_loss:null,take_profit:null,
  current_position:'UNKNOWN',message:'歷史 P193/R26 公式已驗證；最新盤 P40 損益、R26 A影子策略、完整契約與持倉尚未接通，禁止提供當盤可下單價位',
  reconstruction:{historic_cutoff:'2026-10-22',p193_historical_exact_sessions:2428,r26_causal_core_oracle_sessions:214,
   r26_completed_day_feature_exact_comparisons:3424,historical_status:'VERIFIED_FROM_ORIGINAL_ARCHIVE',
   p40_next_session_minute_engine:'UNDEPLOYED',r26_shadow_next_session_engine:'UNDEPLOYED',
   live_plan_status:'BLOCKED_UNTIL_CAUSAL_REPLAY',finmind_browser_token_required:true},
  cost_points_per_side:3,initial_equity_twd:2000000,max_lots:1,required_mdd_lt_pct:5,
  durable_object_writes:0});
}
