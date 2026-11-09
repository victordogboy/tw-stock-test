import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeRows,r11BackfillRoute} from '../src/r11-backfill.mjs';
const symbol='202401';
const minute=(n)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')+':00';
const bar=(date,min,contract=symbol)=>({date,minute:minute(min),futures_id:'TX',contract_date:contract,open:18500,high:18510,low:18490,close:18502,volume:1});
function sample(){
 const a=[];for(let k=525;k<825;k++)a.push(bar('2024-01-05',k));
 for(let k=900;k<1440;k++)a.push(bar('2024-01-05',k));
 for(let k=0;k<300;k++)a.push(bar('2024-01-06',k));
 return a;
}
test('Friday night through Saturday 04:59 and Friday day both complete',()=>{
 const x=summarizeRows(sample(),'2024-01-05','2024-01-06',symbol,Date.parse('2024-01-06T06:00:00+08:00'));
 assert.equal(x.complete_sessions,2);assert.equal(x.partial_sessions,0);
 assert.equal(x.sessions.find(x=>x.session==='day').bars,300);
 const night=x.sessions.find(x=>x.session==='night');
 assert.equal(night.session_key,'night:2024-01-05');assert.equal(night.bars,840);
 assert.equal(night.first_bar,'2024-01-05 15:00');assert.equal(night.last_bar,'2024-01-06 04:59');
});
test('missing one minute never forward-filled, wrong contract ignored',()=>{
 const a=sample().filter(x=>x.minute!=='16:00:00');
 a.push(bar('2024-01-05',544,'202402'));
 const x=summarizeRows(a,'2024-01-05','2024-01-06',symbol,Date.parse('2024-01-06T06:00:00+08:00'));
 assert.equal(x.complete_sessions,1);assert.equal(x.partial_sessions,1);
 assert.equal(x.sessions.find(x=>x.session==='night').missing_bars,1);
 assert.equal(x.rejected.contract,1);
});
test('read-only route invokes official FinMind single-date query, never includes token in payload',async()=>{
 const data=sample(),calls=[];
 const mock=async(url,init)=>{calls.push({url,auth:init.headers.authorization});
  const day=new URL(url).searchParams.get('start_date');
  assert.ok(!new URL(url).searchParams.has('end_date'),'single-day KBar dataset');
  return Response.json({status:200,data:data.filter(x=>x.date===day)});
 };
 const req=new Request('https://unit.test/api/r11/backfill?start=2024-01-05&end=2024-01-06&contract=202401',
   {headers:{authorization:'Bearer private-test-token'}});
 const resp=await r11BackfillRoute(req,{},mock),j=await resp.json();
 assert.equal(resp.status,200);assert.equal(j.source_contracts[0],symbol);assert.equal(j.complete_sessions,2);
 assert.equal(j.durable_object_writes,0);assert.equal(j.tradeable,false);assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.auth==='Bearer private-test-token'));
 assert.ok(!JSON.stringify(j).includes('private-test-token'));
});
test('invalid dates, excessive window, and missing token fail before upstream requests',async()=>{
 let calls=0;const mock=async()=>{calls++;throw new Error('unreachable');};
 for(const [url,status] of [
  ['?start=2024-01-01&end=2024-01-31&contract=202401',400],
  ['?start=2024-01-05&end=2024-01-06&contract=202413',400],
  ['?start=2024-01-05&end=2024-01-06&contract=202401',401]
 ]){
 const r=await r11BackfillRoute(new Request('https://unit.test/api/r11/backfill'+url),{},mock);
 assert.equal(r.status,status);
 }
 assert.equal(calls,0);
});
test('FinMind quota failure is surfaced; never fabricates missing OHLC or a trade plan',async()=>{
 const req=new Request('https://unit.test/api/r11/backfill?start=2024-01-05&end=2024-01-06&contract=202401',{headers:{authorization:'Bearer valid'}});
 const r=await r11BackfillRoute(req,{},async()=>Response.json({status:429,msg:'limit'}, {status:429})),x=await r.json();
 assert.equal(r.status,429);assert.equal(x.tradeable,false);assert.equal(x.status,'SOURCE_AUTH_OR_QUOTA_BLOCKED');assert.ok(x.errors?.length>0);
});

test('public backfill never uses Cloudflare shared FinMind Token without browser Bearer',async()=>{
 let called=0;
 const req=new Request('https://unit.test/api/r11/backfill?start=2024-01-05&end=2024-01-06&contract=202401');
 const rsp=await r11BackfillRoute(req,{FINMIND_TOKEN:'secret-should-never-spend'},async()=>{called++;throw Error('upstream must not be called');});
 const x=await rsp.json();
 assert.equal(rsp.status,401);assert.equal(x.code,'FINMIND_TOKEN_REQUIRED');assert.equal(called,0);
 assert.ok(!JSON.stringify(x).includes('secret-should-never-spend'));
});
