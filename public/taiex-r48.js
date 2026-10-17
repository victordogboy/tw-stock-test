(function(root){
'use strict';
const A=root.TWTaiexAction,S=root.TWParabolicSAR;
if(!A||!S)throw Error('R48 需載入 Action 與 SAR');
const defaultWeights=[20,20,20,20,20];
const defaults={side:'both',weights:defaultWeights,macd:[12,26,9],kd:[9,3,3],sar:[0.05,0.05,0.2],
 ma:[5,20,60],volume:[20,1.2],entry:25,exit:5,atrStop:3.5,cost:0,minTrades:10};
const familyNames=['MACD','KD','SAR','均線','量能'];
const grids={
 macd:[[8,21,5],[12,26,9],[16,32,9]],
 kd:[[9,3,3],[14,3,3],[21,3,3]],
 sar:[[0.02,0.02,0.2],[0.05,0.05,0.2],[0.05,0.02,0.2]],
 ma:[[5,20,60],[10,30,90],[5,15,45]],
 volume:[[5,1],[10,1.2],[20,1.5]]
};
const clip=n=>Math.max(-1,Math.min(1,n));
const key=x=>x.join(',');
function validate(x={}){
 const p={...defaults,...x};
 if(!['long','short','both'].includes(p.side))throw Error('交易方向錯誤');
 for(const k of ['macd','kd','sar','ma','volume'])p[k]=[...p[k]].map(Number);
 if(p.macd.length!==3||p.macd.some(v=>!Number.isInteger(v)||v<2||v>100)||p.macd[0]>=p.macd[1])throw Error('MACD 參數不正確');
 if(p.kd.length!==3||p.kd.some(v=>!Number.isInteger(v)||v<1||v>100))throw Error('KD 參數不正確');
 S.validate({start:p.sar[0],step:p.sar[1],max:p.sar[2]});
 if(p.ma.length!==3||p.ma.some(v=>!Number.isInteger(v)||v<2||v>250)||!(p.ma[0]<p.ma[1]&&p.ma[1]<p.ma[2]))throw Error('均線週期需由短到長');
 if(p.volume.length!==2||!Number.isInteger(p.volume[0])||p.volume[0]<2||p.volume[0]>100||p.volume[1]<0.5||p.volume[1]>5)throw Error('量能設定不正確');
 p.weights=[...p.weights].map(Number);
 if(p.weights.length!==5||p.weights.some(v=>v<0||v>100||!Number.isFinite(v))||Math.abs(p.weights.reduce((n,v)=>n+v,0)-100)>0.001)throw Error('五種權重須合計 100%');
 for(const [k,min,max] of [['entry',1,90],['exit',-40,60],['atrStop',1,10],['cost',0,10000]]){
  p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw Error(k+' 超出範圍');
 }
 if(!Number.isInteger(p.minTrades)||p.minTrades<1||p.minTrades>1000)throw Error('最低交易筆數不正確');
 return p;
}
function context(allRows,range={},cost=0){
 const prepared=A.prepareMulti(allRows,{cost,delta:0,minEntry:0,exit:0}, {},range);
 const rows=prepared.signalRows,timeline=prepared.timeline,indexByDate=new Map(rows.map((b,i)=>[b.date,i])),
 active=timeline.map(b=>indexByDate.get(b.date)),close=rows.map(b=>b.close);
 const tr=rows.map((b,i)=>i===0?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-rows[i-1].close),Math.abs(b.low-rows[i-1].close)));
 let atr=0;const atrs=tr.map((v,i)=>{atr=i<14?(atr*i+v)/(i+1):(atr*13+v)/14;return atr});
 const cumulative=[0];for(const v of close)cumulative.push(cumulative.at(-1)+v);
 const average=(i,n)=>i<n-1?null:(cumulative[i+1]-cumulative[i+1-n])/n;
 return {...prepared,rows,close,atrs,active,average,cache:{macd:new Map(),kd:new Map(),sar:new Map(),ma:new Map(),volume:new Map()}};
}
function compute(ctx,type,settings){
 const cache=ctx.cache[type],identity=key(settings);
 if(cache.has(identity))return cache.get(identity);
 const rows=ctx.rows,n=rows.length,close=ctx.close,out=Array(n).fill(null);
 if(type==='macd'){
  const [fast,slow,signal]=settings,kF=2/(fast+1),kS=2/(slow+1),kSig=2/(signal+1);
  let ef=close[0],es=close[0],sig=0;
  for(let i=0;i<n;i++){ef+=kF*(close[i]-ef);es+=kS*(close[i]-es);const hist=ef-es;sig+=kSig*(hist-sig);
   if(i>=slow+signal)out[i]=clip((hist-sig)/Math.max(1,ctx.atrs[i])*4);}
 }else if(type==='kd'){
  const [look,kSmooth,dSmooth]=settings;let K=50,D=50,priorK=K;
  for(let i=0;i<n;i++){const low=Math.min(...rows.slice(Math.max(0,i-look+1),i+1).map(b=>b.low)),
   high=Math.max(...rows.slice(Math.max(0,i-look+1),i+1).map(b=>b.high)),rsv=high>low?100*(close[i]-low)/(high-low):50;
   priorK=K;K+=(rsv-K)/kSmooth;D+=(K-D)/dSmooth;
   if(i>=look+Math.max(kSmooth,dSmooth))out[i]=clip(((K-D)*0.045)+(K-priorK)*0.02);}
 }else if(type==='sar'){
  const [start,step,max]=settings,sar=S.calculate(rows,{start,step,max});
  for(let i=5;i<n;i++)if(sar[i]){const x=sar[i],dist=(close[i]-x.value)/Math.max(1,ctx.atrs[i]);
   out[i]=clip((x.rising?0.55:-0.55)+dist*0.2);}
 }else if(type==='ma'){
  const [short,mid,long]=settings;
  for(let i=long+4;i<n;i++){const a=ctx.average(i,short),b=ctx.average(i,mid),c=ctx.average(i,long),prev=ctx.average(i-5,mid);
   out[i]=clip(((a-b)+(b-c)*0.65+(b-prev)*1.5)/Math.max(1,ctx.atrs[i]*2));}
 }else if(type==='volume'){
  const [look,threshold]=settings;
  for(let i=look+1;i<n;i++){
   const avg=rows.slice(i-look,i).reduce((sum,b)=>sum+b.volume,0)/look,ratio=avg>0?rows[i].volume/avg:1,
    move=(close[i]-close[i-1])/Math.max(1,ctx.atrs[i]);
   out[i]=clip(move*Math.min(2,ratio/threshold)*0.5);
  }
 }else throw Error('Unknown indicator '+type);
 cache.set(identity,out);return out;
}
function signals(ctx,p){
 const specs=[p.macd,p.kd,p.sar,p.ma,p.volume],series=specs.map((v,i)=>compute(ctx,['macd','kd','sar','ma','volume'][i],v));
 return ctx.active.map(i=>{
  if(series.some(x=>x[i]===null))return null;
  return series.reduce((score,x,j)=>score+p.weights[j]*x[i],0);
 });
}
function test(ctx,input={},first=0,last=ctx.timeline.length-1){
 const p=validate(input),score=signals(ctx,p),{timeline,lookup}=ctx;
 if(first<0||last>=timeline.length||first>last)throw Error('測試區間錯誤');
 let position=null,episode=null,pending=null,net=0,peak=0,maxDrawdown=0,covered=0;
 const trades=[],legs=[],episodes=[];
 function enter(b,dir,signalDate){
  position={dir,date:b.date,contract:b.contract,price:b.open};
  episode={entryDate:b.date,side:dir===1?'long':'short',signalDate,gross:0,net:0,legs:0};
 }
 function settle(price,date,reason,carry=false){
  const gross=position.dir*(price-position.price),value=gross-p.cost;
  legs.push({contract:position.contract,side:position.dir,entryDate:position.date,exitDate:date,gross,net:value,reason});
  net+=value;episode.gross+=gross;episode.net+=value;episode.legs++;
  if(!carry){episodes.push({...episode,exitDate:date,reason});episode=null;}
  position=null;
 }
 let trail=null;
 for(let k=first;k<=last;k++){
  const b=timeline[k],roll=k>first&&timeline[k-1].contract!==b.contract;
  if(roll&&position){
   const old=position,exitRequest=pending?.action==='exit';
   const oldPrice=lookup.get(b.date+':'+old.contract)?.open;
   if(!Number.isFinite(oldPrice))throw Error('Missing rollover '+b.date);
   settle(oldPrice,b.date,exitRequest?'訊號離場':'轉倉',!exitRequest);
   if(!exitRequest)position={...old,date:b.date,contract:b.contract,price:b.open};
   pending=exitRequest?null:pending;
  }
  if(pending?.action==='exit'&&position){settle(b.open,b.date,pending.reason);trail=null;}
  else if(pending?.action==='enter'&&!position){enter(b,pending.dir,pending.date);trail=null;}
  pending=null;
  if(position)covered++;
  const unreal=position?position.dir*(b.close-position.price)-p.cost:0,equity=net+unreal;
  peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
  if(k===last){if(position)settle(b.close,b.date,'區間結束');break;}
  const v=score[k];if(v===null)continue;
  if(position){
   const adjusted=ctx.rows[ctx.active[k]].close*position.dir;
   trail=trail===null?adjusted:Math.max(trail,adjusted);
   const stop=trail-adjusted>=p.atrStop*ctx.atrs[ctx.active[k]];
   if(stop||position.dir*v<-p.exit){pending={action:'exit',reason:stop?'ATR追蹤停損':'加權分數反轉'};}
  }else if(v>=p.entry&&p.side!=='short'){pending={action:'enter',dir:1,date:b.date};}
  else if(v<=-p.entry&&p.side!=='long'){pending={action:'enter',dir:-1,date:b.date};}
 }
 const bench=A.benchmarkMulti(ctx,{cost:p.cost},first,last);
 const wins=episodes.filter(x=>x.net>0).length,tradeCount=episodes.length;
 return {start:timeline[first].date,end:timeline[last].date,net,benchmark:bench.net,excess:net-bench.net,
  winRate:tradeCount?wins/tradeCount*100:null,wins,tradeCount,legs:legs.length,maxDrawdown,
  coverage:covered/(last-first+1)*100,profitFactor:episodes.filter(x=>x.net<0).length?
   episodes.filter(x=>x.net>0).reduce((v,x)=>v+x.net,0)/-episodes.filter(x=>x.net<0).reduce((v,x)=>v+x.net,0):null,
  ratio:bench.net>0?net/bench.net:null,episodes,details:legs};
}
function scoreResult(r,mode,min){
 if(r.tradeCount<min||r.net<=0)return -Infinity;
 // Win-rate search should not accidentally choose a single lucky trade;
 // ranking heavily prefers win rate, lightly rewards actual P&L and penalizes drawdown.
 return mode==='win'?r.winRate+Math.min(15,r.net/Math.max(1,Math.abs(r.benchmark))*3)-r.maxDrawdown/Math.max(3000,r.net)*5:
 r.net-0.6*r.maxDrawdown;
}
function* optimize(ctx,options={}){
 const start=Date.now(),base=validate(options.base||{}),min=Number(options.minTrades??10),
 mode=options.mode==='net'?'net':'win',n=ctx.timeline.length,train=Math.floor(n*0.7);
 if(n<140)throw Error('至少需要 140 根日 K 才能訓練驗證');
 if(!Number.isInteger(min)||min<1||min>1000)throw Error('最低獨立交易數不正確');
 const trainResult=p=>test(ctx,p,0,train-1),seen=new Map();
 let evaluated=0,eligible=0,best=null,bySide={};
 const register=p=>{
  const signature=JSON.stringify(p);
  if(seen.has(signature))return;
  const r=trainResult(p),value=scoreResult(r,mode,min);
  seen.set(signature,{p,r,value});evaluated++;
  if(Number.isFinite(value)){eligible++;if(!best||value>best.value)best={p,r,value};
   if(!bySide[p.side]||value>bySide[p.side].value)bySide[p.side]={p,r,value};}
 };
 const clone=(p,change)=>validate({...p,...change});
 // Deterministic bounded coordinate-search rather than impractical 5D Cartesian product.
 // Start from an equally-weighted neutral baseline; fit entry/exits and weights first.
 const p0=clone(base,{weights:[20,20,20,20,20]});
 for(const side of ['long','short','both'])for(const entry of [12,25,38])for(const exit of [0,10]){
  register(clone(p0,{side,entry,exit}));
 }
 yield {evaluated,eligible,phase:'起始進出場門檻',best};
 const maxSteps=options.steps==='deep'?2:1;
 for(let pass=0;pass<maxSteps;pass++){
  const center=best?.p||p0;
  // Each group exchanges weight with one other family, always keeping sum at 100.
  for(let from=0;from<5;from++)for(let to=0;to<5;to++)if(from!==to)for(const portion of [10,20]){
   if(center.weights[from]<portion)continue;
   const w=[...center.weights];w[from]-=portion;w[to]+=portion;
   if(w[to]<=100)register(clone(center,{weights:w}));
  }
  yield {evaluated,eligible,phase:'搜尋五元素權重',best};
  for(const type of ['macd','kd','sar','ma','volume']){
   for(const params of grids[type])register(clone(best?.p||center,{[type]:params}));
   yield {evaluated,eligible,phase:'調整 '+familyNames[['macd','kd','sar','ma','volume'].indexOf(type)]+' 參數',best};
  }
  for(const side of ['long','short','both'])for(const entry of [12,25,38])for(const exit of [0,10]){
   register(clone(best?.p||center,{side,entry,exit}));
  }
  yield {evaluated,eligible,phase:'重新校正進出場門檻',best};
 }
 const candidates=[...seen.values()].filter(v=>Number.isFinite(v.value)).sort((a,b)=>b.value-a.value);
 // Validation is computed only after all candidate ranking decisions.
 const selected=[],signatures=new Set();
 for(const c of candidates){const label=c.r.episodes.map(t=>t.entryDate+':'+t.exitDate+':'+t.side).join(';');
  if(signatures.has(label))continue;signatures.add(label);selected.push(c);if(selected.length===5)break;}
 const results=selected.map(c=>({config:c.p,training:c.r,validation:test(ctx,c.p,train,n-1)}));
 const modes=Object.fromEntries(['long','short','both'].map(x=>[x,bySide[x]?{config:bySide[x].p,training:bySide[x].r,validation:test(ctx,bySide[x].p,train,n-1)}:null]));
 yield {complete:true,evaluated,eligible,results,modes,trainEnd:ctx.timeline[train-1].date,
  validationStart:ctx.timeline[train].date,validationEnd:ctx.timeline.at(-1).date,elapsedMs:Date.now()-start,
  note:'訓練最佳化只使用前70%的交易結果，後30%獨立驗證，驗證期不可再作參數搜尋依據；不保證跑贏買進持有。'};
}
const api={defaults,validate,context,compute,signals,test,scoreResult,optimize,familyNames,grids};
if(typeof module==='object'&&module.exports)module.exports=api;
root.TWTaiexR48=api;
})(typeof window==='object'?window:globalThis);
