const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../public/taiex-vix-sar.js'),S=require('../public/parabolic-sar.js');
function fixture(){const timeline=Array.from({length:6},(_,i)=>({date:'2026-10-'+String(i+2).padStart(2,'0'),contract:'202611',open:100+i*10,close:105+i*10,high:110+i*10,low:95+i*10}));return {timeline,signalRows:timeline,lookup:new Map(timeline.map(b=>[b.date+':'+b.contract,b]))};}
function stub(t,rising){const old=S.calculate;S.calculate=rows=>rows.map((b,i)=>({rising:rising[i]}));t.after(()=>S.calculate=old);}
const observations=[21,19,14,16,17,18].map((value,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),value}));
test('crossing is strict at current value; US same-day close never leaks into TX',()=>{
 assert.equal(V.cross(20,19,20,'down'),true);assert.equal(V.cross(21,20,20,'down'),false);
 const bars=[{date:'2026-10-02'},{date:'2026-10-03'}];assert.equal(V.align(bars,observations)[0].value,21);assert.equal(V.align([{date:'2026-11-01'}],observations)[0],null);
});
test('same-day dual gates trade next open; costs and complete win rate are correct',t=>{
 stub(t,[true,true,false,false,false,false]);const r=V.simulate(fixture(),observations,{cost:2});
 assert.equal(r.tradeCount,1);assert.equal(r.winRate,100);assert.equal(r.trades[0].signalDate,'2026-10-03');assert.equal(r.trades[0].entryDate,'2026-10-04');assert.equal(r.trades[0].exitDate,'2026-10-06');assert.equal(r.net,18);
});
test('cross while SAR above does not latch for later; no trades means no win rate',t=>{
 stub(t,[false,false,true,true,true,true]);const r=V.simulate(fixture(),observations);assert.equal(r.tradeCount,0);assert.equal(r.forcedCount,0);assert.equal(r.winRate,null);
});
test('no matching exit is separately marked forced and excluded from win rate',t=>{
 stub(t,[true,true,true,true,true,true]);const r=V.simulate(fixture(),observations);assert.equal(r.forcedCount,1);assert.equal(r.tradeCount,0);assert.equal(r.winRate,null);assert.equal(r.net,35);
});
test('exit direction downward uses a different next-open exit',t=>{
 stub(t,[true,true,false,false,false,false]);const r=V.simulate(fixture(),observations,{exitDirection:'down'});assert.equal(r.trades[0].exitDate,'2026-10-05');assert.equal(r.net,10);
});
test('rollover does not turn contract gap into profit or count as a second trade',t=>{
 stub(t,[true,true,false,false,false,false]);const p=fixture();
 for(let i=3;i<6;i++){const b=p.timeline[i];p.lookup.set(b.date+':202611',{...b});p.timeline[i]={...b,contract:'202612',open:b.open+1000,close:b.close+1000,high:b.high+1000,low:b.low+1000};}
 const r=V.simulate(p,observations,{cost:2});assert.equal(r.rolls,1);assert.equal(r.tradeCount,1);assert.equal(r.net,16);assert.equal(r.legs.length,2);
});
test('UI wires dedicated button and invalidates stale settings',async()=>{
 const p=require('./helpers/detail-page.cjs').page('futures.html');await new Promise(r=>setImmediate(r));assert.ok(p.events.some(e=>e[0]==='vsRun'));assert.equal(p.nodes.get('vsRun').disabled,true);
});
