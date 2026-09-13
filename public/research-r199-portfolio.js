/* Chronological cash-account simulation. No selection using future returns. */
(function(root){
'use strict';
function config(p={}){
 const initial=p.initial??1000000,maxPositions=p.maxPositions??5,lotSize=p.lotSize??1000;
 if(!Number.isFinite(initial)||initial<=0||initial>1e12||!Number.isInteger(maxPositions)||maxPositions<1||maxPositions>100||![1,1000].includes(lotSize))throw Error('資金須為正數；持倉上限1–100檔；交易單位1或1000股');
 return {initial,maxPositions,lotSize};
}
function run(C,data,rows,p,range,cost,settings){
 const cfg=config(settings),first=data.dates.indexOf(range[0]),last=data.dates.indexOf(range[1]),entryLast=last-26;
 if(first<0||last<first)throw Error('帳戶模擬期間無效');
 const signals=new Map();for(const r of rows)if(r.di>=first&&r.di<=last){if(!signals.has(r.di))signals.set(r.di,new Map());signals.get(r.di).set(C.key(r),r);}
 let cash=cfg.initial,peak=cfg.initial,maxDrawdown=0,maxDrawdownMoney=0,maxInvested=0,skippedFunds=0,skippedSlots=0,unfilled=0,staleMarks=0,liquidityBlocked=0;
 const held=new Map(),trades=[],curve=[];let pendingBuys=[];
 const invested=()=>[...held.values()].reduce((s,x)=>s+x.outlay,0);
 for(let di=first;di<=last;di++){
  const date=data.dates[di],bars=data.daily.get(date)||new Map(),today=signals.get(di)||new Map();
  // Sell orders raised at an earlier close are processed before buys, same open.
  for(const [id,pos] of [...held].sort((a,b)=>a[0].localeCompare(b[0]))){
   if(!pos.exit)continue;const bar=bars.get(id);if(!C.executable(bar)){unfilled++;continue;}
   const price=bar.open*(1-cost.slippage),proceeds=pos.shares*price*(1-cost.fee-cost.tax),pnl=proceeds-pos.outlay;
   cash+=proceeds;trades.push({id,signalDate:pos.signalDate,entryDate:pos.entryDate,exitSignalDate:pos.exit.date,exitDate:date,shares:pos.shares,buyPrice:pos.buyPrice,sellPrice:price,buyOutlay:pos.outlay,sellProceeds:proceeds,pnl,net:pnl/pos.outlay*100,holdingDays:di-pos.di,reason:pos.exit.reason});held.delete(id);
  }
  pendingBuys.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  for(const order of pendingBuys){
   if(held.has(order.id))continue;
   if(held.size>=cfg.maxPositions){skippedSlots++;continue;}
   const bar=bars.get(order.id);if(!C.executable(bar)){unfilled++;continue;}
   const price=bar.open*(1+cost.slippage),perShare=price*(1+cost.fee),budget=Math.min(cfg.initial/cfg.maxPositions,cash);
   const shares=Math.floor(budget/perShare/cfg.lotSize)*cfg.lotSize;
   if(shares<cfg.lotSize){skippedFunds++;continue;}
   const outlay=shares*perShare;cash-=outlay;
   held.set(order.id,{shares,outlay,buyPrice:price,entryDate:date,signalDate:order.date,di,lastClose:bar.open,exit:null});maxInvested=Math.max(maxInvested,invested());
  }
  pendingBuys=[];
  for(const [id,pos] of held){
   if(!pos.exit){const r=today.get(id),score=r?C.weightsScore(r,p.exit):null,timed=di-pos.di+1>=p.maxHold;
    if(timed||(score!==null&&score>=p.exitThreshold))pos.exit={date,reason:timed?'maxHold':'score'};
   }
  }
  if(di<=entryLast)for(const [id,r] of today){if(held.has(id)||!r.rank)continue;const score=C.weightsScore(r,p.entry);if(score===null||score<p.entryThreshold)continue;if(!C.liquidEntry(r,p)){liquidityBlocked++;continue;}pendingBuys.push({id,date,score});}
  let marketValue=0;for(const [id,pos] of held){const bar=bars.get(id);if(bar&&Number.isFinite(bar.close)&&bar.close>0)pos.lastClose=bar.close;else staleMarks++;marketValue+=pos.shares*pos.lastClose;}
  const equity=cash+marketValue;peak=Math.max(peak,equity);const dd=peak-equity;maxDrawdown=Math.max(maxDrawdown,dd/peak*100);maxDrawdownMoney=Math.max(maxDrawdownMoney,dd);
  curve.push({date,cash,marketValue,equity,roi:(equity/cfg.initial-1)*100,positions:held.size,drawdown:dd/peak*100});
 }
 const positive=trades.filter(t=>t.pnl>0),negative=trades.filter(t=>t.pnl<0),avg=a=>a.length?a.reduce((s,t)=>s+t.pnl,0)/a.length:null;
 const avgWin=avg(positive),avgLoss=avg(negative),finalEquity=curve.at(-1).equity,monthly=[];
 let previous=cfg.initial;const months=new Map();for(const r of curve)months.set(r.date.slice(0,7),r);
 for(const [month,row] of months){monthly.push({month,returnPct:(row.equity/previous-1)*100,pnl:row.equity-previous,endEquity:row.equity});previous=row.equity;}
 return {model:'cash-account-daily-close-r19.9',settings:cfg,range,initial:cfg.initial,finalEquity,netProfit:finalEquity-cfg.initial,roi:(finalEquity/cfg.initial-1)*100,maxDrawdown,maxDrawdownMoney,maxInvested,win:trades.length?positive.length/trades.length*100:null,n:trades.length,wins:positive.length,losses:negative.length,breakeven:trades.length-positive.length-negative.length,avgWin,avgLoss,payoffRatio:avgLoss<0?avgWin/Math.abs(avgLoss):null,skippedFunds,skippedSlots,unfilled,liquidityBlocked,unresolved:held.size,staleMarks,holdings:[...held].map(([id,x])=>({id,shares:x.shares,entryDate:x.entryDate,outlay:x.outlay,lastClose:x.lastClose,marketValue:x.shares*x.lastClose})),curve,monthly,trades};
}
const api={config,run};if(typeof module!=='undefined')module.exports=api;root.ResearchPortfolio=api;
})(typeof globalThis!=='undefined'?globalThis:this);
