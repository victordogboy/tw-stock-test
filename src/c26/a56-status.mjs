/** Read-only A56 continuation readiness. Never borrows a C26-only account. */
const LOCK='A56-LOCK-20261116';
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function a56Readiness(checkpoint,coverage){
 const base={model_version:'A56',lock_id:LOCK,plan:{readiness:'blocked',actions:[]},
  live_trading_enabled:false,broker_orders_submitted:false,
  checkpoint:null,source:null,required_replay_dates:[],blockers:[]};
 const fail=(code,message)=>base.blockers.push({code,message});
 const c=checkpoint,r=c?.full_replay,a=c?.paper_account;
 const verified=c?.schema===1&&c.version===LOCK&&c.status==='historical_checkpoint_verified'&&date(c.as_of)&&
  /^[a-f0-9]{64}$/.test(c.source_sha256||'')&&/^[a-f0-9]{64}$/.test(c.checkpoint_sha256||'')&&
  r?.nav_days===1419&&r.side_orders===38&&r.side_trades===19&&
  c.rule?.single===.06&&c.rule.cumulative===.10&&c.rule.hold_days===5&&c.rule.exit==='open'&&c.rule.open_cap===.03&&c.rule.allocation===.40&&c.rule.tail==='off'&&c.rule.round_trip_cost===.005855&&
  Array.isArray(c.resume_checks)&&c.resume_checks.length>=6&&c.resume_checks.every(x=>x.passed===true&&x.nav_days===1419&&x.side_orders===38&&x.side_trades===19&&Number.isFinite(x.max_nav_absolute_error)&&x.max_nav_absolute_error<=1e-10)&&
  c.resume_checks.some(x=>x.side_positions>0)&&c.resume_checks.some(x=>x.date===c.as_of)&&
  Array.isArray(a?.holdings)&&a.holdings.length<=8&&new Set(a.holdings.map(x=>x.code)).size===a.holdings.length&&
  a.holdings.every(x=>/^\d{4,6}$/.test(x.code)&&[x.core_shares,x.side_shares,x.mark].every(Number.isFinite)&&x.core_shares>=0&&x.side_shares>=0&&x.mark>0)&&
  Number.isFinite(a.cash_twd)&&a.cash_twd>=0&&Number.isFinite(a.equity_twd)&&a.equity_twd>0&&
  Math.abs(a.cash_twd+a.holdings.reduce((s,x)=>s+(x.core_shares+x.side_shares)*x.mark,0)-a.equity_twd)<.01;
 if(!verified)fail('A56_CHECKPOINT_UNVERIFIED','A56 合併帳本接續檢查未通過，不能使用 C26 單獨帳本代替。');
 else base.checkpoint={as_of:c.as_of,source_sha256:c.source_sha256,checkpoint_sha256:c.checkpoint_sha256,
  resume_checks:c.resume_checks.length,cash_twd:a.cash_twd,equity_twd:a.equity_twd,
  holdings:a.holdings,model_not_broker_account:true};
 const s=coverage;
 if(s?.lock_id!=='C26-EVENT-CORR-LOCK-20261112'||s.state!=='source_staged'||s.public_raw_data!==false||
  !date(s.full_market_last_verified)||!date(s.next_exchange_trade_date)||s.next_exchange_trade_date<=s.full_market_last_verified||!Array.isArray(s.days)){
  fail('SOURCE_COVERAGE_UNAVAILABLE','最新已完成市場資料及下一交易日尚未核對。');
 }else{
  const dates=s.days.map(x=>x.date);
  const ordered=s.days.every((x,i)=>date(x.date)&&(!i||x.date>dates[i-1]));
  if(!ordered||!s.days.some(x=>x.date===s.full_market_last_verified&&['available','cached'].includes(x.state))){
   fail('SOURCE_CALENDAR_INVALID','市場資料日期順序或最新交易日完整性不符。');
  }else{
   base.source={as_of:s.full_market_last_verified,next_trade_date:s.next_exchange_trade_date,coverage_only:true};
   if(verified){
    if(s.full_market_last_verified<c.as_of)fail('SOURCE_BEHIND_CHECKPOINT','來源資料落後已驗證帳本。');
    base.required_replay_dates=s.days.filter(x=>x.date>c.as_of&&x.date<=s.full_market_last_verified).map(x=>({date:x.date,source_state:x.state}));
    if(base.required_replay_dates.some(x=>!['available','cached'].includes(x.source_state)))fail('SOURCE_GAP','接續日期內仍有未完整的市場資料。');
   }
  }
 }
 // A checkpoint can be resumable while its next-day plan is still unpublished.
 // This endpoint deliberately has no path that promotes historical orders.
 fail('A56_FORWARD_REPLAY_REQUIRED','需由 A56 原合併帳本逐日重播至最新完成交易日，另驗證當日盤前計畫與分 K。');
 base.plan.reason=base.blockers.map(x=>x.message).join(' ');
 return base;
}
export async function a56StatusRoute(request,env){
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
 if(request.method!=='GET')return new Response(JSON.stringify({error:'GET required'}),{status:405,headers});
 const read=async path=>{
  try{const r=await env.ASSETS.fetch(new Request('https://assets.internal'+path));return r.ok?await r.json():null;}catch{return null;}
 };
 const [cp,source]=await Promise.all([read('/r1494a/c26/a56/checkpoint-verification.json'),read('/r1494a/c26/data/forward-status.json')]);
 return new Response(JSON.stringify({...a56Readiness(cp,source),updated_at:new Date().toISOString()}),{headers});
}
