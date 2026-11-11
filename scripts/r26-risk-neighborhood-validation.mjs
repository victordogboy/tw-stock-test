import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {researchSimulate} from '../public/r26-research/core-profit-overlay.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const dir='public/r26-engine/data/';
const meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(dir+'manifest.json.gz')));
const z=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(n=>fs.readFileSync(dir+n))));
const frozen=new Int32Array(z.buffer,z.byteOffset,z.byteLength/4);
const baselineFrozen=run(meta,frozen,{end:meta.end});
assert.equal(audit(baselineFrozen,meta).pass,true);
const seed=JSON.parse(zlib.gunzipSync(fs.readFileSync(dir+'recent.json.gz')));
const cal=extendTaifexCalendar2026(seed.calendar);
const archive=JSON.parse(zlib.gunzipSync(fs.readFileSync(dir+'verified-official-backfill.json.gz')));
assert.equal(archive.last_complete_trade_day,'2026-11-11');
const expected=physicalSessions(cal,meta.end,Date.parse('2026-11-11T14:00:00+08:00'));
const groups=new Map();for(const r of archive.rows){if(!groups.has(r.session_key))groups.set(r.session_key,[]);groups.get(r.session_key).push(r)}
let ss=meta.sessions.map(x=>({...x})),extra=[];
for(const x of expected){
 const rr=(groups.get(x.key)||[]).filter(r=>r.contract_verified&&r.source==='TAIFEX official ticks'&&r.trade_date===x.date)
  .sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 if(x.sid===1?rr.length!==300:rr.length<750||rr.length>840)throw Error('Unverified '+x.key);
 const prev=ss.at(-1),lastIndex=(prev.offset+prev.count-1)*4+3,lastClose=lastIndex<frozen.length?frozen[lastIndex]:extra[lastIndex-frozen.length];
 const close=rr.at(-1).close;
 ss.push({...x,contract:rr[0].contract_date,offset:(frozen.length+extra.length)/4,count:rr.length,
  start:rr[0].timestamp_tpe,end:rr.at(-1).timestamp_tpe,source:'TAIFEX official ticks',
  market:prev.contract===rr[0].contract_date?close-lastClose:close-rr[0].open-5});
 for(const r of rr)extra.push(r.open,r.high,r.low,r.close);
}
const bars=new Int32Array(frozen.length+extra.length);bars.set(frozen);bars.set(extra,frozen.length);
const core=run({...meta,sessions:ss},bars,{end:'2026-11-11'});
const base=researchSimulate(core.sessions,bars,{end:'2026-11-11'});
assert.equal(base.minuteDD,core.minuteDD);
for(let i=0;i<base.rows.length;i++)assert.equal(base.rows[i].pnl,core.rows[i].pnl);
const n=x=>Math.round(x*100)/100;
const calc=(res)=>{
 const rows=res.rows,tx=res.closedTrades;let total=0,peak=0,dd=0;
 const phase=(start,end)=>{let p=0,pk=0,d=0,win=0,count=0;
  for(const row of rows){if(row.date>=start&&row.date<=end){p+=row.pnl;pk=Math.max(pk,p);d=Math.max(d,pk-p)}}
  for(const t of tx){if(t.exitDate>=start&&t.exitDate<=end){count++;if(t.pnl>0)win++}}
  return {net:n(p),closeDd:n(d),trades:count,winPct:n(100*win/(count||1))};
 };
 for(const row of rows){total+=row.pnl;peak=Math.max(peak,total);dd=Math.max(dd,peak-total)}
 return {net:n(total),dd:n(res.minuteDD),closeDd:n(dd),
  trades:tx.length,winPct:n(100*tx.filter(x=>x.pnl>0).length/(tx.length||1)),
  hardStops:res.hardStops,skipped:res.skippedSessions,resetCount:res.resetCount,
  training:phase('2021-10-22','2023-12-31'),validation:phase('2024-01-01','2025-12-31'),
  holdout:phase('2026-01-01','2026-11-11'),afterFreeze:phase('2026-10-27','2026-11-11'),
  byYear:Object.fromEntries([2021,2022,2023,2024,2025,2026].map(y=>[y,phase(y+'-01-01',y+'-12-31')])),
  peakTrough:res.maxDrawdownInfo};
};
const regular=[{name:'ORIGINAL',risk:{}}];
for(const cap of [2000,2250,2500,2750,3000,3500]){
 for(const wait of [5,8,12])
  for(const lookback of [5,8,12])
   for(const profit of [0,300])
    regular.push({name:'Fixed_'+cap+'_wait'+wait+'_shadow'+lookback+'_profit'+profit,
      risk:{equityDdCap:cap,haltSessions:wait,cooldownReset:true,
       resumeShadowLookback:lookback,resumeShadowProfit:profit}});
}
for(const lookback of [120,250,500]){
 for(const multiplier of [1,1.25,1.5,2]){
  for(const floor of [1000,1500]){
   regular.push({name:'Dynamic_'+lookback+'_x'+multiplier+'_min'+floor,
    risk:{equityDdCap:2500,dynamicCapLookback:lookback,dynamicCapMultiplier:multiplier,
     dynamicCapFloor:floor,dynamicCapCeiling:3000,cooldownReset:true,
     haltSessions:8,resumeShadowLookback:8,resumeShadowProfit:0}});
  }
 }
}
const everything=[];
for(let i=0;i<regular.length;i++){
 const v=regular[i],risk={...v.risk,shadowPnl:core.pnls};
 const result=researchSimulate(core.sessions,bars,{fee:2.5,end:'2026-11-11',risk});
 const info={name:v.name,risk:v.risk,fee:2.5,slip:0,...calc(result)};
 everything.push(info);
 if(i%20===0)console.log('R26_RISK_ROBUST_PROGRESS',i,regular.length);
}
const baseInfo=everything[0];
const qualified=everything.filter(x=>x.name!=='ORIGINAL'&&x.training.net>=baseInfo.training.net*.8
 &&x.validation.net>=baseInfo.validation.net*.8);
const ranked=qualified.sort((a,b)=>(b.net/b.dd)-(a.net/a.dd));
const bestStability=qualified.filter(x=>x.net>=.95*baseInfo.net).sort((a,b)=>a.dd-b.dd);
const reference=[
 {name:'Candidate_2500_8_8_0',risk:{equityDdCap:2500,haltSessions:8,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:0}},
 {name:'Candidate_2250_8_8_0',risk:{equityDdCap:2250,haltSessions:8,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:0}},
 {name:'Candidate_2750_8_8_0',risk:{equityDdCap:2750,haltSessions:8,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:0}},
 {name:'Candidate_2500_8_8_300',risk:{equityDdCap:2500,haltSessions:8,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:300}},
 {name:'Candidate_2500_5_8_0',risk:{equityDdCap:2500,haltSessions:5,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:0}},
 {name:'Candidate_2500_12_8_0',risk:{equityDdCap:2500,haltSessions:12,cooldownReset:true,resumeShadowLookback:8,resumeShadowProfit:0}},
 {name:'Candidate_2500_8_5_0',risk:{equityDdCap:2500,haltSessions:8,cooldownReset:true,resumeShadowLookback:5,resumeShadowProfit:0}},
 {name:'Candidate_2500_8_12_0',risk:{equityDdCap:2500,haltSessions:8,cooldownReset:true,resumeShadowLookback:12,resumeShadowProfit:0}}
];
const stress=[];
for(const v of reference){
 for(const fee of [2.5,3,4,5]){
  for(const slip of [0,10,30,75]){
   if(fee!==2.5&&slip!==0&&slip!==30)continue;
   const risk={...v.risk,shadowPnl:core.pnls,hardStopSlippagePoints:slip};
   const result=researchSimulate(core.sessions,bars,{fee,end:'2026-11-11',risk});
   const item={name:v.name,fee,slip,...calc(result)};
   if(fee===2.5&&slip===0)item.riskTimeline=result.riskTimeline;
   stress.push(item);
  }
 }
}
const report={dateEnd:'2026-11-11',engine:'R26 exact canonical frozen + 24 CRC TAIFEX sessions',
 feePerSide:2.5,notes:['R26 remains unchanged on live site',
 'NO future information for gating (only prior paper pnl / already completed minutes)',
 'Equity reset never resets actual global max drawdown',
 'Shadow 2026 was already seen during tuning, not pristine unseen OOS',
 'Real stop fills and real gap risk can be worse than 1-minute OHLC and paper slippage'],
 original:baseInfo, tested:everything.length,qualified:qualified.length,
 bestNetDD:ranked.slice(0,25),leastDDWith95pctNet:bestStability.slice(0,20),
 stress,results:everything};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-risk-neighborhood-validation.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-risk-neighborhood.csv',
 'name,net,dd,win,trainNet,validationNet,holdoutNet,holdoutDD,postFreezeNet\n'+
 everything.map(x=>[x.name,x.net,x.dd,x.winPct,x.training.net,x.validation.net,x.holdout.net,
  x.holdout.closeDd,x.afterFreeze.net].join(',')).join('\n'));
console.log('R26_NEIGHBORHOOD_SUMMARY',JSON.stringify({variants:everything.length,qualified:qualified.length,
 orig:{net:baseInfo.net,dd:baseInfo.dd},best:bestStability.slice(0,10).map(x=>({name:x.name,net:x.net,dd:x.dd,train:x.training.net,validation:x.validation.net,holdout:x.holdout.net})),
 byRatio:ranked.slice(0,6).map(x=>({name:x.name,net:x.net,dd:x.dd}))}));
console.log('R26_NEIGHBORHOOD_STRESS',JSON.stringify(stress.filter(x=>x.slip===0||x.slip===75).map(x=>({
 name:x.name,fee:x.fee,slip:x.slip,net:x.net,dd:x.dd,holdout:x.holdout.net,hardStops:x.hardStops,
 riskTimeline:x.riskTimeline}))));
