const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {page,fixture}=require('./helpers/detail-page.cjs');
const source=fs.readFileSync('src/index.js','utf8').replace(/export default\s*\{/,'globalThis.worker = {');
function backend({fail=false}={}){
 const saved=new Map(),calls=[];const ctx=vm.createContext({URL,URLSearchParams,Request,Response,Headers,AbortSignal,TextDecoder,Intl,Date,console,setTimeout:fn=>setTimeout(fn,0),clearTimeout,caches:{default:{match:async r=>saved.get(r.url)?.clone(),put:async(r,v)=>saved.set(r.url,v.clone())}},fetch:async url=>{
  const u=new URL(url);calls.push(u);
  if(u.hostname==='api.finmindtrade.com'){
   if(fail)return Response.json({status:402,msg:'Requests reach the upper limit.'},{status:402});
   const data=u.searchParams.get('dataset')==='TaiwanStockInstitutionalInvestorsBuySell'?[{date:'2026-10-02',name:'Foreign_Investor',buy:3000,sell:1000}]:[];
   return Response.json({status:200,data});
  }
  if(u.pathname.includes('MI_MARGN'))return Response.json({fields:['股票代號','今日餘額','前日餘額'],data:[['3016',100,90]]});
  if(u.pathname.includes('T86'))return Response.json({fields:['證券代號','外陸資買賣超股數'],data:[['3016',2000]]});
  return Response.json({fields:[],data:[]});
 }});vm.runInContext(source,ctx);return {worker:ctx.worker,saved,calls};
}
test('one analysis request, formatted stock input retries, independent refresh preserves history and audit date',async()=>{
 const p=page('detail.html');p.ctx.rows=fixture();const calls=[];let mode='empty';
 vm.runInContext("STATE.info=[{stock_id:'3016',stock_name:'嘉晶',type:'twse'},{stock_id:'3707',stock_name:'漢磊',type:'tpex'}];$('stockInput').value='3016';",p.ctx);
 p.ctx.fetch=async url=>{
  calls.push(String(url));
  if(String(url).includes('/api/history/auto'))return Response.json({ok:true,data:p.ctx.rows});
  if(String(url).includes('/api/chips/hybrid'))return Response.json(mode==='empty'?{ok:false,diagnostics:[{dataset:'TaiwanStockMarginPurchaseShortSale',ok:false,http:402,msg:'Requests reach the upper limit.'}]}:{ok:true,margin:p.ctx.rows.slice(-8).map(r=>({date:r.date,stock_id:'3016',MarginPurchaseTodayBalance:100})),inst:p.ctx.rows.slice(-8).map(r=>({date:r.date,stock_id:'3016',Foreign_Investor_buy:1000})),daytrade:[]});
  return Response.json({ok:false});
 };
 const analyze=p.events.filter(e=>e[0]==='analyzeBtn'&&e[1]==='click');assert.equal(analyze.length,1);
 assert.equal(p.events.filter(e=>e[0]==='stockInput'&&e[1]==='keydown').length,1);
 await analyze[0][2]();
 assert.equal(calls.filter(u=>u.includes('/api/chips/hybrid')).length,1);
 assert.match(p.nodes.get('chipRefreshStatus').textContent,/額度或權限/);
 assert.equal(p.nodes.get('refreshChipsBtn').disabled,false);
 assert.equal(p.nodes.get('stockInput').value,'3016 嘉晶');
 mode='success';await analyze[0][2]();
 assert.equal(calls.filter(u=>u.includes('/api/chips/hybrid')).length,2);
 assert.equal(vm.runInContext('STATE.margin.length',p.ctx),8);
 vm.runInContext('STATE.auditIndex=80;render()',p.ctx);
 const priceCalls=calls.filter(u=>u.includes('/api/history/auto')).length;
 mode='empty';await vm.runInContext('refreshChipTrend()',p.ctx);
 assert.equal(calls.filter(u=>u.includes('/api/history/auto')).length,priceCalls);
 assert.equal(vm.runInContext('STATE.margin.length',p.ctx),8);
 assert.equal(vm.runInContext('STATE.auditIndex',p.ctx),80);
 assert.match(p.nodes.get('chipRefreshStatus').textContent,/已保留/);
 assert.equal(p.nodes.get('refreshChipsBtn').disabled,false);
 // A different stock never inherits the old stock's chips and uses its actual market.
 vm.runInContext("$('stockInput').value='3707'",p.ctx);await analyze[0][2]();
 assert.equal(vm.runInContext('STATE.margin.length',p.ctx),0);
 assert.match(calls.filter(u=>u.includes('/api/chips/hybrid')).at(-1),/market=tpex/);
});
test('rapid concurrent analysis coalesces and a failed request can be retried',async()=>{
 const p=page('detail.html');p.ctx.rows=fixture();let count=0;
 vm.runInContext("STATE.info=[{stock_id:'3016',stock_name:'嘉晶',type:'twse'}];$('stockInput').value='3016';",p.ctx);
 p.ctx.fetch=async url=>{if(String(url).includes('/api/history'))return Response.json({ok:true,data:p.ctx.rows});if(String(url).includes('/api/chips')){count++;await new Promise(r=>setTimeout(r,10));throw Error('network unavailable')}return Response.json({ok:false})};
 await Promise.all([vm.runInContext('analyze()',p.ctx),vm.runInContext('analyze()',p.ctx)]);assert.equal(count,1);
 await vm.runInContext('refreshChipTrend()',p.ctx);assert.equal(count,2);assert.match(p.nodes.get('chipRefreshStatus').textContent,/network unavailable/);
});
test('FinMind quota failure restores both chart histories from recent TWSE reports, skips weekend',async()=>{
 const a=backend({fail:true});const r=await a.worker.fetch(new Request('https://test/api/chips/hybrid?code=3016&market=twse&start_date=2026-09-01&end_date=2026-10-04&force=1'),{}),j=await r.json();
 assert.equal(j.margin.length,8);assert.equal(j.inst.length,8);assert.equal(j.margin.at(-1).date,'2026-10-02');
 assert.equal(a.calls.some(u=>u.searchParams.get('date')==='20261004'),false);
 assert.equal(a.calls.some(u=>u.searchParams.get('dataset')?.endsWith('Wide')),false);
 assert.ok(a.calls.length<50);assert.equal(j.history_ready.inst,true);
});
test('forced quota failure retains cached tpex history and empty responses are not cached',async()=>{
 const a=backend({fail:true});const key='https://test/__cache/chips-r28/anon/tpex/3707/2026-09-01/2026-10-04';
 a.saved.set(key,Response.json({ok:true,margin:[{date:'2026-10-02',MarginPurchaseTodayBalance:100}],inst:[{date:'2026-10-02',Foreign_Investor_buy:2000}]}));
 const j=await (await a.worker.fetch(new Request('https://test/api/chips/hybrid?code=3707&market=tpex&start_date=2026-09-01&end_date=2026-10-04&force=1'),{})).json();
 assert.equal(j.margin.length,1);assert.equal(j.inst.length,1);
 const b=backend({fail:true});const empty=await(await b.worker.fetch(new Request('https://test/api/chips/hybrid?code=3707&market=tpex&start_date=2026-09-01&end_date=2026-10-04'),{})).json();
 assert.equal(empty.ok,false);assert.equal(b.saved.has(key),false);
});
test('standard institutional endpoint is normalized without paid Wide request',async()=>{
 const a=backend();const j=await(await a.worker.fetch(new Request('https://test/api/chips/hybrid?code=3707&market=tpex&start_date=2026-09-01&end_date=2026-10-04'),{})).json();
 assert.equal(j.inst[0].Foreign_Investor_buy,3000);assert.equal(j.inst[0].Foreign_Investor_sell,1000);
 assert.equal(a.calls.filter(u=>u.hostname==='api.finmindtrade.com').length,3);
});
