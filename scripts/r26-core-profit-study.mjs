import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {run,audit,simulate} from '../public/r26-engine/engine.mjs';
import {researchSimulate} from '../public/r26-research/core-profit-overlay.mjs';

const dir='public/r26-engine/data/';
const meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(dir+'manifest.json.gz')));
const raw=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(n=>fs.readFileSync(dir+n))));
const bars=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4);
const original=run(meta,bars,{end:meta.end});
const originalAudit=audit(original,meta);
assert.equal(originalAudit.pass,true,'Frozen 2428 R26 gold must pass');
assert.equal(original.rows.reduce((a,r)=>a+r.pnl,0),66452,'R26 points must equal 66,452');
const baseline=researchSimulate(original.sessions,bars,{end:meta.end});
assert.equal(original.minuteDD,baseline.minuteDD,'Minute DD zero difference required');
assert.equal(original.position,baseline.position,'Position zero difference required');
assert.equal(original.rows.length,baseline.rows.length);
for(let i=0;i<original.rows.length;i++){
 for(const field of ['pnl','held','signal','blocked','recovered','stop','target','startPos']){
  assert.equal(baseline.rows[i][field],original.rows[i][field],
   'Original R26 baseline parity '+i+' '+field);
 }
}
assert.equal(original.events.length,baseline.events.length,'event count parity');
for(let i=0;i<original.events.length;i++){
 const a=original.events[i],b=baseline.events[i];
 for(const key of ['date','sid','bar','type','side','price','contract'])
  assert.deepEqual(b[key],a[key],'event parity '+i+' '+key);
}
const round=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
const sum=arr=>arr.reduce((a,b)=>a+b,0);
const periods=[
 {key:'training_2021_2023',predicate:d=>d<'2024-01-01'},
 {key:'validation_2024_2025',predicate:d=>d>='2024-01-01'&&d<'2026-01-01'},
 {key:'holdout_2026_to_1022',predicate:d=>d>='2026-01-01'},
 {key:'full',predicate:d=>true}
];
function part(rows,trades,fn){
 const pnlRows=rows.filter(r=>fn(r.date)),sub=trades.filter(t=>fn(t.exitDate));
 const winners=sub.filter(t=>t.pnl>0),losers=sub.filter(t=>t.pnl<0);
 let p=0,mdd=0,total=0;
 for(const r of pnlRows){total+=r.pnl;p=Math.max(p,total);mdd=Math.max(mdd,p-total)}
 const gp=sum(winners.map(t=>t.pnl)),gl=-sum(losers.map(t=>t.pnl));
 return {pnl:round(sum(pnlRows.map(r=>r.pnl))),positiveSessions:pnlRows.filter(r=>r.pnl>0).length,
  sessions:pnlRows.length,sessionWinPct:round(100*pnlRows.filter(r=>r.pnl>0).length/(pnlRows.length||1)),
  closedTrades:sub.length,winTrades:winners.length,lossTrades:losers.length,
  winRatePct:round(100*winners.length/(sub.length||1)),profitFactor:gl?round(gp/gl,3):null,
  avgWin:round(gp/(winners.length||1)),avgLoss:round(gl/(losers.length||1)),
  sessionCloseDD:round(mdd)};
}
function describe(result,config){
 const trades=result.closedTrades,net=sum(result.rows.map(r=>r.pnl));
 const booked=sum(trades.map(t=>t.pnl));
 const byYear={};
 for(let year=2021;year<=2026;year++){
  byYear[String(year)]=round(sum(result.rows.filter(r=>r.date.startsWith(String(year))).map(r=>r.pnl)));
 }
 const divisions=Object.fromEntries(periods.map(x=>[x.key,part(result.rows,trades,x.predicate)]));
 const exits={};
 for(const t of trades)exits[t.exitType]=(exits[t.exitType]||0)+1;
 return {config,net:round(net),minuteDD:round(result.minuteDD),position:result.position,
  nTrades:trades.length,overallWinRate:divisions.full.winRatePct,
  profitFactor:divisions.full.profitFactor,closedGrossNet:round(booked),netConsistency:round(booked-net),
  tradesCore:trades.filter(t=>t.type==='core').length,
  tradesKey:trades.filter(t=>t.type==='key').length,
  protectStops:result.protectStops,protectTargets:result.protectTargets,core:result.core,
  keys:result.keys,stops:result.stops,reentries:result.reentries,exits,
  byYear,divisions};
}
const variants=[{name:'R26_original',kind:'none'}];
for(const t of [.4,.6,.8,1,1.2,1.5,2,2.5,3,4])
 variants.push({name:'Fixed_'+t+'ATR',kind:'fixed',targetATR:t});
for(const start of [.5,1,1.5,2,3])
 for(const lock of [0,.10,.25])
  variants.push({name:'BE_'+start+'ATR_L'+lock,kind:'breakeven',start,lock});
for(const start of [.5,1,1.5,2,3])
 for(const distance of [.4,.6,.8,1,1.5])
  variants.push({name:'Trail_'+start+'ATR_D'+distance,kind:'trail',start,distance});
for(const start of [.5,1,1.5,2])
 for(const lock of [.25,.5,.75])
  variants.push({name:'Lock_'+start+'ATR_F'+lock,kind:'lock',start,lock});
const reports=[],baseYear=Object.fromEntries(original.rows.map(x=>[x.date.slice(0,4),0]));
for(const config of variants){
 const sim=config.kind==='none'?baseline:researchSimulate(original.sessions,bars,{end:meta.end,protect:config});
 const report=describe(sim,config);
 reports.push(report);
 if(!Number.isFinite(report.net)||report.minuteDD<0||report.netConsistency!==0)
   throw Error('Ledger inconsistency for '+config.name+': '+JSON.stringify(report));
 console.log('R26_VARIANT',JSON.stringify({
  name:config.name,win:report.overallWinRate,net:report.net,dd:report.minuteDD,
  trades:report.nTrades,train:report.divisions.training_2021_2023.pnl,
  validation:report.divisions.validation_2024_2025.pnl,
  holdout:report.divisions.holdout_2026_to_1022.pnl}));
}
const base=reports[0];
const winners=reports.filter(r=>r.config.name!=='R26_original'&&r.divisions.training_2021_2023.pnl>=base.divisions.training_2021_2023.pnl*.8)
 .sort((a,b)=>b.divisions.validation_2024_2025.winRatePct-a.divisions.validation_2024_2025.winRatePct);
const conservative=reports.filter(r=>r.config.name!=='R26_original'&&r.minuteDD<=base.minuteDD
   &&r.net>=base.net*.9&&r.overallWinRate>base.overallWinRate)
 .sort((a,b)=>b.overallWinRate-a.overallWinRate);
const byNet=reports.slice().sort((a,b)=>b.net-a.net);
const byWin=reports.slice().sort((a,b)=>b.overallWinRate-a.overallWinRate);
const summary={metadata:{engine:'TX_R26_CANONICAL_20261028',fee_per_side:2.5,
  sessions:original.rows.length,minutes:bars.length/4,
  freeze_start:'2021-10-22',freeze_end:meta.end,method:'one-minute OHLC stop-first, protection updates next bar',
  signals:'Frozen canonical run shadow/guard/levels unchanged',
  count:variants.length,strictParity:{ok:true,sessionPnlCount:original.rows.length,events:original.events.length,
   dd:original.minuteDD,net:66452}},
  baseline:base,topWin:byWin.slice(0,14),
  topNet:byNet.slice(0,14),conservative,validationCandidates:winners.slice(0,10),all:reports};
fs.mkdirSync('r26-study-output',{recursive:true});
fs.writeFileSync('r26-study-output/r26-core-profit-study.json',JSON.stringify(summary,null,2));
fs.writeFileSync('r26-study-output/r26-core-profit-variants.csv',
 ['version,net,minuteDD,trades,winRate,profitFactor,trainingNet,validationNet,holdoutNet,trainingWin,validationWin,holdoutWin',
 ...reports.map(r=>[r.config.name,r.net,r.minuteDD,r.nTrades,r.overallWinRate,r.profitFactor,
   r.divisions.training_2021_2023.pnl,r.divisions.validation_2024_2025.pnl,
   r.divisions.holdout_2026_to_1022.pnl,r.divisions.training_2021_2023.winRatePct,
   r.divisions.validation_2024_2025.winRatePct,r.divisions.holdout_2026_to_1022.winRatePct].join(','))].join('\n'));
console.log('R26_BASELINE',JSON.stringify(base));
console.log('R26_TOP_WIN',JSON.stringify(byWin.slice(0,8).map(r=>({name:r.config.name,net:r.net,dd:r.minuteDD,win:r.overallWinRate,trades:r.nTrades,train:r.divisions.training_2021_2023,validation:r.divisions.validation_2024_2025,holdout:r.divisions.holdout_2026_to_1022}))));
console.log('R26_CONSERVATIVE',JSON.stringify(conservative.slice(0,12).map(r=>({name:r.config.name,net:r.net,dd:r.minuteDD,win:r.overallWinRate,holdout:r.divisions.holdout_2026_to_1022}))));
console.log('R26_REPORT_PATHS',JSON.stringify({json:'r26-study-output/r26-core-profit-study.json',csv:'r26-study-output/r26-core-profit-variants.csv'}));
