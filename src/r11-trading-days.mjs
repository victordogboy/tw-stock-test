// Independent TX daily trades from FinMind, used only to cross-check expected
// trading dates/contract rolls in R11 minute replay. Never a substitute for
// official TAIFEX holiday list, R26 A-shadow or P40 stateful strategy.
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(x,status=200)=>Response.json(x,{status,headers:H});
const validDate=s=>/^20\d{2}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const validMonth=m=>/^20\d{2}(0[1-9]|1[0-2])$/.test(m||'');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
export function summarizeIndependentTxDaily(rows,start,end){
 if(!Array.isArray(rows))throw Error('FINMIND_DAILY_SCHEMA_NOT_ARRAY');
 const byDay=new Map(),bad={wrong_product:0,wrong_date:0,wrong_contract:0,invalid_ohlc:0};
 for(const r of rows){
  if(String(r?.futures_id||'')!=='TX'){bad.wrong_product++;continue;}
  const date=String(r.date||'').slice(0,10),contract=String(r.contract_date||'');
  if(!validDate(date)||date<start||date>end){bad.wrong_date++;continue;}
  if(!validMonth(contract)){bad.wrong_contract++;continue;}
  const [o,h,l,c]=[r.open,r.max,r.min,r.close].map(Number);
  if(![o,h,l,c].every(Number.isFinite)||l<=0||h<Math.max(o,c)||l>Math.min(o,c)){
    bad.invalid_ohlc++;continue;
  }
  if(!byDay.has(date))byDay.set(date,new Set());
  byDay.get(date).add(contract);
 }
 const trading_days=[...byDay.keys()].sort();
 return {trading_days,contracts_by_day:Object.fromEntries(trading_days.map(d=>[d,[...byDay.get(d)].sort()])),
  rejected:bad,tx_daily_rows:rows.length,verified_days:trading_days.length};
}
export async function r11TradingDaysRoute(request,env={},fetchImpl=fetch){
 if(request.method!=='GET')return json({ok:false,error:'METHOD_NOT_ALLOWED',tradeable:false},405);
 const u=new URL(request.url),start=u.searchParams.get('start'),end=u.searchParams.get('end'),maxDate=today();
 if(!validDate(start)||!validDate(end)||end<start||end>maxDate||start<'2011-01-03')
  return json({ok:false,error:'INVALID_DATE_RANGE',tradeable:false},400);
 const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
 if(days>35)return json({ok:false,error:'MAX_35_CALENDAR_DAYS',tradeable:false},400);
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+([^\r\n]+)$/i)?.[1]?.trim()||'';
 if(!token||token.length>4096||/[\r\n]/.test(token))return json({ok:false,error:'BROWSER_FINMIND_TOKEN_REQUIRED',tradeable:false},401);
 try{
  const endpoint='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanFuturesDaily',data_id:'TX',start_date:start,end_date:end});
  const rsp=await fetchImpl(endpoint,{headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(25000)});
  const payload=await rsp.json().catch(()=>null);
  if(!rsp.ok||Number(payload?.status)!==200||!Array.isArray(payload?.data))
   return json({ok:false,error:'FINMIND_DAILY_SOURCE_NOT_VERIFIED',upstream_status:rsp.status,tradeable:false},rsp.status===429?429:502);
  const summary=summarizeIndependentTxDaily(payload.data,start,end);
  if(!summary.verified_days)return json({ok:false,error:'NO_TX_DAILY_TRADING_DAYS_VERIFIED',tradeable:false},422);
  return json({ok:true,start,end,source:'FinMind TaiwanFuturesDaily independent of KBar',
   source_type:'provider_observed_days_not_official_holiday_calendar',
   retrieved_at:new Date().toISOString(),...summary,
   tradeable:false,paper_only:true,durable_object_writes:0,
   note:'只核對期貨日資料是否有 TX 合約成交；不能取代期交所官方全年日曆、P40/R26 影子重播及券商倉位。'});
 }catch{return json({ok:false,error:'FINMIND_DAILY_UPSTREAM_UNAVAILABLE',tradeable:false},502);}
}
