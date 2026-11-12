import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {replayTwoTxPaper} from '../public/r26-engine/two-tx-paper-live.mjs';

const root='public/r26-engine/data/';
const readGz=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(root+name)));
const meta=readGz('manifest.json.gz');
const raw=zlib.gunzipSync(Buffer.concat(meta.compressedParts.map(n=>fs.readFileSync(root+n))));
const bars=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4);
const recent=readGz('recent.json.gz');
const official=readGz('verified-official-backfill.json.gz');
const calendar=extendTaifexCalendar2026(recent.calendar);
const now=Date.parse('2026-11-11T14:00:00+08:00');
assert.ok(official.last_complete_trade_day>='2026-11-11');
const frozenDayRows=official.rows.filter(r=>r.trade_date<='2026-11-11');

const paper=replayTwoTxPaper(meta,bars,frozenDayRows,calendar,now);
console.log('R26_2TX_PAPER_SMOKE',JSON.stringify({ready:paper.ready,
  asOf:paper.asOf,position:paper.modelLots,plan:paper.proposedAtOpenLots,
  issues:paper.issues,warning:paper.warning,
  net:paper.profitPointsToDate,dd:paper.maxMinuteDrawdownToDate,
  one:paper.oneLotPointsToDate,extra:paper.incrementalPoints,
  audit:paper.verifiedOriginalGold}));
assert.ok(paper.ready,'Official history must produce verified paper state: '+JSON.stringify(paper));
assert.equal(paper.positionConfirmed,true);
assert.ok(paper.asOf?.startsWith('2026-11-11'),'Incorrect replay timestamp');
assert.ok(paper.contract==='202611','Wrong named TX contract');
assert.ok(Number.isInteger(paper.modelLots)&&Math.abs(paper.modelLots)<=2);
assert.ok(paper.candidatePreopen?.atr250Percentile>=0&&paper.candidatePreopen?.atr250Percentile<=1);
assert.ok(Number.isFinite(paper.profitPointsToDate));
assert.ok(Number.isFinite(paper.maxMinuteDrawdownToDate));
assert.ok(Math.abs(paper.profitPointsToDate-32001)<=5,
  'Live model should match frozen 32001 when not terminal liquidated');
assert.ok(Math.abs(paper.maxMinuteDrawdownToDate-806)<=3,
  'Live model should match frozen drawdown (minute closes)');
assert.ok(paper.marginRequiredNTD<=2*701000);
if(official.last_complete_trade_day>='2026-11-12'){
 const verified12=official.rows.filter(r=>r.trade_date<='2026-11-12');
 const morning=Date.parse('2026-11-12T14:00:00+08:00');
 const forward12=replayTwoTxPaper(meta,bars,verified12,calendar,morning);
 console.log('R26_2TX_FIRST_POST_FREEZE_FORWARD',JSON.stringify({
   ready:forward12.ready,asOf:forward12.asOf,date:forward12.sessionDate,
   contract:forward12.contract,lots:forward12.modelLots,
   net:forward12.profitPointsToDate,one:forward12.oneLotPointsToDate,
   addedNetVs11:forward12.ready?Math.round((forward12.profitPointsToDate-paper.profitPointsToDate)*100)/100:null,
   additionalLotNetVs11:forward12.ready?
    Math.round(((forward12.incrementalPoints??0)-(paper.incrementalPoints??0))*100)/100:null,
   maxDD:forward12.maxMinuteDrawdownToDate,issues:forward12.issues,
   warning:forward12.warning
 }));
 assert.ok(forward12.ready,'Official newly verified 11/12 should be replayable: '+JSON.stringify(forward12));
 assert.ok(forward12.asOf?.startsWith('2026-11-12'));
}
const noData=replayTwoTxPaper(meta,bars,[],calendar,now);
assert.equal(noData.ready,false,'missing minute bars MUST block paper signals');
assert.equal(noData.modelLots,undefined,'missing data MUST NOT publish positions');

const html=fs.readFileSync('public/r26-monitor.html','utf8');
const js=fs.readFileSync('public/r26-live-monitor.mjs','utf8');
const worker=fs.readFileSync('public/r26-engine/monitor-worker.mjs','utf8');
assert.ok(html.includes('R26-2TX-ATR35-DD100')&&html.includes('twoTxDirection'));
assert.ok(js.includes("ask('paper2tx'")&&js.includes('invalidateTwoTx'));
assert.ok(worker.includes("type:'paper2tx'"));
console.log('R26_2TX_UI_GOLD_ACCEPTANCE',JSON.stringify({
  success:true,verifiedTo:'2026-11-11',
  originalR26Gold:true,
  dataGapFailClosed:true,
  noLiveBrokerOrders:true,
  portal:'r26-monitor.html'
}));
