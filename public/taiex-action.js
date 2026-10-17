/* Experimental TX scores, fixed-contract signals and next-open backtest. No network. */
(function(root){
'use strict';
const sar=typeof module==='object'&&module.exports?require('./parabolic-sar.js'):root.TWParabolicSAR;
const defaults={direction:'long',entryWeights:[30,30,25,15],holdWeights:[35,25,25,15],delta:10,minEntry:55,exit:45,maxAge:5,cost:0,sarMode:'both',preFlipGap:0.75,preFlipMin:65};
const clamp=x=>Math.max(0,Math.min(100,x));
function validate(input={}){
 const p={...defaults,...input};
 if(!['long','short'].includes(p.direction))throw Error('請選擇做多或做空');
 if(!['aligned','anticipate','both'].includes(p.sarMode))throw Error('SAR 進場模式不正確');
 for(const k of ['entryWeights','holdWeights']){if(!Array.isArray(p[k])||p[k].length!==4)throw Error('權重需有四項');if(p[k].some(x=>x===''||x===null))throw Error('權重不可空白');p[k]=p[k].map(Number);if(p[k].some(x=>!Number.isFinite(x)||x<0||x>100)||!p[k].some(x=>x>0))throw Error('權重須為 0～100，且至少一項大於零');}
 for(const [k,min,max] of [['delta',0,100],['minEntry',0,100],['exit',0,100],['maxAge',0,100],['cost',0,10000],['preFlipGap',0.05,3],['preFlipMin',0,100]]){if(p[k]===''||p[k]===null)throw Error('參數不可空白');p[k]=Number(p[k]);if(!Number.isFinite(p[k])||p[k]<min||p[k]>max)throw Error('門檻或成本超出範圍');}
 if(!Number.isInteger(p.maxAge))throw Error('SAR 根數須為整數');return p;
}
const weighted=(v,w)=>v.reduce((s,x,i)=>s+x*w[i],0)/w.reduce((a,b)=>a+b,0);
// KD 9,3,3: recursively smoothed K and D with no future or next-candle inputs.
function kdSeries(rows){
 let k=50,d=50;return rows.map((b,i)=>{
  const section=rows.slice(Math.max(0,i-8),i+1),high=Math.max(...section.map(x=>x.high)),low=Math.min(...section.map(x=>x.low));
  const rsv=high===low?50:clamp((b.close-low)/(high-low)*100);
  k=(k*2+rsv)/3;d=(d*2+k)/3;return {k,d};
 });
}
// The candidate trigger for NEXT bar is calculated from information known at today's close.
// A near trigger cannot guarantee tomorrow's reversal.
function preFlipEvidence(point,b,prev,atr,acceleration,volume,kd,prevKD,d,preGap){
 const gap=(d===1?point.nextTrigger-b.high:b.low-point.nextTrigger)/atr;
 const near=clamp(100-100*Math.max(0,gap)/preGap);
 const kdAgree=d===1?kd.k>kd.d&&kd.k>prevKD.k:kd.k<kd.d&&kd.k<prevKD.k;
 const kdScore=kdAgree?100:0;
 const preFlipScore=clamp(near*0.35+acceleration*0.3+kdScore*0.25+volume*0.1);
 return {gap,near,kdAgree,kdScore,preFlipScore,priceImproving:d*(b.close-prev.close)>0};
}
function entryGate(s,p){
 const after=s.aligned&&(p.maxAge===0||(s.age!==null&&s.age<=p.maxAge));
 const before=!s.aligned&&s.evidence.kdAgree&&s.evidence.priceImproving&&
   s.evidence.gap<=p.preFlipGap&&s.evidence.gap>=-0.5&&s.preFlipScore>=p.preFlipMin;
 return p.sarMode==='aligned'?after:p.sarMode==='anticipate'?before:(after||before);
}

function analyze(rows,input={},sarConfig={}){
 const p=validate(input),d=p.direction==='long'?1:-1;
 if(new Set(rows.map(b=>b.contract)).size>1)throw Error('Action 必須使用單一月份合約，避免換月價差');
 const points=sar.calculate(rows,{...sar.defaults,...sarConfig,enabled:true}),kd=kdSeries(rows);
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
  const sarHold=aligned?100:0;
  const ratio=b.volume/Math.max(1,avg(i-1,20,'volume')),move=d*(b.close-rows[i-1].close)/atr;
  const volume=clamp(50+move*25*Math.min(2,ratio));
  const pre=preFlipEvidence(sp,b,rows[i-1],atr,acceleration,volume,kd[i],kd[i-1],d,p.preFlipGap);
  const sarEntry=aligned?recent:pre.preFlipScore;
  const extension=Math.max(0,d*(b.close-m20)/atr-2),penalty=Math.min(30,extension*10);
  const entryParts=[trend,acceleration,sarEntry,volume],holdParts=[trend,momentum,sarHold,volume];
  const entry=clamp(weighted(entryParts,p.entryWeights)-penalty),hold=weighted(holdParts,p.holdWeights);
  return {date:b.date,entry,hold,entryParts,holdParts,penalty,age,aligned,atr,preFlipScore:pre.preFlipScore,
   evidence:{trend:[b.close-m20,m5-m20,m20-m60,m20-old20].map(x=>d*x>0),velocity,previous,ratio,move,extension,acceleration,volume,trigger:sp.nextTrigger,
   gap:pre.gap,near:pre.near,kdAgree:pre.kdAgree,priceImproving:pre.priceImproving,k:kd[i].k,dh:kd[i].d}};
 }).map((s,i,all)=>{
  if(!s)return null;const delta=all[i-1]?s.entry-all[i-1].entry:null;
  return {...s,delta,enter:delta!==null&&delta>=p.delta&&s.entry>=p.minEntry&&s.hold>=p.exit&&entryGate(s,p),leave:s.hold<p.exit};
 });
}
function selectRange(rows,range={}){
 const start=range.start||rows[0]?.date,end=range.end||rows.at(-1)?.date;
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end)||start>end)throw Error('請設定有效的回測起訖日期，起日不可晚於迄日');
 const eligible=rows.filter(b=>b.date<=end),first=eligible.findIndex(b=>b.date>=start);
 if(first<0)throw Error('所選區間沒有 K 線資料');
 return {rows:eligible,first,start:eligible[first].date,end:eligible.at(-1).date};
}
function backtest(rows,input={},sarConfig={},range={}){
 const p=validate(input),selected=selectRange(rows,range);
 return simulate(selected.rows,p,analyze(selected.rows,p,sarConfig),selected.first);
}
function simulate(rows,p,scores,first=0){
 const d=p.direction==='long'?1:-1,trades=[];
 let position=null,pending=null,realized=0,peak=0,maxDrawdown=0;
 const close=(price,date,reason)=>{const gross=d*(price-position.price),net=gross-p.cost;trades.push({entryDate:position.date,signalDate:position.signalDate,exitDate:date,entry:position.price,exit:price,gross,net,reason});realized+=net;position=null;};
 for(let i=first;i<rows.length;i++){
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
 return {trades,net:realized,gross:trades.reduce((s,t)=>s+t.gross,0),winRate:trades.length?wins.length/trades.length*100:null,maxDrawdown,profitFactor:loss?gain/loss:null,noLoss:loss===0&&gain>0,validBars:scores.slice(first).filter(Boolean).length,start:rows[first]?.date,end:rows.at(-1)?.date};
}
// Reuse observed features for the grid; never recompute SAR/ATR for each candidate.
function rescore(features,p){
 const scored=features.map(s=>{
  if(!s)return null;
  const e=s.evidence,preFlipScore=clamp(clamp(100-100*Math.max(0,e.gap)/p.preFlipGap)*0.35+
    e.acceleration*0.3+(e.kdAgree?100:0)*0.25+e.volume*0.1);
  const entryParts=[...s.entryParts];
  entryParts[2]=s.aligned&&s.age!==null?(p.maxAge===0?100:clamp(100-s.age*100/(p.maxAge+1))):s.aligned?0:preFlipScore;
  return {...s,preFlipScore,entryParts,entry:clamp(weighted(entryParts,p.entryWeights)-s.penalty),hold:weighted(s.holdParts,p.holdWeights)};
 });
 return scored.map((s,i)=>{
  if(!s)return null;
  const delta=scored[i-1]?s.entry-scored[i-1].entry:null;
  return {...s,delta,enter:delta!==null&&delta>=p.delta&&s.entry>=p.minEntry&&s.hold>=p.exit&&entryGate(s,p),leave:s.hold<p.exit};
 });
}
function candidateGrid(input){
 const p=validate(input),uniq=a=>[...new Map(a.map(v=>[JSON.stringify(v),v])).values()];
 const profiles=[[25,25,25,25],[40,20,25,15],[20,40,25,15],[20,20,45,15]],out=[];
 for(const entryWeights of uniq([p.entryWeights,...profiles]))for(const holdWeights of uniq([p.holdWeights,...profiles]))
 for(const delta of uniq([p.delta,5,15]))for(const minEntry of uniq([p.minEntry,45,65]))for(const exit of uniq([p.exit,35,55]))for(const maxAge of uniq([p.maxAge,3,0]))out.push({...p,entryWeights,holdWeights,delta,minEntry,exit,maxAge});
 return out;
}
function compare(a,b){return b.result.winRate-a.result.winRate||b.result.net-a.result.net||a.result.maxDrawdown-b.result.maxDrawdown||b.result.trades.length-a.result.trades.length;}
function* optimize(rows,input={},sarConfig={},range={},minTrades=5){
 if(!Number.isInteger(minTrades)||minTrades<1||minTrades>10000)throw Error('最低交易筆數須為 1～10000 的整數');
 const p=validate(input),selected=selectRange(rows,range),features=analyze(selected.rows,p,sarConfig),grid=candidateGrid(p),top=[];let eligible=0;
 for(let i=0;i<grid.length;i++){
  const config=grid[i],result=simulate(selected.rows,config,rescore(features,config),selected.first);
  if(result.trades.length>=minTrades){eligible++;top.push({config,result});top.sort(compare);top.length=Math.min(5,top.length);}
  if((i+1)%20===0||i===grid.length-1)yield {done:i+1,total:grid.length,eligible,top:[...top],start:selected.start,end:selected.end};
 }
}
// Calendar-defined next-month contract: known before the session, not chosen by future prices.
function nextMonth(date){const y=Number(date.slice(0,4)),m=Number(date.slice(5,7));return String(y+(m===12?1:0))+String(m===12?1:m+1).padStart(2,'0');}
// Make one point-in-time, roll-adjusted signal history rather than resetting MA60/SAR every month.
// Roll spread is observed on the rollover morning; it never enters P&L or selects a contract.
function prepareMulti(allRows,input={},sarConfig={},range={}){
 const p=validate(input),sorted=[...allRows].sort((a,b)=>a.date.localeCompare(b.date)||a.contract.localeCompare(b.contract));
 const selected=selectRange(sorted,range),lookup=new Map(),volumes=new Map(),normalizedVolume=new Map();
 // Normalize only against previously observed volume of the SAME contract.
 // Otherwise jumping from an active to an illiquid next-month contract creates fake volume signals.
 for(const b of selected.rows){
  lookup.set(b.date+':'+b.contract,b);
  let prior=volumes.get(b.contract);if(!prior){prior=[];volumes.set(b.contract,prior);}
  const baseline=prior.length?prior.reduce((v,n)=>v+n,0)/prior.length:0;
  normalizedVolume.set(b.date+':'+b.contract,baseline>0?10000*Math.min(5,Math.max(0,b.volume/baseline)):10000);
  prior.push(b.volume);if(prior.length>20)prior.shift();
 }
 const dates=[...new Set(selected.rows.map(b=>b.date))],timeline=[],adjusted=[];
 let previous=null,offset=0;
 for(const date of dates){
  const contract=nextMonth(date),b=lookup.get(date+':'+contract),active=date>=selected.start;
  if(!b){
   if(active)throw Error(date+' 缺少次月合約 '+contract+' 行情，無法完整跨月回測；請調整區間或重新載入。');
   adjusted.length=0;previous=null;offset=0;continue;
  }
  if(previous&&previous.contract!==contract){
   const old=lookup.get(date+':'+previous.contract);
   if(!old){
    if(active&&timeline.length)throw Error(date+' 缺少舊合約開盤價，無法計算換月平倉。');
    adjusted.length=0;offset=0;
   }else offset+=old.open-b.open;
  }
  adjusted.push({...b,contract:'TX_SIGNAL',open:b.open+offset,high:b.high+offset,low:b.low+offset,close:b.close+offset,volume:normalizedVolume.get(date+':'+contract)});
  if(active)timeline.push(b);
  previous=b;
 }
 if(!timeline.length)throw Error('所選區間沒有可回測的次月合約資料');
 return {timeline,lookup,features:analyze(adjusted,p,sarConfig),start:timeline[0].date,end:timeline.at(-1).date,signalBars:adjusted.length};
}
function simulateMulti(prepared,p){
 const {timeline,lookup,features}=prepared,scores=new Map();
 for(const s of rescore(features,p))if(s)scores.set(s.date,s);
 const d=p.direction==='long'?1:-1,trades=[],months=[...new Set(timeline.map(b=>b.contract))];
 let position=null,pending=null,pendingSignalType=null,net=0,peak=0,maxDrawdown=0,validBars=0,rollovers=0,entrySignals=0,exitSignals=0,preFlipEntries=0;
 function close(price,date,reason){const gross=d*(price-position.price),value=gross-p.cost;trades.push({contract:position.contract,entryDate:position.date,signalDate:position.signalDate,signalType:position.signalType,exitDate:date,entry:position.price,exit:price,gross,net:value,reason});net+=value;position=null;}
 for(let i=0;i<timeline.length;i++){
  const b=timeline[i],roll=i>0&&timeline[i-1].contract!==b.contract;
  if(roll){rollovers++;if(position)close(lookup.get(b.date+':'+position.contract).open,b.date,'換月平倉');pending=null;pendingSignalType=null;}
  if(pending==='exit'&&position)close(b.open,b.date,'續抱低於門檻');
  else if(pending==='enter'&&!position)position={contract:b.contract,date:b.date,price:b.open,signalDate:timeline[i-1].date,signalType:pendingSignalType};
  pending=null;pendingSignalType=null;
  const equity=net+(position?d*(b.close-position.price)-p.cost:0);peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
  const s=scores.get(b.date);if(s)validBars++;
  if(i===timeline.length-1){if(position)close(b.close,b.date,'區間結束平倉');break;}
  if(s){if(position){if(s.leave){pending='exit';exitSignals++;}}else if(s.enter){pending='enter';pendingSignalType=s.aligned?'已翻向':'翻向前預判';entrySignals++;if(!s.aligned)preFlipEntries++;}}
 }
 // Future observations only measure prediction accuracy; never alter historical entries.
 let evaluated=0,within2=0;
 for(let i=0;i<timeline.length-2;i++){
  const current=scores.get(timeline[i].date);
  if(!current?.enter||current.aligned)continue;
  const next=scores.get(timeline[i+1].date),after=scores.get(timeline[i+2].date);
  if(!next||!after)continue;
  evaluated++;if(next.aligned||after.aligned)within2++;
 }
 const gain=trades.reduce((v,t)=>v+Math.max(0,t.net),0),loss=trades.reduce((v,t)=>v+Math.max(0,-t.net),0);
 return {trades,net,gross:trades.reduce((v,t)=>v+t.gross,0),winRate:trades.length?trades.filter(t=>t.net>0).length/trades.length*100:null,maxDrawdown,profitFactor:loss?gain/loss:null,noLoss:loss===0&&gain>0,validBars,totalBars:timeline.length,warmupBars:timeline.length-validBars,start:prepared.start,end:prepared.end,months,rollovers,entrySignals,exitSignals,preFlipEntries,preFlipCheck:{evaluated,within2,percent:evaluated?within2/evaluated*100:null},signalBars:prepared.signalBars};
}
function backtestMulti(rows,input={},sarConfig={},range={}){const p=validate(input);return simulateMulti(prepareMulti(rows,p,sarConfig,range),p);}
// More independent profiles, including low-frequency and active-entry variants.
// Trade count is a constraint, not an objective; identical trade calendars occupy only one finalist.
function candidateGridMulti(input){
 const p=validate(input),unique=a=>[...new Map(a.map(v=>[JSON.stringify(v),v])).values()];
 const profiles=[[25,25,25,25],[40,20,25,15],[20,40,25,15],[20,20,45,15],[45,35,10,10]];
 const entryProfiles=unique([p.entryWeights,...profiles]),holdProfiles=unique([p.holdWeights,...profiles]);
 const grid=[p];
 for(const entryWeights of entryProfiles)for(const holdWeights of holdProfiles)
 for(const delta of [0,3,7,12,20])for(const minEntry of [30,45,60])
 for(const exit of [30,45,60])for(const maxAge of [0,5,12])
 grid.push({...p,entryWeights,holdWeights,delta,minEntry,exit,maxAge});
 // Compare confirmed SAR, before-flip-only, and mixed signals under multiple
 // pre-flip KD/ATR thresholds without exploding the on-device search space.
 for(const sarMode of ['aligned','anticipate','both'])
 for(const preFlipGap of [0.45,1.0])
 for(const preFlipMin of [55,70])
 for(const entryWeights of entryProfiles.slice(0,3))
 for(const holdWeights of holdProfiles.slice(0,3))
 for(const delta of [0,7,15])
 for(const minEntry of [40,55])
 for(const exit of [30,45])
 grid.push({...p,sarMode,preFlipGap,preFlipMin,entryWeights,holdWeights,delta,minEntry,exit,maxAge:p.maxAge});
 return unique(grid);
}
function tradeSignature(result){return result.trades.map(t=>[t.contract,t.entryDate,t.exitDate].join(':')).join('|');}
function* optimizeMulti(rows,input={},sarConfig={},range={},minTrades=5){
 if(!Number.isInteger(minTrades)||minTrades<1||minTrades>10000)throw Error('最低交易筆數須為 1～10000 的整數');
 const p=validate(input),prepared=prepareMulti(rows,p,sarConfig,range),grid=candidateGridMulti(p),top=[];
 let eligible=0,maxTrades=0;
 for(let i=0;i<grid.length;i++){
  const config=grid[i],result=simulateMulti(prepared,config);maxTrades=Math.max(maxTrades,result.trades.length);
  if(result.trades.length>=minTrades){
   eligible++;const signature=tradeSignature(result),existing=top.findIndex(v=>v.signature===signature);
   const item={config,result,signature};
   if(existing>=0){if(compare(item,top[existing])<0)top[existing]=item;}
   else top.push(item);
   top.sort(compare);top.length=Math.min(5,top.length);
  }
  if((i+1)%25===0||i===grid.length-1)
   yield {done:i+1,total:grid.length,eligible,maxTrades,validBars:result.validBars,totalBars:result.totalBars,top:top.map(({config,result})=>({config,result})),start:prepared.start,end:prepared.end,months:[...new Set(prepared.timeline.map(b=>b.contract))]};
 }
}
const api={defaults,validate,analyze,backtest,optimize,candidateGrid,candidateGridMulti,compare,backtestMulti,optimizeMulti,nextMonth};if(typeof module==='object'&&module.exports)module.exports=api;root.TWTaiexAction=api;
})(typeof window==='object'?window:globalThis);
