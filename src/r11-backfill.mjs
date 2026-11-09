// R11 TX history backfill. Read-only FinMind API; no Durable Objects writes.
// IMPORTANT: aggregated OHLC coverage is NOT a P193/R26 verified trading signal.
const HEADER={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'same-origin'};
const J=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:HEADER});
const okdate=s=>/^20\d{2}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const prevDay=s=>new Date(Date.parse(s+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const tpeToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
const validContract=s=>/^20\d{2}(0[1-9]|1[0-2])$/.test(s||'');
const timeStamp=(date,minute)=>date+' '+minute.slice(0,5);
function summarizeRows(rows,start,end,contract,now=Date.now()){
  if(!Array.isArray(rows))throw Error('FINMIND_SCHEMA_MISMATCH');
  const groups=new Map(),dedup=new Set(),rejected={product:0,contract:0,date:0,invalid:0,duplicate:0};
  let seenContracts=new Set();
  for(const r of rows){
    if(String(r?.futures_id||'').trim()!=='TX'){rejected.product++;continue;}
    const con=String(r.contract_date||'');if(validContract(con))seenContracts.add(con);
    if(con!==contract){rejected.contract++;continue;}
    const date=String(r.date||'').slice(0,10);
    if(!okdate(date)||date<start||date>end){rejected.date++;continue;}
    const tm=String(r.minute||''),mm=/^(\d\d):(\d\d):(\d\d)$/.exec(tm);
    if(!mm||+mm[1]>23||+mm[2]>59||+mm[3]>59){rejected.invalid++;continue;}
    const minute=+mm[1]*60+ +mm[2],day=minute>=525&&minute<825,night=minute>=900||minute<300;
    if(!day&&!night){rejected.invalid++;continue;}
    const vals=['open','high','low','close'].map(k=>Number(r[k]));
    if(!vals.every(Number.isFinite)||vals[2]<=0||vals[1]<Math.max(vals[0],vals[3])||vals[2]>Math.min(vals[0],vals[3])){rejected.invalid++;continue;}
    const [o,h,l,c]=vals;
    const key=date+'T'+tm.slice(0,5);
    if(dedup.has(key)){rejected.duplicate++;continue;}dedup.add(key);
    const session=day?'day':'night',sessionDay=day||minute>=900?date:prevDay(date),groupKey=contract+'|'+session+':'+sessionDay;
    if(!groups.has(groupKey))groups.set(groupKey,{contract,session,session_key:session+':'+sessionDay,open_date:sessionDay,raw:[]});
    groups.get(groupKey).raw.push({date,time:tm.slice(0,5),epoch:Date.parse(date+'T'+tm.slice(0,5)+':00+08:00'),minute,open:o,high:h,low:l,close:c});
  }
  const out=[];
  for(const g of groups.values()){
    g.raw.sort((a,b)=>a.epoch-b.epoch);
    const n=g.raw.length,expected=g.session==='day'?300:840,first=g.raw[0],last=g.raw.at(-1),
      firstExpected=g.session==='day'?'08:45':'15:00',
      lastExpected=g.session==='day'?'13:44':'04:59',
      firstIsOpen=first.time===firstExpected,lastIsClose=last.time===lastExpected,
      endEpoch=g.session==='day'?Date.parse(g.open_date+'T13:45:00+08:00'):Date.parse(g.open_date+'T15:00:00+08:00')+840*60000,
      concluded=now>=endEpoch;
    // Only exact minute coverage and verified opening/closing timestamps may be used as a complete session.
    const complete=concluded&&n===expected&&firstIsOpen&&lastIsClose;
    out.push({contract:g.contract,session:g.session,session_key:g.session_key,open_date:g.open_date,
      first_bar:timeStamp(first.date,first.time),last_bar:timeStamp(last.date,last.time),
      open:first.open,high:Math.max(...g.raw.map(v=>v.high)),low:Math.min(...g.raw.map(v=>v.low)),close:last.close,
      bars:n,expected_bars:expected,missing_bars:Math.max(0,expected-n),coverage_pct:Number((100*n/expected).toFixed(2)),
      complete,concluded,first_bar_verified:firstIsOpen,last_bar_verified:lastIsClose,
      readiness:complete?'DATA_COVERAGE_ONLY':'INCOMPLETE_OR_ACTIVE_SESSION'});
  }
  out.sort((a,b)=>a.open_date.localeCompare(b.open_date)||a.session.localeCompare(b.session));
  return {sessions:out,source_contracts:[...seenContracts].sort(),rejected,raw_rows:rows.length,
    complete_sessions:out.filter(x=>x.complete).length,partial_sessions:out.filter(x=>!x.complete).length};
}
export async function r11BackfillRoute(request,env={},fetchImpl=fetch){
 if(request.method!=='GET')return J({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 const u=new URL(request.url),start=u.searchParams.get('start'),end=u.searchParams.get('end'),contract=u.searchParams.get('contract')||'';
 const tpe=tpeToday();
 if(!okdate(start)||!okdate(end)||end<start||end>tpe||!validContract(contract))
  return J({ok:false,code:'INVALID_DATE_OR_CONTRACT',error:'有效日期與指定合約月份 YYYYMM 必填；不可查詢未來日期'},400);
 const days=1+Math.round((Date.parse(end)-Date.parse(start))/86400000);
 if(days>21)return J({ok:false,code:'WINDOW_TOO_LARGE',error:'為保護 FinMind 請求額度，每次最多補抓 21 個曆日'},400);
 const bearer=(request.headers.get('authorization')||'').match(/^Bearer\s+([^\r\n]+)$/i)?.[1]?.trim()||'';
 const token=bearer||String(env.FINMIND_TOKEN||'').trim();
 if(!token||token.length>4096||/[\r\n]/.test(token))return J({ok:false,code:'FINMIND_TOKEN_REQUIRED',error:'缺少 FinMind Token；可在本頁自願輸入，或由 Cloudflare 設定 FINMIND_TOKEN Secret'},401);
 const endpoint='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanFuturesKBar',data_id:'TX',start_date:start,end_date:end});
 try{
  const response=await fetchImpl(endpoint,{headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(25000)});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.status!==200||!Array.isArray(body?.data)){
   const code=Number(body?.status)||response.status;
   const status=[401,402,403,429].includes(code)?code:502;
   return J({ok:false,code:status===429?'FINMIND_RATE_LIMIT':'FINMIND_UPSTREAM_REJECTED',
    upstream_status:code,error:status===429?'FinMind 額度已達上限，請勿頻繁重試':'FinMind Token 權限不足或來源暫時無法讀取'},status);
  }
  const result=summarizeRows(body.data,start,end,contract);
  return J({ok:true,status:'COVERAGE_ONLY',paper_only:true,tradeable:false,contract,start,end,days,
    source:'FinMind TaiwanFuturesKBar',retrieved_at:new Date().toISOString(),
    ...result,note:'已補抓指定合約分鐘K並稽核完整盤；此結果尚不包含 P40/R26、P193 w/h、前120盤完整特徵與券商持倉，不構成可下單訊號。',
    durable_object_writes:0});
 }catch(e){return J({ok:false,code:'FINMIND_SOURCE_ERROR',error:'FinMind 連線失敗或逾時（未刪除任何舊資料）',durable_object_writes:0},502);}
}
export {summarizeRows};
