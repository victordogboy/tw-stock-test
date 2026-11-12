// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {simulateLimit} from '../public/r26-research/open-limit-orders.mjs';
import {simulateLimitRisk} from '../public/r26-research/combined-breakout-risk.mjs';
import {priorDailyRegimes,regimeFlags} from '../public/r26-research/prior-regime-features.mjs';
import {replaySizedTape} from '../public/r26-research/five-lot-tape.mjs';
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















const complete=prepared.sessions;
const fullReg=priorDailyRegimes(complete);
const at=[...new Set([320,450,720,1110,1460,1800,2100,2428,2442,...[200,125,60,25,12,3].map(n=>complete.length-n)])].filter(n=>n>250&&n<=complete.length).sort((x,y)=>x-y);
const comparison=[];
function compareFeatures(full,partial,k,loc){
 const xs=Object.keys(full||{});
 for(const p of xs){
  const x=full[p],y=partial?.[p];
  if(typeof x==='number'&&Number.isNaN(x)&&typeof y==='number'&&Number.isNaN(y))continue;
  if(typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)){
   if(Math.abs(x-y)>1e-8)throw Error('LOOKAHEAD_FEATURE_'+loc+'_'+k+'_'+p+'_'+x+'_'+y);
  }else if(x!==y)throw Error('FEATURE_DIFFERENCE_'+loc+'_'+k+'_'+p+'_'+x+'_'+y);
 }
}
for(const n of at){
 const subset=complete.slice(0,n);
 const prefixMeta={...meta,sessions:ss.slice(0,n)};
 const cutDate=subset.at(-1).date;
 const prefix=run(prefixMeta,bars,{end:cutDate});
 const prefixReg=priorDailyRegimes(prefix.sessions);
 let nCheck=0,eligible=0;
 for(let i=50;i<n-2;i++){
  const a=complete[i],b=prefix.sessions[i];
  for(const k of ['date','sid','op','cl','atr','signal','blocked','r10','A','guard','gate']){
   if(a[k]!==b[k])throw Error('R26_FUTURE_POLLUTION_'+i+'_'+k+' '+a[k]+' '+b[k]);
  }
  compareFeatures(a.features,b.features,i,'SIGNAL');
  for(const k of ['atr','atrPercentile250','atrSlope5','atrSlope10','atrSlope20',
   'efficiency10','efficiency20','upDays10','historyReady']){
   const x=fullReg[i][k],y=prefixReg[i][k];
   if(typeof x==='number'&&Number.isNaN(x)&&typeof y==='number'&&Number.isNaN(y))continue;
   if(x!==y)throw Error('PREOPEN_REGIME_LOOKAHEAD_'+i+'_'+k+'_'+x+'_'+y);
  }
  if(fullReg[i].historyReady)eligible++;
  nCheck++;
 }
 const item={cut:cutDate,n,compared:nCheck,eligible};
 comparison.push(item);
 console.log('R26_CAUSAL_PREFIX_OK',JSON.stringify(item));
}
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-frozen2tx-causal-prefix.json',JSON.stringify({
 verifiedAt:new Date().toISOString(),prefixChecks:comparison,
 totalCompared:comparison.reduce((a,x)=>a+x.compared,0),
 verified:true,notes:['9 historical data prefixes rerun on only available bars, compare full-series past 1m-derived R26 signals and preopen ATR regime',
  'Last two prefix sessions omitted due to terminal-only forced liquidation and two-session rolling shadow exit influence',
  'This proves these formula outputs do not change when later data appended; it does not prove broker execution or parameter selection OOS',
  'No price or order commands used in production.']
},null,2));
console.log('R26_CAUSAL_PREFIX_REPORT',JSON.stringify({checked:comparison.length,totalCompared:comparison.reduce((a,x)=>a+x.compared,0),
 last:comparison.at(-1)}));
