(function(root){
'use strict';
const A=typeof module==='object'&&module.exports?require('./taiex-action.js'):root.TWTaiexAction;
const S=typeof module==='object'&&module.exports?require('./parabolic-sar.js'):root.TWParabolicSAR;
function cross(previous,current,level,direction){return direction==='down'?previous>=level&&current<level:previous<=level&&current>level;}
function align(bars,observations){
 const data=[...new Map(observations.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.value)&&r.value>0).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 let j=-1;return bars.map(b=>{while(j+1<data.length&&data[j+1].date<b.date)j++;const v=data[j];return v&&(Date.parse(b.date)-Date.parse(v.date))/86400000<=7?v:null;});
}
function simulate(prep,observations,input={},sarConfig={}){
 const p={entry:20,exit:15,exitDirection:'up',cost:0,...input};
 for(const key of ['entry','exit','cost'])if(!Number.isFinite(p[key])||p[key]<0||(key!=='cost'&&p[key]===0))throw Error('VIX 門檻須大於 0，成本須為非負數');
 if(!['up','down'].includes(p.exitDirection))throw Error('出場穿越方向須為向上或向下');
 const {timeline,lookup,signalRows}=prep;
 const sar=S.calculate(signalRows,{...sarConfig,enabled:true}),values=align(signalRows,observations),signals=new Map();
 let coverage=0;
 signalRows.forEach((b,i)=>{
  const v=values[i],prev=values[i-1],s=sar[i];
  const valid=!!(v&&prev&&s);if(valid)coverage++;
  signals.set(b.date,{vix:v?.value,vixDate:v?.date,previous:prev?.value,sarBelow:s?.rising,
   enter:valid&&v.date!==prev.date&&s.rising&&cross(prev.value,v.value,p.entry,'down'),
   exit:valid&&v.date!==prev.date&&!s.rising&&cross(prev.value,v.value,p.exit,p.exitDirection),valid});
 });
 let pos=null,episode=null,pending=null,net=0,peak=0,drawdown=0,rolls=0;
 const trades=[],legs=[],equity=[];
 function close(price,date,reason,carry=false){
  const gain=price-pos.price-p.cost;net+=gain;episode.net+=gain;episode.legs++;
  legs.push({contract:pos.contract,entryDate:pos.date,exitDate:date,entry:pos.price,exit:price,net:gain,reason});pos=null;
  if(!carry){trades.push({...episode,exitDate:date,reason,forced:reason==='期末平倉'});episode=null;}
 }
 for(let i=0;i<timeline.length;i++){
  const b=timeline[i],sig=signals.get(b.date);
  if(pos&&pos.contract!==b.contract){
   const old=lookup.get(b.date+':'+pos.contract);if(!old)throw Error('缺少換月舊合約價格：'+b.date);
   const exit=pending?.action==='exit';close(old.open,b.date,exit?'策略出場':'換月',!exit);
   if(!exit){pos={contract:b.contract,date:b.date,price:b.open};rolls++;}else pending=null;
  }
  if(pending?.action==='exit'&&pos)close(b.open,b.date,'策略出場');
  else if(pending?.action==='enter'&&!pos){
   pos={contract:b.contract,date:b.date,price:b.open};episode={entryDate:b.date,signalDate:pending.date,entryVix:pending.signal.vix,vixDate:pending.signal.vixDate,net:0,legs:0};
  }
  pending=null;
  const value=net+(pos?b.close-pos.price-p.cost:0);peak=Math.max(peak,value);drawdown=Math.max(drawdown,peak-value);equity.push({date:b.date,value});
  if(i===timeline.length-1){if(pos)close(b.close,b.date,'期末平倉');break;}
  if(pos&&sig?.exit){episode.exitSignalDate=b.date;episode.exitVix=sig.vix;episode.exitVixDate=sig.vixDate;pending={action:'exit'};}
  else if(!pos&&sig?.enter)pending={action:'enter',date:b.date,signal:sig};
 }
 const completed=trades.filter(t=>!t.forced),wins=completed.filter(t=>t.net>0).length,forced=trades.filter(t=>t.forced);
 return {start:timeline[0].date,end:timeline.at(-1).date,net,maxDrawdown:drawdown,winRate:completed.length?100*wins/completed.length:null,wins,losses:completed.filter(t=>t.net<0).length,flats:completed.filter(t=>t.net===0).length,tradeCount:completed.length,forcedCount:forced.length,forcedNet:forced.reduce((n,t)=>n+t.net,0),trades,legs,equity,rolls,validDays:timeline.filter(b=>signals.get(b.date)?.valid).length,totalDays:timeline.length,entrySignals:timeline.filter(b=>signals.get(b.date)?.enter).length,exitSignals:timeline.filter(b=>signals.get(b.date)?.exit).length,params:p};
}
function backtest(rows,observations,input={},sarConfig={},range={}){
 const prep=A.prepareMulti(rows,{},sarConfig,range);
 return simulate(prep,observations,input,sarConfig);
}
const api={cross,align,simulate,backtest};if(typeof module==='object'&&module.exports)module.exports=api;root.TWTaiexVixSar=api;
})(typeof window==='object'?window:globalThis);
