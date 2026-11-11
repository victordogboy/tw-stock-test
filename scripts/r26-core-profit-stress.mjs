import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {run,audit,simulate} from '../public/r26-engine/engine.mjs';
import {researchSimulate} from '../public/r26-research/core-profit-overlay.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const p='public/r26-engine/data/';
const meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'manifest.json.gz')));
const raw=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(x=>fs.readFileSync(p+x))));
const frozen=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4);
const standard=run(meta,frozen,{end:meta.end});
assert.ok(audit(standard,meta).pass);
const seed=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'recent.json.gz')));
const cal=extendTaifexCalendar2026(seed.calendar);
const archive=JSON.parse(zlib.gunzipSync(fs.readFileSync(p+'verified-official-backfill.json.gz')));
assert.equal(archive.version,'R26_TAIFEX_BACKFILL_V1');
assert.equal(archive.last_complete_trade_day,'2026-11-11');
const start=Date.parse('2026-11-11T14:00:00+08:00');
const expected=physicalSessions(cal,meta.end,start);
const groups=new Map();
for(const r of archive.rows){if(!groups.has(r.session_key))groups.set(r.session_key,[]);groups.get(r.session_key).push(r)}
const ss=meta.sessions.map(x=>({...x})),more=[];
for(const spec of expected){
 const rr=(groups.get(spec.key)||[]).filter(x=>x.trade_date===spec.date&&x.contract_verified===true&&x.source==='TAIFEX official ticks').sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 if(spec.sid===1&&rr.length!==300||spec.sid===0&&(rr.length<750||rr.length>840))throw Error('Official session missing '+spec.key+' length='+rr.length);
 const prev=ss.at(-1),pidx=(prev.offset+prev.count-1)*4+3;
 const prevCl=pidx<frozen.length?frozen[pidx]:more[pidx-frozen.length];
 const cl=rr.at(-1).close;
 const s={...spec,contract:rr[0].contract_date,offset:(frozen.length+more.length)/4,
  count:rr.length,start:rr[0].timestamp_tpe,end:rr.at(-1).timestamp_tpe,
  source:'TAIFEX official ticks',market:rr[0].contract_date===prev.contract?cl-prevCl:cl-rr[0].open-5};
 for(const r of rr)more.push(r.open,r.high,r.low,r.close);
 ss.push(s);
}
const combined=new Int32Array(frozen.length+more.length);combined.set(frozen);combined.set(more,frozen.length);
const expandedMeta={...meta,sessions:ss};
const unmodified=run(expandedMeta,combined,{end:'2026-11-11'});
const plain=researchSimulate(unmodified.sessions,combined,{end:'2026-11-11'});
assert.equal(unmodified.rows.length,plain.rows.length);
assert.equal(unmodified.minuteDD,plain.minuteDD);
for(let i=0;i<plain.rows.length;i++)
 for(const f of ['pnl','held','signal','blocked','stop','recovered'])
  assert.equal(unmodified.rows[i][f],plain.rows[i][f],'Expansion baseline parity '+i+' '+f);
const config=[
 {name:'R26_original',kind:'none'},
 {name:'BE_0.5ATR_L0.1',kind:'breakeven',start:.5,lock:.1},
 {name:'BE_1ATR_L0.1',kind:'breakeven',start:1,lock:.1},
 {name:'BE_1ATR_L0.25',kind:'breakeven',start:1,lock:.25},
 {name:'Trail_1ATR_D0.4',kind:'trail',start:1,distance:.4}
];
const score=(res,from,to)=>{
 const rows=res.rows.filter(x=>x.date>=from&&x.date<=to);
 const tx=res.closedTrades.filter(x=>x.exitDate>=from&&x.exitDate<=to);
 const pnl=rows.reduce((s,x)=>s+x.pnl,0);
 const win=tx.filter(x=>x.pnl>0).length;
 return {net:+pnl.toFixed(2),nTrades:tx.length,wins:win,winPct:+(100*win/(tx.length||1)).toFixed(2),
  heldEnd:rows.at(-1)?.held||0};
};
const results=[];
for(const fee of [2.5,3,4,5]){
 for(const c of config){
  const freeze=researchSimulate(standard.sessions,frozen,{fee,protect:c,end:meta.end});
  const full=fee===2.5&&c.kind==='none'?plain:researchSimulate(unmodified.sessions,combined,{fee,protect:c,end:'2026-11-11'});
  const annual=Object.fromEntries([2021,2022,2023,2024,2025,2026].map(year=>[String(year),
   score(freeze,String(year)+'-01-01',String(year)+'-12-31')]));
  const r={name:c.name,fee,netFrozen:+freeze.rows.reduce((x,y)=>x+y.pnl,0).toFixed(2),
   maxMinuteDDFrozen:+freeze.minuteDD.toFixed(2),annual,
   fullUntilNov11:score(full,'2021-10-22','2026-11-11'),
   postFrozen2026:score(full,'2026-10-27','2026-11-11'),
   fullDD:+full.minuteDD.toFixed(2),extensionCount:full.rows.length-standard.rows.length,
   extensionBars:more.length/4};
  results.push(r);console.log('R26_STRESS',JSON.stringify(r));
 }
}
const report={generated_at:new Date().toISOString(),comparison_from:'2021-10-22',frozen_to:meta.end,
  extension_to:'2026-11-11',official_nightly_day_count:expected.length,official_added_minutes:more.length/4,
  frozen_gold:2428,base:results[0],config,results,
  assumptions:['Only confirmed TAIFEX official OHLC through 2026-11-11 daytime',
   'End-of-sample 2.5pt side cost and exactly original blocked shadow states',
   'No next-bar slippage, OHLC ambiguity is stop-first',
   'Trade win rate based on closed virtual trades (roll does not close strategy trade)']};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-ext-postholdout-cost-stress.json',JSON.stringify(report,null,2));
console.log('R26_STRESS_SUMMARY',JSON.stringify({extended_sessions:expected.length,added_minutes:more.length/4,
 results:results.filter(r=>r.fee===2.5)}));
