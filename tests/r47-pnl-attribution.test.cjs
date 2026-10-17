const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/taiex-action.js'),R=require('../public/taiex-r46.js'),D=require('../public/taiex-r47.js');
const {multiFixture,apiFixture}=require('./helpers/taiex-multi.cjs');
function close(a,b,epsilon=1e-6){assert(Math.abs(a-b)<epsilon,a+' differs from '+b);}

test('R47 exact daily bridge: missed flat returns + opposite short returns + excess settlement costs',()=>{
 const rows=multiFixture(),cfg={sideMode:'both',cost:4},range={start:'2025-10-01',end:'2026-02-28'},
  prepared=R.build(rows,cfg,{},range),trade=R.simulate(prepared,cfg),r=D.analyze(prepared,trade);
 assert.equal(r.reconciliation.valid,true);
 close(r.benchmarkLag,r.lost.flatNet+r.lost.shortNet+r.costs.excess);
 close(r.benchmarkLag,r.benchmarkNet-r.strategyNet);
 close(r.long.net+r.short.net,r.strategyNet);
 close(r.daily.reduce((v,x)=>v+x.gap,0),r.benchmarkLag);
 close(r.monthly.reduce((v,x)=>v+x.lag,0),r.benchmarkLag);
 close(r.daily.reduce((v,x)=>v+x.strategyNet,0),r.strategyNet);
 close(r.daily.reduce((v,x)=>v+x.benchmarkNet,0),r.benchmarkNet);
 assert(r.daily.some(x=>x.side==='short'));
 assert(r.daily.some(x=>x.side==='flat'));
 assert(r.worstMonths.length>=1);
 assert(r.costs.strategyLegs===trade.legCount);
});

test('R47 no-trade mode records whole buy-and-hold change as flat exposure',()=>{
 const rows=multiFixture(),cfg={sideMode:'both',entryType:'early',cost:5,delta:100,minEntry:100},
  range={start:'2025-10-01',end:'2026-02-28'},prepared=R.build(rows,cfg,{},range);
 const noTrade={start:prepared.start,end:prepared.end,legs:[],episodes:[],net:0,cost:5};
 const r=D.analyze(prepared,noTrade);
 assert.equal(r.short.net,0);assert.equal(r.long.net,0);
 assert.equal(r.strategyNet,0);assert.equal(r.costs.strategy,0);
 close(r.lost.flatNet,r.benchmarkGross);
 close(r.benchmarkLag,r.benchmarkNet);
});

test('R47 does not misread month contract price spreads as daily profits',()=>{
 const rows=multiFixture(),cfg={sideMode:'both',cost:3},range={start:'2025-10-01',end:'2026-02-28'};
 const a=R.build(rows,cfg,{},range),ar=D.analyze(a,R.simulate(a,cfg));
 const shifted=rows.map(b=>{
  const gap=Number(b.contract.slice(4))*10000;
  return {...b,open:b.open+gap,high:b.high+gap,low:b.low+gap,close:b.close+gap};
 });
 const b=R.build(shifted,cfg,{},range),br=D.analyze(b,R.simulate(b,cfg));
 close(ar.benchmarkLag,br.benchmarkLag);
 close(ar.lost.shortNet,br.lost.shortNet);
 close(ar.lost.flatNet,br.lost.flatNet);
 close(ar.costs.excess,br.costs.excess);
});

test('R47 reconciles independent three-fold R46 walk-forward without picking parameters using test outcomes',()=>{
 const rows=[];let previous=null;
 for(let i=0;i<380;i++){
  const date=new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),contract=A.nextMonth(date),
    price=20000+(i<130?i*8:i<240?130*8-(i-130)*12:130*8-110*12+(i-240)*9)+Math.sin(i/6)*45;
  const b={date,contract,open:price-4,close:price,high:price+28,low:price-28,volume:10000+i,openInterest:3000};
  rows.push(b);
  if(previous&&previous!==contract)rows.push({...b,contract:previous,open:b.open+18,close:b.close+18,high:b.high+18,low:b.low+18});
  previous=contract;
 }
 const cfg={sideMode:'both',cost:3},range={start:'2025-02-01',end:'2026-01-15'};
 let output;for(const progress of R.walkForward(rows,cfg,{},range,1))if(progress.complete)output=progress;
 const prep=R.build(rows,cfg,{},range),r=D.folds(prep,output);
 assert.equal(r.reports.length,3);
 assert.equal(r.summary.foldCount,3);
 close(r.summary.benchmarkLag,r.summary.flatNet+r.summary.shortNet+r.summary.costExcess);
 for(const x of r.reports) {
  close(x.benchmarkLag,x.lost.flatNet+x.lost.shortNet+x.costs.excess);
  close(x.daily.reduce((n,v)=>n+v.gap,0),x.benchmarkLag);
 }
 assert.equal(r.summary.strategyNet,output.summary.net);
 assert.equal(r.summary.benchmarkNet,output.summary.benchmarkNet);
});

test('R47 rejects modified P&L or incompatible fold metadata, rather than showing fake numbers',()=>{
 const rows=multiFixture(),cfg={sideMode:'both',cost:4},range={start:'2025-10-01',end:'2026-02-28'};
 const prep=R.build(rows,cfg,{},range),v=R.simulate(prep,cfg);
 assert.throws(()=>D.analyze(prep,{...v,net:v.net+33}),/對帳失敗/);
 assert.throws(()=>D.analyze(prep,{...v,start:'2020-01-01'}),/不一致/);
 assert.throws(()=>D.folds(prep,{complete:false,folds:[]}),/需先完成/);
});

test('R47 browser panel receives R46 run/fold results, renders exact reconciliation and month-level loss',async()=>{
 const {page}=require('./helpers/detail-page.cjs');
 const p=page('futures.html'),fixture=multiFixture(),data=apiFixture(fixture);
 await new Promise(resolve=>setImmediate(resolve));
 p.ctx.fetch=async()=>new Response(JSON.stringify({ok:true,data,source:'fixture',cache_hit:false}));
 const fire=(id,event='click')=>{
  const obj=p.events.find(x=>x[0]===id&&x[1]===event);assert(obj,'missing event '+id);return obj[2]();
 };
 p.nodes.get('txYears').value='1';p.nodes.get('txSession').value='position';
 await fire('txLoad');fire('actAllDates');fire('r46Run');
 assert.match(p.nodes.get('r47Status').textContent,/對帳誤差/);
 assert.match(p.nodes.get('r47Summary').textContent,/空手/);
 assert.equal(p.nodes.get('r47Parts').children.length,3);
 assert(p.nodes.get('r47Months').children.length>0);
 p.nodes.get('r46Minimum').value='1';p.ctx.setTimeout=fn=>fn();
 await fire('r46Walk');
 assert.match(p.nodes.get('r47Status').textContent,/三折樣本外損益對帳/);
 assert.equal(p.nodes.get('r47FoldCards').children.length,3);
});
