// Resumable point-in-time-conscious historical raw dataset collector.
// Uses the existing STOCK_FUTURES_BATCH + STOCK_FUTURES_DATA Durable Object bindings;
// no migrations, new secrets, or public raw-data sharing.
import {streamZip64} from "./stock-archive.mjs";
import {parseStockFutureUniverse,preferMiniStockFutures} from "./stock-futures-download.mjs";

const spec=(name,group,priority,scope="stock",earliest="2000-01-01",unit="source_native")=>({name,group,priority,scope,earliest,unit});
export const RESEARCH_DATASETS=[
 spec("TaiwanStockPrice","01_stock_price",1,"stock","2000-01-01","Trading_Volume=shares;Trading_money=TWD"),
 spec("TaiwanStockPriceAdj","01_stock_price",1),
 spec("TaiwanStockPriceLimit","01_stock_price",1),
 spec("TaiwanStockSuspended","01_stock_price",1,"global"),
 spec("TaiwanStockInfo","10_metadata",1,"global"),
 spec("TaiwanStockTradingDate","10_metadata",1,"global"),
 spec("TaiwanStockInstitutionalInvestorsBuySellWide","02_institutional",1,"stock","2005-01-01"),
 spec("TaiwanStockInstitutionalInvestorsBuySell","02_institutional",1,"stock","2005-01-01"),
 spec("TaiwanStockTotalInstitutionalInvestors","02_institutional",1,"global"),
 spec("TaiwanStockMarginPurchaseShortSale","03_margin_short",1,"stock","2001-01-01"),
 spec("TaiwanStockTotalMarginPurchaseShortSale","03_margin_short",1,"global"),
 spec("TaiwanStockSecuritiesLending","04_securities_lending",1,"stock","2001-05-01"),
 spec("TaiwanDailyShortSaleBalances","04_securities_lending",1),
 spec("TaiwanStockShareholding","05_shareholding",2,"stock","2004-02-01"),
 spec("TaiwanStockHoldingSharesPer","05_shareholding",2),
 spec("TaiwanStockMonthRevenue","06_fundamental",2),
 spec("TaiwanStockFinancialStatements","06_fundamental",2),
 spec("TaiwanStockBalanceSheet","06_fundamental",2),
 spec("TaiwanStockCashFlowsStatement","06_fundamental",2),
 spec("TaiwanStockPER","06_fundamental",2),
 spec("TaiwanStockMarketValue","06_fundamental",2),
 spec("TaiwanStockDividend","06_fundamental",2),
 spec("TaiwanStockDividendResult","06_fundamental",2),
 spec("TaiwanStockCapitalReductionReferencePrice","06_fundamental",2),
 spec("TaiwanStockSplitPrice","06_fundamental",2),
 spec("TaiwanStockDelisting","10_metadata",2,"global"),
 spec("TaiwanStockTotalReturnIndex","07_market_sector",3,"global"),
 spec("TaiwanStockIndustryChainMoneyFlow","07_market_sector",3,"global"),
 spec("TaiwanFuturesDaily","08_stock_futures",3,"needs_verified_contract_codes"),
 spec("TaiwanStockBrokerDailyConcentration","02_institutional",4),
 spec("TaiwanStockMarginMaintenance","03_margin_short",4),
 spec("TaiwanStockDispositionSecuritiesPeriod","10_metadata",4,"global"),
 spec("TaiwanStockTradingDailyReport","02_institutional",4,"special_endpoint"),
 spec("TaiwanStockTradingDailyReportSecIdAgg","02_institutional",4,"special_endpoint"),
 spec("TaiwanStockKBar","09_intraday_optional",5,"minute","2021-01-01","source_original_volume")
];
const SPEC_BY_NAME=new Map(RESEARCH_DATASETS.map(x=>[x.name,x]));
const START="2000-01-01",TARGET_END="2026-11-06";
const DO_ROOT="https://internal.research/";
const JOB_ROOT="https://internal.research/rp/";
const iso=/^\d{4}-\d{2}-\d{2}$/,codePattern=/^\d{4,6}[A-Z]?$/i;
const cookieName="__Host-tw-momentum-research";
const response=(json,status=200)=>new Response(JSON.stringify(json),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store"}});
function cookies(request){const raw=request.headers.get("cookie")||"";const m=raw.match(/(?:^|;\s*)__Host-tw-momentum-research=([a-f0-9]{32})/);return m?.[1]||""}
function newId(){return [...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,"0")).join("")}
function taskKey(a,code,year){return "rp:meta:"+a+":"+(code||"GLOBAL")+":"+year}
function dataNode(env,id,spec,code){
 return env.STOCK_FUTURES_DATA.get(env.STOCK_FUTURES_DATA.idFromName("research:"+id+":"+spec.name+":"+(code||"GLOBAL")));
}
function getRanges(s,spec){const start=s.start>spec.earliest?s.start:spec.earliest;const y0=+start.slice(0,4),y1=+s.end.slice(0,4);
 return y0>y1?[]:Array.from({length:y1-y0+1},(_,i)=>String(y0+i))}
function scopedCodes(s,spec){return ["global","special_endpoint","needs_verified_contract_codes"].includes(spec.scope)?[""]:s.codes.map(c=>c.code)}
function counter(s,name){return s.stats[name]||(s.stats[name]={completed:0,empty:0,failed:0,rows:0,first:null,last:null,restricted:false})}
function stats(s){return {ok:true,phase:s.phase,version:"research-raw-v1",mode:s.scope,stages:s.stages,
 start:s.start,end:s.end,total:s.total,processed:s.processed,queries:s.queries,rows:s.rows,
 count:s.codes?.length||0,stockUniverseSource:s.universeSource||"",
 datasetStats:s.stats||{},message:s.message||"",lastError:s.lastError||"",errors:(s.errors||[]).slice(-30),
 lastCode:s.lastCode||"",lastDataset:s.lastDataset||"",updatedAt:s.updatedAt,
 observedLatest:s.observedLatest||null,
 zipPolicy:"year-plus-dataset/stock-part; ZIP64 streaming. Verify CRC and manifest before backtesting.",
 pointInTimePolicy:"No inferred publication dates; unknown report release date remains unavailable for causal backtest.",
 manifestIsVerifiedComplete:false}}
async function finmind(token,params){
 const url="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams(params);
 const res=await fetch(url,{headers:{authorization:"Bearer "+token,accept:"application/json"},signal:AbortSignal.timeout(60000)});
 if(!res.ok){const e=new Error("FinMind HTTP "+res.status+" "+(await res.text()).slice(0,160));e.code=res.status;throw e}
 const obj=await res.json();
 if(obj.status!==200){const e=new Error("FinMind "+(obj.status??"unknown")+" "+String(obj.msg||obj.detail||"API error").slice(0,200));e.code=Number(obj.status||503);throw e}
 if(!Array.isArray(obj.data))throw new Error("FinMind did not return data[]");
 return obj.data
}
const escape=(v)=>{if(v===null||v===undefined)return "";const s=typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
async function toGzip(raw){const writer=new TextEncoder().encode(raw);const stream=new Blob([writer]).stream().pipeThrough(new CompressionStream("gzip"));return new Uint8Array(await new Response(stream).arrayBuffer())}
function prepareRows(spec,rows,code,from,to){
 const cols=[...new Set(rows.flatMap(r=>Object.keys(r||{})))];
 if(!cols.includes("stock_id")&&code)cols.unshift("stock_id");
 cols.push("__source_dataset","__retrieved_at","__availability_status");
 const timestamp=new Date().toISOString();
 let first=null,last=null,nonmatching=0;const seen=new Map();
 const out=[cols.map(escape).join(",")];
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row))throw Error("FinMind row is not an object");
  if(code&&row.stock_id!==undefined&&String(row.stock_id)!==code){nonmatching++;continue}
  const d=String(row.date||"");
  if(d&&iso.test(d)&&(d<from||d>to))throw Error("FinMind returned data outside requested range: "+d);
  if(d&&iso.test(d)){if(!first||d<first)first=d;if(!last||d>last)last=d}
  if(["TaiwanStockPrice","TaiwanStockPriceAdj"].includes(spec.name)&&d){
   const key=code+"|"+d,sig=JSON.stringify(row);
   if(seen.has(key)){if(seen.get(key)!==sig)throw Error("conflicting same-day stock price");continue}
   seen.set(key,sig)
  }
  const augmented={...row,stock_id:row.stock_id??(code||""),__source_dataset:spec.name,
   __retrieved_at:timestamp,__availability_status:"publication_time_unverified"};
  out.push(cols.map(k=>escape(augmented[k])).join(","))
 }
 if(nonmatching)throw Error("Wrong stock_id contaminated source: "+nonmatching+" records");
 return {csv:out.join("\n")+"\n",rows:out.length-1,first,last,cols}
}
async function writeMetadata(ctx,env,s,spec,code,year,rows,from,to){
 const data=prepareRows(spec,rows,code,from,to),bytes=await toGzip(data.csv);
 const shard=dataNode(env,s.id,spec,code);
 const saved=await shard.fetch(new Request(DO_ROOT+"put?date="+year+"-01-01&ttl=120",{method:"POST",body:bytes}));
 if(!saved.ok)throw Error("Cloud data node failed "+saved.status+"; original job state preserved");
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const meta={name:spec.name,group:spec.group,code,year,rows:data.rows,first:data.first,last:data.last,
  compressedBytes:bytes.length,sha256:hash,columns:data.cols,downloadedAt:new Date().toISOString(),
  availability:"unverified (original rows contain report period, not necessarily publication date)",
  status:data.rows?"completed":"no_observations",unit:spec.unit};
 await ctx.storage.put(taskKey(spec.name,code,year),meta);
 return meta
}
function makeCursor(s){
 const enabled=s.stages,plan=RESEARCH_DATASETS.filter(x=>enabled.includes(x.priority)&&!["special_endpoint","needs_verified_contract_codes","minute"].includes(x.scope));
 return plan
}
function countTotal(s){
 return makeCursor(s).reduce((n,sp)=>n+getRanges(s,sp).length*scopedCodes(s,sp).length,0)
}
function nextTask(s){
 const plan=makeCursor(s);
 while(s.cursor.s<plan.length){
  const sp=plan[s.cursor.s],codes=scopedCodes(s,sp),years=getRanges(s,sp);
  if(!years.length||!codes.length){s.cursor={s:s.cursor.s+1,c:0,y:0};continue}
  if(s.cursor.c>=codes.length){s.cursor={s:s.cursor.s+1,c:0,y:0};continue}
  if(s.cursor.y>=years.length){s.cursor.c++;s.cursor.y=0;continue}
  return {sp,code:codes[s.cursor.c],year:years[s.cursor.y]}
 }
 return null
}
function advance(s){s.cursor.y++}
async function buildCatalog(ctx,env,s,token){
 const info=await finmind(token,{dataset:"TaiwanStockInfo",start_date:s.start,end_date:s.end});
 const delisted=await finmind(token,{dataset:"TaiwanStockDelisting",start_date:s.start,end_date:s.end}).catch(e=>{
  s.errors.push({dataset:"TaiwanStockDelisting",reason:e.message});return []
 });
 const latest=new Map(),nameHistory=new Map();
 for(const row of info){
  const code=String(row.stock_id||""),market=String(row.type||"").toLowerCase(),d=String(row.date||"");
  if(!/^\d{4}$/.test(code)||!["twse","tpex","emerging"].includes(market))continue;
  if(!latest.has(code)||d>=String(latest.get(code).date||""))latest.set(code,row);
  if(!nameHistory.has(code))nameHistory.set(code,[]);
  nameHistory.get(code).push({name:row.stock_name,market,date:d})
 }
 const dead=new Set(delisted.map(r=>String(r.stock_id||"")).filter(x=>/^\d{4}$/.test(x)));
 let codes=[];
 if(s.requestedCodes.length){codes=s.requestedCodes}
 else if(s.scope==="futures"){
  const html=await fetch("https://www.taifex.com.tw/cht/2/stockLists",{signal:AbortSignal.timeout(15000)}).then(r=>r.text());
  const futures=preferMiniStockFutures(parseStockFutureUniverse(html));
  codes=[...new Set(futures.map(x=>x.stock))];
  s.universeSource="TAIFEX CURRENT stock-futures list (historical eligibility NOT verified)"
 }else{
  codes=[...new Set([...latest.keys(),...dead])];
  s.universeSource="FinMind stock history and delisting table; completeness unverified"
 }
 codes=codes.filter(x=>/^\d{4}$/.test(x));
 s.codes=codes.map(code=>({code,name:String(latest.get(code)?.stock_name||""),market:String(latest.get(code)?.type||"unknown"),
  lastObservedMetaDate:String(latest.get(code)?.date||""),historicallyDelisted:dead.has(code),
  listingDate:null,delistingDate:delisted.find(r=>String(r.stock_id)===code)?.date||null,
  dateSourceVerified:false,history:nameHistory.get(code)||[]}));
 // Do NOT package the entire CURRENT/HISTORICAL catalog under year 2000.
 // Doing so leaks 2026 listing/name information into early years and falsely dates records.
 // Both metadata datasets are fetched independently in correctly dated yearly windows
 // by the main historical tasks below. This initial catalog is selection-only.
 s.universeSelectionAsOf=new Date().toISOString();
 s.total=countTotal(s);s.phase="running";s.updatedAt=Date.now();
 s.message="已建立 "+s.codes.length+" 檔研究股票清單，開始依資料集逐年抓取"
}
export async function researchAlarm(ctx,env){
 const st=ctx.storage,s=await st.get("rp:state");
 if(!s||!["running","preparing"].includes(s.phase))return;
 const token=await st.get("rp:token");
 if(!token){s.phase="error";s.lastError="FinMind token missing";await st.put("rp:state",s);return}
 if(s.phase==="preparing"){
  try{await buildCatalog(ctx,env,s,token)}
  catch(e){s.phase="error";s.lastError="股票清單建立失敗："+e.message}
 }else{
  const task=nextTask(s);
  if(!task){s.phase="done";s.message="選擇階段的 API 任務已跑完；請核對缺漏，不代表資料百分之百完整"}
  else{
   const {sp,code,year}=task;
   s.lastCode=code;s.lastDataset=sp.name;
   const from=year===s.start.slice(0,4)?s.start:year+"-01-01";
   const end=year===s.end.slice(0,4)?s.end:year+"-12-31";
   const start=sp.earliest>from?sp.earliest:from;
   try{
    let meta=await st.get(taskKey(sp.name,code,year));
    if(!meta){
     const args={dataset:sp.name,start_date:start,end_date:end};
     if(code)args.data_id=code;
     const rows=await finmind(token,args);s.queries++;
     meta=await writeMetadata(ctx,env,s,sp,code,year,rows,start,end);
    }
    const c=counter(s,sp.name);c.completed++;
    if(meta.rows===0)c.empty++;
    c.rows+=meta.rows;s.rows+=meta.rows;
    if(meta.first&&(!c.first||meta.first<c.first))c.first=meta.first;
    if(meta.last){if(!c.last||meta.last>c.last)c.last=meta.last;
      if(!s.observedLatest||meta.last>s.observedLatest)s.observedLatest=meta.last}
    s.processed++;advance(s);
   }catch(e){
    const status=Number(e.code||0),c=counter(s,sp.name);
    c.failed++;s.errors.push({dataset:sp.name,stock_id:code,year,reason:e.message,status});
    if([401,402,429].includes(status)){
     s.phase="error";s.lastError="Token/API額度限制，保留已抓資料並暫停："+e.message
    }else{
     await st.put(taskKey(sp.name,code,year),{name:sp.name,code,year,status:"failed",reason:e.message,rows:0});
     s.processed++;advance(s);
    }
   }
  }
 }
 s.errors=s.errors.slice(-100);s.updatedAt=Date.now();
 await st.put("rp:state",s);
 await st.setAlarm(s.phase==="running"?Date.now()+800:Date.now()+30*86400000)
}
export async function researchFetch(ctx,env,request){
 const path=new URL(request.url).pathname,st=ctx.storage;
 if(path==="/rp/start"&&request.method==="POST"){
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(token.length<10||token.length>4096||/[\r\n]/.test(token))return response({ok:false,error:"請提供有效 FinMind S Token"},401);
  const old=await st.get("rp:state");
  if(old){
   await st.put("rp:token",token);
   return response({...stats(old),existing:true,message:"已存在研究任務；不覆蓋先前下載進度"})
  }
  const q=await request.json(),stages=(q.stages||[1]).filter(n=>Number.isInteger(n)&&n>=1&&n<=4);
  const start=q.start||START,end=q.end||TARGET_END;
  if(!iso.test(start)||!iso.test(end)||start<START||start>end||end>new Date().toISOString().slice(0,10)||!stages.length)
   return response({ok:false,error:"日期或批次設定錯誤"},400);
  const codes=[...new Set(Array.isArray(q.codes)?q.codes.map(String):[])].filter(x=>/^\d{4}$/.test(x));
  if(codes.length>4000)return response({ok:false,error:"股票代碼過多"},400);
  const id=q.id;
  const now=Date.now(),s={id,scope:q.scope==="futures"?"futures":"all",start,end,requestedCodes:codes,
   stages,phase:"preparing",cursor:{s:0,c:0,y:0},codes:[],total:0,processed:0,queries:0,rows:0,
   stats:{},errors:[],createdAt:now,updatedAt:now,observedLatest:null};
  await st.put("rp:token",token);await st.put("rp:state",s);await st.setAlarm(Date.now()+100);
  return response(stats(s),202)
 }
 const s=await st.get("rp:state");if(!s)return response({ok:false,error:"尚未建立研究下載任務"},404);
 if(path==="/rp/status")return response(stats(s));
 if(path==="/rp/manifest"){
  const meta={...stats(s),stockCatalog:s.codes,missingDatasets:RESEARCH_DATASETS.filter(x=>s.stages.includes(x.priority)&&["special_endpoint","needs_verified_contract_codes","minute"].includes(x.scope))
   .map(x=>({dataset:x.name,status:"not_fetched",reason:"needs separate contract/broker/date parameters; no fabricated data"})),
   totalSourcesAvailableUnknown:true,verifiedComplete:false};
  return response(meta)
 }
 if(path==="/rp/pause"&&request.method==="POST"){s.phase="paused";s.updatedAt=Date.now();await st.put("rp:state",s);return response(stats(s))}
 if(path==="/rp/resume"&&request.method==="POST"){
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(token.length>=10)await st.put("rp:token",token);
  if(!["paused","error"].includes(s.phase))return response(stats(s));
  s.phase=s.codes.length?"running":"preparing";s.lastError="";await st.put("rp:state",s);await st.setAlarm(Date.now()+100);return response(stats(s))
 }
 if(path==="/rp/export"&&request.method==="GET"){
  const u=new URL(request.url),year=u.searchParams.get("year")||"",part=Math.min(999,+u.searchParams.get("part")||1);
  const selectedPriority=u.searchParams.get("priority")||"1";
  if(!/^(200\d|201\d|202\d|203\d)$/.test(year)||year<s.start.slice(0,4)||year>s.end.slice(0,4)||
   !/^[1-4]$/.test(selectedPriority)||!s.stages.includes(+selectedPriority)||part<1)
   return response({ok:false,error:"請選正確年度／研究批次／股票分包"},400);
  const datasets=RESEARCH_DATASETS.filter(x=>x.priority===+selectedPriority&&!["special_endpoint","needs_verified_contract_codes","minute"].includes(x.scope));
  const partSize=Math.max(10,Math.min(60,Math.floor(800/Math.max(1,datasets.length))));
  const stockCodes=s.codes.slice((part-1)*partSize,part*partSize).map(x=>x.code);
  if(!stockCodes.length)return response({ok:false,error:"這個分包沒有股票"},404);
  const entries=[],manifest={schema:"research-pack-partial-v1",createdAt:new Date().toISOString(),year,part,partSize,
    stocks:stockCodes,datasets:[],source:"FinMind",scope:s.universeSource,pointInTimeVerified:false,
    actualDownloadedThrough:s.observedLatest||null,allRowsComplete:false,failures:[],warnings:[
    "Archive can be interrupted. Verify ZIP CRC, GZIP and manifest. Year and stock partitions are independent.",
    "Fundamental report period != publication time. Unknown availability is not valid intraday information.",
    "Shares, lots, TWD and thousands of TWD are source-specific; do not conflate them.",
    "Adjusted prices may use future corporate action information (no lookahead allowed in signals)."]};
  for(const ds of datasets){
   const codes=scopedCodes(s,ds);
   const pick=ds.scope==="global"?[""]:codes.filter(code=>stockCodes.includes(code));
   for(const code of pick){
    const meta=await st.get(taskKey(ds.name,code,year));
    if(!meta||meta.status==="failed"){
     manifest.failures.push({dataset:ds.name,code,year,status:meta?.status||"not_downloaded",reason:meta?.reason||"not in finished cache"});
     continue
    }
    const name=ds.group+"/"+ds.name+"/"+(code||"GLOBAL")+"_"+year+".csv.gz";
    entries.push({name,open:()=>dataNode(env,s.id,ds,code).fetch(DO_ROOT+"get-years?startYear="+year+"&endYear="+year)});
    manifest.datasets.push({file:name,...meta})
   }
  }
  entries.unshift({name:"10_metadata/manifest.json",open:()=>Promise.resolve(new Response(JSON.stringify(manifest,null,2)+"\n"))});
  return new Response(streamZip64(entries),{headers:{"content-type":"application/zip",
   "content-disposition":'attachment; filename="TW_Research_'+selectedPriority+'_'+year+'_P'+part+'.zip"',
   "cache-control":"private, no-store"}})
 }
 return response({ok:false,error:"未知研究任務功能"},404)
}
export async function researchPackRoute(request,env){
 const u=new URL(request.url),op=u.pathname.slice("/api/research-pack/".length);
 if(op==="catalog"&&request.method==="GET")return response({ok:true,datasets:RESEARCH_DATASETS,
  currentScope:"default futures-eligible via TAIFEX or current all-market incl delisting",
  caveats:["not all dataset publication timestamps exist","historic futures eligibility not verified"]});
 const id=cookies(request);
 if(op==="start"&&request.method==="POST"){
  const job=id||newId();
  const obj=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName("research-pack:"+job));
  const q=await request.json().catch(()=>({}));
  const upstream=await obj.fetch(new Request(JOB_ROOT+"start",{method:"POST",
   headers:{authorization:request.headers.get("authorization")||""},
   body:JSON.stringify({...q,id:job})}));
  return new Response(upstream.body,{status:upstream.status,headers:{
   "content-type":"application/json; charset=utf-8","cache-control":"no-store",
   "set-cookie":cookieName+"="+job+"; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=10368000"}})
 }
 if(!id)return response({ok:false,error:"本瀏覽器尚無研究下載任務"},401);
 const obj=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName("research-pack:"+id));
 if(["status","manifest","export"].includes(op)&&request.method==="GET")
  return obj.fetch(JOB_ROOT+op+u.search);
 if(["pause","resume"].includes(op)&&request.method==="POST")
  return obj.fetch(new Request(JOB_ROOT+op,{method:"POST",
   headers:{authorization:request.headers.get("authorization")||""}}));
 return response({ok:false,error:"不支援的研究下載操作"},404)
}
