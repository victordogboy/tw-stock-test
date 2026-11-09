// R11 TX history backfill. Read-only FinMind API; no Durable Objects writes.
// IMPORTANT: aggregated OHLC coverage is NOT a P193/R26 verified trading signal.
const HEADER={'content-type':'application/json; charset=utf-8' ,'cache-control':'no-store'};
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
    const openEpoch=Date.parse(g.open_date+(g.session==='day'?'T08:45:00+08:00':'T15:00:00+08:00'));
    const present=new Set(g.raw.map(r=>r.epoch)),gaps=[];
    let totalMissing=0;
    for(let i=0;i<expected;i++){
      const epoch=openEpoch+i*60000;
      if(present.has(epoch))continue;
      totalMissing++;
      const previous=gaps.at(-1);
      if(previous&&previous.end_epoch+60000===epoch)previous.end_epoch=epoch,previous.bars++;
      else gaps.push({start_epoch:epoch,end_epoch:epoch,bars:1});
    }
    const missing_ranges=gaps.slice(0,16).map(x=>({
      start:new Date(x.start_epoch+8*3600000).toISOString().slice(0,16).replace('T',' '),
      end:new Date(x.end_epoch+8*3600000).toISOString().slice(0,16).replace('T',' '),bars:x.bars}));
    const boundary_left=g.session==='night'&&g.open_date<start;
    const boundary_right=!concluded;
    const gap_cause=boundary_left?'QUERY_START_BOUNDARY':boundary_right?'SESSION_STILL_ACTIVE':totalMissing?'SOURCE_MINUTES_MISSING':'NONE';
    // Only exact minute coverage and verified opening/closing timestamps may be used as a complete session.
    const complete=concluded&&n===expected&&firstIsOpen&&lastIsClose;
    out.push({contract:g.contract,session:g.session,session_key:g.session_key,open_date:g.open_date,
      first_bar:timeStamp(first.date,first.time),last_bar:timeStamp(last.date,last.time),
      open:first.open,high:Math.max(...g.raw.map(v=>v.high)),low:Math.min(...g.raw.map(v=>v.low)),close:last.close,
      bars:n,expected_bars:expected,missing_bars:totalMissing,coverage_pct:Number((100*n/expected).toFixed(2)),
      missing_ranges,missing_range_count:gaps.length,gap_cause,boundary_partial:boundary_left,source_gap:!boundary_left&&concluded&&totalMissing>0,
      complete,concluded,first_bar_verified:firstIsOpen,last_bar_verified:lastIsClose,
      readiness:complete?'DATA_COVERAGE_ONLY':'INCOMPLETE_OR_ACTIVE_SESSION'});
  }
  out.sort((a,b)=>a.open_date.localeCompare(b.open_date)||a.session.localeCompare(b.session));
  return {sessions:out,source_contracts:[...seenContracts].sort(),rejected,raw_rows:rows.length,
    complete_sessions:out.filter(x=>x.complete).length,partial_sessions:out.filter(x=>!x.complete&&!x.boundary_partial).length,
    boundary_sessions:out.filter(x=>x.boundary_partial).length};
}
export async function r11BackfillRoute(request,env={},fetchImpl=fetch){
 if(request.method!=='GET')return J({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 const u=new URL(request.url),start=u.searchParams.get('start'),end=u.searchParams.get('end'),contract=u.searchParams.get('contract')||'';
 const tpe=tpeToday();
 if(!okdate(start)||!okdate(end)||end<start||end>tpe||!validContract(contract))
  return J({ok:false,code:'INVALID_DATE_OR_CONTRACT',error:'有效日期與指定合約月份 YYYYMM 必填；不可查詢未來日期'},400);
 const mode=u.searchParams.get('mode')||'summary';
 if(!['summary','bars'].includes(mode))return J({ok:false,code:'INVALID_MODE'},400);
 const days=1+Math.round((Date.parse(end)-Date.parse(start))/86400000);
 if(days>7)return J({ok:false,code:'WINDOW_TOO_LARGE',error:'FinMind 期貨分鐘K限單日查詢，每批最多補抓 7 天（網站會自動分批）'},400);
 const bearer=(request.headers.get('authorization')||'').match(/^Bearer\s+([^\r\n]+)$/i)?.[1]?.trim()||'';
 // SECURITY: never let an unauthenticated public visitor spend the Cloudflare account's paid FinMind quota.
 // Cloudflare FINMIND_TOKEN is reserved for future PRIVATE cron/worker requests, never this public route.
 const token=bearer;
 if(!token||token.length>4096||/[\r\n]/.test(token))return J({ok:false,code:'FINMIND_TOKEN_REQUIRED',error:'請在 R11 網頁輸入你自己的 FinMind Token；公開 API 不會取用 Cloudflare Secret 以免遭他人耗盡額度'},401);
 const dates=[];for(let d=start;d<=end;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10))dates.push(d);
 const out=[],errors=[],empty_dates=[],used_dates=[];
 const pullDate=async date=>{
  // Per official FinMind documentation TaiwanFuturesKBar only supports a SINGLE date.
  const endpoint='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanFuturesKBar',data_id:'TX',start_date:date});
  try{
   const response=await fetchImpl(endpoint,{headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(25000)});
   const body=await response.json().catch(()=>null);
   if(!response.ok||Number(body?.status)!==200||!Array.isArray(body?.data)){
    const code=Number(body?.status)||response.status;
    return {date,ok:false,upstream_status:code,code:code===429?'RATE_LIMIT':'SOURCE_REJECTED'};
   }
   // Strictly keep ONLY the requested date; do not infer next-day bars from a truncated API.
   return {date,ok:true,rows:body.data.filter(x=>String(x?.date||'').slice(0,10)===date)};
  }catch(e){return {date,ok:false,code:'SOURCE_TIMEOUT'};}
 };
 for(let i=0;i<dates.length;i+=2){
  const batch=await Promise.all(dates.slice(i,i+2).map(pullDate));
  for(const b of batch){
   if(!b.ok)errors.push({date:b.date,code:b.code,upstream_status:b.upstream_status||null});
   else{
    used_dates.push(b.date);
    if(!b.rows.length)empty_dates.push(b.date);
    out.push(...b.rows);
   }
  }
  if(batch.some(b=>!b.ok&&[401,402,403,429].includes(b.upstream_status)))break;
 }
 if(errors.some(e=>[401,402,403,429].includes(e.upstream_status)))
  return J({ok:false,status:'SOURCE_AUTH_OR_QUOTA_BLOCKED',paper_only:true,tradeable:false,
    source:'FinMind TaiwanFuturesKBar',days_completed:used_dates,errors,
    error:'FinMind Token 權限或請求額度問題，已停止繼續請求。請不要重複快速重試。',durable_object_writes:0},
    errors.some(e=>e.upstream_status===429)?429:403);
 const result=summarizeRows(out,start,end,contract);
 // Optional raw exact-month OHLCV, for private browser IndexedDB. Never store raw bars on public server.
 const actualBars=mode==='bars'?out.filter(r=>r.futures_id==='TX'&&String(r.contract_date)===contract&&
   /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(String(r.minute||''))&&
   ['open','high','low','close'].every(k=>Number.isFinite(Number(r[k]))&&Number(r[k])>0)&&
   Number(r.low)<=Math.min(Number(r.open),Number(r.close))&&Number(r.high)>=Math.max(Number(r.open),Number(r.close)))
   .map(r=>({timestamp_tpe:r.date+' '+r.minute,contract_date:contract,
    open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume)||0}))
   .sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe)):undefined;
 if(actualBars?.length>10500)return J({ok:false,code:'TOO_MANY_VALID_BARS',tradeable:false},413);
 return J({ok:errors.length===0,status:errors.length?'PARTIAL_COVERAGE':'COVERAGE_ONLY',
   paper_only:true,tradeable:false,contract,start,end,days,
   requested_dates:dates,fetched_dates:used_dates,empty_dates,failed_dates:errors,
   source:'FinMind TaiwanFuturesKBar (daily-only, sequential bounded batches)',
   retrieved_at:new Date().toISOString(),
   ...result,mode,raw_bars:actualBars,note:'每個曆日皆獨立讀取 FinMind KBar（含週六凌晨）。任何缺分鐘、來源失敗或盤尚未結束都不補假 K；P40、R26 core、P193 與實際持倉未驗證時不給交易價。',
   durable_object_writes:0},errors.length?206:200);
}
export {summarizeRows};