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














const regimes=priorDailyRegimes(prepared.sessions),round=x=>Math.round(x*100)/100;
const rescues=regimeFlags(regimes,r=>
 (r.atrSlope20<=-.25&&r.features?.mom5>2)||
 (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
 (r.efficiency10>.8&&r.features?.mom5>1.5)||
 (r.efficiency20>=.8&&r.upDays10>=.5));
function oneLot({fee=2.5,entrySlippage=0,riskSlippage=0}={}){
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',
 risk:{preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
  highVolLongRescueFlags:rescues,equityDdCap:800,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
  coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3},
  hardStopSlippagePoints:riskSlippage},
 limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,entryWindow:30,onlySide:-1,
  breakoutSlippagePoints:entrySlippage}});
}
const capital=2_000_000,margin=701_000,reserve=300_000,multiplier=200;
const tests=[];
function add(family,rule,gate,threshold,fn){
 const name=family+'_'+rule+'_P'+gate+'_DD'+threshold;
 tests.push({family,rule,gate,threshold,name,fn});
}
for(const p of [.25,.3,.35,.375,.4,.425,.45,.475,.5,.55,.6])
 for(const dd of [50,75,100,125,150,175,200,250,350])
  add('pct','low',p,dd,({index,priorDd})=>
   regimes[index].historyReady&&regimes[index].atrPercentile250<p&&priorDd<dd);
for(const e of [.35,.4,.45,.5,.55,.6,.65,.7,.75,.8])
 for(const dd of [75,100,150,200,250,300,350,400,500])
  add('eff','gt',e,dd,({index,priorDd})=>
   regimes[index].historyReady&&regimes[index].efficiency10>e&&priorDd<dd);
for(const p of [.35,.4,.45,.5])for(const e of [.4,.55,.7])
 for(const dd of [100,200,350])
  add('pct_and_eff','eff'+e,p,dd,({index,priorDd})=>
   regimes[index].historyReady&&regimes[index].atrPercentile250<p&&regimes[index].efficiency10>e&&priorDd<dd);
for(const p of [.35,.4,.45])for(const e of [.45,.55,.65])
 for(const dd of [75,150,250])
  add('pct_or_eff','eff'+e,p,dd,({index,priorDd})=>
   regimes[index].historyReady&&(regimes[index].atrPercentile250<p||regimes[index].efficiency10>e)&&priorDd<dd);
const original=oneLot(),origNet=round(original.rows.reduce((a,x)=>a+x.pnl,0));
assert.equal(origNet,29657);assert.equal(original.minuteDD,806);
function runRule(t,signal=original,{fee=2.5,safety=reserve,circuit=0,slip=0}={}){
 return replaySizedTape(prepared.sessions,bars,signal,{maxLots:2,fee,
  sizeAtOpen:(c)=>{
   const capacity=Math.max(0,Math.min(2,Math.floor((capital+multiplier*c.priorEquity-safety)/margin)));
   const desired=t?.fn(c)?2:1;
   return Math.min(capacity,desired);
  },drawdownCircuit:circuit,haltSessions:8,riskExitExtraSlip:slip});
}
const ref={name:'ONE_TX',family:'reference',fn:()=>false};
const refRun=runRule(ref),annual=(v)=>Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[
 y,round(v.rows.filter(r=>r.date.startsWith(String(y))).reduce((a,r)=>a+r.pnl,0))]));
assert.equal(refRun.net,29657);assert.equal(refRun.minuteDD,806);
const unit=annual(refRun);
function measure(run,t,extra={}){
 const years=annual(run);
 return {name:t.name,family:t.family,rule:t.rule,gate:t.gate,threshold:t.threshold,
 net:run.net,dd:run.minuteDD,ratio:round(run.net/run.minuteDD),
 annual:years,delta:Object.fromEntries(Object.keys(years).map(y=>[y,round(years[y]-unit[y])])),
 extraRequestedSessions:run.rows.filter(r=>r.requestedLots===2).length,
 extraHeldSessions:run.rows.filter(r=>Math.abs(r.endingLots)===2).length,
 tradedContracts:run.tradedContracts,rebalanceLots:run.rebalanceLots,stops:run.stopEvents,...extra};
}
const tested=[];
for(let i=0;i<tests.length;i++){
 const t=tests[i],v=runRule(t);
 const metric=measure(v,t);tested.push(metric);
 if(i%40===0)console.log('R26_PCT_EFF_NEIGHBOR_PROGRESS',i,tests.length,metric.name,metric.net,metric.dd);
}
const select=x=>x.dd<=1000&&x.net>unit[2021]+unit[2022]+unit[2023]+unit[2024]+unit[2025]+unit[2026]&&x.extraHeldSessions>=15;
const rankRatio=x=>x.sort((a,b)=>b.ratio-a.ratio||b.net-a.net);
const rankNet=x=>x.sort((a,b)=>b.net-a.net||a.dd-b.dd);
const eligible=tested.filter(select);
const robustYear=tested.filter(x=>x.dd<=1000&&
 x.delta[2024]>0&&x.delta[2025]>0&&x.delta[2026]>0&&x.extraHeldSessions>=15);
const allAfter2021=tested.filter(x=>x.dd<=1000&&[2022,2023,2024,2025,2026].every(y=>x.delta[y]>0));
const plateauPct=tested.filter(x=>x.family==='pct'&&x.threshold===100)
 .sort((a,b)=>a.gate-b.gate);
const plateauEff=tested.filter(x=>x.family==='eff'&&x.threshold===350)
 .sort((a,b)=>a.gate-b.gate);
const pointPct=tested.find(x=>x.family==='pct'&&x.gate===.4&&x.threshold===100);
const pointEff=tested.find(x=>x.family==='eff'&&x.gate===.55&&x.threshold===350);
assert.equal(pointPct.net,31652);assert.equal(pointPct.dd,806);
assert.equal(pointEff.net,34025);assert.equal(pointEff.dd,982.5);
const selectedNames=[...new Set([
 ...rankRatio([...robustYear]).slice(0,10).map(x=>x.name),
 ...rankNet([...robustYear]).slice(0,5).map(x=>x.name),
 ...rankRatio([...eligible]).slice(0,8).map(x=>x.name),
 ...rankRatio([...allAfter2021]).slice(0,8).map(x=>x.name),
 pointPct.name,pointEff.name
])];
const candidates=selectedNames.map(name=>tests.find(x=>x.name===name));
const stress=[];
for(const [scenario,fee,entrySlippage,riskSlippage,circuit,slip,safety] of [
 ['base',2.5,0,0,0,0,300_000],
 ['higher',5,5,75,1000,50,300_000],
 ['severe',5,10,100,1000,75,300_000],
 ['largerCashBuffer',2.5,0,0,1000,0,500_000]
]){
 const tape=scenario==='base'||scenario==='largerCashBuffer'?original:oneLot({fee,entrySlippage,riskSlippage});
 const sanity=runRule(ref,tape,{fee,safety,circuit,slip});
 assert.equal(sanity.net,round(tape.rows.reduce((a,x)=>a+x.pnl,0)),'FEE_NET_BROKEN_'+scenario);
 assert.equal(sanity.minuteDD,tape.minuteDD,'FEE_DD_BROKEN_'+scenario);
 for(const t of candidates){
  const result=runRule(t,tape,{fee,safety,circuit,slip});
  stress.push(measure(result,t,{scenario,fee,entrySlippage,riskSlippage,circuit,slip,safety}));
 }
}
const robustHigh=rankRatio(stress.filter(x=>x.scenario==='higher'&&x.dd<=1000));
const strongest=rankRatio([...robustYear]).slice(0,25);
const study={
 timestamp:new Date().toISOString(),endDate:'2026-11-11',tests:tests.length,
 capital,moneyPerPoint:multiplier,marginPerTX:margin,reserve,
 baseline:measure(refRun,ref),tested,positive2024to2026:robustYear.length,
 positiveEachYear2022to2026:allAfter2021.length,
 bestCrossYear:strongest,bestScore:rankRatio([...eligible]).slice(0,25),
 bestNet:rankNet([...eligible]).slice(0,25),
 pctlPerturbation:plateauPct,effPerturbation:plateauEff,
 stress,robustHigh:robustHigh.slice(0,20),
 caution:['Period 2021-2026 previously viewed, not truly unseen; many parameter combinations (snooping).',
  'Historical account capacity modeled at fixed 2026 TX margin; actual past margin changes, broker fees/partial fills not simulated.',
  'All position changes at session OPEN or matching frozen R26 events, not using same-session future candles for sizing.',
  'Risk circuit fills are synthetic minute OHLC and can gap; historical DD <=1000 not a guarantee.',
  'Reserve 300000 NTD, max 2 TX, initial capital 2000000, PNL cash=TX-equivalent points * 200.',
  'No modification to live R26, research-only.']
};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-percentile-efficiency-stability.json',JSON.stringify(study,null,2));
fs.writeFileSync('r26-study-output/r26-percentile-efficiency-stability.csv',
 'name,family,gate,ddThreshold,net,maxDD,ratio,extraHeld,2022,2023,2024,2025,2026,delta2024,delta2025,delta2026\n'+
 tested.map(x=>[x.name,x.family,x.gate,x.threshold,x.net,x.dd,x.ratio,x.extraHeldSessions,
 ...[2022,2023,2024,2025,2026].map(y=>x.annual[y]),... [2024,2025,2026].map(y=>x.delta[y])].join(',')).join('\n'));
console.log('R26_PCT_EFF_STABILITY_RESULTS',JSON.stringify({
 n:tests.length,positive2024to2026:robustYear.length,allYearsPositive:allAfter2021.length,
 baseline:study.baseline,pointPct,pointEff,
 pctNeighborhood:plateauPct,effNeighborhood:plateauEff,
 bestCrossYear:strongest.slice(0,17),bestScore:study.bestScore.slice(0,15),
 highCost:robustHigh.slice(0,14)}));
