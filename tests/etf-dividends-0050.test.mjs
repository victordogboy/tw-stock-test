import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeEtfDividends, etfDividendRoute } from '../src/etf-dividends-0050.mjs';

function actions(){
  const ctx=vm.createContext({window:{}});
  new vm.Script(fs.readFileSync(new URL('../public/0050-corporate-actions.js',import.meta.url),'utf8')).runInContext(ctx);
  return ctx.window.ETF0050;
}
test('0050 2025 split normalizes to reference price, but does not claim provider adjusted close',()=>{
 const lib=actions();
 assert.equal(lib.splitPrice(188.65,'2025-06-10'),47.1625);
 assert.equal(lib.splitPrice(47.16,'2025-06-18'),47.16);
 assert.equal(lib.splitDividend(2.7,'2025-02-05'),0.675);
 assert.equal(lib.splitDividend(0.36,'2025-08-08'),0.36);
 const joined=lib.merge([
  {date:'2025-06-10',open:187,high:189,low:186,close:188.65},
  {date:'2025-06-18',open:47.16,high:48,low:47,close:47.16}
 ],[],[],[]);
 assert.equal(joined[0].split_adjusted_close,47.1625);
 assert.equal(joined[1].split_adjusted_close,47.16);
 assert.equal(joined[0].adj_close,'');
 assert.equal(joined[1].vix_close,'');
 assert.equal(joined[1].split_event_ratio,4);
});
test('Dividend event joins by ex-dividend date; zero fill is forbidden',()=>{
 const lib=actions();
 const p=[
 {date:'2025-02-18',open:180,high:182,low:179,close:181},
 {date:'2025-08-01',open:52,high:54,low:51,close:53}
 ];
 const joined=lib.merge(p,[],[],[
 {date:'2025-02-18',cash_dividend:2.7,payment_date:'2025-02-20',source:'TWSE ETF etfDiv'}
 ]);
 assert.equal(joined[0].cash_dividend,2.7);
 assert.equal(joined[0].cash_dividend_split_unit,0.675);
 assert.equal(joined[1].cash_dividend,'');
 assert.equal(joined[1].adj_close,'');
 assert.equal(lib.audit(p,[],[],[],false).dividendsVerified,false);
});
test('TWSE ETF history response normalized from ROC dates, ignoring non-0050 symbols and pending dividends',()=>{
 const rows=[
 ['0050','元大台灣50','1140220','1140221','1140301','2.7','', '114'],
 ['0050','元大台灣50','1140801','1140802','1140808','0.36','', '114'],
 ['0050','元大台灣50','1150727','1150728','1150810','0.6','', '115'],
 ['0050','元大台灣50','1140101','','','尚未公告','', '114'],
 ['0051','其他','1140801','1140802','1140808','100','', '114']
 ];
 const normalized=normalizeEtfDividends(rows,'2025-01-01','2026-10-26');
 assert.equal(normalized.length,3);
 assert.equal(normalized[0].date,'2025-02-20');
 assert.equal(normalized[0].cash_dividend,2.7);
 assert.equal(normalized[2].date,'2026-07-27');
 assert.equal(normalized[2].cash_dividend,0.6);
});
test('Cloudflare official ETF dividend API returns normalized 0050 only, and explicitly rejects missing response data',async()=>{
 const prev=globalThis.fetch;
 let upstream='';
 try{
  globalThis.fetch=async(url)=>{
   upstream=String(url);
   return new Response(JSON.stringify({data:[
    ['0050','元大台灣50','1140801','1140802','1140808','0.36','','114'],
    ['0051','其他','1140801','1140802','1140808','9','','114']
   ]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const req=new Request('https://example.workers.dev/api/etf-dividends-0050?start_date=2025-01-01&end_date=2026-10-26');
  const res=await etfDividendRoute(req);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.rows.length,1);
  assert.equal(body.rows[0].cash_dividend,0.36);
  assert.match(upstream,/startDate=2005/);
  assert.match(upstream,/endDate=2026/);

  globalThis.fetch=async()=>new Response(JSON.stringify({status:'fail'}),{status:200,headers:{'content-type':'application/json'}});
  const fail=await etfDividendRoute(req);
  assert.equal(fail.status,502);
  assert.equal((await fail.json()).ok,false);
 }finally{globalThis.fetch=prev;}
});

test('Browser end-to-end: FinMind adjusted empty; split and TWSE dividend remain usable',async()=>{
 const html=fs.readFileSync(new URL('../public/0050-vix-download.html',import.meta.url),'utf8');
 const inner=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
 assert.ok(inner);
 const nodes=new Map();
 function node(id){
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',scrollHeight:0,disabled:false,dataset:{},
   selectedIndex:0,options:[{text:'cloud'},{text:'browser'},{text:'manual'},{text:'anon'}],
   replaceChildren(){},append(){}});
  return nodes.get(id);
 }
 const urls=[];
 const fetch=async(u)=>{
  const url=new URL(String(u),'https://example.workers.dev');urls.push(url);
  if(url.pathname==='/api/etf-dividends-0050')
   return {ok:true,json:async()=>({ok:true,rows:[
     {date:'2025-02-20',cash_dividend:2.7,payment_date:'2025-03-02',source:'TWSE ETF etfDiv'},
     {date:'2025-08-01',cash_dividend:0.36,payment_date:'2025-08-08',source:'TWSE ETF etfDiv'}]})};
  if(url.searchParams.get('action')==='status')
   return {ok:true,json:async()=>({status:200,cloud_available:false})};
  if(url.searchParams.get('dataset')==='TaiwanStockPriceAdj')
   return {ok:true,json:async()=>({status:200,msg:'success',data:[]})};
  if(url.searchParams.get('dataset')==='TaiwanStockPrice')
   return {ok:true,json:async()=>({status:200,msg:'success',data:[
    {date:'2025-02-20',open:182,close:180,max:185,min:179},
    {date:'2025-06-10',open:188,close:188.65,max:190,min:186},
    {date:'2025-06-18',open:47.16,close:47.16,max:48,min:46},
    {date:'2025-08-01',open:49,close:50,max:51,min:48}]})};
  throw Error('unexpected test URL: '+url);
 };
 const ctx=vm.createContext({document:{getElementById:node,createElement:()=>({append(){}})},
   window:{TWFinMindTokens:{activeToken:()=>''}},
   fetch,URL,Date,Number,Map,Set,Math,Blob,console,setTimeout,location:{origin:'https://example.workers.dev'}});
 new vm.Script(fs.readFileSync(new URL('../public/0050-corporate-actions.js',import.meta.url),'utf8')).runInContext(ctx);
 new vm.Script(inner).runInContext(ctx);
 node('start').value='2025-01-01';node('end').value='2025-12-31';
 await vm.runInContext('loadStock()',ctx);
 await vm.runInContext('loadDividends()',ctx);
 const data=vm.runInContext('joined()',ctx);
 assert.equal(data.length,4);
 assert.equal(data[0].split_adjusted_close,45);
 assert.equal(data[1].split_adjusted_close,47.1625);
 assert.equal(data[2].split_adjusted_close,47.16);
 assert.equal(data[0].cash_dividend,2.7);
 assert.equal(data[0].cash_dividend_split_unit,0.675);
 assert.equal(data[3].cash_dividend_split_unit,0.36);
 assert.equal(data[1].cash_dividend,'');
 assert.equal(data[0].adj_close,'');
 assert.equal(data[0].vix_close,'');
 assert.match(node('corpAudit').textContent,/FinMind 還原價缺漏：4 日/);
 assert.ok(urls.some(x=>x.pathname==='/api/etf-dividends-0050'));
});
