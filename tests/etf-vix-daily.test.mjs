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
  new vm.Script(fs.readFileSync(new URL('../public/0050-corporate-actions.js',import.meta.url),'utf8')).runInContext(ctx);
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

test('Credentials: Cloudflare Secret selected over stale browser header, status does not leak secret',async()=>{
  const status=await etfVixDailyRoute(new Request('https://example.workers.dev/api/etf-vix-daily?action=status'),
    {FINMIND_TOKEN:'valid-cloud-secret'});
  assert.equal(status.status,200);
  const output=await status.json();
  assert.equal(output.cloud_available,true);
  assert.ok(!JSON.stringify(output).includes('valid-cloud-secret'));

  const before=globalThis.fetch;
  let called=0;
  globalThis.fetch=async(url,opts)=>{
    called++;
    assert.equal(opts.headers.Authorization,'Bearer valid-cloud-secret');
    return new Response(JSON.stringify({status:200,msg:'ok',data:[{date:'2026-10-21',close:50}]}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const input=new Request('https://example.workers.dev/api/etf-vix-daily?action=probe&credential=cloud',{
      headers:{Authorization:'Bearer stale-illegal-browser-token'}
    });
    const res=await etfVixDailyRoute(input,{FINMIND_TOKEN:'valid-cloud-secret'});
    assert.equal(res.status,200);
    assert.equal((await res.json()).credential_source,'cloud-secret');
    assert.equal(called,1);
  }finally{globalThis.fetch=before;}
});

test('Credentials: FinMind rejects invalid user Token and proxy provides actionable AUTH_INVALID',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async(url,opts)=>{
    assert.equal(opts.headers.Authorization,'Bearer expired');
    return new Response(JSON.stringify({status:400,msg:'Token is illegal.',data:[]}),
      {status:400,headers:{'content-type':'application/json'}});
  };
  try{
    const req=new Request('https://example.workers.dev/api/etf-vix-daily?action=probe&credential=browser',{
      headers:{Authorization:'Bearer expired'}
    });
    const res=await etfVixDailyRoute(req,{FINMIND_TOKEN:'valid-cloud-secret'});
    assert.equal(res.status,401);
    const json=await res.json();
    assert.equal(json.code,'AUTH_INVALID');
    assert.equal(json.credential_source,'browser');
    assert.match(json.msg,/Token is illegal/);
  }finally{globalThis.fetch=before;}
});

test('Browser client mode enforces source, strips pasted Bearer prefix, and tests without downloading',async()=>{
  const html=fs.readFileSync(new URL('../public/0050-vix-download.html',import.meta.url),'utf8');
  const script=new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  const elems=new Map();
  function get(id){
    if(!elems.has(id))elems.set(id,{value:'',textContent:'',disabled:false,dataset:{},scrollHeight:0,
      options:[{text:'雲端'},{text:'原網站'},{text:'手動'},{text:'匿名'}],selectedIndex:0,
      replaceChildren(){},append(){}});
    return elems.get(id);
  }
  const calls=[];
  const fetch=async(url,opts={})=>{
    const u=new URL(String(url));calls.push({u,opts});
    if(u.searchParams.get('action')==='status')return {ok:true,status:200,json:async()=>({status:200,cloud_available:true})};
    assert.equal(u.searchParams.get('action'),'probe');
    return {ok:true,status:200,json:async()=>({status:200,credential_source:u.searchParams.get('credential'),rows:3})};
  };
  const ctx=vm.createContext({document:{getElementById:get,createElement:()=>({append(){}})},
    window:{TWFinMindTokens:{activeToken:()=> 'old-browser-token'}},
    fetch,URL,Date,Number,Map,Set,Math,Blob,console,setTimeout,location:{origin:'https://example.workers.dev'}});
  new vm.Script(fs.readFileSync(new URL('../public/0050-corporate-actions.js',import.meta.url),'utf8')).runInContext(ctx);
  script.runInContext(ctx);
  await vm.runInContext('detectCredentials(true)',ctx);
  assert.equal(get('credentialMode').value,'cloud');
  get('credentialMode').value='cloud';
  await vm.runInContext("probeCredential('probe')",ctx);
  let cloud=calls.at(-1);
  assert.equal(cloud.u.searchParams.get('credential'),'cloud');
  assert.equal(cloud.opts.headers.Authorization,undefined);
  get('credentialMode').value='browser';
  await vm.runInContext("probeCredential('probe')",ctx);
  assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer old-browser-token');
  get('credentialMode').value='manual';
  get('token').value='Bearer fresh-manual-token';
  await vm.runInContext("probeCredential('probe')",ctx);
  assert.equal(calls.at(-1).opts.headers.Authorization,'Bearer fresh-manual-token');
  get('credentialMode').value='anonymous';
  await vm.runInContext("probeCredential('probe')",ctx);
  assert.equal(calls.at(-1).opts.headers.Authorization,undefined);
});
