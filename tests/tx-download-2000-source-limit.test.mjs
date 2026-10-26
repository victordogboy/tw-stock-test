import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TX_KBAR_FIRST_DATE,TX_NIGHT_FIRST_DATE,txDownloadRoute,TxDownloadJob} from "../src/tx-download.mjs";
class Store{
 constructor(){this.db=new Map()}
 async put(k,v){this.db.set(k,v)}
 async get(k){return this.db.get(k)}
 async deleteAll(){this.db.clear()}
 async setAlarm(n){this.next=n}
 async deleteAlarm(){this.next=null}
}
const host="https://tx.test";
function fixture(){
 const ctx={storage:new Store(),blockConcurrencyWhile:f=>f()};
 const job=new TxDownloadJob(ctx,{});
 const env={TX_DOWNLOAD_JOBS:{idFromName:x=>x,get:()=>({fetch:r=>job.fetch(r instanceof Request?r:new Request(r))})}};
 return {job,ctx,env}
}
async function start(env,{start,end,reset=false,cookie=""}){
 return txDownloadRoute(new Request(host+"/api/tx-download/start",{
 method:"POST",headers:{origin:host,authorization:"Bearer test-secret",...(cookie?{cookie}:{})},
 body:JSON.stringify({start,end,reset})
 }),env)
}
test("date 2000 is accepted, but FinMind 1min download starts at real 2011-01-03 with explicit gap",async()=>{
 const {env,job,ctx}=fixture();
 assert.equal(TX_KBAR_FIRST_DATE,"2011-01-03");
 assert.equal(TX_NIGHT_FIRST_DATE,"2017-05-15");
 const result=await start(env,{start:"2000-01-01",end:"2011-01-04"});
 assert.equal(result.status,202);
 const body=await result.json();
 assert.equal(body.requestedStart,"2000-01-01");
 assert.equal(body.start,"2011-01-03");
 assert.equal(body.availableStart,"2011-01-03");
 assert.deepEqual(body.unavailableBefore,{start:"2000-01-01",end:"2011-01-02",reason:"FinMind 無 2000～2010 年 TX 一分 K"});
 assert.equal(body.total,2);
 const previous=globalThis.fetch,dates=[];
 globalThis.fetch=async(u,init)=>{
  assert.equal(init.headers.Authorization,"Bearer test-secret");
  const url=new URL(u),date=url.searchParams.get("start_date");
  assert.equal(url.searchParams.get("data_id"),"TX");
  dates.push(date);
  return Response.json({status:200,data:date==="2011-01-03"?[{date,minute:"08:45:00",futures_id:"TX",contract_date:"201101",open:9000,high:9010,low:8995,close:9002,volume:30}]:[]});
 };
 try{
  await job.alarm();
  assert.deepEqual(dates,["2011-01-03","2011-01-04"]);
  const state=await ctx.storage.get("state");
  assert.equal(state.phase,"done");
  assert.equal(state.rows,1);
  assert.equal(state.total,2);
  const cookies=result.headers.get("set-cookie").split(";")[0];
  const archive=await txDownloadRoute(new Request(host+"/api/tx-download/export?all=1",{headers:{cookie:cookies}}),env);
  assert.equal(archive.status,200);
  assert.match(archive.headers.get("content-disposition"),/20110103_20110104.csv.gz/);
  const {gunzipSync}=await import("node:zlib");
  const contents=gunzipSync(Buffer.from(await archive.arrayBuffer())).toString();
  assert.match(contents,/2011-01-03,08:45:00,day,TX,201101/);
  assert.doesNotMatch(contents,/2000-/);
 }finally{globalThis.fetch=previous}
});
test("request ending before 2011 is rejected; current job cannot be silently reused when range changes",async()=>{
 const {env}=fixture();
 const bad=await start(env,{start:"2000-01-01",end:"2010-12-31"});
 assert.equal(bad.status,400);
 assert.match((await bad.json()).error,/2011\/01\/03/);
 const first=await start(env,{start:"2021-01-01",end:"2021-01-02"});
 assert.equal(first.status,202);
 const cookie=first.headers.get("set-cookie").split(";")[0];
 const wrong=await start(env,{start:"2000-01-01",end:"2021-01-02",cookie});
 assert.equal(wrong.status,409);
 const response=await wrong.json();
 assert.equal(response.code,"EXISTING_RANGE_MISMATCH");
 assert.equal(response.existing.start,"2021-01-01");
});
test("dashboard date picker begins 2000 but warns that 2000-2010 are not FinMind candles",()=>{
 const html=readFileSync(new URL("../public/tx-download.html",import.meta.url),"utf8");
 assert.match(html,/id="start" type="date" value="2000-01-01" min="2000-01-01"/);
 assert.match(html,/2011\/01\/03/);
 assert.match(html,/2017\/05\/15/);
 assert.match(html,/unavailableBefore/);
 assert.match(html,/重新下載乾淨資料/);
});
