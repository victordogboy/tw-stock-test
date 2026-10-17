const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../public/taiex-r48.js'),A=require('../public/taiex-action.js');
const {multiFixture,apiFixture}=require('./helpers/taiex-multi.cjs');
const rows=multiFixture(),range={start:'2025-10-01',end:'2026-02-28'},ctx=R.context(rows,range,4);
function near(a,b,eps=1e-6){assert(Math.abs(a-b)<eps,a+' != '+b);}
test('R48 five weights sum to 100, five families genuinely respond to independent parameter choices',()=>{
 assert.deepEqual(R.validate().weights,[20,20,20,20,20]);
 assert.throws(()=>R.validate({weights:[20,20,20,20,10]}),/100/);
 assert.throws(()=>R.validate({macd:[26,12,9]}),/MACD/);
 assert.throws(()=>R.validate({ma:[60,20,5]}),/均線/);
 assert.throws(()=>R.validate({volume:[0,1]}),/量能/);
 const names=['macd','kd','sar','ma','volume'];
 for(const type of names){
  const base=R.compute(ctx,type,R.defaults[type]),variation=R.compute(ctx,type,R.grids[type].find(x=>JSON.stringify(x)!==JSON.stringify(R.defaults[type])));
  assert.notDeepEqual(base,variation,type+' parameters must change indicator values');
 }
});
test('R48 entry after close occurs at next open, and contract legs add up to independent trade P&L',()=>{
 const result=R.test(ctx,{side:'both',entry:12,cost:4});
 assert(result.episodes.length>0);
 assert.equal(result.legs,result.details.length);
 near(result.details.reduce((s,x)=>s+x.net,0),result.net);
 near(result.episodes.reduce((s,x)=>s+x.net,0),result.net);
 near(result.details.reduce((s,x)=>s+x.gross-x.net,0),4*result.legs);
 for(const x of result.episodes){
  assert(x.entryDate>x.signalDate,'never enter at already-known signal close');
  assert(['long','short'].includes(x.side));
 }
});
test('R48 preserves correct no-cross-contract-gap P&L even with arbitrary month price levels',()=>{
 const p={side:'both',entry:12,cost:3};
 const one=R.test(ctx,p);
 const modified=rows.map(b=>{
  const shift=Number(b.contract.slice(4))*8000;
  return {...b,open:b.open+shift,high:b.high+shift,low:b.low+shift,close:b.close+shift};
 });
 const two=R.test(R.context(modified,range,3),p);
 near(one.net,two.net);near(one.benchmark,two.benchmark);
 assert.equal(one.tradeCount,two.tradeCount);
});
test('R48 optimizes all five families + weight ratios, does not select by validation performance',()=>{
 let end;
 for(const v of R.optimize(ctx,{base:{cost:4},minTrades:2}))end=v;
 assert(end.complete&&end.evaluated>=60);
 assert(end.results.length>0);
 assert(end.trainEnd<end.validationStart);
 for(const item of end.results){
  assert(item.training.tradeCount>=2);
  near(item.training.net,R.test(ctx,item.config,0,Math.floor(ctx.timeline.length*0.7)-1).net);
  near(item.validation.net,R.test(ctx,item.config,Math.floor(ctx.timeline.length*0.7),ctx.timeline.length-1).net);
  near(item.config.weights.reduce((x,y)=>x+y,0),100);
 }
 assert.deepEqual(Object.keys(end.modes),['long','short','both']);
});
test('future price edits cannot affect selected parameters or training trades',()=>{
 let original;
 for(const x of R.optimize(ctx,{base:{cost:4},minTrades:2}))original=x;
 const later=rows.map(b=>b.date>=original.validationStart?{...b,open:b.open+2000,close:b.close+2000,high:b.high+2000,low:b.low+2000}:b);
 let altered;
 for(const x of R.optimize(R.context(later,range,4),{base:{cost:4},minTrades:2}))altered=x;
 assert.deepEqual(original.results.map(x=>[x.config,x.training.net,x.training.tradeCount]),
  altered.results.map(x=>[x.config,x.training.net,x.training.tradeCount]));
});
test('minimum trade samples prevent naive 100% win-rate on tiny sample from winning',()=>{
 let best;
 for(const x of R.optimize(ctx,{minTrades:500}))best=x;
 assert.equal(best.eligible,0);assert.equal(best.results.length,0);
 assert(best.modes.long===null&&best.modes.short===null);
 assert.throws(()=>[...R.optimize(ctx,{minTrades:0})],/最低/);
});
test('R48 page browser buttons and five-indicator result display',async()=>{
 const {page}=require('./helpers/detail-page.cjs');
 const p=page('futures.html');
 await new Promise(resolve=>setImmediate(resolve));
 p.ctx.fetch=async()=>new Response(JSON.stringify({ok:true,data:apiFixture(rows),source:'fixture',cache_hit:false}));
 const fire=(id,event='click')=>{const t=p.events.find(e=>e[0]===id&&e[1]===event);assert(t,id+' missing');return t[2]();};
 p.nodes.get('txYears').value='1';p.nodes.get('txSession').value='position';
 await fire('txLoad');fire('actAllDates');
 p.nodes.get('r48MinTrades').value='2';p.nodes.get('r48Cost').value='4';
 p.ctx.setTimeout=fn=>fn();
 await fire('r48Go');
 assert.match(p.nodes.get('r48Status').textContent,/完成/);
 assert(p.nodes.get('r48Results').children.length>0);
 assert.equal(p.nodes.get('r48BySide').children.length,3);
 assert.match(p.nodes.get('r48Results').children[0].children[3].textContent,/五指標比例/);
 fire('r48Cancel');
 assert.match(p.nodes.get('r48Status').textContent,/停止/);
});
