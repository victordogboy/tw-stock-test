const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../public/taiex-action.js');
const {multiFixture}=require('./helpers/taiex-multi.cjs');
const rows=multiFixture();
const p={delta:0,minEntry:0,exit:0,maxAge:0,cost:3};
const range={start:'2025-10-01',end:'2026-02-28'};

test('buy-and-roll benchmark trades each month using same-price old/new opens and one cost per leg',()=>{
 const timeline=[
  {date:'2025-10-30',contract:'202511',open:100,close:110},
  {date:'2025-10-31',contract:'202511',open:110,close:120},
  {date:'2025-11-01',contract:'202512',open:200,close:205},
  {date:'2025-11-02',contract:'202512',open:205,close:215}
 ];
 const lookup=new Map(timeline.map(b=>[b.date+':'+b.contract,b]));
 lookup.set('2025-11-01:202511',{date:'2025-11-01',contract:'202511',open:123});
 const b=A.benchmarkMulti({timeline,lookup},{cost:2});
 assert.equal(b.net,34);assert.equal(b.rolls,1);assert.equal(b.trades.length,2);
 assert.equal(b.trades[0].net,21);assert.equal(b.trades[1].net,13);
 const short=A.benchmarkMulti({timeline,lookup},{direction:'short',cost:2});
 assert.equal(short.net,34,'benchmark remains long regardless of strategy direction');
});

test('R44 rolls the same economic holding without resetting entry eligibility or faking additional wins',()=>{
 const r=A.backtestMultiR44(rows,p,{},range),old=A.backtestMulti(rows,p,{},range);
 assert.equal(r.rollovers,4);
 assert.equal(r.carryRolls,4);
 assert.equal(r.trades.length,5);
 assert.equal(r.signalTradeCount,1,'five monthly settlements are only ONE entry-to-exit trade');
 assert.equal(r.signalTrades.length,1);
 assert.equal(r.signalTrades[0].legs,5);
 assert.equal(r.signalTrades[0].net,r.net);
 assert.equal(r.gross-r.net,r.trades.length*p.cost);
 assert.equal(r.benchmark.tradeLegs,5);
 assert.equal(r.excessNet,r.net-r.benchmark.net);
 assert.equal(r.target2x,null,'negative benchmark does not produce a misleading x-times comparison');
 assert.notDeepEqual(r.trades,old.trades);
});

test('contract constant offsets cannot fabricate roll P&L, benchmarks or trade success',()=>{
 const original=A.backtestMultiR44(rows,p,{},range);
 const shifted=rows.map(b=>{
  const gap=Number(b.contract.slice(4))*10000;
  return {...b,open:b.open+gap,high:b.high+gap,low:b.low+gap,close:b.close+gap};
 });
 const b=A.backtestMultiR44(shifted,p,{},range);
 assert.equal(b.net,original.net);
 assert.equal(b.benchmark.net,original.benchmark.net);
 assert.equal(b.maxDrawdown,original.maxDrawdown);
 assert.deepEqual(b.signalTrades.map(x=>x.net),original.signalTrades.map(x=>x.net));
});

test('R44 OOS optimizer selects solely on chronological training period; no repeated leg sample inflation',()=>{
 let end;
 for(const step of A.optimizeMultiR44(rows,p,{},range,1,0.7))end=step;
 assert.equal(end.done,end.total);
 assert(end.eligible>0);assert(end.maxTrades>=1);
 assert(end.top.length>0);
 assert(end.trainEnd<end.validationStart);
 assert.deepEqual([...end.top].sort(A.compareR44),end.top);
 for(const item of end.top){
  const train=A.backtestMultiR44(rows,item.config,{}, {start:end.trainStart,end:end.trainEnd});
  const testOnly=A.backtestMultiR44(rows,item.config,{}, {start:end.validationStart,end:end.validationEnd});
  assert.equal(item.result.net,train.net);
  assert.equal(item.result.benchmark.net,train.benchmark.net);
  assert.equal(item.result.signalTradeCount,train.signalTradeCount);
  assert.equal(item.validation.net,testOnly.net);
  assert.equal(item.validation.benchmark.net,testOnly.benchmark.net);
 }
 let noCandidates;
 for(const step of A.optimizeMultiR44(rows,p,{},range,20,0.7))noCandidates=step;
 assert.equal(noCandidates.top.length,0);
 assert(noCandidates.maxTrades<20,'twenty rollover settlement legs must not pass a twenty-trade gate');
 assert.throws(()=>[...A.optimizeMultiR44(rows,p,{},range,1,0.91)],/訓練比例/);
});

test('same training scores remain unchanged when future test closes are altered',()=>{
 let base;for(const t of A.optimizeMultiR44(rows,p,{},range,1,0.7))base=t;
 const changed=rows.map(b=>b.date>=base.validationStart?{...b,open:b.open+900,close:b.close+900,high:b.high+900,low:b.low+900}:b);
 let test;for(const t of A.optimizeMultiR44(changed,p,{},range,1,0.7))test=t;
 assert.deepEqual(base.top.map(x=>[x.config,x.result.net,x.result.signalTradeCount]),
   test.top.map(x=>[x.config,x.result.net,x.result.signalTradeCount]));
});

test('current R44 browser page wires split and benchmark controls and loads fixed scripts',async()=>{
 const {page}=require('./helpers/detail-page.cjs');
 const {apiFixture}=require('./helpers/taiex-multi.cjs');
 const pge=page('futures.html');await new Promise(resolve=>setImmediate(resolve));
 pge.ctx.fetch=async()=>new Response(JSON.stringify({ok:true,data:apiFixture(rows),source:'fixture'}));
 const fire=(id,event='click')=>{
  const e=pge.events.find(x=>x[0]===id&&x[1]===event);assert(e,'no '+id+' handler');return e[2]();
 };
 pge.nodes.get('txSession').value='position';
 pge.nodes.get('txYears').value='1';
 await fire('txLoad');
 fire('actAllDates');
 fire('actRun');
 assert.match(pge.nodes.get('actBenchmark').textContent,/同期買進持有/);
 assert.match(pge.nodes.get('actResult').textContent,/合約結算/);
 pge.nodes.get('actMinTrades').value='1';
 pge.nodes.get('actTrainShare').value='0.7';
 pge.ctx.setTimeout=fn=>fn();
 await fire('actOptimize');
 assert.match(pge.nodes.get('actOptStatus').textContent,/驗證期/);
 assert.match(pge.nodes.get('actOptResults').children[0].children[1].textContent,/未參與調參的驗證期/);
});
