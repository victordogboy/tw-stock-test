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
const strong=regimeFlags(reg,r=>r.atrSlope20<=-.25&&r.features?.mom5>2);
const cool=regimeFlags(reg,r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0);
const joint=strong.map((x,i)=>x||cool[i]);
const none=strong.map(()=>false);
const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,entryATR:.025,entryWindow:60};
function make(name,vol,mask,fee=2.5,entrySlip=0,stopSlip=0){
 const risk={preopenShortOnlyAboveATR:vol,highVolLongRescueFlags:mask,
  equityDdCap:800,cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
  resumeShadowProfit:0,shadowPnl:prepared.pnls,hardStopSlippagePoints:stopSlip};
 const s=simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,
  limit:{...limit,breakoutSlippagePoints:entrySlip}});
 const profit=s.rows.reduce((a,r)=>a+r.pnl,0);
 const trades=s.closedTrades;
 return {name,s,net:round(profit),dd:round(s.minuteDD),trades:trades.length,
  win:round(100*trades.filter(t=>t.pnl>0).length/(trades.length||1)),
  skipped:s.skippedSessions,hardStop:s.hardStops,fee,entrySlip,stopSlip,
  annual:Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[y,
   round(s.rows.filter(r=>r.date.startsWith(String(y))).reduce((a,r)=>a+r.pnl,0))]))};
}
const original=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(original.minuteDD,prepared.minuteDD);
assert.equal(round(original.rows.reduce((a,r)=>a+r.pnl,0)),65953);
for(let i=0;i<original.rows.length;i++)assert.equal(original.rows[i].pnl,prepared.rows[i].pnl);
const base=make('FIXED_ATR200',200,none);
const rescue=make('HIGHVOL_LONG_RESCUE_OR',200,joint);
assert.equal(base.net,23009);assert.equal(base.dd,764);
assert.equal(rescue.net,27183);assert.equal(rescue.dd,806);
const stressed=make('HIGHVOL_LONG_RESCUE_OR_STRESS',200,joint,5,5,75);
assert.equal(stressed.net,24492);assert.equal(stressed.dd,943);
const byMonth=new Map(),perSession=[];
for(let i=0;i<base.s.rows.length;i++){
 const a=base.s.rows[i],b=rescue.s.rows[i];
 const delta=b.pnl-a.pnl;
 perSession.push({date:b.date,sid:b.sid,atr:b.atr,orig:original.rows[i].pnl,
  filtered:a.pnl,rescued:b.pnl,delta,signal:b.signal,held:b.held,
  rescueApproved:joint[i]===true&&b.atr>200,contract:b.contract});
 const month=b.date.slice(0,7);
 if(!byMonth.has(month))byMonth.set(month,{month,delta:0,orig:0,filtered:0,rescued:0,changedSessions:0});
 const z=byMonth.get(month);z.delta+=delta;z.orig+=original.rows[i].pnl;
 z.filtered+=a.pnl;z.rescued+=b.pnl;
 if(Math.abs(delta)>1e-6)z.changedSessions++;
}
const monthly=[...byMonth.values()].map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>
 [k,typeof v==='number'?round(v):v]))).sort((x,y)=>x.month.localeCompare(y.month));
function marketBuyHold(sessions,bars,fee=2.5){
 let equity=0,peak=0,mdd=0,contract='',lastCl=null,prev=null,count=0,rolls=0,first=null;
 const years={},rows=[];
 for(const s of sessions){
  if(s.date<'2021-10-22'||s.date>'2026-11-11')continue;
  if(!first){first={date:s.date,price:s.op,contract:s.contract};equity-=fee;}
  else if(contract===s.contract)equity+=s.op-lastCl;
  else{equity-=2*fee;rolls++;}
  peak=Math.max(peak,equity);mdd=Math.max(mdd,peak-equity);
  for(let b=0;b<s.count;b++){
   const at=(s.offset+b)*4,mark=equity+bars[at+3]-s.op;
   peak=Math.max(peak,mark);mdd=Math.max(mdd,peak-mark);
  }
  const openEquity=equity;
  equity+=s.cl-s.op;years[s.date.slice(0,4)]=(years[s.date.slice(0,4)]||0)+(equity-(prev?.equity??0));
  rows.push({date:s.date,sid:s.sid,equity,contract:s.contract});
  prev={equity};lastCl=s.cl;contract=s.contract;count++;
 }
 equity-=fee;mdd=Math.max(mdd,peak-equity);
 return {net:round(equity),minuteDD:round(mdd),rolls,sessionCount:count,first,
  last:{date:rows.at(-1)?.date,close:lastCl,contract},feePerSide:fee,
  note:'One long TX, continuously rolled each contract change, no price discontinuity booked at month switch; open/roll/close costs only.'};
}
const buyHold=marketBuyHold(prepared.sessions,bars);
const aggregate=x=>({name:x.name,net:x.net,dd:x.dd,win:x.win,trades:x.trades,
 skipped:x.skipped,hardStop:x.hardStop,fee:x.fee,entrySlip:x.entrySlip,stopSlip:x.stopSlip,annual:x.annual});
const report={
 audit:'original 2452 R26 1m pnl and maxDD full parity',
 model:'ATR200 long rescue: (ATR20 down>=25pct vs 20d ago AND mom5>2ATR) OR (ATR20>=70th percentile trailing250 AND ATR20 down>=10pct vs 5d ago AND mom5>0)',
 original:{net:65953,dd:6106},
 benchmarkLongTX:buyHold,base:aggregate(base),candidate:aggregate(rescue),
 stress:aggregate(stressed),rescueMaskCount:joint.filter(Boolean).length,
 rescueAnnual2026:rescue.annual?.[2026],monthly,perSession,
 limitations:['Last completed-day ATR/percentile/price-only features; no within-session futures',
  'High-ATR filter force closes preexisting LONG at opening when no rescue',
  'Intraminute OHLC stop-first & artificial slippage vs actual order book unknown',
  '2026 inspected before choosing parameters; not prospective OOS',
  'Broker no actual positions or order confirmations; do not deploy over R26'];
};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-regime-final-audit.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-regime-monthly.csv',
 'month,r26Original,atr200,rescue,improvement,changedSessions\n'+monthly.map(x=>
 [x.month,x.orig,x.filtered,x.rescued,x.delta,x.changedSessions].join(',')).join('\n'));
fs.writeFileSync('r26-study-output/r26-regime-per-session.csv',
 'date,sid,contract,atr,signal,held,orig,filtered,rescued,delta,rescueApproved\n'+perSession.map(x=>
 [x.date,x.sid,x.contract,x.atr,x.signal,x.held,x.orig,x.filtered,x.rescued,x.delta,x.rescueApproved].join(',')).join('\n'));
console.log('R26_REGIME_FINAL_AUDIT',JSON.stringify({
 sessions:perSession.length,original:report.original,buyHold:report.benchmarkLongTX,
 baseline:report.base,rescue:report.candidate,stress:report.stress,
 bestRescueMonths:monthly.filter(x=>x.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,10),
 worstRescueMonths:monthly.filter(x=>x.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,10)
}));
