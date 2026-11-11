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
const mask=regimeFlags(reg,r=>(r.atrSlope20<=-.25&&r.features?.mom5>2)||
  (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0));
const fallback=regimeFlags(reg,()=>false);
const scenarios=[];
for(const vol of [185,195,200,205,210,225,250,300])
 for(const cap of [400,500,600,700,800,900,1000])
 for(const hold of [false,true])
  for(const shortEntry of [.025,.05,.075])
   for(const wait of [5,8]){
     scenarios.push({name:'V'+vol+'_C'+cap+'_H'+(+hold)+'_S'+shortEntry+'_WAIT'+wait,
       vol,cap,hold,shortEntry,wait,mask});
   }
scenarios.unshift({name:'R26_ATR200_C800_FORCE_EXIT',vol:200,cap:800,hold:false,shortEntry:.025,wait:8,mask});
scenarios.unshift({name:'R26_ATR200_C800_HOLD_LONG',vol:200,cap:800,hold:true,shortEntry:.025,wait:8,mask});
const runTest=(p,fee=2.5,entrySlip=0,riskSlip=0)=>{
 const risk={
  preopenShortOnlyAboveATR:p.vol,
  highVolLongRescueFlags:p.mask,
  holdExistingLongAtHighATR:p.hold,
  equityDdCap:p.cap,cooldownReset:true,haltSessions:p.wait,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
  hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:p.shortEntry,entryWindow:60,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
};
function grade(s,p,other={}){
 const tx=s.closedTrades,eq=s.rows.reduce((a,x)=>a+x.pnl,0);
 const spans=[
 ['early','2021-10-22','2023-12-31'],['validation','2024-01-01','2025-12-31'],
 ['yr2026','2026-01-01','2026-11-11']
 ];
 const periods=Object.fromEntries(spans.map(([n,a,b])=>[n,round(s.rows.filter(x=>x.date>=a&&x.date<=b).reduce((v,x)=>v+x.pnl,0))]));
 return {name:p.name,vol:p.vol,cap:p.cap,hold:p.hold,shortEntry:p.shortEntry,wait:p.wait,
  net:round(eq),dd:round(s.minuteDD),
  ntrades:tx.length,win:round(tx.filter(t=>t.pnl>0).length/(tx.length||1)*100),
  skipped:s.skippedSessions,hardStops:s.hardStops,periods,...other};
}
const orig=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(orig.minuteDD,6106);
assert.equal(round(orig.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<orig.rows.length;i++)assert.equal(orig.rows[i].pnl,prepared.rows[i].pnl);
const one=grade(runTest(scenarios[1]),scenarios[1]);
assert.equal(one.net,27183);assert.equal(one.dd,806);
console.log('R26_HOLD_PARITY',JSON.stringify({control:{net:65953,dd:6106},base:one,candidates:scenarios.length}));
const results=[];
for(let i=0;i<scenarios.length;i++){
 const p=scenarios[i],v=grade(runTest(p),p);
 results.push(v);
 if(i%40===0)console.log('R26_HOLD_PROGRESS',i,scenarios.length,v.name,v.net,v.dd);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const strict=rank(results.filter(x=>x.dd<=1000&&x.periods.early>0&&x.periods.validation>0&&x.periods.yr2026>0));
const topRatio=[...strict].sort((x,y)=>y.net/y.dd-x.net/x.dd);
const near=rank(results.filter(x=>x.dd<=1200&&x.periods.early>0&&x.periods.validation>0));
const top30k=rank(strict.filter(x=>x.net>=30000&&x.net/x.dd>=35));
const chosen=[...new Set([...strict.slice(0,12).map(x=>x.name),
  ...topRatio.slice(0,7).map(x=>x.name),'R26_ATR200_C800_FORCE_EXIT','R26_ATR200_C800_HOLD_LONG'])];
const stress=[];
for(const name of chosen){
 const p=scenarios.find(x=>x.name===name);
 for(const spec of [{fee:2.5,entrySlip:0,riskSlip:0},{fee:3,entrySlip:0,riskSlip:0},
  {fee:5,entrySlip:0,riskSlip:0},{fee:5,entrySlip:5,riskSlip:75},{fee:5,entrySlip:10,riskSlip:100}]){
  stress.push(grade(runTest(p,spec.fee,spec.entrySlip,spec.riskSlip),p,spec));
 }
}
const robust=rank(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const report={n:scenarios.length,frozen:{net:65953,dd:6106},reference:one,
 goal30kRatio35:top30k.slice(0,25),strictCount:strict.length,
 bestStrict:strict.slice(0,30),bestRatio:topRatio.slice(0,20),
 near1200:near.slice(0,15),robust:robust.slice(0,15),stress,all:results,
 limitations:['1TX whole position, past-only end-day regime filters and previous known position',
 'Switch holdExistingLongAtHighATR affects only already-long exposure, not new purchases',
 'Portfolio risk cap 400-1000 pts is a model trigger, not guaranteed cash-market realized stop',
 '2026 inspected in R26 prior rounds, hence not clean unseen out-of-sample',
 '1m stop-first OHLC, extra 5pt breakout/75pt risk slippage only in stress runs'],
 generated:new Date().toISOString()};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-incumbent-highvol-long.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-incumbent-highvol-long.csv',
 'name,vol,cap,hold,shortEntry,wait,net,dd,ratio,win,trades,early,validation,2026\n'+
 results.map(x=>[x.name,x.vol,x.cap,x.hold,x.shortEntry,x.wait,x.net,x.dd,round(x.net/x.dd),x.win,
 x.ntrades,x.periods.early,x.periods.validation,x.periods.yr2026].join(',')).join('\n'));
console.log('R26_HOLD_RESULTS',JSON.stringify({tested:scenarios.length,strict:strict.length,
 goal30kRatio35:top30k.slice(0,15),best:strict.slice(0,15),ratio:topRatio.slice(0,12),robust:robust.slice(0,12)}));
