import {test} from "node:test";
import assert from "node:assert/strict";
import {TxDownloadJob,txDownloadRoute} from "../src/tx-download.mjs";

const base="https://tw-stock-api.test";
class Store{
 constructor(){this.a=new Map()}
 async get(k){return this.a.get(k)}
 async put(k,v){this.a.set(k,v)}
 async setAlarm(t){this.alarm=t}
 async deleteAlarm(){this.alarm=null}
 async deleteAll(){this.a.clear()}
 async list({prefix}){return new Map([...this.a].filter(([k])=>k.startsWith(prefix)))}
}
function setup(){
 const ctx={storage:new Store(),blockConcurrencyWhile:fn=>fn()};
 const job=new TxDownloadJob(ctx,{});
 const env={TX_DOWNLOAD_JOBS:{idFromName:x=>x,get:()=>({fetch:q=>job.fetch(q instanceof Request?q:new Request(q))})}};
 return {ctx,job,env}
}
const bar=(date,minute,contract="202610",volume=200,symbol="TX")=>({
 date,minute,contract_date:contract,futures_id:symbol,
 open:25000,high:25008,low:24998,close:25004,volume
});
async function start(env,start,end){
 const r=await txDownloadRoute(new Request(base+"/api/tx-download/start",{method:"POST",headers:{origin:base,authorization:"Bearer sample-token"},body:JSON.stringify({start,end})}),env);
 assert.equal(r.status,202);
 return r.headers.get("set-cookie").split(";")[0]
}
const fixture={
 "2026-10-23":[
  bar("2026-10-23","08:45:00","202611",200),
  bar("2026-10-23","08:45:00","202611",200), // exact duplicate
  bar("2026-10-23","08:46:00","202611",100),
  bar("2026-10-23","15:00:00","202611",160),
  bar("2026-10-23","15:00:00","202612",4), // distant month remains only in all-contract export
  bar("2026-10-23","15:00:00","202611/202612",50), // spread must not enter the CSV
  bar("2026-10-23","15:00:00","202611",55,"MTX"), // other product, never enter CSV
 ],
 "2026-10-24":[
  bar("2026-10-24","00:01:00","202611",300),
  bar("2026-10-24","04:59:00","202611",85)
 ]
};
function mock(){
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
  const u=new URL(url),q=u.searchParams,date=q.get("start_date");
  if(q.get("dataset")==="TaiwanFuturesDaily")return Response.json({
   status:200,data:[{date:"2026-10-23",futures_id:"TX",contract_date:"202611",trading_session:"position",volume:150}]
  });
  if(q.get("dataset")==="TaiwanFuturesKBar")return Response.json({status:200,data:fixture[date]??[]});
  throw Error("Unexpected dataset")
 };
 return ()=>{globalThis.fetch=original}
}
test("Friday evening to Saturday 04:59 is included in same full-history export, with only TX",async()=>{
 const {env,job,ctx}=setup(),restore=mock();
 try{
  const cookie=await start(env,"2026-10-23","2026-10-24");
  await job.alarm();
  const status=await (await txDownloadRoute(new Request(base+"/api/tx-download/status",{headers:{cookie}}),env)).json();
  assert.equal(status.phase,"done");assert.equal(status.total,2);
  assert.equal(status.processed,2);assert.equal(status.saturdayEarlyRows,2);
  assert.equal(status.rows,6);assert.equal(status.duplicates,1);
  assert.equal(status.rejectedOther,1);assert.equal(status.rejectedSpread,1);
  assert.ok(await ctx.storage.get("meta:2026-10-24"));
  const r=await txDownloadRoute(new Request(base+"/api/tx-download/export?all=1&mode=front",{headers:{cookie}}),env);
  assert.equal(r.status,200);
  assert.match(r.headers.get("content-disposition"),/\.csv.gz/);
  const decoded=await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  assert.match(decoded,/2026-10-23,15:00:00,night,TX,202611,/);
  assert.match(decoded,/2026-10-24,04:59:00,night,TX,202611,/);
  assert.match(decoded,/2026-10-23,08:45:00,day,TX,202611,[^\n]*,200/);
  assert.doesNotMatch(decoded,/MTX|202611\/202612|,TX,202612,/);
  const all=await txDownloadRoute(new Request(base+"/api/tx-download/export?all=1&mode=all",{headers:{cookie}}),env);
  const allCsv=await new Response(all.body.pipeThrough(new DecompressionStream("gzip"))).text();
  assert.match(allCsv,/,TX,202612,/);
  assert.doesNotMatch(allCsv,/MTX|202611\/202612/);
 }finally{restore()}
});
test("volume comparison uses original KBar values (no silent /2) and official Daily volume",async()=>{
 const {env,job}=setup(),restore=mock();
 try{
  const cookie=await start(env,"2026-10-23","2026-10-23");await job.alarm();
  const r=await txDownloadRoute(new Request(base+"/api/tx-download/audit?date=2026-10-23",{headers:{cookie}}),env);
  const j=await r.json();
  assert.equal(j.ok,true);assert.equal(j.rows[0].raw,300);assert.equal(j.rows[0].official,150);
  assert.equal(j.rows[0].ratio,2);assert.match(j.verdict,/接近 2 倍/);
 }finally{restore()}
});
test("previous weekday-only task can repair missing Saturday while preserving already downloaded days",async()=>{
 const {env,job,ctx}=setup(),restore=mock();
 try{
  const cookie=await start(env,"2026-10-23","2026-10-24");
  await job.download("2026-10-23");
  const s=await ctx.storage.get("state");
  s.total=1;s.processed=1;s.phase="done";s.current="2026-10-25";
  await ctx.storage.put("state",s);
  const repaired=await txDownloadRoute(new Request(base+"/api/tx-download/repair",{method:"POST",headers:{origin:base,cookie}}),env);
  assert.equal(repaired.status,200);
  const j=await repaired.json();assert.equal(j.phase,"running");assert.equal(j.repairLeft,1);
  await job.alarm();
  const final=await (await txDownloadRoute(new Request(base+"/api/tx-download/status",{headers:{cookie}}),env)).json();
  assert.equal(final.total,2);assert.equal(final.processed,2);assert.equal(final.phase,"done");
  assert.equal(final.saturdayEarlyRows,2);
  assert.ok(await ctx.storage.get("meta:2026-10-23"));
  assert.ok(await ctx.storage.get("meta:2026-10-24"));
 }finally{restore()}
});