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



const sum=xs=>xs.reduce((a,x)=>a+x,0),round=x=>Math.round(x*100)/100;
const phases=[
 {id:'2021-2023',start:'2021-10-22',end:'2023-12-31'},
 {id:'2024-2025',start:'2024-01-01',end:'2025-12-31'},
 {id:'2026',start:'2026-01-01',end:'2026-11-11'},
 {id:'recent24',start:'2026-10-27',end:'2026-11-11'}];
const capRisk=(cap,wait=8,lookback=8,profit=0,more={})=>{
 if(!cap)return more;
 return {equityDdCap:cap,haltSessions:wait,cooldownReset:true,
  resumeShadowLookback:lookback,resumeShadowProfit:profit,shadowPnl:prepared.pnls,...more};
};
const make={};
const variants=[];
const add=(name,cap,wait=8,lookback=8,profit=0,filters={},limit={})=>variants.push({
 name,risk:capRisk(cap,wait,lookback,profit,filters),limit
});
add('R26_BASE',0);
add('R26_RISK_2250',2250);
add('R26_RISK_2500',2500);
add('R26_PREV_SHORT_0.025_W60_RISK_2500',2500,8,8,0,{},
 {anchor:'priorClose',entryMode:'breakout',entryATR:.025,entryWindow:60,onlySide:-1});
for(const cap of [200,300,400,500,600,700,800,900,1000,1250,1500]){
 for(const wait of [2,5,8,16,30]){
  for(const target of [0,300]){
   add('CAP_'+cap+'_WAIT_'+wait+'_SHADOW8_'+target,cap,wait,8,target);
  }
 }
}
for(const cap of [300,500,700,900,1100,1500]){
 for(const s of [80,100,125,150,200,250,300,400,500]){
  add('CAP_'+cap+'_MAXSTOP_'+s,cap,8,8,0,{coreMaxStopPoints:s});
 }
}
for(const cap of [0,300,500,750,1000,1500]){
 for(const t of [80,100,120,150,175,200,250,300,400,500,700,900]){
  add('CAP_'+cap+'_PRESTOP_'+t,cap,8,8,0,{preopenMaxStopDistance:t});
 }
}
for(const cap of [0,300,500,750,1000,1500]){
 for(const atr of [150,200,300,400,500,650,800,1000]){
  add('CAP_'+cap+'_ATRMAX_'+atr,cap,8,8,0,{preopenMaxATR:atr});
 }
}
for(const cap of [0,300,500,750,1000]){
 for(const ratio of [.005,.0075,.01,.015,.02,.025,.03,.04]){
  add('CAP_'+cap+'_ATR_RATIO_'+ratio,cap,8,8,0,{preopenMaxATRRRatio:ratio});
 }
}
for(const cap of [0,300,500,750,1000,1500]){
 for(const side of [-1,1]){
  add('CAP_'+cap+'_ONLY_'+side,cap,8,8,0,{onlyDirection:side});
 }
}
for(const cap of [300,500,750,1000,1500]){
 for(const wait of [5,8,16]){
  for(const dist of [.025,.05,.075,.1]){
   add('CAP_'+cap+'_SHORT_'+dist+'_WAIT_'+wait,cap,wait,8,0,{},
    {anchor:'priorClose',entryMode:'breakout',entryATR:dist,entryWindow:60,onlySide:-1});
  }
 }
}
for(const cap of [300,500,750,1000]){
 for(const dist of [100,150,200,300]){
  for(const wait of [5,12]){
   add('CAP_'+cap+'_STOP_'+dist+'_WAIT_'+wait+'_SHORT_0.05',cap,wait,8,0,
    {coreMaxStopPoints:dist},{anchor:'priorClose',entryMode:'breakout',entryATR:.05,entryWindow:60,onlySide:-1});
  }
 }
}
for(const cap of [300,500,750,1000]){
 for(const preDist of [100,150,250,400]){
  for(const minAtr of [300,600]){
   add('CAP_'+cap+'_PRESTOP_'+preDist+'_ATR_'+minAtr,cap,8,8,0,
    {preopenMaxStopDistance:preDist,preopenMaxATR:minAtr});
  }
 }
}
function score(res,meta){
 let total=0,high=0,closeDd=0;
 for(const x of res.rows){total+=x.pnl;high=Math.max(high,total);closeDd=Math.max(closeDd,high-total)}
 const split=Object.fromEntries(phases.map(p=>{
  const rows=res.rows.filter(x=>x.date>=p.start&&x.date<=p.end);
  const trades=res.closedTrades.filter(x=>x.exitDate>=p.start&&x.exitDate<=p.end);
  let n=0,peak=0,dd=0;
  for(const row of rows){n+=row.pnl;peak=Math.max(peak,n);dd=Math.max(dd,peak-n)}
  return [p.id,{net:round(n),closeDd:round(dd),trades:trades.length,
   winPct:round(100*trades.filter(x=>x.pnl>0).length/(trades.length||1))}];
 }));
 return {name:meta.name,net:round(total),minuteDd:round(res.minuteDD),closeDd:round(closeDd),
  deals:res.closedTrades.length,winPct:round(res.closedTrades.filter(x=>x.pnl>0).length*100/(res.closedTrades.length||1)),
  halted:res.hardStops,skipped:res.skippedSessions,limitFillPct:res.eligibleEntries?round(100*res.limitEntries/res.eligibleEntries):null,
  split};
}
const org=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5});
assert.equal(sum(org.rows.map(x=>x.pnl)),65953);
assert.equal(org.minuteDD,6106);
for(let i=0;i<org.rows.length;i++)assert.equal(org.rows[i].pnl,prepared.rows[i].pnl);
console.log('R26_LOWDD_BASELINE_PARITY',JSON.stringify({sessions:org.rows.length,events:org.events.length,
 net:sum(org.rows.map(x=>x.pnl)),minuteDd:org.minuteDD}));
const result=[];
for(let i=0;i<variants.length;i++){
 const cfg=variants[i];
 const res=simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee:2.5,limit:cfg.limit,risk:cfg.risk});
 const out=score(res,cfg);
 if(!Number.isFinite(out.net)||!Number.isFinite(out.minuteDd))throw Error('Invalid '+cfg.name);
 result.push(out);
 if(i%40===0)console.log('R26_LOWDD_PROGRESS',i,variants.length,out.name,out.net,out.minuteDd);
}
function rank(rows){return rows.sort((a,b)=>b.net-a.net||a.minuteDd-b.minuteDd)}
const under1000=rank(result.filter(x=>x.minuteDd<=1000));
const under1250=rank(result.filter(x=>x.minuteDd<=1250));
const under1500=rank(result.filter(x=>x.minuteDd<=1500));
const under2000=rank(result.filter(x=>x.minuteDd<=2000));
const nets=rank([...result]).slice(0,15);
const nondummy=rank(result.filter(x=>x.net>=10000&&x.deals>=100));
const report={generated_at:new Date().toISOString(),scope:'2021-10-22..2026-11-11',gold:2428,added:expected.length,
 feePerSide:2.5,notFuture:true,variantCount:variants.length,
 note:'No portfolio DD resets; no materiality or exposure cut; max 1 TX, each trade integer',
 original:result[0],under1000,under1250,under1500,under2000,
 strongAt1000:under1000.filter(x=>x.net>=30000),
 bestNet:nets,substantialTrading:nondummy.slice(0,25),results:result};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-1000pt-dd-sweep.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-1000pt-dd-sweep.csv',
 'name,net,minuteDd,winPct,trades,halted,skipped,train,val,holdout\n'+result.map(x=>
 [x.name,x.net,x.minuteDd,x.winPct,x.deals,x.halted,x.skipped,x.split['2021-2023'].net,
  x.split['2024-2025'].net,x.split['2026'].net].join(',')).join('\n'));
console.log('R26_LOWDD_RESULTS',JSON.stringify({tested:variants.length,under1000:under1000.length,
 under1250:under1250.length,under1500:under1500.length,under2000:under2000.length,
 bestUnder1000:under1000.slice(0,14),bestUnder1250:under1250.slice(0,12),
 bestUnder1500:under1500.slice(0,12),
 bestUnder2000:under2000.slice(0,12),substantial:nondummy.slice(0,10)}));
