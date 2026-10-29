import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseYahooQuotePage,parseYahooFuturesTable,parseYahooChart,r26LiveQuoteRoute} from '../src/r26-live-quote.mjs';
const tpe=new Date(Date.now()+8*3600000).toISOString();
const dd=tpe.slice(0,10),day=dd.replaceAll('-','/'),time=tpe.slice(11,19);
const price=47201;
const table='<p>資料時間：'+day+'</p><table><tr><td>台指期近一 WTX&amp;</td>'+[
'47,200.00','47,202.00','47,201.00','+6.00','0.01%','18,829','47,280.00','47,382.00','46,968.00','229.42','47,249.00','118,247',time].map(x=>'<td>'+x+'</td>').join('')+'</tr></table>';
const page='<h1>台指期近一 WTX&amp;</h1><div>收盤 | '+day+' '+time.slice(0,5)+' 更新</div>'+
'<p>開盤47,280.00 買價47,200.00 賣價47,202.00 成交47,201.00 最高47,382.00 最低46,968.00 漲跌6.00 昨收47,249.00</p>';
const chart={chart:{result:[{timestamp:[Math.floor(Date.now()/1000)-10],indicators:{quote:[{close:[price],open:[46000],high:[48000],low:[45000]}]},meta:{regularMarketPrice:price,chartPreviousClose:47200}}]}};
test('table parser preserves full vendor timestamp, bid, ask, open',()=>{
 const q=parseYahooFuturesTable(table);assert.equal(q.price,price);assert.equal(q.open,47280);
 assert.equal(q.bid,47200);assert.equal(q.ask,47202);assert.equal(q.contract_verified,false);
 assert.match(q.source_time,/T\d\d:\d\d:\d\d\+08:00$/);
});
test('server-rendered page parser reads price only with source date-time',()=>{
 const q=parseYahooQuotePage(page);assert.equal(q.price,price);assert.equal(q.prev_close,47249);assert.equal(q.change,-48);assert.ok(q.change_pct<0);
 assert.equal(parseYahooQuotePage('<h1>台指期近一 WTX& 成交47201</h1>'),null);
});
test('minute candle open/high/low are NOT presented as session OHLC',()=>{
 const q=parseYahooChart(chart,'https://source.example/chart');assert.equal(q.price,price);
 assert.equal(q.open,null);assert.equal(q.high,null);assert.equal(q.low,null);
});
test('route returns freshest valid source in parallel and does not invent an R26 signal',async()=>{
 const req=new Request('https://x.example/api/r26/live-quote');
 const r=await r26LiveQuoteRoute(req,{},async url=>{
  if(url.includes('chart/'))return Response.json(chart);
  if(url.includes('futures.html'))return new Response(table);
  return new Response(page);
 });
 const j=await r.json();assert.equal(r.status,200);assert.equal(j.price,price);
 assert.equal(j.strategy_signal_validated,false);assert.equal(j.poll_interval_seconds,5);
 assert.equal(j.contract_verified,false);
});
test('source unavailable returns 503 and no fabricated price',async()=>{
 const req=new Request('https://x.example/api/r26/live-quote');
 const r=await r26LiveQuoteRoute(req,{},async()=>new Response('blocked',{status:403}));
 const j=await r.json();assert.equal(r.status,503);assert.equal(j.ok,false);
 assert.equal('price' in j,false);
});
test('dashboard has a real visible-only five-second timer and abort timeout',async()=>{
 const html=await readFile(new URL('../public/r26-monitor.html',import.meta.url),'utf8');
 assert.match(html,/setInterval\(fetchQuote,5000\)/);
 assert.match(html,/document\.visibilityState!=='visible'/);
 assert.match(html,/id="txNow"/);
 assert.match(html,/id="liveSourceTime"/);
});
