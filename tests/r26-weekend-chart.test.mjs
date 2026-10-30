import test from 'node:test';import assert from 'node:assert/strict';import z from 'node:zlib';
import {parseNamedChart,r26MarketRoute} from '../src/r26-market.mjs';
const now=Date.parse('2026-10-31T02:23:00+08:00'),calendar=['2026-10-29','2026-10-30','2026-11-02','2026-11-03'];
function fixture(overrides={}){
 const first=Date.parse('2026-11-01T15:01:00+08:00')/1000,last=Date.parse('2026-11-02T02:23:00+08:00')/1000;
 const c={meta:{symbol:'WTXX6',name:'台指期2611',exchange:'TFE',dataGranularity:'1m',regularMarketTime:last,regularMarketPrice:44000,
  sourceTradingPeriods:[[{start:first-60,end:Date.parse('2026-11-02T05:00:00+08:00')/1000}]]},
  quote:{openPrice:'45395',price:'44000',refreshedTs:'2026-10-30T18:22:30Z',...overrides},timestamp:[first,last],
  indicators:{quote:[{open:[45395,44010],high:[45420,44020],low:[45327,43990],close:[45328,44000],volume:[100,12]}]}};
 return '"MarketChartStore":'+JSON.stringify({libra:{WTXX6:c}});
}
test('Yahoo Monday trading-date chart maps to physical Friday/Saturday only with fresh quote and exchange calendar',()=>{
 const x=parseNamedChart(fixture(),'202611',now,calendar);
 assert.equal(x.calendar_shift_seconds,172800);assert.equal(x.data[0].timestamp_tpe,'2026-10-30 15:00:00');
 assert.equal(x.data.at(-1).timestamp_tpe,'2026-10-31 02:22:00');assert.equal(x.data.at(-1).session_key,'night:2026-10-30');
 assert.equal(x.data.at(-1).raw_timestamp_tpe,'2026-11-02 02:23:00');assert.equal(x.source_time,'2026-10-30T18:22:30.000Z');
 assert.equal(x.raw_source_time,'2026-11-01T18:23:00.000Z');assert.equal(x.data.every(r=>!r.source_complete),true);
});
test('calendar gaps, stale/missing actual quote clock, price mismatch cannot authorize date corrections',()=>{
 assert.throws(()=>parseNamedChart(fixture(),'202611',now,[]),/尚無法/);
 assert.throws(()=>parseNamedChart(fixture(),'202611',now,['2026-10-30','2026-11-03']),/尚無法/);
 assert.throws(()=>parseNamedChart(fixture({refreshedTs:'2026-10-30T17:00:00Z'}),'202611',now,calendar),/尚無法/);
 assert.throws(()=>parseNamedChart(fixture({refreshedTs:undefined}),'202611',now,calendar),/尚無法/);
 assert.throws(()=>parseNamedChart(fixture({price:'45000'}),'202611',now,calendar),/尚無法/);
});
test('HTTP route loads the exchange calendar from existing assets for the conditional weekend correction',async()=>{
 const realNow=Date.now;Date.now=()=>now;
 try{
  const env={ASSETS:{fetch:async()=>new Response(z.gzipSync(JSON.stringify({calendar})))}};
  const rsp=await r26MarketRoute(new Request('https://example.test/api/r26/intraday?contract=202611'),env,async()=>new Response(fixture()));
  assert.equal(rsp.status,200);const body=await rsp.json();assert.equal(body.data.length,2);assert.equal(body.calendar_shift_seconds,172800);
 }finally{Date.now=realNow}
});
