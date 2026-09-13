const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../public/research-r19-core.js');
function fixture(){const snapshots=[],dates=[];for(let i=0;dates.length<280;i++){const d=new Date(Date.UTC(2024,0,1)+i*86400000);if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10));}
for(let i=0;i<dates.length;i++){const date=dates[i],p=100+i*.1+Math.sin(i/3);snapshots.push({ok:true,date,market:'twse',rows:[{date,market:'twse',code:'2330',open:p,close:p+.1,high:p+1,low:p-1,volume:1000+i}]});}return {snapshots,dates};}
test('fixed pool counts missing symbols and price scores need no chips; future bars cannot change past scores',()=>{
const {snapshots,dates}=fixture(),o={universe:'fixed',fixedStocks:['twse:2330','twse:2317'],scoreMode:'price',start:dates[90]};
const data=C.prepare(snapshots,['twse'],o),r=C.replayStock(data,'twse:2330',{},C.priceScore,o);
assert.equal(data.ranks.get(dates[100]).size,2);assert.equal(r.stats.missingChips,0);assert.equal(r.rows.length,190);assert.ok(r.rows.every(x=>x.chipDate===null));
const cut=150,partial=C.prepare(snapshots.slice(0,cut+1),['twse'],o);
assert.deepEqual(C.replayStock(partial,'twse:2330',{},C.priceScore,o).rows,r.rows.filter(x=>x.date<=dates[cut]));
assert.equal(C.replayStock(data,'twse:2317',{},C.priceScore,o).rows.length,0);
assert.equal(C.labels(data,{market:'twse',code:'2317',di:100},{fee:0,tax:0,slippage:0}).net1,null);
assert.equal(C.replayStock(data,'twse:2330',{},C.priceScore,{...o,scoreMode:'full'}).rows.length,0);
});
test('actual Worker completes fixed-pool pure-price OOS with no chip input',async()=>{
const fs=require('node:fs'),vm=require('node:vm'),{snapshots,dates}=fixture(),messages=[];
const ctx=vm.createContext({console});ctx.self=ctx;ctx.postMessage=m=>messages.push(m);ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync('public'+f.split('?')[0],'utf8'),ctx));
vm.runInContext(fs.readFileSync('public/research-r19-worker.js','utf8'),ctx);
await ctx.onmessage({data:{snapshots,chips:{},options:{universe:'fixed',fixedStocks:['twse:2330'],scoreMode:'price',start:dates[90],markets:['twse'],cost:{fee:.001425,tax:.003,slippage:.0005},candidates:32,seed:123,minTrades:20}}});
assert.equal(messages.find(m=>m.type==='error'),undefined);const r=messages.find(m=>m.type==='done').report;
assert.equal(r.coverage.scoredObservations,190);assert.equal(r.coverage.missingChips,0);assert.match(r.provenance.engine,/price-only/);assert.equal(r.patch,'19.9');
});
test('real Worker evaluates manual parameters even below selection minimum and keeps separate baseline',async()=>{
const fs=require('node:fs'),vm=require('node:vm'),{snapshots,dates}=fixture(),messages=[];
const ctx=vm.createContext({console:{warn(){}}});ctx.self=ctx;ctx.postMessage=m=>messages.push(m);ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync('public'+f.split('?')[0],'utf8'),ctx));vm.runInContext(fs.readFileSync('public/research-r19-worker.js','utf8'),ctx);
await ctx.onmessage({data:{snapshots,chips:{},options:{universe:'fixed',fixedStocks:['twse:2330'],scoreMode:'price',start:dates[90],markets:['twse'],cost:{fee:.001425,tax:.003,slippage:.0005},candidates:128,seed:123,minTrades:9999,manual:{entry:[0,0,1,0,0,0,0,0],exit:[0,0,0,-1,0,0,0,0],entryThreshold:50,exitThreshold:65,maxHold:8},exploratoryRetest:true}}});
assert.equal(messages.find(m=>m.type==='error'),undefined);const r=messages.find(m=>m.type==='done').report;assert.ok(r.chosen);assert.equal(r.chosen.parameters.entryThreshold,50);assert.equal(r.chosen.parameters.maxHold,8);assert.equal(r.candidates.length,1);assert.equal(r.options.exploratoryRetest,true);
});
