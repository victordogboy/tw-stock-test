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




const xs=[];
const add=(c,th,atr,window,wait,target=0)=>{
 const risk={equityDdCap:c,cooldownReset:true,haltSessions:wait,
  resumeShadowLookback:8,resumeShadowProfit:target,shadowPnl:prepared.pnls,
  preopenShortOnlyAboveATR:th};
 const limit=atr>0?{anchor:'priorClose',entryMode:'breakout',entryATR:atr,entryWindow:window,onlySide:-1}:{};
 const name='CAP'+c+'_VOL'+th+'_SHORT_ATR'+atr+'_W'+window+'_WAIT'+wait+'_SHADOW'+target;
 xs.push({name,risk,limit,c,th,atr,window,wait,target});
};
for(const c of [200,250,300,350,400,450,500,550,600,650,700,750,800,900,1000]){
 for(const th of [200,250,300,350,400,500,600,800]){
  add(c,th,.05,60,8);
 }
}
for(const c of [250,300,350,400,450,500,600,750]){
 for(const th of [250,300,350,400,500]){
  for(const atr of [0,.025,.075]){
   add(c,th,atr,60,8);
  }
 }
}
for(const c of [250,300,350,400,450,500,600,750]){
 for(const th of [250,300,350,500]){
  for(const wait of [2,5,12]){
   add(c,th,.05,60,wait);
  }
 }
}
for(const c of [300,400,500,750]){
 for(const th of [300,400,500]){
  for(const target of [100,300,600]){
   add(c,th,.05,60,8,target);
  }
 }
}
const out=[],r=x=>Math.round(x*100)/100;
const check=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(check.minuteDD,6106);
assert.equal(r(check.rows.reduce((a,b)=>a+b.pnl,0)),65953);
for(let i=0;i<check.rows.length;i++)assert.equal(check.rows[i].pnl,prepared.rows[i].pnl);
for(let i=0;i<xs.length;i++){
 const a=xs[i],res=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11',
  risk:a.risk,limit:a.limit});
 const net=r(res.rows.reduce((t,v)=>t+v.pnl,0));
 const dd=r(res.minuteDD),tx=res.closedTrades;
 const splits={};
 for(const [name,from,to] of [['train','2021-10-22','2023-12-31'],['validation','2024-01-01','2025-12-31'],
 ['2026','2026-01-01','2026-11-11']]){
  const rr=res.rows.filter(x=>x.date>=from&&x.date<=to);
  splits[name]=r(rr.reduce((t,v)=>t+v.pnl,0));
 }
 out.push({name:a.name,c:a.c,th:a.th,atr:a.atr,window:a.window,wait:a.wait,target:a.target,
  net,dd,trades:tx.length,win:r(100*tx.filter(t=>t.pnl>0).length/(tx.length||1)),
  skipped:res.skippedSessions,stops:res.hardStops,split:splits});
 if(i%40===0)console.log('R26_TARGET_1000_PROGRESS',i,xs.length,a.name,net,dd);
}
const rank=list=>list.sort((a,b)=>b.net-a.net||a.dd-b.dd);
const goals=[500,750,1000,1250,1500,2000].map(goal=>{
 const match=rank(out.filter(x=>x.dd<=goal));
 return {cap:goal,count:match.length,best:match.slice(0,15)};
});
const best=rank(out.filter(x=>x.dd<=1000));
const probe=[...new Set([...best.slice(0,7).map(x=>x.name),
 ...rank(out.filter(x=>x.dd<=1250)).slice(0,3).map(x=>x.name)])];
const stressed=[];
for(const name of probe){
 const cfg=xs.find(x=>x.name===name);
 for(const fee of [2.5,3,5]){
  for(const slip of [0,15,50,75]){
   if(fee!==2.5&&slip!==0&&slip!==75)continue;
   const res=simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',
    risk:{...cfg.risk,hardStopSlippagePoints:slip},limit:cfg.limit});
   stressed.push({name,fee,slip,net:r(res.rows.reduce((a,x)=>a+x.pnl,0)),
    dd:r(res.minuteDD),stops:res.hardStops});
  }
 }
}
fs.mkdirSync('r26-study-output',{recursive:true});
const report={updatedAt:new Date().toISOString(),tested:xs.length,
 originalNet:65953,originalDd:6106,goals,strictBest:best.slice(0,20),stress:stressed,
 caution:['1 TX no position sizing','2.5 points per side reference','2026 is no longer blind validation',
 'Cumulative minute equity DD measured without resetting after risk halt',
 'Only previous session ATR/close/shadow PnL used to activate pre-market signals',
 '1 minute OHLC and assumed fill do not guarantee live execution'],all:out};
fs.writeFileSync('r26-study-output/r26-1000-tuned-vol-short.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-1000-tuned-vol-short.csv',
 'name,net,dd,win,trades,stops,skipped,train,validation,2026\n'+out.map(x=>
 [x.name,x.net,x.dd,x.win,x.trades,x.stops,x.skipped,x.split.train,x.split.validation,x.split['2026']].join(',')).join('\n'));
console.log('R26_TARGET_1000_RESULTS',JSON.stringify({tested:xs.length,goals}));
console.log('R26_TARGET_1000_STRESS',JSON.stringify(stressed));
