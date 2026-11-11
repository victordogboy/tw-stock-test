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
assert.equal(rg.length,prepared.sessions.length);
const round=x=>Math.round(x*100)/100, flags=[];
const add=(name,fn)=>flags.push({name,mask:regimeFlags(rg,fn)});
add('NONE',()=>false);add('ALL',()=>true);
for(const n of [5,10,20])for(const a of [-.25,-.15,-.1,-.05,0])
 for(const mom of [0,.5,1,2])
  add('ATR'+n+'_BELOW'+a+'_MOM'+mom,r=>r['atrSlope'+n]<=a&&r.features?.mom5>mom);
for(const slope of [-.1,0,.1,.25,.5,.75])for(const mom of [0,.5,1,2,3])
 add('EMA_SLOPE'+slope+'_MOM'+mom,r=>r.features?.slope>slope&&r.features?.mom5>mom);
for(const er of [.2,.35,.5,.65,.8])for(const mom of [0,.5,1,2])for(const n of [10,20])
 add('EFF'+n+'_ABOVE'+er+'_MOM'+mom,r=>r['efficiency'+n]>=er&&r.features?.mom5>mom);
for(const pct of [.25,.5,.75,.9])for(const a of [-.15,-.1,-.05,0]){
 add('PCT_ABOVE'+pct+'_ATR5_BELOW'+a,r=>r.atrPercentile250>=pct&&r.atrSlope5<=a&&r.features?.mom5>0);
 add('PCT_BELOW'+pct+'_ATR5_BELOW'+a,r=>r.atrPercentile250<=pct&&r.atrSlope5<=a&&r.features?.mom5>0);
}
for(const up of [.5,.6,.7,.8])for(const mom of [0,.5,1,2])
 add('UP10_ABOVE'+up+'_MOM'+mom,r=>r.upDays10>=up&&r.features?.mom5>mom);
for(const mom of [.5,1,2,3,4])for(const ratio of [.75,.9,1.05,1.2])
 add('MOM10_ABOVE'+mom+'_RATIO_BELOW'+ratio,r=>r.features?.mom10>mom&&r.features?.ratio<ratio);
for(const rsi of [45,55,60,65,70])for(const slope of [0,.1,.25])
 add('RSI_ABOVE'+rsi+'_SLOPE_ABOVE'+slope,r=>r.features?.rsi>=rsi&&r.features?.slope>slope);
const ref=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(ref.minuteDD,6106);
assert.equal(round(ref.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<ref.rows.length;i++)assert.equal(ref.rows[i].pnl,prepared.rows[i].pnl);
const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,entryATR:.025,entryWindow:60};
const evaluate=(s,name,vol,mask)=>{
 const tx=s.closedTrades,annual={};
 for(let y=2021;y<=2026;y++)annual[y]=round(s.rows.filter(x=>x.date.startsWith(String(y))).reduce((a,x)=>a+x.pnl,0));
 return {name,vol,rescues:mask?.filter(Boolean).length??0,
  net:round(s.rows.reduce((a,x)=>a+x.pnl,0)),dd:round(s.minuteDD),
  win:round(100*tx.filter(x=>x.pnl>0).length/(tx.length||1)),trades:tx.length,
  skipped:s.skippedSessions,stops:s.hardStops,annual};
};
const results=[];
for(const vol of [195,200,205,225,250,300]){
 for(let i=0;i<flags.length;i++){
  const f=flags[i],risk={preopenShortOnlyAboveATR:vol,highVolLongRescueFlags:f.mask,
   equityDdCap:800,cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
   resumeShadowProfit:0,shadowPnl:prepared.pnls};
  const s=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11',risk,limit});
  const z=evaluate(s,'VOL'+vol+'_'+f.name,vol,f.mask);z.filter=f.name;
  results.push(z);
  if(i%80===0)console.log('R26_RESCUE_PROGRESS',vol,i,flags.length,z.net,z.dd,z.annual[2026]);
 }
}
const baseline=results.find(x=>x.name==='VOL200_NONE');
assert.equal(baseline.net,23009,'ATR200 parity NET');
assert.equal(baseline.dd,764,'ATR200 parity DD');
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const grouped=[750,1000,1250,1500,2000].map(dd=>{
 const items=rank(results.filter(x=>x.dd<=dd));
 return {dd,count:items.length,top:items.slice(0,12)};
});
const recovered=rank(results.filter(x=>x.dd<=1000&&x.annual[2026]>baseline.annual[2026]));
const report={generated:new Date().toISOString(),total:results.length,
 filters:flags.length,firstReady:rg.find(x=>x.historyReady)?.date,
 baseline,grouped,recovered2026:recovered.slice(0,25),results,
 note:'All signals derived from previous completed day; R26 1lot frozen baseline strict parity. Study 2026 seen before, overfit risk. 2.5pt per-side costs; 1min OHLC cannot verify execution'};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-highvol-trend-rescue.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-highvol-trend-rescue.csv',
 'name,vol,filter,rescues,net,dd,win,trades,skipped,stops,2021,2022,2023,2024,2025,2026\n'+
 results.map(x=>[x.name,x.vol,x.filter,x.rescues,x.net,x.dd,x.win,x.trades,x.skipped,x.stops,
 ...[2021,2022,2023,2024,2025,2026].map(y=>x.annual[y])].join(',')).join('\n'));
console.log('R26_RESCUE_SUMMARY',JSON.stringify({
 total:results.length,filters:flags.length,
 baseline:{net:baseline.net,dd:baseline.dd,win:baseline.win,y2026:baseline.annual[2026]},
 grouped,recovered2026:recovered.slice(0,15)
}));
