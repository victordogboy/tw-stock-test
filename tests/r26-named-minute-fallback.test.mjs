import test from 'node:test';import assert from 'node:assert/strict';
import {r26LiveQuoteRoute} from '../src/r26-live-quote.mjs';
const base=Math.floor(Date.parse('2026-10-29T15:01:00+08:00')/1000);
const c={meta:{symbol:'WTXX6',name:'台指期2611',exchange:'TFE',dataGranularity:'1m',regularMarketTime:base,sourceTradingPeriods:[]},
 quote:{openPrice:'42500',refreshedTs:'2026-10-29T15:01:00+08:00'},
 timestamp:[base],
 indicators:{quote:[{open:[42500],high:[42530],low:[42490],close:[42520],volume:[100]}]}};
const html='<html><script>"MarketChartStore":'+JSON.stringify({libra:{WTXX6:c}})+', "other":null</script></html>';
const fetchImpl=async url=>url.endsWith('/quote/WTXX6')?new Response(html,{status:200}):new Response('bad',{status:404});
test('continuous WTX& failure falls back to verified named TX202611 1m without calling it a tick',async()=>{
 const r=await r26LiveQuoteRoute(new Request('https://r26.test/api/r26/live-quote?contract=202611'),{},fetchImpl);
 assert.equal(r.status,200);const j=await r.json();
 assert.equal(j.ok,true);assert.equal(j.contract_month,'202611');assert.equal(j.symbol,'TX202611');
 assert.equal(j.price,42520);assert.equal(j.quote_type,'minute_k');assert.equal(j.contract_verified,true);
 assert.equal(j.strategy_signal_validated,false);assert.match(j.source,/非逐筆成交/);
 assert.equal(j.quote_status,'stale');
});
test('no verified named contract and all quote sources down still fail closed',async()=>{
 const r=await r26LiveQuoteRoute(new Request('https://r26.test/api/r26/live-quote'),{},fetchImpl);
 assert.equal(r.status,503);assert.equal((await r.json()).ok,false);
});
