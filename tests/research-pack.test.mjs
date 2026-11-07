import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {gunzipSync} from "node:zlib";
import {RESEARCH_DATASETS,researchPackRoute,researchFetch,researchAlarm} from "../src/research-pack.mjs";

const host="https://tw-stock-api.victordogboy.workers.dev";
class Storage{
 constructor(){this.data=new Map();this.alarmValue=null}
 async get(k){return this.data.get(k)}
 async put(k,v){this.data.set(k,v)}
 async setAlarm(t){this.alarmValue=t}
}
function setup(){
 const tasks=new Map(),shards=new Map();
 const env={
  STOCK_FUTURES_BATCH:{idFromName:x=>x,get(id){
   if(!tasks.has(id)){
    const storage=new Storage(),ctx={storage};
    tasks.set(id,{ctx,fetch:request=>researchFetch(ctx,env,request instanceof Request?request:new Request(request)),alarm:()=>researchAlarm(ctx,env)})
   }
   return tasks.get(id)
  }},
  STOCK_FUTURES_DATA:{idFromName:x=>x,get(id){
   if(!shards.has(id))shards.set(id,new Map());
   const store=shards.get(id);
   return {fetch:async req=>{
    const u=new URL(typeof req==="string"?req:req.url);
    if(u.pathname==="/put"){
     const date=u.searchParams.get("date");
     store.set(date,new Uint8Array(await req.arrayBuffer()));
     return Response.json({ok:true})
    }
    if(u.pathname==="/get-years"){
     const date=u.searchParams.get("startYear")+"-01-01";
     const bytes=store.get(date);
     return bytes?new Response(bytes,{headers:{"content-type":"application/gzip"}}):
      Response.json({ok:false,error:"missing"}, {status:404})
    }
    throw Error("unexpected shard path "+u.pathname)
   }}
  }}
 };
 return {env,tasks,shards}
}
test("official research source inventory includes raw prices, adjusted prices, institutions, short balance, fundamentals, shareholding",()=>{
 const expected=[
 "TaiwanStockPrice","TaiwanStockPriceAdj","TaiwanStockInfo","TaiwanStockTradingDate","TaiwanStockPriceLimit","TaiwanStockSuspended",
 "TaiwanStockInstitutionalInvestorsBuySellWide","TaiwanStockInstitutionalInvestorsBuySell","TaiwanStockTotalInstitutionalInvestors",
 "TaiwanStockMarginPurchaseShortSale","TaiwanStockTotalMarginPurchaseShortSale","TaiwanStockSecuritiesLending",
 "TaiwanDailyShortSaleBalances","TaiwanStockShareholding","TaiwanStockHoldingSharesPer","TaiwanStockMonthRevenue",
 "TaiwanStockFinancialStatements","TaiwanStockBalanceSheet","TaiwanStockCashFlowsStatement","TaiwanStockPER",
 "TaiwanStockMarketValue","TaiwanStockDividend","TaiwanStockDividendResult","TaiwanStockCapitalReductionReferencePrice",
 "TaiwanStockSplitPrice","TaiwanStockDelisting","TaiwanStockTotalReturnIndex","TaiwanStockIndustryChainMoneyFlow",
 "TaiwanStockBrokerDailyConcentration","TaiwanStockTradingDailyReport","TaiwanStockTradingDailyReportSecIdAgg",
 "TaiwanStockMarginMaintenance","TaiwanStockDispositionSecuritiesPeriod","TaiwanFuturesDaily"
 ];
 for(const name of expected)assert.ok(RESEARCH_DATASETS.some(d=>d.name===name),"missing "+name);
 assert.equal(new Set(RESEARCH_DATASETS.map(s=>s.name)).size,RESEARCH_DATASETS.length);
 for(const special of ["TaiwanFuturesDaily","TaiwanStockTradingDailyReportSecIdAgg"])
  assert.ok(["special_endpoint","needs_verified_contract_codes"].includes(RESEARCH_DATASETS.find(s=>s.name===special).scope));
});
test("research cloud job stores actual source raw rows in gzip, rejects cross-stock without fabricating dates, exports valid zip",async()=>{
 const f=setup(),prev=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  const u=new URL(String(url)),dataset=u.searchParams.get("dataset"),code=u.searchParams.get("data_id")||"";
  calls.push({dataset,code,start:u.searchParams.get("start_date"),end:u.searchParams.get("end_date")});
  if(dataset==="TaiwanStockInfo")return Response.json({status:200,data:[
   {stock_id:"2330",stock_name:"台積電",type:"twse",date:"2026-11-06",industry_category:"半導體"}
  ]});
  if(dataset==="TaiwanStockDelisting")return Response.json({status:200,data:[]});
  if(dataset==="TaiwanStockPrice")return Response.json({status:200,data:[
   {stock_id:"2330",date:"2026-11-06",open:100,max:102,min:99,close:101,
    Trading_Volume:12000,Trading_money:1200000,Trading_turnover:50}
  ]});
  if(dataset==="TaiwanStockInstitutionalInvestorsBuySell")return Response.json({status:200,data:[
   {stock_id:"2330",date:"2026-11-06",name:"Foreign_Investor",buy:100,sell:200},
   {stock_id:"2330",date:"2026-11-06",name:"Investment_Trust",buy:300,sell:100}
  ]});
  return Response.json({status:200,data:[]})
 };
 try{
  const start=await researchPackRoute(new Request(host+"/api/research-pack/start",{method:"POST",headers:{
   authorization:"Bearer a-research-test-token","content-type":"application/json"},
   body:JSON.stringify({scope:"all",codes:["2330"],start:"2026-11-06",end:"2026-11-06",stages:[1]})
  }),f.env);
  assert.equal(start.status,202);
  const cookie=start.headers.get("set-cookie").split(";")[0];
  assert.match(cookie,/__Host-tw-momentum-research=/);
  const id="research-pack:"+cookie.split("=")[1],task=f.tasks.get(id);
  assert.ok(task);
  await task.alarm();
  let phase=await (await researchPackRoute(new Request(host+"/api/research-pack/status",{headers:{cookie}}),f.env)).json();
  assert.equal(phase.count,1);assert.equal(phase.phase,"running");
  for(let n=0;n<35;n++){
   await task.alarm();
   phase=await (await researchPackRoute(new Request(host+"/api/research-pack/status",{headers:{cookie}}),f.env)).json();
   if(phase.phase==="done")break
  }
  assert.equal(phase.phase,"done",JSON.stringify(phase.errors));
  assert.equal(phase.rows,3);
  assert.equal(phase.datasetStats.TaiwanStockPrice.rows,1);
  assert.equal(phase.datasetStats.TaiwanStockInstitutionalInvestorsBuySell.rows,2);
  const before=calls.length;
  const zipResponse=await researchPackRoute(new Request(host+"/api/research-pack/export?year=2026&priority=1&part=1",{headers:{cookie}}),f.env);
  assert.equal(zipResponse.status,200);
  const bytes=Buffer.from(await zipResponse.arrayBuffer());
  assert.equal(before,calls.length,"export must not fetch FinMind data again");
  const snippet=String.raw`
import io,sys,json,zipfile,gzip
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 files=z.namelist()
 assert '10_metadata/manifest.json' in files
 p=next(f for f in files if f.startswith('01_stock_price/TaiwanStockPrice/'))
 inst=next(f for f in files if f.startswith('02_institutional/TaiwanStockInstitutionalInvestorsBuySell/'))
 raw=gzip.decompress(z.read(p)).decode()
 trading=gzip.decompress(z.read(inst)).decode()
 assert '12000' in raw and '2330' in raw
 assert 'Foreign_Investor' in trading and 'Investment_Trust' in trading
 assert 'publication_time_unverified' in trading
 m=json.loads(z.read('10_metadata/manifest.json'))
 assert m['pointInTimeVerified'] is False
 assert m['allRowsComplete'] is False
 print(json.dumps({'files':len(files),'rawRows':raw.count('\n')-1,'institutionalRows':trading.count('\n')-1}))
`;
  const tested=spawnSync("python3",["-c",snippet],{input:bytes,encoding:"utf8"});
  assert.equal(tested.status,0,tested.stderr);
  const detail=JSON.parse(tested.stdout);
  assert.equal(detail.rawRows,1);assert.equal(detail.institutionalRows,2);
  const manifest=await (await researchPackRoute(new Request(host+"/api/research-pack/manifest",{headers:{cookie}}),f.env)).json();
  assert.equal(manifest.verifiedComplete,false);
  assert.ok(manifest.missingDatasets.length===0); // priority one generic data only
 }finally{globalThis.fetch=prev}
});
test("research cloud downloader website uses private session, priority stages and states without touching original market site",()=>{
 const html=readFileSync(new URL("../public/research-pack-download.html",import.meta.url),"utf8");
 const original=readFileSync(new URL("../public/stock-futures-download.html",import.meta.url),"utf8");
 for(const x of ["token","codes","priority","startBtn","refresh","manifest","download","errors"])assert.match(html,new RegExp('id="'+x+'"'));
 assert.match(html,/api\/research-pack/);assert.match(original,/research-pack-download.html/);
 const script=html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(script);assert.doesNotThrow(()=>new Function(script));
});
