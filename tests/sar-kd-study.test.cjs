const test=require('node:test'),assert=require('node:assert/strict');
const SAR=require('../public/parabolic-sar.js');
const BT=require('../public/stock-backtest-core.js');
const S=require('../public/sar-kd-study.js');
function prices(count=115){
  return Array.from({length:count},(_,i)=>{
    const close=30+i*.12+Math.sin(i/3)*2;
    return {date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
      open:close-.2,close,high:close+.8,low:close-.8,volume:100000};
  });
}
const params=()=>({...BT.defaults,
  entryMode:'absolute',enter:50,exit:20,entryBuffer:0,
  buy:{setup:100,opportunity:0,entry:0,hold:0},
  stay:{setup:0,opportunity:0,entry:0,hold:100},costBps:0});
function ready(prices,signalIndices){
 return prices.slice(65).map((p,j)=>({...p,scores:{setup:signalIndices.includes(j+65)?100:0,opportunity:0,entry:0,hold:80}}));
}
test('KD is the same 9,3,3 smooth formula and exposes day-to-day spread delta',()=>{
 const p=prices(),values=S.kdSeries(p);
 assert.equal(values[7],null);
 let k=50,d=50;
 for(let i=8;i<=9;i++){
   const w=p.slice(i-8,i+1),high=Math.max(...w.map(b=>b.high)),low=Math.min(...w.map(b=>b.low));
   k=k*2/3+((p[i].close-low)/(high-low)*100)/3;
   d=d*2/3+k/3;
 }
 assert.ok(Math.abs(values[9].k-k)<1e-10);
 assert.ok(Math.abs(values[9].d-d)<1e-10);
 assert.ok(Math.abs(values[9].deltaGap-(values[9].gap-values[8].gap))<1e-10);
 assert.equal(S.kdPass(values[9],'above'),values[9].k>values[9].d);
});
test('historical SAR day counts and KD values do not change when later prices arrive',()=>{
 const p=prices(),full=S.indicators(p,{start:.05,step:.05,max:.2});
 const partial=S.indicators(p.slice(0,85),{start:.05,step:.05,max:.2});
 for(let i=0;i<85;i++)assert.deepEqual(partial.map.get(p[i].date),full.map.get(p[i].date));
 const own=S.indicators(p,{start:.05,step:.05,max:.2});
 for(let i=1;i<p.length;i++){
   const current=own.map.get(p[i].date),prev=own.map.get(p[i-1].date);
   if(current.sar&&current.sar.rising)assert.equal(current.sarDays,(prev.sarDays||0)+1);
   else assert.equal(current.sarDays,0);
 }
});
test('forward returns use next open and h-th close; overlapping repeated signals count once',()=>{
 const p=prices(),prepared=ready(p,[75,76,77]);
 const res=S.study(prepared,p,params(),{start:.05,step:.05,max:.2});
 const base=res.summaries.find(x=>x.id==='all');
 assert.equal(base.qualifyingSignals,3);
 assert.equal(base.forward[3].count,1);
 assert.equal(base.forward[5].count,1);
 assert.equal(base.forward[10].count,1);
 for(const h of [3,5,10]){
   const expected=(p[75+h].close/p[76].open-1)*100;
   assert.ok(Math.abs(base.forward[h].avgReturn-expected)<1e-10);
 }
 assert.equal(res.summaries.find(x=>x.id==='sar1').qualifyingSignals<=3,true);
});
test('the original backtest is used for portfolio drawdown, ROIs and entry filtering',()=>{
 const p=prices(),rows=ready(p,[75,76,85]);
 const options=params(),result=S.study(rows,p,options,{start:.05,step:.05,max:.2});
 const base=result.summaries.find(x=>x.id==='all');
 const original=BT.simulate(rows,options);
 assert.equal(base.portfolio.roi,original.roi);
 assert.equal(base.portfolio.maxDrawdown,original.maxDrawdown);
 assert.equal(base.portfolio.trades,original.completedTrades);
 for(const x of result.summaries)assert.ok(x.qualifyingSignals<=base.qualifyingSignals);
});
test('parameter validation rejects bad configurations and uses SAR factor settings',()=>{
 assert.throws(()=>S.validateOptions({earlyDays:0}),/天數/);
 assert.throws(()=>S.validateOptions({kdMode:'invalid'}),/KD/);
 const p=prices(),rows=ready(p,[75,85]);
 const a=S.study(rows,p,params(),{start:.05,step:.05,max:.2});
 const b=S.study(rows,p,params(),{start:.02,step:.02,max:.2});
 assert.equal(a.sarParams.start,.05);
 assert.equal(b.sarParams.start,.02);
 assert.deepEqual(a.summaries.map(x=>x.id),['all','sarEarly','sar1','sar2','sar3','sar5','sar10','sar15','sar47','sar815','sar16','kd','sarKd']);
});
