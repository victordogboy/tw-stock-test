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






const configs=[
 {name:'R26_ORIGINAL',vol:null,atr:0,window:0,cap:0},
 {name:'R26_RISK2500',vol:null,atr:0,window:0,cap:2500},
 {name:'V195_A0.025_W60_C0',vol:195,atr:.025,window:60,cap:0},
 {name:'V195_A0.025_W60_C800',vol:195,atr:.025,window:60,cap:800},
 {name:'V200_A0.025_W60_C0',vol:200,atr:.025,window:60,cap:0},
 {name:'V200_A0.025_W60_C800',vol:200,atr:.025,window:60,cap:800},
 {name:'V200_A0.05_W60_C800',vol:200,atr:.05,window:60,cap:800},
 {name:'V205_A0.05_W60_C800',vol:205,atr:.05,window:60,cap:800},
 {name:'V205_A0.075_W120_C800',vol:205,atr:.075,window:120,cap:800}
];
const round=x=>Math.round(x*100)/100;
const core=(cfg,fee,entrySlip,stopSlip)=>{
 const risk={};
 if(cfg.vol!=null)risk.preopenShortOnlyAboveATR=cfg.vol;
 if(cfg.cap>0)Object.assign(risk,{equityDdCap:cfg.cap,
  cooldownReset:true,haltSessions:8,resumeShadowLookback:8,resumeShadowProfit:0,
  shadowPnl:prepared.pnls,hardStopSlippagePoints:stopSlip});
 const limit=cfg.atr>0?{anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:cfg.atr,entryWindow:cfg.window,breakoutSlippagePoints:entrySlip}:{};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
};
const orig=core(configs[0],2.5,0,0);
assert.equal(orig.minuteDD,6106);assert.equal(orig.rows.reduce((a,b)=>a+b.pnl,0),65953);
for(let i=0;i<orig.rows.length;i++)assert.equal(orig.rows[i].pnl,prepared.rows[i].pnl);
const phases=(sim)=>{
 const results={};
 for(const y of [2021,2022,2023,2024,2025,2026]){
  const p=sim.rows.filter(x=>x.date.startsWith(String(y)));
  results[y]=round(p.reduce((a,v)=>a+v.pnl,0));
 }
 return results;
};
const cases=[];
for(const cfg of configs){
 for(const fee of [2.5,3,5]){
  for(const [entrySlip,stopSlip] of [[0,0],[5,0],[10,0],[20,0],[5,30],[5,75],[20,75]]){
   if(fee===3&&entrySlip!==0&&entrySlip!==5)continue;
   if(fee===5&&entrySlip===10)continue;
   const sim=core(cfg,fee,entrySlip,stopSlip);
   const trades=sim.closedTrades;
   cases.push({name:cfg.name,fee,entrySlip,stopSlip,
    net:round(sim.rows.reduce((a,v)=>a+v.pnl,0)),dd:round(sim.minuteDD),
    trades:trades.length,win:round(100*trades.filter(t=>t.pnl>0).length/(trades.length||1)),
    stops:sim.hardStops,skipped:sim.skippedSessions,entryFillPct:sim.eligibleEntries?round(100*sim.limitEntries/sim.eligibleEntries):null,
    annual:phases(sim),
    riskEvents:fee===2.5&&entrySlip===0&&stopSlip===0?sim.riskTimeline:undefined});
  }
 }
}
const standard=cases.filter(x=>x.fee===2.5&&x.entrySlip===0&&x.stopSlip===0);
const worst=cases.filter(x=>x.fee===5&&x.entrySlip===5&&x.stopSlip===75);
const stressOfTop=cases.filter(x=>x.name==='V200_A0.025_W60_C800'||x.name==='V205_A0.075_W120_C800');
const report={dateEnd:'2026-11-11',frozenGold:2428,officialAdded:expected.length,tests:cases.length,
 standard,worst,stressOfTop,cases,
 notes:['No actual brokerage executions, 1min OHLC stop priority adverse fills',
 '2026 not unseen; selected after observing this historical dataset',
 'Continuous minute maxDD not cumulative 5percent of account unless converted',
 'Fee=per side, slippage beyond fee at conditional entry and equity emergency stop',
 'Pre-open ATR threshold also causes held long to EXIT on subsequent open',
 'Max 1 whole TX, no fractional leverage. Risk cap is an additional circuit, not guaranteed actual fill.'
 ]};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-1000-final-stress.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-1000-final-stress.csv',
 'name,fee,entrySlip,stopSlip,net,dd,win,trades,stops,skip,2021,2022,2023,2024,2025,2026\n'+cases.map(x=>
 [x.name,x.fee,x.entrySlip,x.stopSlip,x.net,x.dd,x.win,x.trades,x.stops,x.skipped,
  x.annual[2021],x.annual[2022],x.annual[2023],x.annual[2024],x.annual[2025],x.annual[2026]].join(',')).join('\n'));
console.log('R26_FINAL_1000_BASELINES',JSON.stringify(standard.map(x=>({name:x.name,net:x.net,dd:x.dd,win:x.win,trades:x.trades,
 annual:x.annual,stops:x.stops,skipped:x.skipped,riskEvents:x.riskEvents}))));
console.log('R26_FINAL_1000_HARDEST',JSON.stringify(worst.map(x=>({name:x.name,net:x.net,dd:x.dd,win:x.win,stops:x.stops}))));
console.log('R26_FINAL_1000_TOP_STRESS',JSON.stringify(stressOfTop.map(x=>({name:x.name,fee:x.fee,entrySlip:x.entrySlip,
 stopSlip:x.stopSlip,net:x.net,dd:x.dd,win:x.win,stops:x.stops}))));
