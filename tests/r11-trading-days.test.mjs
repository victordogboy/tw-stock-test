import test from 'node:test';
import assert from 'node:assert/strict';
import {r11TradingDaysRoute,summarizeIndependentTxDaily} from '../src/r11-trading-days.mjs';
test('independent TX daily dates including contract months and holidays',()=>{
 const data=[
  {date:'2026-10-23',futures_id:'TX',contract_date:'202611',open:27000,max:27200,min:26900,close:27100},
  {date:'2026-10-26',futures_id:'TX',contract_date:'202611',open:27100,max:27250,min:27000,close:27200},
  {date:'2026-10-26',futures_id:'TX',contract_date:'202612',open:27150,max:27200,min:27100,close:27160},
  {date:'2026-10-24',futures_id:'MX',contract_date:'202611',open:1,max:2,min:1,close:2},
  {date:'2026-11-01',futures_id:'TX',contract_date:'202611',open:1,max:2,min:1,close:2}
 ];
 const s=summarizeIndependentTxDaily(data,'2026-10-23','2026-10-26');
 assert.deepEqual(s.trading_days,['2026-10-23','2026-10-26']);
 assert.deepEqual(s.contracts_by_day['2026-10-26'],['202611','202612']);
 assert.equal(s.rejected.wrong_product,1);assert.equal(s.rejected.wrong_date,1);
});
test('browser bearer token is used for daily dataset, never echoed in response',async()=>{
 const q=new Request('https://worker.test/api/r11/trading-days?start=2026-10-23&end=2026-10-24',
 {headers:{authorization:'Bearer private-test-token'}});
 const seen=[];
 const rsp=await r11TradingDaysRoute(q,{},async(u,init)=>{
  seen.push({url:String(u),auth:init.headers.authorization});
  return Response.json({status:200,data:[{date:'2026-10-23',futures_id:'TX',contract_date:'202611',
   open:27000,max:27200,min:26900,close:27100}]});
 });
 const body=await rsp.json();assert.equal(rsp.status,200);assert.equal(body.ok,true);
 assert.deepEqual(body.trading_days,['2026-10-23']);
 assert.equal(body.tradeable,false);assert.equal(body.durable_object_writes,0);
 assert.match(seen[0].url,/dataset=TaiwanFuturesDaily/);
 assert.match(seen[0].url,/end_date=2026-10-24/);
 assert.equal(seen[0].auth,'Bearer private-test-token');
 assert.ok(!JSON.stringify(body).includes('private-test-token'));
});
test('missing token, future dates, broad range and bad method are rejected without provider calls',async()=>{
 const mock=async()=>{throw Error('must not query');};
 for(const [url,status,opts] of [
 ['?start=2026-10-23&end=2026-10-24',401,{}],
 ['?start=2026-10-23&end=2026-12-31',400,{}],
 ['?start=2026-09-01&end=2026-10-24',400,{}],
 ['?start=2026-10-23&end=2026-10-24',405,{method:'POST'}]
 ]){
 const r=await r11TradingDaysRoute(new Request('https://worker.test/api/r11/trading-days'+url,opts),{},mock);
 assert.equal(r.status,status);
 }
});
test('rate limits fail closed with no trade state and no secret echo',async()=>{
 const req=new Request('https://worker.test/api/r11/trading-days?start=2026-10-23&end=2026-10-24',{headers:{authorization:'Bearer private'}});
 const r=await r11TradingDaysRoute(req,{},async()=>Response.json({status:429},{status:429}));
 assert.equal(r.status,429);const j=await r.json();assert.equal(j.tradeable,false);
 assert.ok(!JSON.stringify(j).includes('Bearer'));
});
