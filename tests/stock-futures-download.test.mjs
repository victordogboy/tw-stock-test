import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {parseStockFutureUniverse,preferMiniStockFutures,parseTradingCalendar,firstDailyPriceDate,dailyPriceWindows,joinDailyChipRows,joinResearchRows,filterUnderlyingDailyBars,filterUnderlyingStockBars,filterStockFutureBars,stockFuturesRoute,StockFuturesBatch,StockFuturesData} from "../src/stock-futures-download.mjs";
class Store{constructor(){this.map=new Map()}async get(k){return this.map.get(k)}async put(k,v){this.map.set(k,v)}async deleteAll(){this.map.clear()}async deleteAlarm(){}async setAlarm(t){this.nextAlarm=t}}
function fixture(){
 const html=readFileSync(new URL("./fixtures/taifex-stockLists-2026-09-23.html",import.meta.url),"utf8");
 const catalog=parseStockFutureUniverse(html);
 const data=new Map();
 const ctx={storage:new Store(),blockConcurrencyWhile:fn=>fn()};
 const env={STOCK_FUTURES_DATA:{idFromName:x=>x,get:id=>{if(!data.has(id))data.set(id,new StockFuturesData({storage:new Store()},{}));return {fetch:r=>data.get(id).fetch(r instanceof Request?r:new Request(r))}}},
 STOCK_FUTURES_BATCH:{idFromName:x=>x,get:()=>({fetch:r=>job.fetch(r instanceof Request?r:new Request(r))})}};
 const job=new StockFuturesBatch(ctx,env);
 return {catalog,ctx,job,env,html}
}
const host="https://example.com";
const bar=(date,minute,code="CDF",contract_date="202101",volume=80)=>({date,minute,futures_id:code,contract_date,open:600,high:602,low:599,close:601,volume});
test("TAIFEX fixture produces verified stock-futures-only universe, including normal and mini contract",()=>{
 const {catalog}=fixture(),map=new Map(catalog.map(x=>[x.code,x]));
 assert.ok(catalog.length>=100);
 assert.equal(map.get("CDF").stock,"2330");
 assert.equal(map.get("CDF").units,2000);
 assert.equal(map.get("QFF").stock,"2330");
 assert.equal(map.get("QFF").units,100);
 assert.equal(map.get("CDF").night,true);
 assert.ok(!map.has("RIF"),"ETF RI must be excluded");
 assert.ok(!map.has("TX"),"TX must be excluded");
 assert.equal(new Set(catalog.map(x=>x.code)).size,catalog.length);
});
test("KBar strictly matches stock futures code, validates minutes, removes duplicated rows, retains volume",()=>{
 const x=filterStockFutureBars([bar("2021-01-01","08:45:00","CDF","202101",80),bar("2021-01-01","08:45:00","CDF","202101",80),bar("2021-01-01","09:00:00","MTX"),bar("2021-01-01","17:25:00","CDF","202101",70),bar("2021-01-01","09:00:00","CDF","202101/202102"),bar("2021-01-01","15:02:00","CDF")],"CDF","2021-01-01",{stock:"2330",units:2000,night:true});
 assert.equal(x.audit.rows,2);assert.equal(x.audit.day,1);assert.equal(x.audit.night,1);
 assert.equal(x.audit.rawVolume,150);assert.equal(x.audit.duplicates,1);
 assert.equal(x.audit.rejectedProduct,1);assert.equal(x.audit.rejectedContract,1);assert.equal(x.audit.rejectedInvalid,1);
 assert.match(x.csv,/,CDF,2330,2000,202101/);assert.doesNotMatch(x.csv,/MTX/);
});

test("one stock has only one chosen contract: 100-share mini replaces 2,000-share standard",()=>{
 const {catalog}=fixture(),preferred=preferMiniStockFutures(catalog);
 assert.equal(new Set(preferred.map(x=>x.stock)).size,preferred.length);
 assert.ok(preferred.some(x=>x.code==="QFF"&&x.stock==="2330"&&x.units===100));
 assert.ok(!preferred.some(x=>x.code==="CDF"));
 assert.ok(preferred.some(x=>x.code==="CCF"&&x.stock==="2303"&&x.units===2000));
 for(const stock of new Set(catalog.map(x=>x.stock))){
  const minis=catalog.filter(x=>x.stock===stock&&x.units===100);
  if(minis.length)assert.equal(preferred.find(x=>x.stock===stock).units,100);
 }
});
test("strict near month per session: far K never fills a missing near-month minute",()=>{
 const d="2026-10-20",m={stock:"2330",units:100,night:true};
 const bars=[
  bar(d,"00:01:00","QFF","202610",1),
  bar(d,"00:02:00","QFF","202611",11),
  bar(d,"08:45:00","QFF","202611",100),
  bar(d,"08:46:00","QFF","202610",21),
  bar(d,"08:46:00","QFF","202611",22),
  bar(d,"17:25:00","QFF","202611",7),
  bar(d,"17:26:00","QFF","202612",8)
 ];
 const x=filterStockFutureBars(bars,"QFF",d,m);
 assert.equal(x.audit.rows,3);
 assert.equal(x.audit.rawVolume,29);
 assert.equal(x.audit.rejectedFarMonth,4);
 assert.deepEqual(x.csv.trim().split("\n").map(x=>x.split(",")[1]),["00:01:00","08:46:00","17:25:00"]);
 assert.ok(!x.csv.includes("08:45:00"));
 assert.match(x.csv,/17:25:00,night,QFF,2330,100,202611/);
 assert.match(x.csv,/08:46:00,day,QFF,2330,100,202610/);
});
test("expired previous calendar-month contract is not used, even when returned by the upstream API",()=>{
 const x=filterStockFutureBars([bar("2026-11-02","08:45:00","QFF","202610"),bar("2026-11-02","08:46:00","QFF","202611")],"QFF","2026-11-02",{stock:"2330",units:100,night:true});
 assert.equal(x.audit.rows,1);
 assert.equal(x.audit.rejectedContract,1);
 assert.match(x.csv,/202611/);
});
test("catalog endpoint lists one futures code per stock and marks mini priority",async()=>{
 const x=fixture(),orig=globalThis.fetch;
 globalThis.fetch=async()=>new Response(x.html,{status:200});
 try{
  const res=await stockFuturesRoute(new Request(host+"/api/stock-futures/catalog"),x.env);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.ok(body.rawCount>body.count);
  assert.equal(body.policy,"one-stock-mini-first-nearest-expiry");
  assert.equal(new Set(body.catalog.map(x=>x.stock)).size,body.catalog.length);
  assert.ok(body.catalog.find(x=>x.stock==="2330").code==="QFF");
 }finally{globalThis.fetch=orig}
});
test("S tier uses explicit one-code one-day FinMind calls; Saturday 00-05 and annual multi-symbol gzip included",async()=>{
 const x=fixture(),orig=globalThis.fetch,queries=[];
 globalThis.fetch=async(url,opt)=>{
  const target=String(url);
  if(target.includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(target),date=u.searchParams.get("start_date"),code=u.searchParams.get("data_id");
  assert.equal(u.searchParams.get("dataset"),"TaiwanFuturesKBar");
  assert.ok(["CCF","QFF"].includes(code));
  assert.equal(opt.headers.authorization,"Bearer test-sponsor-token");
  queries.push([code,date]);
  const data=date==="2021-01-01"?[bar(date,"17:25:00",code,"202101",80)]:date==="2021-01-02"?[bar(date,"00:02:00",code,"202101",60)]:[];
  return Response.json({status:200,data})
 };
 try{
  const start=await stockFuturesRoute(new Request(host+"/api/stock-futures/start",{method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},body:JSON.stringify({start:"2021-01-01",end:"2021-01-02",codes:["CDF","CCF"]})}),x.env);
  assert.equal(start.status,202);
  const cookie=start.headers.get("set-cookie").split(";")[0];
  assert.match(cookie,/__Host-sf5y=/);
  const payload=await start.json();
  assert.equal(payload.codeCount,2);assert.equal(payload.total,4);
  assert.equal(JSON.stringify(payload).includes("test-sponsor-token"),false);
  await x.job.alarm();
  assert.deepEqual(queries.sort(),[["CCF","2021-01-01"],["CCF","2021-01-02"],["QFF","2021-01-01"],["QFF","2021-01-02"]].sort());
  const state=await (await stockFuturesRoute(new Request(host+"/api/stock-futures/status",{headers:{cookie}}),x.env)).json();
  assert.equal(state.phase,"done");assert.equal(state.processed,4);assert.equal(state.rows,4);assert.equal(state.night,4);
  const output=await stockFuturesRoute(new Request(host+"/api/stock-futures/export?year=2021",{headers:{cookie}}),x.env);
  assert.equal(output.status,200);
  const plain=gunzipSync(Buffer.from(await output.arrayBuffer())).toString();
  assert.equal(plain.split("\n").filter(Boolean).length,5);
  assert.match(plain,/2021-01-02,00:02:00,night,CCF,2303,2000/);
  assert.match(plain,/2021-01-02,00:02:00,night,QFF,2330,100/);
  const one=await stockFuturesRoute(new Request(host+"/api/stock-futures/export?code=QFF",{headers:{cookie}}),x.env);
  assert.equal(gunzipSync(Buffer.from(await one.arrayBuffer())).toString().split("\n").filter(Boolean).length,3);
  const unauthorized=await stockFuturesRoute(new Request(host+"/api/stock-futures/status"),x.env);
  assert.equal(unauthorized.status,401)
 }finally{globalThis.fetch=orig}
});

test("underlying-equity minutes retain official raw lot volume and 13:33/14:30 cash closing bars",()=>{
 const meta={name:"台積電",stock:"2330",futureCode:"QFF"};
 const a=(minute,volume=1.25,stock_id="2330")=>({date:"2026-10-23",minute,stock_id,open:1100,high:1102,low:1099,close:1101,volume});
 const x=filterUnderlyingStockBars([a("09:01:00",1.25),a("09:00:00",2),a("13:33:00",4),a("14:30:00",3),
   a("09:00:00",2),a("09:02:00",5,"2303"),a("17:25:00",6)],"2330","2026-10-23",meta);
 assert.equal(x.audit.rows,4);assert.equal(x.audit.day,4);assert.equal(x.audit.night,0);
 assert.equal(x.audit.rawVolume,10.25);assert.equal(x.audit.duplicates,1);
 assert.equal(x.audit.rejectedProduct,1);assert.equal(x.audit.rejectedInvalid,1);
 assert.equal(x.csv.trim().split("\n").length,4);
 assert.match(x.csv,/2026-10-23,09:00:00,2330,台積電,QFF,1100,1102,1099,1101,2/);
 assert.match(x.csv,/13:33:00/);assert.match(x.csv,/14:30:00/);
 assert.ok(!x.csv.includes("17:25:00"));assert.ok(!x.csv.includes(",2303,"));
});
test("equity 1-minute duplicates with conflicting prices are rejected",()=>{
 const a={date:"2026-10-23",minute:"09:00:00",stock_id:"2330",open:1100,high:1102,low:1099,close:1101,volume:1};
 assert.throws(()=>filterUnderlyingStockBars([a,{...a,close:1100}],"2330","2026-10-23",{name:"台積電",futureCode:"QFF"}),/矛盾/);
});
test("stock 1-minute API uses TaiwanStockKBar by stock_id, avoids weekend and exports cash-equity OHLCV",async()=>{
 const x=fixture(),orig=globalThis.fetch,queries=[],metaQueries=[];
 globalThis.fetch=async(url,opt)=>{
  const target=String(url);
  if(target.includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(target),dataset=u.searchParams.get("dataset");
  if(dataset==="TaiwanStockTradingDate"){
   const data=[];
   for(let t=Date.parse("2019-01-01");t<=Date.parse("2022-12-31");t+=86400000){
    const day=new Date(t).toISOString().slice(0,10),weekday=new Date(t).getUTCDay();
    if(weekday!==0&&weekday!==6)data.push({date:day});
   }
   return Response.json({status:200,data});
  }
  if(dataset==="TaiwanStockPrice"){
   metaQueries.push(u.searchParams.get("data_id"));
   return Response.json({status:200,data:[
    {date:"2021-01-01",stock_id:u.searchParams.get("data_id"),close:100},
    {date:"2021-01-04",stock_id:u.searchParams.get("data_id"),close:101}
   ]});
  }
  assert.equal(dataset,"TaiwanStockKBar");
  const d=u.searchParams.get("start_date"),stock=u.searchParams.get("data_id");
  assert.ok(["2330","2303"].includes(stock));
  assert.equal(opt.headers.authorization,"Bearer test-sponsor-token");
  queries.push([stock,d]);
  const data=[{stock_id:stock,date:d,minute:"09:00:00",open:100,high:102,low:99,close:101,volume:1.5}];
  return Response.json({status:200,data});
 };
 try{
  const catalogResponse=await stockFuturesRoute(new Request(host+"/api/stock-kbar/catalog"),x.env,"stocks");
  assert.equal(catalogResponse.status,200);
  const cat=await catalogResponse.json();
  assert.equal(cat.dataset,"TaiwanStockKBar");
  assert.equal(cat.policy,"unique-underlying-cash-stock");
  assert.ok(cat.catalog.some(c=>c.stock==="2330"&&c.code==="2330"));
  assert.equal(cat.catalog.length,new Set(cat.catalog.map(c=>c.code)).size);
  const args={start:"2021-01-01",end:"2021-01-04",codes:["2330","2303"]};
  const result=await stockFuturesRoute(new Request(host+"/api/stock-kbar/start",{method:"POST",
   headers:{authorization:"Bearer test-sponsor-token",origin:host},body:JSON.stringify(args)}),x.env,"stocks");
  assert.equal(result.status,202);
  const cookie=result.headers.get("set-cookie").split(";")[0];
  assert.match(cookie,/__Host-underlying1m=/);
  const body=await result.json();
  assert.equal(body.mode,"stocks");assert.equal(body.codeCount,2);
  assert.equal(body.total,4); // Jan 1 Friday, Jan 4 Monday, Jan 2/3 weekends skipped
  await x.job.alarm(); // one official trading-calendar request
  await x.job.alarm(); // two full-period daily-price probes
  await x.job.alarm(); // 1-minute download starts
  assert.deepEqual(metaQueries.sort(),["2303","2330"]);
  assert.deepEqual(queries.sort(),[["2330","2021-01-01"],["2303","2021-01-01"],["2330","2021-01-04"],["2303","2021-01-04"]].sort());
  const status=await (await stockFuturesRoute(new Request(host+"/api/stock-kbar/status",{headers:{cookie}}),x.env,"stocks")).json();
  assert.equal(status.phase,"done");assert.equal(status.rows,4);
  assert.equal(status.night,0);assert.equal(status.dataset,"TaiwanStockKBar");assert.equal(status.rateLimitPerHour,4800);assert.equal(status.preflightDone,2);assert.ok(status.calendarVerified);
  const output=await stockFuturesRoute(new Request(host+"/api/stock-kbar/export?code=2330",{headers:{cookie}}),x.env,"stocks");
  assert.equal(output.status,200);
  const csv=gunzipSync(Buffer.from(await output.arrayBuffer())).toString();
  assert.match(csv,/date,minute,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_raw/);
  assert.match(csv,/2021-01-04,09:00:00,2330,.*QFF,100,102,99,101,1.5/);
  assert.ok(!csv.includes("contract_date"));
  assert.ok(!csv.includes(",2303,"));
  const wrongCookie=await stockFuturesRoute(new Request(host+"/api/stock-kbar/status",{headers:{cookie:cookie.replace("__Host-underlying1m","__Host-sf5y")}}),x.env,"stocks");
  assert.equal(wrongCookie.status,401);
 }finally{globalThis.fetch=orig}
});
test("validated trading calendar requires plausible source data; daily-price metadata cannot invent skips",()=>{
 const data=[];
 for(let t=Date.parse("2019-01-01");t<=Date.parse("2025-12-31");t+=86400000){
  const date=new Date(t).toISOString().slice(0,10),wd=new Date(t).getUTCDay();
  if(wd!==0&&wd!==6)data.push({date});
 }
 const parsed=parseTradingCalendar(data,"2021-01-01","2021-01-10");
 assert.equal(parsed.dates.length,6);
 assert.ok(parsed.dates.includes("2021-01-04"));
 assert.throws(()=>parseTradingCalendar([{date:"2021-01-04"}],"2021-01-01","2021-01-10"),/不完整/);
 assert.equal(firstDailyPriceDate([{date:"2023-01-05",stock_id:"2330"},{date:"2022-01-04",stock_id:"2330"}],"2330","2021-01-01","2024-01-01"),"2022-01-04");
 assert.equal(firstDailyPriceDate([{date:"2022-01-04",stock_id:"2317"}],"2330","2021-01-01","2024-01-01"),"");
});
test("skips verified holidays and dates before the first observed trade, without fabricated K-bars",async()=>{
 const x=fixture(),orig=globalThis.fetch,queries=[];
 globalThis.fetch=async(url)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url),dataset=u.searchParams.get("dataset");
  if(dataset==="TaiwanStockTradingDate"){
   const list=[];
   for(let t=Date.parse("2019-01-01");t<=Date.parse("2026-12-31");t+=86400000){
    const date=new Date(t).toISOString().slice(0,10),wd=new Date(t).getUTCDay();
    if(wd!==0&&wd!==6&&date!=="2024-01-03")list.push({date});
   }
   return Response.json({status:200,data:list});
  }
  if(dataset==="TaiwanStockPrice"){
   return Response.json({status:200,data:[{stock_id:"2330",date:"2024-01-04",close:100}]});
  }
  assert.equal(dataset,"TaiwanStockKBar");
  queries.push(u.searchParams.get("start_date"));
  return Response.json({status:200,data:[{stock_id:"2330",date:u.searchParams.get("start_date"),
   minute:"09:00:00",open:100,high:101,low:99,close:101,volume:10}]});
 };
 try{
  const resp=await stockFuturesRoute(new Request(host+"/api/stock-kbar/start",{method:"POST",
   headers:{authorization:"Bearer test-sponsor-token",origin:host},
   body:JSON.stringify({start:"2024-01-01",end:"2024-01-05",codes:["2330"]})}),x.env,"stocks");
  assert.equal(resp.status,202);
  await x.job.alarm();await x.job.alarm();await x.job.alarm();
  const state=await x.ctx.storage.get("state");
  assert.equal(state.phase,"done");
  assert.deepEqual(queries,["2024-01-04","2024-01-05"]);
  assert.equal(state.skipped,3);
  assert.equal(state.processed,5);
  assert.equal(state.rows,2);
  assert.equal(state.total,5);
 }finally{globalThis.fetch=orig}
});
test("existing in-flight cash-equity job keeps all downloaded rows and is upgraded in-place",async()=>{
 const x=fixture(),orig=globalThis.fetch,requests=[];
 globalThis.fetch=async(url)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url),dataset=u.searchParams.get("dataset");
  if(dataset==="TaiwanStockTradingDate"){
   // Failure must conservatively fall back to querying weekdays, never falsely skip.
   return Response.json({status:400,msg:"calendar unavailable",data:[]},{status:400});
  }
  if(dataset==="TaiwanStockPrice"){
   const stock=u.searchParams.get("data_id");
   return Response.json({status:200,data:[{stock_id:stock,date:"2024-01-02",close:100}]});
  }
  assert.equal(dataset,"TaiwanStockKBar");
  requests.push([u.searchParams.get("data_id"),u.searchParams.get("start_date")]);
  return Response.json({status:200,data:[{stock_id:u.searchParams.get("data_id"),date:u.searchParams.get("start_date"),minute:"09:00:00",open:100,high:100,low:100,close:100,volume:10}]});
 };
 try{
  const old={phase:"running",shardKey:"existing-shard",mode:"stocks",version:3,
   start:"2023-12-29",end:"2024-01-04",date:"2024-01-02",symbolIndex:0,
   catalog:[{code:"2330",stock:"2330",futureCode:"QFF",name:"台積電",night:false}],
   codes:[{code:"2330",stock:"2330",name:"台積電"}],total:5,processed:2,rows:270,
   night:0,nonempty:1,empty:0,duplicates:0,rejected:0,errors:[],queries:1,retries:0,
   createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+3600000};
  await x.ctx.storage.put("state",old);await x.ctx.storage.put("token","test-sponsor-token");
  await x.job.alarm(); // calendar fails, no skipped dates
  await x.job.alarm(); // daily-price IPO hint
  await x.job.alarm(); // remaining 3 trading dates
  const state=await x.ctx.storage.get("state");
  assert.equal(state.shardKey,"existing-shard");
  assert.equal(state.phase,"done");
  assert.equal(state.rows,273);
  assert.equal(state.processed,5);
  assert.equal(state.skipped||0,0);
  assert.deepEqual(requests.map(x=>x[1]),["2024-01-02","2024-01-03","2024-01-04"]);
 }finally{globalThis.fetch=orig}
});
test("daily 2000+ windows are contiguous and every FinMind call covers at most 8 years",()=>{
 assert.deepEqual(dailyPriceWindows("2000-01-01","2026-10-27"),[
  {start:"2000-01-01",end:"2007-12-31"},
  {start:"2008-01-01",end:"2015-12-31"},
  {start:"2016-01-01",end:"2023-12-31"},
  {start:"2024-01-01",end:"2026-10-27"}
 ]);
 assert.deepEqual(dailyPriceWindows("2021-01-01","2026-10-27"),[
  {start:"2021-01-01",end:"2026-10-27"}
 ]);
 assert.deepEqual(dailyPriceWindows("2000-07-01","2001-01-31"),[
  {start:"2000-07-01",end:"2001-01-31"}
 ]);
});
test("2000-era daily dates allowed, minute and futures remain restricted to 2021",async()=>{
 const x=fixture(),orig=globalThis.fetch;
 globalThis.fetch=async()=>new Response(x.html,{status:200});
 try{
  const payload={start:"2000-01-01",end:"2000-12-31",codes:["2330"]};
  const day=await stockFuturesRoute(new Request(host+"/api/stock-daily/start",{
   method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},body:JSON.stringify(payload)
  }),x.env,"daily");
  assert.equal(day.status,202);
  const json=await day.json();assert.equal(json.start,"2000-01-01");assert.equal(json.mode,"daily");
  const min=await stockFuturesRoute(new Request(host+"/api/stock-kbar/start",{
   method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},body:JSON.stringify(payload)
  }),x.env,"stocks");
  assert.equal(min.status,400);
  const old=await stockFuturesRoute(new Request(host+"/api/stock-daily/start",{
   method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},body:JSON.stringify({...payload,start:"1999-12-31"})
  }),x.env,"daily");
  assert.equal(old.status,400);
 }finally{globalThis.fetch=orig}
});
test("2000-to-2026 real daily workflow uses four 8-year requests per stock, retains 2000 CSV and 2026 CSV",async()=>{
 const x=fixture(),orig=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opt)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url),id=u.searchParams.get("data_id"),start=u.searchParams.get("start_date"),end=u.searchParams.get("end_date");
  assert.equal(u.searchParams.get("dataset"),"TaiwanStockPrice");assert.ok(["2330","2303"].includes(id));
  calls.push([id,start,end]);
  const year=start.slice(0,4),date=year+"-01-04";
  return Response.json({status:200,data:[{date,stock_id:id,open:100,max:103,min:99,close:102,
   Trading_Volume:1000,Trading_money:103000,Trading_turnover:20,spread:2}]});
 };
 try{
  const start=await stockFuturesRoute(new Request(host+"/api/stock-daily/start",{method:"POST",
   headers:{origin:host,authorization:"Bearer test-sponsor-token"},
   body:JSON.stringify({start:"2000-01-01",end:"2026-10-27",codes:["2330","2303"]})}),x.env,"daily");
  assert.equal(start.status,202);
  const cookie=start.headers.get("set-cookie").split(";")[0];
  await x.job.alarm();await x.job.alarm();
  const status=await(await stockFuturesRoute(new Request(host+"/api/stock-daily/status",{headers:{cookie}}),x.env,"daily")).json();
  assert.equal(status.phase,"done");assert.equal(status.codeCount,2);
  assert.equal(status.queries,8);assert.equal(status.rows,8);
  assert.equal(calls.filter(c=>c[0]==="2330").length,4);
  assert.deepEqual(calls.filter(c=>c[0]==="2330").map(c=>c.slice(1)),[
   ["2000-01-01","2007-12-31"],["2008-01-01","2015-12-31"],
   ["2016-01-01","2023-12-31"],["2024-01-01","2026-10-27"]
  ]);
  const fetchCSV=async(year)=>{
   const response=await stockFuturesRoute(new Request(host+"/api/stock-daily/export?year="+year,{headers:{cookie}}),x.env,"daily");
   assert.equal(response.status,200);return gunzipSync(Buffer.from(await response.arrayBuffer())).toString()
  };
  const y2000=await fetchCSV(2000);
  assert.ok(y2000.includes("date,stock_id"));
  assert.match(y2000,/2000-01-04,2330/);assert.match(y2000,/2000-01-04,2303/);
  const y2024=await fetchCSV(2024);
  assert.match(y2024,/2024-01-04,2330/);
  assert.ok(!y2024.includes("2000-01-04"));
  const all=await stockFuturesRoute(new Request(host+"/api/stock-daily/export?code=2330",{headers:{cookie}}),x.env,"daily");
  const data=gunzipSync(Buffer.from(await all.arrayBuffer())).toString();
  assert.equal(data.trim().split("\n").length,5);
  assert.match(data,/2000-01-04,2330/);assert.match(data,/2024-01-04,2330/);
 }finally{globalThis.fetch=orig}
});
test("chip merge correctly handles historical 2000 blank, old/new dealer categories, and financing lots",()=>{
 const stock="2330",price=filterUnderlyingDailyBars([
  {date:"2000-01-04",stock_id:stock,open:100,max:103,min:98,close:102,Trading_Volume:25000,Trading_money:2550000,Trading_turnover:200,spread:2},
  {date:"2005-01-05",stock_id:stock,open:101,max:105,min:100,close:104,Trading_Volume:25000,Trading_money:2550000,Trading_turnover:200,spread:2},
  {date:"2020-03-04",stock_id:stock,open:105,max:110,min:103,close:109,Trading_Volume:25000,Trading_money:2550000,Trading_turnover:200,spread:4}
 ],stock,"2000-01-01","2020-12-31",{name:"台積電",futureCode:"QFF"});
 const row=(date,name,buy,sell)=>({date,stock_id:stock,name,buy,sell});
 const ins=[row("2005-01-05","Foreign_Investor",2000,1000),row("2005-01-05","Investment_Trust",500,300),row("2005-01-05","Dealer",200,700),
  row("2020-03-04","Foreign_Investor",1000,1500),row("2020-03-04","Foreign_Dealer_Self",300,200),
  row("2020-03-04","Investment_Trust",600,200),
  row("2020-03-04","Dealer_self",300,100),row("2020-03-04","Dealer_Hedging",100,600)];
 const margin=(date)=>({date,stock_id:stock,MarginPurchaseBuy:123,MarginPurchaseSell:99,MarginPurchaseCashRepayment:2,MarginPurchaseTodayBalance:2000,MarginPurchaseYesterdayBalance:1975,
  ShortSaleBuy:40,ShortSaleSell:24,ShortSaleCashRepayment:1,ShortSaleTodayBalance:100,ShortSaleYesterdayBalance:97});
 const merged=joinDailyChipRows(price,ins,[margin("2020-03-04"),margin("2005-01-05")],stock,"2000-01-01","2020-12-31");
 assert.equal(merged.coverage.institutional,2);assert.equal(merged.coverage.margin,2);
 const columns=("date,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_shares,trading_money_twd,trading_turnover,spread,"
  +"institutional_available,institutional_foreign_buy_shares,institutional_foreign_sell_shares,institutional_foreign_net_shares,institutional_foreign_dealer_net_shares,"
  +"institutional_trust_buy_shares,institutional_trust_sell_shares,institutional_trust_net_shares,institutional_dealer_buy_shares,institutional_dealer_sell_shares,"
  +"institutional_dealer_net_shares,institutional_dealer_self_net_shares,institutional_dealer_hedge_net_shares,margin_available,"
  +"margin_buy_lots,margin_sell_lots,margin_cash_repayment_lots,margin_balance_lots,margin_previous_balance_lots,margin_change_lots,"
  +"short_buy_lots,short_sell_lots,short_cash_repayment_lots,short_balance_lots,short_previous_balance_lots,short_change_lots,chip_signal_use_next_session").split(",");
 const decode=(year)=>Object.fromEntries(merged.csvByYear[year].trim().split(",").map((v,i)=>[columns[i],v]));
 const y2000=decode("2000");assert.equal(y2000.institutional_available,"0");assert.equal(y2000.margin_available,"0");
 assert.equal(y2000.institutional_foreign_net_shares,"");assert.equal(y2000.margin_balance_lots,"");
 const y2005=decode("2005");assert.equal(y2005.institutional_dealer_net_shares,"-500");
 assert.equal(y2005.institutional_foreign_net_shares,"1000");
 const y2020=decode("2020");assert.equal(y2020.institutional_foreign_net_shares,"-400");
 assert.equal(y2020.institutional_dealer_net_shares,"-300");
 assert.equal(y2020.institutional_dealer_self_net_shares,"200");
 assert.equal(y2020.institutional_dealer_hedge_net_shares,"-500");
 assert.equal(y2020.margin_change_lots,"25");assert.equal(y2020.short_change_lots,"3");
 assert.equal(y2020.chip_signal_use_next_session,"1");
 assert.equal(columns.length,merged.csvByYear["2020"].trim().split(",").length);
});
test("combined daily job uses three dataset families and deliberately skips pre-2001/2005 requests",async()=>{
 const x=fixture(),orig=globalThis.fetch,queries=[];
 const price=(stock,date)=>({date,stock_id:stock,open:100,max:104,min:99,close:103,Trading_Volume:5000,Trading_money:500000,Trading_turnover:3,spread:3});
 globalThis.fetch=async(url)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url),dataset=u.searchParams.get("dataset"),stock=u.searchParams.get("data_id");
  assert.equal(stock,"2330");queries.push({dataset,start:u.searchParams.get("start_date"),end:u.searchParams.get("end_date")});
  if(dataset==="TaiwanStockPrice")return Response.json({status:200,data:[price(stock,u.searchParams.get("start_date").slice(0,4)+"-01-04")]});
  if(dataset==="TaiwanStockInstitutionalInvestorsBuySell")return Response.json({status:200,data:[
   {date:"2005-01-05",stock_id:stock,name:"Dealer",buy:3000,sell:2000},
   {date:"2005-01-05",stock_id:stock,name:"Investment_Trust",buy:1000,sell:500}
  ]});
  if(dataset==="TaiwanStockMarginPurchaseShortSale")return Response.json({status:200,data:[
   {date:"2005-01-05",stock_id:stock,MarginPurchaseTodayBalance:30,MarginPurchaseYesterdayBalance:29,ShortSaleTodayBalance:8,ShortSaleYesterdayBalance:9}
  ]});
  throw Error("unexpected "+dataset)
 };
 try{
  const start=await stockFuturesRoute(new Request(host+"/api/stock-daily-chip/start",{method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},
   body:JSON.stringify({start:"2000-01-01",end:"2007-12-31",codes:["2330"]})}),x.env,"daily-chip");
  assert.equal(start.status,202);assert.match(start.headers.get("set-cookie"),/__Host-underlying-chip=/);
  const cookie=start.headers.get("set-cookie").split(";")[0];
  await x.job.alarm();
  const status=await(await stockFuturesRoute(new Request(host+"/api/stock-daily-chip/status",{headers:{cookie}}),x.env,"daily-chip")).json();
  assert.equal(status.phase,"done");assert.equal(status.mode,"daily-chip");assert.equal(status.queries,3);
  assert.deepEqual(queries.map(x=>[x.dataset,x.start,x.end]),[
   ["TaiwanStockPrice","2000-01-01","2007-12-31"],
   ["TaiwanStockInstitutionalInvestorsBuySell","2005-01-01","2007-12-31"],
   ["TaiwanStockMarginPurchaseShortSale","2001-01-01","2007-12-31"]
  ]);
  const result=await stockFuturesRoute(new Request(host+"/api/stock-daily-chip/export?year=2000",{headers:{cookie}}),x.env,"daily-chip");
  assert.equal(result.status,200);
  const csv=gunzipSync(Buffer.from(await result.arrayBuffer())).toString();
  assert.match(csv,/institutional_foreign_net_shares/);
  assert.match(csv,/margin_balance_lots/);
  assert.match(csv,/2000-01-04,2330/);
  assert.equal(csv.split("\n")[1].split(",")[12],"0");
  const unauthorized=await stockFuturesRoute(new Request(host+"/api/stock-daily-chip/status",{headers:{cookie:cookie.replace("__Host-underlying-chip","__Host-underlying-day")}}),x.env,"daily-chip");
  assert.equal(unauthorized.status,401);
 }finally{globalThis.fetch=orig}
});
test("old daily jobs still show unmodified OHLCV-only format",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/id="includeChips"/);assert.match(html,/api\/stock-daily-chip/);
 assert.match(html,/api\/stock-daily"/);
 assert.match(html,/api\/stock-kbar/);
});
test("research join keeps 2000 historic source gaps blank and distinguishes lending transactions vs ownership",()=>{
 const stock="2330",start="2000-01-01",end="2026-01-06";
 const price=(date)=>({date,stock_id:stock,open:100,max:110,min:90,close:103,Trading_Volume:1000,Trading_money:100000,Trading_turnover:50,spread:3});
 const prices=filterUnderlyingDailyBars([price("2000-01-04"),price("2026-01-05")],stock,start,end,{name:"台積電",futureCode:"QFF"});
 const old=joinDailyChipRows(prices,[{date:"2026-01-05",stock_id:stock,name:"Foreign_Investor",buy:1000,sell:200}],
  [{date:"2026-01-05",stock_id:stock,MarginPurchaseTodayBalance:100,MarginPurchaseYesterdayBalance:90,
  ShortSaleTodayBalance:10,ShortSaleYesterdayBalance:7}],stock,start,end);
 const holding=[{date:"2026-01-05",stock_id:stock,ForeignInvestmentShares:900000000,
  ForeignInvestmentSharesRatio:78.25,ForeignInvestmentRemainRatio:21.75,NumberOfSharesIssued:1200000000}];
 const loans=[{date:"2026-01-05",stock_id:stock,transaction_type:"議借",volume:160,fee_rate:0.36},
   {date:"2026-01-05",stock_id:stock,transaction_type:"競價",volume:40,fee_rate:0.2}];
 const contracts=[{date:"2026-01-05",futures_id:"QFF",contract_date:"202601",trading_session:"position",volume:100,open_interest:150},
  {date:"2026-01-05",futures_id:"CDF",contract_date:"202601",trading_session:"position",volume:999,open_interest:900},
  {date:"2026-01-05",futures_id:"QFF",contract_date:"202602",trading_session:"position",volume:5,open_interest:12},
  {date:"2026-01-05",futures_id:"TX",contract_date:"202601",trading_session:"position",volume:99999,open_interest:99999}];
 const data=joinResearchRows(prices,old,holding,loans,contracts,stock,start,end,["QFF","CDF"],"QFF");
 const get=(year)=>data.csvByYear[year].trim().split(",");
 const oldCols=get("2000"),now=get("2026");
 // The first 39 columns contain the existing 12 daily and 27 chip fields.
 assert.equal(oldCols.length,58);assert.equal(now.length,58);
 assert.equal(data.coverage.missingForeignHolding,1);
 assert.equal(data.coverage.foreignHolding,1);
 assert.equal(data.coverage.lendingTrades,1);
 assert.equal(data.coverage.futuresObservations,1);
 assert.equal(oldCols[39],"0");assert.equal(oldCols[40],"");
 assert.equal(oldCols[44],"0");assert.equal(oldCols[45],"");
 assert.equal(oldCols[49],"0");
 assert.equal(now[39],"1");assert.equal(now[41],"78.25");
 assert.equal(now[44],"1");assert.equal(now[45],"2");assert.equal(now[46],"200");
 assert.equal(now[48],"0.328"); // weighted fee; not lending balance
 assert.equal(now[49],"1");assert.equal(now[50],"CDF|QFF");
 assert.equal(now[52],"QFF");assert.equal(now[53],"202601");
 assert.equal(now[54],"100");assert.equal(now[55],"150");
 assert.equal(now[56],"1");assert.equal(now[57],"1");

});
test("research API fetches lending, ownership and both active futures symbol codes; old daily jobs isolated",async()=>{
 const x=fixture(),previous=globalThis.fetch,queries=[];
 const price=(stock,d)=>({date:d,stock_id:stock,open:100,max:104,min:99,close:102,
  Trading_Volume:1000,Trading_money:100000,Trading_turnover:2,spread:2});
 globalThis.fetch=async(url,opt)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url),dataset=u.searchParams.get("dataset"),data_id=u.searchParams.get("data_id");
  queries.push({dataset,data_id,start:u.searchParams.get("start_date")});
  assert.equal(opt.headers.authorization,"Bearer test-sponsor-token");
  if(dataset==="TaiwanStockPrice")return Response.json({status:200,data:[price("2330","2026-01-05")]});
  if(dataset==="TaiwanStockInstitutionalInvestorsBuySell")return Response.json({status:200,data:[]});
  if(dataset==="TaiwanStockMarginPurchaseShortSale")return Response.json({status:200,data:[]});
  if(dataset==="TaiwanStockShareholding")return Response.json({status:200,data:[
   {date:"2026-01-05",stock_id:"2330",ForeignInvestmentShares:10000,ForeignInvestmentSharesRatio:50,
    ForeignInvestmentRemainRatio:50,NumberOfSharesIssued:20000}]});
  if(dataset==="TaiwanStockSecuritiesLending")return Response.json({status:200,data:[
   {date:"2026-01-05",stock_id:"2330",volume:4,fee_rate:0.4,transaction_type:"議借"}]});
  if(dataset==="TaiwanFuturesDaily")return Response.json({status:200,data:[
   {date:"2026-01-05",futures_id:data_id,contract_date:"202601",trading_session:"position",volume:data_id==="QFF"?11:100,open_interest:13}]});
  throw Error("unexpected dataset "+dataset)
 };
 try{
  const res=await stockFuturesRoute(new Request(host+"/api/stock-daily-research/start",{method:"POST",
   headers:{authorization:"Bearer test-sponsor-token",origin:host},
   body:JSON.stringify({start:"2026-01-01",end:"2026-01-06",codes:["2330"]})}),x.env,"daily-research");
  assert.equal(res.status,202);
  const cookie=res.headers.get("set-cookie").split(";")[0];
  assert.match(cookie,/__Host-stock-research=/);
  const started=await res.json();assert.equal(started.mode,"daily-research");
  await x.job.alarm();
  const state=await (await stockFuturesRoute(new Request(host+"/api/stock-daily-research/status",{headers:{cookie}}),x.env,"daily-research")).json();
  assert.equal(state.phase,"done");assert.equal(state.rows,1);
  assert.ok(queries.some(q=>q.dataset==="TaiwanStockShareholding"));
  assert.ok(queries.some(q=>q.dataset==="TaiwanStockSecuritiesLending"));
  assert.deepEqual(queries.filter(q=>q.dataset==="TaiwanFuturesDaily").map(q=>q.data_id).sort(),["CDF","QFF"]);
  const csvRes=await stockFuturesRoute(new Request(host+"/api/stock-daily-research/export?year=2026",{headers:{cookie}}),x.env,"daily-research");
  assert.equal(csvRes.status,200);
  const csv=gunzipSync(Buffer.from(await csvRes.arrayBuffer())).toString();
  assert.match(csv,/foreign_holding_ratio_pct/);assert.match(csv,/lending_weighted_fee_pct/);
  assert.match(csv,/futures_observed_contract_months/);
  assert.match(csv,/2026-01-05,2330/);
  const unauthorized=await stockFuturesRoute(new Request(host+"/api/stock-daily-research/status",{headers:{cookie:cookie.replace("__Host-stock-research","__Host-underlying-chip")}}),x.env,"daily-research");
  assert.equal(unauthorized.status,401);
 }finally{globalThis.fetch=previous}
});
test("research UI is visible and existing daily/minute mode routes remain distinct",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/id="includeResearch"/);assert.match(html,/api\/stock-daily-research/);
 assert.match(html,/api\/stock-daily-chip/);assert.match(html,/api\/stock-kbar/);
 assert.match(html,/futures_observed/);
});
test("daily OHLCV follows TaiwanStockPrice field names, raw shares, all years, and emerging open exceptions",()=>{
 const meta={name:"台積電",futureCode:"QFF"};
 const bar=(date,close,stock_id="2330")=>({date,stock_id,open:98,max:102,min:99,close,Trading_Volume:12345,Trading_money:1234500,Trading_turnover:250,spread:-1});
 const result=filterUnderlyingDailyBars([
  bar("2022-01-04",100),bar("2021-01-04",99),bar("2021-01-04",99),
  bar("2021-01-05",100,"2317"),bar("2020-12-31",100)
 ],"2330","2021-01-01","2022-12-31",meta);
 assert.equal(result.audit.rows,2);assert.equal(result.audit.duplicates,1);assert.equal(result.audit.rejectedProduct,1);
 assert.equal(result.audit.rejectedInvalid,1);assert.equal(result.audit.rawVolume,24690);
 assert.match(result.csvByYear["2021"],/2021-01-04,2330,台積電,QFF,98,102,99,99,12345,1234500,250,-1/);
 assert.ok(!result.csvByYear["2021"].includes("2317"));
 assert.match(result.csvByYear["2022"],/2022-01-04/);
 const conflict=bar("2021-01-04",100);
 assert.throws(()=>filterUnderlyingDailyBars([bar("2021-01-04",99),conflict],"2330","2021-01-01","2021-12-31",meta),/矛盾/);
});
test("daily job makes one FinMind TaiwanStockPrice call per stock for multiple years and exports by year",async()=>{
 const x=fixture(),orig=globalThis.fetch,calls=[];
 const mock=(stock,date,close)=>({date,stock_id:stock,open:98,max:102,min:97,close,Trading_Volume:15000,Trading_money:1500000,Trading_turnover:25,spread:1});
 globalThis.fetch=async(url,opt)=>{
  if(String(url).includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(url);
  assert.equal(u.searchParams.get("dataset"),"TaiwanStockPrice");
  assert.equal(u.searchParams.get("start_date"),"2021-01-01");
  assert.equal(u.searchParams.get("end_date"),"2022-01-15");
  const stock=u.searchParams.get("data_id");assert.ok(["2330","2303"].includes(stock));
  assert.equal(opt.headers.authorization,"Bearer test-sponsor-token");
  calls.push(stock);
  return Response.json({status:200,data:[
   mock(stock,"2021-01-04",100),mock(stock,"2021-01-05",101),mock(stock,"2022-01-03",99)]});
 };
 try{
  const catalog=await(await stockFuturesRoute(new Request(host+"/api/stock-daily/catalog"),x.env,"daily")).json();
  assert.equal(catalog.dataset,"TaiwanStockPrice");assert.equal(catalog.policy,"unique-underlying-cash-stock");
  const res=await stockFuturesRoute(new Request(host+"/api/stock-daily/start",{method:"POST",
   headers:{authorization:"Bearer test-sponsor-token",origin:host},
   body:JSON.stringify({start:"2021-01-01",end:"2022-01-15",codes:["2330","2303"]})}),x.env,"daily");
  assert.equal(res.status,202);
  const cookie=res.headers.get("set-cookie").split(";")[0];assert.match(cookie,/__Host-underlying-day=/);
  const started=await res.json();assert.equal(started.total,2);assert.equal(started.mode,"daily");
  await x.job.alarm();
  assert.deepEqual(calls.sort(),["2303","2330"]);
  const status=await(await stockFuturesRoute(new Request(host+"/api/stock-daily/status",{headers:{cookie}}),x.env,"daily")).json();
  assert.equal(status.phase,"done");assert.equal(status.processed,2);assert.equal(status.rows,6);assert.equal(status.queries,2);
  const year=await stockFuturesRoute(new Request(host+"/api/stock-daily/export?year=2021",{headers:{cookie}}),x.env,"daily");
  assert.equal(year.status,200);
  const y=gunzipSync(Buffer.from(await year.arrayBuffer())).toString();
  assert.equal(y.trim().split("\n").length,5); // one header + 2 days x 2 stocks
  assert.match(y,/volume_shares,trading_money_twd,trading_turnover,spread/);
  assert.match(y,/2021-01-04,2330,.*QFF,98,102,97,100,15000,1500000,25,1/);
  assert.ok(!y.includes("2022-01-03"));
  const one=await stockFuturesRoute(new Request(host+"/api/stock-daily/export?code=2330",{headers:{cookie}}),x.env,"daily");
  const full=gunzipSync(Buffer.from(await one.arrayBuffer())).toString();
  assert.equal(full.trim().split("\n").length,4); // one header + three days
  assert.match(full,/2022-01-03,2330/);
  assert.equal(full.match(/date,stock_id/g)?.length,1);
  const wrongCookie=await stockFuturesRoute(new Request(host+"/api/stock-daily/status",{headers:{cookie:cookie.replace("__Host-underlying-day","__Host-underlying1m")}}),x.env,"daily");
  assert.equal(wrongCookie.status,401);
 }finally{globalThis.fetch=orig}
});
test("daily-mode main UI defaults to daily and retains separate minute API and progress",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/<option value="day" selected>/);
 assert.match(html,/<option value="minute">/);
 assert.match(html,/value="2000-01-01" min="2000-01-01"/);
 assert.match(html,/2021-01-01/);
 assert.match(html,/api\/stock-daily/);
 assert.match(html,/api\/stock-kbar/);
 assert.match(html,/granularity/);
});
test("1-minute download UI can pair independent daily institution/margin or full research datasets",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 const script=html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(script,"embedded UI script missing");
 assert.doesNotThrow(()=>new Function(script),"UI JavaScript must parse");
 assert.match(html,/id="includeChips"/);assert.match(html,/id="includeResearch"/);
 assert.match(html,/id="minuteCompanion"/);assert.match(html,/id="companionStart"/);
 assert.match(html,/id="companionYears"/);assert.match(html,/id="companionSymbol"/);
 assert.match(script,/const isChips=\(\)=>\$\("includeChips"\)\.checked/);
 assert.match(script,/const root=\(\)=>!isDaily\(\)\?"\/api\/stock-kbar"/);
 assert.match(script,/const companionRoot=\(\)=>isResearch\(\)\?"\/api\/stock-daily-research":"\/api\/stock-daily-chip"/);
 assert.match(script,/if\(!isDaily\(\)&&isChips\(\)\)await startCompanion\(token,true\)/);
 assert.match(script,/body:JSON\.stringify\(\{start,end,codes,reset:false\}\)/);
 assert.match(script,/if\(!isDaily\(\)&&isChips\(\)\)refreshCompanion\(\)/);
 assert.match(script,/for\(let year=Number\(s\.start\.slice\(0,4\)\);year<=Number\(s\.end\.slice\(0,4\)\);year\+\+\)/);
 assert.match(script,/fileRow\(\$\("companionYears"\)/);
 assert.match(html,/stock_id/);
 assert.match(html,/公布時間/);
});
test("new main page calls stock KBar API while archived futures downloader keeps original endpoint",()=>{
 const newHtml=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 const oldHtml=readFileSync(new URL("../public/stock-futures-contract-download.html",import.meta.url),"utf8");
 assert.match(newHtml,/TaiwanStockKBar/);assert.match(newHtml,/api\/stock-kbar/);assert.match(newHtml,/root\(\)\+"\/start"/);
 assert.doesNotMatch(newHtml,/api\/stock-futures\/start/);
 assert.match(oldHtml,/api\/stock-futures\/start/);
});
test("dashboard uses existing individual-stock FinMind Token and isolated app pathname",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/twq_finmind_tokens_v2/);
 assert.match(html,/stock-kbar/);assert.match(html,/stock-daily/);
 assert.doesNotMatch(html,/需要先在 Cloudflare 設定/);
});