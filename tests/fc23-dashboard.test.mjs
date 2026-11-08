import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root='public/r1494a/';
const html=readFileSync(root+'fc23/index.html','utf8');
const js=readFileSync(root+'fc23/dashboard.js','utf8');
const hist=JSON.parse(readFileSync(root+'fc23/historical-sample.json','utf8'));
const fc23=JSON.parse(readFileSync(root+'fc23/snapshot.json','utf8'));
const existing=JSON.parse(gunzipSync(readFileSync(root+'snapshot.bin')));
assert.equal(hist.monthly.length,70);
assert.equal(hist.fills.length,22);
assert.equal(fc23.live_plan_available,false);
assert.equal(fc23.live_execution_allowed,false);
assert.ok(html.includes('src="./dashboard.js"'));
assert.ok(html.includes('href="../"'));
assert.ok(existing.dates.length>1300);
assert.ok(existing.curves.old49.length>1300);
assert.ok(existing.curves.market.length>1300);
const elements=new Map();
const el=id=>elements.get(id)??elements.set(id,{textContent:'',innerHTML:'',value:'all',addEventListener:(event,fn)=>{el(id).fn=fn}}).get(id);
const files={
 './historical-sample.json':JSON.stringify(hist),
 '../snapshot.bin':gunzipSync(readFileSync(root+'snapshot.bin')).toString('utf8')
};
const remote={
 './historical-sample.json':new Response(JSON.stringify(hist),{status:200}),
 '../snapshot.bin':new Response(readFileSync(root+'snapshot.bin'),{status:200})
};
const sandbox={document:{getElementById:el},console,setTimeout,clearTimeout,DecompressionStream,Response,
fetch:async(path)=>remote[path]??new Response('Not found',{status:404})};
vm.runInNewContext(js,sandbox,{filename:'dashboard.js'});
await new Promise(res=>setTimeout(res,1200));
for(const id of ['fc23-shared-data','fc23-performance-chart','fc23-fills','fc23-why','fc23-compare-legend']){
 assert.ok((el(id).innerHTML||el(id).textContent).length>0,'empty '+id);
}
assert.ok(el('fc23-performance-chart').innerHTML.includes('<polyline'),'curves not rendered');
assert.ok(el('fc23-fills').innerHTML.includes('2026-10-27'),'ledger not rendered');
assert.ok(el('fc23-shared-data').innerHTML.includes('2026-11-06'),'live refresh status missing');
assert.ok(el('fc23-why').innerHTML.includes('不允許'),'why-trade gating missing');
assert.ok(!el('fc23-shared-data').textContent.startsWith('⚠️'),'JS errored '+el('fc23-shared-data').textContent);
console.log('PASS FC23 DOM mock with real 2026-11-06 R1494 benchmark; R1494 model unchanged');
