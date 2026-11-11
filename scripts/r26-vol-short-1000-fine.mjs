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





const params=[];
const add=(vol,atr,win,cap)=>{
 const risk={preopenShortOnlyAboveATR:vol};
 if(cap){Object.assign(risk,{equityDdCap:cap,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls});}
 const limit=atr>0?{anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:atr,entryWindow:win}:{};
 params.push({name:'V'+vol+'_A'+atr+'_W'+win+'_C'+cap,vol,atr,win,cap,risk,limit});
};
for(const vol of [150,175,190,195,200,205,210,215,220,225,230,240,250,260,275,300,325,350,400]){
 for(const atr of [0,.025,.05,.075,.1])
  for(const window of [30,60,120])
   for(const cap of [0,800])add(vol,atr,window,cap);
}
const trunc=x=>Math.round(x*100)/100;
const metric=(s,p)=>{
 const net=trunc(s.rows.reduce((a,b)=>a+b.pnl,0)),tx=s.closedTrades;
 const phase={};
 for(const [key,from,to] of [['older','2021-10-22','2023-12-31'],['validation','2024-01-01','2025-12-31'],
 ['2026','2026-01-01','2026-11-11']]){
  const rows=s.rows.filter(x=>x.date>=from&&x.date<=to);phase[key]=trunc(rows.reduce((a,b)=>a+b.pnl,0));
 }
 return {name:p.name,vol:p.vol,atr:p.atr,win:p.win,cap:p.cap,net,dd:trunc(s.minuteDD),
  trades:tx.length,winPct:trunc(100*tx.filter(x=>x.pnl>0).length/(tx.length||1)),
  stops:s.hardStops,skips:s.skippedSessions,fill:s.eligibleEntries?trunc(100*s.limitEntries/s.eligibleEntries):null,
  phase};
};
const b=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5});
assert.equal(b.minuteDD,6106);assert.equal(trunc(b.rows.reduce((a,v)=>a+v.pnl,0)),65953);
for(let i=0;i<b.rows.length;i++)assert.equal(b.rows[i].pnl,prepared.rows[i].pnl);
console.log('R26_VOL_FINE_GOLD',JSON.stringify({n:b.rows.length,dd:b.minuteDD,net:65953}));
const results=[];
for(let i=0;i<params.length;i++){
 const p=params[i];
 const m=metric(simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5,risk:p.risk,limit:p.limit}),p);
 results.push(m);
 if(i%60===0)console.log('R26_VOL_FINE_PROGRESS',i,params.length,p.name,m.net,m.dd);
}
const sort=arr=>arr.sort((a,b)=>b.net-a.net||a.dd-b.dd);
const limits=[500,750,1000,1250,1500,2000];
const groups=limits.map(dd=>({dd,count:results.filter(x=>x.dd<=dd).length,
 top:sort(results.filter(x=>x.dd<=dd)).slice(0,15)}));
const best=groups.find(x=>x.dd===1000).top;
const focused=[...new Set([...best.slice(0,9).map(x=>x.name),
 ...groups.find(x=>x.dd===1250).top.slice(0,3).map(x=>x.name)])];
const stress=[];
for(const name of focused){
 const p=params.find(x=>x.name===name);
 for(const [fee,entrySlip] of [[2.5,0],[3,0],[5,0],[2.5,2],[2.5,5],[2.5,10],[2.5,20],[5,5]]){
  const rr=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee,risk:p.risk,
   limit:{...p.limit,breakoutSlippagePoints:entrySlip}});
  const out=metric(rr,p);
  stress.push({name,fee,entrySlip,net:out.net,dd:out.dd,trades:out.trades,win:out.winPct});
 }
}
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-1000-vol-short-fine.json',JSON.stringify({
 generated_at:new Date().toISOString(),tested:params.length,group:groups,stress,all:results,
 note:'Past-only ATR gating and 1TX whole lot. High-vol LONG is closed at next open (not only forbidding a new entry). 2026 is inspected, not pristine OOS.'
},null,2));
fs.writeFileSync('r26-study-output/r26-1000-vol-short-fine.csv',
 'name,net,dd,trades,winPct,skipped,stops,older,val,2026\n'+results.map(x=>
 [x.name,x.net,x.dd,x.trades,x.winPct,x.skips,x.stops,x.phase.older,x.phase.validation,x.phase['2026']].join(',')).join('\n'));
console.log('R26_VOL_FINE_TOP',JSON.stringify(groups));
console.log('R26_VOL_FINE_STRESS',JSON.stringify(stress));
