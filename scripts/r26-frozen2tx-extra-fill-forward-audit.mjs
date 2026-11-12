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















const regs=priorDailyRegimes(prepared.sessions);
const good=regimeFlags(regs,r=>
 (r.atrSlope20<=-.25&&r.features?.mom5>2)||
 (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
 (r.efficiency10>.8&&r.features?.mom5>1.5)||
 (r.efficiency20>=.8&&r.upDays10>=.5));
const W={capital:2_000_000,margin:701_000,reserve:300_000,mult:200};
const round=n=>Math.round(n*100)/100;
function makeSignal({fee=2.5,entry=0,riskSlip=0}={}){
 return simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee,
 risk:{preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
 highVolLongRescueFlags:good,equityDdCap:800,cooldownReset:true,haltSessions:8,
 resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
 hardStopSlippagePoints:riskSlip,
 coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3}},
 limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,entryWindow:30,
 onlySide:-1,breakoutSlippagePoints:entry}});
}
const plan={pct:.35,dd:100};
const historical=makeSignal();
function simulateSized(signal,params={},{one=false,disableMonth=null,disableYear=null,extraSlip=0,marginGuard=true}={}){
 const p=params.pct??plan.pct,d=params.dd??plan.dd;
 return replaySizedTape(prepared.sessions,bars,signal,{
 fee:params.fee??2.5,maxLots:2,additionalLotSlippagePerSide:extraSlip,
 marginGuard:marginGuard?{initialCapitalNTD:W.capital,perLotMarginNTD:W.margin,
  reserveNTD:W.reserve,pointValueNTD:W.mult}:null,
 sizeAtOpen:({index,s,priorEquity,priorDd})=>{
  const allowed=Math.max(0,Math.min(2,Math.floor((W.capital+priorEquity*W.mult-W.reserve)/W.margin)));
  const add=!one&&(!disableMonth||!s.date.startsWith(disableMonth))&&
   (!disableYear||!s.date.startsWith(disableYear))&&
   regs[index].historyReady&&regs[index].atrPercentile250<p&&priorDd<d;
  return Math.min(allowed,add?2:1);
 }});
}
function partitions(x){
 const out={};for(const y of [2021,2022,2023,2024,2025,2026])
  out[y]=round(x.rows.filter(r=>r.date.startsWith(String(y))).reduce((a,r)=>a+r.pnl,0));
 return out;
}
const baseOne=simulateSized(historical,{}, {one:true});
assert.equal(baseOne.net,29657);assert.equal(baseOne.minuteDD,806);
const p2=simulateSized(historical);
assert.equal(p2.net,32001);assert.equal(p2.minuteDD,806);
const orig1=baseOne,orig2=p2;
const pairs=p2.rows.map((r,i)=>{
 const a=baseOne.rows[i];
 assert.equal(r.date,a.date);assert.equal(r.sid,a.sid);
 return {date:r.date,sid:r.sid,delta:round(r.pnl-a.pnl),base:a.pnl,enhanced:r.pnl,
  two:r.requestedLots===2,actuallyTwo:Math.abs(r.endingLots)===2};
});
const buckets=new Map();
for(const r of pairs){
 const month=r.date.slice(0,7);
 if(!buckets.has(month))buckets.set(month,{month,delta:0,gain:0,loss:0,changed:0,extraRequested:0});
 const a=buckets.get(month);
 a.delta+=r.delta;a.gain+=Math.max(0,r.delta);a.loss+=Math.min(0,r.delta);
 if(Math.abs(r.delta)>1e-8)a.changed++;
 if(r.two)a.extraRequested++;
}
const months=[...buckets.values()].map(x=>({...x,delta:round(x.delta),
 gain:round(x.gain),loss:round(x.loss)}));
const positive=[...months].filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta);
const negatives=[...months].filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta);
const gains=pairs.filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta);
const losses=pairs.filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta);
const nGain=gains.reduce((a,r)=>a+r.delta,0);
const nLoss=losses.reduce((a,r)=>a+r.delta,0);
const features={pct:.35,dd:100,needed:rg=>rg.historyReady,preopen:true};
const embargo=[...positive.slice(0,7),...negatives.slice(0,4)].map(x=>{
 const v=simulateSized(historical,{}, {disableMonth:x.month});
 return {month:x.month,removeActualDelta:round(p2.net-v.net),net:v.net,dd:v.minuteDD,
  ratio:round(v.net/v.minuteDD)};
});
const forbidden=[];
for(const y of [2022,2023,2024,2025,2026]){
 const v=simulateSized(historical,{}, {disableYear:String(y)});
 forbidden.push({year:y,profitLost:round(p2.net-v.net),net:v.net,dd:v.minuteDD});
}
const feeVariants=[];
for(const [sc,fee,entry,riskSlip] of [
 ['baseline',2.5,0,0],['medium',3,2,30],
 ['high',5,5,75],['severe',5,10,100]
]){
 const signal=sc==='baseline'?historical:makeSignal({fee,entry,riskSlip});
 const single=simulateSized(signal,{fee},{one:true});
 assert.equal(round(signal.rows.reduce((a,r)=>a+r.pnl,0)),single.net,'ONE_LOT_SIGNAL_FULL_PARITY');
 assert.equal(signal.minuteDD,single.minuteDD,'ONE_LOT_SIGNAL_MDD_PARITY');
 for(const extraSlip of [0,1,2,3,5,8,10,15,20]){
  const more=simulateSized(signal,{fee},{extraSlip});
  const diff=round(more.net-single.net);
  feeVariants.push({scenario:sc,fee,extraSlip,net:more.net,dd:more.minuteDD,
   ratio:round(more.net/more.minuteDD),
   singleNet:single.net,singleDd:single.minuteDD,deltaFromSingle:diff,
   extraSides:more.extraSlippageLotSides,
   extraSlipCost:more.extraSlippageCostPoints,
   afterGapForcedReduced:more.gapMarginReductions,
   years:partitions(more)});
 }
}
const baseNoMargin=simulateSized(historical,{}, {marginGuard:false});
const report={
 dateEnd:'2026-11-11',system:'R26 previously frozen 1TX core, conditional second TX',
 candidate:{pct:plan.pct,dd:plan.dd,initial:W.capital,perContractMargin:W.margin,reserve:W.reserve},
 original:{net:orig1.net,dd:orig1.minuteDD,years:partitions(orig1)},
 base2:{net:orig2.net,dd:orig2.minuteDD,years:partitions(orig2)},
 incrementalNet:round(orig2.net-orig1.net),
 positiveSessions:gains.length,negativeSessions:losses.length,
 totalPositiveDelta:round(nGain),totalNegativeDelta:round(nLoss),
 top1PositiveShareOfTotalGain:round(100*(gains[0]?.delta??0)/Math.max(1,nGain)),
 top5PositiveShareOfTotalGain:round(100*gains.slice(0,5).reduce((a,r)=>a+r.delta,0)/Math.max(1,nGain)),
 top3MonthsShareOfTotalPositive:round(100*positive.slice(0,3).reduce((a,r)=>a+r.delta,0)/
  Math.max(1,positive.reduce((a,r)=>a+r.delta,0))),
 topGainSessions:gains.slice(0,20),topLossSessions:losses.slice(0,20),
 topGainMonths:positive.slice(0,15),topLossMonths:negatives.slice(0,15),
 actualLeaveMonthOut:embargo,leaveYearOut:forbidden,
 feeVariants,
 withMargin: {maxLots:Math.max(...orig2.rows.map(r=>Math.abs(r.endingLots))),
   extraSides:orig2.extraSlippageLotSides,forcedGapReducers:orig2.gapMarginReductions},
 noPostGapMargin:{net:baseNoMargin.net,dd:baseNoMargin.minuteDD},
 warnings:['No fresh 2026-11-12 full session in this frozen dataset; 2026 sample was reused in prior optimization',
  '2021-26 sample selected historical param 35%/DD100: overfit risk even if annual increments positive',
  'Explicit additional per-extra-contract exchange-fill adverse slippage, charged at EACH contract side including rollover',
  'Gap cash requirements verified after observed session OPEN, with 300k cash buffer. Broker actual margins vary.',
  'Month/year ablation is AFTER-THE-FACT DIAGNOSTIC, never a live oracle or causal trading filter.',
  'Cumulative DD mark-to-market at 1-min close with model stops; 1m OHLC cannot prove actual order fills',
  'No live website or real order management modified']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-frozen2tx-forward-audit.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-frozen2tx-forward-audit.csv',
 'scenario,extraSlip,net,dd,ratio,singleNet,singleDD,delta,extraSides,extraSlipCost,marginReductions\n'+
 feeVariants.map(x=>[x.scenario,x.extraSlip,x.net,x.dd,x.ratio,x.singleNet,x.singleDd,
 x.deltaFromSingle,x.extraSides,x.extraSlipCost,x.afterGapForcedReduced].join(',')).join('\n'));
fs.writeFileSync('r26-study-output/r26-frozen2tx-monthly-attribution.csv',
 'month,delta,grossGain,grossLoss,changedSessions,requestedExtra\n'+
 months.map(x=>[x.month,x.delta,x.gain,x.loss,x.changed,x.extraRequested].join(',')).join('\n'));
console.log('R26_FROZEN_2TX_AUDIT_SUMMARY',JSON.stringify({
 baseline:{net:orig1.net,dd:orig1.minuteDD},two:{net:orig2.net,dd:orig2.minuteDD},
 additional:report.incrementalNet,nonzero:{profitSessions:gains.length,lossSessions:losses.length,
  grossProfit:round(nGain),grossLoss:round(nLoss)},
 gainConcentration:{top1:report.top1PositiveShareOfTotalGain,
  top5:report.top5PositiveShareOfTotalGain,top3PositiveMonths:report.top3MonthsShareOfTotalPositive},
 topGainMonths:report.topGainMonths.slice(0,8),
 topLossMonths:report.topLossMonths.slice(0,8),
 worstMonthRemoved:embargo.slice(0,8),
 heldMarginGuard:report.withMargin,withoutGapCheck:report.noPostGapMargin,
 extraFees:feeVariants.filter(x=>(x.scenario==='baseline'||x.scenario==='high'||x.scenario==='severe')&&
 [0,2,5,10,15].includes(x.extraSlip)).map(x=>({
  scenario:x.scenario,extraSlip:x.extraSlip,net:x.net,dd:x.dd,ratio:x.ratio,
  deltaFromSingle:x.deltaFromSingle,extraSides:x.extraSides,
  postGapRescues:x.afterGapForcedReduced}))
}));
