// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {simulateLimit} from '../public/r26-research/open-limit-orders.mjs';
import {simulateLimitRisk} from '../public/r26-research/combined-breakout-risk.mjs';
import {priorDailyRegimes,regimeFlags} from '../public/r26-research/prior-regime-features.mjs';
import {replaySizedTape} from '../public/r26-research/five-lot-tape.mjs';
import {researchSimulate} from '../public/r26-research/core-profit-overlay.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const p='public/r26-engine/data/',meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'manifest.json.gz')));
const raw=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(x=>fs.readFileSync(p+x))));
const frozen=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4);
const canonical=run(meta,frozen,{end:meta.end});
assert.equal(audit(canonical,meta).pass,true);
const gold=simulateLimit(canonical.sessions,frozen,{end:meta.end});
assert.equal(gold.minuteDD,canonical.minuteDD);
for(let i=0;i<gold.rows.length;i++)assert.equal(gold.rows[i].pnl,canonical.rows[i].pnl);
const seed=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'recent.json.gz')));
const calendar=extendTaifexCalendar2026(seed.calendar);
const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'verified-official-backfill.json.gz')));
assert.equal(saved.last_complete_trade_day,'2026-11-11');
const expected=physicalSessions(calendar,meta.end,Date.parse('2026-11-11T14:00:00+08:00'));
const grouping=new Map();
for(const x of saved.rows){if(!grouping.has(x.session_key))grouping.set(x.session_key,[]);grouping.get(x.session_key).push(x)}
const ss=meta.sessions.map(x=>({...x})),more=[];
for(const t of expected){
 const rr=(grouping.get(t.key)||[]).filter(x=>x.trade_date===t.date&&x.contract_verified===true&&x.source==='TAIFEX official ticks')
  .sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 if(t.sid===1?rr.length!==300:rr.length<750||rr.length>840)throw Error('Missing verified official session '+t.key);
 const last=ss.at(-1),idx=(last.offset+last.count-1)*4+3,prevCl=idx<frozen.length?frozen[idx]:more[idx-frozen.length],cl=rr.at(-1).close;
 ss.push({...t,contract:rr[0].contract_date,offset:(frozen.length+more.length)/4,count:rr.length,
  start:rr[0].timestamp_tpe,end:rr.at(-1).timestamp_tpe,source:'TAIFEX official ticks',
  market:rr[0].contract_date===last.contract?cl-prevCl:cl-rr[0].open-5});
 for(const r of rr)more.push(r.open,r.high,r.low,r.close);
}
const bars=new Int32Array(frozen.length+more.length);bars.set(frozen);bars.set(more,frozen.length);
const prepared=run({...meta,sessions:ss},bars,{end:'2026-11-11'});
const extendedGold=simulateLimit(prepared.sessions,bars,{end:'2026-11-11'});
assert.equal(extendedGold.minuteDD,prepared.minuteDD);
for(let i=0;i<extendedGold.rows.length;i++)assert.equal(extendedGold.rows[i].pnl,prepared.rows[i].pnl);












const regs=priorDailyRegimes(prepared.sessions),round=x=>Math.round(x*100)/100;
const rescue=regimeFlags(regs,r=>
 (r.atrSlope20<=-.25&&r.features?.mom5>2)||
 (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
 (r.efficiency10>.8&&r.features?.mom5>1.5)||
 (r.efficiency20>=.8&&r.upDays10>=.5));
function signalRun({fee=2.5,entrySlippage=0,riskSlippage=0}={}){
 return simulateLimitRisk(prepared.sessions,bars,{
  end:'2026-11-11',fee,
  risk:{preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
   highVolLongRescueFlags:rescue,equityDdCap:800,cooldownReset:true,haltSessions:8,
   resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
   hardStopSlippagePoints:riskSlippage,coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3}},
  limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,
   entryWindow:30,onlySide:-1,breakoutSlippagePoints:entrySlippage}});
}
function lots(v,dd,contractMax){return ({s,priorDd})=>
 (s.atr<v&&priorDd<dd)?contractMax:1;}
function replay(signal,fee,v,dd,max,{portfolioCap=0,portfolioSlip=0}={}){
 return replaySizedTape(prepared.sessions,bars,signal,{
  fee,maxLots:5,sizeAtOpen:lots(v,dd,max),
  drawdownCircuit:portfolioCap,riskExitExtraSlip:portfolioSlip,haltSessions:8});
}
const anchor=signalRun();
const reference=replaySizedTape(prepared.sessions,bars,anchor,{fee:2.5,maxLots:5,sizeAtOpen:()=>1});
assert.equal(reference.net,29657);assert.equal(reference.minuteDD,806);
const params=[];
for(const vol of [110,125,135,140,145,150,155,160,170,180,190,200])
 for(const priorDD of [50,75,100,125,150,200])
  for(const max of [2,3,4,5])
   params.push({vol,priorDD,max,name:'ATR_LT'+vol+'_PREVDD_LT'+priorDD+'_LOTS'+max});
const scores=[];
const parsePeriods=x=>{
 const o={};
 for(const [label,a,b] of [['train','2021-10-22','2023-12-31'],
  ['validation','2024-01-01','2025-12-31'],['holdout','2026-01-01','2026-11-11']])
  o[label]=round(x.rows.filter(r=>r.date>=a&&r.date<=b).reduce((sum,r)=>sum+r.pnl,0));
 return o;
};
function summarize(x,p,other={}){
 return {name:p.name,vol:p.vol,ddThreshold:p.priorDD,maxLots:p.max,
  net:x.net,dd:x.minuteDD,ratio:round(x.net/x.minuteDD),
  periods:parsePeriods(x),rebalance:x.rebalanceLots,
  addedExposureSessions:x.rows.filter(r=>Math.abs(r.endingLots)>1).length,
  requestedExtraSessions:x.rows.filter(r=>r.requestedLots>1).length,
  maxObservedLots:Math.max(...x.rows.map(r=>Math.abs(r.endingLots))),
  costUnits:x.tradedContracts,...other};
}
for(let i=0;i<params.length;i++){
 const p=params[i],x=replay(anchor,2.5,p.vol,p.priorDD,p.max);
 scores.push(summarize(x,p));
 if(i%35===0)console.log('R26_5LOT_LOCAL_PROGRESS',i,params.length,p.name,x.net,x.minuteDD);
}
const target=scores.find(x=>x.vol===150&&x.ddThreshold===100&&x.maxLots===5);
assert.equal(target.net,30877);assert.equal(target.dd,806);
const sortRatio=x=>x.sort((a,b)=>b.ratio-a.ratio||b.net-a.net);
const sortNet=x=>x.sort((a,b)=>b.net-a.net||a.dd-b.dd);
const stable=sortRatio(scores.filter(x=>x.dd<=1000&&x.periods.train>0&&x.periods.validation>0&&x.periods.holdout>0));
const allGood=sortNet(scores.filter(x=>x.dd<=1000&&x.net>=30000&&x.ratio>=35));
const neighborhood=scores.filter(x=>[140,145,150,155,160].includes(x.vol)&&
 [75,100,125].includes(x.ddThreshold)&&x.maxLots===5);
const costRegimes=[
 {name:'BASE',fee:2.5,entrySlippage:0,riskSlippage:0},
 {name:'HIGH_FEE',fee:5,entrySlippage:5,riskSlippage:75},
 {name:'HIGHER_FEE',fee:5,entrySlippage:10,riskSlippage:100}
];
const stressed=[];
for(const fees of costRegimes){
 const signal=fees.name==='BASE'?anchor:signalRun(fees);
 const same1=replaySizedTape(prepared.sessions,bars,signal,{
  fee:fees.fee,maxLots:5,sizeAtOpen:()=>1});
 assert.equal(same1.net,round(signal.rows.reduce((a,r)=>a+r.pnl,0)),'FEE_SIGNAL_NET_MUST_MATCH');
 assert.equal(same1.minuteDD,signal.minuteDD,'FEE_SIGNAL_DD_MUST_MATCH');
 for(const v of [140,150,160])for(const dd of [75,100,125]){
  const p=params.find(x=>x.vol===v&&x.priorDD===dd&&x.max===5);
  for(const circuit of [0,1000]){
   const x=replay(signal,fees.fee,v,dd,5,{portfolioCap:circuit,
    portfolioSlip:fees.name==='BASE'?0:50});
   stressed.push(summarize(x,p,{fees:fees.name,fee:fees.fee,entrySlippage:fees.entrySlippage,
    riskSlippage:fees.riskSlippage,portfolioCircuit:circuit,
    portfolioCircuitSlip:fees.name==='BASE'?0:50}));
  }
 }
}
const detailedRun=replay(anchor,2.5,150,100,5);
const paired=reference.rows.map((row,i)=>({
 date:row.date,sid:row.sid,baselinePnl:row.pnl,multiPnl:detailedRun.rows[i].pnl,
 extra:round(detailedRun.rows[i].pnl-row.pnl),
 lots:detailedRun.rows[i].endingLots,requested:detailedRun.rows[i].requestedLots}));
const months=new Map();
for(const p of paired){
 const m=p.date.slice(0,7);
 if(!months.has(m))months.set(m,{month:m,extra:0,increasedSessions:0,
  baseline:0,sized:0});
 const a=months.get(m);
 a.extra+=p.extra;a.baseline+=p.baselinePnl;a.sized+=p.multiPnl;
 if(p.requested>1)a.increasedSessions++;
}
const attr=[...months.values()].map(x=>({month:x.month,extra:round(x.extra),
 requestedExtraSessions:x.increasedSessions,baseline:round(x.baseline),sized:round(x.sized)}));
attr.sort((a,b)=>b.extra-a.extra);
const highCost=sortRatio(stressed.filter(x=>x.fees==='HIGH_FEE'&&x.portfolioCircuit===1000&&x.dd<=1000));
const pResult={
 frozen:{net:reference.net,dd:reference.minuteDD,ratio:reference.ratio},
 fullSample:2452,candidates:params.length,baselineCandidate:target,
 nearest:neighborhood,nearSummary:{
  minNet:Math.min(...neighborhood.map(x=>x.net)),maxNet:Math.max(...neighborhood.map(x=>x.net)),
  minDD:Math.min(...neighborhood.map(x=>x.dd)),maxDD:Math.max(...neighborhood.map(x=>x.dd)),
  percentBeatOne:round(100*neighborhood.filter(x=>x.ratio>reference.ratio).length/neighborhood.length)},
 bestRatio:stable.slice(0,30),bestNet:allGood.slice(0,25),
 stress:stressed,highCostWithin1000:highCost.slice(0,15),
 attrTop:attr.slice(0,15),attrBottom:[...attr].sort((a,b)=>a.extra-b.extra).slice(0,10),
 topWinningSessions:[...paired].sort((a,b)=>b.extra-a.extra).slice(0,20),
 topLosingSessions:[...paired].sort((a,b)=>a.extra-b.extra).slice(0,20),
 extraExposureDates:paired.filter(x=>x.requested>1).map(x=>({date:x.date,sid:x.sid,requested:x.requested,ending:x.lots,extra:x.extra})),
 all:scores,
 warnings:['This is a grid around a discovered low-ATR absolute-price level; heavy reuse of same 2021-2026 history, in-sample sweet-spot risk.',
 'HIGH_FEE reruns underlying one-lot R26 signal with fee 5 points per side, short-entry slippage 5pt and one-lot risk-exit 75pt.',
 'Independent sized-portfolio additional circuit 1000 paper-equity pts, risk stop extra 50 index pts per TX contract; not guaranteed fills.',
 'No session future OHLC in size policy; late-sample performance may be unchanged because low ATR threshold rarely activates.'],
 generatedAt:new Date().toISOString()};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-five-lot-parameter-stability.json',JSON.stringify(pResult,null,2));
fs.writeFileSync('r26-study-output/r26-five-lot-parameter-stability.csv',
 'name,atrThreshold,priorDDThreshold,maxLots,net,dd,ratio,train,validation,holdout,requestedExtraSessions,exposedSessions\n'+
 scores.map(x=>[x.name,x.vol,x.ddThreshold,x.maxLots,x.net,x.dd,x.ratio,
 x.periods.train,x.periods.validation,x.periods.holdout,x.requestedExtraSessions,x.addedExposureSessions].join(',')).join('\n'));
console.log('R26_5LOT_LOCAL_RESULTS',JSON.stringify({
 count:params.length,reference:pResult.frozen,target,
 sweetSpotNeighborhood:pResult.nearSummary,
 best:stable.slice(0,16),lowDD:allGood.slice(0,14),
 topMonths:attr.slice(0,10),topSessions:pResult.topWinningSessions.slice(0,10),
 activeSessions:target.requestedExtraSessions,realLotsSessions:target.addedExposureSessions,
 stress:stressed.filter(x=>x.vol===150&&x.ddThreshold===100).map(x=>({
  fees:x.fees,portfolioCircuit:x.portfolioCircuit,
  net:x.net,dd:x.dd,ratio:x.ratio,extraCircuits:x.stopEvents,years:x.periods})),
 robust:highCost.slice(0,12)}));
