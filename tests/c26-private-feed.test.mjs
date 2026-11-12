import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {C26PrivateStore,c26PrivateFeedRoute} from '../src/c26/private-feed.mjs';
const LOCK='C26-EVENT-CORR-LOCK-20261112';
const POOL='2bbeada91a53d219a1f6815f84ac567db8182affca586537c199290d73c8c7fe';
const key='c26-private-test-placeholder-secret-longer-than-30';
const fake=()=>{
 const map=new Map();
 const storage={get:async k=>Array.isArray(k)?new Map(k.map(x=>[x,map.get(x)])):map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k),transaction:async fn=>fn(storage)};
 const obj=new C26PrivateStore({storage});
 const env={FINMIND_TOKEN:key,SCAN_JOBS:{idFromName:x=>x,get:()=>obj}};
 return {env,map,obj};
};
const url='https://worker.example/api/c26/private-feed';
const body=(dates=['2026-10-27','2026-10-28'])=>new Uint8Array(gzipSync(JSON.stringify({lock_id:LOCK,pool_sha256:POOL,generated_at:'2026-10-29T11:00:00Z',source:'FinMind private Actions secret',days:Object.fromEntries(dates.map(date=>[date,{source_state:'available',price_valid:1,price:[{stock_id:'1101',open:12,high:12,low:11,close:11.5,volume:12000,value:120000}],institutional:[],source_errors:[]}]))})));
function auth(method='GET',payload=undefined,token=key){return new Request(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/gzip'},body:payload});}
test('C26 private upload strictly authenticates before reading and does not leak source',async()=>{
 const {env,map}=fake();const bytes=body();
 const no=await c26PrivateFeedRoute(new Request(url,{method:'POST',body:bytes}),env);
 assert.equal(no.status,401);assert.equal(map.size,0);
 const invalid=await c26PrivateFeedRoute(auth('POST',bytes,'wrong'+key),env);
 assert.equal(invalid.status,401);assert.equal(map.size,0);
 const ok=await c26PrivateFeedRoute(auth('POST',bytes),env);
 assert.equal(ok.status,201);const o=await ok.json();assert.equal(o.stored,true);assert.equal(o.raw_public,false);assert.equal(o.trading_plan,'BLOCKED');
 assert.ok(!JSON.stringify(o).includes('1101'));assert.ok(!JSON.stringify(o).includes(key));
 const health=await c26PrivateFeedRoute(auth('GET',undefined),env);
 assert.equal(health.status,200);const restored=new Uint8Array(await health.arrayBuffer());assert.deepEqual(restored,bytes);
 const status=await c26PrivateFeedRoute(new Request(url+'/status',{headers:{authorization:'Bearer '+key}}),env);
 assert.equal(status.status,200);const safe=await status.json();assert.equal(safe.exists,true);assert.equal(safe.source_as_of,'2026-10-28');assert.equal(safe.model_ready,false);assert.ok(!('id' in safe));
});
test('reject malformed gzip and wrong pool; preserve previous model snapshot',async()=>{
 const {env}=fake();const bytes=body();assert.equal((await c26PrivateFeedRoute(auth('POST',bytes),env)).status,201);
 const bad=await c26PrivateFeedRoute(auth('POST',new Uint8Array([1,2,3,4,5,6,7,8,9,10])),env);assert.equal(bad.status,422);
 const badPool=new Uint8Array(gzipSync(JSON.stringify({lock_id:LOCK,pool_sha256:'wrong',days:{'2026-11-01':{source_state:'available',price_valid:1,price:[],institutional:[],source_errors:[]}}})));
 assert.equal((await c26PrivateFeedRoute(auth('POST',badPool),env)).status,422);
 const old=body(['2026-10-27','2026-10-28']);assert.equal((await c26PrivateFeedRoute(auth('POST',old),env)).status,201);
 const restored=await c26PrivateFeedRoute(auth(),env);assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),old);
});
test('C26 private endpoint with secret missing fails closed',async()=>{
 const {env}=fake();env.FINMIND_TOKEN=undefined;
 const r=await c26PrivateFeedRoute(auth('GET'),env);assert.equal(r.status,503);
});