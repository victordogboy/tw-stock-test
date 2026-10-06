const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/index.js','utf8').replace(/export default\s*\{/,'globalThis.worker = {');
test('stale successful hybrid and dataset cache is refreshed; explicit refresh reaches official source',async()=>{
 const saved=new Map(),calls=[];let date='2026-10-05';
 const context=vm.createContext({URL,URLSearchParams,Request,Response,Headers,AbortSignal,TextDecoder,Intl,Date,console,setTimeout,clearTimeout,
 caches:{default:{match:async r=>saved.get(r.url)?.clone(),put:async(r,v)=>saved.set(r.url,v.clone())}},
 fetch:async url=>{const u=new URL(url);calls.push(u);
  if(u.hostname==='api.finmindtrade.com')return Response.json({status:200,data:u.searchParams.get('dataset')==='TaiwanStockInstitutionalInvestorsBuySell'?['Foreign_Investor','Investment_Trust'].map(name=>({date,name,buy:1000,sell:0})):[]});
  if(u.pathname.includes('T86'))return Response.json({date:'20261006',fields:['證券代號','外陸資買賣超股數','投信買賣超股數'],data:[['3443',1000,2000]]});
  return Response.json({date:'20261006',fields:[],data:[]});
 }});vm.runInContext(source,context);
 const path='https://test/api/chips/hybrid?code=3443&market=tpex&start_date=2026-09-01&end_date=2026-10-06&require_current=1';
 let j=await (await context.worker.fetch(new Request(path),{})).json();assert.equal(j.current_detail.inst,false);assert.equal(j.data_dates.inst,'2026-10-05');
 date='2026-10-06';j=await (await context.worker.fetch(new Request(path),{})).json();assert.equal(j.current_detail.inst,true);assert.equal(j.data_dates.inst,'2026-10-06');
 assert.equal(calls.filter(u=>u.searchParams.get('dataset')==='TaiwanStockInstitutionalInvestorsBuySell').length,2);
 const listed=path.replace('market=tpex','market=twse');await context.worker.fetch(new Request(listed),{});await context.worker.fetch(new Request(listed+'&force=1'),{});
 assert.equal(calls.filter(u=>u.pathname.includes('T86')&&u.searchParams.get('date')==='20261006').length,2,'force bypasses official cache too');
});
