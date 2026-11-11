// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {simulateLimit} from '../public/r26-research/open-limit-orders.mjs';
import {simulateLimitRisk} from '../public/r26-research/combined-breakout-risk.mjs';
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


const rounding=x=>Math.round(x*100)/100;
const total=r=>r.rows.reduce((a,x)=>a+x.pnl,0);
const assertRows=(lhs,rhs,label)=>{
 assert.equal(lhs.rows.length,rhs.rows.length,label+' sessions');
 assert.equal(lhs.minuteDD,rhs.minuteDD,label+' minute equity DD');
 assert.equal(rounding(total(lhs)),rounding(total(rhs)),label+' total NET');
 for(let i=0;i<lhs.rows.length;i++)for(const field of ['date','sid','pnl','held','signal','stop','target','recovered','startPos']){
  assert.deepEqual(lhs.rows[i][field],rhs.rows[i][field],label+' session '+i+' field '+field);
 }
};
const noOverlay=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11'});
const original=simulateLimit(prepared.sessions,bars,{end:'2026-11-11'});
assertRows(noOverlay,original,'Riskless combined BASELINE parity');
assertRows(noOverlay,prepared,'R26 CANONICAL parity');
const originalRiskShadow=prepared.pnls;
function riskOptions(cap=0,wait=8,lookback=8,minShadow=0){
 return cap?{equityDdCap:cap,cooldownReset:true,haltSessions:wait,
  resumeShadowLookback:lookback,resumeShadowProfit:minShadow,shadowPnl:originalRiskShadow}:{};
}
const breakout=(atr,window,filter={})=>atr?{anchor:'priorClose',entryMode:'breakout',entryATR:atr,entryWindow:window,exitATR:0,...filter}:{};
for(const [cap,wantNet,wantDD] of [[2250,64184,2650],[2500,66561,2900]]){
 const v=researchSimulate(prepared.sessions,bars,{end:'2026-11-11',risk:riskOptions(cap)});
 const combined=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',risk:riskOptions(cap)});
 assertRows(combined,v,'Risk-only '+cap+' strict parity');
 assert.equal(rounding(total(combined)),wantNet,'Frozen risk cap '+cap+' historical result');
 assert.equal(combined.minuteDD,wantDD,'Frozen risk cap '+cap+' minute DD');
 assert.deepEqual(combined.riskTimeline.map(x=>[x.date,x.sid,x.bar,x.type]),
  v.riskTimeline.map(x=>[x.date,x.sid,x.bar,x.type]),
  'risk cap '+cap+' event timeline parity');
}
for(const [atr,window] of [[.05,120],[.1,120],[.1,840],[.15,840]]){
 const l=breakout(atr,window);
 const independent=simulateLimit(prepared.sessions,bars,{end:'2026-11-11',limit:l});
 const combined=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',limit:l});
 assertRows(combined,independent,'Breakout-only '+atr+' '+window+' strict parity');
}
console.log('R26_COMBINED_ZERO_DIFF',JSON.stringify({sessions:original.rows.length,
 baselineNet:rounding(total(original)),dd:original.minuteDD,prevResearchRisk:[
 {cap:2250,net:64184,dd:2650},{cap:2500,net:66561,dd:2900}],
  originalTrades:original.closedTrades.length}));
function part(res,from,to){
 const rows=res.rows.filter(x=>x.date>=from&&x.date<=to);
 const trades=res.closedTrades.filter(t=>t.exitDate>=from&&t.exitDate<=to);
 let pnl=0,peak=0,mdd=0;
 for(const x of rows){pnl+=x.pnl;peak=Math.max(pnl,peak);mdd=Math.max(0,peak-pnl,mdd)}
 return {net:rounding(pnl),sessionCloseDd:rounding(mdd),trades:trades.length,
   winPct:rounding(100*trades.filter(t=>t.pnl>0).length/(trades.length||1))};
}
function summarize(res,cfg){
 const trades=res.closedTrades;
 return {id:cfg.id,atr:cfg.atr,window:cfg.window,cap:cfg.cap,wait:cfg.wait,shadowLookback:cfg.shadowLookback,shadowProfit:cfg.shadowProfit,
  net:rounding(total(res)),minuteDD:rounding(res.minuteDD),
  trades:trades.length,winPct:rounding(100*trades.filter(t=>t.pnl>0).length/(trades.length||1)),
  entryEligible:res.eligibleEntries,entryFilled:res.limitEntries,
  entryFilledPct:res.eligibleEntries?rounding(res.limitEntries/res.eligibleEntries*100):null,
  entryMissed:res.missEntry,haltCount:res.hardStops,skipSessions:res.skippedSessions,resetCount:res.resetCount,
  training:part(res,'2021-10-22','2023-12-31'),
  validation:part(res,'2024-01-01','2025-12-31'),
  holdout:part(res,'2026-01-01','2026-11-11'),
  last24:part(res,'2026-10-27','2026-11-11'),
  events:(res.riskTimeline||[]).map(e=>({type:e.type,date:e.date,sid:e.sid,bar:e.bar,cap:e.cap,actual:e.actual}))};
}
const scenarios=[
 {id:'R26_ORIGINAL',atr:0,window:0,cap:0,wait:8,shadowLookback:8,shadowProfit:0},
 {id:'R26_RISK_2250',atr:0,window:0,cap:2250,wait:8,shadowLookback:8,shadowProfit:0},
 {id:'R26_RISK_2500',atr:0,window:0,cap:2500,wait:8,shadowLookback:8,shadowProfit:0}
];
const ats=[0.025,0.05,0.075,0.1,0.15,0.2,0.25],windows=[30,60,120,300,840],caps=[0,2250,2500,2750,3000];
for(const atr of ats)for(const window of windows)for(const cap of caps){
 scenarios.push({id:'BREAKOUT_'+atr+'_W'+window+'_C'+cap,atr,window,cap,wait:8,shadowLookback:8,shadowProfit:0});
}
for(const atr of [.05,.075,.1,.15])for(const window of [120,300,840])for(const cap of [2250,2500]){
 for(const wait of [5,12])scenarios.push({id:'BREAKOUT_'+atr+'_W'+window+'_C'+cap+'_WAIT'+wait,
  atr,window,cap,wait,shadowLookback:8,shadowProfit:0});
 for(const shadowProfit of [100,300])scenarios.push({id:'BREAKOUT_'+atr+'_W'+window+'_C'+cap+'_SHADOW'+shadowProfit,
  atr,window,cap,wait:8,shadowLookback:8,shadowProfit});
}
// Regime-selective breakout, strictly pre-open: other core signals execute
// immediately at OPEN as in unchanged R26. No intrabar future-data filters.
for(const cap of [2250,2500,2750]){
 for(const atr of [.025,.05,.075,.1]){
  for(const window of [60,120]){
   for(const side of [1,-1])
    scenarios.push({id:'SELECT_SIDE_'+side+'_A'+atr+'_W'+window+'_C'+cap,
     atr,window,cap,wait:8,shadowLookback:8,shadowProfit:0,filter:{onlySide:side}});
   for(const aMin of [250,400,600,800])
    scenarios.push({id:'SELECT_ATRMIN_'+aMin+'_A'+atr+'_W'+window+'_C'+cap,
     atr,window,cap,wait:8,shadowLookback:8,shadowProfit:0,filter:{atrMin:aMin}});
   for(const aMax of [350,550,800])
    scenarios.push({id:'SELECT_ATRMAX_'+aMax+'_A'+atr+'_W'+window+'_C'+cap,
     atr,window,cap,wait:8,shadowLookback:8,shadowProfit:0,filter:{atrMax:aMax}});
   for(const ddMin of [250,500,1000,1500])
    scenarios.push({id:'SELECT_PREV_DD_'+ddMin+'_A'+atr+'_W'+window+'_C'+cap,
     atr,window,cap,wait:8,shadowLookback:8,shadowProfit:0,filter:{ddMin}});
  }
 }
}
const results=[];
for(let i=0;i<scenarios.length;i++){
 const cfg=scenarios[i];
 const sim=i===0?original:simulateLimitRisk(prepared.sessions,bars,{
  fee:2.5,end:'2026-11-11',limit:breakout(cfg.atr,cfg.window,cfg.filter||{}),
  risk:riskOptions(cfg.cap,cfg.wait,cfg.shadowLookback,cfg.shadowProfit)
 });
 const metric=summarize(sim,cfg);
 if(!Number.isFinite(metric.net)||!Number.isFinite(metric.minuteDD))throw Error('Bad output '+cfg.id);
 results.push(metric);
 if(i%25===0)console.log('R26_COMBO_PROGRESS',i,'/',scenarios.length,metric.id,metric.net,metric.minuteDD);
}
const base=results[0];
const filter=results.filter(x=>x.id!=='R26_ORIGINAL'&&x.training.net>=base.training.net*.75
 &&x.validation.net>=base.validation.net*.75&&x.holdout.net>=base.holdout.net*.5);
const byDrawdown=[...filter].sort((a,b)=>a.minuteDD-b.minuteDD||b.net-a.net);
const byRewardRisk=[...filter].sort((a,b)=>b.net/b.minuteDD-a.net/a.minuteDD);
const improvedBoth=filter.filter(x=>x.net>=base.net&&x.minuteDD<base.minuteDD);
const riskOnly2250=results.find(x=>x.id==='R26_RISK_2250');
const riskOnly2500=results.find(x=>x.id==='R26_RISK_2500');
const regimeCombos=filter.filter(x=>x.id.startsWith('SELECT_'));
const improvesRiskOnly=regimeCombos.filter(x=>
  (x.cap===2250&&x.net>=riskOnly2250.net&&x.minuteDD<=riskOnly2250.minuteDD)||
  (x.cap===2500&&x.net>=riskOnly2500.net&&x.minuteDD<=riskOnly2500.minuteDD))
 .sort((a,b)=>b.net-a.net||a.minuteDD-b.minuteDD);
const bestRegimeByRatio=[...regimeCombos].sort((a,b)=>b.net/b.minuteDD-a.net/a.minuteDD);

const byNet=[...filter].sort((a,b)=>b.net-a.net);
const byWins=[...filter].sort((a,b)=>b.winPct-a.winPct||b.net-a.net);
const referenceIds=[
 'R26_ORIGINAL','R26_RISK_2250','R26_RISK_2500',
 'BREAKOUT_0.05_W120_C0','BREAKOUT_0.1_W120_C0',
 'BREAKOUT_0.05_W120_C2250','BREAKOUT_0.05_W120_C2500',
 'BREAKOUT_0.1_W120_C2250','BREAKOUT_0.1_W120_C2500',
 'BREAKOUT_0.05_W840_C2250','BREAKOUT_0.1_W840_C2250'
];
const selected=referenceIds.map(id=>results.find(x=>x.id===id)).filter(Boolean);
const report={title:'R26 breakout premarket + prior-session shadow equity circuit',
 generated_at:new Date().toISOString(),originalGolden:2428,extraOfficialSessions:expected.length,
 extraOfficialMinutes:more.length/4,lastOfficial:'2026-11-11',
 caution:[
  'Historical-only: 2026 has already been inspected, not a pristine forward OOS',
  'Past-only completed session close + ATR sets breakout trigger; adverse gaps fill at OPEN',
  'Risk high-water computed only from past completed minutes; hard-stop does not guarantee fill',
  'On stopped month rolls or missing prior close, no new breakout, not fabricated',
  'Core market exits remain original; limit applies to new core entries only',
  'Only one TX, each side costs 2.5 points',
  'Risk gate combines previous shadow paper sessions and an intraday equity circuit',
  'No model may replace live R26 until further external fill and broker-position tests'],
 comparison: selected,sortDrawdown:byDrawdown.slice(0,20),
 sortRewardRisk:byRewardRisk.slice(0,20),
 sortNet:byNet.slice(0,20),sortWin:byWins.slice(0,15),
 bestRegime:bestRegimeByRatio.slice(0,20),beatsRiskOnly:improvesRiskOnly,
 outperformBoth:improvedBoth.sort((a,b)=>a.minuteDD-b.minuteDD).slice(0,25),
 configurations:scenarios.length,qualified:filter.length,results};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-combined-breakout-risk.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-combined-breakout-risk.csv',
 'id,atr,window,cap,net,minuteDD,tradeWinPct,trades,entryFillPct,stopCount,trainNet,validationNet,holdoutNet,last24Net\n'+
 results.map(x=>[x.id,x.atr,x.window,x.cap,x.net,x.minuteDD,x.winPct,x.trades,x.entryFilledPct,x.haltCount,
  x.training.net,x.validation.net,x.holdout.net,x.last24.net].join(',')).join('\n'));
console.log('R26_COMBO_REFERENCES',JSON.stringify(selected));
console.log('R26_COMBO_BEST_DD',JSON.stringify(byDrawdown.slice(0,12).map(x=>({id:x.id,net:x.net,dd:x.minuteDD,win:x.winPct,holdout:x.holdout.net}))));
console.log('R26_COMBO_BEST_NET_DD',JSON.stringify(byRewardRisk.slice(0,12).map(x=>({id:x.id,net:x.net,dd:x.minuteDD,win:x.winPct,holdout:x.holdout.net}))));
console.log('R26_COMBO_BEST_NET',JSON.stringify(byNet.slice(0,10).map(x=>({id:x.id,net:x.net,dd:x.minuteDD,win:x.winPct,holdout:x.holdout.net}))));
console.log('R26_COMBO_REGIME_BEST',JSON.stringify(bestRegimeByRatio.slice(0,12).map(x=>({id:x.id,net:x.net,dd:x.minuteDD,win:x.winPct,holdout:x.holdout.net,
 entryFill:x.entryFilledPct,skipped:x.skipSessions}))));
console.log('R26_COMBO_REGIME_BEATS_RISK_ONLY',JSON.stringify(improvesRiskOnly.slice(0,12).map(x=>({id:x.id,net:x.net,dd:x.minuteDD,win:x.winPct}))));
console.log('R26_COMBO_SUMMARY',JSON.stringify({tested:scenarios.length,qualified:filter.length,beatsBaselineNetAndDd:improvedBoth.length}));
