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







const rg=priorDailyRegimes(prepared.sessions),round=n=>Math.round(n*100)/100;
const factors={A:[],B:[],C:[],D:[]};
const ff=(name,fn)=>({name,mask:regimeFlags(rg,fn)});
for(const decay of [-.2,-.25,-.3])for(const mom of [1.5,2,2.5])
 factors.A.push(ff('ATR20_'+decay+'_MOM5_'+mom,r=>r.atrSlope20<=decay&&r.features?.mom5>mom));
for(const percentile of [.7,.8,.9])for(const decay of [-.08,-.1,-.12])
 factors.B.push(ff('PCT250_'+percentile+'_ATR5_'+decay,r=>r.atrPercentile250>=percentile&&r.atrSlope5<=decay&&r.features?.mom5>0));
for(const efficient of [.7,.75,.8])for(const mom of [.5,1,1.5])
 factors.C.push(ff('EFF10_'+efficient+'_MOM5_'+mom,r=>r.efficiency10>=efficient&&r.features?.mom5>mom));
for(const slope of [0,.25,.5])for(const mom of [1,2,3])
 factors.D.push(ff('EMA_SLOPE_'+slope+'_MOM5_'+mom,r=>r.features?.slope>slope&&r.features?.mom5>mom));
const or=(x,y)=>x.mask.map((v,i)=>v||y.mask[i]);
const and=(x,y)=>x.mask.map((v,i)=>v&&y.mask[i]);
const proposals=[ff('NONE',()=>false)];
for(const kind of ['A','B','C','D'])proposals.push(...factors[kind]);
for(const [x,y] of [['A','B'],['A','C'],['B','C'],['A','D'],['B','D']]){
 for(const a of factors[x])for(const b of factors[y]){
  proposals.push({name:'OR_'+a.name+'__'+b.name,mask:or(a,b)});
 }
}
for(const a of factors.A)for(const c of factors.C)
 proposals.push({name:'AND_'+a.name+'__'+c.name,mask:and(a,c)});
const limit={anchor:'priorClose',entryMode:'breakout',onlySide:-1,entryATR:.025,entryWindow:60};
const effective=(cfg,fee=2.5,entrySlip=0,riskSlip=0)=>{
 const risk={preopenShortOnlyAboveATR:cfg.vol,highVolLongRescueFlags:cfg.mask,
  equityDdCap:800,cooldownReset:true,haltSessions:8,resumeShadowLookback:8,
  resumeShadowProfit:0,shadowPnl:prepared.pnls,hardStopSlippagePoints:riskSlip};
 return simulateLimitRisk(prepared.sessions,bars,{fee,end:'2026-11-11',risk,
  limit:{...limit,breakoutSlippagePoints:entrySlip}});
};
const assess=(s,cfg,fee=2.5,entrySlip=0,riskSlip=0)=>{
 const tx=s.closedTrades,years={};
 for(let yr=2021;yr<=2026;yr++){
  years[yr]=round(s.rows.filter(r=>r.date.startsWith(String(yr))).reduce((v,r)=>v+r.pnl,0));
 }
 return {name:cfg.name,vol:cfg.vol,net:round(s.rows.reduce((v,r)=>v+r.pnl,0)),
  dd:round(s.minuteDD),win:round(100*tx.filter(t=>t.pnl>0).length/(tx.length||1)),
  trades:tx.length,skipped:s.skippedSessions,haltCount:s.hardStops,
  rescueSessions:cfg.mask.filter(Boolean).length,
  fee,entrySlip,riskSlip,years};
};
const raw=simulateLimitRisk(prepared.sessions,bars,{fee:2.5,end:'2026-11-11'});
assert.equal(raw.minuteDD,6106);
assert.equal(round(raw.rows.reduce((v,r)=>v+r.pnl,0)),65953);
for(let i=0;i<raw.rows.length;i++)assert.equal(raw.rows[i].pnl,prepared.rows[i].pnl);
const cfgs=[];
for(const vol of [195,200,205])for(const x of proposals)
 cfgs.push({name:'VOL'+vol+'_'+x.name,vol,mask:x.mask});
const results=[];
for(let i=0;i<cfgs.length;i++){
 const cfg=cfgs[i],score=assess(effective(cfg),cfg);
 results.push(score);
 if(i%100===0)console.log('R26_REGIME_COMBO_PROGRESS',i,cfgs.length,score.net,score.dd,score.years[2026]);
}
const old200=results.find(x=>x.name==='VOL200_NONE');
assert.equal(old200.net,23009);assert.equal(old200.dd,764);
const rank=a=>a.sort((x,y)=>y.net-x.net||x.dd-y.dd);
const strict=rank(results.filter(x=>x.dd<=1000));
const near=rank(results.filter(x=>x.dd<=1250));
const narrow=rank(results.filter(x=>x.dd<=900));
const topBy2026=rank(results.filter(x=>x.dd<=1000&&x.years[2026]>=3000));
const shortlisted=[...new Set([...strict.slice(0,15).map(x=>x.name),...narrow.slice(0,8).map(x=>x.name),
 ...near.slice(0,5).map(x=>x.name),
 'VOL200_NONE','VOL195_NONE'])];
const stressed=[];
for(const name of shortlisted){
 const cfg=cfgs.find(x=>x.name===name);
 if(!cfg)throw Error('bad candidate '+name);
 for(const [fee,entrySlip,riskSlip] of [[2.5,0,0],[3,0,0],[5,0,0],[2.5,5,75],[2.5,20,75],[5,5,75]]){
  const s=effective(cfg,fee,entrySlip,riskSlip);
  stressed.push(assess(s,cfg,fee,entrySlip,riskSlip));
 }
}
const strictAfterCost=rank(stressed.filter(x=>x.fee===5&&x.entrySlip===5&&x.riskSlip===75&&x.dd<=1000));
const report={
 generatedAt:new Date().toISOString(),n:results.length,proposals:proposals.length,
 baseline:old200,strict:strict.slice(0,35),narrow:narrow.slice(0,20),near:near.slice(0,20),
 topBy2026:topBy2026.slice(0,20),stress:stressed,strictAfterCost:strictAfterCost.slice(0,25),
 results,
 notes:['OR and AND ATR contraction, 250d percentile, efficiency and EMA50 slope, strictly prior-closed days.',
  'R26 unchanged, one TX position, stop-first intraminute OHLC, fee per side 2.5/3/5pt.',
  'Cross-case adversarial entry fill slippage 5/20pt, equity stop fill 75pt.',
  'All 2026 period was observed by R26 optimization; this is parameter research not unseen validation.',
  'With 1-min bars unknown actual intrabar sequencing; stop-loss not guaranteed.']
};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-regime-combo-stress.json',JSON.stringify(report,null,2));
fs.writeFileSync('r26-study-output/r26-regime-combo.csv',
 'name,vol,net,dd,win,trades,skipped,haltCount,2021,2022,2023,2024,2025,2026\n'+results.map(x=>
 [x.name,x.vol,x.net,x.dd,x.win,x.trades,x.skipped,x.haltCount,
 ...[2021,2022,2023,2024,2025,2026].map(y=>x.years[y])].join(',')).join('\n'));
console.log('R26_REGIME_COMBO_SUMMARY',JSON.stringify({n:results.length,
 under1000:strict.length,under900:narrow.length,under1250:near.length,
 baseline:{net:old200.net,dd:old200.dd,win:old200.win,y2026:old200.years[2026]},
 bestUnder1000:strict.slice(0,18),bestUnder900:narrow.slice(0,12),
 recovered2026:topBy2026.slice(0,12),costRobust:strictAfterCost.slice(0,16)}));
