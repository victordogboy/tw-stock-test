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
const round=x=>Math.round(x*100)/100;
const isStrong=(s,n)=>s.features?.mom5>n&&s.features?.slope>0&&s.features?.rsi>50;
const signalStrength=s=>{
 const {mom5=0,mom10=0,slope=0,ratio=1,rsi=50}=s.features||{};
 return (s.signal>0?
   +(mom5>.5)+ +(mom5>1.5)+ +(mom10>2)+ +(slope>.2)+ +(rsi>55):
   +(mom5<0)+ +(mom10<-.5)+ +(slope<0)+ +(rsi<40)+ +(ratio>1));
};
const policy=[];
function add(name,select){policy.push({name,select});}
add('FIXED_1',()=>1);add('FIXED_2',()=>2);add('FIXED_3',()=>3);
add('FIXED_5',()=>5);
for(const budget of [300,400,500,600,700,800,1000,1200,1500])
 for(const factor of [.5,.75,1,1.25,1.5]){
  add('ATR_BUDGET'+budget+'_FACTOR'+factor,({s})=>
    Math.max(1,Math.min(5,Math.floor(budget/(Math.max(75,s.atr)*factor)))));
 }
for(const baseline of [1,2])
 for(const strongLots of [3,4,5])
  for(const strength of [2,3,4]){
   add('STRENGTH_BASE'+baseline+'_STRONG'+strongLots+'_AT'+strength,
    ({s})=>signalStrength(s)>=strength?strongLots:baseline);
  }
for(const max of [2,3,4,5])
 for(const n of [.25,.5,.75,1,1.5]){
  add('LOW_VOL_MAX'+max+'_ATR'+n,({s})=>
    Math.max(1,Math.min(max,Math.floor(150*n/Math.max(50,s.atr/2)))));
 }
for(const primary of [2,3,4,5]){
 for(const lower of [0,200,500,800]){
  add('EQUITY_BAND'+primary+'_REDUCE_DD'+lower,({priorDd})=>
    priorDd>lower?1:primary);
 }
}
for(const cutoff of [0,150,300,500]){
 for(const max of [3,4,5]){
  add('PREV5_PNL'+cutoff+'_MAX'+max,({frozenBaselinePrior})=>
   frozenBaselinePrior.slice(-5).reduce((a,b)=>a+b,0)>=cutoff?max:1);
 }
}
for(const max of [3,4,5]){
 for(const mid of [2,3]){
  for(const dd of [100,200,300]){
   add('SCORE_DD_MAX'+max+'_MID'+mid+'_PRIOR'+dd,({s,priorDd})=>{
    if(priorDd>dd)return 1;
    const x=signalStrength(s);
    return x>=4?max:x>=2?mid:1;
   });
  }
 }
}
for(const capAtr of [150,200,250,300]){
 for(const max of [3,4,5]){
  add('ATR_LOW_'+capAtr+'_MAX'+max,({s,priorDd})=>
    s.atr<capAtr&&priorDd<100?max:1);
 }
}
for(const ratio of [1,1.25,1.5,2]){
 for(const dd of [150,250,400]){
  add('ATR_DD_BUDGET_R'+ratio+'_D'+dd,({s,priorDd})=>
   Math.max(1,Math.min(5,Math.floor((1000-Math.min(800,priorDd)*ratio)/(Math.max(75,s.atr)*ratio)))));
 }
}
for(const max of [3,4,5])
 for(const direction of [-1,1])
  add('DIRECTION_'+direction+'_MAX'+max,({s})=>
    s.signal===direction?max:1);

const baselineRisk=(()=>{
 const rescue=regimeFlags(regs,r=>(r.atrSlope20<=-.25&&r.features?.mom5>2)||
   (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
   (r.efficiency10>.8&&r.features?.mom5>1.5)||
   (r.efficiency20>=.8&&r.upDays10>=.5));
 return {
   preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
   highVolLongRescueFlags:rescue,
   equityDdCap:800,cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
   resumeShadowProfit:0,shadowPnl:prepared.pnls,
   coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3}
 };
})();
const signal=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5,
 risk:baselineRisk,limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,entryWindow:30,onlySide:-1}});
const unitPnl=round(signal.rows.reduce((a,x)=>a+x.pnl,0));
assert.equal(unitPnl,29657);assert.equal(signal.minuteDD,806);
function replay(p,{fee=2.5,circuit=0,slip=0}={}){
 return replaySizedTape(prepared.sessions,bars,signal,{fee,maxLots:5,
  sizeAtOpen:p.select,drawdownCircuit:circuit,haltSessions:8,riskExitExtraSlip:slip});
}
const baseline=policy.find(x=>x.name==='FIXED_1'),fixed5=policy.find(x=>x.name==='FIXED_5');
const unit=replay(baseline),five=replay(fixed5);
assert.equal(unit.net,29657);assert.equal(unit.minuteDD,806);
assert.equal(five.net,29657*5);assert.equal(five.minuteDD,806*5);
console.log('R26_LOTS_GOLD',JSON.stringify({unit:{net:unit.net,dd:unit.minuteDD,ratio:unit.ratio},
 five:{net:five.net,dd:five.minuteDD,ratio:five.ratio},
 signatures:policy.length,sessions:unit.sessionCount}));
const runs=[];
const slices=(s)=>{
 const o={};for(const [name,start,end] of [['train','2021-10-22','2023-12-31'],
 ['validation','2024-01-01','2025-12-31'],['holdout','2026-01-01','2026-11-11']]){
  o[name]=round(s.rows.filter(r=>r.date>=start&&r.date<=end).reduce((a,r)=>a+r.pnl,0));
 }
 return o;
};
function summary(x,p,kind,extra={}){
 return {name:p.name,kind,net:x.net,dd:x.minuteDD,ratio:round(x.net/(x.minuteDD||1)),
  stopEvents:x.stopEvents,rebalanceLots:x.rebalanceLots,
  tradedContracts:x.tradedContracts,periods:slices(x),...extra};
}
for(let i=0;i<policy.length;i++){
 const p=policy[i],out=replay(p);
 runs.push(summary(out,p,'no_extra_circuit'));
 if(i%25===0)console.log('R26_LOTS_SIZING_PROGRESS',i,policy.length,p.name,out.net,out.minuteDD);
}
const eligible=runs.filter(x=>x.periods.train>=3000&&x.periods.validation>=4000&&x.periods.holdout>=1200&&x.dd>0);
const rank=a=>a.sort((x,y)=>y.ratio-x.ratio||y.net-x.net);
const bestRatio=rank([...eligible]).slice(0,25);
const bestDD=rank(eligible.filter(x=>x.dd<=1000)).slice(0,25);
const bestRatioWith5=bestRatio.filter(x=>x.ratio>unit.ratio);
const topNet=[...eligible].sort((x,y)=>y.net-x.net).slice(0,20);
const optionsForOverlay=[...new Set([...bestRatio.slice(0,12).map(x=>x.name),
 ...bestDD.slice(0,10).map(x=>x.name),
 ...topNet.slice(0,12).map(x=>x.name),
 'FIXED_1','FIXED_2','FIXED_3','FIXED_5'])];
const circuits=[];
for(const name of optionsForOverlay){
 const p=policy.find(x=>x.name===name);
 for(const cap of [700,850,1000,1200]){
  const v=replay(p,{circuit:cap});
  circuits.push(summary(v,p,'portfolio_circuit',{circuitCap:cap}));
 }
}
const conservative=[];
const shortlist=[...new Set([...bestRatio.slice(0,10).map(x=>x.name),
 ...bestDD.slice(0,10).map(x=>x.name),'FIXED_1','FIXED_5'])];
for(const name of shortlist){
 const p=policy.find(x=>x.name===name);
 for(const [fee,circuit,slip] of [[2.5,1000,0],[2.5,1000,50],[5,1000,50],[5,850,50]]){
  const v=replay(p,{fee,circuit,slip});
  conservative.push(summary(v,p,'portfolio_stress',{fee,circuitCap:circuit,extraCircuitSlip:slip}));
 }
}
const ratios=rank([...circuits]).slice(0,22);
const lowDD=rank(circuits.filter(x=>x.dd<=1000)).slice(0,22);
const ratioStress=rank(conservative.filter(x=>x.dd<=1000&&x.fee===5&&x.extraCircuitSlip===50)).slice(0,18);
const countAboveBaseline=runs.filter(x=>x.ratio>unit.ratio).length;
const topRaw=[...runs].sort((x,y)=>y.ratio-x.ratio).slice(0,25);
const report={dateEnd:'2026-11-11',sessions:unit.sessionCount,maxLots:5,
 gold:{net:unit.net,dd:unit.minuteDD,ratio:unit.ratio,fixed5:{net:five.net,dd:five.minuteDD,ratio:five.ratio}},
 policies:policy.length,countBeatOneRatio:countAboveBaseline,
 rawBestRatio:topRaw,bestStable:bestRatio,rawUnder1000:bestDD,
 rawBestNet:topNet,portfolioCircuitTopRatio:ratios,
 portfolioCircuitUnder1000:lowDD,highCostAdverseDDpass:ratioStress,
 circuits,conservative,all:runs,
 cautions:['No lookahead: lot count at PREMARKET chosen from past daily features, previous completed strategy pnl and risk drawdown only',
 'Independent signal follows original one-lot 29657/806 paper R26 model, including its one-lot 800-point stop',
 'Independent aggregate 5TX capital equity circuit is additional and can stop before original signal; trades may rejoin on next session',
 '1min OHLC cannot prove intraminute order fill; equity cap can gap through stop even after extra 50-point adverse slip',
 'Five TX implies NTD1000 per TX point and exponentially larger margin, fixed 5lot maxDD 4030 pts or NTD806000',
 'This ledger is NOT a fresh 5lot reoptimized market-signal engine; cross trades and broker fills require live testing',
 'Cost 2.5pt per side baseline and 5pt stress per side'],
 generatedAt:new Date().toISOString()};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-five-lot-dynamic.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-five-lot-dynamic.csv',
 'name,net,dd,ratio,stopEvents,rebalanceLots,tradedContracts,train,val,2026\n'+
 runs.map(x=>[x.name,x.net,x.dd,x.ratio,x.stopEvents,x.rebalanceLots,
 x.tradedContracts,x.periods.train,x.periods.validation,x.periods.holdout].join(',')).join('\n'));
console.log('R26_5LOT_DYNAMIC_RESULTS',JSON.stringify({
 policies:policy.length,aboveBaseline:countAboveBaseline,
 fixed:{one:{net:unit.net,dd:unit.minuteDD,ratio:unit.ratio},
 five:{net:five.net,dd:five.minuteDD,ratio:five.ratio}},
 topRatio:bestRatio.slice(0,12),under1000:bestDD.slice(0,12),
 portfolioRiskTop:ratios.slice(0,12),portfolioRiskUnder1000:lowDD.slice(0,12),
 stress:ratioStress.slice(0,12)
}));
