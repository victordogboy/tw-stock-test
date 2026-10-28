import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinmindR26,r26BridgeRoute} from '../src/r26-bridge.mjs';
const row=(date,minute,contract_date='202611')=>({date,minute,futures_id:'TX',contract_date,open:47000,high:47010,low:46990,close:47002,volume:4});
test('night on first day and midnight continuation share one physical night session',()=>{
 const a=normalizeFinmindR26([row('2026-10-22','15:00:00')],'2026-10-22');
 const b=normalizeFinmindR26([row('2026-10-23','04:59:00')],'2026-10-23');
 assert.equal(a[0].session_key,'night:2026-10-22');
 assert.equal(b[0].session_key,'night:2026-10-22');
 assert.equal(a[0].trade_date,null);
});
test('filter wrong products, spreads, duplicates and invalid OHLC',()=>{
 const b=row('2026-10-28','08:45:00');
 const a=normalizeFinmindR26([b,b,{...b,high:1},{...b,futures_id:'MTX'},{...b,contract_date:'202611/202612'}],'2026-10-28');
 assert.equal(a.length,1);assert.equal(a[0].session_key,'day:2026-10-28');
});
test('reject missing bearer without falling back to public Worker shared token',async()=>{
 const r=await r26BridgeRoute(new Request('https://x.example/api/r26/kbar?date=2026-10-28'),{FINMIND_TOKEN:'private'});
 assert.equal(r.status,401);assert.equal(r.headers.get('access-control-allow-origin'),'*');
});
test('FinMind response returns filtered exact-month historical bars',async()=>{
 const req=new Request('https://x.example/api/r26/kbar?date=2026-10-28&contract=202611',{headers:{Authorization:'Bearer test'}});
 const r=await r26BridgeRoute(req,{},async(url,opts)=>{
  assert.ok(url.includes('dataset=TaiwanFuturesKBar'));assert.equal(opts.headers.authorization,'Bearer test');
  return Response.json({status:200,data:[row('2026-10-28','08:45:00'),row('2026-10-28','08:45:00','202612')]});
 });
 const j=await r.json();assert.equal(r.status,200);assert.equal(j.rows,1);assert.equal(j.data[0].contract_date,'202611');
});
test('invalid dates and API upstream errors do not invent bars',async()=>{
 const bad=new Request('https://x.example/api/r26/kbar?date=2026-02-30',{headers:{Authorization:'Bearer token'}});
 assert.equal((await r26BridgeRoute(bad,{})).status,400);
 const good=new Request('https://x.example/api/r26/kbar?date=2026-10-28',{headers:{Authorization:'Bearer token'}});
 const r=await r26BridgeRoute(good,{},async()=>Response.json({status:403,msg:'denied'},{status:403}));
 assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
});
