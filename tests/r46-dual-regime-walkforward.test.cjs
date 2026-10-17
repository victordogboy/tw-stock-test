const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/taiex-action.js');
const R=require('../public/taiex-r46.js');

function artificial(days=420){
 const rows=[];let previous=null;
 for(let i=0;i<days;i++){
  const date=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),contract=A.nextMonth(date);
  const value=i<140?i*8:i<270?140*8-(i-140)*16:140*8-130*16+(i-270)*12;
  const c=21000+value+Math.sin(i/11)*55;
  const b={date,contract,open:c-4,high:c+30,low:c-30,close:c,volume:10000+i*3,openInterest:3000};
  rows.push(b);
  if(previous&&previous!==contract)rows.push({...b,contract:previous,open:b.open+19,close:b.close+19,high:b.high+19,low:b.low+19});
  previous=contract;
 }
 return rows;
}
const rows=artificial(),range={start:'2025-02-01',end:'2026-02-16'};

test('R46 regime is causal, distinguishes bullish/bearish/ranging with optional ADX filter',()=>{
 const high={ready:true,atr:20,adx:32,m20:105,m60:100,old60:99};
 assert.equal(R.regime(high,R.validate(),R.base.filters),1);
 assert.equal(R.regime({...high,m20:80,m60:90,old60:92},R.validate(),R.base.filters),-1);
 assert.equal(R.regime({...high,adx:9},R.validate(),R.base.filters),0);
 assert.equal(R.regime({...high,adx:9},R.validate(),{...R.base.filters,adx:false}),1);
 assert.equal(R.regime({...high,m20:101,m60:102,old60:101},R.validate(),R.base.filters),0);
 const prep=R.build(rows,{sideMode:'both'}, {},range),short=artificial(250);
 const q=R.build(short,{sideMode:'both'},{},{start:'2025-02-01',end:'2025-09-06'});
 const overlap=prep.indicatorByDate.get('2025-08-01'),smaller=q.indicatorByDate.get('2025-08-01');
 assert.deepEqual(overlap,smaller,'later market days must not alter earlier ADX/MACD/Donchian');
});

test('R46 can go long AND short, does not hold simultaneous legs and applies costs per real contract',()=>{
 const r=R.backtest(rows,{sideMode:'both',cost:4},{},range);
 assert(r.counts.long>0&&r.counts.short>0);
 assert.equal(r.net,r.legs.reduce((v,t)=>v+t.net,0));
 assert.equal(r.signalTradeCount,r.episodes.length);
 assert.equal(r.legs.reduce((v,t)=>v+t.gross-t.net,0),r.legCount*4);
 assert(r.coverage>=0&&r.coverage<=100);
 assert(r.flatAbsMotion>=0);
 assert(r.maxDrawdown>=0);
 assert.equal(r.counts.long+r.counts.short,r.signalTradeCount);
 assert(r.ratio===null||r.ratio===r.net/r.benchmarkNet);
 assert(r.regimes.bull>0&&r.regimes.bear>0);
});

test('R46 cannot invent P&L from next-month roll price gaps',()=>{
 const p={sideMode:'both',cost:4},original=R.backtest(rows,p,{},range);
 const changed=rows.map(b=>{
  const shift=Number(b.contract.slice(4))*10000;
  return {...b,open:b.open+shift,high:b.high+shift,low:b.low+shift,close:b.close+shift};
 });
 const rerun=R.backtest(changed,p,{},range);
 assert(Math.abs(rerun.net-original.net)<1e-6,'no cross-contract price-gap P&L');
 assert(Math.abs(rerun.benchmarkNet-original.benchmarkNet)<1e-6);
 assert(Math.abs(rerun.maxDrawdown-original.maxDrawdown)<1e-6);
 assert.equal(rerun.signalTradeCount,original.signalTradeCount);
});

test('R46 expanding walk-forward selects only from prior bars, reports per-fold ablation',()=>{
 let final;
 for(const x of R.walkForward(rows,{sideMode:'both',cost:4},{},range,1))if(x.complete)final=x;
 assert.equal(final.folds.length,3);
 assert(final.summary.foldCount>0);
 assert(final.gridSize>=100);
 const chosen=final.folds.filter(f=>!f.unavailable);
 for(const f of chosen){
  assert(f.trainEnd<f.testStart);
  assert(f.testStart<=f.testEnd);
  assert.deepEqual(Object.keys(f.ablation),['adx','momentum','breakout','sar','volume']);
  for(const v of Object.values(f.ablation))assert.equal(v.deltaNet,v.net-f.validation.net);
 }
 assert.equal(final.summary.net,chosen.reduce((n,x)=>n+x.validation.net,0));
 assert.equal(final.summary.benchmarkNet,chosen.reduce((n,x)=>n+x.validation.benchmarkNet,0));
 const edited=rows.map(b=>b.date>=final.folds[0].testStart?{...b,open:b.open+900,high:b.high+900,low:b.low+900,close:b.close+900}:b);
 let future;
 for(const x of R.walkForward(edited,{sideMode:'both',cost:4},{},range,1))if(x.complete)future=x;
 assert.deepEqual(future.folds[0].config,final.folds[0].config,'future test prices must not change first fold training selection');
 assert.equal(future.folds[0].train.net,final.folds[0].train.net);
 assert.throws(()=>[...R.walkForward(rows,{sideMode:'both'},{},range,0)],/最少訓練交易數/);
});

test('R46 with missing sample minimum makes no best strategy instead of claiming a win',()=>{
 let result;for(const t of R.walkForward(rows,{}, {},range,500))if(t.complete)result=t;
 assert.equal(result.summary.foldCount,0);
 assert(result.folds.every(x=>x.unavailable));
 assert.equal(result.summary.tradeCount,0);
 assert.equal(result.summary.target2x,null);
 assert.throws(()=>R.validate({sideMode:'four'}),/多空模式/);
 assert.throws(()=>R.validate({adxMin:100}),/範圍/);
});

test('R46 UI R46 buttons handle years, real candle data, ablation and stop',async()=>{
 const {page}=require('./helpers/detail-page.cjs');
 const p=page('futures.html');
 await new Promise(resolve=>setImmediate(resolve));
 const data=rows.map(b=>({date:b.date,contract_date:b.contract,futures_id:'TX',trading_session:'position',open:b.open,
  close:b.close,max:b.high,min:b.low,volume:b.volume,open_interest:b.openInterest}));
 p.ctx.fetch=async()=>new Response(JSON.stringify({ok:true,data,source:'fixture',cache_hit:false}));
 const fire=(id,event='click')=>{
  const entry=p.events.find(v=>v[0]===id&&v[1]===event);assert(entry,id+' / '+event);return entry[2]();
 };
 p.nodes.get('txYears').value='3';p.nodes.get('txSession').value='position';await fire('txLoad');
 fire('actAllDates');fire('r46Run');
 assert.match(p.nodes.get('r46Current').textContent,/實際多單/);
 assert.match(p.nodes.get('r46Status').textContent,/單組雙向回測完成/);
 p.nodes.get('r46Minimum').value='1';p.ctx.setTimeout=fn=>fn();
 await fire('r46Walk');
 assert.match(p.nodes.get('r46Status').textContent,/三段滾動驗證完成/);
 assert.equal(p.nodes.get('r46Folds').children.length,3);
 assert.equal(p.nodes.get('r46Ablation').children.length,5);
 fire('r46Stop');
 assert.match(p.nodes.get('r46Status').textContent,/停止/);
});
