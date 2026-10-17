/* Experimental TX scores, fixed-contract signals and next-open backtest. No network. */
(function(root){
'use strict';
const sar=typeof module==='object'&&module.exports?require('./parabolic-sar.js'):root.TWParabolicSAR;
const defaults={direction:'long',entryWeights:[30,30,25,15],holdWeights:[35,25,25,15],delta:10,minEntry:55,exit:45,maxAge:5,cost:0};
const clamp=x=>Math.max(0,Math.min(100,x));
function validate(input={}){
 const p={...defaults,...input};
 if(!['long','short'].includes(p.direction))throw Error('請選擇做多或做空');
 for(const k of ['entryWeights','holdWeights']){if(!Array.isArray(p[k])||p[k].length!==4)throw Error('權重需有四項');if(p[k].some(x=>x===''||x===null))throw Error('權重不可空白');p[k]=p[k].map(Number);if(p[k].some(x=>!Number.isFinite(x)||x<0||x>100)||!p[k].some(x=>x>0))throw Error('權重須為 0～100，且至少一項大於零');}
 for(const [k,min,max] of [['delta',0,100],['minEntry',0,100],['exit',0,100],['maxAge',0,100],['cost',0,10000]]){if(p[k]===''||p[k]===null)throw Error('參數不可空白');p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw Error('門檻或成本超出範圍');}
 if(!Number.isInteger(p.maxAge))throw Error('SAR 根數須為整數');return p;
}
const weighted=(v,w)=>v.reduce((s,x,i)=>s+x*w[i],0)/w.reduce((a,b)=>a+b,0);
function analyze(rows,input={},sarConfig={}){
 const p=validate(input),d=p.direction==='long'?1:-1;
 if(new Set(rows.map(b=>b.contract)).size>1)throw Error('Action 必須使用單一月份合約，避免換月價差');
 const points=sar.calculate(rows,{...sar.defaults,...sarConfig,enabled:true});
 const avg=(i,n,k='close')=>rows.slice(i-n+1,i+1).reduce((s,b)=>s+b[k],0)/n;
 const tr=rows.map((b,i)=>Math.max(b.high-b.low,i?Math.abs(b.high-rows[i-1].close):0,i?Math.abs(b.low-rows[i-1].close):0));
 let age=null,lastDirection;
 return rows.map((b,i)=>{
  const sp=points[i];if(sp){if(sp.reversal)age=0;else if(lastDirection===sp.rising&&age!==null)age++;else age=null;lastDirection=sp.rising;}
  if(i<60||!sp)return null;
  const atr=tr.slice(i-13,i+1).reduce((a,b)=>a+b,0)/14;if(!(atr>0))return null;
  const m5=avg(i,5),m20=avg(i,20),m60=avg(i,60),old20=avg(i-1,20);
  const trend=[b.close-m20,m5-m20,m20-m60,m20-old20].reduce((s,x)=>s+(d*x>0?25:0),0);
  const velocity=d*(b.close-rows[i-3].close)/(3*atr),previous=d*(rows[i-3].close-rows[i-6].close)/(3*atr);
  const momentum=clamp(50+velocity*35),acceleration=clamp(50+(velocity-previous)*50);
  const aligned=sp.rising===(d===1),recent=age!==null?(p.maxAge===0?100:clamp(100-age*100/(p.maxAge+1))):0;
  const sarEntry=aligned?recent:0,sarHold=aligned?100:0;
  const ratio=b.volume/Math.max(1,avg(i-1,20,'volume')),move=d*(b.close-rows[i-1].close)/atr;
  const volume=clamp(50+move*25*Math.min(2,ratio));
  const extension=Math.max(0,d*(b.close-m20)/atr-2),penalty=Math.min(30,extension*10);
  const entryParts=[trend,acceleration,sarEntry,volume],holdParts=[trend,momentum,sarHold,volume];
  const entry=clamp(weighted(entryParts,p.entryWeights)-penalty),hold=weighted(holdParts,p.holdWeights);
  return {date:b.date,entry,hold,entryParts,holdParts,penalty,age,aligned,atr};
 }).map((s,i,all)=>{
  if(!s)return null;const delta=all[i-1]?s.entry-all[i-1].entry:null;
  const ageOK=p.maxAge===0||(s.age!==null&&s.age<=p.maxAge);
  return {...s,delta,enter:delta!==null&&delta>=p.delta&&s.entry>=p.minEntry&&s.hold>=p.exit&&s.aligned&&ageOK,leave:s.hold<p.exit};
 });
}
function backtest(rows,input={},sarConfig={}){
 const p=validate(input),scores=analyze(rows,p,sarConfig),d=p.direction==='long'?1:-1,trades=[];
 let position=null,pending=null,realized=0,peak=0,maxDrawdown=0;
 const close=(price,date,reason)=>{const gross=d*(price-position.price),net=gross-p.cost;trades.push({entryDate:position.date,signalDate:position.signalDate,exitDate:date,entry:position.price,exit:price,gross,net,reason});realized+=net;position=null;};
 for(let i=0;i<rows.length;i++){
  const b=rows[i];
  if(pending==='exit'&&position)close(b.open,b.date,'續抱低於門檻');
  else if(pending==='enter'&&!position)position={price:b.open,date:b.date,signalDate:rows[i-1].date};
  pending=null;
  const equity=realized+(position?d*(b.close-position.price)-p.cost:0);peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
  if(i===rows.length-1){if(position)close(b.close,b.date,'區間結束平倉');break;}
  const s=scores[i];if(!s)continue;
  if(position){if(s.leave)pending='exit';}else if(s.enter)pending='enter';
 }
 const wins=trades.filter(t=>t.net>0),gain=wins.reduce((s,t)=>s+t.net,0),loss=-trades.filter(t=>t.net<0).reduce((s,t)=>s+t.net,0);
 return {trades,net:realized,gross:trades.reduce((s,t)=>s+t.gross,0),winRate:trades.length?wins.length/trades.length*100:null,maxDrawdown,profitFactor:loss?gain/loss:null,noLoss:loss===0&&gain>0,validBars:scores.filter(Boolean).length};
}
const api={defaults,validate,analyze,backtest};if(typeof module==='object'&&module.exports)module.exports=api;root.TWTaiexAction=api;
})(typeof window==='object'?window:globalThis);
