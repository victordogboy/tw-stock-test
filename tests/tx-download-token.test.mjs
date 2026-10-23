import {test} from "node:test";
import assert from "node:assert/strict";
import {TxDownloadJob,txDownloadRoute} from "../src/tx-download.mjs";

class FakeStorage{
 constructor(){this.items=new Map()}
 get(k){return Promise.resolve(this.items.get(k))}
 put(k,v){this.items.set(k,v);return Promise.resolve()}
 setAlarm(t){this.alarmTime=t;return Promise.resolve()}
 deleteAlarm(){this.alarmTime=null;return Promise.resolve()}
 deleteAll(){this.items.clear();return Promise.resolve()}
 delete(k){this.items.delete(k);return Promise.resolve()}
}
const domain="https://tw-stock-api.example";
const fixture={
  status:200,
  data:[
    {date:"2026-10-22",futures_id:"TX",contract_date:"202611",minute:"08:45:00",open:25000,high:25010,low:24990,close:25005,volume:100},
    {date:"2026-10-22",futures_id:"TX",contract_date:"202611",minute:"15:01:00",open:25007,high:25015,low:25002,close:25009,volume:70}
  ]
};
const setup=()=>{
 const ctx={storage:new FakeStorage(),blockConcurrencyWhile:fn=>fn()};
 const job=new TxDownloadJob(ctx,{});
 const env={TX_DOWNLOAD_JOBS:{idFromName:x=>x,get:()=>({fetch:request=>job.fetch(request instanceof Request?request:new Request(request))})}};
 return {ctx,job,env};
};
test("new downloader accepts existing browser Token without Cloudflare Secret and runs after browser closes",async()=>{
 const {ctx,job,env}=setup();
 const userToken="sponsor-test-token-not-a-real-secret";
 const request=new Request(domain+"/api/tx-download/start",{
  method:"POST",headers:{origin:domain,Authorization:"Bearer "+userToken},
  body:JSON.stringify({start:"2026-10-22",end:"2026-10-22"})
 });
 const resp=await txDownloadRoute(request,env);
 assert.equal(resp.status,202);
 const cookie=resp.headers.get("set-cookie");
 assert.match(cookie,/__Host-txdownload=[a-f0-9]{64}/);
 assert.match(cookie,/HttpOnly/);
 const startBody=await resp.json();
 assert.equal(startBody.ok,true);
 assert.equal(JSON.stringify(startBody).includes(userToken),false);
 assert.equal(await ctx.storage.get("finmind-token"),userToken);
 let calls=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/dataset=TaiwanFuturesKBar/);
  assert.equal(options.headers.Authorization,"Bearer "+userToken);
  calls++;
  return Response.json(fixture);
 };
 try{
  await job.alarm(); // Cloudflare alarms run independently of an open browser.
  assert.equal(calls,1);
  const get=await txDownloadRoute(new Request(domain+"/api/tx-download/status",{headers:{cookie:cookie.split(";")[0]}}),env);
  const status=await get.json();
  assert.equal(status.phase,"done");
  assert.equal(status.rows,2);
  assert.equal(status.dayRows,1);
  assert.equal(status.nightRows,1);
  assert.equal(JSON.stringify(status).includes(userToken),false);
  const csvResp=await txDownloadRoute(new Request(domain+"/api/tx-download/export?month=2026-10",{headers:{cookie:cookie.split(";")[0]}}),env);
  assert.equal(csvResp.status,200);
  const csv=await csvResp.text();
  assert.match(csv,/15:01:00,night,TX,202611/);
  assert.match(csv,/08:45:00,day,TX,202611/);
  assert.equal(csv.includes(userToken),false);
 }finally{globalThis.fetch=originalFetch}
});
test("missing token rejected; wrong cookie cannot see another user's data",async()=>{
 const {env}=setup();
 const noAuth=await txDownloadRoute(new Request(domain+"/api/tx-download/start",{
  method:"POST",headers:{origin:domain},body:JSON.stringify({start:"2026-10-22",end:"2026-10-22"})
 }),env);
 assert.equal(noAuth.status,401);
 const noCookie=await txDownloadRoute(new Request(domain+"/api/tx-download/status"),env);
 assert.equal(noCookie.status,401);
});
test("dashboard retrieves the existing stock scanner's active Token",async()=>{
 const {readFile}=await import("node:fs/promises");
 const html=await readFile(new URL("../public/tx-download.html",import.meta.url),"utf8");
 assert.match(html,/twq_finmind_tokens_v2/);
 assert.match(html,/twq_finmind_token_v1/);
 assert.match(html,/value\.trim\(\)\|\|savedToken\(\)/);
 assert.doesNotMatch(html,/Cloudflare 內設定的 FINMIND_TOKEN/);
});