// R26 risk-only experiment. Use exactly frozen TX1m and officially CRC-verified
// 2026-10-27..2026-11-11 TX1m; 2026 data are a true out-of-time evaluation.
import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {simulateLimit} from '../public/r26-research/open-limit-orders.mjs';
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

const search=[{name:'ORIGINAL_R26_MARKET',anchor:'open',entryATR:0,exitATR:0}];
const distances=[.05,.1,.15,.2,.3,.4,.5,.75,1];
for(const distance of distances)for(const window of [30,120,840]){
 search.push({name:'PRE_ENTRY_'+distance+'ATR_W'+window,anchor:'priorClose',entryATR:distance,entryWindow:window,exitATR:0});
 for(const mode of ['carry','marketClose'])
  search.push({name:'PRE_EXIT_'+distance+'ATR_W'+window+'_UNFILLED_'+mode,
   anchor:'priorClose',entryATR:0,exitATR:distance,exitWindow:window,exitUnfilled:mode});
}
for(const entry of [.1,.2,.4])for(const exit of [.1,.2,.4])for(const window of [120,840])
 for(const mode of ['carry','marketClose'])
  search.push({name:'PRE_BOTH_E'+entry+'_X'+exit+'_W'+window+'_'+mode,anchor:'priorClose',
   entryATR:entry,exitATR:exit,entryWindow:window,exitWindow:window,exitUnfilled:mode});
// These look-at-the-open variants are explicitly NOT pre-market executable.
// They are a separate diagnostic for evaluating whether anchoring to the
// ACTUAL opening quote would help; NEVER mix with true pre-market scenarios.
for(const distance of [.1,.2,.3,.4,.5])for(const window of [30,120,840]){
 search.push({name:'AFTER_OPEN_ENTRY_'+distance+'ATR_W'+window,anchor:'open',entryATR:distance,entryWindow:window});
 search.push({name:'AFTER_OPEN_EXIT_'+distance+'ATR_W'+window,anchor:'open',exitATR:distance,exitWindow:window,exitUnfilled:'marketClose'});
}
// A stop-entry is not a limit order: the opening price can gap PAST the
// trigger, in which case the worse open is used. Orders use PREVIOUS close.
for(const distance of [.05,.1,.15,.2,.3,.4,.5,.75,1,1.25,1.5]){
 for(const window of [30,120,840])
  search.push({name:'PRE_BREAKOUT_'+distance+'ATR_W'+window,anchor:'priorClose',entryMode:'breakout',
   entryATR:distance,entryWindow:window,exitATR:0});
}
for(const distance of [.1,.2,.4]){
 for(const window of [120,840]){
  for(const exit of [.05,.1,.2]){
   for(const mode of ['carry','marketClose'])
    search.push({name:'PRE_BREAKOUT_AND_LIMIT_E'+distance+'_X'+exit+'_W'+window+'_'+mode,
     anchor:'priorClose',entryMode:'breakout',entryATR:distance,entryWindow:window,exitATR:exit,exitWindow:window,exitUnfilled:mode});
  }
 }
}
const n=x=>Math.round(x*100)/100;
const total=x=>x.reduce((a,b)=>a+b,0);
function metrics(r,from,to){
 const rows=r.rows.filter(x=>x.date>=from&&x.date<=to);
 const tx=r.closedTrades.filter(t=>t.exitDate>=from&&t.exitDate<=to);
 let equity=0,peak=0,dd=0;
 for(const x of rows){equity+=x.pnl;peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity)}
 const wins=tx.filter(t=>t.pnl>0).length;
 return {net:n(equity),sessions:rows.length,positiveSessions:rows.filter(x=>x.pnl>0).length,
  winSessionPct:n(100*rows.filter(x=>x.pnl>0).length/(rows.length||1)),
  closedTrades:tx.length,wins,winTradePct:n(100*wins/(tx.length||1)),closeDd:n(dd)};
}
function stats(r,config){
 return {name:config.name,parameters:config,net:n(total(r.rows.map(x=>x.pnl))),minuteDD:r.minuteDD,
  tradeWinPct:n(100*r.closedTrades.filter(t=>t.pnl>0).length/(r.closedTrades.length||1)),
  trades:r.closedTrades.length,keys:r.keys,core:r.core,
  eligibleEntries:r.eligibleEntries,eligibleExits:r.eligibleExits,
  filledEntries:r.limitEntries,filledExits:r.limitExits,
  entryFillPct:r.eligibleEntries?n(100*r.limitEntries/r.eligibleEntries):null,
  exitFillPct:r.eligibleExits?n(100*r.limitExits/r.eligibleExits):null,
  missedEntries:r.missEntry,missedExits:r.missExit,
  training:metrics(r,'2021-10-22','2023-12-31'),
  validation:metrics(r,'2024-01-01','2025-12-31'),
  holdout:metrics(r,'2026-01-01','2026-11-11'),
  recent:metrics(r,'2026-10-27','2026-11-11')};
}
const market=simulateLimit(prepared.sessions,bars,{end:'2026-11-11'});
assert.equal(market.rows.length,prepared.rows.length);
assert.equal(market.minuteDD,prepared.minuteDD,'Original minuteDD parity');
assert.equal(market.events.length,prepared.events.length,'Original event count parity');
for(let i=0;i<prepared.rows.length;i++){
 for(const f of ['date','sid','pnl','held','signal','stop','target','recovered','startPos','op','cl'])
  assert.deepEqual(market.rows[i][f],prepared.rows[i][f],'Original original-state '+i+' field '+f);
}
for(let i=0;i<prepared.events.length;i++){
 const a=market.events[i],b=prepared.events[i];
 for(const f of ['date','sid','bar','type','side','price','contract'])
  assert.deepEqual(a[f],b[f],'Original event '+i+' field '+f);
}
assert.equal(n(total(market.closedTrades.map(t=>t.pnl))),n(total(market.rows.map(r=>r.pnl))),'Closed-trade ledger parity');
console.log('R26_LIMIT_GOLD_ZERO_DIFFERENCE',JSON.stringify({sessions:market.rows.length,events:market.events.length,closedTrades:market.closedTrades.length,
 net:n(total(market.rows.map(r=>r.pnl))),dd:market.minuteDD,tradeWinPct:stats(market,search[0]).tradeWinPct}));
const results=[];
for(let i=0;i<search.length;i++){
 const opts=search[i];
 const result=i===0?market:simulateLimit(prepared.sessions,bars,{end:'2026-11-11',limit:opts});
 const info=stats(result,opts);
 if(!Number.isFinite(info.net)||!Number.isFinite(info.minuteDD)||!Number.isFinite(info.tradeWinPct))throw Error('Invalid '+opts.name);
 results.push(info);
 if(i%15===0)console.log('R26_LIMIT_PROGRESS',i,search.length,opts.name,info.net,info.minuteDD,info.tradeWinPct);
}
const baseline=results[0];
const valid=results.filter(x=>x.name!=='ORIGINAL_R26_MARKET'&&!x.name.startsWith('AFTER_OPEN')&&
 x.training.net>=baseline.training.net*.75&&x.validation.net>=baseline.validation.net*.75);
const byWin=[...valid].sort((a,b)=>b.validation.winTradePct-a.validation.winTradePct||b.net-a.net);
const byNet=[...valid].sort((a,b)=>b.net-a.net);
const byDD=[...valid].sort((a,b)=>a.minuteDD-b.minuteDD||b.net-a.net);
const byPF=[...valid].sort((a,b)=>b.net/Math.max(100,a.minuteDD)-a.net/Math.max(100,b.minuteDD));
const notes=[
 'True pre-market orders reference PREVIOUS known same-month TX session close, not current future open; current opening price used only to decide marketable limit fill at that opening.',
 'On contract rollover with no same-contract previous close, skip premarket entry and close opposite exposure at market, avoiding made-up price.',
 'Signal, shadow-loss blocking, key levels and original stop remain canonical R26; only core open entry/exit altered.',
 'No-fill entry -> skip new core order; no-fill exit -> either carry old exposure into next session, or force market exit at end of present session.',
 'Protective stop executes before a favorable limit is tested within the same one-minute OHLC bar; entry and stop within same minute -> pessimistic immediate stop.',
 'If old position exit fills and opposite entry is required, new order cannot fill in the SAME ambiguous minute.',
 'Win rate is real CLOSED roundtrip strategy-trade win ratio; session win ratio is separately shown.',
 'All fees 2.5 points each side. No explicit queue/liquidity/extra adverse spread assumed; need stress.',
 '2026 period already used for parameter exploration by previous research and cannot be claimed wholly unseen OOS.'];
const report={dateEnd:'2026-11-11',frozenGold:2428,officialExtraSessions:expected.length,
 officialExtraMinutes:more.length/4,costPerSide:2.5,notes,configurations:search.length,
 baseline,topValidationWin:byWin.slice(0,20),topNet:byNet.slice(0,20),topDd:byDD.slice(0,20),topNetDD:byPF.slice(0,20),
 all:results};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-open-vs-limit.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-open-vs-limit.csv',
 'version,net,minuteDD,winTradePct,trades,entryFillPct,exitFillPct,trainNet,valNet,holdoutNet,recentNet\n'+
 results.map(x=>[x.name,x.net,x.minuteDD,x.tradeWinPct,x.trades,x.entryFillPct,x.exitFillPct,x.training.net,x.validation.net,x.holdout.net,x.recent.net].join(',')).join('\n'));
console.log('R26_LIMIT_BASELINE',JSON.stringify(baseline));
console.log('R26_LIMIT_BEST_VALIDATION_WIN',JSON.stringify(byWin.slice(0,12)));
console.log('R26_LIMIT_BEST_NET',JSON.stringify(byNet.slice(0,12)));
console.log('R26_LIMIT_BEST_DD',JSON.stringify(byDD.slice(0,12)));
const focusedNames=[
 'ORIGINAL_R26_MARKET',
 'PRE_ENTRY_0.05ATR_W120',
 'PRE_EXIT_0.1ATR_W840_UNFILLED_carry',
 'PRE_BREAKOUT_0.05ATR_W120',
 'PRE_BREAKOUT_0.1ATR_W120',
 'PRE_BREAKOUT_0.1ATR_W840',
 'PRE_BREAKOUT_0.15ATR_W840',
 'PRE_BREAKOUT_AND_LIMIT_E0.1_X0.1_W120_carry'
];
const focused=focusedNames.map(name=>{
 const item=results.find(x=>x.name===name);
 if(!item)throw Error('R26_FOCUS_MISSING_'+name);
 return item;
});
console.log('R26_LIMIT_FOCUSED_BY_PERIOD',JSON.stringify(focused.map(x=>({
 name:x.name,net:x.net,dd:x.minuteDD,win:x.tradeWinPct,
 closedTrades:x.trades,fill:x.entryFillPct,exitFill:x.exitFillPct,
 training:x.training,validation:x.validation,holdout:x.holdout,recent:x.recent}))));
const costStress=[];
for(const f of [3,4,5]){
 for(const name of focusedNames){
  const config=search.find(x=>x.name===name);
  const res=simulateLimit(prepared.sessions,bars,{end:'2026-11-11',fee:f,limit:config});
  const info=stats(res,config);
  costStress.push({name,fee:f,net:info.net,dd:info.minuteDD,win:info.tradeWinPct,trades:info.trades,
   holdoutNet:info.holdout.net,holdoutWin:info.holdout.winTradePct});
 }
}
console.log('R26_LIMIT_COST_STRESS',JSON.stringify(costStress));
fs.writeFileSync('r26-study-output/r26-focus-cost-stress.json',
 JSON.stringify({focused,costStress},null,2));
console.log('R26_LIMIT_RESEARCH_COMPLETE',JSON.stringify({count:search.length,valid:valid.length,baselineNet:baseline.net,baselineWin:baseline.tradeWinPct}));
