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














const rg=priorDailyRegimes(prepared.sessions),round=x=>Math.round(x*100)/100;
const flags=regimeFlags(rg,r=>
 (r.atrSlope20<=-.25&&r.features?.mom5>2)||
 (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
 (r.efficiency10>.8&&r.features?.mom5>1.5)||
 (r.efficiency20>=.8&&r.upDays10>=.5));
function frozenSignal({fee=2.5,entrySlip=0,riskSlip=0}={}){
 return simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee,
  risk:{preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
   highVolLongRescueFlags:flags,equityDdCap:800,cooldownReset:true,haltSessions:8,
   resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
   hardStopSlippagePoints:riskSlip,
   coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3}},
  limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,entryWindow:30,
   onlySide:-1,breakoutSlippagePoints:entrySlip}});
}
const c2026={initial:2_000_000,initialMargin:701_000,buffer:300_000,pointValue:200};
function lotPolicy(percentile,ddLimit,buffer=300_000){
 return ({index,priorEquity,priorDd})=>{
  const equity=c2026.initial+c2026.pointValue*priorEquity;
  const capacity=Math.max(0,Math.min(2,Math.floor((equity-buffer)/c2026.initialMargin)));
  const more=rg[index].historyReady&&rg[index].atrPercentile250<percentile&&priorDd<ddLimit;
  return Math.min(capacity,more?2:1);
 };
}
const signal=frozenSignal();
const paramSets=[];
for(const percentile of [.3,.325,.35,.375,.4,.425,.45,.475,.5])
 for(const ddLimit of [75,100,125,150,175,200]){
  paramSets.push({percentile,ddLimit,name:'P'+percentile+'_DD'+ddLimit});
 }
const raw1=()=>1;
function evaluate(sig,fee,choice,{portfolioCap=0,portfolioSlip=0,reserve=c2026.buffer}={}){
 return replaySizedTape(prepared.sessions,bars,sig,{maxLots:2,fee,
   sizeAtOpen:choice?lotPolicy(choice.percentile,choice.ddLimit,reserve):raw1,
   drawdownCircuit:portfolioCap,riskExitExtraSlip:portfolioSlip,haltSessions:8});
}
function yearly(x){
 return Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[
  y,round(x.rows.filter(z=>z.date.startsWith(String(y))).reduce((a,z)=>a+z.pnl,0))]));
}
function report(x,baseline,cfg,scenario='normal'){
 const annual=yearly(x),anchor=yearly(baseline);
 return {name:cfg?.name||'FIXED_1',p:cfg?.percentile,ddLimit:cfg?.ddLimit,scenario,
  net:x.net,dd:x.minuteDD,ratio:round(x.net/x.minuteDD),
  deltaNet:round(x.net-baseline.net),
  extraSessions:x.rows.filter(z=>z.requestedLots===2).length,
  actuallyTwo:x.rows.filter(z=>Math.abs(z.endingLots)===2).length,
  annual,delta:Object.fromEntries(Object.keys(annual).map(y=>[y,round(annual[y]-anchor[y])])),
  contracts:x.tradedContracts,portfolioStops:x.stopEvents,portfolioResets:x.riskEpochResets};
}
const anchor=evaluate(signal,2.5,null);assert.equal(anchor.net,29657);
assert.equal(anchor.minuteDD,806);
const studies=[];
for(let i=0;i<paramSets.length;i++){
 const cfg=paramSets[i],x=evaluate(signal,2.5,cfg);
 studies.push(report(x,anchor,cfg));
}
const known=studies.find(x=>x.p===.35&&x.ddLimit===150);
assert.equal(known.net,33121);assert.equal(known.dd,806);
const comparable=studies.filter(x=>x.dd<=1000&&x.net>=30000);
const ratioSort=a=>a.sort((x,y)=>y.ratio-x.ratio||y.net-x.net);
const yearEach=ratioSort(comparable.filter(x=>
 [2022,2023,2024,2025,2026].every(y=>x.delta[y]>0)));
const topRatio=ratioSort([...comparable]);
const local=studies.filter(x=>[.325,.35,.375,.4].includes(x.p)&&[125,150,175].includes(x.ddLimit));
const shockCases=[
 {name:'base',fee:2.5,entrySlip:0,riskSlip:0,portfolioSlip:0},
 {name:'small',fee:3,entrySlip:2,riskSlip:30,portfolioSlip:15},
 {name:'high',fee:5,entrySlip:5,riskSlip:75,portfolioSlip:50},
 {name:'severe',fee:5,entrySlip:10,riskSlip:100,portfolioSlip:75}
];
const finalNames=[known.name,...topRatio.slice(0,6).map(x=>x.name),...yearEach.slice(0,6).map(x=>x.name)];
const shortlisted=[...new Set(finalNames)].map(name=>paramSets.find(x=>x.name===name));
const stresses=[];
for(const c of shockCases){
 const reSignal=c.name==='base'?signal:frozenSignal(c);
 const ref=evaluate(reSignal,c.fee,null);
 assert.equal(ref.net,round(reSignal.rows.reduce((a,z)=>a+z.pnl,0)));
 assert.equal(ref.minuteDD,reSignal.minuteDD);
 for(const cfg of shortlisted){
  for(const [portfolioCap,reserve] of [[0,300_000],[1000,300_000],[1000,500_000]]){
   const x=evaluate(reSignal,c.fee,cfg,{
    portfolioCap,portfolioSlip:c.portfolioSlip,reserve});
   stresses.push({...report(x,ref,cfg,c.name),fee:c.fee,entrySlip:c.entrySlip,
    riskSlip:c.riskSlip,portfolioCap,portfolioSlip:c.portfolioSlip,reserve});
  }
 }
}
const stressTarget=stresses.filter(x=>x.name===known.name&&x.reserve===300_000);
const stressRealistic=ratioSort(stresses.filter(x=>x.scenario==='high'&&x.portfolioCap===1000&&x.reserve===300_000&&x.dd<=1000));
assert.ok(stresses.filter(x=>x.portfolioCap===1000).every(x=>x.portfolioResets<=x.portfolioStops),'RISK_EPOCH_MISMATCH');
for(const cfg of shortlisted){
 const plain=stresses.find(x=>x.name===cfg.name&&x.scenario==='base'&&x.portfolioCap===0&&x.reserve===300000);
 const capped=stresses.find(x=>x.name===cfg.name&&x.scenario==='base'&&x.portfolioCap===1000&&x.reserve===300000);
 assert.equal(capped.net,plain.net,'BASE_1K_NO_RISK_STOP '+cfg.name);
 assert.equal(capped.dd,plain.dd,'BASE_1K_DD_MATCH '+cfg.name);
}
const study={
 generatedAt:new Date().toISOString(),n:paramSets.length,source:'R26 fixed one-lot signals 2021-10-22 through 2026-11-11, 2452 TX sessions',
 settings:c2026,reference:report(anchor,anchor,null),
 best:topRatio.slice(0,20),positiveEachYear:yearEach.slice(0,20),
 neighborhood:local,stressTarget,stressRealistic:stressRealistic.slice(0,20),
 stresses,all:studies,
 cautions:['R26 paper historical 1m OHLC fills, no realistic queue, guarantee or portfolio liquidation against actual broker marks',
  'All parameters selected on data repeatedly inspected including 2026; not a pristine walk-forward or unseen evaluation.',
  'Margin value from current TAIFEX display 701000 NTD, used as historical FIXED capacity approximation; actual daily margins varied.',
  'Initial cash2000000 + NET POINTS*200 must support contract initial margin plus reserve at the start of each session.',
  'More trades alter fee, model underlying R26 rerun under changed fee and slippage before sizing.',
  'Cannot claim future DD <=1000, even if model did. No live website changes.']
};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-pctl35-margin-stress-audit.json',JSON.stringify(study,null,2));
fs.writeFileSync('r26-study-output/r26-pctl35-margin-stress-audit.csv',
 'name,p,ddLimit,net,dd,ratio,deltaNet,2lotSessions,d2022,d2023,d2024,d2025,d2026\n'+
 studies.map(x=>[x.name,x.p,x.ddLimit,x.net,x.dd,x.ratio,x.deltaNet,x.actuallyTwo,
 ...[2022,2023,2024,2025,2026].map(y=>x.delta[y])].join(',')).join('\n'));
console.log('R26_PCTL35_FINAL_AUDIT',JSON.stringify({
 n:paramSets.length,baseline:study.reference,known,yearPositiveCount:yearEach.length,
 best:topRatio.slice(0,14),crossYear:yearEach.slice(0,14),
 neighborhood:local,stressTarget,
 stressRealistic:stressRealistic.slice(0,12),
 correctedCircuitCases:stresses.filter(x=>x.portfolioCap===1000&&x.portfolioStops>0).slice(0,16)}));
