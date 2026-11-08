import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
const base='public/r1494a/fc23/';
const manifest=JSON.parse(readFileSync(base+'archive/manifest.json','utf8'));
const files=manifest.parts.map(p=>readFileSync(base+p.replace('./',''),'utf8').trim());
const buf=Buffer.from(files.join(''),'base64');
const hash=createHash('sha256').update(buf).digest('hex');
assert.equal(hash,manifest.sha256_gzip);
const obj=JSON.parse(gunzipSync(buf));
for(const [k,n] of Object.entries(manifest.counts))assert.equal(obj[k].length,n,k);
assert.equal(obj.daily_nav.at(-1).date,'2026-10-27');
assert.ok(Math.abs(obj.daily_nav.at(-1).nav-32.8529)<.0001);
assert.ok(obj.orders.some(x=>x.realized_pct!==null&&x.action==='SELL'&&x.filled));
assert.ok(obj.orders.some(x=>x.filled===false));
assert.ok(obj.plans.some(x=>x.action==='SELL_OPEN'&&x.signal_date<x.execution_date));
const js=readFileSync(base+'full-archive.js','utf8');
const html=readFileSync(base+'index.html','utf8');
const ids=['fc23-archive-state','fc23-full-nav','fc23-plan-date','fc23-day-date','fc23-plan-title','fc23-full-plans','fc23-day-detail','fc23-order-ticker','fc23-order-side','fc23-order-year','fc23-order-filled','fc23-initial-capital','fc23-full-orders','fc23-order-pagination','fc23-prev','fc23-next'];
for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'missing UI element '+id);
const es=new Map();function el(id){if(!es.has(id))es.set(id,{innerHTML:'',textContent:'',value:id==='fc23-initial-capital'?'3000000':id==='fc23-order-filled'?'all':'',disabled:false,addEventListener(){}});return es.get(id)}
const ctx={document:{getElementById:el},fetch:async path=>{
 const p=base+path.replace('./','');
 try{return new Response(readFileSync(p),{status:200})}catch{return new Response('404',{status:404})}
},crypto:webcrypto,Response,Blob,DecompressionStream,atob,console,setTimeout};
vm.runInNewContext(js,ctx,{filename:'full-archive.js'});
await new Promise(r=>setTimeout(r,1600));
assert.ok(el('fc23-archive-state').textContent.includes('驗證通過'),el('fc23-archive-state').textContent);
assert.ok(el('fc23-full-nav').innerHTML.includes('polyline'),'NAV not drawn');
assert.ok(el('fc23-full-orders').innerHTML.includes('2026-10-27'),'orders not rendered');
assert.ok(el('fc23-full-plans').innerHTML.includes('2026-10-27'),'plans not rendered');
assert.ok(el('fc23-day-detail').innerHTML.includes('淨值'),'daily why not rendered');
console.log('PASS FC23 full frozen replay: 1773 orders / 7638 plans / 1407 NAV, SHA256, trade PnL, daily reasons & order prices');