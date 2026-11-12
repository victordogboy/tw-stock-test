import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadC26MonitorSnapshot,parseCsv,verifyHistorical} from '../public/r1494a/c26/inline-adapter.mjs';
const root=new URL('../',import.meta.url).pathname;
const droot='public/r1494a/c26/data/';
const index=JSON.parse(fs.readFileSync(root+droot+'historical-assets.json','utf8'));
const manifest=JSON.parse(fs.readFileSync(root+'public/r1494a/c26/manifest.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const assets={
 'manifest.json':JSON.stringify(manifest),
 'data/historical-assets.json':JSON.stringify(index)
};
for(const [key,slot] of Object.entries(index.parts)){
 for(const name of slot.base64_parts){assets['data/'+name]=fs.readFileSync(root+droot+name,'utf8').trim()}
 const buf=Buffer.from(slot.base64_parts.map(n=>assets['data/'+n]).join(''),'base64');
 assert.equal(buf.length,slot.bytes_gzip);assert.equal(hash(buf),slot.sha256_gzip);
 assets[key]=gunzipSync(buf).toString('utf8');
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 const path=new URL(url,'https://example.invalid').pathname.replace(/^\/r1494a\/c26\//,'');
 if(path==='/api/c26/status')return Response.json({model_version:'C26',latest_market_data_as_of:'2026-11-11',source_status:'blocked',source_error:'FinMind unavailable',plan:{readiness:'blocked',actions:[]}});
 if(!(path in assets))return Response.json({error:'Not found'},{status:404});
 return new Response(assets[path]);
};
after(()=>{globalThis.fetch=originalFetch});
test('C26 exact frozen NAV and order archive validates',()=>{
 const values=parseCsv(assets.nav),orders=parseCsv(assets.orders);const check=verifyHistorical(values,orders);
 assert.equal(check.days,1407);assert.equal(check.orders,1758);
 assert.equal(check.buys,539);assert.equal(check.sells,1028);assert.equal(check.unfilled,191);
 assert.equal(check.newFills,309);assert.ok(Math.abs(check.mddPct+17.989769234703846)<1e-8);
});
test('C26 inline monitor exposes ONLY archived 2026-10-27 positions and blocks new live plans',async()=>{
 const shared={dates:[],curves:{old49:[],market:[]},status:{data_as_of:'2026-11-11'},names:{}};
 const d=await loadC26MonitorSnapshot(shared);
 assert.equal(d.model_version,'C26');assert.equal(d.dates.length,1407);assert.equal(d.orders.length,1758);
 assert.equal(d.dates.at(-1),'2026-10-27');assert.equal(d.status.data_as_of,'2026-10-27');
 assert.equal(d.status.current_market_as_of,'2026-11-11');
 assert.equal(d.plan.readiness,'blocked');assert.deepEqual(d.plan.actions,[]);
 assert.equal(d.snapshots.at(-1).holdings.length,5);
 assert.equal(d.curves.strategy.at(-1),18.20495844396837);
});
test('corrupt historical data must be rejected and not used as C26 signals',()=>{
 const rows=parseCsv(assets.nav),orders=parseCsv(assets.orders);
 rows[100].nav='NaN';assert.throws(()=>verifyHistorical(rows,orders),/非法/);
});