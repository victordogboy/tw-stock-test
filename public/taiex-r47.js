(function(root){
'use strict';
const A=root.TWTaiexAction,R=root.TWTaiexR46;
if(!A||!R)throw Error('R47 需要先載入 R46 與 Action 引擎');
const round=(n)=>Number.isFinite(n)?n:null;
const sum=(list,key)=>list.reduce((total,x)=>total+(typeof key==='function'?key(x):x[key]),0);
const group=(list,extract)=>{
 const data={};
 for(const x of list){const k=extract(x);(data[k]??=[]).push(x);}
 return data;
};
// R47 reconstructs each observed holding over two actually executable daily
// pieces: previous contract close -> that same contract's next open; and the
// selected new contract open -> close. Crucially the roll gap is NEVER P&L.
function exposure(legs,date,contract){
 const leg=legs.find(t=>t.contract===contract&&t.entryDate<=date&&
   (t.exitDate>date||(t.exitDate===date&&t.reason==='區間結束')));
 return leg?(leg.side==='long'?1:-1):0;
}
function analyze(prep,result,range={}){
 if(!result||!Array.isArray(result.legs)||!Array.isArray(result.episodes))throw Error('R47 缺少 R46 實際交易明細');
 const timeline=prep.timeline,first=range.first??timeline.findIndex(t=>t.date===result.start),
   last=range.last??timeline.findIndex(t=>t.date===result.end),cost=result.cost;
 if(first<0||last<first||last>=timeline.length)throw Error('R47 區間與 R46 結果不一致');
 const bench=A.benchmarkMulti(prep,{cost},first,last),daily=[];
 let longGross=0,shortGross=0,flatDelta=0,shortDelta=0,flatPositive=0,flatNegative=0,shortOnRise=0,shortOnFall=0;
 let previousExposure=0,benchmarkTotalGross=0,strategyTotalGross=0;
 const closed=group(result.legs,x=>x.exitDate),benchClosed=group(bench.trades,x=>x.exitDate);
 function piece(move,side,diff){
  if(side===1)longGross+=move;
  else if(side===-1){shortGross-=move;shortDelta+=2*move;if(move>0)shortOnRise+=2*move;else shortOnFall+=2*move;}
  else{flatDelta+=move;if(move>0)flatPositive+=move;else flatNegative+=move;}
  diff.side=side;diff.market=move;diff.strategy=side*move;diff.shortGap=side===-1?2*move:0;diff.flatGap=side===0?move:0;
  return diff;
 }
 for(let k=first;k<=last;k++){
  const b=timeline[k],prev=timeline[k-1],side=exposure(result.legs,b.date,b.contract);
  const priorOpen=k>first?(prep.lookup.get(b.date+':'+prev.contract)?.open):null;
  if(k>first&&!Number.isFinite(priorOpen))throw Error('R47 缺少換月舊合約開盤 '+b.date+'/'+prev.contract);
  const gapMove=k===first?0:priorOpen-prev.close,dayMove=b.close-b.open;
  const overnight=piece(gapMove,k===first?0:previousExposure,{});
  // Day one has no preceding held interval; do not call piece() for that.
  if(k===first){overnight.side=0;overnight.market=0;overnight.strategy=0;overnight.flatGap=0;overnight.shortGap=0;}
  const intraday=piece(dayMove,side,{});
  const strategyGross=overnight.strategy+intraday.strategy,
   benchmarkGross=gapMove+dayMove,ledgerCost=(closed[b.date]?.length||0)*cost,
   baselineCost=(benchClosed[b.date]?.length||0)*cost;
  benchmarkTotalGross+=benchmarkGross;strategyTotalGross+=strategyGross;
  daily.push({date:b.date,contract:b.contract,side:side===1?'long':side===-1?'short':'flat',
   overnight,intraday,benchmarkGross,strategyGross,strategyCost:ledgerCost,baselineCost,
   benchmarkNet:benchmarkGross-baselineCost,strategyNet:strategyGross-ledgerCost,
   gap:benchmarkGross-strategyGross+ledgerCost-baselineCost,
   shortGap:overnight.shortGap+intraday.shortGap,flatGap:overnight.flatGap+intraday.flatGap});
  previousExposure=side;
 }
 const turnover=result.legs.length,baselineLegs=bench.trades.length,
   grossStrategy=sum(result.legs,'gross'),grossBenchmark=sum(bench.trades,'gross');
 const strategyCosts=turnover*cost,baselineCosts=baselineLegs*cost,
   extraCost=strategyCosts-baselineCosts,unexplained=(bench.net-result.net)-(flatDelta+shortDelta+extraCost);
 // Accounting must reconcile before a diagnostic can be shown to users.
 const tolerance=1e-6;
 if(Math.abs(grossStrategy-strategyTotalGross)>tolerance||
    Math.abs(grossBenchmark-benchmarkTotalGross)>tolerance||
    Math.abs(unexplained)>tolerance)throw Error('R47 歸因對帳失敗：不可將不一致的回測顯示為真實損益（差額 '+unexplained.toFixed(4)+' 點）');
 const legsBySide=group(result.legs,x=>x.side),episodesBySide=group(result.episodes,x=>x.side);
 const sideStats=side=>({gross:sum(legsBySide[side]||[],'gross'),net:sum(legsBySide[side]||[],'net'),
   costs:(legsBySide[side]||[]).length*cost,contractLegs:(legsBySide[side]||[]).length,
   independentTrades:(episodesBySide[side]||[]).length,
   wins:(episodesBySide[side]||[]).filter(x=>x.net>0).length});
 const rollDates=new Set(timeline.slice(first+1,last+1).filter((b,j)=>timeline[first+j].contract!==b.contract).map(x=>x.date));
 const rollLegs=result.legs.filter(l=>rollDates.has(l.exitDate)),rollBase=bench.trades.filter(t=>rollDates.has(t.exitDate));
 const monthly=Object.entries(group(daily,x=>x.date.slice(0,7))).map(([month,arr])=>({
  month,benchmarkNet:sum(arr,'benchmarkNet'),strategyNet:sum(arr,'strategyNet'),
  lag:sum(arr,'gap'),flatGap:sum(arr,'flatGap'),shortGap:sum(arr,'shortGap'),
  strategyCosts:sum(arr,'strategyCost'),benchmarkCosts:sum(arr,'baselineCost'),
  shortBars:arr.filter(v=>v.side==='short').length,flatBars:arr.filter(v=>v.side==='flat').length
 }));
 const exits=Object.entries(group(result.episodes,x=>x.reason)).map(([reason,arr])=>({
  reason,count:arr.length,net:sum(arr,'net'),wins:arr.filter(x=>x.net>0).length
 })).sort((x,y)=>y.count-x.count);
 return {start:result.start,end:result.end,benchmarkNet:bench.net,strategyNet:result.net,
  benchmarkGross:grossBenchmark,strategyGross:grossStrategy,benchmarkLag:bench.net-result.net,
  long:sideStats('long'),short:sideStats('short'),
  lost:{flatNet:flatDelta,flatPositive,flatNegative,shortNet:shortDelta,shortRisePenalty:shortOnRise,shortFallBenefit:shortOnFall},
  costs:{perLeg:cost,strategy:strategyCosts,benchmark:baselineCosts,excess:extraCost,
   rollSettlementStrategy:rollLegs.length*cost,rollSettlementBenchmark:rollBase.length*cost,
   strategyLegs:turnover,benchmarkLegs:baselineLegs},
  reconciliation:{unexplained,valid:true},
  daily,monthly,worstMonths:[...monthly].sort((a,b)=>b.lag-a.lag).slice(0,8),exits,
  note:'歸因以實際合約前收→次開及當日開→收兩段逐日對帳；空手差與逆勢空單差可正可負。換月價差不當作報酬；只代表歷史模擬。'
 };
}
function folds(prep,walk){
 if(!walk?.complete||!walk.folds)throw Error('R47 需先完成 R46 三段滾動驗證');
 const reports=walk.folds.map(f=>f.unavailable?{fold:f.fold,unavailable:true}:
 {fold:f.fold,...analyze(prep,f.validation)});
 const used=reports.filter(x=>!x.unavailable),total=x=>used.reduce((v,a)=>v+x(a),0);
 const summary={benchmarkLag:total(x=>x.benchmarkLag),flatNet:total(x=>x.lost.flatNet),
  shortNet:total(x=>x.lost.shortNet),costExcess:total(x=>x.costs.excess),
  strategyNet:total(x=>x.strategyNet),benchmarkNet:total(x=>x.benchmarkNet),foldCount:used.length};
 if(Math.abs(summary.benchmarkLag-(summary.flatNet+summary.shortNet+summary.costExcess))>1e-6)
  throw Error('R47 三折彙總對帳失敗');
 return {reports,summary};
}
const api={analyze,folds,exposure};
if(typeof module==='object'&&module.exports)module.exports=api;
root.TWTaiexR47=api;
})(typeof window==='object'?window:globalThis);
