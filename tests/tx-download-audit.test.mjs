import {test} from "node:test";
import assert from "node:assert/strict";
import {gunzipSync} from "node:zlib";
import {filterTxRows,TxDownloadJob,txDownloadRoute} from "../src/tx-download.mjs";

const mk=(date,time,volume=120,contract_date="202611",futures_id="TX")=>({
 date,minute:time,volume,contract_date,futures_id,open:25000,high:25020,low:24990,close:25010
});
class DB{
 constructor(){this.map=new Map()}
 async get(k){return this.map.get(k)}
 async put(k,v){this.map.set(k,v)}
 async deleteAll(){this.map.clear()}
 async setAlarm(t){this.alarm=t}
 async deleteAlarm(){this.alarm=null}
}
const host="https://tx.example";
const create=()=>{
 const ctx={storage:new DB(),blockConcurrencyWhile:fn=>fn()},job=new TxDownloadJob(ctx,{});
 const env={TX_DOWNLOAD_JOBS:{idFromName:x=>x,get:()=>({fetch:x=>job.fetch(x instanceof Request?x:new Request(x))})}};
 return {ctx,job,env};
};
test("TX filtering excludes other products, spread contracts and duplicate minutes; original volume stays unchanged",()=>{
 const date="2026-10-23";
 const x=filterTxRows([
  mk(date,"08:45:00",120),
  mk(date,"08:46:00",50,"202611","MTX"),
  mk(date,"08:47:00",50,"202611","TXO"),
  mk(date,"08:48:00",50,"202611/202612"),
  mk(date,"08:49:00",50,"202699"),
  mk(date,"08:45:00",120),
  mk(date,"15:01:00",70),
  mk("2026-10-24","00:01:00",1)
 ],date);
 assert.equal(x.stats.rows,2);
 assert.equal(x.stats.rejectedProducts,2);
 assert.equal(x.stats.rejectedContracts,2);
 assert.equal(x.stats.duplicates,1);
 assert.equal(x.stats.rejectedInvalid,1);
 assert.equal(x.stats.volumeRaw,190);
 assert.equal(x.stats.dayVol["202611"],120);
 assert.equal(x.stats.nightLateVol["202611"],70);
 assert.match(x.lines,/08:45:00,day,TX,202611/);
 assert.doesNotMatch(x.lines,/MTX|TXO|202611\/202612/);
});
test("2021-01-01 start includes Saturday calendar request, Friday-night tail, and five-year gzip stream",async()=>{
 const {ctx,env,job}=create();const dates=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.headers.Authorization,"Bearer testing-only");
  const u=new URL(String(url));const date=u.searchParams.get("start_date");
  dates.push(date);
  const rows=date==="2021-01-01"?[mk(date,"15:00:00",20,"202101")]:
             date==="2021-01-02"?[mk(date,"00:00:00",30,"202101"),mk(date,"04:59:00",40,"202101")]:[];
  return Response.json({status:200,data:rows});
 };
 try{
  const res=await txDownloadRoute(new Request(host+"/api/tx-download/start",{
   method:"POST",headers:{Authorization:"Bearer testing-only",Origin:host},
   body:JSON.stringify({start:"2021-01-01",end:"2021-01-03"})
  }),env);
  assert.equal(res.status,202);
  const cookie=res.headers.get("set-cookie").split(";")[0];
  await job.alarm();
  const state=await ctx.storage.get("state");
  assert.deepEqual(dates,["2021-01-01","2021-01-02","2021-01-03"]);
  assert.equal(state.total,3);
  assert.equal(state.processed,3);
  assert.equal(state.saturdaysWithData,1);
  assert.equal(state.dayRows,0);
  assert.equal(state.nightRows,3);
  assert.equal(state.volumeRaw,90);
  const pkg=await txDownloadRoute(new Request(host+"/api/tx-download/export?all=1",{headers:{cookie}}),env);
  assert.equal(pkg.status,200);
  const contents=gunzipSync(Buffer.from(await pkg.arrayBuffer())).toString();
  assert.equal(contents.split("\n").filter(Boolean).length,4);
  assert.match(contents,/2021-01-02,04:59:00,night,TX,202101/);
  assert.match(contents,/2021-01-01,15:00:00,night,TX,202101/);
  assert.match(pkg.headers.get("content-disposition"),/\.csv\.gz/);
 }finally{globalThis.fetch=oldFetch}
});
test("regular-session daily volume audit shows ratio but doesn't alter KBar volume",async()=>{
 const {job,ctx}=create();
 await ctx.storage.put("finmind-token","testing-only");
 const date="2026-10-22";
 await ctx.storage.put("meta:"+date,{rows:1,dayRows:1,nightRows:0,dayVol:{"202611":120},chunks:0});
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(String(url)).searchParams.get("dataset"),"TaiwanFuturesDaily");
  return Response.json({status:200,data:[{date,futures_id:"TX",contract_date:"202611",trading_session:"position",volume:60}]});
 };
 try{
  const resp=await job.auditVolume(date,{start:"2021-01-01",end:"2026-10-25"});
  assert.equal(resp.status,200);
  const r=await resp.json();
  assert.equal(r.rows[0].minute_volume_raw,120);
  assert.equal(r.rows[0].daily_volume_one_side,60);
  assert.equal(r.rows[0].ratio_to_daily,2);
 }finally{globalThis.fetch=oldFetch}
});
test("old download v1 remains visible for rebuild warning and new reset wipes old rows",async()=>{
 const {env,ctx}=create(),secret="testing-only";
 const start=(reset)=>txDownloadRoute(new Request(host+"/api/tx-download/start",{
  method:"POST",headers:{Authorization:"Bearer "+secret,Origin:host},
  body:JSON.stringify({start:"2021-01-01",end:"2021-01-03",reset})
 }),env);
 const x=await start(false);
 await ctx.storage.put("meta:old",{volume:123});
 const old=await ctx.storage.get("state");old.version=1;await ctx.storage.put("state",old);
 const req=await txDownloadRoute(new Request(host+"/api/tx-download/start",{
  method:"POST",headers:{Authorization:"Bearer "+secret,Origin:host,Cookie:x.headers.get("set-cookie").split(";")[0]},
  body:JSON.stringify({start:"2021-01-01",end:"2021-01-03",reset:true})
 }),env);
 assert.equal(req.status,202);
 assert.equal(await ctx.storage.get("meta:old"),undefined);
 assert.equal((await ctx.storage.get("state")).version,2);
});