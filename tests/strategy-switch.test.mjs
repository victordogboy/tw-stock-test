import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const base='public/r1494a/';
const fc=JSON.parse(gunzipSync(Buffer.from(readFileSync(base+'fc23/integrated-snapshot.b64','utf8'),'base64')));
const archive=JSON.parse(gunzipSync(Buffer.from(Array.from({length:8},(_,i)=>readFileSync(base+`fc23/archive/part${String(i+1).padStart(2,'0')}.txt`,'utf8').trim()).join(''),'base64')));
assert.equal(fc.orders.length,1773);assert.equal(fc.snapshots.length,1407);
assert.equal(Object.values(fc.planHistory).reduce((n,p)=>n+p.actions.length,0),7638);
for(let i=0;i<fc.snapshots.length;i++){
 const s=fc.snapshots[i];assert.ok(Math.abs(s.nav-archive.daily_nav[i].nav)<1e-9);
 assert.ok(Math.abs(s.holdings.reduce((a,h)=>a+h.weight,0)-s.exposure)<1e-10);
 assert.ok(s.holdings.length<=8);assert.ok(s.signal<s.date);
 for(const h of s.holdings){assert.ok(h.entryDate<=s.date);assert.ok(h.lastBuyDate<=s.date);assert.ok(Math.abs(h.unrealizedNotional-(h.marketNotional-h.costNotional))<1e-10)}
}
for(let i=0;i<fc.orders.length;i++){
 const a=fc.orders[i],b=archive.orders[i];assert.equal(a.date,b.execution_date);assert.equal(a.code,b.ticker);assert.equal(a.filled,b.filled);
 if(a.realizedPct!==null)assert.ok(Math.abs(a.realizedPct-b.realized_pct/100)<1e-10);
}
assert.equal(fc.plan.readiness,'blocked');assert.equal(fc.plan.actions.length,0);
const html=readFileSync(base+'index.html','utf8'),els=new Map();
const el=id=>{if(!els.has(id))els.set(id,{value:({'#strategy':'R1494-A','#capital':'1000000','#fill':'','#search':'','#monthYear':'2026'})[id]||'',innerHTML:'',textContent:'',disabled:false,classList:{add(){},remove(){}}});return els.get(id)};
const memory=new Map();let csvName;
const ctx={console,Response,Blob,DecompressionStream,Uint8Array,atob,crypto:webcrypto,setTimeout,setInterval:()=>0,localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},document:{querySelector:el,querySelectorAll:()=>[],createElement:()=>({click(){csvName=this.download}}),hidden:false,title:''},fetch:async path=>path.startsWith('/api/fc23/')?Response.json({snapshots:[],orders:[],planHistory:{},running:false,data_as_of:'2026-10-27',sync_status:'blocked'}):new Response(readFileSync(base+path.replace('./','')))};
vm.createContext(ctx);vm.runInContext(readFileSync(base+'strategy-switch.js','utf8'),ctx);
vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],ctx);
async function idle(){for(let i=0;i<200&&vm.runInContext('busy || !D',ctx);i++)await new Promise(r=>setTimeout(r,20));assert.equal(vm.runInContext('busy',ctx),false)}
await idle();assert.equal(vm.runInContext('D.model_version',ctx),'R1494-A');
const initial=vm.runInContext('JSON.stringify({curves:D.curves,orders:D.orders,plan:D.plan})',ctx);
el('#strategy').value='FC23';el('#strategy').onchange();await idle();
assert.equal(vm.runInContext('D.model_version',ctx),'FC23');assert.match(el('#strategySummary').textContent,/3,185.29/);
assert.match(el('#status').innerHTML,/FC23/);assert.match(el('#planNote').textContent,/資料|補齊/);
assert.match(el('#rulesMain').innerHTML,/60 日報酬/);
assert.match(el('#rulesMain').innerHTML,/40 日淨值/);
assert.match(el('#rulesMain').innerHTML,/FC23 沒有套用 R1494-A/);
assert.match(el('#rulesMain').innerHTML,/1,089/);
assert.ok(el('#rulesMain').innerHTML.includes('<details'), 'Full FC23 policy must remain expandable');
const riskExample=vm.runInContext("fc23RiskBreakdown({decision:{breadthDelta:-.48223383724689484,portRisk:false,marketCold:true,ddGate:false,target:.010418625},snapshot:{basket:false,bear:true,overlay:true,gate:.81}})",ctx);
assert.match(riskExample,/1.04%/);
assert.match(riskExample,/廣度基礎/);
el('#date').value='100';el('#date').onchange();assert.match(el('#dailyWhy').textContent,/FC23/);
el('#search').value='3406';el('#search').oninput();el('#export').onclick();assert.equal(csvName,'FC23_paper_trades.csv');
el('#strategy').value='R1494-A';el('#strategy').onchange();await idle();
assert.equal(vm.runInContext('JSON.stringify({curves:D.curves,orders:D.orders,plan:D.plan})',ctx),initial);
assert.equal(vm.runInContext('D.ledger',ctx),'R1494_A_paper');
console.log('PASS original R1494 data unchanged after FC23 roundtrip; 1407 NAV, holdings, 1773 orders, 7638 plans, PnL, filters and CSV export');
