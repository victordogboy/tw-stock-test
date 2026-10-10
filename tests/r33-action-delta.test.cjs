const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const C=require('../public/stock-backtest-core.js');
const p=(extra={})=>({...C.defaults,buy:{setup:100,opportunity:0,entry:0,hold:0},stay:{setup:0,opportunity:0,entry:0,hold:100},entryMode:'delta',enter:10,exit:50,entryBuffer:5,minTrades:1,...extra});
const bars=values=>values.map(([buy,stay,close=100,volume=100],i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:close,close,high:close+1,low:close-1,volume,scores:{setup:buy,opportunity:0,entry:0,hold:stay}}));
test('simultaneous entry and exit never opens a position in either entry mode',()=>{
 for(const mode of ['delta','deltaVolume','absolute']){
  const r=C.simulate(bars([[30,40],[80,40],[85,40],[90,40]]),p({entryMode:mode}));
  assert.equal(r.trades,0);assert.ok(r.blockedEntries>0);
 }
});
test('guard is strict at exit + buffer, including zero buffer, and missing stay fails closed',()=>{
 for(const [stay,buffer] of [[50,0],[55,5],[null,0]]){
  const r=C.simulate(bars([[10,80],[80,stay],[80,80]]),p({entryBuffer:buffer}));assert.equal(r.trades,0);
 }
 const r=C.simulate(bars([[10,80],[80,56],[80,80]]),p());assert.equal(r.trades,1);assert.equal(r.tradeLog[0].stayAtSignal,56);
});
test('high but unchanged Action does not meet positive change threshold',()=>{
 const rows=bars([[80,80],[80,80],[80,80],[80,80]]);
 assert.equal(C.simulate(rows,p()).trades,0);assert.equal(C.simulate(rows,p({entryMode:'absolute',enter:60})).trades,1);
});
test('entry change matches scanner rounded score difference and volume bands',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../public/dual-action.js'),'utf8'),ctx);
 for(const ratio of [0,.59,.6,1,1.2,1.5,2]){
  const rows=bars([[40,80,100,100],[51,80,100,100*ratio]]);
  const expected=ctx.TWDualAction.metrics({...rows[1].scores,previousScores:rows[0].scores,volume:rows[1].volume,previousVolume:100},{buy:p().buy,stay:p().stay});
  assert.equal(C.entrySignals(rows,p().buy,'deltaVolume')[1],expected.buyDelta);
  assert.equal(C.entrySignals(rows,p().buy,'delta')[1],11);
 }
 const missing=bars([[40,80],[60,80],[80,80]]);missing[1].scores=null;
 assert.deepEqual(C.entrySignals(missing,p().buy,'delta'),[null,null,null]);
 const zero=bars([[40,80,100,0],[60,80]]);assert.equal(C.entrySignals(zero,p().buy,'deltaVolume')[1],null);
});
test('a valid entry can still exit quickly when NEW information weakens holding score',()=>{
 const r=C.simulate(bars([[20,80],[40,80],[40,40,90],[40,40,80]]),p());
 assert.equal(r.completedTrades,1);assert.equal(r.tradeLog[0].entryDate,'2025-01-03');assert.equal(r.tradeLog[0].exitDate,'2025-01-04');
 assert.equal(r.tradeLog[0].stayAtSignal,80);assert.equal(r.tradeLog[0].entrySignal,20);
});
test('prepare retains immediately preceding warmup score for first-day change',()=>{
 const prices=require('./helpers/detail-page.cjs').fixture(),chips={margin:[],inst:[],daytrade:[]};
 for(const b of prices){chips.margin.push({date:b.date,MarginPurchaseTodayBalance:1,MarginPurchaseYesterdayBalance:1});chips.inst.push({date:b.date,Foreign_Investor_buy:1,Foreign_Investor_sell:1,Investment_Trust_buy:1,Investment_Trust_sell:1});chips.daytrade.push({date:b.date,Volume:1});}
 const data={prices,chips,start:prices[100].date,end:prices[110].date};
 const a=C.prepare(data,h=>({setup:h.length%100,opportunity:0,entry:0,hold:80}));
 assert.equal(a.rows.length,11);assert.equal(a.rows[0].previousScores.setup,0);assert.equal(a.rows[0].scores.setup,1);assert.equal(C.entrySignals(a.rows,p().buy,'delta')[0],1);
 const b=C.prepare({...data,chips:{...chips,inst:chips.inst.filter(r=>r.date!==prices[103].date)},end:prices[130].date},h=>({setup:h.length%100,opportunity:0,entry:0,hold:80}));
 assert.equal(C.entrySignals(b.rows,p().buy,'delta')[b.rows.findIndex(r=>r.date===prices[123].date)],null);
});
test('sample-adjusted score penalizes tiny perfect samples; forced close never counts for ranking',()=>{
 assert.ok(C.adjustedWinRate(2,2)<C.adjustedWinRate(70,100));assert.equal(C.adjustedWinRate(0,0),null);
 const r=C.simulate(bars([[20,80],[40,80],[40,80,110]]),p());
 assert.equal(r.forced,1);assert.equal(r.completedTrades,0);assert.equal(r.signalWinRate,null);assert.equal(r.adjustedWinRate,null);
 assert.equal(C.objective(r,'robustWinRate'),-Infinity);
});
test('optimization refuses losing-only candidates and leaves holdout out of delta selection',()=>{
 const losing=bars(Array.from({length:80},(_,i)=>[i%4?20:80,i%4===2?20:80,200-i]));
 assert.throws(()=>C.optimize(losing,p()),/正報酬/);
 const rising=bars(Array.from({length:80},(_,i)=>[i%4?20:80,i%4===2?20:80,100+i]));
 const a=C.optimize(rising,p()),changed=structuredClone(rising);
 for(let i=a.split;i<changed.length;i++){changed[i].scores={setup:100,opportunity:100,entry:100,hold:100};changed[i].volume=1;}
 const b=C.optimize(changed,p());assert.deepEqual(a.best,b.best);assert.deepEqual(a.train,b.train);assert.equal(a.full.roi,C.simulate(rising,a.best).roi);
 assert.ok(C.optimize(rising,p({costBps:100,maxDrawdown:100})).train.roi>0);
 assert.throws(()=>C.optimize(rising,p({costBps:100,maxDrawdown:0})),/回撤上限/);
});
test('legacy settings preserve coefficients and exit but never reinterpret absolute threshold as delta',()=>{
 const old={...C.defaults,enter:65,exit:38,capital:123456,minTrades:5};delete old.entryMode;delete old.entryBuffer;delete old.maxDrawdown;
 const next=C.migrateLegacy(old);assert.equal(next.enter,10);assert.equal(next.exit,38);assert.equal(next.capital,123456);assert.deepEqual(next.buy,old.buy);assert.equal(next.minTrades,20);assert.equal(old.enter,65);
 assert.throws(()=>C.validate(p({entryMode:'absolute',enter:-1})));
 assert.throws(()=>C.validate(p({maxDrawdown:-1})));
});
