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
const round=n=>Math.round(n*100)/100;
const masks=[];
const add=(name,func)=>masks.push({name,mask:regimeFlags(rg,func)});
const a=r=>r.atrSlope20<=-.25&&r.features?.mom5>2;
const b=r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0;
add('BASE_A_OR_B',r=>a(r)||b(r));
add('A_ONLY',a);
add('B_ONLY',b);
add('A_OR_B_EFF',r=>a(r)||b(r)||(r.efficiency10>.8&&r.features?.mom5>1.5));
add('A_OR_B_2026_TREND',r=>a(r)||b(r)||(r.features?.slope>.25&&r.features?.mom5>2));
add('B_OR_STRONG_TREND',r=>b(r)||(r.efficiency20>.7&&r.features?.mom5>2));
add('A_OR_B_BREAKOUT',r=>a(r)||b(r)||(r.features?.dist>2&&r.features?.mom5>1&&r.features?.slope>.2));
add('STRONG_TREND',r=>r.features?.slope>.5&&r.features?.mom5>1.5&&r.features?.ratio>.9);
add('NO_RESCUE',()=>false);
const thresholdDay=[180,195,200,205,210,225,250,275,300,350,400,500];
const thresholdNight=[180,195,200,205,210,225,250,275,300,350,400,500];
const options=[];
for(const m of masks)for(const day of thresholdDay)for(const night of thresholdNight)
 options.push({name:'D'+day+'_N'+night+'_'+m.name,day,night,m});
function replay(v,{fee=2.5,entrySlip=0,riskSlip=0,cap=800,wait=8}={}){
 const risk={preopenShortOnlyAboveATRDay:v.day,preopenShortOnlyAboveATRNight:v.night,
  highVolLongRescueFlags:v.m.mask,
  equityDdCap:cap,cooldownReset:true,haltSessions:wait,resumeShadowLookback:8,
  resumeShadowProfit:0,shadowPnl:prepared.pnls,hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:.025,entryWindow:60,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
}
function pnlRows(r,from,to){
 return round(r.rows.filter(x=>x.date>=from&&x.date<=to).reduce((a,b)=>a+b.pnl,0));
}
function score(s,v,extra={}){
 const trades=s.closedTrades;
 return {name:v.name,day:v.day,night:v.night,mask:v.m.name,
  net:round(s.rows.reduce((a,x)=>a+x.pnl,0)),dd:round(s.minuteDD),
  win:round(100*trades.filter(t=>t.pnl>0).length/(trades.length||1)),
  trades:trades.length,skipped:s.skippedSessions,circuit:s.hardStops,
  early:pnlRows(s,'2021-10-22','2023-12-31'),validation:pnlRows(s,'2024-01-01','2025-12-31'),
  holdout:pnlRows(s,'2026-01-01','2026-11-11'),
  ...extra};
}
const control=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(control.minuteDD,6106);
assert.equal(round(control.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<control.rows.length;i++)assert.equal(control.rows[i].pnl,prepared.rows[i].pnl);
const fixed=options.find(x=>x.day===200&&x.night===200&&x.m.name==='BASE_A_OR_B');
assert.ok(fixed);
const fixedScore=score(replay(fixed),fixed);
assert.equal(fixedScore.net,27183);
assert.equal(fixedScore.dd,806);
console.log('R26_SESSION_VOL_PARITY',JSON.stringify({sessions:control.rows.length,originalNet:65953,origDD:6106,
  base:fixedScore,nVariants:options.length}));
const results=[];
for(let i=0;i<options.length;i++){
 const v=options[i],sc=score(replay(v),v);
 results.push(sc);
 if(i%50===0)console.log('R26_SESSION_VOL_PROGRESS',i,options.length,sc.name,sc.net,sc.dd);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const eligible=results.filter(x=>x.early>=2000&&x.validation>=8000&&x.holdout>=1500&&x.trades>=250);
const strict=rank(eligible.filter(x=>x.dd<=1000));
const near=rank(eligible.filter(x=>x.dd<=1100));
const ratio=[...strict].sort((a,b)=>b.net/b.dd-a.net/a.dd);
const any=rank([...results]).slice(0,20);
const selected=[...new Set([...strict.slice(0,15).map(x=>x.name),
  ...ratio.slice(0,8).map(x=>x.name),
  'D200_N200_BASE_A_OR_B'])];
const stress=[];
for(const name of selected){
 const v=options.find(x=>x.name===name);
 for(const q of [
  {fee:2.5,entrySlip:0,riskSlip:0},{fee:3,entrySlip:0,riskSlip:0},
  {fee:5,entrySlip:0,riskSlip:0},{fee:2.5,entrySlip:5,riskSlip:75},
  {fee:5,entrySlip:5,riskSlip:75},{fee:5,entrySlip:10,riskSlip:100}
 ]){
  const sim=replay(v,q);
  stress.push(score(sim,v,q));
 }
}
const stable=rank(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const report={period:'2021-10-22 .. 2026-11-11',sampleSessions:prepared.rows.length,
 tests:options.length,sessionThresholds:thresholdDay,
 frozenBaseline:{net:65953,dd:6106},fixed:fixedScore,eligible:eligible.length,
 bestStrict:strict.slice(0,30),bestRatio:ratio.slice(0,25),best1100:near.slice(0,15),
 strongestAny: any,stress,robustCost:stable.slice(0,20),all:results,
 caveats:[
  'Day/night specific ATR absolute-point thresholds based on past completed DAY candle',
  'NO in-session future high-low used to decide entry or regime',
  'Only one TX; original 2.5pt per side, stress 5pt + 5 to 10pt breakout + 75/100pt risk stop',
  'Preexisting core LONG closes at open if day/night high ATR long veto; this is an exposure strategy not just opening a position filter',
  '2026 has been inspected during earlier optimizations; no truly blind external sample',
  '1 minute OHLC stop-first fills and synthetic stress are not guaranteed actual broker executions'
 ]};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-session-atr-daynight-risk.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-session-atr-daynight-risk.csv',
 'name,day,night,mask,net,dd,netDd,win,trades,early,validation,2026\n'+results.map(x=>
 [x.name,x.day,x.night,x.mask,x.net,x.dd,round(x.net/x.dd),x.win,x.trades,x.early,x.validation,x.holdout].join(',')).join('\n'));
console.log('R26_SESSION_VOL_RESULTS',JSON.stringify({
 n:options.length,eligible:eligible.length,under1000:strict.length,
 best:strict.slice(0,20),ratios:ratio.slice(0,15),robust:stable.slice(0,18)
}));
