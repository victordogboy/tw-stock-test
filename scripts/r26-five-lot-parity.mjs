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











const regs=priorDailyRegimes(prepared.sessions);
const A=r=>r.atrSlope20<=-.25&&r.features?.mom5>2;
const B=r=>r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0;
const E=r=>r.efficiency10>.8&&r.features?.mom5>1.5;
const C=r=>r.efficiency20>=.8&&r.upDays10>=.5;
const rescue=regimeFlags(regs,r=>A(r)||B(r)||E(r)||C(r));
function build({fee=2.5,entrySlip=0,riskSlip=0,day=200,night=195,trigger=.005,fraction=.3,activation=1}={}){
 const risk={preopenShortOnlyAboveATRDay:day,preopenShortOnlyAboveATRNight:night,
  highVolLongRescueFlags:rescue,equityDdCap:800,cooldownReset:true,haltSessions:8,
  resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
  coreProfitProtect:{kind:'fraction',activateATR:activation,fraction},
  hardStopSlippagePoints:riskSlip};
 const limit={anchor:'priorClose',entryMode:'breakout',entryATR:trigger,
  entryWindow:30,onlySide:-1,breakoutSlippagePoints:entrySlip};
 return simulateLimitRisk(prepared.sessions,bars,{end:'2026-11-11',fee,risk,limit});
}
const baseline=build(),fixedCost=2.5;
const round=v=>Math.round(v*1e8)/1e8;
const benchmark={net:round(baseline.rows.reduce((a,x)=>a+x.pnl,0)),dd:baseline.minuteDD,trades:baseline.closedTrades.length};
assert.equal(benchmark.net,29657);
assert.equal(benchmark.dd,806);
const calc=(size,opts={})=>replaySizedTape(prepared.sessions,bars,baseline,{
 fee:fixedCost,maxLots:5,sizeAtOpen:()=>size,...opts
});
const fixed1=calc(1),fixed2=calc(2),fixed3=calc(3),fixed5=calc(5);
const basic={baseline:benchmark,one:{net:fixed1.net,dd:fixed1.minuteDD},
 two:{net:fixed2.net,dd:fixed2.minuteDD},
 three:{net:fixed3.net,dd:fixed3.minuteDD},
 five:{net:fixed5.net,dd:fixed5.minuteDD}};
console.log('R26_5LOT_PARITY_CHECK',JSON.stringify(basic));
assert.equal(fixed1.net,benchmark.net,'1LOT_NET_PARITY_REQUIRED');
assert.equal(fixed1.minuteDD,benchmark.dd,'1LOT_DD_PARITY_REQUIRED');
assert.equal(fixed5.net,benchmark.net*5,'5LOT_NET_LINEAR');
assert.equal(fixed5.minuteDD,benchmark.dd*5,'5LOT_DD_LINEAR');
console.log('R26_5LOT_PARITY_SUCCESS',JSON.stringify(basic));
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-five-lot-parity.json',JSON.stringify({
 benchmark,basic,model:'1-5 whole TX event-level trade replay with same completed-minute marks',
 sessions:fixed1.sessionCount,oneEvents:fixed1.tradeFills.length,
 sampleEvents:fixed1.tradeFills.slice(0,25)
},null,2));
