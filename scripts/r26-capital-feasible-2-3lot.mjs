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
const ready=(s)=>regs[s.index]||{};
const mask=regimeFlags(regs,r=>
 (r.atrSlope20<=-.25&&r.features?.mom5>2)||
 (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
 (r.efficiency10>.8&&r.features?.mom5>1.5)||
 (r.efficiency20>=.8&&r.upDays10>=.5));
function makeSignal({fee=2.5,entrySlippage=0,riskSlippage=0}={}){
 return simulateLimitRisk(prepared.sessions,bars,{
  end:'2026-11-11',fee,
  risk:{preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
   highVolLongRescueFlags:mask,equityDdCap:800,cooldownReset:true,haltSessions:8,
   resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
   coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3},
   hardStopSlippagePoints:riskSlippage},
  limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,
   entryWindow:30,onlySide:-1,breakoutSlippagePoints:entrySlippage}});
}
const original=makeSignal();
const check=replaySizedTape(prepared.sessions,bars,original,{maxLots:5,sizeAtOpen:()=>1,fee:2.5});
assert.equal(check.net,29657);assert.equal(check.minuteDD,806);
const money={capital:2_000_000,marginPerTX:701_000,safetyCash:300_000,pointValue:200};
function gateSize(select,maxAllowed,{capByMargin=true,reserve=300_000}={}){
 return ctx=>{
  const preferred=select(ctx);
  const desired=Math.max(0,Math.min(maxAllowed,Math.trunc(preferred)));
  if(!capByMargin)return desired;
  const available=money.capital+ctx.priorEquity*money.pointValue-reserve;
  return Math.min(desired,Math.max(0,Math.floor(available/money.marginPerTX)));
 };
}
const models=[];
const add=(family,name,fn)=>models.push({family,name,fn});
for(const max of [2,3])add('control','FIXED_'+max,()=>max);
add('control','FIXED_1',()=>1);
for(const max of [2,3])for(const vol of [140,150,160,175,200,250])
 for(const dd of [75,150,250,400]){
  add('absolute_atr','ATR_LT'+vol+'_PREVDD_LT'+dd+'_MAX'+max,
    ({s,priorDd})=>(s.atr<vol&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const cap of [.4,.5,.6,.7,.8])
 for(const dd of [100,250,400]){
  add('atr_percentile','PCT_LT'+cap+'_DDLT'+dd+'_MAX'+max,
    ({index,priorDd})=>(regs[index].historyReady&&regs[index].atrPercentile250<cap&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const n of [5,10,20])for(const rate of [-.2,-.1,0,.1])
 for(const dd of [150,300]){
  add('atr_contraction','ATR_DELTA'+n+'_LT'+rate+'_DD'+dd+'_MAX'+max,
    ({index,priorDd})=>(regs[index].historyReady&&regs[index]['atrSlope'+n]<rate&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const eff of [.25,.4,.55,.7,.8])
 for(const dd of [150,350]){
  add('trend_efficiency','EFF10_GT'+eff+'_DD'+dd+'_MAX'+max,
    ({index,priorDd})=>(regs[index].historyReady&&regs[index].efficiency10>eff&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const mom of [.5,1,1.5,2,2.5,3])
 for(const dd of [100,200,400]){
  add('long_momentum','LONG_MOM5_GT'+mom+'_DD'+dd+'_MAX'+max,
    ({s,priorDd})=>(s.signal>0&&s.features?.mom5>mom&&priorDd<dd)?max:1);
  add('short_momentum','SHORT_MOM5_LT'+(-mom)+'_DD'+dd+'_MAX'+max,
    ({s,priorDd})=>(s.signal<0&&s.features?.mom5<(-mom)&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const rsi of [45,50,55,60,65])
 for(const dd of [150,350]){
  add('rsi_confirm','RSI_GT'+rsi+'_SLOPEPOS_DD'+dd+'_MAX'+max,
    ({s,priorDd})=>(s.signal>0&&s.features?.rsi>=rsi&&s.features?.slope>0&&priorDd<dd)?max:1);
 }
for(const max of [2,3])for(const e of [150,250,400,600]){
 add('recent_pnl','LAST5_BASEPNL_GT'+e+'_MAX'+max,
  ({frozenBaselinePrior})=>frozenBaselinePrior.slice(-5).reduce((sum,x)=>sum+x,0)>e?max:1);
 add('recent_pnl','LAST10_BASEPNL_GT'+e+'_MAX'+max,
  ({frozenBaselinePrior})=>frozenBaselinePrior.slice(-10).reduce((sum,x)=>sum+x,0)>e?max:1);
}
for(const max of [2,3])for(const dd of [100,200,350,500])
 add('equity_reduction','DD_LT'+dd+'_MAX'+max,({priorDd})=>priorDd<dd?max:1);
for(const max of [2,3])for(const a of [150,200,300])
 for(const b of [.4,.6,.8])for(const dd of [150,350])
 add('atr_and_trend','ATR_LT'+a+'_EFF10_GT'+b+'_DD'+dd+'_MAX'+max,
  ({s,index,priorDd})=>s.atr<a&&regs[index].efficiency10>b&&priorDd<dd?max:1);
for(const max of [2,3])for(const a of [180,230,300])
 for(const b of [-.15,-.05,0])for(const dd of [150,350])
 add('atr_and_decay','ATR_LT'+a+'_SLOPE5_LT'+b+'_DD'+dd+'_MAX'+max,
  ({s,index,priorDd})=>s.atr<a&&regs[index].atrSlope5<b&&priorDd<dd?max:1);
function runPolicy(policy,signal,fee,{capByMargin=true,exposureCap=3,circuit=0,slip=0,reserve=money.safetyCash}={}){
 return replaySizedTape(prepared.sessions,bars,signal,{fee,maxLots:5,
  sizeAtOpen:gateSize(policy.fn,exposureCap,{capByMargin,reserve}),
  drawdownCircuit:circuit,haltSessions:8,riskExitExtraSlip:slip});
}
const cut=(r,a,b)=>round(r.rows.filter(x=>x.date>=a&&x.date<=b).reduce((sum,v)=>sum+v.pnl,0));
const year=(r,y)=>cut(r,y+'-01-01',y+'-12-31');
function stat(r,p,extras={}){
 return {
  name:p.name,family:p.family,net:r.net,dd:r.minuteDD,ratio:round(r.net/(r.minuteDD||1)),
  tradeLots:r.tradedContracts,rebalance:r.rebalanceLots,
  extraRequestedSessions:r.rows.filter(x=>x.requestedLots>1).length,
  extraHeldSessions:r.rows.filter(x=>Math.abs(x.endingLots)>1).length,
  maxUsed:Math.max(...r.rows.map(x=>Math.abs(x.endingLots))),
  train:cut(r,'2021-10-22','2023-12-31'),validation:cut(r,'2024-01-01','2025-12-31'),
  recent:cut(r,'2026-01-01','2026-11-11'),
  annual:Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[y,year(r,y)])),
  ...extras};
}
const refPolicy={name:'REFERENCE_1_TX',family:'baseline',fn:()=>1};
const ref=stat(runPolicy(refPolicy,original,2.5),refPolicy);
assert.equal(ref.net,29657);assert.equal(ref.dd,806);
const entries=[];
for(let i=0;i<models.length;i++){
 const p=models[i],replay=runPolicy(p,original,2.5);
 entries.push(stat(replay,p));
 if(i%75===0)console.log('R26_CAPITAL_2_3_PROGRESS',i,models.length,p.name,replay.net,replay.minuteDD);
}
const rankRatio=a=>a.sort((x,y)=>y.ratio-x.ratio||y.net-x.net);
const rankNet=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const good=entries.filter(x=>x.dd<=1000&&x.maxUsed<=3&&x.train>0&&x.validation>0&&x.recent>0);
const top=rankRatio([...good]).slice(0,25);
const topNet=rankNet([...good]).slice(0,20);
const crossyear=rankRatio(good.filter(x=>x.annual[2024]>ref.annual[2024]+1&&
 x.annual[2025]>ref.annual[2025]+1&&x.annual[2026]>ref.annual[2026]+1)).slice(0,20);
const trainRank=rankRatio(entries.filter(x=>x.train>0).map(x=>({...x,trainRatio:round(x.train/806)}))).sort(
 (a,b)=>b.train-a.train).slice(0,15);
const picked=[...new Set([...top.slice(0,7).map(x=>x.name),
 ...topNet.slice(0,5).map(x=>x.name),
 ...crossyear.slice(0,6).map(x=>x.name),
 ...trainRank.slice(0,4).map(x=>x.name),
 'FIXED_1','FIXED_2','FIXED_3',
 'ATR_LT150_PREVDD_LT100_MAX2','ATR_LT160_PREVDD_LT150_MAX2'])];
const candidates= picked.map(name=>models.find(x=>x.name===name)||refPolicy);
const scenarios=[];
for(const [name,fee,entrySlippage,riskSlippage] of [
 ['baseline',2.5,0,0],['higher_fee',5,5,75],['strong_slip',5,10,100]]){
 const paper=name==='baseline'?original:makeSignal({fee,entrySlippage,riskSlippage});
 const check=runPolicy(refPolicy,paper,fee);
 assert.equal(check.net,round(paper.rows.reduce((a,x)=>a+x.pnl,0)),'1LOT_EQUITY_PARITY '+name);
 assert.equal(check.minuteDD,paper.minuteDD,'1LOT_DD_PARITY '+name);
 for(const p of candidates)for(const circuit of [0,1000]){
  const q=stat(runPolicy(p,paper,fee,{circuit,slip:name==='baseline'?0:50}),
    p,{scenario:name,fee,entrySlippage,riskSlippage,circuit});
  scenarios.push(q);
 }
}
const highCost=rankRatio(scenarios.filter(x=>x.scenario==='higher_fee'&&x.circuit===1000&&x.dd<=1000)).slice(0,20);
const deltaByYear=(record)=>Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>
 [y,round(record.annual[y]-ref.annual[y])]));
const crossYearAny=entries.filter(x=>[2024,2025,2026].every(y=>x.annual[y]>ref.annual[y]+1));
const report={
  end:'2026-11-11',pointsBasis:'TX equivalent point counts for 200NTD/point per TX',
  source:'Frozen R26 golden 2428 sessions + official extension 24; dynamic sizes computed before opening each session.',
  capital:money,
  numberTested:models.length,baseline:ref,crossYearAnyCount:crossYearAny.length,
  bestRatio:top,bestNet:topNet,bestCrossyear:crossyear,
  topTrainingOnly:trainRank,
  nearestLowATR:entries.filter(x=>x.name.startsWith('ATR_LT1')&&x.name.endsWith('_MAX2')),
  scenarios,highCost:highCost,
  all:entries,
  guardrails:['Initial equity 2,000,000, original margin per TX 701,000 and cash buffer 300,000, static 2026 margin applied historically (conservative approximation not historical dynamic margin).',
  'At each pre-open, cap lots <= floor((2,000,000 + prior strategy NET points * 200 - cash buffer) / 701,000).',
  'Policies 1-3 TX, with 3 only allowed after equity growth. No future intraday OHLC for sizing.',
  'Max DD uses minute close-to-close mark-to-market; unchanged model paper fills, not actual orderbook.',
  'No portfolio accounting for taxes, financing interest or broker intraday margin tightening.',
  'Do not claim fresh OOS; 2026 previously used in feature selection and rule research.',
  'Caution: capital+priorEquity excludes overnight open gap at opening, so actual account margin may be tighter.',
  'Only candidate research, original production R26 not changed.']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-capital-feasible-2-3lot.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-capital-feasible-2-3lot.csv',
 'name,family,net,dd,ratio,extraHeldSessions,train,validation,recent,2021,2022,2023,2024,2025,2026\n'+entries.map(x=>[
 x.name,x.family,x.net,x.dd,x.ratio,x.extraHeldSessions,x.train,x.validation,x.recent,
 ...[2021,2022,2023,2024,2025,2026].map(y=>x.annual[y])
 ].join(',')).join('\n'));
console.log('R26_CAPITAL_2_3_SUMMARY',JSON.stringify({
 n:models.length,baseline:ref,threshold1000:good.length,
 crossYearAny:crossYearAny.length,
 best:top.slice(0,18).map(x=>({...x,diffYear:deltaByYear(x)})),
 bestNet:topNet.slice(0,12).map(x=>({...x,diffYear:deltaByYear(x)})),
 bestCross:crossyear.slice(0,12).map(x=>({...x,diffYear:deltaByYear(x)})),
 highCost:highCost.slice(0,12)}));
