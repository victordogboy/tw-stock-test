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
const round=x=>Math.round(x*100)/100;
const A=r=>r.atrSlope20<=-.25&&r.features?.mom5>2;
const B=r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0;
const E=r=>r.efficiency10>.8&&r.features?.mom5>1.5;
const extra=[];
function add(name,fn){extra.push({name,fn})}
add('NONE',()=>false);
for(const rsi of [50,55,60,65,70])for(const slope of [0,.25,.5])
 add('RSI_'+rsi+'_EMA_SLOPE_'+slope,r=>r.features?.rsi>rsi&&r.features?.slope>slope&&r.features?.mom5>0);
for(const mom of [1.5,2,3,4])for(const slope of [0,.25,.5])
 add('MOM10_'+mom+'_SLOPE_'+slope,r=>r.features?.mom10>mom&&r.features?.slope>slope&&r.features?.mom5>0);
for(const efficiency of [.5,.65,.8])for(const up of [.5,.6,.7])
 add('EFF20_'+efficiency+'_UP10_'+up,r=>r.efficiency20>=efficiency&&r.upDays10>=up&&r.features?.mom5>0);
for(const m10 of [1.5,2,3])for(const dec of [0,-.05,-.1])
 add('ATR5_DEC_'+dec+'_MOM10_'+m10,r=>r.atrSlope5<=dec&&r.features?.mom10>m10);
for(const mom20 of [2,3,4])for(const efficiency of [.35,.5,.65])
 add('TREND20_'+mom20+'_EFF20_'+efficiency,r=>r.priorTrend20>=mom20&&r.efficiency20>=efficiency);
for(const dist of [.5,1.5,2.5])for(const slope of [0,.2,.4])
 add('EMA_DIST_'+dist+'_SLOPE_'+slope,r=>r.features?.dist>dist&&r.features?.slope>slope&&r.features?.mom5>0);
const setups=[];
for(const e of extra)for(const scope of [0,1,2]){
 const mask=regimeFlags(rg,r=>A(r)||B(r)||E(r)||(e.fn(r)&&(scope===2||r.sid===scope)));
 for(const cfg of [
  {day:200,night:195,atr:.01,window:30},{day:200,night:195,atr:.015,window:60},
  {day:205,night:195,atr:.01,window:30},{day:205,night:195,atr:.015,window:60}
 ]){
  setups.push({name:'D'+cfg.day+'N'+cfg.night+'_E'+cfg.atr+'_W'+cfg.window+'_X'+e.name+'_S'+scope,
   ...cfg,cap:800,mask,extra:e.name,scope});
 }
}
function simulate(p,{fee=2.5,entrySlip=0,riskSlip=0}={}){
 const risk={preopenShortOnlyAboveATRDay:p.day,preopenShortOnlyAboveATRNight:p.night,
  highVolLongRescueFlags:p.mask,equityDdCap:p.cap,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
  hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,entryATR:p.atr,
  entryWindow:p.window,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,limit});
}
const part=(s,from,to)=>round(s.rows.filter(x=>x.date>=from&&x.date<=to).reduce((a,x)=>a+x.pnl,0));
function score(s,p,o={}){
 const tx=s.closedTrades;
 return {name:p.name,day:p.day,night:p.night,atr:p.atr,window:p.window,
  extra:p.extra,scope:p.scope,
  net:round(s.rows.reduce((a,x)=>a+x.pnl,0)),dd:round(s.minuteDD),
  win:round(100*tx.filter(x=>x.pnl>0).length/(tx.length||1)),trades:tx.length,
  early:part(s,'2021-10-22','2023-12-31'),valid:part(s,'2024-01-01','2025-12-31'),
  holdout:part(s,'2026-01-01','2026-11-11'),haltCount:s.hardStops,...o};
}
const r26=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(r26.minuteDD,6106);
assert.equal(round(r26.rows.reduce((a,x)=>a+x.pnl,0)),65953);
for(let i=0;i<r26.rows.length;i++)assert.equal(r26.rows[i].pnl,prepared.rows[i].pnl);
const baseline=setups.find(x=>x.day===200&&x.night===195&&x.atr===.01&&x.window===30&&x.extra==='NONE');
assert.ok(baseline);
const b=score(simulate(baseline),baseline);
assert.equal(b.net,28488);assert.equal(b.dd,806);
console.log('R26_RESCUE_NEWFEATURE_GOLD',JSON.stringify({base:b,total:setups.length,indicators:extra.length}));
const results=[];
for(let i=0;i<setups.length;i++){
 const p=setups[i],val=score(simulate(p),p);
 results.push(val);
 if(i%75===0)console.log('R26_RESCUE_NEWFEATURE_PROGRESS',i,setups.length,p.name,val.net,val.dd);
}
const ranked=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const strict=ranked(results.filter(x=>x.dd<=1000&&x.early>0&&x.valid>0&&x.holdout>0));
const ratio=[...strict].sort((x,y)=>y.net/y.dd-x.net/x.dd);
const net30k=strict.filter(x=>x.net>=30000&&x.net/x.dd>=35);
const chosen=[...new Set([...strict.slice(0,20).map(x=>x.name),
 ...ratio.slice(0,8).map(x=>x.name),baseline.name])];
const stress=[];
for(const name of chosen){
 const p=setups.find(x=>x.name===name);
 for(const v of [{fee:2.5,entrySlip:0,riskSlip:0},{fee:3,entrySlip:0,riskSlip:0},
  {fee:5,entrySlip:0,riskSlip:0},{fee:2.5,entrySlip:5,riskSlip:75},
  {fee:5,entrySlip:5,riskSlip:75},{fee:5,entrySlip:10,riskSlip:100}]){
  stress.push(score(simulate(p,v),p,v));
 }
}
const passStress=ranked(stress.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const result={newIndicators:extra.length,tests:setups.length,period:'2021-10-22..2026-11-11',
 frozenR26:{net:65953,dd:6106},baseline:b,strictCount:strict.length,
 hit30000and35:net30k.slice(0,20),best:strict.slice(0,30),bestRatio:ratio.slice(0,20),
 stress,passStress:passStress.slice(0,20),all:results,
 limits:['Previous completed day only for trend, RSI, EMA slope, efficiency and ATR percentile',
 'No 2026 fully unseen OOS; multi-hypothesis selection bias applies',
 '1 TX contract, 2.5pt per side, adverse breakout slippage and risk exit 75pt in stress',
 'Risk 800 pt equity trigger is modeled, not a guaranteed real exchange price',
 'No live R26 modifications or broker orders']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-extra-regime-rescue.json',JSON.stringify(result,null,2));
fs.writeFileSync('r26-study-output/r26-extra-regime-rescue.csv',
 'name,net,dd,ratio,win,trades,early,valid,2026\n'+results.map(x=>
 [x.name,x.net,x.dd,round(x.net/x.dd),x.win,x.trades,x.early,x.valid,x.holdout].join(',')).join('\n'));
console.log('R26_RESCUE_NEWFEATURE_RESULTS',JSON.stringify({n:setups.length,strict:strict.length,
 hits:net30k.slice(0,15),best:strict.slice(0,18),ratio:ratio.slice(0,12),robust:passStress.slice(0,12)}));
