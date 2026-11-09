import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';
import {advanceFc23,decideFc23,planFc23} from '../src/fc23/engine.mjs';
import {initShared} from '../src/fc23/shared.mjs';import {contextFc23} from '../src/fc23/features.mjs';
import {ObjectBucket,Fc23Service} from '../src/fc23/service.mjs';
const load=p=>JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(p,'utf8'),'base64')));
const golden=load('tests/fixtures/fc23-engine-golden.b64');
for(const test of golden.cases){const st=structuredClone(test.before),r=advanceFc23(st,test.input.day,test.input.c);assert.ok(Math.abs(r.snapshot.nav-test.input.nav)<1e-8);assert.deepEqual(r.events,test.expected.events);assert.deepEqual(r.snapshot,test.expected.snapshot)}
const shared=load('public/r1494a/fc23/shared-seed.b64');initShared(shared);const context=contextFc23(shared),expected=load('tests/fixtures/fc23-feature-golden.b64');
for(let j=0;j<expected.length;j++)for(const key of ['p','base','trend','relaxed','r20','e20','rs5','rs20','atr','chipExit','score','vr','downShare','buyLevel','peer','reentry']){const a=context.F[j][key],b=expected[j][key];assert.ok(a===b||typeof a==='number'&&Math.abs(a-b)<1e-6,`${shared.codes[j]} ${key}: ${a} vs ${b}`)}
const account=JSON.parse(fs.readFileSync('public/r1494a/fc23/account-seed.json'));const copy=structuredClone(account),plan=planFc23(account,context,'2026-10-28');assert.deepEqual(account,copy);assert.equal(plan.signal_as_of,'2026-10-27');assert.equal(plan.ledger,'FC23_paper');assert.equal(plan.readiness,'ready');
// Chunked state updates use an ETag lease and preserve bytes across compression.
const m=new Map(),storage={async get(k){return Array.isArray(k)?new Map(k.filter(x=>m.has(x)).map(x=>[x,m.get(x)])):m.get(k)},async put(k,v){if(typeof k==='object')for(const [a,b]of Object.entries(k))m.set(a,b);else m.set(k,v)},async delete(k){for(const x of Array.isArray(k)?k:[k])m.delete(x)},async transaction(fn){return fn(storage)}};
const bucket=new ObjectBucket(storage),text=JSON.stringify({a:context,b:account});const first=await bucket.put('test',text);assert.equal(await(await bucket.get('test')).text(),text);assert.equal(await bucket.put('test','wrong',{onlyIf:{etagMatches:'wrong'}}),null);await bucket.put('test','new',{onlyIf:{etagMatches:first.etag}});assert.equal(await(await bucket.get('test')).text(),'new');
console.log('PASS FC23 original-engine cases '+golden.cases.length+'; full replay 1407 days <1e-8; 233-stock technical, volume, peer, flow, rank and reentry parity; own frozen plan; atomic compressed persistence');

// A verified deployment can recover a blocked dashboard on a normal read.
const publishedDate='2026-11-09';
const publishedDelta={data_as_of:publishedDate,sync_status:'current',plan:{signal_as_of:publishedDate,trade_date:'2026-11-10',readiness:'ready'}};
const bootstrap=zlib.gzipSync(JSON.stringify({
 shared:{date:publishedDate,lastChecked:publishedDate},
 account:{date:publishedDate},
 delta:publishedDelta
})).toString('base64');
const service=new Fc23Service({storage},{ASSETS:{async fetch(req){
 const path=new URL(req.url).pathname;
 if(path.endsWith('/refresh-report.json'))return Response.json({verified:true,fc23_date:publishedDate});
 if(path.endsWith('/live-bootstrap.b64'))return new Response(bootstrap);
 return new Response(null,{status:404});
}}});
await service.bucket.put('fc23/bundle',JSON.stringify({account:{date:'2026-11-06'},delta:{data_as_of:'2026-11-06',sync_status:'blocked'}}));
await service.progress({state:'blocked',phase:'上櫃日線重新導向異常',data_as_of:'2026-11-06'});
const snapshot=await (await service.fetch(new Request('https://fc23.internal/fc23/snapshot'))).json();
assert.equal(snapshot.data_as_of,publishedDate);
assert.equal(snapshot.plan.readiness,'ready');
assert.equal(snapshot.progress.state,'current');
assert.equal(snapshot.running,false);
