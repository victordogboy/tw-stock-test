const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/taiex-action.js');
const {multiFixture,apiFixture}=require('./helpers/taiex-multi.cjs');
const rows=multiFixture(),range={start:'2025-10-01',end:'2026-02-28'},p={delta:0,minEntry:0,exit:0,maxAge:0,cost:3};
const make=(x={})=>({...p,...x});

test('R45 supports actual early, trend, and hybrid states with separately adjustable exits',()=>{
 const r={};
 for(const entryType of ['early','trend','hybrid'])for(const exitType of ['trend','atr','mixed']){
  const v=A.backtestMultiR45(rows,make({entryType,exitType}),{},range);
  assert(Number.isFinite(v.net));assert(v.benchmark);
  assert.equal(v.exposure.totalBars,v.totalBars);
  assert(v.exposure.percent>=0&&v.exposure.percent<=100);
  assert(v.exposure.missedUpPoints>=0);
  assert.equal(v.actions.earlyEntries+v.actions.trendEntries,v.signalTradeCount);
  assert.equal(v.signalTrades.reduce((sum,t)=>sum+t.net,0),v.net);
  assert.equal(v.gross-v.net,v.trades.length*p.cost);
  r[entryType+exitType]=v;
 }
 assert(r.earlytrend.actions.earlyEntries>0&&r.earlytrend.actions.trendEntries===0);
 assert(r.trendtrend.actions.trendEntries>0&&r.trendtrend.actions.earlyEntries===0);
 assert(r.hybridatr.actions.earlyEntries+r.hybridatr.actions.trendEntries>0);
 assert.notEqual(r.earlytrend.net,r.earlyatr.net);
 assert.notEqual(r.trendtrend.net,r.earlytrend.net);
});

test('R45 trend re-entry needs no Action delta: continuity can survive until after the 60th bar',()=>{
 const synthetic=[];let previous=null;
 for(let i=0;i<220;i++){
  const date=new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),c=20000+i*12,contract=A.nextMonth(date);
  const b={date,contract,open:c-3,close:c,high:c+15,low:c-15,volume:10000,openInterest:1000};synthetic.push(b);
  if(previous&&previous!==contract)synthetic.push({...b,contract:previous});
  previous=contract;
 }
 const extreme=make({delta:100,entryType:'early',exitType:'trend'});
 const early=A.backtestMultiR45(synthetic,extreme,{}, {start:'2025-02-01',end:synthetic.at(-1).date});
 const trend=A.backtestMultiR45(synthetic,{...extreme,entryType:'trend',trendBars:2},{},{start:'2025-02-01',end:synthetic.at(-1).date});
 assert.equal(early.signalTradeCount,0);
 assert(trend.signalTradeCount>=1);
 assert(trend.exposure.percent>50);
 assert(trend.net>0);
});

test('R45 remains immune to contract-specific constant price offsets across roll boundaries',()=>{
 const a=A.backtestMultiR45(rows,make({entryType:'hybrid',exitType:'atr'}),{},range);
 const modified=rows.map(b=>{const shift=Number(b.contract.slice(4))*10000;return {...b,open:b.open+shift,high:b.high+shift,low:b.low+shift,close:b.close+shift};});
 const b=A.backtestMultiR45(modified,make({entryType:'hybrid',exitType:'atr'}),{},range);
 assert.equal(a.net,b.net);
 assert.equal(a.benchmark.net,b.benchmark.net);
 assert.equal(a.signalTradeCount,b.signalTradeCount);
});

test('R45 optimizer finds mode-specific finalists without ever ranking by validation results',()=>{
 let final;
 for(const v of A.optimizeMultiR45(rows,p,{},range,1,0.7))final=v;
 assert(final.done===final.total);
 assert(final.total>=100&&final.total<5000);
 assert.deepEqual(final.modes.map(v=>v.mode),['early','trend','hybrid']);
 assert(final.modes.every(x=>x.choice));
 assert.deepEqual([...final.top].sort(A.compareR45),final.top);
 for(const x of final.modes){
  const choice=x.choice,train=A.backtestMultiR45(rows,choice.config,{}, {start:final.trainStart,end:final.trainEnd}),
   check=A.backtestMultiR45(rows,choice.config,{}, {start:final.validationStart,end:final.validationEnd});
  assert.equal(choice.result.net,train.net);
  assert.equal(choice.validation.net,check.net);
  assert.equal(choice.validation.benchmark.net,check.benchmark.net);
 }
 const shifted=rows.map(b=>b.date>=final.validationStart?{...b,open:b.open+888,high:b.high+888,low:b.low+888,close:b.close+888}:b);
 let later;for(const v of A.optimizeMultiR45(shifted,p,{},range,1,0.7))later=v;
 assert.deepEqual(final.top.map(x=>[x.config,x.result.net]),
 later.top.map(x=>[x.config,x.result.net]));
 let none;for(const v of A.optimizeMultiR45(rows,p,{},range,50,0.7))none=v;
 assert.equal(none.top.length,0);
 assert.throws(()=>A.validate({entryType:'magic'}),/R45/);
 assert.throws(()=>A.validate({exitType:'magic'}),/R45/);
});

test('R45 live page buttons show exposure and three mode sample-out comparisons',async()=>{
 const {page}=require('./helpers/detail-page.cjs');
 const pge=page('futures.html');
 await new Promise(resolve=>setImmediate(resolve));
 pge.ctx.fetch=async()=>new Response(JSON.stringify({ok:true,data:apiFixture(rows),source:'fixture'}));
 const fire=(id,event='click')=>{
  const t=pge.events.find(x=>x[0]===id&&x[1]===event);
  assert(t,'missing '+id+' '+event);return t[2]();
 };
 pge.nodes.get('txSession').value='position';
 pge.nodes.get('txYears').value='1';
 await fire('txLoad');
 fire('actAllDates');
 fire('actRun');
 assert.match(pge.nodes.get('actExposure').textContent,/持倉覆蓋率/);
 assert.match(pge.nodes.get('actResult').textContent,/合約結算/);
 pge.nodes.get('actMinTrades').value='1';
 pge.nodes.get('actTrainShare').value='0.7';
 pge.ctx.setTimeout=fn=>fn();
 await fire('actOptimize');
 assert.match(pge.nodes.get('actOptStatus').textContent,/不參與排名的驗證期/);
 assert.equal(pge.nodes.get('actModeResults').children.length,3);
 assert.match(pge.nodes.get('actModeResults').children[0].children[2].textContent,/獨立驗證期/);
 assert(pge.nodes.get('actOptResults').children.length>=1);
});
