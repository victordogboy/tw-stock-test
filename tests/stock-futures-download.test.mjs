import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {parseStockFutureUniverse,preferMiniStockFutures,filterUnderlyingStockBars,filterStockFutureBars,stockFuturesRoute,StockFuturesBatch,StockFuturesData} from "../src/stock-futures-download.mjs";
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
 const x=fixture(),orig=globalThis.fetch,queries=[];
 globalThis.fetch=async(url,opt)=>{
  const target=String(url);
  if(target.includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(target);
  assert.equal(u.searchParams.get("dataset"),"TaiwanStockKBar");
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
  await x.job.alarm();
  assert.deepEqual(queries.sort(),[["2330","2021-01-01"],["2303","2021-01-01"],["2330","2021-01-04"],["2303","2021-01-04"]].sort());
  const status=await (await stockFuturesRoute(new Request(host+"/api/stock-kbar/status",{headers:{cookie}}),x.env,"stocks")).json();
  assert.equal(status.phase,"done");assert.equal(status.rows,4);
  assert.equal(status.night,0);assert.equal(status.dataset,"TaiwanStockKBar");
  const output=await stockFuturesRoute(new Request(host+"/api/stock-kbar/export?code=2330",{headers:{cookie}}),x.env,"stocks");
  assert.equal(output.status,200);
  const csv=gunzipSync(Buffer.from(await output.arrayBuffer())).toString();
  assert.match(csv,/date,minute,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_lots/);
  assert.match(csv,/2021-01-04,09:00:00,2330,.*QFF,100,102,99,101,1.5/);
  assert.ok(!csv.includes("contract_date"));
  assert.ok(!csv.includes(",2303,"));
  const wrongCookie=await stockFuturesRoute(new Request(host+"/api/stock-kbar/status",{headers:{cookie:cookie.replace("__Host-underlying1m","__Host-sf5y")}}),x.env,"stocks");
  assert.equal(wrongCookie.status,401);
 }finally{globalThis.fetch=orig}
});
test("new main page calls stock KBar API while archived futures downloader keeps original endpoint",()=>{
 const newHtml=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 const oldHtml=readFileSync(new URL("../public/stock-futures-contract-download.html",import.meta.url),"utf8");
 assert.match(newHtml,/TaiwanStockKBar/);assert.match(newHtml,/api\/stock-kbar\/start/);
 assert.doesNotMatch(newHtml,/api\/stock-futures\/start/);
 assert.match(oldHtml,/api\/stock-futures\/start/);
});
test("dashboard uses existing individual-stock FinMind Token and isolated app pathname",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/twq_finmind_tokens_v2/);
 assert.match(html,/stock-kbar\/start/);
 assert.doesNotMatch(html,/需要先在 Cloudflare 設定/);
});