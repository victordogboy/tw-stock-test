import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {parseStockFutureUniverse,filterStockFutureBars,stockFuturesRoute,StockFuturesBatch,StockFuturesData} from "../src/stock-futures-download.mjs";
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
test("S tier uses explicit one-code one-day FinMind calls; Saturday 00-05 and annual multi-symbol gzip included",async()=>{
 const x=fixture(),orig=globalThis.fetch,queries=[];
 globalThis.fetch=async(url,opt)=>{
  const target=String(url);
  if(target.includes("taifex.com.tw"))return new Response(x.html,{status:200});
  const u=new URL(target),date=u.searchParams.get("start_date"),code=u.searchParams.get("data_id");
  assert.equal(u.searchParams.get("dataset"),"TaiwanFuturesKBar");
  assert.ok(["CDF","QFF"].includes(code));
  assert.equal(opt.headers.authorization,"Bearer test-sponsor-token");
  queries.push([code,date]);
  const data=date==="2021-01-01"?[bar(date,"17:25:00",code,"202101",80)]:date==="2021-01-02"?[bar(date,"00:02:00",code,"202101",60)]:[];
  return Response.json({status:200,data})
 };
 try{
  const start=await stockFuturesRoute(new Request(host+"/api/stock-futures/start",{method:"POST",headers:{origin:host,authorization:"Bearer test-sponsor-token"},body:JSON.stringify({start:"2021-01-01",end:"2021-01-02",codes:["CDF","QFF"]})}),x.env);
  assert.equal(start.status,202);
  const cookie=start.headers.get("set-cookie").split(";")[0];
  assert.match(cookie,/__Host-sf5y=/);
  const payload=await start.json();
  assert.equal(payload.codeCount,2);assert.equal(payload.total,4);
  assert.equal(JSON.stringify(payload).includes("test-sponsor-token"),false);
  await x.job.alarm();
  assert.deepEqual(queries.sort(),[["CDF","2021-01-01"],["CDF","2021-01-02"],["QFF","2021-01-01"],["QFF","2021-01-02"]].sort());
  const state=await (await stockFuturesRoute(new Request(host+"/api/stock-futures/status",{headers:{cookie}}),x.env)).json();
  assert.equal(state.phase,"done");assert.equal(state.processed,4);assert.equal(state.rows,4);assert.equal(state.night,4);
  const output=await stockFuturesRoute(new Request(host+"/api/stock-futures/export?year=2021",{headers:{cookie}}),x.env);
  assert.equal(output.status,200);
  const plain=gunzipSync(Buffer.from(await output.arrayBuffer())).toString();
  assert.equal(plain.split("\n").filter(Boolean).length,5);
  assert.match(plain,/2021-01-02,00:02:00,night,CDF,2330,2000/);
  assert.match(plain,/2021-01-02,00:02:00,night,QFF,2330,100/);
  const one=await stockFuturesRoute(new Request(host+"/api/stock-futures/export?code=CDF",{headers:{cookie}}),x.env);
  assert.equal(gunzipSync(Buffer.from(await one.arrayBuffer())).toString().split("\n").filter(Boolean).length,3);
  const unauthorized=await stockFuturesRoute(new Request(host+"/api/stock-futures/status"),x.env);
  assert.equal(unauthorized.status,401)
 }finally{globalThis.fetch=orig}
});
test("dashboard uses existing individual-stock FinMind Token and isolated app pathname",()=>{
 const html=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 assert.match(html,/twq_finmind_tokens_v2/);
 assert.match(html,/stock-futures\/start/);
 assert.doesNotMatch(html,/需要先在 Cloudflare 設定/);
});