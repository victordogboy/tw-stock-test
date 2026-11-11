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




const r=n=>Math.round(n*100)/100;
function config(name,cap=0,extras={},lim={}){
 const risk={...extras};
 if(cap>0)Object.assign(risk,{equityDdCap:cap,cooldownReset:true,
  haltSessions:8,resumeShadowLookback:8,resumeShadowProfit:0});
 risk.shadowPnl=prepared.pnls;
 return {name,risk,lim};
}
const configs=[
 config('R26_BASE'),
 config('R26_RISK_2250',2250),
 config('R26_RISK_2500',2500),
 config('ONLY_SHORT_750',750,{onlyDirection:-1}),
 config('PRESTOP120_0',0,{preopenMaxStopDistance:120}),
 config('PRESTOP120_500',500,{preopenMaxStopDistance:120})
];
for(const cap of [0,300,500,750,1000,1250]){
 for(const val of [250,350,500,700,1000,1500,2000]){
  configs.push(config('SHORT_ABOVE_'+val+'_CAP_'+cap,cap,{preopenShortOnlyAboveATR:val}));
  configs.push(config('LONG_ABOVE_'+val+'_CAP_'+cap,cap,{preopenLongOnlyAboveATR:val}));
 }
}
for(const cap of [0,300,500,750,1000,1250]){
 for(const n of [3,5,8,12,20,40]){
  for(const target of [-300,0,200,500,800]){
   configs.push(config('SHADOW_'+n+'_MIN_'+target+'_CAP_'+cap,cap,{shadowLookbackMin:n,minShadowProfit:target}));
  }
 }
}
for(const cap of [0,300,500,750,1000,1250]){
 for(const opt of [{flatAfterDay:true},{flatAfterNight:true},{flatAfterDay:true,flatAfterNight:true}]){
  const mode=opt.flatAfterDay&&opt.flatAfterNight?'ALL':opt.flatAfterDay?'DAY':'NIGHT';
  configs.push(config('FLAT_'+mode+'_CAP_'+cap,cap,opt));
 }
 for(const o of [{disableKey:true},{disableReentry:true},{disableKey:true,disableReentry:true}]){
  const label=o.disableKey&&o.disableReentry?'BOTH':o.disableKey?'NO_KEY':'NO_REENTRY';
  configs.push(config(label+'_CAP_'+cap,cap,o));
 }
}
for(const cap of [300,500,750,1000]){
 for(const b of [100,125,150,200,250,300,400]){
  for(const opt of [{disableReentry:true},{flatAfterNight:true},{flatAfterDay:true},{flatAfterNight:true,flatAfterDay:true}]){
   const mode=opt.disableReentry?'NO_REENTRY':opt.flatAfterDay&&opt.flatAfterNight?'FLAT_BOTH':opt.flatAfterDay?'FLAT_DAY':'FLAT_NIGHT';
   configs.push(config('PRESTOP_'+b+'_'+mode+'_CAP_'+cap,cap,{preopenMaxStopDistance:b,...opt}));
  }
 }
}
for(const cap of [300,500,750,1000]){
 for(const maxAtr of [300,500,700,1000,1500]){
  for(const opt of [{flatAfterNight:true},{disableReentry:true},{flatAfterDay:true,flatAfterNight:true}]){
   const mode=opt.disableReentry?'NO_REENTRY':opt.flatAfterNight&&!opt.flatAfterDay?'FLAT_NIGHT':'FLAT_BOTH';
   configs.push(config('ATRMAX_'+maxAtr+'_'+mode+'_CAP_'+cap,cap,{preopenMaxATR:maxAtr,...opt}));
  }
 }
}
for(const cap of [300,500,750,1000]){
 for(const side of [-1,1]){
  for(const sid of [0,1]){
   configs.push(config('ONLY_SIDE_'+side+'_SESSION_'+sid+'_CAP_'+cap,cap,{onlyDirection:side,onlySid:sid}));
  }
 }
}
for(const cap of [300,500,750,1000]){
 for(const atr of [.025,.05,.075]){
  for(const atrHigh of [300,500,800]){
   configs.push(config('SHORT_BREAK_'+atr+'_SHORT_ABOVE_'+atrHigh+'_CAP_'+cap,cap,{preopenShortOnlyAboveATR:atrHigh},
    {anchor:'priorClose',entryMode:'breakout',entryATR:atr,entryWindow:60,onlySide:-1}));
  }
 }
}
const scores=[];
function calc(res,cfg){
 const turns=res.closedTrades;
 const groups=[
 ['older','2021-10-22','2023-12-31'],['validation','2024-01-01','2025-12-31'],
 ['2026','2026-01-01','2026-11-11'],['late','2026-10-27','2026-11-11']];
 const phase=Object.fromEntries(groups.map(([key,start,end])=>{
  const rows=res.rows.filter(x=>x.date>=start&&x.date<=end);
  const tx=turns.filter(t=>t.exitDate>=start&&t.exitDate<=end);
  let n=0,peak=0,mdd=0;
  for(const x of rows){n+=x.pnl;peak=Math.max(peak,n);mdd=Math.max(mdd,peak-n)}
  return [key,{net:r(n),dd:r(mdd),trades:tx.length,win:r(100*tx.filter(t=>t.pnl>0).length/(tx.length||1))}];
 }));
 const count=turns.filter(t=>t.pnl>0).length;
 return {name:cfg.name,net:r(res.rows.reduce((a,x)=>a+x.pnl,0)),dd:r(res.minuteDD),
  trades:turns.length,win:r(100*count/(turns.length||1)),
  stopped:res.hardStops,skipped:res.skippedSessions,phase};
}
const baseline=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11'});
assert.equal(baseline.minuteDD,prepared.minuteDD);
assert.equal(baseline.rows.length,prepared.rows.length);
for(let i=0;i<baseline.rows.length;i++)assert.equal(baseline.rows[i].pnl,prepared.rows[i].pnl);
assert.equal(r(baseline.rows.reduce((a,x)=>a+x.pnl,0)),65953);
console.log('R26_1000_REGIME_PARITY',JSON.stringify({sessions:baseline.rows.length,net:65953,dd:6106}));
for(let i=0;i<configs.length;i++){
 const cfg=configs[i];
 const sim=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11',limit:cfg.lim,risk:cfg.risk});
 const scored=calc(sim,cfg);
 if(!Number.isFinite(scored.net)||!Number.isFinite(scored.dd))throw Error('invalid '+cfg.name);
 scores.push(scored);
 if(i%40===0)console.log('R26_1000_REGIME_PROGRESS',i,configs.length,scored.name,scored.net,scored.dd);
}
function rank(arr){return arr.sort((a,b)=>b.net-a.net||a.dd-b.dd)}
const strict=rank(scores.filter(x=>x.dd<=1000));
const medium=rank(scores.filter(x=>x.dd<=1250));
const easy=rank(scores.filter(x=>x.dd<=1500));
const upper=rank(scores.filter(x=>x.dd<=2000));
const robust=rank(scores.filter(x=>x.dd<=1000&&x.phase['2026'].net>0&&x.phase.validation.net>0&&x.phase.older.net>0));
const selected=[...new Set([...strict.slice(0,6).map(x=>x.name),...medium.slice(0,3).map(x=>x.name),...easy.slice(0,3).map(x=>x.name),'ONLY_SHORT_750','R26_RISK_2500'])];
const stress=[];
for(const name of selected){
 const cfg=configs.find(x=>x.name===name);
 for(const [fee,slip] of [[2.5,0],[3,0],[5,0],[2.5,10],[2.5,30],[2.5,75],[5,30]]){
  const sim=simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',limit:cfg.lim,
   risk:{...cfg.risk,hardStopSlippagePoints:slip}});
  stress.push({name,fee,riskExitSlip:slip,...calc(sim,cfg)});
 }
}
const report={dateEnd:'2026-11-11',unit:'1 TX whole lots, 2.5 points per side baseline',
 sessions:2452,variants:configs.length,under1000Count:strict.length,under1250Count:medium.length,
 guardrail:'No global max-DD reset on resumed trading, only paper local cap',
 gold:baseline.rows.length,
 bestStrict:strict.slice(0,30),bestInEachPositive:robust.slice(0,15),
 best1250:medium.slice(0,15),best1500:easy.slice(0,15),best2000:upper.slice(0,15),
 stress,all:scores,
 caveat:['No fully unseen out of sample; 2026 known to optimizer',
 'One-minute OHLC has unknown tick order; guaranteed realized risk cannot be proven',
 'No user brokerage position or fill verification; research only',
 'No use of current session future prices in premarket gating',
 'Session flat changes R26 cross-session strategy and is isolated']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-under1000-regime-and-cost.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-under1000-regime.csv',
 'name,net,dd,trades,win,skipped,train,validation,2026\n'+scores.map(x=>
 [x.name,x.net,x.dd,x.trades,x.win,x.skipped,x.phase.older.net,x.phase.validation.net,x.phase['2026'].net].join(',')).join('\n'));
console.log('R26_1000_REGIME_RESULTS',JSON.stringify({
 tested:configs.length,under1000:strict.length,under1250:medium.length,
 bestStrict:strict.slice(0,20),bestEachPositive:robust.slice(0,10),
 best1250:medium.slice(0,15),best1500:easy.slice(0,10)}));
console.log('R26_1000_REGIME_STRESS',JSON.stringify(stress.filter(x=>x.fee===5||x.riskExitSlip===75).slice(0,35)));
