import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseYahooDaily,fetchYahooStock,a56QuotesRoute} from '../src/c26/a56-quotes.mjs';
import {collectQuoteCodes} from '../public/r1494a/c26/a56/quotes.mjs';
const now=Date.parse('2026-11-18T03:45:00Z'),ts=x=>Date.parse(x)/1000;
function fixture(symbol='2801.TW') {return {chart:{result:[{meta:{symbol,exchangeTimezoneName:'Asia/Taipei',dataGranularity:'1d',regularMarketTime:ts('2026-11-18T03:44:00Z'),regularMarketPrice:27.5,chartPreviousClose:99},timestamp:[ts('2026-11-17T01:00:00Z'),ts('2026-11-18T01:00:00Z')],indicators:{quote:[{open:[28.3,28.2],high:[28.5,28.25],low:[28,27.25],close:[28.15,27.5]}]}}]}}}
test('session OHL and prior close come from whole daily candle, not range baseline',()=>{const q=parseYahooDaily(fixture(),'2801.TW',now);assert.equal(q.open,28.2);assert.equal(q.high,28.25);assert.equal(q.low,27.25);assert.equal(q.prev_close,28.15);assert.equal(q.trade_date,'2026-11-18');assert.equal(q.session_state,'trading');assert.equal(q.source_time,'2026-11-18T03:44:00.000Z');assert.equal(q.strategy_signal_validated,false)});
test('minute candles, wrong ticker, invalid range and mismatched session cannot be shown',()=>{
 for(const change of [r=>r.meta.dataGranularity='1m',r=>r.meta.symbol='9999.TW',r=>r.indicators.quote[0].high[1]=26,r=>r.timestamp.pop(),r=>r.meta.regularMarketTime=ts('2026-11-19T03:44:00Z')]){const f=fixture();change(f.chart.result[0]);assert.equal(parseYahooDaily(f,'2801.TW',now),null)}
});
test('previous session and source delay are explicit',()=>{assert.equal(parseYahooDaily(fixture(),'2801.TW',now+86400000).session_state,'previous_session');assert.equal(parseYahooDaily(fixture(),'2801.TW',now+240000).delayed,true)});
test('OTC discovery tries TWO and never fabricates prices on failure',async()=>{let urls=[];const q=await fetchYahooStock('3324',async u=>{urls.push(u);return u.includes('3324.TW?')?new Response('',{status:404}):Response.json(fixture('3324.TWO'))},now);assert.equal(q.exchange,'TPEX');assert.equal(urls.length,2);const missing=await fetchYahooStock('9999',async()=>new Response('',{status:404}),now);assert.equal(missing.price,null);assert.equal(missing.status,'unavailable')});
test('route rejects arbitrary symbol URLs and still returns partial successes',async()=>{
 const bad=await a56QuotesRoute(new Request('https://site/api?codes=https://evil'));assert.equal(bad.status,400);
 const tsNow=Date.now();const f=fixture();const r=f.chart.result[0];r.meta.regularMarketTime=Math.floor(tsNow/1000);r.timestamp[1]=Math.floor(tsNow/1000)-1;
 const res=await a56QuotesRoute(new Request('https://site/api?codes=2801,9998'),{},async u=>u.includes('2801.TW?')?Response.json(f):new Response('',{status:404}));const d=await res.json();assert.equal(res.status,200);assert.equal(d.quotes.length,2);assert.equal(d.quotes[0].status,'available');assert.equal(d.quotes[1].price,null);
});
test('watch list includes holdings, sales, buys and candidates exactly once',()=>{const rows=collectQuoteCodes({holdings:[{code:'2801'}]},{actions:[{code:'2801',side:'HOLD'},{code:'3406',side:'BUY'},{code:'3324',side:'SELL'}],candidates:[{code:'3406'},{code:'3653'},{code:'<script>'}]});assert.deepEqual(rows.map(r=>r.code),['2801','3406','3324','3653']);assert.deepEqual(rows[1].roles,['條件買入','反轉候選'])});
