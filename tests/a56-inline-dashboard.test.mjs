import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {loadA56MonitorSnapshot,renderA56Monitor,renderA56Orders,renderA56Performance,renderA56Monthly,decorateA56Monitor,verifyAccount} from '../public/r1494a/c26/a56/inline-adapter.mjs';
const root=new URL('../public/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root));
const base=JSON.parse(gunzipSync(Buffer.from(read('r1494a/c26/a56/dashboard-history.b64').toString(),'base64')));
const delta=JSON.parse(read('r1494a/c26/a56/forward.json'));
const manifest=JSON.parse(read('r1494a/c26/a56/latest-manifest.json'));
const shared=JSON.parse(gunzipSync(read('r1494a/snapshot.bin')));
const elements=new Map();const node=id=>{if(!elements.has(id))elements.set(id,{value:id==='#capital'?'1000000':id==='#monthYear'?'2026':'',innerHTML:'',textContent:'',disabled:false});return elements.get(id)};
globalThis.document={querySelector:node};let requests=0,corrupt=false;
globalThis.fetch=async url=>{
 if(url==='/api/c26/a56/refresh'){requests++;return Response.json({state:'queued',phase:'測試更新佇列'})}
 if(url==='/api/c26/a56/refresh-status')return Response.json({state:'queued',phase:'測試更新佇列'});
 if(url==='/api/c26/a56/status')return Response.json({model_version:'A56',lock_id:base.lock_id,
  model_archive:{as_of:delta.as_of,asset_sha256:corrupt?'0'.repeat(64):manifest.forward_sha256,verified_dates:delta.plan.verified_dates},
  source:{as_of:delta.as_of,next_trade_date:delta.plan.trade_date},plan:delta.plan});
 return new Response(read(url.replace(/^\//,'')));
};
let D;
test('opening A56 enqueues a real refresh, verifies all combined cash/shares/NAV and merges its own delta',async()=>{
 D=await loadA56MonitorSnapshot(shared);assert.equal(requests,1);assert.equal(D.model_version,'A56');
 assert.equal(D.snapshots.length,1419+delta.snapshots.length);assert.equal(D.orders.length,1759+delta.orders.length);
 assert.equal(D.a56.ready,true);assert.ok(D.orders.some(o=>!o.filled));
 assert.ok(D.orders.some(o=>o.sleeve==='REVERSAL'));assert.ok(D.orders.some(o=>o.sleeve==='C26'));
 assert.equal(D.plan.trade_date,delta.plan.trade_date);assert.equal(D.dates.at(-1),delta.as_of);
});
test('all four original dashboard tabs receive A56 holdings, plans, yearly/monthly performance, unfilled orders and rules',()=>{
 const i=D.dates.length-1;renderA56Monitor(D,i);renderA56Orders(D,i,3000);renderA56Performance(D);renderA56Monthly(D);decorateA56Monitor(D);
 assert.ok(node('#holdings').innerHTML.includes('2801'));assert.ok(node('#planActions').innerHTML.includes('續抱'));
 assert.ok(node('#annual').innerHTML.includes('2026'));assert.ok(node('#monthly').innerHTML.includes('2026-11'));
 assert.ok(node('#orderRows').innerHTML.includes('未成交'));assert.ok(node('#orderRows').innerHTML.includes('反轉'));
 assert.ok(node('#rulesMain').innerHTML.includes('B跨日收復'));assert.ok(node('#dataFacts').innerHTML.includes(delta.as_of));
 assert.ok(node('#dailyWhy').textContent.includes(delta.plan.warning?'大盤急跌警戒啟動':'未達大盤急跌警戒'));
 assert.ok(node('#chart').innerHTML.includes('polyline'));assert.ok(node('header .brand').innerHTML.includes('A56'));
});
test('polling reads current data without requeuing; pressing refresh enqueues again',async()=>{
 await loadA56MonitorSnapshot(shared);assert.equal(requests,1);
 await loadA56MonitorSnapshot(shared,{refresh:true});assert.equal(requests,2);
});
test('historical next-session plan includes precommitted A order and B/C levels without next-day fills',()=>{
 const i=D.dates.indexOf('2026-11-04');renderA56Monitor(D,i);
 assert.ok(node('#planActions').innerHTML.includes('3406'));assert.ok(node('#planActions').innerHTML.includes('967'));
 assert.ok(node('#planActions').innerHTML.includes('盤前 B／C 條件價'));
 assert.ok(!node('#planActions').innerHTML.includes('6,087,900'));
 renderA56Monitor(D,D.dates.length-1);
});
test('precommitted core opening adjustments appear alongside holding instructions',()=>{
 const i=D.dates.indexOf('2026-11-12');renderA56Monitor(D,i);
 assert.ok(node('#planActions').innerHTML.includes('核心組合開盤配置'));
 assert.ok(node('#planActions').innerHTML.includes('目標曝險'));
 assert.ok(node('#planActions').innerHTML.includes('最終股數與金額待開盤核對'));
 renderA56Monitor(D,D.dates.length-1);
});
test('tampered forward asset preserves verified baseline and never displays its unverified current plan',async()=>{
 corrupt=true;try{const d=await loadA56MonitorSnapshot(shared);assert.equal(d.snapshots.length,1419);assert.equal(d.a56.ready,false);assert.equal(d.plan.readiness,'blocked');assert.deepEqual(d.plan.actions,[]);}finally{corrupt=false}
});
test('duplicate or altered holdings and cash cannot pass the browser ledger audit',()=>{
 const s=structuredClone(base.snapshots);s.at(-1).cash+=.1;assert.throws(()=>verifyAccount(s,base.orders));
});
test('main page wires A56 into every original view and remembered strategy selector',()=>{
 const html=read('r1494a/index.html').toString(),decorator=read('r1494a/strategy-switch.js').toString();
 for(const text of ['value="A56"','loadA56MonitorSnapshot','renderA56Monitor','renderA56Performance','renderA56Monthly','renderA56Orders','exportA56Orders'])assert.ok(html.includes(text),text);
 assert.ok(decorator.includes('decorateA56Monitor'));assert.ok(html.includes("['R1494-A','FC23','C26','A56'].includes"));
});

