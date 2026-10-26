import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { etfVixDailyRoute } from '../src/etf-vix-daily.mjs';

test('Cloudflare proxy rejects unbatched 26-year query', async()=>{
  const req=new Request('https://example.workers.dev/api/etf-vix-daily?dataset=TaiwanStockPrice&data_id=0050&start_date=2000-01-01&end_date=2026-10-26');
  const res=await etfVixDailyRoute(req,{FINMIND_TOKEN:'fake'});
  assert.equal(res.status,400);
  assert.match((await res.json()).msg,/Date window too wide/);
});

test('Cloudflare proxy accepts bounded 0050 and VIX queries', async()=>{
  const prior=globalThis.fetch;
  const got=[];
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(String(url));got.push({u,opts});
    return new Response(JSON.stringify({status:200,msg:'ok',data:[{date:'2026-10-01',close:106.9}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  try{
    for(const params of [
      'dataset=TaiwanStockPrice&data_id=0050&start_date=2021-01-01&end_date=2021-12-31',
      'dataset=TaiwanStockPriceAdj&data_id=0050&start_date=2021-01-01&end_date=2021-12-31',
      'dataset=TaiwanOptionVix&start_date=2026-10-01&end_date=2026-10-14'
    ]){
      const res=await etfVixDailyRoute(new Request('https://example.workers.dev/api/etf-vix-daily?'+params),{FINMIND_TOKEN:'server-secret'});
      assert.equal(res.status,200);
      assert.equal((await res.json()).data.length,1);
    }
    assert.equal(got.length,3);
    for(const x of got)assert.equal(x.opts.headers.Authorization,'Bearer server-secret');
  }finally{globalThis.fetch=prior;}
});

test('Downloaded page batches 2000-2026 stock range and VIX to 14 days max',async()=>{
  const html=fs.readFileSync(new URL('../public/0050-vix-download.html',import.meta.url),'utf8');
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline,'Missing inline JS');
  const compiled=new vm.Script(inline[1]);
  const elements=new Map();
  function elm(id){
    if(!elements.has(id))elements.set(id,{
      value:'', textContent:id==='log'?'操作紀錄會顯示在這裡。':'',disabled:false,children:[],scrollHeight:0,
      replaceChildren(){this.children=[]},append(el){this.children.push(el)}
    });
    return elements.get(id);
  }
  const calls=[];
  const document={getElementById:elm,createElement:()=>({
    children:[],append(el){this.children.push(el)}, textContent:''
  })};
  const fetch=async(url,options)=>{
    const u=new URL(String(url)); calls.push({u,options});
    assert.equal(u.pathname,'/api/etf-vix-daily');
    const from=u.searchParams.get('start_date'),to=u.searchParams.get('end_date');
    const inclusive=(Date.parse(to)-Date.parse(from))/86400000+1;
    const ds=u.searchParams.get('dataset');
    assert.ok(inclusive<=(ds==='TaiwanOptionVix'?14:365),ds+' window='+inclusive);
    const data=ds==='TaiwanOptionVix'
      ?[{date:from,time:'09:00:00',vix:28.4},{date:from,time:'13:30:00',vix:25.1}]
      :[{date:from,open:100,max:103,min:99,close:102,trading_volume:100000,trading_money:10300000,trading_turnover:100}];
    if(from<='2026-10-01'&&to>='2026-10-01'){
      data.push(ds==='TaiwanOptionVix'?{date:'2026-10-01',time:'13:30:00',vix:26}:{date:'2026-10-01',open:101,max:105,min:100,close:103,trading_volume:200000,trading_money:20600000,trading_turnover:200});
    }
    return {ok:true,status:200,json:async()=>({status:200,msg:'success',data})};
  };
  const ctx=vm.createContext({
    document,window:{TWFinMindTokens:{activeToken:()=>''}},
    location:{origin:'https://example.workers.dev'},
    fetch,URL,Date,Number,Map,Set,Math,Blob,console,setTimeout
  });
  compiled.runInContext(ctx);
  elm('start').value='2000-01-01';
  elm('end').value='2026-10-26';
  await vm.runInContext('loadStock()',ctx);
  await vm.runInContext('loadVix()',ctx);
  const price=calls.filter(x=>x.u.searchParams.get('dataset')==='TaiwanStockPrice');
  const adj=calls.filter(x=>x.u.searchParams.get('dataset')==='TaiwanStockPriceAdj');
  const vix=calls.filter(x=>x.u.searchParams.get('dataset')==='TaiwanOptionVix');
  assert.ok(price.length>20);
  assert.equal(price.length,adj.length);
  assert.ok(vix.length>10);
  assert.equal(price[0].u.searchParams.get('start_date'),'2003-06-30');
  assert.equal(vix[0].u.searchParams.get('start_date'),'2026-03-01');
  assert.ok(+elm('rawCount').textContent>20);
  assert.ok(+elm('vixCount').textContent>10);
  assert.equal(+elm('matchCount').textContent,1);
  const first=vm.runInContext('stockRaw[0]',ctx);
  assert.equal(first.volume,100000);
  assert.equal(first.trading_money,10300000);
  assert.equal(first.trading_turnover,100);
});
