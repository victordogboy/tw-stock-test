import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taiexFuturesRoute} from '../src/taiex-futures.mjs';
const history='https://app.test/api/futures/taiex/history?start_date=2026-10-01&end_date=2026-10-16';
function setup(t,payload,status=200){
 const previousFetch=globalThis.fetch,previousCache=globalThis.caches,map=new Map(),calls=[];
 globalThis.caches={default:{match:async r=>map.get(r.url)?.clone(),put:async(r,v)=>map.set(r.url,v.clone())}};
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(payload),{status});};
 t.after(()=>{globalThis.fetch=previousFetch;globalThis.caches=previousCache;});return {calls,map};
}
test('TX history validates range before calling upstream',async t=>{
 const s=setup(t,{});for(const query of ['start_date=2026-02-30&end_date=2026-03-01','start_date=2026-10-16&end_date=2026-10-01','start_date=2010-01-01&end_date=2026-10-16'])assert.equal((await taiexFuturesRoute(new Request('https://app.test/api/futures/taiex/history?'+query))).status,400);
 assert.equal(s.calls.length,0);assert.equal((await taiexFuturesRoute(new Request(history,{method:'OPTIONS'}))).status,204);assert.equal((await taiexFuturesRoute(new Request(history,{method:'POST'}))).status,405);
});
test('history uses correct dataset and browser credential, filters payload, and caches by credential',async t=>{
 const fixture={date:'2026-10-15',futures_id:'TX',contract_date:'202610',open:25000,max:25100,min:24900,close:25020,volume:100000,open_interest:60000,trading_session:'position'};
 const s=setup(t,{status:200,data:[fixture,{...fixture,futures_id:'MTX'},{...fixture,date:'2025-01-01'}]});
 const req=()=>new Request(history,{headers:{Authorization:'Bearer browser-test'}});
 const response=await taiexFuturesRoute(req(),{FINMIND_TOKEN:'server-test'}),d=await response.json();assert.equal(d.data.length,1);assert.equal(d.data[0].volume,100000);
 assert.match(s.calls[0].url,/dataset=TaiwanFuturesDaily/);assert.match(s.calls[0].url,/data_id=TX/);assert.ok(!s.calls[0].url.includes('browser-test'));assert.equal(s.calls[0].options.headers.Authorization,'Bearer browser-test');
 assert.ok(!JSON.stringify(d).includes('browser-test'));assert.ok([...s.map.keys()].every(x=>!x.includes('browser-test')));
 assert.equal((await (await taiexFuturesRoute(req())).json()).cache_hit,true);assert.equal(s.calls.length,1);
 await taiexFuturesRoute(new Request(history),{FINMIND_TOKEN:'other-test'});assert.equal(s.calls.length,2);
 await taiexFuturesRoute(new Request(history+'&refresh=1',{headers:{Authorization:'Bearer browser-test'}}));assert.equal(s.calls.length,3);
});
test('upstream denied responses never echo secrets and never enter cache',async t=>{
 const s=setup(t,{status:402,msg:'sensitive upstream text',data:[]},402);const r=await taiexFuturesRoute(new Request(history)),body=await r.text();assert.equal(r.status,402);assert.match(body,/權限/);assert.ok(!body.includes('sensitive'));assert.equal(s.map.size,0);
});
test('quote requires token and only returns explicit TXFR1, not another month or MTX',async t=>{
 const s=setup(t,{status:200,data:[{futures_id:'TXFR1',close:25001,date:'2026-10-16 22:10:00',total_volume:1234},{futures_id:'TXFR2',close:26000}]});
 const url='https://app.test/api/futures/taiex/quote';assert.equal((await taiexFuturesRoute(new Request(url))).status,401);assert.equal(s.calls.length,0);
 const d=await (await taiexFuturesRoute(new Request(url),{FINMIND_TOKEN:'test'})).json();assert.equal(d.data.length,1);assert.equal(d.data[0].futures_id,'TXFR1');assert.equal(d.data[0].total_volume,1234);assert.match(s.calls[0].url,/taiwan_futures_snapshot\?data_id=TXF/);
});
test('missing near-month alias fails clearly; malformed upstream JSON does not fabricate data',async t=>{
 const s=setup(t,{status:200,data:[{futures_id:'TXFR2',close:25000}]});assert.equal((await taiexFuturesRoute(new Request('https://app.test/api/futures/taiex/quote'),{FINMIND_TOKEN:'test'})).status,502);
 globalThis.fetch=async()=>new Response('not json');assert.equal((await taiexFuturesRoute(new Request(history))).status,502);assert.equal(s.map.size,0);
});
test('Worker routes TX API independently and continues serving existing assets',async t=>{
 setup(t,{status:200,data:[]});const worker=(await import('../src/worker.mjs')).default;
 const r=await worker.fetch(new Request(history),{});assert.equal(r.status,200);assert.equal((await r.json()).symbol,'TX');
 const asset=await worker.fetch(new Request('https://app.test/futures.html'),{ASSETS:{fetch:async()=>new Response('<title>TX</title>')}});assert.equal(await asset.text(),'<title>TX</title>');assert.match(asset.headers.get('cache-control'),/no-store/);
});
