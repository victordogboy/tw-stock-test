const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../public/research-r19-core.js'),P=require('../public/research-r199-portfolio.js');
function fixture(){
 const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10));
 const ids=['twse:2330','twse:2317'];const daily=new Map(dates.map((date,i)=>[date,new Map(ids.map(id=>[id,{date,market:'twse',code:id.split(':')[1],open:i===2?110:100,close:i===1?90:i===2?110:100,high:111,low:89,volume:1000000}]))]));
 const rows=ids.map(id=>({date:dates[0],di:0,market:'twse',code:id.split(':')[1],rank:1,setup:id==='twse:2330'?90:80,hold:0}));
 return {data:{dates,daily},rows,p:{entry:[1,0,0,0,0,0,0,0],exit:[0,0,0,1,0,0,0,0],entryThreshold:65,exitThreshold:100,maxHold:1},range:[dates[0],dates.at(-1)],cost:{fee:0,tax:0,slippage:0}};
}
const run=(f,settings)=>P.run(C,f.data,f.rows,f.p,f.range,f.cost,settings);
test('cash limit prioritizes previous score, marks open loss daily, and measures account ROI and drawdown',()=>{
 const f=fixture(),r=run(f,{initial:1000,maxPositions:1,lotSize:1});assert.equal(r.n,1);assert.equal(r.trades[0].id,'twse:2330');assert.equal(r.trades[0].shares,10);assert.equal(r.skippedSlots,1);assert.equal(r.finalEquity,1100);assert.ok(Math.abs(r.roi-10)<1e-10);assert.equal(r.maxDrawdown,10);assert.equal(r.maxDrawdownMoney,100);assert.equal(r.maxInvested,1000);assert.equal(r.win,100);assert.equal(r.payoffRatio,null);assert.equal(r.curve[1].equity,900);assert.ok(r.curve.every(x=>x.cash>=0&&x.positions<=1));assert.ok(Math.abs(r.monthly.reduce((s,m)=>s+m.pnl,0)-r.netProfit)<1e-9);
});
test('fees, tax and slippage reconcile cash and per-trade net return',()=>{
 const f=fixture();f.rows=f.rows.slice(0,1);f.cost={fee:.001425,tax:.003,slippage:.0005};const r=run(f,{initial:1000,maxPositions:1,lotSize:1}),t=r.trades[0];assert.equal(t.shares,9);assert.ok(Math.abs(t.net-C.netReturn(100,110,f.cost))<1e-9);assert.ok(Math.abs(r.finalEquity-1000-t.pnl)<1e-9);assert.ok(Math.abs(t.buyOutlay-9*100*1.0005*1.001425)<1e-9);
});
test('lot size prevents unaffordable buys and missing exit bars delay sales without inventing fills',()=>{
 const f=fixture();assert.equal(run(f,{initial:1000,maxPositions:1,lotSize:1000}).n,0);assert.equal(run(f,{initial:1000,maxPositions:1,lotSize:1000}).skippedFunds,2);
 f.rows=f.rows.slice(0,1);f.data.daily.get(f.data.dates[2]).delete('twse:2330');const r=run(f,{initial:1000,maxPositions:1,lotSize:1});assert.equal(r.trades[0].exitDate,f.data.dates[3]);assert.equal(r.unfilled,1);assert.equal(r.staleMarks,1);
});
test('future changes do not affect earlier cash/equity path; liquidity restricts only entries',()=>{
 const f=fixture();f.rows=f.rows.slice(0,1);f.rows[0].volumeLots=1000;f.p.minVolumeLots=1000;
 const first=run(f,{initial:1000,maxPositions:1,lotSize:1});f.data.daily.get(f.data.dates[2]).get('twse:2330').volume=1;const second=run(f,{initial:1000,maxPositions:1,lotSize:1});assert.equal(second.n,1);assert.deepEqual(first.curve.slice(0,2),second.curve.slice(0,2));f.rows[0].volumeLots=999;assert.equal(run(f,{initial:1000,maxPositions:1,lotSize:1}).n,0);
});
test('invalid capital settings reject rather than silently creating leverage',()=>{for(const p of [{initial:0},{initial:-1},{maxPositions:0},{maxPositions:1.5},{lotSize:10}])assert.throws(()=>P.config(p));});
test('equal mode funds high price stocks independently and includes idle stocks in denominator',()=>{
 const f=fixture();f.rows=f.rows.slice(0,1);
 const r=run(f,{mode:'equal',perStock:10,ids:['twse:2330','twse:2317']});
 assert.equal(r.n,1);assert.ok(Math.abs(r.trades[0].shares-.1)<1e-10);
 assert.ok(Math.abs(r.roi-5)<1e-10);assert.equal(r.initial,20);
 assert.equal(r.stockResults[1].finalEquity,10);assert.equal(r.skippedFunds,0);
});
test('equal mode has no ten-stock or hundred-stock cap and costs reconcile',()=>{
 const f=fixture();f.cost={fee:.001,tax:.003,slippage:.001};
 const ids=['twse:2330','twse:2317',...Array.from({length:120},(_,i)=>'twse:'+String(5000+i))];
 const r=run(f,{mode:'equal',perStock:100,ids});
 assert.equal(r.n,2);assert.equal(r.initial,12200);
 assert.ok(Math.abs(r.netProfit-r.trades.reduce((s,t)=>s+t.pnl,0))<1e-8);
});
