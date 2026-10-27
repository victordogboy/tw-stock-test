import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker,{ScanJob} from '../src/worker.mjs';
import {valuationStub} from '../src/valuation-cache.mjs';
test('valuation uses isolated existing namespace; no new DO migrations needed',async()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url)));
 assert.equal(config.durable_objects.bindings.some(b=>b.name==='VALUATION_CACHE'),false);
 assert.equal(config.migrations.some(m=>m.tag==='r56-valuation-cache'),false);
 const seen=[],stub={fetch:async r=>{seen.push(r.url);return Response.json({ok:true})}};
 const env={SCAN_JOBS:{idFromName:n=>{assert.equal(n,'system:valuation:r56');return n},get:()=>stub}};
 assert.equal(valuationStub(env),stub);
 const waits=[];worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);
 await worker.fetch(new Request('https://test/api/pe-screener/snapshot'),env,{});
 assert.deepEqual(seen,['https://valuation.internal/valuation/refresh','https://valuation.internal/valuation/snapshot']);
});
test('existing ScanJob dispatch retains scan storage and valuation snapshot route',async()=>{
 const saved={ok:true,rows:[],checkedAt:Date.now()};
 const ctx={storage:{get:async key=>key==='snapshot'?saved:null},waitUntil(){}};
 const obj=new ScanJob(ctx,{});
 assert.deepEqual(await (await obj.fetch(new Request('https://internal/valuation/snapshot'))).json(),{...saved,stale:false});
 assert.deepEqual(await (await obj.fetch(new Request('https://internal/api/scan/job'))).json(),{ok:true,job:null});
});
