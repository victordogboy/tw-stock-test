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







const round=x=>Math.round(x*100)/100;
const runs=[];
const add=(ratio,atr,window,cap)=>{
 const risk={preopenShortOnlyAboveATRRatio:ratio};
 if(cap)Object.assign(risk,{equityDdCap:cap,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls});
 const limit=atr>0?{anchor:'priorClose',onlySide:-1,entryMode:'breakout',entryATR:atr,entryWindow:window}:{};
 const name='R'+ratio+'_ATR'+atr+'_W'+window+'_C'+cap;
 runs.push({name,ratio,atr,window,cap,risk,limit});
};
for(const ratio of [.002,.003,.004,.005,.006,.0075,.009,.01,.012,.015,.018,.02,.025,.03,.035]){
 for(const atr of [0,.025,.05,.075])
  for(const window of [60,120])
   for(const cap of [0,800])add(ratio,atr,window,cap);
}
const baseline=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(baseline.minuteDD,6106);
assert.equal(round(baseline.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<prepared.rows.length;i++)assert.equal(baseline.rows[i].pnl,prepared.rows[i].pnl);
const out=[];
for(let i=0;i<runs.length;i++){
 const c=runs[i],res=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5,limit:c.limit,risk:c.risk});
 const net=round(res.rows.reduce((a,x)=>a+x.pnl,0));
 const trades=res.closedTrades;
 const years=Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[y,
  round(res.rows.filter(x=>x.date.startsWith(String(y))).reduce((a,x)=>a+x.pnl,0))]));
 out.push({name:c.name,ratio:c.ratio,atr:c.atr,window:c.window,cap:c.cap,
  net,dd:round(res.minuteDD),trades:trades.length,
  win:round(100*trades.filter(x=>x.pnl>0).length/(trades.length||1)),
  skips:res.skippedSessions,stops:res.hardStops,years});
 if(i%35===0)console.log('R26_RATIO1000_PROGRESS',i,runs.length,c.name,net,res.minuteDD);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const groups=[750,1000,1250,1500,2000].map(dd=>({dd,count:out.filter(x=>x.dd<=dd).length,
 top:rank(out.filter(x=>x.dd<=dd)).slice(0,12)}));
const best=groups.find(x=>x.dd===1000).top;
const chosen=best.slice(0,6);
const stress=[];
for(const x of chosen){
 const cfg=runs.find(z=>z.name===x.name);
 for(const [fee,entrySlip,riskSlip] of [[2.5,0,0],[2.5,5,75],[2.5,20,75],[5,5,75]]){
  const res=simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',
   risk:{...cfg.risk,hardStopSlippagePoints:riskSlip},
   limit:{...cfg.limit,breakoutSlippagePoints:entrySlip}});
  stress.push({name:x.name,fee,entrySlip,riskSlip,
   net:round(res.rows.reduce((a,t)=>a+t.pnl,0)),dd:round(res.minuteDD)});
 }
}
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-atr-ratio-preopen-sweep.json',JSON.stringify({
 timestamp:new Date().toISOString(),dateEnd:'2026-11-11',scope:'one TX whole lot, 1 minute TX OHLC',
 count:runs.length,groups,stress,all:out,
 note:'Prior close and ATR only; 2026 repeatedly observed in tuning; risk reset is local not lifetime MDD'
},null,2));
fs.writeFileSync('r26-study-output/r26-atr-ratio-preopen-sweep.csv',
 'name,net,dd,win,trades,skips,stops,2021,2022,2023,2024,2025,2026\n'+out.map(x=>
 [x.name,x.net,x.dd,x.win,x.trades,x.skips,x.stops,...[2021,2022,2023,2024,2025,2026].map(y=>x.years[y])].join(',')).join('\n'));
console.log('R26_RATIO1000_RESULTS',JSON.stringify(groups));
console.log('R26_RATIO1000_STRESS',JSON.stringify(stress));
