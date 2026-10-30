import test from "node:test";
import assert from "node:assert/strict";
import {parseCsvRecord,priceRowsFromText} from "../src/market-chip.mjs";
import {joinDailyChipRows,StockFuturesBatch,StockFuturesData} from "../src/stock-futures-download.mjs";
function storage(init=[]){
 const map=new Map(init);
 return {map,async get(k){return map.get(k)},async put(k,v){map.set(k,v)},async delete(k){map.delete(k)},
 async deleteAll(){map.clear()},async setAlarm(t){map.set("$alarm",t)},async deleteAlarm(){map.delete("$alarm")}}
}
async function gzip(s){return new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())}
function price(code,year){
 return year+"-01-02,"+code+",\"STOCK, NAME\",twse,100,105,99,103,100000,11000000,800,3\n"+
        year+"-01-03,"+code+",\"STOCK, NAME\",twse,103,106,101,104,120000,12000000,900,1\n"+
        year+"-01-04,"+code+",\"STOCK, NAME\",twse,104,106,102,105,130000,13000000,1000,1\n";
}
test("quote-safe source price CSV parser",()=>{
 const a=priceRowsFromText(price("2330",2025),"2330","2025");
 assert.equal(a.records.length,3);
 assert.equal(a.records[0].values[2],"STOCK, NAME");
 assert.throws(()=>priceRowsFromText("2025-02-30,2330,X,twse,1,2,1,2,0,0,0,0\n","2330","2025"),/日期格式異常/);
 assert.throws(()=>priceRowsFromText(price("2330",2025),"2317","2025"),/代號/);
});
test("exact-date chips; missing not zero, dealer not double counted",()=>{
 const p=priceRowsFromText(price("2330",2025),"2330","2025");
 const inst=[
 {date:"2025-01-02",stock_id:"2330",name:"Foreign_Investor",buy:3000,sell:1500},
 {date:"2025-01-02",stock_id:"2330",name:"Dealer",buy:500,sell:100},
 {date:"2025-01-02",stock_id:"2330",name:"Dealer_self",buy:200,sell:100},
 {date:"2025-01-02",stock_id:"2330",name:"Dealer_Hedging",buy:100,sell:50}
 ];
 const margin=[{date:"2025-01-02",stock_id:"2330",MarginPurchaseTodayBalance:1000,
 MarginPurchaseYesterdayBalance:900,ShortSaleTodayBalance:100,ShortSaleYesterdayBalance:120}];
 const j=joinDailyChipRows(p,inst,margin,"2330","2025-01-01","2025-12-31");
 const v=j.csvByYear["2025"].trim().split("\n").map(parseCsvRecord);
 assert.equal(v.length,3);assert.equal(v[0][15],"1500");
 assert.equal(v[0][21],"150");assert.equal(v[0][29],"1000");
 assert.equal(v[0][31],"100");assert.equal(v[1][12],"0");
 assert.equal(v[1][25],"0");assert.equal(v[1].at(-1),"0");
 assert.equal(v[1][13],"");assert.equal(j.coverage.both,1);
});
test("cloud-only FinMind chip backfill preserves original price and merges gzip",async()=>{
 const codes=["2330","2317"],shards=new Map(),originals=new Map(),requested=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  const u=new URL(url),dataset=u.searchParams.get("dataset"),code=u.searchParams.get("data_id");
  requested.push(dataset);
  if(dataset==="TaiwanStockInstitutionalInvestorsBuySell")
   return Response.json({status:200,data:[{date:"2025-01-02",stock_id:code,name:"Foreign_Investor",buy:3000,sell:2000}]});
  if(dataset==="TaiwanStockMarginPurchaseShortSale")
   return Response.json({status:200,data:[{date:"2025-01-02",stock_id:code,
     MarginPurchaseTodayBalance:900,MarginPurchaseYesterdayBalance:800,
     ShortSaleTodayBalance:40,ShortSaleYesterdayBalance:50}]});
  throw Error("Unexpected dataset: must not re-download TaiwanStockPrice")
 };
 try{
  for(const code of codes){
   const db=storage(),shard=new StockFuturesData({storage:db},{});
   const bytes=await gzip(price(code,2025));
   const put=await shard.fetch(new Request("https://test/put?date=2025-01-01",{method:"POST",body:bytes}));
   assert.equal(put.status,200);
   originals.set(code,new Uint8Array(db.map.get("day:2025-01-01:0")));
   shards.set("job:"+code,{db,fetch:r=>shard.fetch(typeof r==="string"?new Request(r):r)});
  }
  const s={mode:"market-daily",phase:"done",start:"2025-01-01",end:"2025-12-31",
   total:2,processed:2,catalog:codes.map(code=>({code})),shardKey:"job",rows:6,
   expiresAt:Date.now()+86400000,errors:[],updatedAt:Date.now()};
  const db=storage([["state",s],["token","test-token"]]);
  const env={STOCK_FUTURES_DATA:{idFromName:n=>n,get:n=>shards.get(n)}};
  const batch=new StockFuturesBatch({storage:db,blockConcurrencyWhile:fn=>fn()},env);
  const start=await batch.fetch(new Request("https://test/chip-start",{method:"POST"}));
  assert.equal(start.status,202);
  for(let n=0;n<10;n++){
   await batch.alarm();
   if((await db.get("merge-chip"))?.phase==="done")break;
  }
  const chip=await db.get("market-chip"),combined=await db.get("merge-chip");
  assert.equal(chip.phase,"done","CHIP_PROGRESS="+JSON.stringify(chip));assert.equal(chip.processed,2);
  assert.equal(combined.phase,"done");assert.equal(combined.processed,2);
  assert.ok(requested.every(x=>x!=="TaiwanStockPrice"));
  for(const code of codes){
   const stock=shards.get("job:"+code).db;
   assert.deepEqual(stock.map.get("day:2025-01-01:0"),originals.get(code));
   assert.ok(stock.map.has("chip:meta:2025-01-01"));
  }
  const r=await batch.fetch(new Request("https://test/chip-merge-download"));
  assert.equal(r.status,200);
  const csv=await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  assert.equal((csv.match(/date,stock_id,stock_name,market/g)||[]).length,1);
  const lines=csv.trim().split("\n"),columns=lines.shift().split(",");
  assert.equal(lines.length,6);
  const rows=lines.map(line=>Object.fromEntries(parseCsvRecord(line).map((x,i)=>[columns[i],x])));
  assert.equal(rows.find(x=>x.stock_id==="2330"&&x.date==="2025-01-02").margin_balance_lots,"900");
  assert.equal(rows.find(x=>x.stock_id==="2317"&&x.date==="2025-01-02").institutional_foreign_net_shares,"1000");
  const empty=rows.find(x=>x.stock_id==="2317"&&x.date==="2025-01-04");
  assert.equal(empty.margin_available,"0");
  assert.equal(empty.institutional_foreign_net_shares,"");
  const plain=await batch.fetch(new Request("https://test/export?year=2025&part=1"));
  assert.equal(plain.status,200);
 }finally{globalThis.fetch=oldFetch}
});
