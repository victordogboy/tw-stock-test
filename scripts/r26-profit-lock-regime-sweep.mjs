// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {simulateLimit} from '../public/r26-research/open-limit-orders.mjs';
import {simulateLimitRisk} from '../public/r26-research/combined-breakout-risk.mjs';
import {priorDailyRegimes,regimeFlags} from '../public/r26-research/prior-regime-features.mjs';
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










const reg=priorDailyRegimes(prepared.sessions);
const round=x=>Math.round(x*100)/100;
const A=r=>r.atrSlope20<=-.25&&r.features?.mom5>2;
const B=r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0;
const E=r=>r.efficiency10>.8&&r.features?.mom5>1.5;
const C=r=>r.efficiency20>=.8&&r.upDays10>=.5;
const configs=[
 {name:'D200N195_E001_W30_BASE',day:200,night:195,entryATR:.01,window:30,
   flags:regimeFlags(reg,r=>A(r)||B(r)||E(r))},
 {name:'D200N195_E001_W30_EFF20',day:200,night:195,entryATR:.01,window:30,
   flags:regimeFlags(reg,r=>A(r)||B(r)||E(r)||C(r))},
 {name:'D205N195_E001_W30_EFF20',day:205,night:195,entryATR:.01,window:30,
   flags:regimeFlags(reg,r=>A(r)||B(r)||E(r)||C(r))}
];
const protects=[{kind:'none'}];
for(const start of [.5,.75,1,1.25,1.5,2])for(const lock of [0,.1,.2,.25,.3,.5])
 protects.push({kind:'lock',activateATR:start,lockATR:lock});
for(const start of [.5,1,1.5,2])for(const distance of [.5,.75,1,1.25,1.5,2])
 protects.push({kind:'trail',activateATR:start,distanceATR:distance});
for(const start of [.5,1,1.5,2])for(const fraction of [.2,.3,.5,.75])
 protects.push({kind:'fraction',activateATR:start,fraction});
function replay(cfg,p,{fee=2.5,entrySlip=0,riskSlip=0}={}){
 const risk={
  preopenShortOnlyAboveATRDay:cfg.day,preopenShortOnlyAboveATRNight:cfg.night,
  highVolLongRescueFlags:cfg.flags,equityDdCap:800,
  cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
  resumeShadowProfit:0,shadowPnl:prepared.pnls,
  ...(p.kind!=='none'?{coreProfitProtect:p}:{}),
  hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:cfg.entryATR,entryWindow:cfg.window,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
}
const part=(sim,begin,end)=>round(sim.rows.filter(x=>x.date>=begin&&x.date<=end).reduce((a,x)=>a+x.pnl,0));
function summary(sim,cfg,p,other={}){
 const t=sim.closedTrades;
 return {name:cfg.name+'_'+p.kind+'_START'+(p.activateATR??0)+'_VAL'+(p.lockATR??p.distanceATR??p.fraction??0),
  candidate:cfg.name,p,net:round(sim.rows.reduce((a,x)=>a+x.pnl,0)),
  dd:round(sim.minuteDD),trades:t.length,
  win:round(100*t.filter(x=>x.pnl>0).length/(t.length||1)),
  early:part(sim,'2021-10-22','2023-12-31'),
  validation:part(sim,'2024-01-01','2025-12-31'),
  holdout:part(sim,'2026-01-01','2026-11-11'),
  stops:sim.hardStops,...other};
}
const orig=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(orig.minuteDD,6106);assert.equal(round(orig.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<orig.rows.length;i++)assert.equal(orig.rows[i].pnl,prepared.rows[i].pnl);
const no=configs.map(cfg=>summary(replay(cfg,protects[0]),cfg,protects[0]));
assert.equal(no[0].net,28488);assert.equal(no[0].dd,806);
assert.equal(no[1].net,29033);assert.equal(no[1].dd,806);
assert.equal(no[2].net,29261);assert.equal(no[2].dd,852);
console.log('R26_PROFITLOCK_PARITY',JSON.stringify({n:configs.length*protects.length,noProtection:no}));
const results=[];
for(let i=0;i<configs.length;i++)for(let k=0;k<protects.length;k++){
 const cfg=configs[i],p=protects[k],sim=replay(cfg,p);
 const score=summary(sim,cfg,p);
 results.push(score);
 if(k%20===0)console.log('R26_PROFITLOCK_PROGRESS',i,k,protects.length,score.net,score.dd);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const strict=rank(results.filter(x=>x.dd<=1000&&x.early>0&&x.validation>0&&x.holdout>0));
const ratio=[...strict].sort((x,y)=>y.net/y.dd-x.net/x.dd);
const goal=rank(strict.filter(x=>x.net>=30000&&x.net/x.dd>=35));
const entries=[...new Set([...strict.slice(0,14).map(x=>x.name),
 ...ratio.slice(0,9).map(x=>x.name),no[0].name,no[1].name,no[2].name])];
const stress=[];
for(const name of entries){
 const ref=results.find(x=>x.name===name);
 const cfg=configs.find(x=>x.name===ref.candidate);
 for(const z of [{fee:3,entrySlip:0,riskSlip:0},{fee:5,entrySlip:0,riskSlip:0},
  {fee:2.5,entrySlip:5,riskSlip:75},{fee:5,entrySlip:5,riskSlip:75}]){
  stress.push(summary(replay(cfg,ref.p,z),cfg,ref.p,z));
 }
}
const robust=rank(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const report={generatedAt:new Date().toISOString(),tests:results.length,original:{net:65953,dd:6106},
 noProtection:no,strictCount:strict.length,goal30kAndRatio35:goal.slice(0,25),
 best:strict.slice(0,25),bestRatio:ratio.slice(0,25),
 stress,robust:robust.slice(0,20),results,
 notes:['Protective stop moves only from earlier completed minute favorable highs/lows',
 'Stop tested first; cannot claim favorable extreme and stop sequence within same minute',
 'Current contract roll resets stop reference and best high/low to prevent cross-contract price jumps',
 '1TX entire period, no historical P&L resets; strict frozen parity for no protection',
 '2026 repeatedly optimized and NOT unseen; broker fill slippage and true order-book risk remain',
 'No changes to live production R26 trading behavior']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-profit-lock-regime-sweep.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-profit-lock-regime-sweep.csv',
 'name,net,dd,ratio,win,trades,early,validation,2026\n'+results.map(x=>
 [x.name,x.net,x.dd,round(x.net/x.dd),x.win,x.trades,x.early,x.validation,x.holdout].join(',')).join('\n'));
console.log('R26_PROFITLOCK_RESULTS',JSON.stringify({n:results.length,strict:strict.length,goal:goal.slice(0,20),
 best:strict.slice(0,18),ratios:ratio.slice(0,14),robust:robust.slice(0,15)}));
