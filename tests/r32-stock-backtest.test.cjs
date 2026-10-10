const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../public/stock-backtest-core.js');
const p=()=>({...C.defaults,entryMode:'absolute',entryBuffer:0,goal:'balanced',maxDrawdown:100,buy:{setup:100,opportunity:0,entry:0,hold:0},stay:{setup:0,opportunity:0,entry:0,hold:100},enter:60,exit:40,minTrades:1});
const bars=(values)=>values.map(([open,close,buy,stay],i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open,close,high:Math.max(open,close)+1,low:Math.min(open,close)-1,volume:100000,scores:{setup:buy,opportunity:0,entry:0,hold:stay}}));
test('inclusive entry/exit thresholds use NEXT open, not same-day or best OHLC',()=>{
 const r=C.simulate(bars([[100,100,60,80],[110,120,0,40],[130,140,0,80]]),p());
 assert.equal(r.trades,1);assert.equal(r.tradeLog[0].entry,110);assert.equal(r.tradeLog[0].exit,130);
 assert.equal(r.tradeLog[0].signalDate,'2025-01-01');assert.equal(r.tradeLog[0].exitSignalDate,'2025-01-02');
 assert.ok(Math.abs(r.roi-(130/110-1)*100)<1e-8);assert.equal(r.forced,0);
});
test('daily marked equity catches open losses even when final trade wins',()=>{
 const r=C.simulate(bars([[100,100,60,80],[100,80,0,80],[100,110,0,0],[120,120,0,80]]),p());
 assert.ok(Math.abs(r.maxDrawdown-20)<1e-8);assert.ok(Math.abs(r.roi-20)<1e-8);assert.equal(r.winRate,100);
});
test('costs apply to both legs, final holdings explicitly settle and zero trades stays null',()=>{
 const r=C.simulate(bars([[100,100,60,80],[100,100,0,80]]),{...p(),costBps:100});
 assert.ok(Math.abs(r.roi-((1-.005)/(1+.005)-1)*100)<1e-8);assert.equal(r.forced,1);assert.equal(r.winRate,0);
 const none=C.simulate(bars([[100,100,0,80],[100,100,0,80]]),p());assert.equal(none.trades,0);assert.equal(none.winRate,null);assert.equal(none.roi,0);assert.equal(none.maxDrawdown,0);
});
test('missing scores never become zero exits; one-price sessions defer sells and skip buys',()=>{
 const rows=bars([[100,100,60,80],[100,100,0,80],[100,100,0,0],[100,100,0,0],[110,110,0,80]]);
 rows[1].scores=null;rows[3].high=rows[3].low=100;
 const r=C.simulate(rows,p());assert.equal(r.tradeLog[0].exitDate,'2025-01-05');assert.equal(r.unfilled,1);assert.equal(r.tradeLog[0].exitSignalDate,'2025-01-03');
 rows[1].high=rows[1].low=100;assert.equal(C.simulate(rows,p()).trades,0);
});
test('trade size capped at original capital, prior profits stay cash',()=>{
 const r=C.simulate(bars([[100,100,60,80],[100,100,0,0],[200,200,60,80],[100,100,0,0],[200,200,0,80]]),p());
 assert.equal(r.trades,2);assert.ok(Math.abs(r.roi-200)<1e-8);
});
test('invalid weights, thresholds and costs rejected',()=>{
 assert.throws(()=>C.validate({...p(),enter:NaN}));assert.throws(()=>C.validate({...p(),costBps:-1}));assert.throws(()=>C.validate({...p(),stay:{...p().stay,hold:90}}));
});
function fixture(count=200){
 const {fixture:make}=require('./helpers/detail-page.cjs');const prices=make().slice(0,count);
 const chips={margin:[],inst:[],daytrade:[]};
 for(const [i,b] of prices.entries()){
  chips.margin.push({date:b.date,MarginPurchaseTodayBalance:10000+i,MarginPurchaseYesterdayBalance:9999+i});
  chips.inst.push({date:b.date,Foreign_Investor_buy:150000+i,Foreign_Investor_sell:100000,Investment_Trust_buy:20000,Investment_Trust_sell:5000,Dealer_buy:10000,Dealer_sell:5000});
  chips.daytrade.push({date:b.date,Volume:1000000});
 }
 return {prices,chips,start:prices[0].date,end:prices.at(-1).date};
}
test('replay only sees past price/chip data and preserves internal missing days',()=>{
 const data=fixture();data.chips.inst.splice(100,1);
 const prepared=C.prepare(data,(prices,chips)=>{const date=prices.at(-1).date;assert.ok(Object.values(chips).every(a=>a.every(x=>x.date<=date)));return {setup:60,opportunity:50,entry:50,hold:70}});
 assert.equal(prepared.coverage.missing,20);assert.equal(prepared.rows.length,136);assert.equal(prepared.rows.find(r=>r.date===data.prices[100].date).scores,null);
});
test('generated scorer matches production detail, and future mutations leave past scores unchanged',()=>{
 const data=fixture(),{page}=require('./helpers/detail-page.cjs'),{ctx}=page('detail.html');
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/detail-score-r32.js'),'utf8'),ctx);
 ctx.testData=data;
 const result=vm.runInContext(`(()=>{const rows=testData.prices.slice(0,120),chips=Object.fromEntries(Object.entries(testData.chips).map(([k,a])=>[k,a.filter(r=>r.date<=rows.at(-1).date)])),R=combineScores(rows,chips.margin,chips.inst,chips.daytrade),E=entryEngine(rows,R);return [TWDetailScore(rows,chips),{setup:R.quality,opportunity:E.opportunity,entry:E.score,hold:E.hold}]})()`,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(result[0])),JSON.parse(JSON.stringify(result[1])));
 const one=C.prepare(data,ctx.TWDetailScore);
 const modified=structuredClone(data);modified.prices.at(-1).close=1000;modified.prices.at(-1).high=1001;modified.chips.inst.at(-1).Foreign_Investor_buy=1e9;
 const two=C.prepare(modified,ctx.TWDetailScore);assert.deepEqual(one.rows.slice(0,-1),two.rows.slice(0,-1));
});
test('optimizer never selects with holdout values; exact chosen parameters reproduce training result',()=>{
 const rows=bars(Array.from({length:80},(_,i)=>[100+i,100+i,i%4===0?90:10,i%4===2?10:90]));
 const a=C.optimize(rows,p()),modified=structuredClone(rows);
 for(let i=a.split;i<modified.length;i++){modified[i].open*=2;modified[i].close*=2;modified[i].high*=2;modified[i].low*=2;modified[i].scores={setup:0,opportunity:100,entry:100,hold:0};}
 const b=C.optimize(modified,p());assert.deepEqual(a.best,b.best);assert.equal(a.train.roi,b.train.roi);
 assert.equal(a.train.roi,C.simulate(rows,a.best,{to:a.split}).roi);assert.equal(a.full.roi,C.simulate(rows,a.best).roi);
 assert.ok(a.done>=99225);assert.equal(a.test.start,rows[a.split].date);
});
module.exports={fixture};
