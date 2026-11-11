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
const masks=[
 {id:'BASE_A_OR_B',flags:regimeFlags(reg,r=>A(r)||B(r))},
 {id:'A_OR_B_EFF',flags:regimeFlags(reg,r=>A(r)||B(r)||(r.efficiency10>.8&&r.features?.mom5>1.5))},
 {id:'BASE_P75',flags:regimeFlags(reg,r=>A(r)||(r.atrPercentile250>=.75&&r.atrSlope5<=-.1&&r.features?.mom5>0))}
];
const origins=[
 {day:200,night:195,mask:'A_OR_B_EFF'},
 {day:205,night:195,mask:'BASE_A_OR_B'},
 {day:200,night:195,mask:'BASE_A_OR_B'},
 {day:195,night:195,mask:'A_OR_B_EFF'},
 {day:205,night:195,mask:'BASE_P75'}
];
const priceEntries=[0,.01,.015,.025,.035,.05,.075,.1,.125];
const windows=[30,60,120,240,840];
const caps=[600,700,800,850,900];
const plans=[];
for(const o of origins){
 const m=masks.find(x=>x.id===o.mask);if(!m)throw Error('bad mask');
 for(const entryATR of priceEntries)for(const entryWindow of windows)for(const cap of caps)
  plans.push({...o,maskFlag:m.flags,entryATR,entryWindow,cap,
   name:'D'+o.day+'N'+o.night+'_'+o.mask+'_E'+entryATR+'_W'+entryWindow+'_C'+cap});
}
function replay(p,{fee=2.5,entrySlippage=0,stopSlippage=0}={}){
 const risk={preopenShortOnlyAboveATRDay:p.day,preopenShortOnlyAboveATRNight:p.night,
  highVolLongRescueFlags:p.maskFlag, equityDdCap:p.cap,
  cooldownReset:true,haltSessions:8,resumeShadowLookback:8,resumeShadowProfit:0,
  shadowPnl:prepared.pnls,hardStopSlippagePoints:stopSlippage};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,
  entryATR:p.entryATR,entryWindow:p.entryWindow,breakoutSlippagePoints:entrySlippage};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
}
const period=(s,lo,hi)=>round(s.rows.filter(x=>x.date>=lo&&x.date<=hi).reduce((a,x)=>a+x.pnl,0));
function score(s,p,additional={}){
 const tx=s.closedTrades;
 return {name:p.name,day:p.day,night:p.night,mask:p.mask,entryATR:p.entryATR,
  entryWindow:p.entryWindow,cap:p.cap,net:round(s.rows.reduce((a,x)=>a+x.pnl,0)),
  dd:round(s.minuteDD),win:round(100*tx.filter(x=>x.pnl>0).length/(tx.length||1)),
  trades:tx.length,entryFillPct:s.eligibleEntries?round(100*s.limitEntries/s.eligibleEntries):null,
  skipped:s.skippedSessions,halts:s.hardStops,train:period(s,'2021-10-22','2023-12-31'),
  validation:period(s,'2024-01-01','2025-12-31'),
  final2026:period(s,'2026-01-01','2026-11-11'),...additional};
}
const standard=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(standard.minuteDD,6106);
assert.equal(round(standard.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<standard.rows.length;i++)assert.equal(standard.rows[i].pnl,prepared.rows[i].pnl);
const golden=plans.find(x=>x.day===200&&x.night===195&&x.mask==='A_OR_B_EFF'&&x.entryATR===.025&&x.entryWindow===60&&x.cap===800);
if(!golden)throw Error('golden missing');
const g=score(replay(golden),golden);
assert.equal(g.net,28082);assert.equal(g.dd,806);
console.log('R26_TRIGGER_GOLD',JSON.stringify({sessions:standard.rows.length,reference:g,total:plans.length}));
const data=[];
for(let i=0;i<plans.length;i++){
 const p=plans[i],result=score(replay(p),p);
 data.push(result);
 if(i%60===0)console.log('R26_TRIGGER_PROGRESS',i,plans.length,result.name,result.net,result.dd);
}
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const acceptable=data.filter(x=>x.train>=5000&&x.validation>=8500&&x.final2026>=1800);
const under1000=rank(acceptable.filter(x=>x.dd<=1000));
const under900=rank(acceptable.filter(x=>x.dd<=900));
const ratio=[...under1000].sort((x,y)=>y.net/y.dd-x.net/x.dd);
const hitting=under1000.filter(x=>x.net>=30000&&x.net/x.dd>=35);
const selected=[...new Set([...under1000.slice(0,16).map(x=>x.name),
 ...under900.slice(0,6).map(x=>x.name),
 ...ratio.slice(0,8).map(x=>x.name),golden.name])];
const stress=[];
for(const name of selected){
 const p=plans.find(x=>x.name===name);
 for(const v of [{fee:2.5,entrySlippage:0,stopSlippage:0},{fee:3,entrySlippage:0,stopSlippage:0},
  {fee:5,entrySlippage:0,stopSlippage:0},
  {fee:2.5,entrySlippage:5,stopSlippage:75},
  {fee:5,entrySlippage:5,stopSlippage:75},
  {fee:5,entrySlippage:10,stopSlippage:100}]){
   stress.push(score(replay(p,v),p,v));
 }
}
const stressBound=rank(stress.filter(x=>x.fee===5&&x.entrySlippage===5&&x.stopSlippage===75&&x.dd<=1000));
const metaReport={generated:new Date().toISOString(),n:plans.length,original:{net:65953,dd:6106},
 reference:g,meeting1000:under1000.length,meeting900:under900.length,
 goal30kRatio35:hitting.slice(0,25),topStrict:under1000.slice(0,25),
 top900:under900.slice(0,20),topRatio:ratio.slice(0,20),stress,stressBound:stressBound.slice(0,25),
 all:data,notes:[
  'Fully isolated R26 research, no actual brokerage transactions or live engine changes',
  'Only prior confirmed daily ATR/price/EMA features and previous completed session close for breakout orders',
  'No initial stop/target edits; risk cap is a modeled equity circuit, not guaranteed fill',
  'One TX whole contract throughout, frozen R26 pnl parity and official extension',
  '2026 has been repeatedly observed during selection. Do not treat 2026 as pristine holdout',
  'Stop-first one-minute OHLC tie-break and market-open adverse gap fills, extra fees and slippage stressed']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-short-trigger-atr-cap-search.json',JSON.stringify(metaReport,null,2));
fs.writeFileSync('r26-study-output/r26-short-trigger-atr-cap-search.csv',
 'name,day,night,mask,entryATR,window,cap,net,dd,ratio,win,trades,train,validation,2026\n'+
 data.map(x=>[x.name,x.day,x.night,x.mask,x.entryATR,x.entryWindow,x.cap,x.net,x.dd,
  round(x.net/x.dd),x.win,x.trades,x.train,x.validation,x.final2026].join(',')).join('\n'));
console.log('R26_TRIGGER_RESULTS',JSON.stringify({n:plans.length,strict:under1000.length,goalCount:hitting.length,
 hits:hitting.slice(0,18),bestStrict:under1000.slice(0,18),ratio:ratio.slice(0,14),stressBound:stressBound.slice(0,15)}));
