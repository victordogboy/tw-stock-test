/* Independent SAR × KD × Action comparison. Uses the production backtest's
   scored bars, Action entry signals, holding exit and execution model. */
(function(root){
'use strict';
const SAR=root.TWParabolicSAR||(typeof require==='function'?require('./parabolic-sar.js'):null);
const BT=root.TWStockBacktest||(typeof require==='function'?require('./stock-backtest-core.js'):null);
const finite=Number.isFinite;
function kdSeries(prices,n=9){
  const out=Array(prices.length).fill(null);
  let k=50,d=50,lastGap=null,prevK=50,prevD=50;
  for(let i=n-1;i<prices.length;i++){
    const window=prices.slice(i-n+1,i+1),hi=Math.max(...window.map(r=>r.high)),lo=Math.min(...window.map(r=>r.low));
    const rsv=hi===lo?50:(prices[i].close-lo)/(hi-lo)*100;
    prevK=k;prevD=d;k=k*2/3+rsv/3;d=d*2/3+k/3;
    const gap=k-d;
    out[i]={k,d,gap,deltaGap:lastGap===null?null:gap-lastGap,golden:k>d&&prevK<=prevD};
    lastGap=gap;
  }
  return out;
}
function indicators(prices,sarParams){
  const bars=[...prices].sort((a,b)=>a.date.localeCompare(b.date));
  const sar=SAR.calculate(bars,sarParams),kd=kdSeries(bars);
  const map=new Map();let age=0,trend=0;
  bars.forEach((bar,i)=>{
    const s=sar[i];
    if(s&&s.rising){age=trend===1?age+1:1;trend=1;}
    else {age=0;trend=s?-1:0;}
    map.set(bar.date,{sar:s,sarDays:age,kd:kd[i],index:i});
  });
  return {bars,map};
}
const buckets=[
  {id:'all',name:'Action 原始策略',match:()=>true},
  {id:'sarEarly',name:'Action ＋ SAR 初翻多天數內',match:(x,o)=>x.sarDays>=1&&x.sarDays<=o.earlyDays},
  {id:'sar1',name:'SAR 翻多第 1 天',match:x=>x.sarDays===1},
  {id:'sar2',name:'SAR 翻多第 2 天',match:x=>x.sarDays===2},
  {id:'sar3',name:'SAR 翻多第 3 天',match:x=>x.sarDays===3},
  {id:'sar5',name:'SAR 翻多第 5 天',match:x=>x.sarDays===5},
  {id:'sar10',name:'SAR 翻多第 10 天',match:x=>x.sarDays===10},
  {id:'sar15',name:'SAR 翻多第 15 天',match:x=>x.sarDays===15},
  {id:'sar47',name:'SAR 多頭第 4～7 天',match:x=>x.sarDays>=4&&x.sarDays<=7},
  {id:'sar815',name:'SAR 多頭第 8～15 天',match:x=>x.sarDays>=8&&x.sarDays<=15},
  {id:'sar16',name:'SAR 多頭第 16 天以上',match:x=>x.sarDays>=16},
  {id:'kd',name:'Action ＋ KD 多頭動能',match:(x,o)=>kdPass(x.kd,o.kdMode)},
  {id:'sarKd',name:'SAR 初翻多 ＋ KD 動能',match:(x,o)=>x.sarDays>=1&&x.sarDays<=o.earlyDays&&kdPass(x.kd,o.kdMode)}
];
function kdPass(kd,mode){
  if(!kd||!finite(kd.deltaGap))return false;
  return mode==='above'?kd.k>kd.d:mode==='widen'?kd.deltaGap>0:kd.k>kd.d&&kd.deltaGap>0;
}
function validateOptions(options={}){
  const o={earlyDays:3,kdMode:'both',...options};
  if(!Number.isInteger(o.earlyDays)||o.earlyDays<1||o.earlyDays>20)throw Error('SAR 初期天數必須為 1～20');
  if(!['above','widen','both'].includes(o.kdMode))throw Error('未知 KD 條件');
  return o;
}
function pct(values){
  if(!values.length)return {count:0,winRate:null,avgReturn:null,medianReturn:null,avgMaxRise:null,avgMaxFall:null};
  const sorted=values.map(x=>x.ret).sort((a,b)=>a-b),n=sorted.length;
  const median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
  return {count:n,winRate:100*values.filter(x=>x.ret>0).length/n,
    avgReturn:values.reduce((a,x)=>a+x.ret,0)/n,medianReturn:median,
    avgMaxRise:values.reduce((a,x)=>a+x.maxRise,0)/n,
    avgMaxFall:values.reduce((a,x)=>a+x.maxFall,0)/n};
}
function study(prepared,rawPrices,params,sarParams={},opts={}){
  const o=validateOptions(opts);BT.validate(params);
  const {bars,map}=indicators(rawPrices,SAR.validate(sarParams));
  const rows=Array.isArray(prepared)?prepared:prepared.rows;
  if(!Array.isArray(rows)||rows.length<2)throw Error('回測樣本不足');
  const entry=BT.entrySignals(rows,params.buy,params.entryMode);
  const holding=BT.scores(rows,params.stay);
  const x=rows.map(r=>map.get(r.date)||null);
  const fee=params.costBps/20000;
  const selected=entry.map((s,i)=>finite(s)&&s>=params.enter&&finite(holding[i])&&holding[i]>params.exit+params.entryBuffer);
  const summaries=buckets.map(group=>{
    const qualify=i=>selected[i]&&x[i]&&group.match(x[i],o);
    // Comparisons use the SAME production exit rules; only buy eligibility changes.
    const buy=entry.map((signal,i)=>qualify(i)?signal:null);
    const portfolio=BT.simulate(rows,params,{buy,stay:holding});
    const forward={};
    for(const h of [3,5,10]){
      const samples=[];let nextIndex=0;
      for(let i=0;i<rows.length;i++){
        if(i<nextIndex||!qualify(i))continue;
        const futureIndex=x[i].index+h,openBar=bars[x[i].index+1],closeBar=bars[futureIndex];
        if(!openBar||!closeBar||!(openBar.volume>0&&openBar.high>openBar.low&&openBar.open>0&&closeBar.close>0))continue;
        const buyPrice=openBar.open*(1+fee),exitPrice=closeBar.close*(1-fee);
        const range=bars.slice(x[i].index+1,futureIndex+1);
        samples.push({ret:(exitPrice/buyPrice-1)*100,
          maxRise:(Math.max(...range.map(r=>r.high))/buyPrice-1)*100,
          maxFall:(Math.min(...range.map(r=>r.low))/buyPrice-1)*100});
        // Event study: only the earliest signal in each non-overlapping h-day window
        // per category counts. This is not a claim of independent stock observations.
        nextIndex=i+h+1;
      }
      forward[h]=pct(samples);
    }
    return {id:group.id,name:group.name,qualifyingSignals:selected.filter((_,i)=>qualify(i)).length,
      portfolio:{roi:portfolio.roi,winRate:portfolio.signalWinRate,maxDrawdown:portfolio.maxDrawdown,
        trades:portfolio.completedTrades,forced:portfolio.forced,avgReturn:portfolio.avgReturn},
      forward};
  });
  return {start:rows[0].date,end:rows.at(-1).date,settings:o,sarParams:SAR.validate(sarParams),
    entryMode:params.entryMode,enter:params.enter,exit:params.exit,rows:rows.length,
    summaries,notes:'Action 以當日收盤訊號判斷，隔日開盤買入；續抱分數離場仍依原回測。3/5/10 日事件報酬以訊號後下一交易日開盤買進、第 3/5/10 個交易日收盤賣出；同分類同持有天數的重疊事件不重複計。'};
}
const api={kdSeries,indicators,kdPass,validateOptions,study,buckets};
root.TWSarKdStudy=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
