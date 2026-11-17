import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {a56StatusRoute} from '../src/c26/a56-status.mjs';
const read=p=>fs.readFileSync(new URL('../public/r1494a/c26/'+p,import.meta.url));
test('expired verified plan reports expiry, preserves latest inventory, and publishes no stale actions',async()=>{
 const RealDate=Date,now=RealDate.parse('2099-01-01T00:00:00Z');
 globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}};
 try{
  const env={ASSETS:{fetch:async r=>new Response(read(new URL(r.url).pathname.split('/c26/')[1]))}};
  const r=await a56StatusRoute(new Request('https://test/api/c26/a56/status'),env),s=await r.json();
  const manifest=JSON.parse(read('a56/latest-manifest.json'));
  assert.equal(s.model_archive.as_of,manifest.as_of);assert.deepEqual(s.plan.actions,[]);
  assert.equal(s.plan.readiness,'blocked');assert.equal(s.blockers[0].code,'PLAN_EXPIRED');assert.ok(s.plan.reason.includes('已過期'));
  assert.ok(!s.plan.reason.includes('需由 A56 原合併帳本逐日重播'));
 }finally{globalThis.Date=RealDate}
});
