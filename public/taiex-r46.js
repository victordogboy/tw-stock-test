(function(root){
'use strict';
const A=root.TWTaiexAction;
if(!A)throw Error('R46 需先載入 taiex-action.js');
const base={sideMode:'both',entryType:'hybrid',exitType:'mixed',adxMin:20,breakoutDays:20,
 trendBars:2,breakBars:3,atrMultiple:3.5,cost:0,delta:10,minEntry:55,exit:45,maxAge:5,
 sarMode:'both',preFlipGap:0.75,preFlipMin:65,entryWeights:[30,30,25,15],holdWeights:[35,25,25,15],
 filters:{adx:true,momentum:true,breakout:true,sar:true,volume:true}};
function validate(input={}){
 const p={...base,...input,filters:{...base.filters,...(input.filters||{})}};
 if(!['long','short','both'].includes(p.sideMode))throw Error('多空模式不正確');
 if(!['early','trend','hybrid'].includes(p.entryType))throw Error('進場架構不正確');
 if(!['trend','atr','mixed'].includes(p.exitType))throw Error('離場架構不正確');
 for(const [k,min,max] of [['adxMin',5,50],['breakoutDays',10,55],['trendBars',1,10],
   ['breakBars',1,10],['atrMultiple',1,10],['cost',0,10000]]){
  p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw Error(k+' 超出範圍');
 }
 for(const k of ['breakoutDays','trendBars','breakBars'])if(!Number.isInteger(p[k]))throw Error(k+' 需為整數');
 for(const key of Object.keys(base.filters))if(typeof p.filters[key]!=='boolean')throw Error('篩選參數 '+key+' 須為布林值');
 A.validate({...p,direction:'long'});
 return p;
}
const ema=(prev,v,period)=>prev===null?v:prev+(v-prev)*2/(period+1);
function features(rows){
 let e12=null,e26=null,signal=null,adx=0,smTR=0,smPlus=0,smMinus=0,dxSum=0;
 const all=[];
 const avg=(i,len)=>rows.slice(i-len+1,i+1).reduce((v,b)=>v+b.close,0)/len;
 for(let i=0;i<rows.length;i++){
  const b=rows[i],prev=rows[i-1],close=b.close;
  e12=ema(e12,close,12);e26=ema(e26,close,26);
  const macd=e12-e26;signal=ema(signal,macd,9);
  const hist=macd-signal;
  let atr=0,dx=0;
  if(prev){
   const tr=Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close));
   const up=b.high-prev.high,down=prev.low-b.low;
   const plus=up>down&&up>0?up:0,minus=down>up&&down>0?down:0;
   // Standard Wilder ADX(14): seed TR/+DM/-DM from 14 completed bars,
   // average the next 14 DX observations, then Wilder smooth continuously.
   if(i<=14){smTR+=tr;smPlus+=plus;smMinus+=minus;}
   else{smTR=smTR-smTR/14+tr;smPlus=smPlus-smPlus/14+plus;smMinus=smMinus-smMinus/14+minus;}
   if(i>=14){
    const pdi=smTR>0?100*smPlus/smTR:0,mdi=smTR>0?100*smMinus/smTR:0;
    dx=pdi+mdi>0?100*Math.abs(pdi-mdi)/(pdi+mdi):0;
    if(i<=27){dxSum+=dx;if(i===27)adx=dxSum/14;}
    else adx=(adx*13+dx)/14;
   }
   atr=smTR/Math.min(14,i);
  }
  const ready=i>=65;
  const m20=ready?avg(i,20):null,m60=ready?avg(i,60):null,old60=ready?rows.slice(i-64,i-4).reduce((v,b)=>v+b.close,0)/60:null;
  const prevBars=i>=55?rows.slice(i-55,i):[];
  const h20=i>=20?Math.max(...rows.slice(i-20,i).map(b=>b.high)):null;
  const l20=i>=20?Math.min(...rows.slice(i-20,i).map(b=>b.low)):null;
  const h55=prevBars.length===55?Math.max(...prevBars.map(b=>b.high)):null;
  const l55=prevBars.length===55?Math.min(...prevBars.map(b=>b.low)):null;
  const volume20=i>=20?rows.slice(i-20,i).reduce((v,b)=>v+b.volume,0)/20:null;
  all.push({date:b.date,close,atr,adx:ready?adx:null,m20,m60,old60,
   histogram:hist,previousHistogram:i?all[i-1].histogram:null,
   roc10:i>=10?(close-rows[i-10].close)/Math.max(1,Math.abs(rows[i-10].close)):0,
   breakout20:{long:h20!==null&&close>h20,short:l20!==null&&close<l20},
   breakout55:{long:h55!==null&&close>h55,short:l55!==null&&close<l55},
   volumeRatio:volume20>0?b.volume/volume20:1,ready});
 }
 return all;
}
function build(rows,input={},sarConfig={},range={}){
 const p=validate(input),prepared=A.prepareMulti(rows,{...p,direction:'long'},sarConfig,range);
 const raw=prepared.signalRows,indicators=features(raw),byDate=new Map(indicators.map(x=>[x.date,x]));
 const long=new Map(A.rescore(prepared.features,{...p,direction:'long'}).filter(Boolean).map(s=>[s.date,s]));
 const short=new Map(A.rescore(A.analyze(raw,{...p,direction:'short'},sarConfig),
    {...p,direction:'short'}).filter(Boolean).map(s=>[s.date,s]));
 return {...prepared,p,long,short,indicatorByDate:byDate};
}
function regime(i,p,filters){
 if(!i?.ready||!i.atr)return 0;
 const strong=!filters.adx||i.adx>=p.adxMin;
 if(!strong)return 0;
 if(i.m20>i.m60&&i.m60>i.old60)return 1;
 if(i.m20<i.m60&&i.m60<i.old60)return -1;
 return 0;
}
function gateMomentum(i,dir,f){return !f.momentum||(dir===1?
 (i.histogram>0||i.histogram>i.previousHistogram)&&i.roc10>0:
 (i.histogram<0||i.histogram<i.previousHistogram)&&i.roc10<0);}
function decideEntry(score,indic,dir,state,p,f,streak){
 if(!score||!indic?.ready||state===-dir)return null;
 const side=dir===1?'long':'short';
 const early=(p.entryType==='early'||p.entryType==='hybrid')&&
  (f.sar?score.enter:score.delta!==null&&score.delta>=p.delta&&score.entry>=p.minEntry);
 const trend=(p.entryType==='trend'||p.entryType==='hybrid')&&state===dir&&streak>=p.trendBars&&gateMomentum(indic,dir,f);
 const breakout=(p.entryType!=='early'&&f.breakout)&&state===dir&&
   (p.breakoutDays===55?indic.breakout55[side]:indic.breakout20[side])&&
   (!f.volume||indic.volumeRatio>=0.85)&&gateMomentum(indic,dir,f);
 if(early)return {type:score.aligned?'SAR起漲':'SAR提前預判',kind:'sar'};
 if(breakout)return {type:'通道突破',kind:'breakout'};
 if(trend)return {type:'趨勢續進',kind:'trend'};
 return null;
}
function simulate(prep,input,first=0,last=prep.timeline.length-1,filtersOverride=null){
 const p=validate(input),f={...p.filters,...(filtersOverride||{})};
 const {timeline,lookup,long,short,indicatorByDate}=prep;
 const bench=A.benchmarkMulti(prep,{cost:p.cost},first,last);
 const legs=[],episodes=[],counts={long:0,short:0,sar:0,trend:0,breakout:0,exitsTrend:0,exitsAtr:0,exitsRegime:0};
 let pos=null,episode=null,pending=null,net=0,peak=0,dd=0,rolls=0,covered=0,regimes={bull:0,bear:0,range:0};
 let streakLong=0,streakShort=0,breakStreak=0,trail=null,flatMotion=0,priorClose=null;
 function open(b,dir,signal){
  pos={contract:b.contract,date:b.date,price:b.open,dir,signalDate:timeline[Math.max(first,signal.index)].date,type:signal.type};
  episode={entryDate:b.date,side:dir===1?'long':'short',signalType:signal.type,net:0,gross:0,legs:0};
  counts[dir===1?'long':'short']++;counts[signal.kind]++;breakStreak=0;trail=null;
 }
 function settle(price,date,reason,carry=false){
  const gross=pos.dir*(price-pos.price),value=gross-p.cost;
  legs.push({contract:pos.contract,side:pos.dir===1?'long':'short',entryDate:pos.date,exitDate:date,signalType:pos.type,entry:pos.price,exit:price,gross,net:value,reason});
  net+=value;episode.gross+=gross;episode.net+=value;episode.legs++;
  if(!carry){episodes.push({...episode,exitDate:date,reason});episode=null;trail=null;}
  pos=null;
 }
 for(let k=first;k<=last;k++){
  const b=timeline[k],ind=indicatorByDate.get(b.date),state=regime(ind,p,f);
  const rolling=k>first&&timeline[k-1].contract!==b.contract;
  if(rolling){
   rolls++;
   if(pos){
    const old=pos,exitRequest=pending?.action==='exit';
    settle(lookup.get(b.date+':'+old.contract).open,b.date,exitRequest?pending.reason:'換月結算',!exitRequest);
    if(!exitRequest)pos={...old,date:b.date,contract:b.contract,price:b.open,type:'續抱轉倉'};
    pending=exitRequest?null:pending;
   }
  }
  if(pending?.action==='exit'&&pos)settle(b.open,b.date,pending.reason);
  else if(pending?.action==='enter'&&!pos)open(b,pending.dir,pending);
  pending=null;
  if(pos)covered++;else if(ind?.ready&&priorClose!==null)flatMotion+=Math.abs(ind.close-priorClose);
  if(ind?.ready)regimes[state===1?'bull':state===-1?'bear':'range']++;
  const eq=net+(pos?pos.dir*(b.close-pos.price)-p.cost:0);
  peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);
  priorClose=ind?.close??null;
  if(k===last){if(pos)settle(b.close,b.date,'區間結束');break;}
  if(!ind?.ready)continue;
  streakLong=state===1?streakLong+1:0;
  streakShort=state===-1?streakShort+1:0;
  if(pos){
   const score=(pos.dir===1?long:short).get(b.date);
   const price=pos.dir*ind.close;
   trail=trail===null?price:Math.max(trail,price);
   const broken=pos.dir*(ind.close-ind.m20)<0;
   breakStreak=broken?breakStreak+1:0;
   const strongOpposite=state===-pos.dir;
   const trendExit=strongOpposite||breakStreak>=p.breakBars||pos.dir*(ind.m20-ind.m60)<0;
   const atrExit=trail-price>=p.atrMultiple*ind.atr;
   const chosen=p.exitType==='trend'?trendExit:p.exitType==='atr'?atrExit:(trendExit||atrExit);
   if(chosen){
    const kind=strongOpposite?'exitsRegime':trendExit?'exitsTrend':'exitsAtr';
    pending={action:'exit',reason:kind==='exitsRegime'?'反向趨勢':kind==='exitsTrend'?'趨勢確認':'ATR移動停損'};
    counts[kind]++;
   }
  }else{
   let opts=[];
   if(p.sideMode!=='short'){const e=decideEntry(long.get(b.date),ind,1,state,p,f,streakLong);if(e)opts.push({...e,dir:1,index:k});}
   if(p.sideMode!=='long'){const e=decideEntry(short.get(b.date),ind,-1,state,p,f,streakShort);if(e)opts.push({...e,dir:-1,index:k});}
   if(opts.length){opts.sort((a,b)=>Number((b.dir===state))-Number((a.dir===state))||((a.dir===1)?-1:1));pending={action:'enter',...opts[0]};}
  }
 }
 const gain=episodes.reduce((v,x)=>v+Math.max(0,x.net),0),loss=episodes.reduce((v,x)=>v+Math.max(0,-x.net),0);
 const win=episodes.filter(x=>x.net>0).length,total=last-first+1;
 return {start:timeline[first].date,end:timeline[last].date,net,benchmarkNet:bench.net,
 excessNet:net-bench.net,benchmarkMaxDrawdown:bench.maxDrawdown,
 ratio:bench.net>0?net/bench.net:null,target2x:bench.net>0?net>=2*bench.net:null,
 targetShortfall:bench.net>0?Math.max(0,2*bench.net-net):null,
 maxDrawdown:dd,winRate:episodes.length?100*win/episodes.length:null,
 signalTradeCount:episodes.length,legCount:legs.length,legs,episodes,
 profitFactor:loss?gain/loss:null,coveredBars:covered,coverage:covered/total*100,
 flatAbsMotion:flatMotion,regimes,counts,rolls,cost:p.cost};
}
function backtest(rows,input={},sarConfig={},range={}){
 const p=validate(input),prep=build(rows,p,sarConfig,range);
 return simulate(prep,p);
}
function candidates(p){
 const out=[],seen=new Set();
 const add=v=>{const key=JSON.stringify(v);if(!seen.has(key)){out.push(v);seen.add(key);}};
 add(p);
 for(const sideMode of ['long','short','both'])
 for(const entryType of ['early','trend','hybrid'])
 for(const exitType of ['trend','atr','mixed'])
 for(const adxMin of [15,25])
 for(const breakoutDays of [20,55])
 for(const atrMultiple of [2.5,4.5])
 add({...p,sideMode,entryType,exitType,adxMin,breakoutDays,atrMultiple});
 return out;
}
function objective(r){
 // A fixed benchmark subtraction alone cannot alter candidate order.
 // Explicitly penalize being BELOW the 2x training benchmark goal, while
 // retaining the drawdown guard. This is deliberately piecewise, not a promise.
 const shortfall=r.targetShortfall??0;
 return r.excessNet-0.7*r.maxDrawdown-0.5*shortfall;
}
function* walkForward(rows,input={},sarConfig={},range={},minTrades=4){
 if(!Number.isInteger(minTrades)||minTrades<1||minTrades>10000)throw Error('最少訓練交易數不正確');
 const p=validate(input),prep=build(rows,p,sarConfig,range),n=prep.timeline.length;
 if(n<240)throw Error('滾動驗證至少需要 240 根已載入的日 K');
 const start=Math.floor(n/2),span=Math.floor((n-start)/3),grid=candidates(p),folds=[],ablationNames=Object.keys(base.filters);
 for(let fold=0;fold<3;fold++){
  const testStart=start+fold*span,testEnd=fold===2?n-1:start+(fold+1)*span-1,trainEnd=testStart-1;
  let best=null,eligible=0,maxTrades=0;
  for(let i=0;i<grid.length;i++){
   const conf=grid[i],train=simulate(prep,conf,0,trainEnd);
   maxTrades=Math.max(maxTrades,train.signalTradeCount);
   if(train.signalTradeCount>=minTrades){
    eligible++;
    if(!best||objective(train)>objective(best.train))best={config:conf,train};
   }
   if((i+1)%30===0||i===grid.length-1)
    yield {done:fold*grid.length+i+1,total:3*grid.length,fold:fold+1,eligible,maxTrades};
  }
  if(!best){folds.push({fold:fold+1,trainEnd:prep.timeline[trainEnd].date,testStart:prep.timeline[testStart].date,testEnd:prep.timeline[testEnd].date,
   eligible,maxTrades,unavailable:true});continue;}
  const validation=simulate(prep,best.config,testStart,testEnd);
  const ablation=Object.fromEntries(ablationNames.map(name=>{
   const v=simulate(prep,best.config,testStart,testEnd,{[name]:false});
   return [name,{net:v.net,deltaNet:v.net-validation.net,excessNet:v.excessNet,trades:v.signalTradeCount}];
  }));
  const legacy=A.simulateMultiR45(prep,{...best.config,direction:'long',entryType:'hybrid',exitType:'mixed'},testStart,testEnd);
  folds.push({fold:fold+1,trainStart:prep.timeline[0].date,trainEnd:prep.timeline[trainEnd].date,
   testStart:prep.timeline[testStart].date,testEnd:prep.timeline[testEnd].date,
   config:best.config,train:best.train,validation,legacy:{net:legacy.net,maxDrawdown:legacy.maxDrawdown},
   ablation,eligible,maxTrades});
 }
 const available=folds.filter(x=>!x.unavailable),sum=(fn)=>available.reduce((v,x)=>v+fn(x),0);
 const net=sum(x=>x.validation.net),benchmarkNet=sum(x=>x.validation.benchmarkNet);
 const summary={net,benchmarkNet,excessNet:net-benchmarkNet,
  ratio:benchmarkNet>0?net/benchmarkNet:null,
  target2x:benchmarkNet>0?net>=2*benchmarkNet:null,
  legacyR45Net:sum(x=>x.legacy.net),tradeCount:sum(x=>x.validation.signalTradeCount),
  foldCount:available.length,requestedFolds:3};
 yield {done:3*grid.length,total:3*grid.length,complete:true,folds,summary,gridSize:grid.length,
  warning:'各折僅使用更早的訓練資料選參數；逐折向前驗證仍屬歷史測試，反覆查看後不再是真正全新資料。'};
}
const api={base,validate,features,build,regime,simulate,backtest,candidates,walkForward};
if(typeof module==='object'&&module.exports)module.exports=api;
root.TWTaiexR46=api;
})(typeof window==='object'?window:globalThis);
