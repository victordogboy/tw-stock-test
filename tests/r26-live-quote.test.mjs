import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseYahooQuotePage,parseYahooFuturesTable,parseYahooChart,r26LiveQuoteRoute,summarizeNamedMinuteSession} from '../src/r26-live-quote.mjs';
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
test('named contract minute summary fills verified session OHLC and minute volume, never bid or ask',()=>{
 const session='day:2026-11-12',contract='202611';
 const make=(time,open,high,low,close,volume)=>({timestamp_tpe:'2026-11-12 '+time+':00',
  contract_date:contract,contract_verified:true,session:'day',session_key:session,open,high,low,close,volume});
 const bars=[make('08:45',44000,44012,43992,44005,7),make('08:46',44005,44024,43998,44010,12),
  {...make('08:47',44010,45000,43000,44000,2),contract_date:'202612'},
  {...make('08:47',44010,45000,43000,44000,2),session_key:'night:2026-11-12'}];
 const x=summarizeNamedMinuteSession(bars,contract);
 assert.equal(x.complete_from_session_open,true);assert.equal(x.open,44000);
 assert.equal(x.high,44024);assert.equal(x.low,43992);assert.equal(x.volume,19);assert.equal(x.bars,2);
});
test('named-minute summary hides full session OHLC when opening candle or minute is missing',()=>{
 const row=(m)=>({timestamp_tpe:'2026-11-12 08:'+m+':00',contract_date:'202611',
  contract_verified:true,session:'day',session_key:'day:2026-11-12',open:44000,high:44005,low:43990,close:44001,volume:1});
 for(const bars of [[row('46')],[row('45'),row('47')]]){
  const x=summarizeNamedMinuteSession(bars,'202611');
  assert.equal(x.complete_from_session_open,false);
  for(const k of ['open','high','low','volume'])assert.equal(x[k],null);
 }
 assert.equal(summarizeNamedMinuteSession([row('45')],'202612'),null);
});
test('fast lane never waits for named-month HTML and keeps source failure explicit',async()=>{
 let seen=[];
 const req=new Request('https://x.example/api/r26/live-quote?contract=202611&mode=quick');
 const r=await r26LiveQuoteRoute(req,{},async url=>{seen.push(url);return new Response('blocked',{status:403})});
 const j=await r.json();
 assert.equal(r.status,503);assert.equal(j.ok,false);
 assert.equal(j.requested_mode,'quick');assert.equal(j.requested_contract,'202611');
 assert.equal('price' in j,false);assert.equal(seen.length,3);
 assert.equal(seen.some(x=>x.includes('/quote/WTX')),false);
});
test('named lane only calls the selected monthly contract quote, not continuous WTX',async()=>{
 let seen=[];
 const req=new Request('https://x.example/api/r26/live-quote?contract=202611&mode=named');
 const r=await r26LiveQuoteRoute(req,{},async url=>{seen.push(url);return new Response('blocked',{status:403})});
 const j=await r.json();
 assert.equal(r.status,503);assert.equal(j.ok,false);
 assert.equal(j.requested_mode,'named');assert.equal(seen.length,1);
 assert.match(seen[0],/\/quote\/WTX/);
 assert.equal(seen[0].includes('/future/WTX%26'),false);
});
test('quote modes and invalid named month are rejected',async()=>{
 let r=await r26LiveQuoteRoute(new Request('https://x.example/api/r26/live-quote?mode=unknown'));
 assert.equal(r.status,400);
 r=await r26LiveQuoteRoute(new Request('https://x.example/api/r26/live-quote?mode=named&contract=202613'));
 assert.equal(r.status,400);
});
test('CMoney quote mode returns independent near-month reference without a verified contract',async()=>{
 const local=new Date(Date.now()+8*3600000).toISOString();
 const m=local.slice(5,7),d=local.slice(8,10),clock=local.slice(11,16);
 const body='<p>報價時間 | '+m+'/'+d+' '+clock+'</p><h3>台指期 TXF1</h3>'+
  ' 日盤 夜盤 44,382 246(+0.56%) 開 44,166 昨 44,136 高 44,407 低 43,822';
 const seen=[];
 const r=await r26LiveQuoteRoute(new Request('https://x.example/api/r26/live-quote?contract=202611&mode=cmoney'),
  {},async url=>{seen.push(url);return new Response(body)});
 const j=await r.json();
 assert.equal(r.status,200);assert.equal(j.ok,true);
 assert.equal(j.requested_mode,'cmoney');assert.equal(j.price,44382);
 assert.equal(j.symbol,'TXF1');assert.equal(j.contract_verified,false);
 assert.equal(j.contract_month,null);assert.equal(j.source_time.endsWith('Z'),true);
 assert.equal(j.open,44166);assert.equal(j.high,44407);assert.equal(j.low,43822);
 assert.equal(seen.length,2);assert.equal(seen.some(x=>x.includes('finance.yahoo.com')),false);
});
test('CMoney mode never fabricates a quote when both sites are blocked',async()=>{
 const r=await r26LiveQuoteRoute(new Request('https://x.example/api/r26/live-quote?contract=202611&mode=cmoney'),
  {},async()=>new Response('blocked',{status:403}));
 const j=await r.json();
 assert.equal(r.status,503);assert.equal(j.ok,false);
 assert.equal('price' in j,false);assert.equal(j.providers_checked.length,2);
});
test('source unavailable returns 503 and no fabricated price',async()=>{
 const req=new Request('https://x.example/api/r26/live-quote');
 const r=await r26LiveQuoteRoute(req,{},async()=>new Response('blocked',{status:403}));
 const j=await r.json();assert.equal(r.status,503);assert.equal(j.ok,false);
 assert.equal('price' in j,false);
});
test('dashboard has a real visible-only five-second timer and abort timeout',async()=>{
 const html=await readFile(new URL('../public/r26-monitor.html',import.meta.url),'utf8');
 assert.match(html,/setInterval\\(fetchQuote,5000\\)/);
 assert.match(html,/setInterval\\(fetchNamedQuote,20000\\)/);
 assert.match(html,/mode=\\x27\\+mode/);
 assert.match(html,/document\.visibilityState!=='visible'/);
 assert.match(html,/id="txNow"/);
 assert.match(html,/id="liveSourceTime"/);
 assert.ok(html.indexOf('id="signalPanel"')<html.indexOf('id="liveQuotePanel"'));
 assert.match(html,/id="signalDirectionHero"/);
 assert.match(html,/mode==='quick'\?4300:mode==='cmoney'\?6000:16500/);
});
