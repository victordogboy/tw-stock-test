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
const masks=[];
function add(name,a20,mom5,pct,decay5){
 const mask=regimeFlags(reg,r=>(r.atrSlope20<=a20&&r.features?.mom5>mom5)||
  (r.atrPercentile250>=pct&&r.atrSlope5<=decay5&&r.features?.mom5>0));
 masks.push({name,a20,mom5,pct,decay5,mask});
}
add('A25_M2_P70_D10',-.25,2,.7,-.1);
add('A25_M2_P75_D10',-.25,2,.75,-.1);
add('A25_M2_P70_D12',-.25,2,.7,-.12);
add('A25_M1.5_P70_D10',-.25,1.5,.7,-.1);
add('A25_M2.5_P70_D10',-.25,2.5,.7,-.1);
add('A20_M2_P70_D10',-.2,2,.7,-.1);
add('A30_M2_P70_D10',-.3,2,.7,-.1);
const entries=[];
for(const vol of [195,200,205])for(const m of masks)
 for(const atr of [.025,.05,.075,.1])
  for(const window of [30,60,120])
   for(const cap of [800,900]){
    entries.push({name:'V'+vol+'_'+m.name+'_E'+atr+'_W'+window+'_C'+cap,
     vol,mask:m.mask,atr,window,cap});
   }
const make=(p,fee,entrySlip,stopSlip)=>{
 const risk={preopenShortOnlyAboveATR:p.vol,highVolLongRescueFlags:p.mask,
  equityDdCap:p.cap,cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
  resumeShadowProfit:0,shadowPnl:prepared.pnls,hardStopSlippagePoints:stopSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',entryATR:p.atr,
  entryWindow:p.window,onlySide:-1,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
};
const metric=(s,p,fee=2.5,entrySlip=0,stopSlip=0)=>{
 const tx=s.closedTrades,annual={};
 for(let y=2021;y<=2026;y++)annual[y]=round(s.rows.filter(r=>r.date.startsWith(String(y))).reduce((a,r)=>a+r.pnl,0));
 return {name:p.name,vol:p.vol,atr:p.atr,window:p.window,cap:p.cap,
  net:round(s.rows.reduce((a,r)=>a+r.pnl,0)),dd:round(s.minuteDD),win:round(100*tx.filter(t=>t.pnl>0).length/(tx.length||1)),
  trades:tx.length,skipped:s.skippedSessions,hits:s.hardStops,annual,fee,entrySlip,stopSlip};
};
const referenceSim=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(referenceSim.minuteDD,6106);assert.equal(round(referenceSim.rows.reduce((a,b)=>a+b.pnl,0)),65953);
for(let i=0;i<referenceSim.rows.length;i++)assert.equal(referenceSim.rows[i].pnl,prepared.rows[i].pnl);
const outcomes=[];
for(let i=0;i<entries.length;i++){
 const cfg=entries[i],o=metric(make(cfg,2.5,0,0),cfg);
 outcomes.push(o);
 if(i%60===0)console.log('R26_FINAL_GRID_PROGRESS',i,entries.length,o.net,o.dd,o.annual[2026]);
}
function rank(a){return a.sort((x,y)=>y.net-x.net||x.dd-y.dd)}
const stable=rank(outcomes.filter(x=>x.dd<=900));
const all=rank(outcomes.filter(x=>x.dd<=1000));
const close=rank(outcomes.filter(x=>x.dd<=1250));
const selected=[...new Set([...stable.slice(0,5).map(x=>x.name),
 ...all.slice(0,16).map(x=>x.name),'V200_A25_M2_P70_D10_E0.025_W60_C800',
 'V195_A25_M2_P70_D10_E0.025_W60_C800'])];
const stress=[];
for(const name of selected){
 const cfg=entries.find(x=>x.name===name);
 if(!cfg)throw Error('missing '+name);
 for(const [fee,entrySlip,stopSlip] of [[2.5,0,0],[3,0,0],[5,0,0],[2.5,5,75],[2.5,20,75],[5,5,75]]){
  stress.push(metric(make(cfg,fee,entrySlip,stopSlip),cfg,fee,entrySlip,stopSlip));
 }
}
const costRobust=rank(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.stopSlip===75&&x.dd<=1000));
const report={dateEnd:'2026-11-11',origNet:65953,origDD:6106,
 sumCandidates:entries.length,threshold1000:all.length,threshold900:stable.length,
 topUnder1000:all.slice(0,25),topUnder900:stable.slice(0,20),
 costRobust:costRobust.slice(0,20),stress,outcomes,
 note:['High-vol rescue uses ATR 20d contraction vs 20d ago & momentum OR ATR250 percentile plus 5d contraction',
 'Only previous closed daily price/ATR; no look-ahead. Original R26 canonical parity preserved.',
 'May overfit observed 2026, 2026 not blind OOS.',
 'Only 1 TX, each side fees, adverse short-entry and equity stop slippage simulated, not actual broker.']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-regime-local-price-and-trend.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-regime-local-price-and-trend.csv',
 'name,net,dd,win,trades,2021,2022,2023,2024,2025,2026\n'+outcomes.map(x=>[x.name,x.net,x.dd,x.win,x.trades,
 ...[2021,2022,2023,2024,2025,2026].map(y=>x.annual[y])].join(',')).join('\n'));
console.log('R26_FINAL_GRID_SUMMARY',JSON.stringify({n:entries.length,under900:stable.length,under1000:all.length,
 best900:stable.slice(0,12),best1000:all.slice(0,16),
 costRobust:costRobust.slice(0,14)}));
