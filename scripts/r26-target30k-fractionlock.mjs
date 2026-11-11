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










const rg=priorDailyRegimes(prepared.sessions);
const round=x=>Math.round(x*100)/100;
const A=r=>r.atrSlope20<=-.25&&r.features?.mom5>2;
const B=r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0;
const E=r=>r.efficiency10>.8&&r.features?.mom5>1.5;
const C=r=>r.efficiency20>=.8&&r.upDays10>=.5;
const models=[
 {name:'D200N195_EFF20',day:200,night:195,flags:regimeFlags(rg,r=>A(r)||B(r)||E(r)||C(r))},
 {name:'D205N195_EFF20',day:205,night:195,flags:regimeFlags(rg,r=>A(r)||B(r)||E(r)||C(r))},
 {name:'D200N195_EFF10',day:200,night:195,flags:regimeFlags(rg,r=>A(r)||B(r)||E(r))}
];
const configs=[];
for(const model of models)for(const entryATR of [.005,.01,.015,.025,.035,.05,.075])
 for(const window of [30,60,120])
 for(const activateATR of [.75,1,1.25])
 for(const fraction of [.2,.25,.3,.35])
  configs.push({model,entryATR,window,activateATR,fraction,
   name:model.name+'_E'+entryATR+'_W'+window+'_S'+activateATR+'_F'+fraction});
function replay(c,{fee=2.5,entrySlip=0,riskSlip=0}={}){
 const risk={
  preopenShortOnlyAboveATRDay:c.model.day,preopenShortOnlyAboveATRNight:c.model.night,
  highVolLongRescueFlags:c.model.flags,equityDdCap:800,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
  coreProfitProtect:{kind:'fraction',activateATR:c.activateATR,fraction:c.fraction},
  hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:c.entryATR,entryWindow:c.window,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
}
const period=(s,start,end)=>round(s.rows.filter(x=>x.date>=start&&x.date<=end).reduce((a,x)=>a+x.pnl,0));
function summarize(s,c,o={}){
 const t=s.closedTrades;
 return {name:c.name,model:c.model.name,entryATR:c.entryATR,window:c.window,
  activateATR:c.activateATR,fraction:c.fraction,
  net:round(s.rows.reduce((a,x)=>a+x.pnl,0)),dd:round(s.minuteDD),
  win:round(100*t.filter(x=>x.pnl>0).length/(t.length||1)),trades:t.length,
  early:period(s,'2021-10-22','2023-12-31'),
  validation:period(s,'2024-01-01','2025-12-31'),
  holdout:period(s,'2026-01-01','2026-11-11'),
  halted:s.hardStops,skipped:s.skippedSessions,...o};
}
const original=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(original.minuteDD,6106);
assert.equal(round(original.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<original.rows.length;i++)assert.equal(original.rows[i].pnl,prepared.rows[i].pnl);
const prev200=configs.find(x=>x.model.name==='D200N195_EFF20'&&x.entryATR===.01&&x.window===30&&x.activateATR===1&&x.fraction===.3);
const prev205=configs.find(x=>x.model.name==='D205N195_EFF20'&&x.entryATR===.01&&x.window===30&&x.activateATR===1&&x.fraction===.3);
if(!prev200||!prev205)throw Error('known anchor absent');
const gold=[summarize(replay(prev200),prev200),summarize(replay(prev205),prev205)];
assert.equal(gold[0].net,29598);assert.equal(gold[0].dd,806);
assert.equal(gold[1].net,29826);assert.equal(gold[1].dd,852);
console.log('R26_COMBINED_LOCK_GOLD',JSON.stringify({n:configs.length,gold}));
const all=[];
for(let i=0;i<configs.length;i++){
 const c=configs[i],result=summarize(replay(c),c);
 all.push(result);
 if(i%80===0)console.log('R26_COMBINED_LOCK_PROGRESS',i,configs.length,c.name,result.net,result.dd);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const strict=rank(all.filter(x=>x.dd<=1000&&x.early>0&&x.validation>0&&x.holdout>0));
const ratio=[...strict].sort((x,y)=>y.net/y.dd-x.net/x.dd);
const goals=rank(strict.filter(x=>x.net>=30000&&x.net/x.dd>=35));
const chosen=[...new Set([...strict.slice(0,16).map(x=>x.name),
 ...ratio.slice(0,10).map(x=>x.name),prev200.name,prev205.name])];
const stress=[];
for(const name of chosen){
 const c=configs.find(x=>x.name===name);
 for(const z of [
  {fee:3,entrySlip:0,riskSlip:0},{fee:5,entrySlip:0,riskSlip:0},
  {fee:2.5,entrySlip:5,riskSlip:75},{fee:5,entrySlip:5,riskSlip:75},
  {fee:5,entrySlip:10,riskSlip:100}]){
  stress.push(summarize(replay(c,z),c,z));
 }
}
const robust=rank(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const report={generatedAt:new Date().toISOString(),tested:configs.length,original:{net:65953,dd:6106},
 gold,under1000:strict.length,achieved30kRatio35:goals.slice(0,25),
 strictBest:strict.slice(0,25),ratioBest:ratio.slice(0,20),stress,robust:robust.slice(0,15),all,
 caveats:['Core stop increases only after favorable high/low of preceding full minute, and stop-first OHLC arbitration.',
 'Compared all versions with 1 TX max, same 2021-2026 2452 sessions and 2.5 pts per side, strict canonical baseline parity.',
 '2026 has been used in previous optimizations and cannot be treated as a pristine unseen sample.',
 'Extra side cost 5 points, short-entry slippage 5 or 10 points and risk-exit adverse 75-100 points in stress.',
 'Maximum risk cap 800 is not a guaranteed real future maximum drawdown or exact execution.',
 'Research-only; live R26 unmodified.']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-target30k-fractionlock.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-target30k-fractionlock.csv',
 'name,model,entryATR,window,activation,fraction,net,dd,ratio,win,trades,early,validation,holdout\n'+
 all.map(x=>[x.name,x.model,x.entryATR,x.window,x.activateATR,x.fraction,x.net,x.dd,
 round(x.net/x.dd),x.win,x.trades,x.early,x.validation,x.holdout].join(',')).join('\n'));
console.log('R26_TARGET30K_LOCK_RESULTS',JSON.stringify({n:configs.length,strict:strict.length,
 achieved:goals.slice(0,18),best:strict.slice(0,20),ratios:ratio.slice(0,14),robust:robust.slice(0,12)}));
