// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {researchSimulate} from '../public/r26-research/core-profit-overlay.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const p='public/r26-engine/data/',meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'manifest.json.gz')));
const raw=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(x=>fs.readFileSync(p+x))));
const frozen=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4);
const canonical=run(meta,frozen,{end:meta.end});
assert.equal(audit(canonical,meta).pass,true);
const gold=researchSimulate(canonical.sessions,frozen,{end:meta.end});
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
const extendedGold=researchSimulate(prepared.sessions,bars,{end:'2026-11-11'});
assert.equal(extendedGold.minuteDD,prepared.minuteDD);
for(let i=0;i<extendedGold.rows.length;i++)assert.equal(extendedGold.rows[i].pnl,prepared.rows[i].pnl);
const none={name:'ORIGINAL',risk:{},protect:{kind:'none'}};
const variants=[none,{name:'BE_1_ATR_LOCK_0.25',risk:{},protect:{kind:'breakeven',start:1,lock:.25}}];
const add=(name,risk,protect={kind:'none'})=>variants.push({name,risk,protect});
for(const p of [80,100,125,150,175,200,250,300,350,400,500,600,800,1000])add('MAX_STOP_'+p,{coreMaxStopPoints:p});
for(const p of [100,150,200,250,300,350,400,500,600,800,1000,1400])add('SKIP_STOP_OVER_'+p,{skipStopDistance:p});
for(const n of [2,3,5,8,12])for(const limit of [150,300,500,800,1200])
 add('PAST_'+n+'_LOSS_'+limit,{lossLookback:n,lossLimit:limit});
for(const max of [250,350,450,550,650,800,1000,1200,1600,2000])add('ATR_MAX_'+max,{atrMax:max});
for(const max of [.01,.015,.02,.025,.03,.035,.04,.05])add('ATR_PCT_MAX_'+max,{atrRatioMax:max});
for(const p of [100,200,300,400,600,800,1000,1500])add('GAP_MAX_'+p,{maxGapPoints:p});
add('DAY_CLOSE_FLAT',{flatAfterDay:true});add('NIGHT_CLOSE_FLAT',{flatAfterNight:true});
add('ALL_SESSION_CLOSE_FLAT',{flatAfterNight:true,flatAfterDay:true});
for(const p of [300,500,750,1000,1500,2000,3000])
 for(const halt of [0,1,3,8])add('DD_CAP_'+p+'_HALT_'+halt,{equityDdCap:p,haltSessions:halt});
for(const p of [150,200,250,300,400,500,600])
 for(const [n,limit] of [[3,500],[5,800],[8,1200]])
  add('CAP_'+p+'_LOSS_'+n+'_'+limit,{coreMaxStopPoints:p,lossLookback:n,lossLimit:limit});
for(const p of [200,300,400,500,600])
 for(const cap of [500,750,1000])add('CAP_'+p+'_DD_'+cap,{coreMaxStopPoints:p,equityDdCap:cap,haltSessions:2});
for(const p of [150,250,350,500])
 for(const cap of [500,1000])add('BE_CAP_'+p+'_DD_'+cap,{coreMaxStopPoints:p,equityDdCap:cap,haltSessions:2},
  {kind:'breakeven',start:1,lock:.25});
// Independent paper-engine prior sessions only. A previous-session paper return
// can be computed without ever observing future bar information.
for(const n of [3,5,8,12])for(const limit of [100,300,500,1000]){
  add('SHADOW_'+n+'_LOSS_'+limit,{shadowLookback:n,shadowLossLimit:limit,shadowPnl:canonical.pnls});
}
// Second-stage re-entry policies: unlike a permanent high-water circuit, a
// completed risk cool-down can rebase only its *future stop budget*, while
// the report's lifetime maximum drawdown remains continuous and unreset.
for(const cap of [300,500,750,1000,1250,1500,2000,2500,3000]){
 for(const wait of [2,5,10,20])
  add('RESET_DD_'+cap+'_WAIT_'+wait,{equityDdCap:cap,haltSessions:wait,cooldownReset:true});
}
for(const cap of [500,750,1000,1500,2000,2500]){
 for(const wait of [2,8,16]){
  for(const lookback of [3,8]){
   for(const target of [0,300])
    add('RESET_DD_'+cap+'_WAIT_'+wait+'_SHADOW_'+lookback+'_PROFIT_'+target,
      {equityDdCap:cap,haltSessions:wait,cooldownReset:true,
       resumeShadowLookback:lookback,resumeShadowProfit:target,
       shadowPnl:canonical.pnls});
  }
 }
}
for(const cap of [500,1000,1500,2000,2500]){
 for(const stop of [200,350,500]){
  add('RESET_DD_'+cap+'_WAIT_5_STOP_'+stop,{equityDdCap:cap,haltSessions:5,cooldownReset:true,coreMaxStopPoints:stop});
  add('RESET_DD_'+cap+'_WAIT_5_BE_STOP_'+stop,
    {equityDdCap:cap,haltSessions:5,cooldownReset:true,coreMaxStopPoints:stop},
    {kind:'breakeven',start:1,lock:.25});
 }
}
const sum=a=>a.reduce((x,y)=>x+y,0);
function score(result,lo,hi){
 const rows=result.rows.filter(x=>x.date>=lo&&x.date<=hi);
 const tx=result.closedTrades.filter(x=>x.exitDate>=lo&&x.exitDate<=hi);
 const wins=tx.filter(x=>x.pnl>0).length;
 let peak=0,net=0,dd=0;
 for(const r of rows){net+=r.pnl;peak=Math.max(peak,net);dd=Math.max(dd,peak-net)}
 return {net:+net.toFixed(1),sessionCloseDd:+dd.toFixed(1),sessions:rows.length,
  trades:tx.length,winPct:+(100*wins/(tx.length||1)).toFixed(2)};
}
const results=[];
for(let i=0;i<variants.length;i++){
 const v=variants[i];
 const risk=v.risk.shadowPnl?{...v.risk,shadowPnl:prepared.pnls}:v.risk;
 const res=researchSimulate(prepared.sessions,bars,{risk,protect:v.protect,end:'2026-11-11',fee:2.5});
 const all=score(res,'2021-10-22','2026-11-11');
 const training=score(res,'2021-10-22','2023-12-31');
 const validation=score(res,'2024-01-01','2025-12-31');
 const holdout=score(res,'2026-01-01','2026-11-11');
 const outside=score(res,'2026-10-27','2026-11-11');
 const entry={name:v.name,risk:v.risk.shadowPnl?{...v.risk,shadowPnl:'prior_only'}:v.risk,
  protect:v.protect,dd:res.minuteDD,peakTrough:res.maxDrawdownInfo,
  net:all.net,tradeWin:all.winPct,hardStops:res.hardStops,skipped:res.skippedSessions,
  training,validation,holdout,outside,overall:all};
 results.push(entry);
 if(i%10===0)console.log('R26_RISK_PROGRESS',i,variants.length,entry.name,entry.net,entry.dd);
}
const base=results[0];
const qualified=results.filter(x=>x.name!=='ORIGINAL'&&x.training.net>=base.training.net*.6&&
 x.validation.net>=base.validation.net*.6);
const byDd=[...qualified].sort((a,b)=>a.dd-b.dd||b.net-a.net);
const byProfit=[...qualified].sort((a,b)=>(b.net/b.dd)-(a.net/a.dd));
const by2026=[...qualified].sort((a,b)=>a.holdout.sessionCloseDd-b.holdout.sessionCloseDd||b.holdout.net-a.holdout.net);
const minDd=[...results].sort((a,b)=>a.dd-b.dd||b.net-a.net);
const report={engine:'TX_R26_CANONICAL_20261028',research:'R26 independent risk controls',
 assumptions:['OHLC stop first','core signal & canonical shadow gate unchanged','single TX whole lot',
  'no time travel; filters use previous closed sessions, known open, or previous minute price',
  'Max drawdown is mark-to-previous-minute-close, with conservative gap execution',
  'Up to 2026-11-11 all official sessions CRC-verified, no live night bars',
  'Potential overfit: 2026 holdout was inspected only after candidate enumeration'],
 dateEnd:'2026-11-11',feePerSide:2.5,frozenGolden:2428,officialExtensionSessions:expected.length,
 officialExtensionMinutes:more.length/4,total:variants.length,
 original:base,byDd:byDd.slice(0,30),byNetPerDd:byProfit.slice(0,30),
 byHoldoutDD:by2026.slice(0,30),minDd:minDd.slice(0,25),results};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-risk-sweep.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-risk-sweep.csv',
 'name,net,dd,win,trainingNet,validationNet,holdoutNet,holdoutSessionDD,postFreezeNet,skipped,hardStops\n'+
 results.map(x=>[x.name,x.net,x.dd,x.tradeWin,x.training.net,x.validation.net,x.holdout.net,
  x.holdout.sessionCloseDd,x.outside.net,x.skipped,x.hardStops].join(',')).join('\n'));
console.log('R26_RISK_BASELINE',JSON.stringify(base));
console.log('R26_RISK_BEST_DD',JSON.stringify(byDd.slice(0,15)));
console.log('R26_RISK_BEST_NET_PER_DD',JSON.stringify(byProfit.slice(0,12)));
console.log('R26_RISK_MIN_DD_UNCONSTRAINED',JSON.stringify(minDd.slice(0,9)));
console.log('R26_RISK_SUMMARY',JSON.stringify({variants:variants.length,qualified:qualified.length,officialSessions:expected.length}));
