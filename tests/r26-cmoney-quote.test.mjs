import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCmoneyTxf1Page,fetchCmoneyTxf1} from '../src/r26-cmoney-quote.mjs';

const now=Date.parse('2026-11-12T11:38:00+08:00');
const page=(time='11:37',extra='')=>
 '<h3>台股大盤行情</h3><p>報價時間 | 11/12 '+time+' 更新</p>'+
 '<p>加權指數 TWA00 44,385 128(+0.29%) 開 44,180</p>'+
 '<h4>台指期 TXF1</h4> 日盤 夜盤 44,382 246(+0.56%) 開 44,166 昨 44,136 高 44,407 低 43,822 '+extra;

test('CMoney parser reads TXF1 and timestamp rather than TWA00 index',()=>{
 const q=parseCmoneyTxf1Page(page(),undefined,now);
 assert.equal(q.symbol,'TXF1');assert.equal(q.price,44382);
 assert.equal(q.open,44166);assert.equal(q.high,44407);assert.equal(q.low,43822);
 assert.equal(q.prev_close,44136);assert.equal(q.quote_type,'snapshot');
 assert.equal(q.contract_verified,false);assert.equal(q.contract_month,null);
 assert.equal(q.source_time,'2026-11-12T03:37:00.000Z');
 assert.equal(q.quote_age_seconds,60);assert.equal(q.quote_status,'recent');
 assert.equal(q.bid,null);assert.equal(q.ask,null);assert.equal(q.volume,null);
});
test('CMoney quote never fabricates timestamp or price',()=>{
 assert.equal(parseCmoneyTxf1Page(page().replace('報價時間','其他時間'),undefined,now),null);
 assert.equal(parseCmoneyTxf1Page(page().replace('台指期 TXF1','台指期 MTX'),undefined,now),null);
 assert.equal(parseCmoneyTxf1Page('<p>台指期 TXF1 開 44,166</p>',undefined,now),null);
});
test('CMoney source can be stale despite a recently fetched web page',()=>{
 const q=parseCmoneyTxf1Page(page('01:35'),undefined,now);
 assert.equal(q.quote_status,'stale');assert.ok(q.quote_age_seconds>3600);
});
test('CMoney inconsistent cross-session high and low never become apparent valid OHLC',()=>{
 const q=parseCmoneyTxf1Page(page().replace('高 44,407','高 44,100'),undefined,now);
 assert.equal(q.price,44382);assert.equal(q.open,null);
 assert.equal(q.high,null);assert.equal(q.low,null);
});
test('CMoney fetch falls back when one public site returns 403',async()=>{
 const originalNow=Date.now;
 try{
  Date.now=()=>now;
  let attempts=0;
  const f=async url=>{
   attempts++;
   if(url.includes('auth.cmoney'))return new Response(page());
   return new Response('blocked',{status:403});
  };
  const x=await fetchCmoneyTxf1(f);
  assert.equal(attempts,2);assert.equal(x.quote?.price,44382);
  assert.equal(x.errors.length,1);
 }finally{Date.now=originalNow}
});
test('R26 dashboard has isolated CMoney, quick and named timers',async()=>{
 const html=await readFile(new URL('../public/r26-monitor.html',import.meta.url),'utf8');
 assert.match(html,/setInterval\(fetchQuote,5000\)/);
 assert.match(html,/setInterval\(fetchCmoneyQuote,10000\)/);
 assert.match(html,/setInterval\(fetchNamedQuote,20000\)/);
 assert.match(html,/mode==='cmoney'/);
 assert.ok(html.indexOf('id="signalPanel"')<html.indexOf('id="liveQuotePanel"'));
});
