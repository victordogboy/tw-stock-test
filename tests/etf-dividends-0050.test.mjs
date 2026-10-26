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
