import {priceRowsFromText,chipSnapshot} from './market-chip.mjs';
import {streamZip64,stockArchiveManifest} from './stock-archive.mjs';
// Isolated all-STOCK-futures minute-bar service. No TX code or storage is shared.
const DAY=86400000, COOKIE="__Host-sf5y", STOCK_COOKIE="__Host-underlying1m", HDR="date,minute,session,futures_id,underlying_stock,contract_size,contract_date,open,high,low,close,volume\n";
const STOCK_HDR="date,minute,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_raw\n";
const DAILY_HDR="date,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_shares,trading_money_twd,trading_turnover,spread\n";
const DAILY_COOKIE="__Host-underlying-day", CHIP_COOKIE="__Host-underlying-chip", MARKET_COOKIE="__Host-tw-market-daily", RESEARCH_COOKIE="__Host-stock-research";
const ALL_STOCK_COOKIE="__Host-allstock-1min",ALL_DAY_COOKIE="__Host-allstock-day",
 ALL_CHIP_COOKIE="__Host-allstock-chip",ALL_RESEARCH_COOKIE="__Host-allstock-research";
const MARKET_HDR="date,stock_id,stock_name,market,open,high,low,close,volume_shares,trading_money_twd,trading_turnover,spread\n";
const ALL_MARKET_TTL=120*DAY;
const MARKET_EXPORT_PART_SIZE=250; // Legacy per-year export option.
const MERGE_STOCKS_PER_ALARM=2;  // Keep CPU/storage I/O modest; alarm runs even if phone is closed.
const MERGE_STORAGE_CHUNK=384*1024; // Strictly below Durable Object's 2 MB/value limit.
const MERGE_SHARE_MAX_AGE=7*DAY;
const MERGE_NAME="FinMind_All_TWSE_TPEX_Daily_";
const CHIP_MERGE_KEY="merge-chip",CHIP_JOB_KEY="market-chip";
const CHIP_RATE_SPACING_MS=1000; // <=3,600 FinMind calls/hour, conservative vs account limits.
const validJobId=s=>/^[a-f0-9]{64}$/.test(String(s||""));
const validShareKey=s=>/^[a-f0-9]{64}$/.test(String(s||""));


const CHIP_HDR="institutional_available,institutional_foreign_buy_shares,institutional_foreign_sell_shares,institutional_foreign_net_shares,institutional_foreign_dealer_net_shares,institutional_trust_buy_shares,institutional_trust_sell_shares,institutional_trust_net_shares,institutional_dealer_buy_shares,institutional_dealer_sell_shares,institutional_dealer_net_shares,institutional_dealer_self_net_shares,institutional_dealer_hedge_net_shares,margin_available,margin_buy_lots,margin_sell_lots,margin_cash_repayment_lots,margin_balance_lots,margin_previous_balance_lots,margin_change_lots,short_buy_lots,short_sell_lots,short_cash_repayment_lots,short_balance_lots,short_previous_balance_lots,short_change_lots,chip_signal_use_next_session\n";
const CHIP_COLUMNS=MARKET_HDR.trimEnd()+","+CHIP_HDR;
const RESEARCH_HDR="foreign_holding_available,foreign_holding_shares,foreign_holding_ratio_pct,foreign_remaining_ratio_pct,foreign_shares_issued,lending_trade_available,lending_transaction_count,lending_volume_raw,lending_volume_unit_unverified,lending_weighted_fee_pct,futures_daily_observed,futures_observed_symbols,futures_observed_contract_months,futures_selected_observed_symbol,futures_nearest_contract_month,futures_nearest_day_volume_contracts,futures_nearest_day_open_interest_contracts,futures_observation_not_listing_proof,research_chip_use_next_session\n";
// Sponsor: 6,000 req/hour; leave headroom for other pages sharing the same token.
const STOCK_MAX_PARALLEL=5, STOCK_MINUTE_BATCH=12, STOCK_MINUTE_CONCURRENCY=5;
const STOCK_REQUEST_SPACING_MS=700; // this job max 5,142 req/hour
export async function mapBounded(items,work,concurrency=5){
 if(!Array.isArray(items)||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>16)throw Error("並行下載設定錯誤");
 const result=new Array(items.length),errors=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(items.length,concurrency)},async()=>{
  for(;;){
   const at=cursor++;if(at>=items.length)return;
   try{result[at]=await work(items[at],at)}catch(e){errors.push({at,e})}
  }
 }));
 if(errors.length){errors.sort((a,b)=>a.at-b.at);throw errors[0].e}
 return result
}
function updateApiTelemetry(s){
 const t=Date.now();if(!Array.isArray(s.apiSamples))s.apiSamples=[];
 s.apiSamples.push([t,s.queries||0,s.processed||0]);
 s.apiSamples=s.apiSamples.filter(x=>x[0]>=t-600000).slice(-200);
 const first=s.apiSamples[0],elapsed=t-first[0];
 if(elapsed>20000){
  s.apiRatePerHour=Math.round(Math.max(0,(s.queries||0)-first[1])*3600000/elapsed);
  const completed=Math.max(0,(s.processed||0)-first[2]);
  s.etaHours=completed>0&&s.total>s.processed?
   Number(((s.total-s.processed)*elapsed/completed/3600000).toFixed(2)):null
 }
}
const STOCK_SCAN_CAP=3000;
const respond=(v,status=200,h={})=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}});
const dateOk=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||"")&&new Date(s).toISOString().slice(0,10)===s;
const next=s=>new Date(Date.parse(s)+DAY).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const dayOf=s=>new Date(s+"T12:00:00Z").getUTCDay();
const cookie=(r,name=COOKIE)=>(r.headers.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(name+"="))?.slice(name.length+1)||"";
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
const zip=async str=>new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const column=x=>{let t=String(x??"");if(/^[=+@]/.test(t))t="'"+t;return /[,\"\r\n]/.test(t)?'"'+t.replaceAll('"','""')+'"':t};
const decode=x=>String(x||"").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const SOURCE="https://www.taifex.com.tw/cht/2/stockLists";
export function parseStockFutureUniverse(html){
 const a=[],seen=new Set();
 for(const t of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
  const headers=[...t[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>decode(m[1]).replace(/\s+/g,""));
  const idx={symbol:headers.findIndex(s=>s.includes("商品代碼")),stock:headers.findIndex(s=>s.includes("證券代號")),short:headers.findIndex(s=>s.includes("簡稱")),future:headers.findIndex(s=>s.includes("是否為股票期貨")),listed:headers.findIndex(s=>s.includes("上市普通股")),otc:headers.findIndex(s=>s.includes("上櫃普通股")),units:headers.findIndex(s=>s.includes("標準型")),night:headers.findIndex(s=>s.includes("盤後交易"))};
  if(Object.values(idx).some(i=>i<0))continue;
  for(const tr of t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
   const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>decode(m[1]));
   if(cells.length<=Math.max(...Object.values(idx)))continue;
   const yes=x=>/[●◎]/.test(x)||/是股票期貨標的|是上市普通股標的證券|是上櫃普通股標的證券/.test(x);
   if(!yes(cells[idx.future])||!(yes(cells[idx.listed])||yes(cells[idx.otc])))continue;
   const prefix=cells[idx.symbol],stock=cells[idx.stock],units=Number(cells[idx.units].replace(/,/g,""));
   if(!/^[A-Z]{2}$/.test(prefix)||!(/^\d{4}$/.test(stock))||![100,2000].includes(units))continue;
   const code=prefix+"F";
   if(seen.has(code))continue;seen.add(code);
   a.push({code,stock,name:cells[idx.short],units,night:/17:25/.test(cells[idx.night])});
  }
 }
 // A partial official HTML response should fail closed, never appear as a full market.
 if(a.length<100)throw Error("期交所名單不完整，僅辨識到 "+a.length+" 個股期貨代碼");
 return a.sort((x,y)=>x.code.localeCompare(y.code));
}
// One underlying stock = one download instrument. When a 100-share contract exists,
// it replaces the 2,000-share contract; never merge volumes between sizes.
export function preferMiniStockFutures(list){
 const stocks=new Map();
 for(const c of list){
  const previous=stocks.get(c.stock);
  if(!previous||c.units<previous.units||(c.units===previous.units&&c.code<previous.code))stocks.set(c.stock,c)
 }
 return [...stocks.values()].sort((a,b)=>a.stock.localeCompare(b.stock,"en"));
}
// The selected universe comes from TAIFEX, but every row below is CASH EQUITY.
// Sponsor TaiwanStockKBar returns original OHLCV minute bars; no tick aggregation.
export function filterUnderlyingStockBars(list,stock,date,meta){
 if(!Array.isArray(list))throw Error("FinMind 現股分K 格式錯誤");
 const seen=new Map(),items=[];
 const audit={rows:0,day:0,night:0,rawVolume:0,rejectedProduct:0,rejectedContract:0,rejectedInvalid:0,rejectedFarMonth:0,duplicates:0};
 for(const r of list){
  if(String(r?.stock_id??"").trim()!==stock){audit.rejectedProduct++;continue}
  const d=String(r.date||"").slice(0,10),minute=String(r.minute||"").trim();
  const match=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(minute);
  if(d!==date||!match){audit.rejectedInvalid++;continue}
  const hh=+match[1],mm=+match[2],ss=+(match[3]||"0"),time=hh*60+mm;
  // Keep official regular, 13:33 delayed close and 14:30 fixed-price bars.
  if(hh>23||mm>59||ss>59||time<540||time>870){audit.rejectedInvalid++;continue}
  const prices=[r.open,r.high,r.low,r.close].map(Number),v=Number(r.volume);
  if(!Number.isFinite(v)||v<0||!prices.every(n=>Number.isFinite(n)&&n>0)||
     prices[1]<Math.max(prices[0],prices[3])||prices[2]>Math.min(prices[0],prices[3])||
     prices[1]<prices[2]){audit.rejectedInvalid++;continue}
  const stamp=match[1]+":"+match[2]+":00",signature=prices.join(",")+"|"+v;
  if(seen.has(stamp)){
   if(seen.get(stamp)!==signature)throw Error("現股同分鐘 OHLCV 矛盾："+stock+" "+date+" "+stamp);
   audit.duplicates++;continue;
  }
  seen.set(stamp,signature);
  audit.rows++;audit.day++;audit.rawVolume+=v;
  items.push({minute:stamp,line:[d,stamp,stock,meta.name,meta.futureCode,...prices,v].map(column).join(",")+"\n"});
 }
 items.sort((a,b)=>a.minute.localeCompare(b.minute));
 return {csv:items.map(x=>x.line).join(""),audit};
}
export function filterStockFutureBars(list,symbol,date,meta){
 if(!Array.isArray(list))throw Error("FinMind 格式錯誤：未取得 K 棒陣列");
 const seen=new Map(),candidates=[],nearest=new Map(),items=[];
 const audit={rows:0,day:0,night:0,rawVolume:0,rejectedProduct:0,rejectedContract:0,rejectedInvalid:0,rejectedFarMonth:0,duplicates:0};
 const monthFloor=date.slice(0,4)+date.slice(5,7);
 for(const r of list){
  if(String(r?.futures_id||"").trim()!==symbol){audit.rejectedProduct++;continue}
  const contract=String(r.contract_date||"").trim(),minute=String(r.minute||"").trim(),d=String(r.date||"").slice(0,10);
  // Exclude calendar spreads, malformed months, and expired contract months.
  if(!/^\d{6}$/.test(contract)||+contract.slice(4)<1||+contract.slice(4)>12||contract<monthFloor){audit.rejectedContract++;continue}
  const m=/^(\d{2}):(\d{2}):(\d{2})$/.exec(minute);
  if(!m||d!==date||+m[1]>23||+m[2]>59||+m[3]>59){audit.rejectedInvalid++;continue}
  const clock=+m[1]*60+(+m[2]),day=clock>=525&&clock<=825,night=clock>=1045||clock<=300;
  if(!day&&!night||night&&!meta.night){audit.rejectedInvalid++;continue}
  const v=Number(r.volume),prices=[r.open,r.high,r.low,r.close].map(Number);
  if(!Number.isSafeInteger(v)||v<0||!prices.every(z=>Number.isFinite(z)&&z>0)||prices[1]<Math.max(prices[0],prices[3])||prices[2]>Math.min(prices[0],prices[3])||prices[1]<prices[2]){audit.rejectedInvalid++;continue}
  const key=contract+"|"+minute,signature=prices.join(",")+","+v;
  if(seen.has(key)){if(seen.get(key)!==signature)throw Error("同分鐘、同月份期貨 OHLC/成交量相互矛盾");audit.duplicates++;continue}
  seen.set(key,signature);
  // The calendar day has three distinct sessions: previous-night 00:00–05:00,
  // daytime, and next-night 17:25–23:59. Expiration can roll between sessions.
  const sessionKey=day?"day":clock<=300?"nightEarly":"nightLate";
  if(!nearest.has(sessionKey)||contract<nearest.get(sessionKey))nearest.set(sessionKey,contract);
  candidates.push({minute,contract,sessionKey,day,prices,v,d});
 }
 for(const r of candidates){
  // Strictly keep the nearest available expiry for this session.
  // Never substitute a far-month quote for a missing minute of near month.
  if(r.contract!==nearest.get(r.sessionKey)){audit.rejectedFarMonth++;continue}
  audit.rows++;audit.rawVolume+=r.v;
  if(r.day)audit.day++;else audit.night++;
  items.push({key:r.minute+"|"+r.contract,line:[r.d,r.minute,r.day?"day":"night",symbol,meta.stock,meta.units,r.contract,...r.prices,r.v].map(column).join(",")+"\n"});
 }
 items.sort((a,b)=>a.key.localeCompare(b.key));
 return {csv:items.map(x=>x.line).join(""),audit};
}
async function fetchFinMind(token,params){
 const endpoint="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams(params);
 const r=await fetch(endpoint,{headers:{authorization:"Bearer "+token,accept:"application/json"},signal:AbortSignal.timeout(35000)});
 const j=await r.json().catch(()=>null);
 if(!r.ok||Number(j?.status)!==200||!Array.isArray(j?.data)){
  const status=Number(j?.status)||r.status,err=new Error("FinMind "+status+"："+String(j?.msg||"API 拒絕查詢").slice(0,110));
  err.code=/token|invalid|forbidden|sponsor|權限|會員|無效/i.test(String(j?.msg||""))?403:status;
  throw err
 }
 return j.data;
}
// One current TWSE/TPEX stock (4-digit ordinary equities) per code. Include delisted
// codes after 2018 to reduce survivorship bias. Preserve only latest type per code.
export function parseMarketStockCatalog(info,delisted){
 if(!Array.isArray(info)||!Array.isArray(delisted))throw Error("FinMind 市場股票名單格式錯誤");
 const latest=new Map();
 for(const row of info){
  const code=String(row.stock_id||"").trim(),date=String(row.date||""),type=String(row.type||"");
  if(!/^[1-9][0-9]{3}$/.test(code)||!dateOk(date))continue;
  const prior=latest.get(code);
  if(!prior||date>prior.date||date===prior.date&&type!== "emerging"&&prior.type==="emerging")
   latest.set(code,{code,date,type,name:String(row.stock_name||code).trim(),industry:String(row.industry_category||"").trim()});
 }
 const found=new Map();
 for(const item of latest.values()){
  if(!["twse","tpex"].includes(item.type)||/ETF|ETN|權證|受益|指數/i.test(item.industry))continue;
  found.set(item.code,{code:item.code,stock:item.code,name:item.name,market:item.type,futureCode:item.type,units:0,night:false});
 }
 let deleted=0;
 for(const row of delisted){
  const code=String(row.stock_id||"").trim(),date=String(row.date||"");
  if(!/^[1-9][0-9]{3}$/.test(code)||!dateOk(date)||date<"2018-01-01"||found.has(code))continue;
  found.set(code,{code,stock:code,name:String(row.stock_name||code).trim(),market:"delisted",futureCode:"delisted",units:0,night:false});
  deleted++;
 }
 if(found.size<1000)throw Error("全市場名單不足 "+found.size+" 檔，為避免漏抓已停止");
 return [...found.values()].sort((a,b)=>a.code.localeCompare(b.code));
}
async function fetchMarketStockCatalog(token,includeDelisted=true){
 // When user selects only listed/OTC, do not query the heavier historical
 // delisting dataset at all. This also keeps the source request count down.
 const info=await fetchFinMind(token,{dataset:"TaiwanStockInfo"});
 if(!includeDelisted)return parseMarketStockCatalog(info,[]);
 const delisted=await fetchFinMind(token,{dataset:"TaiwanStockDelisting",start_date:"2018-01-01",end_date:today()});
 return parseMarketStockCatalog(info,delisted);
}
export async function stockFuturesRoute(request,env,mode="futures"){
 const all=mode.startsWith("all-"),market=mode==="market-daily",
  research=mode==="daily-research"||mode==="all-daily-research",
  chip=research||mode==="daily-chip"||mode==="all-daily-chip",
  daily=chip||mode==="daily"||mode==="all-daily"||market,
  isStock=mode==="stocks"||mode==="all-stocks",isCash=isStock||daily,
  root=all?(mode==="all-stocks"?"/api/all-stock-kbar":mode==="all-daily-research"?"/api/all-stock-daily-research":mode==="all-daily-chip"?"/api/all-stock-daily-chip":"/api/all-stock-daily"):
   market?"/api/market-daily":research?"/api/stock-daily-research":chip?"/api/stock-daily-chip":daily?"/api/stock-daily":isStock?"/api/stock-kbar":"/api/stock-futures",
  cookieName=all?(mode==="all-stocks"?ALL_STOCK_COOKIE:mode==="all-daily-research"?ALL_RESEARCH_COOKIE:mode==="all-daily-chip"?ALL_CHIP_COOKIE:ALL_DAY_COOKIE):
   market?MARKET_COOKIE:research?RESEARCH_COOKIE:chip?CHIP_COOKIE:daily?DAILY_COOKIE:isStock?STOCK_COOKIE:COOKIE;
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!env.STOCK_FUTURES_BATCH||!env.STOCK_FUTURES_DATA)return respond({ok:false,error:"個股期貨雲端背景服務尚未部署"},503);
 if(!["GET","POST"].includes(method))return respond({ok:false,error:"不支援此方法"},405);
 if(method==="POST"&&request.headers.get("origin")&&request.headers.get("origin")!==url.origin)return respond({ok:false,error:"來源不符"},403);
 const id=cookie(request,cookieName),known=validJobId(id);
 // Independent Worker health check, no Durable Object or FinMind calls.
 if(market&&path===root+"/ping"&&method==="GET")
  return respond({ok:true,service:"market-daily",version:"r55-status-guard",worker:true,
    durableBinding:!!env.STOCK_FUTURES_BATCH,dataBinding:!!env.STOCK_FUTURES_DATA,hasSession:known});
 // Explicit, revokeable, read-only capability URL. No FinMind credential
 // or browser cookie is included in the shared link.
 if(market&&(path===root+"/shared"||path===root+"/chip-shared")&&method==="GET"){
  const chipShare=path===root+"/chip-shared";
  const job=url.searchParams.get("job")||"",key=url.searchParams.get("key")||"";
  if(!validJobId(job)||!validShareKey(key))return respond({ok:false,error:"唯讀連結參數錯誤"},403);
  const stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(job));
  const qs=new URLSearchParams({format:url.searchParams.get("format")||"",
    code:url.searchParams.get("code")||"",year:url.searchParams.get("year")||"",
    part:url.searchParams.get("part")||""});
  return stub.fetch(new Request("https://private/"+(chipShare?"chip-shared":"merge-shared")+"?"+qs,{headers:{authorization:"Bearer "+key}}));
 }
 if(market&&path===root+"/token"&&method==="POST"){
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(token.length<5||token.length>4096||/[\r\n]/.test(token))
   return respond({ok:false,error:"請貼上 FinMind 官方會員中心提供的完整新 Token"},401);
  // Preflight before overwriting any stored credential or restarting a job.
  // A minimal known stock/day is enough to verify that the bearer is accepted.
  try{
   await fetchFinMind(token,{dataset:"TaiwanStockPrice",data_id:"2330",start_date:"2024-01-02",end_date:"2024-01-02"});
  }catch(e){
   const illegal=/token.*(illegal|invalid|expired)|token.*無效/i.test(String(e.message||""));
   return respond({ok:false,code:illegal?"TOKEN_INVALID":"FINMIND_TEST_FAILED",
    error:illegal?"FinMind 拒絕此 Token。請至官方會員中心重新取得 Token，再貼上驗證。":("FinMind Token 驗證未通過："+String(e.message||e))},illegal?401:502);
  }
  if(!known)return respond({ok:true,verified:true,jobFound:false,message:"Token 已通過 FinMind 讀取驗證；可以開始下載"});
  const stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(id));
  const result=await stub.fetch(new Request("https://private/replace-token",{method:"POST",headers:{authorization:"Bearer "+token}}));
  return new Response(result.body,{status:result.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
 }
 if(path===root+"/catalog"&&method==="GET"){
  try{
   if(all){
    const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
    if(token.length<5||token.length>4096)return respond({ok:false,error:"全市場名單需要 FinMind S Token"},401);
    const items=(await fetchMarketStockCatalog(token,false)).map(c=>({...c,futureCode:"",futureCodes:[]}));
    return respond({ok:true,source:"FinMind TaiwanStockInfo 上市上櫃普通股",dataset:daily?"TaiwanStockPrice":"TaiwanStockKBar",
      count:items.length,rawCount:items.length,policy:"current-twse-tpex-stocks",catalog:items});
   }
   if(market){
    const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
    // Catalog preview intentionally fetches the smaller current universe only.
    // Complete delisted inventory is resolved by the durable background job.
    const info=await fetchFinMind(token,{dataset:"TaiwanStockInfo"});
    const catalog=parseMarketStockCatalog(info,[]);
    return respond({ok:true,source:"FinMind TaiwanStockInfo（僅預覽當前上市櫃）",dataset:"TaiwanStockPrice",count:catalog.length,
      listed:catalog.filter(x=>x.market==="twse").length,otc:catalog.filter(x=>x.market==="tpex").length,
      delisted:null,asOf:new Date().toISOString()});
   }
   const r=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error("TAIFEX HTTP "+r.status);
   const futuresList=parseStockFutureUniverse(await r.text());
   const selected=preferMiniStockFutures(futuresList);
   const catalog=isCash?selected.map(c=>({code:c.stock,stock:c.stock,name:c.name,futureCode:c.code,units:c.units,night:false})):selected;
   return respond({ok:true,source:"TAIFEX 股票期貨/選擇權交易標的",asOf:new Date().toISOString(),count:catalog.length,rawCount:futuresList.length,miniCount:selected.filter(x=>x.units===100).length,policy:isCash?"unique-underlying-cash-stock":"one-stock-mini-first-nearest-expiry",dataset:daily?"TaiwanStockPrice":isStock?"TaiwanStockKBar":"TaiwanFuturesKBar",catalog});
  }catch(e){return respond({ok:false,error:(market?"FinMind 全市場清單讀取失敗：":"取得期交所個股期貨商品清單失敗：")+e.message},502)}
 }
 if(path===root+"/start"&&method==="POST"){
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(token.length<5||token.length>4096||/[\r\n]/.test(token))return respond({ok:false,error:"請使用原本個股分析的 FinMind Sponsor Token"},401);
  const body=await request.text();if(body.length>(all?100000:14000))return respond({ok:false,error:"參數長度過大"},400);
  let args;try{args=JSON.parse(body)}catch{return respond({ok:false,error:"設定格式錯誤"},400)}
  const earliest=daily?"2000-01-01":"2021-01-01";
  if(!dateOk(args.start)||!dateOk(args.end)||args.start<earliest||args.end>today()||args.start>args.end)
   return respond({ok:false,error:"日期必須在 "+earliest+" 至今天"+(daily?"（日K）":"（1分K及期貨）")},400);
  const resId=known?id:randomId(),stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(resId));
  const data=await stub.fetch(new Request("https://private/start",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({start:args.start,end:args.end,codes:args.codes||[],markets:args.markets||[],reset:args.reset===true,mode:all?mode:market?"market-daily":research?"daily-research":chip?"daily-chip":daily?"daily":isStock?"stocks":"futures"})}));
  return new Response(data.body,{status:data.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":cookieName+"="+resId+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age="+(all?10368000:2592000)}});
 }
 if(!known)return respond({ok:false,error:"沒有這個瀏覽器的下載工作；請先按開始"},401);
 const stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(id));
 if(path===root+"/status"&&method==="GET"){
  try{
   const response=await stub.fetch("https://private/status");
   if(response.status>=500)
    return respond({ok:false,code:"DURABLE_STATUS_HTTP_"+response.status,
      error:"背景進度服務暫時錯誤，但這次查詢不會刪除已下載的日K",
      version:"r55-status-guard"},503);
   return new Response(response.body,{status:response.status,headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":"private, no-store","x-market-daily-version":"r55-status-guard"}});
  }catch(e){
   return respond({ok:false,code:"DURABLE_STATUS_FAILURE",
    error:"雲端任務進度查詢失敗；既有日K未被此操作刪除",
    reason:String(e?.name||"Error"),version:"r55-status-guard"},503);
  }
 }
 if(path===root+"/archive"&&method==="GET"){
  if(market||!["stocks","daily","daily-chip","daily-research","all-stocks","all-daily","all-daily-chip","all-daily-research"].includes(mode))
   return respond({ok:false,error:"目前只支援個股日K、分K和日頻研究整包下載"},400);
  const include=url.searchParams.get("include")||"none";
  const archiveYear=url.searchParams.get("year")||"";
  const partText=url.searchParams.get("part")||"";
  const safePartSize=75;
  if(archiveYear&&!/^20\d{2}$/.test(archiveYear)||partText&&!/^[1-9]\d{0,3}$/.test(partText)||partText&&!archiveYear)
   return respond({ok:false,error:"ZIP 分年／分包參數錯誤"},400);
  if(!["none","chip","research"].includes(include)||!isStock&&include!=="none")
   return respond({ok:false,error:"備份參數不合法"},400);
  const primary=await stub.fetch("https://private/status?audit=1");
  if(!primary.ok)return respond({ok:false,error:"無法讀取下載進度"},503);
  const source=await primary.json();
  if(!source.ok||source.mode!==mode||source.phase!=="done"||source.processed!==source.total||!source.codeCount)
   return respond({ok:false,error:"請先完成主要下載任務，再一鍵下載全部資料"},409);
  let side=null,sideStub=null;
  if(include!=="none"){
   const sideId=cookie(request,include==="research"?(all?ALL_RESEARCH_COOKIE:RESEARCH_COOKIE):(all?ALL_CHIP_COOKIE:CHIP_COOKIE));
   if(!validJobId(sideId))return respond({ok:false,error:"沒有日頻配套資料工作，請先完成配套下載"},409);
   sideStub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(sideId));
   const resp=await sideStub.fetch("https://private/status");
   if(!resp.ok)return respond({ok:false,error:"讀取配套日頻進度失敗"},503);
   side=await resp.json();
   const a=(source.codes||[]).map(x=>x.code).sort().join(","),
    b=(side.codes||[]).map(x=>x.code).sort().join(",");
   if(!side.ok||side.mode!==(all?(include==="research"?"all-daily-research":"all-daily-chip"):(include==="research"?"daily-research":"daily-chip"))||side.phase!=="done"||
     side.processed!==side.total||side.start!==source.start||side.end!==source.end||
     side.codeCount!==source.codeCount||!a||a!==b)
    return respond({ok:false,error:"日頻配套與分K股票／日期不一致，或下載尚未完成，不能混合打包"},409);
  }
  if(archiveYear&&(archiveYear<source.start.slice(0,4)||archiveYear>source.end.slice(0,4)))
   return respond({ok:false,error:"ZIP 年份不在本次雲端資料範圍內"},400);
  const ordered=[...(source.codes||[])].map(c=>c.code).sort();
  const part=partText?Number(partText):0;
  const partCount=Math.ceil(ordered.length/safePartSize);
  if(part>partCount)return respond({ok:false,error:"ZIP 分包序號超出股票範圍"},400);
  const subset=part?ordered.slice((part-1)*safePartSize,part*safePartSize):ordered;
  if(!subset.length)return respond({ok:false,error:"沒有可打包的股票"},409);
  const keySet=new Set(subset);
  const recordCounts=source.recordRowsByStockYear||null,hasRecordCounts=!!recordCounts;
  let expectedRecords=null;
  if(archiveYear&&hasRecordCounts){
   const missing=subset.some(code=>!Object.hasOwn(recordCounts,code+"-"+archiveYear));
   if(!missing)expectedRecords=subset.reduce((sum,code)=>sum+recordCounts[code+"-"+archiveYear],0)
  }
  const manifest={...stockArchiveManifest({minute:source,companion:side,mode,startedAt:new Date().toISOString()}),
   archiveYear:archiveYear||"all",archivePart:part||"all",archivePartCount:partCount,stockCodes:subset,
   expectedPrimaryRecords:expectedRecords,sourceReportedTotalRecords:source.rows,
   verification:"Archive contains gzip data from existing cloud shards. Validate ZIP directory, gzip CRC and extracted row count before backtesting. Unverified source records are not certified complete.",
   notes:["A successful background job does not prove that the exported ZIP reached the client intact.",
    "If this file lacks the ZIP central directory (EOCD), the transfer was interrupted and must not be used for backtesting.",
    "If expectedPrimaryRecords is null, the legacy job predates per-stock/year record auditing; retain the original data."]};
  const entries=[{name:"manifest.json",open:async()=>new Response(JSON.stringify(manifest,null,2)+"\n")}];
  const startYear=archiveYear?Number(archiveYear):Number(source.start.slice(0,4)),
   endYear=archiveYear?Number(archiveYear):Number(source.end.slice(0,4));
  const exportCodes=part?subset.join(","):"";
  for(let y=startYear;y<=endYear;y++){
   const year=String(y),owner=stub;
   entries.push({name:"01_price/"+(isStock?"minute_1min":"daily")+"_"+year+".csv.gz",
    open:()=>owner.fetch("https://private/export?"+new URLSearchParams({year,codes:exportCodes}))})
  }
  if(sideStub)for(let y=startYear;y<=endYear;y++){
   const year=String(y),owner=sideStub;
   entries.push({name:"02_daily_research/"+(include==="research"?"research_full":"institutional_margin")+"_"+year+".csv.gz",
    open:()=>owner.fetch("https://private/export?"+new URLSearchParams({year,codes:exportCodes}))})
  }
  const file=(all?"FinMind_All_TWSE_TPEX_":"FinMind_FuturesEligibleStocks_")+"ALL_"+
   (isStock?"1min":mode.replace("daily-","daily_"))+"_"+
   (archiveYear||source.start.replaceAll("-","")+"_"+source.end.replaceAll("-",""))+
   (part?"_part"+String(part).padStart(2,"0")+"of"+partCount:"")+".zip";
  return new Response(streamZip64(entries),{headers:{
   "content-type":"application/zip","content-disposition":'attachment; filename="'+file+'"',
   "cache-control":"private, no-store","x-content-type-options":"nosniff"
  }})
 }
 if(market&&path===root+"/chip-start"&&method==="POST"){
  const bearer=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(bearer&&(bearer.length<5||bearer.length>4096||/[\r\n]/.test(bearer)))
   return respond({ok:false,error:"新 Token 格式錯誤"},401);
  return stub.fetch(new Request("https://private/chip-start",{method:"POST",
   headers:bearer?{authorization:"Bearer "+bearer}:{}}));
 }
 if(market&&["chip-resume","chip-pause"].includes(path.split("/").at(-1))&&method==="POST")
  return stub.fetch(new Request("https://private/"+path.split("/").at(-1),{method:"POST"}));
 if(market&&path===root+"/chip-merge-download"&&method==="GET")
  return stub.fetch("https://private/chip-merge-download");
 if(market&&path===root+"/chip-merge-resume"&&method==="POST")
  return stub.fetch(new Request("https://private/chip-merge-resume",{method:"POST"}));
 if(market&&path===root+"/chip-share"&&method==="POST"){
  const resp=await stub.fetch(new Request("https://private/chip-share",{method:"POST"}));
  const data=await resp.json().catch(()=>({ok:false,error:"籌碼唯讀連結產生失敗"}));
  if(data.ok){
   const u=new URL(root+"/chip-shared",url.origin);
   u.searchParams.set("job",id);u.searchParams.set("key",data.key);
   data.url=u.toString();delete data.key;data.statusUrl=data.url+"&format=status";
  }
  return respond(data,resp.status);
 }
 if(market&&path===root+"/chip-revoke"&&method==="POST")
  return stub.fetch(new Request("https://private/chip-revoke",{method:"POST"}));
 if(market&&path===root+"/merge-start"&&method==="POST")return stub.fetch(new Request("https://private/merge-start",{method:"POST"}));
 if(market&&path===root+"/merge-resume"&&method==="POST")return stub.fetch(new Request("https://private/merge-resume",{method:"POST"}));
 if(market&&path===root+"/merge-download"&&method==="GET")return stub.fetch("https://private/merge-download");
 if(market&&path===root+"/merge-share"&&method==="POST"){
  const resp=await stub.fetch(new Request("https://private/merge-share",{method:"POST"}));
  const data=await resp.json().catch(()=>({ok:false,error:"分享連結產生失敗"}));
  if(data.ok){
   const u=new URL(root+"/shared",url.origin);
   u.searchParams.set("job",id);u.searchParams.set("key",data.key);
   data.url=u.toString();delete data.key;
   data.statusUrl=data.url+"&format=status";
  }
  return respond(data,resp.status);
 }
 if(market&&path===root+"/merge-revoke"&&method==="POST")return stub.fetch(new Request("https://private/merge-revoke",{method:"POST"}));
 if(market&&path===root+"/chip-export"&&method==="GET"){
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"",part=url.searchParams.get("part")||"";
  if(code&&!/^[0-9]{4}$/.test(code)||year&&!/^(20|21)\d{2}$/.test(year)||part&&!/^[1-9]\d{0,3}$/.test(part)||
    !code&&(!year||!part))return respond({ok:false,error:"籌碼資料請選擇股票，或年份與分包"},400);
  return stub.fetch("https://private/export?"+new URLSearchParams({code,year,part,chip:"1"}));
 }
 if(path===root+"/export"&&method==="GET"){
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"";
  const part=url.searchParams.get("part")||"",all=url.searchParams.get("all")==="1";
  if(code&&!(isCash?/^[0-9]{4}$/:/^[A-Z]{2}F$/).test(code)||year&&!(daily?/^(20\d{2}|21\d{2})$/:/^(202[1-9]|20[3-9]\d)$/).test(year)||part&&!/^[1-9]\d{0,3}$/.test(part)||all&&(!market||!part||!!code||!!year))
   return respond({ok:false,error:"下載範圍錯誤"},400);
  if(market&&!code&&(!year||!part)&&!all)return respond({ok:false,error:"全市場匯出請選年份與分包號碼（每包250檔）"},400);
  return stub.fetch("https://private/export?"+new URLSearchParams({code,year,part,all:all?"1":"0"}));
 }
 if(method==="POST"&&["pause","resume","delete"].includes(path.split("/").at(-1)))return stub.fetch(new Request("https://private/"+path.split("/").at(-1),{method:"POST"}));
 return respond({ok:false,error:"不存在的 API"},404);
}
export class StockFuturesData{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 async fetch(request){
  const u=new URL(request.url),p=u.pathname;
  if((p==="/put"||p==="/put-chip")&&request.method==="POST"){
   const chip=p==="/put-chip",pref=chip?"chip:":"";
   const day=u.searchParams.get("date");
   if(!dateOk(day))return respond({ok:false,error:"日期錯誤"},400);
   const bytes=new Uint8Array(await request.arrayBuffer());
   if(bytes.byteLength>8*1024*1024)return respond({ok:false,error:"單日原始資料過大"},413);
   const size=500*1024,parts=Math.ceil(bytes.length/size);
   for(let i=0;i<parts;i++)await this.ctx.storage.put(pref+"day:"+day+":"+i,bytes.slice(i*size,(i+1)*size));
   await this.ctx.storage.put(pref+"meta:"+day,{parts,bytes:bytes.byteLength});
   const duration=Math.max(30,Math.min(Number(u.searchParams.get("ttl"))||30,120));
   const expires=Date.now()+duration*DAY;
   await this.ctx.storage.put("expiresAt",expires);
   await this.ctx.storage.setAlarm(expires);
   return respond({ok:true});
  }
  if(p==="/get-years"||p==="/get-chip-years"){
   const pref=p==="/get-chip-years"?"chip:":"";
   // Daily OHLCV shards are stored only on YYYY-01-01; reading those
   // keys directly avoids ~3,000 redundant day lookups per stock.
   const startYear=Number(u.searchParams.get("startYear")),endYear=Number(u.searchParams.get("endYear"));
   if(!Number.isInteger(startYear)||!Number.isInteger(endYear)||startYear<2000||endYear>2200||startYear>endYear||endYear-startYear>50)
    return respond({ok:false,error:"年份範圍錯誤"},400);
   let year=startYear,idx=0,part=null;
   const st=this.ctx.storage;
   const stream=new ReadableStream({async pull(c){
    try{
     for(;;){
      if(year>endYear){c.close();return}
      const key=year+"-01-01";
      if(part===null){
       part=await st.get(pref+"meta:"+key);idx=0;
       if(!part||!Number.isInteger(part.parts)||part.parts<1)throw Error("雲端日K或籌碼缺少年份："+year);
      }
      if(idx>=part.parts){year++;part=null;continue}
      const bytes=await st.get(pref+"day:"+key+":"+(idx++));
      if(!bytes)throw Error("雲端日K／籌碼儲存區塊毀損："+key);
      c.enqueue(new Uint8Array(bytes));return
     }
    }catch(e){c.error(e)}
   }});
   return new Response(stream,{headers:{"content-type":"application/gzip","cache-control":"private, no-store"}});
  }
  if(p==="/get"||p==="/get-chip"){
   const pref=p==="/get-chip"?"chip:":"";
   const start=u.searchParams.get("start"),end=u.searchParams.get("end");
   if(!dateOk(start)||!dateOk(end)||start>end)return respond({ok:false,error:"日期錯誤"},400);
   let d=start,idx=0,part=null;
   const st=this.ctx.storage;
   const stream=new ReadableStream({async pull(c){
    try{
     while(d<=end){
      if(part===null){part=await st.get(pref+"meta:"+d);idx=0}
      if(!part||idx>=part.parts){d=next(d);part=null;continue}
      const bytes=await st.get(pref+"day:"+d+":"+(idx++));
      if(!bytes)throw Error("雲端暫存區塊損毀："+d);
      c.enqueue(new Uint8Array(bytes));return
     }
     c.close();
    }catch(e){c.error(e)}
   }});
   return new Response(stream,{headers:{"content-type":"application/gzip","cache-control":"private, no-store"}});
  }
  if(p==="/delete"&&request.method==="POST"){await this.ctx.storage.deleteAll();await this.ctx.storage.deleteAlarm();return respond({ok:true})}
  return respond({ok:false,error:"資料節點不存在"},404)
 }
 async alarm(){const expiry=await this.ctx.storage.get("expiresAt");if(expiry&&Date.now()>=expiry)await this.ctx.storage.deleteAll();else if(expiry)await this.ctx.storage.setAlarm(expiry)}
}
// TaiwanStockPrice: single stock, entire date range. Volume is SHARES (not lots).
// For emerging shares, open=previous average and may fall outside low/high.
export function filterUnderlyingDailyBars(list,stock,start,end,meta){
 if(!Array.isArray(list))throw Error("FinMind 現股日K格式錯誤");
 const dates=new Map(),byYear=new Map();
 const audit={rows:0,day:0,night:0,rejectedInvalid:0,rejectedProduct:0,rejectedContract:0,rejectedFarMonth:0,duplicates:0,rawVolume:0};
 for(const r of list){
  if(String(r?.stock_id??"")!==stock){audit.rejectedProduct++;continue}
  const d=String(r?.date||"");
  if(!dateOk(d)||d<start||d>end){audit.rejectedInvalid++;continue}
  const o=Number(r.open),h=Number(r.max),l=Number(r.min),c=Number(r.close),
   volume=Number(r.Trading_Volume),money=Number(r.Trading_money),trades=Number(r.Trading_turnover),spread=Number(r.spread);
  if(![o,h,l,c,volume,money,trades,spread].every(Number.isFinite)||o<=0||l<=0||h<l||c<l||c>h||
     volume<0||money<0||trades<0||!Number.isSafeInteger(volume)){
   audit.rejectedInvalid++;continue
  }
  const values=[d,stock,meta.name,meta.futureCode,o,h,l,c,volume,money,trades,spread];
  const line=values.map(column).join(",")+"\n";
  if(dates.has(d)){if(dates.get(d)!==line)throw Error("現股日K同日期價格／成交量互相矛盾："+stock+" "+d);audit.duplicates++;continue}
  dates.set(d,line);audit.rows++;audit.day++;audit.rawVolume+=volume;
  const year=d.slice(0,4);if(!byYear.has(year))byYear.set(year,[]);
  byYear.get(year).push({date:d,line,values});
 }
 const csvByYear={},records=[];
 for(const [year,rows] of byYear){
  const sorted=rows.sort((a,b)=>a.date.localeCompare(b.date));
  csvByYear[year]=sorted.map(x=>x.line).join("");
  for(const row of sorted)records.push({date:row.date,values:row.values});
 }
 records.sort((a,b)=>a.date.localeCompare(b.date));
 return {csvByYear,audit,records};
}
// Every accepted skip must be justified by a verifiable upstream trading calendar
// or by a stock's actual earliest daily-price observation. No synthetic K-bars.
export function parseTradingCalendar(list,start,end){
 if(!Array.isArray(list))throw Error("交易日曆格式錯誤");
 const all=[...new Set(list.map(x=>String(x?.date||"")).filter(dateOk))].sort();
 if(all.length<600||all.at(-1)<start)throw Error("FinMind 交易日曆不完整");
 return {dates:all.filter(d=>d>=start&&d<=end),latest:all.at(-1)};
}
export function firstDailyPriceDate(list,stock,start,end){
 if(!Array.isArray(list))throw Error("股價日線格式錯誤");
 const dates=list.filter(x=>String(x?.stock_id||"")===stock&&dateOk(String(x?.date||""))&&x.date>=start&&x.date<=end)
  .map(x=>String(x.date));
 // No rows is inconclusive: DO NOT skip the minute lookup.
 return dates.length?dates.sort()[0]:"";
}
const INSTITUTIONAL_NAMES=new Set(["Foreign_Investor","Foreign_Dealer_Self","Investment_Trust","Dealer","Dealer_self","Dealer_Hedging"]);
const CREDIT_FIELDS=["MarginPurchaseBuy","MarginPurchaseSell","MarginPurchaseCashRepayment","MarginPurchaseTodayBalance","MarginPurchaseYesterdayBalance","ShortSaleBuy","ShortSaleSell","ShortSaleCashRepayment","ShortSaleTodayBalance","ShortSaleYesterdayBalance"];
// Merge by exact stock/date. Missing source rows remain EMPTY, never zero or prior-day fill.
// FinMind institution buys/sells are shares, whereas financing/short data are lots.
export function joinDailyChipRows(price,instRaw,marginRaw,stock,start,end){
 if(!Array.isArray(price?.records)||!Array.isArray(instRaw)||!Array.isArray(marginRaw))throw Error("回測合併輸入格式錯誤");
 const ins=new Map(),mar=new Map(),bad={institutional:0,margin:0};
 for(const r of instRaw){
  const d=String(r?.date||"");
  if(String(r?.stock_id||"")!==stock||!dateOk(d)||d<start||d>end){bad.institutional++;continue}
  const name=String(r?.name||"");
  if(!INSTITUTIONAL_NAMES.has(name)){bad.institutional++;continue}
  const buy=Number(r.buy),sell=Number(r.sell);
  if(!Number.isSafeInteger(buy)||!Number.isSafeInteger(sell)||buy<0||sell<0)throw Error("法人買賣數據格式錯誤："+stock+" "+d);
  if(!ins.has(d))ins.set(d,new Map());
  const names=ins.get(d);
  if(names.has(name)){
   const prev=names.get(name);
   if(prev.buy!==buy||prev.sell!==sell)throw Error("法人同日同分類衝突："+stock+" "+d);
   continue
  }
  names.set(name,{buy,sell});
 }
 for(const r of marginRaw){
  const d=String(r?.date||"");
  if(String(r?.stock_id||"")!==stock||!dateOk(d)||d<start||d>end){bad.margin++;continue}
  const values=CREDIT_FIELDS.map(key=>{
   if(r[key]===undefined||r[key]===null||r[key]==="")return null;
   const n=Number(r[key]);if(!Number.isSafeInteger(n)||n<0)throw Error("融資融券欄位格式錯誤："+key+" "+d);
   return n;
  });
  // Require balances for a genuinely usable dated observation; missing fields stay blank.
  const sig=JSON.stringify(values);
  if(mar.has(d)){if(mar.get(d).sig!==sig)throw Error("融資融券同日衝突："+stock+" "+d);continue}
  mar.set(d,{values,sig});
 }
 const byYear={},coverage={institutional:0,margin:0,both:0,missingInstitutional:0,missingMargin:0};
 for(const p of price.records){
  const d=p.date,map=ins.get(d),margin=mar.get(d);
  const values=(k)=>map?.get(k)||{buy:0,sell:0};
  const sum=(kinds,type)=>kinds.reduce((a,k)=>a+values(k)[type],0);
  const fin=map?["Foreign_Investor","Foreign_Dealer_Self"]:null;
  const foreBuy=map?sum(fin,"buy"):null,foreSell=map?sum(fin,"sell"):null;
  const trustBuy=map?sum(["Investment_Trust"],"buy"):null,trustSell=map?sum(["Investment_Trust"],"sell"):null;
  // FinMind older consolidated "Dealer" and newer self/hedge splits must
  // never be added together when both representations appear on the same date.
  const dealerKinds=map&&(map.has("Dealer_self")||map.has("Dealer_Hedging"))
   ?["Dealer_self","Dealer_Hedging"]:["Dealer"];
  const dealerBuy=map?sum(dealerKinds,"buy"):null,dealerSell=map?sum(dealerKinds,"sell"):null;
  const instCols=map?[
   1,foreBuy,foreSell,foreBuy-foreSell,values("Foreign_Dealer_Self").buy-values("Foreign_Dealer_Self").sell,
   trustBuy,trustSell,trustBuy-trustSell,dealerBuy,dealerSell,dealerBuy-dealerSell,
   values("Dealer_self").buy-values("Dealer_self").sell,values("Dealer_Hedging").buy-values("Dealer_Hedging").sell
  ]:[0,...Array(12).fill("")];
  const v=margin?.values||[];
  const calc=(i,j)=>Number.isSafeInteger(v[i])&&Number.isSafeInteger(v[j])?v[i]-v[j]:"";
  const marginCols=margin?[1,v[0]??"",v[1]??"",v[2]??"",v[3]??"",v[4]??"",calc(3,4),v[5]??"",v[6]??"",v[7]??"",v[8]??"",v[9]??"",calc(8,9)]:[0,...Array(12).fill("")];
  if(map)coverage.institutional++;else coverage.missingInstitutional++;
  if(margin)coverage.margin++;else coverage.missingMargin++;
  if(map&&margin)coverage.both++;
  const line=[...p.values,...instCols,...marginCols,map||margin?1:0].map(column).join(",")+"\n";
  const year=d.slice(0,4);byYear[year]=(byYear[year]||"")+line;
 }
 return {csvByYear:byYear,coverage,bad};
}
// Add THREE missing research families to the dated daily+institutional+margin CSV.
// Future contract OBSERVATIONS are not official listing/adjustment events.
// Borrow lending is daily securities-lending TRANSACTIONS, not lending short balances.
export function joinResearchRows(prices,oldJoined,foreignRaw,lendingRaw,futuresRaw,stock,start,end,futureCodes=[],preferredFuture=""){
 if(!Array.isArray(prices?.records)||!oldJoined?.csvByYear||![foreignRaw,lendingRaw,futuresRaw].every(Array.isArray))
  throw Error("研究欄位合併資料格式錯誤");
 const foreign=new Map(),lending=new Map(),futures=new Map(),allowed=new Set(futureCodes);
 const counts={foreignHolding:0,lendingTrades:0,futuresObservations:0,missingForeignHolding:0,missingLending:0,missingFutures:0};
 const num=(v,kind)=>{
  if(v===undefined||v===null||v==="")return "";
  const n=Number(v);if(!Number.isFinite(n)||(kind==="nonnegative"&&n<0))throw Error("研究資料數值欄位錯誤："+v);
  return n;
 };
 for(const r of foreignRaw){
  const d=String(r?.date||"");
  if(String(r?.stock_id||"")!==stock||!dateOk(d)||d<start||d>end)continue;
  const vals=["ForeignInvestmentShares","ForeignInvestmentSharesRatio","ForeignInvestmentRemainRatio","NumberOfSharesIssued"].map(x=>num(r[x],"nonnegative"));
  if(vals[1]!==""&&vals[1]>100||vals[2]!==""&&vals[2]>100)throw Error("外資比例不合法："+d);
  const sig=JSON.stringify(vals);if(foreign.has(d)&&foreign.get(d).sig!==sig)throw Error("外資持股同日重複且資料不一致："+stock+" "+d);
  foreign.set(d,{vals,sig});
 }
 for(const r of lendingRaw){
  const d=String(r?.date||"");
  if(String(r?.stock_id||"")!==stock||!dateOk(d)||d<start||d>end)continue;
  const volume=num(r.volume,"nonnegative"),fee=num(r.fee_rate,"nonnegative");
  if(volume==="")continue;
  let val=lending.get(d);
  if(!val){val={transactions:0,volume:0,feeVolume:0,feeVolumeObserved:0};lending.set(d,val)}
  val.transactions++;val.volume+=volume;
  if(fee!==""){val.feeVolume+=volume*fee;val.feeVolumeObserved+=volume}
 }
 for(const r of futuresRaw){
  const d=String(r?.date||""),symbol=String(r?.futures_id||"").trim();
  if(!allowed.has(symbol)||!dateOk(d)||d<start||d>end)continue;
  const month=String(r.contract_date||"").trim();
  if(!/^\d{6}$/.test(month))continue; // exclude spread contracts.
  if(!futures.has(d))futures.set(d,new Map());
  const bucket=futures.get(d);
  if(!bucket.has(symbol))bucket.set(symbol,new Map());
  const group=bucket.get(symbol),session=String(r.trading_session||"");
  // Keep only normal-session OI/volume for comparable contracts; night still proves a quote was observed.
  const key=month+"|"+session;
  const volume=num(r.volume,"nonnegative"),oi=num(r.open_interest,"nonnegative");
  const value={volume,oi,month,session};
  if(group.has(key)){
   if(JSON.stringify(group.get(key))!==JSON.stringify(value))throw Error("股期同月同交易時段資料矛盾："+symbol+" "+d);
   continue
  }
  group.set(key,value)
 }
 const grouped=new Map();
 for(const p of prices.records){const y=p.date.slice(0,4);if(!grouped.has(y))grouped.set(y,[]);grouped.get(y).push(p)}
 const merged={},availability={...counts};
 for(const [year,records] of grouped){
  const existing=String(oldJoined.csvByYear[year]||"").split("\n").filter(Boolean);
  if(existing.length!==records.length)throw Error("研究檔行數與日K不一致："+stock+" "+year);
  const lines=[];
  for(let i=0;i<records.length;i++){
   const d=records[i].date,hold=foreign.get(d),loan=lending.get(d),contractMap=futures.get(d);
   if(hold)availability.foreignHolding++;else availability.missingForeignHolding++;
   if(loan)availability.lendingTrades++;else availability.missingLending++;
   if(contractMap)availability.futuresObservations++;else availability.missingFutures++;
   const loanFee=loan&&loan.feeVolumeObserved>0?Number((loan.feeVolume/loan.feeVolumeObserved).toFixed(6)):"";
   const symbols=contractMap?[...contractMap.keys()].sort():[];
   // Selected mini-future symbol takes priority; if it did not exist historically,
   // fall back to another OBSERVED current-code contract, without mixing sizes.
   const primary=contractMap?(contractMap.has(preferredFuture)?preferredFuture:symbols[0]):"";
   const position=primary?[...contractMap.get(primary).values()].filter(x=>x.session==="position"&&x.month>=d.slice(0,4)+d.slice(5,7)):[];
   const months=contractMap?[...new Set([...contractMap.values()].flatMap(x=>[...x.values()].map(y=>y.month)))].sort():[];
   const frontMonth=position.length?position.map(x=>x.month).sort()[0]:"";
   const front=position.find(x=>x.month===frontMonth);
   const extra=[
    hold?1:0,...(hold?.vals||["","","",""]),
    loan?1:0,loan?.transactions??"",loan?.volume??"",loan?1:"",loanFee,
    contractMap?1:0,symbols.join("|"),months.join("|"),primary,frontMonth,front?.volume??"",front?.oi??"",
    1,1
   ];
   lines.push(existing[i]+","+extra.map(column).join(","));
  }
  merged[year]=lines.join("\n")+"\n";
 }
 return {csvByYear:merged,coverage:availability};
}
// Daily data goes back to 1994, but requests covering 2000-now can become large.
// Limit EACH FinMind call to eight calendar years; 2021-now still uses one call.
export function dailyPriceWindows(start,end,maxYears=8){
 if(!dateOk(start)||!dateOk(end)||start>end||!Number.isSafeInteger(maxYears)||maxYears<1)throw Error("日K區間設定錯誤");
 const result=[];
 let from=start;
 while(from<=end){
  const lastYear=Math.min(Number(end.slice(0,4)),Number(from.slice(0,4))+maxYears-1);
  const to=lastYear===Number(end.slice(0,4))?end:lastYear+"-12-31";
  result.push({start:from,end:to});
  from=String(lastYear+1)+"-01-01";
 }
 return result;
}
export class StockFuturesBatch{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 chipSummary(c){return c?{
  phase:c.phase,processed:c.processed,total:c.total,queries:c.queries,priceRows:c.priceRows,
  institutionalRows:c.institutionalRows,marginRows:c.marginRows,bothRows:c.bothRows,
  missingInstitutional:c.missingInstitutional,missingMargin:c.missingMargin,
  lastCode:c.lastCode||"",error:c.error||"",message:c.message||"",
  updatedAt:c.updatedAt,startedAt:c.startedAt,retryCount:c.retryCount
 }:null}
 summary(s,merge=null){return {ok:true,merge:merge?{
  phase:merge.phase,processed:merge.processed,total:merge.total,bytes:merge.bytes,
  error:merge.error||"",updatedAt:merge.updatedAt,startedAt:merge.startedAt,
  completedAt:merge.completedAt||null,retryCount:merge.retryCount||0,
  message:merge.message||""
 }:null,rateLimitPerHour:["stocks","daily","daily-chip","daily-research","market-daily","all-stocks","all-daily","all-daily-chip","all-daily-research"].includes(s.mode)?Math.floor(3600000/STOCK_REQUEST_SPACING_MS):null,apiRatePerHour:s.apiRatePerHour||0,etaHours:s.etaHours??null,barRatePerHour:s.barRatePerHour||0,skipped:s.skipped||0,calendarVerified:!!s.calendarVerified,preflightDone:s.preflightIndex||0,preflightTotal:["stocks","all-stocks"].includes(s.mode)?s.catalog.length:0,chipCoverage:s.chipCoverage||null,universe:s.mode.startsWith("all-")?"all-twse-tpex":"futures-eligible",mode:s.mode||"futures",dataset:["daily-research","all-daily-research"].includes(s.mode)?"TaiwanStockPrice+三大法人+融資融券+外資持股+借券成交+股期日線":["daily-chip","all-daily-chip"].includes(s.mode)?"TaiwanStockPrice+TaiwanStockInstitutionalInvestorsBuySell+TaiwanStockMarginPurchaseShortSale":["daily","market-daily","all-daily"].includes(s.mode)?"TaiwanStockPrice":["stocks","all-stocks"].includes(s.mode)?"TaiwanStockKBar":"TaiwanFuturesKBar",phase:s.phase,start:s.start,end:s.end,total:s.total,processed:s.processed,queries:s.queries,nonempty:s.nonempty,empty:s.empty,rows:s.rows,night:s.night,duplicates:s.duplicates,rejected:s.rejected,excludedFarMonth:s.excludedFarMonth||0,errors:s.errors.slice(-30),codes:s.mode==="market-daily"?[]:s.codes,codeCount:s.catalog.length,currentDate:s.date,currentCode:s.catalog[s.symbolIndex]?.code||null,lastError:s.lastError||"",updatedAt:s.updatedAt,createdAt:s.createdAt,coverage:["daily-research","all-daily-research"].includes(s.mode)?"現股日K＋法人＋融資融券＋外資持股（2004/02起）＋借券成交（2001/05起）＋現有股期代碼歷史日成交觀測（不等於正式掛牌日期）":["daily-chip","all-daily-chip"].includes(s.mode)?"現股日K＋三大法人（2005起）＋融資融券（2001起）；籌碼收盤後可得，限下一交易時段使用":s.mode==="market-daily"?"現行上市上櫃普通股＋2018年後下市櫃股票（FinMind 名單）；排除 ETF／權證／興櫃，原始未還原日K":["daily","all-daily"].includes(s.mode)?"日K；股票範圍依目前模式。TAIFEX 現行有期貨的普通股，每檔現股按多年分段查詢（日K）":["stocks","all-stocks"].includes(s.mode)?"1分K；股票範圍依目前模式。TAIFEX 現行有期貨的普通股標的（每股票一次）；不含已終止掛牌商品":"TAIFEX 當前標的；歷史終止上市契約可能不在清單內；100 股小型優先；近月單一合約",message:s.message,version:s.version||1}}
 shard(code){return this.env.STOCK_FUTURES_DATA.get(this.env.STOCK_FUTURES_DATA.idFromName(code))}
 async fetch(r){
  const p=new URL(r.url).pathname,st=this.ctx.storage;
  if(p==="/start"&&r.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(!token)return respond({ok:false,error:"沒有 FinMind Token"},401);
   const q=await r.json(),allMode=String(q.mode||"").startsWith("all-"),
    stocksMode=q.mode==="stocks"||q.mode==="all-stocks",
    researchMode=q.mode==="daily-research"||q.mode==="all-daily-research",
    chipMode=q.mode==="daily-chip"||q.mode==="all-daily-chip"||researchMode,
    marketMode=q.mode==="market-daily",dailyMode=q.mode==="daily"||q.mode==="all-daily"||chipMode||marketMode,
    cashMode=stocksMode||dailyMode;
    if(!dateOk(q.start)||!dateOk(q.end)||q.start>(q.end)||q.start<(dailyMode?"2000-01-01":"2021-01-01"))
     return respond({ok:false,error:"資料日期範圍無效"},400);
    let old=await st.get("state");
   if(old&&!q.reset){await st.put("token",token);const legacy=old.mode!=="stocks"&&old.mode!=="daily"&&old.mode!=="daily-chip"&&old.mode!=="daily-research"&&old.mode!=="market-daily"&&!String(old.mode||"").startsWith("all-")&&old.version!==2;return respond({...this.summary(old),existing:true,message:legacy?"這是舊版全月份／大、小合約混用的任務。請先匯出舊資料，再重建近月任務。":old.message,legacy})}
   if(allMode){
    if(!["all-stocks","all-daily","all-daily-chip","all-daily-research"].includes(q.mode))
     return respond({ok:false,error:"全市場資料週期錯誤"},400);
    if(old&&q.reset)await st.deleteAll();
    const markets=Array.isArray(q.markets)&&q.markets.length?q.markets.filter(x=>["twse","tpex"].includes(x)):["twse","tpex"];
    if(!markets.length)return respond({ok:false,error:"請至少選擇上市或上櫃"},400);
    const codes=Array.isArray(q.codes)?q.codes.filter(c=>/^[1-9][0-9]{3}$/.test(c)):[];
    if(codes.length>3500)return respond({ok:false,error:"股票清單超出上限"},400);
    const now=Date.now(),s={phase:"preparing",shardKey:randomId(),start:q.start,end:q.end,mode:q.mode,version:12,
     catalog:[],codes:[],requestedMarkets:markets,requestedCodes:codes,date:q.start,symbolIndex:0,
     total:0,processed:0,queries:0,nonempty:0,empty:0,rows:0,night:0,rejected:0,excludedFarMonth:0,
     duplicates:0,retries:0,skipped:0,preflightIndex:0,firstDates:{},errors:[],createdAt:now,
     updatedAt:now,expiresAt:now+ALL_MARKET_TTL,message:"全市場準備中：背景取得 FinMind 上市櫃普通股名單，已下載股期資料不受影響"};
    await st.put("token",token);await st.put("state",s);await st.setAlarm(now+100);
    return respond(this.summary(s),202);
   }
   if(marketMode){
    // IMPORTANT: do not fetch FinMind while holding blockConcurrencyWhile.
    // Cloudflare aborts blocked objects after ~30 seconds, which produced
    // an interrupted browser request before the job was even created.
    if(old&&q.reset)await st.deleteAll();
    const markets=Array.isArray(q.markets)?q.markets.filter(x=>["twse","tpex","delisted"].includes(x)):[];
    if(!markets.length)return respond({ok:false,error:"請至少選擇上市、上櫃或下市櫃其中一個市場"},400);
    const s={phase:"preparing",shardKey:randomId(),start:q.start,end:q.end,mode:"market-daily",version:8,
     catalog:[],codes:[],requestedMarkets:markets,requestedCodes:Array.isArray(q.codes)?q.codes:[],
     date:q.start,symbolIndex:0,total:0,processed:0,queries:0,nonempty:0,empty:0,rows:0,night:0,
     rejected:0,excludedFarMonth:0,duplicates:0,retries:0,errors:[],
     createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+30*DAY,
     message:"背景建立任務成功；正在取得 FinMind 上市、上櫃與下市櫃完整股票清單"};
    await st.put("token",token);await st.put("state",s);await st.setAlarm(Date.now()+100);
    return respond(this.summary(s),202);
   }
   let catalog;
   try{
    {
    const official=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
    if(!official.ok)throw Error("TAIFEX HTTP "+official.status);
    const rawCatalog=parseStockFutureUniverse(await official.text());
    const requested=new Set(Array.isArray(q.codes)?q.codes:[]);
    const preferred=preferMiniStockFutures(rawCatalog);
    if(cashMode){
     catalog=preferred.map(c=>({...c,code:c.stock,futureCode:c.code,night:false,futureCodes:rawCatalog.filter(f=>f.stock===c.stock).map(f=>f.code).sort()}));
     if(requested.size)catalog=catalog.filter(x=>requested.has(x.stock));
    }else{
     catalog=preferred;
     // Legacy futures path still maps big-contract selections to mini contracts.
     if(requested.size){const stocks=new Set(rawCatalog.filter(x=>requested.has(x.code)).map(x=>x.stock));catalog=catalog.filter(x=>stocks.has(x.stock))}
    }
    }
   }catch(e){return respond({ok:false,error:"不能驗證完整個股期貨商品清單，未啟動下載："+e.message},502)}
   if(!catalog.length)return respond({ok:false,error:cashMode?"沒有符合條件的現股":"沒有符合的個股期貨"},400);
   if(old&&q.reset){
    // Each private job has its own randomized shard namespace. Old shards expire after 30 days.
    await st.deleteAll()
   }
   const s={phase:"running",shardKey:randomId(),start:q.start,end:q.end,catalog,codes:catalog.map(x=>({code:x.code,name:x.name,stock:x.stock,units:x.units,night:x.night,futureCode:x.futureCode||x.code})),date:q.start,symbolIndex:0,mode:marketMode?"market-daily":researchMode?"daily-research":chipMode?"daily-chip":dailyMode?"daily":stocksMode?"stocks":"futures",version:marketMode?7:researchMode?9:chipMode?6:dailyMode?5:stocksMode?4:2,total:0,processed:0,queries:0,nonempty:0,empty:0,rows:0,night:0,rejected:0,excludedFarMonth:0,duplicates:0,retries:0,skipped:0,preflightIndex:0,firstDates:{},errors:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+30*DAY,message:marketMode?"已建立上市上櫃全市場 2018 年至今日K下載，含下市櫃代號，手機離線持續":researchMode?"已建立完整個股研究任務（日K＋法人＋融資融券＋外資持股＋借券成交＋股期歷史觀測）":chipMode?"已建立日K＋三大法人＋融資融券雲端任務；資料按日期合併、缺漏留空，手機可離線":dailyMode?"已建立日K雲端任務；長歷史每8年分段，手機可離線":stocksMode?"已建立現股 1 分 K 快速雲端任務；先核對交易日與股票掛牌期間，手機可離線":"已建立小型優先、各交易時段近月合約的雲端任務。手機可離線"};
   if(dailyMode)s.total=catalog.length;
    else for(let d=q.start;d<=q.end;d=next(d)){const w=dayOf(d);if(w===0||w===6&&stocksMode)continue;for(const c of catalog)if(w!==6||c.night)s.total++}
   await st.put("token",token);await st.put("state",s);await st.setAlarm(Date.now()+100);
   return respond(this.summary(s),202)
  });
  let s=await st.get("state");if(!s)return respond({ok:false,error:"找不到下載任務"},404);
  if(p==="/status"){
   try{
    // Old completed jobs can have pre-merge state; retrieving its merge
    // metadata must not prevent access to the already downloaded history.
    let merge=null,mergeWarning="";
    if(s.mode==="market-daily"){
     try{merge=await st.get("merge")||null}
     catch(e){mergeWarning=String(e?.name||"StorageError")}
    }
    const out=this.summary(s,merge);
    if(s.mode==="market-daily"){
     try{out.chip=this.chipSummary(await st.get(CHIP_JOB_KEY))}
     catch(e){out.chipWarning="籌碼補抓進度暫時不可用"}
     try{out.chipMerge=this.summary(s,await st.get(CHIP_MERGE_KEY)).merge}
     catch(e){out.chipMergeWarning="籌碼合併進度暫時不可用"}
    }
    if(mergeWarning)out.mergeWarning="雲端合併進度暫時不可讀（"+mergeWarning+"）；原始日K仍保留";
    if(new URL(r.url).searchParams.get("audit")==="1")out.recordRowsByStockYear=s.recordRowsByStockYear||null;
    return respond(out);
   }catch(e){
    // Return safe minimal state, not an unhandled 500. Do not return
    // stored credentials or raw catalog fields.
    return respond({ok:true,mode:s.mode||"unknown",phase:s.phase||"error",
     start:s.start||"",end:s.end||"",total:Number(s.total||0),processed:Number(s.processed||0),
     rows:Number(s.rows||0),codeCount:Array.isArray(s.catalog)?s.catalog.length:0,
     errors:[],merge:null,updatedAt:s.updatedAt||Date.now(),
     warning:"完整狀態摘要無法讀取，已改用基本模式："+String(e?.name||"Error"),
     message:"日K任務仍存在，請勿刪除或重新下載"},200);
   }
  }
  if(p==="/export")return this.exportData(s,new URL(r.url));
  if(s.mode==="market-daily"&&p==="/chip-start"&&r.method==="POST")
   return this.ctx.blockConcurrencyWhile(async()=>{
    s=await st.get("state");
    if(!s||s.phase!=="done"||s.processed!==s.total||!s.catalog.length)
     return respond({ok:false,error:"必須先完成原本的全市場股價日K任務，才可只補抓法人與資券資料"},409);
    const bearer=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
    if(bearer&&(bearer.length<5||bearer.length>4096||/[\r\n]/.test(bearer)))return respond({ok:false,error:"FinMind Token 格式不正確"},401);
    if(bearer)await st.put("token",bearer);
    if(!await st.get("token"))return respond({ok:false,error:"缺少 FinMind Token；請在上方填入會員 Token"},401);
    let chip=await st.get(CHIP_JOB_KEY);
    if(chip?.phase==="done"||chip?.phase==="running")
     return respond({ok:true,existing:true,chip:this.chipSummary(chip)});
    if(chip&&chip.phase==="paused"||chip?.phase==="error"){
     chip.phase="running";chip.retryCount=0;chip.error="";
     chip.updatedAt=Date.now();chip.message="沿用已抓好的籌碼資料，繼續補抓下一檔";
    }else{
     const now=Date.now();
     chip={phase:"running",processed:0,total:s.catalog.length,queries:0,priceRows:0,
      institutionalRows:0,marginRows:0,bothRows:0,missingInstitutional:0,missingMargin:0,
      retryCount:0,error:"",lastCode:"",startedAt:now,updatedAt:now,
      nextAllowedAt:0,message:"開始只補抓法人買賣及融資融券；原始日 K 不會重抓或覆蓋"};
    }
    await st.put(CHIP_JOB_KEY,chip);await st.setAlarm(Date.now()+100);
    return respond({ok:true,chip:this.chipSummary(chip)},202)
   });
  if(s.mode==="market-daily"&&(p==="/chip-pause"||p==="/chip-resume")&&r.method==="POST")
   return this.ctx.blockConcurrencyWhile(async()=>{
    const chip=await st.get(CHIP_JOB_KEY);
    if(!chip)return respond({ok:false,error:"尚未建立籌碼補抓任務"},404);
    if(p==="/chip-pause"&&chip.phase==="running"){
     chip.phase="paused";chip.message="籌碼補抓已暫停，原始日 K 不受影響";
    }
    if(p==="/chip-resume"&&["error","paused"].includes(chip.phase)){
     if(!await st.get("token"))return respond({ok:false,error:"無 FinMind Token；請在上方填入後重新按開始"},401);
     chip.phase="running";chip.error="";chip.retryCount=0;chip.message="從上次完成的股票續抓";
    }
    chip.updatedAt=Date.now();await st.put(CHIP_JOB_KEY,chip);
    if(chip.phase==="running")await st.setAlarm(Date.now()+100);
    return respond({ok:true,chip:this.chipSummary(chip)})
   });
  if(s.mode==="market-daily"&&p==="/chip-merge-download")return this.exportMerged(s,st,"chip");
  if(s.mode==="market-daily"&&p==="/chip-merge-resume"&&r.method==="POST")
   return this.ctx.blockConcurrencyWhile(async()=>{
    const merge=await st.get(CHIP_MERGE_KEY),chip=await st.get(CHIP_JOB_KEY);
    if(chip?.phase!=="done")return respond({ok:false,error:"需先補齊法人融資融券資料"},409);
    if(!merge){await this.completeMarketChip(s,chip,st);return respond({ok:true,merge:this.summary(s,await st.get(CHIP_MERGE_KEY)).merge})}
    if(merge.phase!=="error")return respond({ok:false,error:"目前沒有失敗的籌碼合併需要恢復"},409);
    merge.phase="running";merge.retryCount=0;merge.error="";merge.updatedAt=Date.now();
    merge.message="從 "+merge.processed+"/"+merge.total+" 檔恢復合併（不再下載 FinMind）";
    await st.put(CHIP_MERGE_KEY,merge);await st.setAlarm(Date.now()+100);
    return respond({ok:true,merge:this.summary(s,merge).merge});
   });
  if(s.mode==="market-daily"&&p==="/chip-share"&&r.method==="POST"){
   const merge=await st.get(CHIP_MERGE_KEY);
   if(merge?.phase!=="done")return respond({ok:false,error:"股價＋籌碼雲端合併尚未完成"},409);
   let share=await st.get(CHIP_MERGE_KEY+":share");
   if(!share||share.expiresAt<=Date.now()){
    share={key:randomId(),expiresAt:Math.min(Date.now()+MERGE_SHARE_MAX_AGE,s.expiresAt)};
    await st.put(CHIP_MERGE_KEY+":share",share)
   }
   return respond({ok:true,key:share.key,expiresAt:new Date(share.expiresAt).toISOString()});
  }
  if(s.mode==="market-daily"&&p==="/chip-revoke"&&r.method==="POST"){
   await st.delete(CHIP_MERGE_KEY+":share");return respond({ok:true,revoked:true});
  }
  if(s.mode==="market-daily"&&p==="/chip-shared"){
   const key=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   const share=await st.get(CHIP_MERGE_KEY+":share");
   if(!validShareKey(key)||!share||share.key!==key||share.expiresAt<=Date.now())
    return respond({ok:false,error:"籌碼唯讀連結已失效或沒有權限"},403);
   const u=new URL(r.url),fmt=u.searchParams.get("format")||"";
   if(fmt==="status")return respond({ok:true,source:"FinMind TaiwanStockPrice + TaiwanStockInstitutionalInvestorsBuySell + TaiwanStockMarginPurchaseShortSale",
    dateStart:s.start,dateEnd:s.end,totalStocks:s.total,totalPriceRows:s.rows,
    chip:this.chipSummary(await st.get(CHIP_JOB_KEY)),
    chipMerge:this.summary(s,await st.get(CHIP_MERGE_KEY)).merge,
    columns:CHIP_COLUMNS.trimEnd(),shareExpiresAt:new Date(share.expiresAt).toISOString()});
   if(fmt)return respond({ok:false,error:"格式錯誤"},400);
   const code=u.searchParams.get("code")||"",year=u.searchParams.get("year")||"",part=u.searchParams.get("part")||"";
   if(code||year||part){
    if(code&&!/^\d{4}$/.test(code)||year&&!/^(20|21)\d{2}$/.test(year)||part&&!/^[1-9]\d{0,3}$/.test(part))
     return respond({ok:false,error:"股票／年份／分包參數錯誤"},400);
    if(!code&&(!year||!part))return respond({ok:false,error:"請指定股票，或年份加分包"},400);
    return this.exportDailyData(s,new URL("https://private/export?"+new URLSearchParams({code,year,part,chip:"1"})))
   }
   return this.exportMerged(s,st,"chip");
  }
  if(s.mode==="market-daily"&&p==="/merge-start"&&r.method==="POST")
   return this.ctx.blockConcurrencyWhile(async()=>{
    s=await st.get("state");
    if(s.phase!=="done"||s.processed!==s.total||!s.catalog.length)
     return respond({ok:false,error:"請先完成雲端歷史日K下載"},409);
    const current=await st.get("merge");
    if(current&&["running","done"].includes(current.phase))
     return respond({ok:true,existing:true,merge:this.summary(s,current).merge});
    if(current?.processed>0)
     return respond({ok:false,error:"合併曾中斷，請使用「繼續合併」保留已完成資料"},409);
    const now=Date.now();
    const merge={phase:"running",processed:0,total:s.catalog.length,bytes:0,
     retryCount:0,error:"",startedAt:now,updatedAt:now,completedAt:null,
     message:"雲端已開始從既有股票日K逐檔建立單一 GZIP，手機可直接關閉"};
    const header=await zip(MARKET_HDR);merge.bytes=header.byteLength;
    await st.put("merge:header",header);
    await st.delete("merge:share");
    await st.put("merge",merge);await st.setAlarm(now+100);
    return respond({ok:true,merge:this.summary(s,merge).merge},202);
   });
  if(s.mode==="market-daily"&&p==="/merge-resume"&&r.method==="POST")
   return this.ctx.blockConcurrencyWhile(async()=>{
    const merge=await st.get("merge");
    if(!merge||merge.phase!=="error")return respond({ok:false,error:"沒有中斷的合併任務"},409);
    merge.phase="running";merge.error="";merge.retryCount=0;
    merge.message="正在從第 "+(merge.processed+1)+" 檔股票恢復合併";
    merge.updatedAt=Date.now();
    await st.put("merge",merge);await st.setAlarm(Date.now()+100);
    return respond({ok:true,merge:this.summary(s,merge).merge});
   });
  if(s.mode==="market-daily"&&p==="/merge-download")return this.exportMerged(s,st);
  if(s.mode==="market-daily"&&p==="/merge-share"&&r.method==="POST"){
   const merge=await st.get("merge");
   if(!merge||merge.phase!=="done")return respond({ok:false,error:"合併尚未完成，無法分享"},409);
   let share=await st.get("merge:share");
   if(!share||share.expiresAt<=Date.now()){
    share={key:randomId(),expiresAt:Math.min(Date.now()+MERGE_SHARE_MAX_AGE,s.expiresAt)};
    await st.put("merge:share",share);
   }
   return respond({ok:true,key:share.key,expiresAt:new Date(share.expiresAt).toISOString(),warning:"具有連結的任何人均可讀取這份歷史資料"});
  }
  if(s.mode==="market-daily"&&p==="/merge-revoke"&&r.method==="POST"){
   await st.delete("merge:share");return respond({ok:true,revoked:true});
  }
  if(s.mode==="market-daily"&&p==="/merge-shared"){
   const key=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   const share=await st.get("merge:share");
   if(!validShareKey(key)||!share||share.expiresAt<=Date.now()||share.key!==key)
    return respond({ok:false,error:"此唯讀分享連結已失效或無權限"},403);
   const u=new URL(r.url),fmt=u.searchParams.get("format")||"";
   if(fmt==="status"){
    const merge=await st.get("merge");
    return respond({ok:true,source:"FinMind TaiwanStockPrice",dateStart:s.start,dateEnd:s.end,
     totalStocks:s.total,totalRows:s.rows,merge:this.summary(s,merge).merge,
     columns:MARKET_HDR.trim(),shareExpiresAt:new Date(share.expiresAt).toISOString()});
   }
   if(fmt)return respond({ok:false,error:"不支援的格式"},400);
   const code=u.searchParams.get("code")||"",year=u.searchParams.get("year")||"",part=u.searchParams.get("part")||"";
   if(code||year||part){
    if(code&&!/^\d{4}$/.test(code)||year&&!/^(20|21)\d{2}$/.test(year)||part&&!/^[1-9]\d{0,2}$/.test(part))
     return respond({ok:false,error:"股票、年份或分包參數錯誤"},400);
    if(!code&&!year)return respond({ok:false,error:"請指定年份或單一股票代碼"},400);
    return this.exportDailyData(s,new URL("https://private/export?"+new URLSearchParams({code,year,part})));
   }
   return this.exportMerged(s,st);
  }
  if(p==="/replace-token"&&r.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(token.length<5||token.length>4096)return respond({ok:false,error:"缺少有效的新 Token"},401);
   const current=await st.get("state");
   if(!current||current.mode!=="market-daily")return respond({ok:false,error:"沒有需要修復的全市場下載任務"},404);
   if(current.phase==="deleting")return respond({ok:false,error:"資料正在刪除，不能恢復"},409);
   await st.put("token",token);
   if(["paused","error"].includes(current.phase)){
    current.phase=current.catalog.length?"running":"preparing";
    current.retries=0;current.errors=[];current.lastError="";
    current.message="新 Token 已驗證，"+(current.catalog.length?"繼續下載現股日 K":"正在重新建立股票清單");
    current.updatedAt=Date.now();
    await st.put("state",current);
    await st.setAlarm(Date.now()+100);
   }
   return respond({...this.summary(current),verified:true,credentialUpdated:true,
    message:current.message||"FinMind Token 已驗證並更新"});
  });

  if(r.method!=="POST")return respond({ok:false,error:"操作方法錯誤"},405);
  return this.ctx.blockConcurrencyWhile(async()=>{
   s=await st.get("state");
   if(p==="/delete"){
    if(s.mode==="market-daily"){
     // Avoid exceeding the 1000-internal-subrequest free-plan limit:
     // durable alarms clean up stock shards 80 per invocation.
     s.phase="deleting";s.deleteIndex=0;s.message="背景刪除資料中";
     await st.put("state",s);await st.setAlarm(Date.now()+100);
     return respond({ok:true,deleting:true,message:"正在分批清除私有雲端日K，任務已停止"})
    }
    for(let i=0;i<s.catalog.length;i+=20)await Promise.all(s.catalog.slice(i,i+20).map(c=>this.shardFor(s,c.code).fetch(new Request("https://private/delete",{method:"POST"}))));
    await st.deleteAll();await st.deleteAlarm();return respond({ok:true,deleted:true})
   }
   if(p==="/pause"&&["running","preparing"].includes(s.phase)){s.phase="paused";s.message="已暫停";await st.put("state",s);await st.setAlarm(s.expiresAt)}
   if(p==="/resume"&&["paused","error"].includes(s.phase)){
    s.phase=s.mode==="market-daily"&&!s.catalog.length?"preparing":"running";
    s.lastError="";s.retries=0;s.message=s.phase==="preparing"?"重新取得股票名單":"繼續下載";
    await st.put("state",s);await st.setAlarm(Date.now()+100)
   }
   return respond(this.summary(s))
  })
 }
 shardFor(s,code){return this.env.STOCK_FUTURES_DATA.get(this.env.STOCK_FUTURES_DATA.idFromName(s.shardKey+":"+code))}
 async alarm(){
  const st=this.ctx.storage,s=await st.get("state");if(!s)return;
  if(s.phase==="deleting"){
   const offset=s.deleteIndex||0,batch=s.catalog.slice(offset,offset+80);
   await Promise.all(batch.map(c=>this.shardFor(s,c.code).fetch(new Request("https://private/delete",{method:"POST"}))));
   if(offset+batch.length>=s.catalog.length){await st.deleteAll();await st.deleteAlarm()}
   else{s.deleteIndex=offset+batch.length;s.updatedAt=Date.now();await st.put("state",s);await st.setAlarm(Date.now()+200)}
   return
  }
  if(Date.now()>=s.expiresAt){await st.deleteAll();await st.deleteAlarm();return}
  if(s.mode==="market-daily"){
   const merge=await st.get("merge");
   if(merge?.phase==="running"){await this.alarmMerge(s,merge,st);return}
   const chips=await st.get(CHIP_JOB_KEY);
   if(chips?.phase==="running"){await this.alarmMarketChip(s,chips,st);return}
   const chipMerge=await st.get(CHIP_MERGE_KEY);
   if(chipMerge?.phase==="running"){await this.alarmMerge(s,chipMerge,st,"chip");return}
  }
  if(s.phase==="preparing"&&(s.mode==="market-daily"||String(s.mode||"").startsWith("all-"))){
   const token=await st.get("token");
   try{
    if(!token)throw Error("缺少 FinMind Token");
    const markets=new Set(s.requestedMarkets||[]);
    const items=await fetchMarketStockCatalog(token,markets.has("delisted"));
    const wanted=new Set(s.requestedCodes||[]);
    let catalog=items.filter(c=>markets.has(c.market)&&(!wanted.size||wanted.has(c.code)));
    const allMode=String(s.mode||"").startsWith("all-");
    if(allMode){
     catalog=catalog.map(c=>({...c,futureCode:"",futureCodes:[]}));
     try{
      const response=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},
       signal:AbortSignal.timeout(15000)});
      if(response.ok){
       const futures=parseStockFutureUniverse(await response.text()),
        preferred=preferMiniStockFutures(futures),best=new Map(preferred.map(c=>[c.stock,c]));
       catalog=catalog.map(c=>{
        const x=best.get(c.stock);
        return {...c,futureCode:x?.code||"",futureCodes:futures.filter(f=>f.stock===c.stock).map(f=>f.code).sort()}
       })
      }
     }catch{} // TAIFEX mapping failure cannot exclude listed/OTC cash equities.
    }
    if(!catalog.length)throw Error("FinMind 名單沒有符合市場條件的普通股");
    const latest=await st.get("state");
    if(!latest||latest.shardKey!==s.shardKey||latest.phase!=="preparing")return;
    s.catalog=catalog;
    if(allMode){
     s.codes=catalog.map(c=>({code:c.code,name:c.name,stock:c.stock,market:c.market,
      futureCode:c.futureCode||"",futureCodes:c.futureCodes||[]}));
     if(s.mode==="all-stocks"){
      let days=0;for(let d=s.start;d<=s.end;d=next(d)){const wd=dayOf(d);if(wd!==0&&wd!==6)days++}
      s.total=days*catalog.length;
     }else s.total=catalog.length;
    }else{s.codes=[];s.total=catalog.length}
    s.phase="running";s.queries+=markets.has("delisted")?2:1;
    s.message="已確認 "+catalog.length+" 檔股票，開始下載"+(s.mode==="all-stocks"?"全市場 1 分 K":"日 K");
    s.updatedAt=Date.now();await st.put("state",s);await st.setAlarm(Date.now()+100);
   }catch(e){
    const latest=await st.get("state");
    if(!latest||latest.shardKey!==s.shardKey||latest.phase!=="preparing")return;
    s.phase="error";s.lastError=String(e.message||e);s.message="股票名單取得失敗："+s.lastError;
    s.errors.push({day:"catalog",code:"TaiwanStockInfo/TaiwanStockDelisting",error:s.lastError});
    s.updatedAt=Date.now();await st.put("state",s);await st.setAlarm(s.expiresAt)
   }
   return
  }
  if(s.phase!=="running"){await st.setAlarm(s.expiresAt);return}
  await st.setAlarm(Date.now()+120000);
  const token=await st.get("token");
  if(!token){s.phase="error";s.lastError="缺少 Token";await st.put("state",s);await st.setAlarm(s.expiresAt);return}
  if(["daily","daily-chip","daily-research","market-daily","all-daily","all-daily-chip","all-daily-research"].includes(s.mode)){await this.alarmDaily(s,token,st);return}
  const stockMode=s.mode==="stocks"||s.mode==="all-stocks";
  const commit=async(n,backoff=0)=>{
   const latest=await st.get("state");
   if(!latest||latest.shardKey!==s.shardKey)return;
   if(latest.phase==="paused")s.phase="paused";
   if(latest.phase==="error"&&s.phase==="running")s.phase="error";
   updateApiTelemetry(s);
   s.updatedAt=Date.now();
   await st.put("state",s);
   await st.setAlarm(s.phase==="running"?Math.max(Date.now()+120,s.nextAllowedAt||0,Date.now()+backoff):s.expiresAt);
  };
  const spend=(calls,started)=>{
   s.queries+=calls;
   if(stockMode)s.nextAllowedAt=Math.max(started,s.nextAllowedAt||0)+calls*STOCK_REQUEST_SPACING_MS;
  };
  // This path is also executed for already-running legacy stock jobs, without resetting
  // their date cursor, private data shards, rows, or progress.
  if(stockMode&&!s.calendarAttempted){
   const started=Date.now();
   try{
    const raw=await fetchFinMind(token,{dataset:"TaiwanStockTradingDate"});
    const parsed=parseTradingCalendar(raw,s.start,s.end);
    s.tradingDates=parsed.dates;s.calendarLatest=parsed.latest;s.calendarVerified=true;
    s.message="已取得官方交易日清單，正在確認個股可用的歷史區間";
   }catch(e){
    s.tradingDates=[];s.calendarVerified=false;
    s.errors.push({day:"calendar",code:"TaiwanStockTradingDate",error:String(e.message||e).slice(0,170)});
    s.message="交易日曆不可用，改為逐個平日驗證（不會據此省略資料）";
    if([401,402,403,429].includes(Number(e.code))){s.phase="error";s.lastError=s.message+"："+String(e.message||e)}
   }
   s.calendarAttempted=true;
   spend(1,started);
   await commit(0);return
  }
  if(stockMode&&(s.preflightIndex||0)<s.catalog.length){
   const started=Date.now(),index=s.preflightIndex||0;
   const stocks=s.catalog.slice(index,index+STOCK_MAX_PARALLEL);
   const results=await Promise.all(stocks.map(async c=>{
    try{
     const raw=await fetchFinMind(token,{dataset:"TaiwanStockPrice",data_id:c.code,start_date:s.start,end_date:s.end});
     return {c,first:firstDailyPriceDate(raw,c.code,s.start,s.end)};
    }catch(e){return {c,failed:true,code:Number(e.code||0),error:String(e.message||e).slice(0,160)}}
   }));
   if(!s.firstDates)s.firstDates={};
   for(const r of results){
    // If metadata is unavailable, an empty hint is conservative: query every trading date.
    s.firstDates[r.c.code]=r.first||"";
    if(r.failed){
     s.errors.push({day:"daily-price",code:r.c.code,error:r.error});
     if([401,402,403,429].includes(r.code)){s.phase="error";s.lastError="FinMind 額度或 Token 無法使用："+r.error}
    }
   }
   s.preflightIndex=index+stocks.length;
   spend(stocks.length,started);
   s.message=s.phase==="running"?"核對個股歷史成交日 "+s.preflightIndex+"/"+s.catalog.length+"；已下載分K不受影響":s.lastError;
   s.errors=s.errors.slice(-100);
   await commit(0);return
  }
  const started=Date.now(),batchSize=stockMode?STOCK_MINUTE_BATCH:4;
  const tradingDays=stockMode&&s.calendarVerified?new Set(s.tradingDates):null;
  const skips=[],tasks=[];
  let scanned=0;
  while(tasks.length<batchSize&&s.date<=s.end&&scanned<STOCK_SCAN_CAP){
   scanned++;
   const wd=dayOf(s.date),c=s.catalog[s.symbolIndex],day=s.date,index=s.symbolIndex;
   s.symbolIndex++;if(s.symbolIndex>=s.catalog.length){s.symbolIndex=0;s.date=next(day)}
   // Do not count usual skipped weekends as processed. The historical job
   // previously did not query Saturdays; keep that behavior for compatibility.
   if(wd===0||wd===6&&(stockMode||!c.night))continue;
   if(stockMode){
    const closed=tradingDays&&day<=s.calendarLatest&&!tradingDays.has(day);
    const earliest=s.firstDates?.[c.code]||"";
    if(closed||(earliest&&day<earliest)){skips.push({day,index});continue}
   }
   tasks.push({day,c,index});
  }
  const result=await mapBounded(tasks,async({day,c,index})=>{
   try{
    const data=await fetchFinMind(token,{dataset:stockMode?"TaiwanStockKBar":"TaiwanFuturesKBar",data_id:c.code,start_date:day});
    const parsed=stockMode?filterUnderlyingStockBars(data,c.stock,day,c):filterStockFutureBars(data,c.code,day,c);
    const bytes=await zip(parsed.csv);
    const obj=this.shardFor(s,c.code),resp=await obj.fetch(new Request("https://private/put?date="+day+(s.mode==="all-stocks"?"&ttl=120":""),{method:"POST",body:bytes}));
    if(!resp.ok)throw Error("雲端儲存失敗："+resp.status);
    return {day,c,index,success:true,...parsed.audit}
   }catch(e){return {day,c,index,success:false,error:String(e.message||e).slice(0,180),status:Number(e.code||0)}}
  },stockMode?STOCK_MINUTE_CONCURRENCY:4);
  spend(tasks.length,started);
  const firstFailed=result.find(x=>!x.success),failIndex=firstFailed?result.indexOf(firstFailed):-1;
  const allowable=firstFailed?skips.filter(x=>x.day<firstFailed.day||x.day===firstFailed.day&&x.index<firstFailed.index):skips;
  s.skipped=(s.skipped||0)+allowable.length;s.processed+=allowable.length;
  const oldRows=s.rows;
  for(let i=0;i<result.length;i++){
   const x=result[i];
   if(x.success&&(!firstFailed||i<failIndex)){
    s.processed++;s.nonempty+=Number(x.rows>0);s.empty+=Number(x.rows===0);s.rows+=x.rows;
    if(!s.recordRowsByStockYear)s.recordRowsByStockYear={};
    const rowKey=x.c.code+"-"+x.day.slice(0,4);
    s.recordRowsByStockYear[rowKey]=(s.recordRowsByStockYear[rowKey]||0)+x.rows;
    s.night+=x.night;s.duplicates+=x.duplicates;
    s.rejected+=x.rejectedProduct+x.rejectedContract+x.rejectedInvalid;s.excludedFarMonth+=x.rejectedFarMonth;
   }
   if(!x.success){s.errors.push({day:x.day,code:x.c.code,error:x.error})}
  }
  s.errors=s.errors.slice(-100);
  // Recent 10-minute effective throughput, not synthetic theoretical speed.
  if(stockMode){
   if(!Array.isArray(s.speedSamples))s.speedSamples=[];
   s.speedSamples.push([Date.now(),s.rows]);
   s.speedSamples=s.speedSamples.filter(x=>x[0]>=Date.now()-600000).slice(-200);
   const first=s.speedSamples[0],delta=Date.now()-first[0];
   if(delta>15000)s.barRatePerHour=Math.max(0,Math.round((s.rows-first[1])*3600000/delta));
  }
  if(firstFailed){
   s.date=firstFailed.day;s.symbolIndex=firstFailed.index;
   s.retries++;
   if([401,402,403,429].includes(firstFailed.status)||s.retries>=5){
    s.phase="error";s.lastError=firstFailed.error;
    s.message="FinMind 失敗／可能已到 API 額度，已停止，請檢查後再繼續";
   }else s.message="FinMind 暫時失敗，雲端退避重試";
  }else{
   s.retries=0;
   s.message="已完成 "+s.processed+"/"+s.total+" 個股票／日期，其中 "+(s.skipped||0)+" 個無需 API；新增 "+(s.rows-oldRows)+" 根 1 分K";
  }
  if(s.date>s.end&&s.phase==="running"){s.phase="done";s.message="歷史檔下載完成；請備份年度 CSV.gz"}
  await commit(firstFailed?Math.min(300000,15000*2**s.retries):0)
 }
 async alarmDaily(s,token,st){
  // Stay below Cloudflare's outbound-subrequest ceiling for 27 years × 1 stock.
  const yearCount=Number(s.end.slice(0,4))-Number(s.start.slice(0,4))+1;
  const researchMode=s.mode==="daily-research"||s.mode==="all-daily-research",chipMode=s.mode==="daily-chip"||s.mode==="all-daily-chip"||researchMode;
  const batchSize=Math.min(STOCK_MAX_PARALLEL,Math.max(1,Math.floor(40/yearCount)));
  const from=s.symbolIndex||0,stocks=s.catalog.slice(from,from+batchSize);
  if(!stocks.length){
   s.phase="done";s.message="日 K 下載完成，請備份 CSV.gz";
   await st.put("state",s);await st.setAlarm(s.expiresAt);return
  }
  const started=Date.now();
  const result=await Promise.all(stocks.map(async c=>{
   try{
    let calls=0;
    try{
     // Fetch multiple independent datasets/windows concurrently; preserve chronological order.
     const sources=[{key:"price",dataset:"TaiwanStockPrice",earliest:s.start,id:c.code}];
     if(chipMode){
      sources.push({key:"institutional",dataset:"TaiwanStockInstitutionalInvestorsBuySell",earliest:"2005-01-01",id:c.code},
       {key:"margin",dataset:"TaiwanStockMarginPurchaseShortSale",earliest:"2001-01-01",id:c.code});
      if(researchMode){
       sources.push({key:"holding",dataset:"TaiwanStockShareholding",earliest:"2004-02-01",id:c.code},
        {key:"lending",dataset:"TaiwanStockSecuritiesLending",earliest:"2001-05-01",id:c.code});
       const codes=[...new Set(c.futureCodes?.length?c.futureCodes:[c.futureCode])].filter(x=>/^[A-Z]{2}F$/.test(x));
       for(const id of codes)sources.push({key:"futures",dataset:"TaiwanFuturesDaily",earliest:"2010-01-01",id})
      }
     }
     const tasks=sources.flatMap(src=>s.end<src.earliest?[]:
      dailyPriceWindows(s.start<src.earliest?src.earliest:s.start,s.end,researchMode?12:8)
       .map(w=>({...src,from:w.start,to:w.end}))
     );
     const parts=await mapBounded(tasks,async item=>{
      calls++;
      return fetchFinMind(token,{dataset:item.dataset,data_id:item.id,start_date:item.from,end_date:item.to})
     },5);
     const grouped={price:[],institutional:[],margin:[],holding:[],lending:[],futures:[]};
     for(let i=0;i<tasks.length;i++)grouped[tasks[i].key].push(...parts[i]);
     const parsed=filterUnderlyingDailyBars(grouped.price,c.stock,s.start,s.end,c);
     let merged=null;
     if(chipMode){
      merged=joinDailyChipRows(parsed,grouped.institutional,grouped.margin,c.stock,s.start,s.end);
      if(researchMode){
       const codes=[...new Set(c.futureCodes?.length?c.futureCodes:[c.futureCode])].filter(x=>/^[A-Z]{2}F$/.test(x));
       merged=joinResearchRows(parsed,merged,grouped.holding,grouped.lending,grouped.futures,
        c.stock,s.start,s.end,codes,c.futureCode)
      }
     }
     const shard=this.shardFor(s,c.code);
     const years=Array.from({length:Number(s.end.slice(0,4))-Number(s.start.slice(0,4))+1},
      (_,i)=>Number(s.start.slice(0,4))+i);
     await mapBounded(years,async year=>{
      const payload=await zip((chipMode?merged.csvByYear:parsed.csvByYear)[String(year)]||"");
      const response=await shard.fetch(new Request("https://private/put?date="+year+"-01-01"+(s.mode.startsWith("all-")?"&ttl=120":""),
       {method:"POST",body:payload}));
      if(!response.ok)throw Error("年份 "+year+" 雲端存檔失敗："+response.status)
     },4);
     return {ok:true,c,calls,coverage:merged?.coverage||null,rowsByYear:Object.fromEntries(
       Array.from({length:Number(s.end.slice(0,4))-Number(s.start.slice(0,4))+1},(_,i)=>{
        const year=String(Number(s.start.slice(0,4))+i),text=parsed.csvByYear[year]||"";
        return [year,text?text.trimEnd().split("\n").length:0];
       })
      ),rows:parsed.audit.rows,nonempty:Number(parsed.audit.rows>0),empty:Number(parsed.audit.rows===0),
      rejected:parsed.audit.rejectedInvalid+parsed.audit.rejectedProduct,duplicates:parsed.audit.duplicates};
    }catch(e){return {ok:false,c,calls,error:String(e.message||e).slice(0,180),code:Number(e.code||0)}}
   }catch(e){return {ok:false,c,calls:0,error:String(e.message||e).slice(0,180),code:Number(e.code||0)}}
  }));
  const attempts=result.reduce((sum,x)=>sum+(x.calls||0),0);
  s.queries+=attempts;
  s.nextAllowedAt=Math.max(started,s.nextAllowedAt||0)+attempts*STOCK_REQUEST_SPACING_MS;
  const firstFailure=result.findIndex(x=>!x.ok);
  for(let i=0;i<result.length;i++){
   const x=result[i];
   if(x.ok&&(firstFailure<0||i<firstFailure)){
    s.processed++;s.rows+=x.rows;s.nonempty+=x.nonempty;s.empty+=x.empty;
    if(!s.recordRowsByStockYear)s.recordRowsByStockYear={};
    for(const [year,rows] of Object.entries(x.rowsByYear||{}))
     s.recordRowsByStockYear[x.c.code+"-"+year]=rows;
    s.rejected+=x.rejected;s.duplicates+=x.duplicates;
    if(x.coverage){
     if(!s.chipCoverage)s.chipCoverage={institutional:0,margin:0,both:0,missingInstitutional:0,missingMargin:0};
     for(const [name,count] of Object.entries(x.coverage))s.chipCoverage[name]=(s.chipCoverage[name]||0)+count;
    }
   }
   if(!x.ok)s.errors.push({day:"multi-year",code:x.c.code,error:x.error});
  }
  s.errors=s.errors.slice(-100);
  if(firstFailure>=0){
   const failed=result[firstFailure];
   s.symbolIndex=from+firstFailure;s.retries++;
   if([401,402,403,429].includes(failed.code)||s.retries>=5){
    s.phase="error";s.lastError=failed.error;s.message="日 K API 失敗，已保留已完成股票，請檢查額度並按繼續";
   }else s.message="日 K 上游暫時失敗，稍後自動重試";
  }else{
   s.symbolIndex=from+stocks.length;s.retries=0;
   s.message=(researchMode?"日K＋完整研究資料":chipMode?"日K＋三大法人＋融資融券":"日K")+" 已完成 "+s.processed+"/"+s.total+" 檔股票，共 "+s.rows+" 根（每 8 年分段查詢）";
  }
  if(s.symbolIndex>=s.catalog.length&&s.phase==="running"){
   s.phase="done";s.message=(researchMode?"日K＋完整研究資料":chipMode?"日K＋法人＋融資融券":"日K")+" 已完成 "+s.processed+" 檔股票、"+s.rows+" 根，請下載年度 CSV.gz";
  }
  const latest=await st.get("state");
  if(!latest||latest.shardKey!==s.shardKey)return;
  if(latest.phase==="paused")s.phase="paused";
  if(latest.phase==="error"&&s.phase==="running")s.phase="error";
  updateApiTelemetry(s);
  s.updatedAt=Date.now();await st.put("state",s);
  await st.setAlarm(s.phase==="running"?Math.max(Date.now()+150,s.nextAllowedAt,firstFailure>=0?Date.now()+Math.min(300000,15000*2**s.retries):0):s.expiresAt)
 }

 async alarmMarketChip(s,job,st){
  // Only add the missing datasets. Raw price history (the original price
  // shards, merge archive and share key) is never overwritten here.
  if(s.phase!=="done"||s.processed!==s.total){
   job.phase="error";job.error="股價任務尚未完成或狀態已改變";
   await st.put(CHIP_JOB_KEY,job);await st.setAlarm(s.expiresAt);return
  }
  if(job.processed>=job.total){
   await this.completeMarketChip(s,job,st);return
  }
  const token=String(await st.get("token")||"").trim();
  if(!token){
   job.phase="error";job.error="FinMind Token 不存在，請在網頁輸入並繼續";
   await st.put(CHIP_JOB_KEY,job);await st.setAlarm(s.expiresAt);return
  }
  const current=s.catalog[job.processed],code=current?.code;
  if(!/^[0-9]{4}$/.test(String(code||""))){
   job.phase="error";job.error="商品清單中有無效股票代號";
   await st.put(CHIP_JOB_KEY,job);await st.setAlarm(s.expiresAt);return
  }
  const requestedAt=Date.now(),startYear=Number(s.start.slice(0,4)),endYear=Number(s.end.slice(0,4));
  let calls=0;
  try{
   const collect=async dataset=>{
    const items=[];
    for(const w of dailyPriceWindows(s.start,s.end)){
     calls++;
     const values=await fetchFinMind(token,{dataset,data_id:code,start_date:w.start,end_date:w.end});
     items.push(...values);
    }
    return items
   };
   const institutional=await collect("TaiwanStockInstitutionalInvestorsBuySell");
   const margin=await collect("TaiwanStockMarginPurchaseShortSale");
   const shard=this.shardFor(s,code),totalStats={
    priceRows:0,institutionalRows:0,marginRows:0,bothRows:0,missingInstitutional:0,missingMargin:0
   };
   for(let year=startYear;year<=endYear;year++){
    const yy=String(year),day=yy+"-01-01";
    // Each year is exactly one original GZIP member (not a concatenation).
    // Decompress locally in the Cloudflare worker, then left join by stock/date.
    const source=await shard.fetch("https://private/get?"+new URLSearchParams({start:day,end:day}));
    if(!source.ok||!source.body)throw Error("找不到原始股票日K："+code+" "+yy);
    const plain=await new Response(source.body.pipeThrough(new DecompressionStream("gzip"))).text();
    const price=priceRowsFromText(plain,code,yy);
    const joined=joinDailyChipRows(price,institutional,margin,code,s.start,s.end);
    const stats=chipSnapshot(joined,price.records.length);
    for(const k of Object.keys(totalStats))totalStats[k]+=stats[k]||0;
    const compressed=await zip(joined.csvByYear[yy]||"");
    const saved=await shard.fetch(new Request("https://private/put-chip?date="+day,{
     method:"POST",body:compressed
    }));
    if(!saved.ok)throw Error("籌碼合併存檔失敗："+code+" "+yy+"（HTTP "+saved.status+"）");
   }
   // Only advance after every year's enriched CSV has been committed.
   const latest=await st.get(CHIP_JOB_KEY);
   if(!latest||latest.processed!==job.processed)return;
   for(const [k,v] of Object.entries(totalStats))job[k]=(job[k]||0)+v;
   job.processed++;job.queries+=calls;job.retryCount=0;job.error="";job.lastCode=code;
   job.updatedAt=Date.now();
   job.nextAllowedAt=Math.max(requestedAt,job.nextAllowedAt||0)+calls*CHIP_RATE_SPACING_MS;
   job.message="已補 "+job.processed+"/"+job.total+" 檔；法人與融資券已併入獨立壓縮檔。";
   if(latest.phase==="paused"){job.phase="paused";job.message="已暫停；這一檔已安全完成存檔"}
   if(job.processed>=job.total&&job.phase==="running"){
    await this.completeMarketChip(s,job,st);return
   }
   await st.put(CHIP_JOB_KEY,job);
   await st.setAlarm(job.phase==="running"?Math.max(Date.now()+150,job.nextAllowedAt):s.expiresAt);
  }catch(e){
   const latest=await st.get(CHIP_JOB_KEY);
   if(!latest||latest.processed!==job.processed)return;
   const codeNum=Number(e.code||0),str=String(e.message||e).slice(0,250);
   job.retryCount=(job.retryCount||0)+1;job.queries+=calls;
   job.error=code+"："+str;job.updatedAt=Date.now();
   job.nextAllowedAt=Math.max(requestedAt,job.nextAllowedAt||0)+calls*CHIP_RATE_SPACING_MS;
   const authFail=[400,401,402,403,429].includes(codeNum);
   if(authFail||job.retryCount>=5){
    job.phase="error";
    job.message="FinMind 權限、額度或儲存錯誤；已停止且保留已完成籌碼及全部原始日K。";
   }else job.message="籌碼暫時讀取失敗，保留進度並自動退避重試";
   await st.put(CHIP_JOB_KEY,job);
   await st.setAlarm(job.phase==="running"?Math.max(job.nextAllowedAt,Date.now()+Math.min(300000,15000*2**job.retryCount)):s.expiresAt);
  }
 }
 async completeMarketChip(s,job,st){
  job.phase="done";job.error="";job.updatedAt=Date.now();
  job.message="全部股票籌碼已補完；開始雲端背景合併成單一股價＋法人＋資券 CSV.GZ";
  await st.put(CHIP_JOB_KEY,job);
  // Keep the preexisting price-only merged archive and readonly links intact.
  const old=await st.get(CHIP_MERGE_KEY);
  if(old?.phase==="done"){await st.setAlarm(s.expiresAt);return}
  const now=Date.now(),header=await zip(CHIP_COLUMNS);
  await st.put(CHIP_MERGE_KEY+":header",header);
  await st.delete(CHIP_MERGE_KEY+":share");
  const merged={phase:"running",processed:old?.processed||0,total:s.catalog.length,
   bytes:old?.bytes||header.byteLength,retryCount:0,error:"",
   startedAt:old?.startedAt||now,updatedAt:now,completedAt:null,
   message:"股價＋籌碼合併已排入雲端背景工作，無需開著手機"};
  await st.put(CHIP_MERGE_KEY,merged);await st.setAlarm(Date.now()+100)
 }

 // Existing daily K bars are already compressed by year and symbol.
 // Cloudflare alarms copy their GZIP members into this job's private SQLite
 // storage, using small durable chunks. No FinMind / browser requests.
 async alarmMerge(s,merge,st,kind="price"){
  const enriched=kind==="chip",pref=enriched?CHIP_MERGE_KEY:"merge";
  const begin=merge.processed||0,limit=Math.min(merge.total,begin+MERGE_STOCKS_PER_ALARM);
  const startYear=Number(s.start.slice(0,4)),endYear=Number(s.end.slice(0,4));
  for(let i=begin;i<limit;i++){
   const symbol=s.catalog[i]?.code;
   if(!symbol){merge.phase="error";merge.error="股票清單發生變更";break}
   let part=0,stockBytes=0,reader=null;
   try{
    const shard=this.shardFor(s,symbol);
    const response=await shard.fetch("https://private/"+(enriched?"get-chip-years":"get-years")+"?"+new URLSearchParams({startYear,endYear}));
    if(!response.ok||!response.body)throw Error(symbol+" 雲端歷史資料無法開啟");
    reader=response.body.getReader();
    let first=null,second=null;
    for(;;){
     const next=await reader.read();
     if(next.done)break;
     const bytes=next.value;
     if(!bytes?.byteLength)continue;
     // DO get-years sends genuine GZIP streams; fail closed on malformed input.
     if(first===null){first=bytes[0];if(bytes.byteLength>1)second=bytes[1]}
     else if(second===null)second=bytes[0];
     for(let offset=0;offset<bytes.byteLength;offset+=MERGE_STORAGE_CHUNK){
      const slice=bytes.slice(offset,Math.min(bytes.byteLength,offset+MERGE_STORAGE_CHUNK));
      await st.put(pref+":blob:"+i+":"+(part++),slice);
      stockBytes+=slice.byteLength;
     }
    }
    if(first!==31||second!==139||stockBytes<20)throw Error(symbol+" GZIP 檔頭不合法或資料缺失");
    // Commit per-stock metadata LAST so an interrupted alarm cannot mark
    // incomplete chunks as successful. Re-running overwrites the same keys.
    await st.put(pref+":meta:"+i,{parts:part,bytes:stockBytes,code:symbol});
    merge.processed=i+1;merge.bytes+=stockBytes;merge.retryCount=0;merge.error="";
    merge.updatedAt=Date.now();
    merge.message="雲端背景合併 "+merge.processed+"/"+merge.total+" 檔，大小 "+Math.round(merge.bytes/1024/1024)+" MB";
    await st.put(pref,merge);
   }catch(e){
    // Abort this stock's uncommitted chunk set; prior stocks remain intact.
    for(let j=0;j<part;j++)await st.delete(pref+":blob:"+i+":"+j);
    await st.delete(pref+":meta:"+i);
    merge.retryCount=(merge.retryCount||0)+1;
    merge.error=String(e.message||e).slice(0,250);
    merge.updatedAt=Date.now();
    merge.message="第 "+(i+1)+" 檔股票 "+symbol+" 合併失敗："+merge.error;
    if(merge.retryCount>=5)merge.phase="error";
    await st.put(pref,merge);
    await st.setAlarm(merge.phase==="running"?Date.now()+Math.min(300000,12000*2**merge.retryCount):s.expiresAt);
    return
   }finally{try{reader?.releaseLock()}catch{}}
  }
  if(merge.phase!=="error"&&merge.processed>=merge.total){
   merge.phase="done";merge.completedAt=Date.now();merge.updatedAt=Date.now();
   merge.message="雲端合併完成：共 "+merge.total+" 檔，已保存單一 GZIP 檔案";
  }
  await st.put(pref,merge);
  await st.setAlarm(merge.phase==="running"?Date.now()+1000:s.expiresAt);
 }
 async exportMerged(s,st,kind="price"){
  const enriched=kind==="chip",pref=enriched?CHIP_MERGE_KEY:"merge";
  const merge=await st.get(pref);
  if(!merge||merge.phase!=="done"||merge.processed!==s.catalog.length)
   return respond({ok:false,error:"完整日K雲端合併尚未完成"},409);
  const header=await st.get(pref+":header");
  if(!header?.byteLength)return respond({ok:false,error:"雲端合併缺少CSV標題"},500);
  let index=-1,chunk=0,meta=null;
  const stream=new ReadableStream({async pull(controller){
   try{
    if(index===-1){index=0;controller.enqueue(new Uint8Array(header));return}
    for(;;){
     if(index>=merge.total){controller.close();return}
     if(!meta){
      meta=await st.get(pref+":meta:"+index);
      if(!meta||meta.code!==s.catalog[index]?.code||!Number.isSafeInteger(meta.parts)||meta.parts<1)
       throw Error("雲端合併索引缺失（第 "+(index+1)+" 檔）");
      chunk=0;
     }
     if(chunk>=meta.parts){index++;meta=null;continue}
     const bytes=await st.get(pref+":blob:"+index+":"+(chunk++));
     if(!bytes?.byteLength)throw Error("雲端合併壓縮資料損毀（第 "+(index+1)+" 檔）");
     controller.enqueue(new Uint8Array(bytes));return
    }
   }catch(e){controller.error(e)}
  }});
  const filename=MERGE_NAME+s.start.replaceAll("-","")+"_"+s.end.replaceAll("-","")+
   (enriched?"_WITH_INSTITUTIONAL_MARGIN.csv.gz":"_ALL.csv.gz");
  return new Response(stream,{headers:{
   "content-type":"application/gzip",
   "content-disposition":'attachment; filename="'+filename+'"',
   "content-length":String(merge.bytes),
   "cache-control":"private, no-store","x-content-type-options":"nosniff"
  }});
 }

 async exportDailyData(s,url){
  if(!["running","paused","done","error"].includes(s.phase))return respond({ok:false,error:"任務尚不可匯出"},400);
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"",
   requestedCodes=url.searchParams.get("codes")||"",whole=url.searchParams.get("all")==="1"&&s.mode==="market-daily";
  const selectedCodes=requestedCodes?requestedCodes.split(","):[];
  if(selectedCodes.length>75||selectedCodes.some(x=>!/^[0-9]{4}$/.test(x))||
    new Set(selectedCodes).size!==selectedCodes.length||code&&selectedCodes.length)
   return respond({ok:false,error:"ZIP 股票分包清單錯誤"},400);
  const enriched=s.mode==="market-daily"&&url.searchParams.get("chip")==="1";
  if(enriched&&(await this.ctx.storage.get(CHIP_JOB_KEY))?.phase!=="done")
   return respond({ok:false,error:"法人與融資券資料仍在背景補抓"},409);
  if(whole&&(s.phase!=="done"||code||year))return respond({ok:false,error:"完整日K匯出只允許已完成的全市場任務"},409);
  if(code&&!s.catalog.some(c=>c.code===code))return respond({ok:false,error:"股票不在任務清單內"},404);
  if(year&&(!/^\d{4}$/.test(year)||year<s.start.slice(0,4)||year>s.end.slice(0,4)))return respond({ok:false,error:"年份超出任務範圍"},400);
  if(!code&&!year&&!whole)return respond({ok:false,error:"請選年度或股票代碼以避免下載過大"},400);
  const partText=url.searchParams.get("part")||"",part=partText?Number(partText):0;
  if(s.mode==="market-daily"&&!code&&(!year||!part)&&!whole)return respond({ok:false,error:"全市場日K請依年份＋每250檔分包下載"},400);
  if(whole&&(!part||!Number.isInteger(part)))return respond({ok:false,error:"必須指定分包編號"},400);
  if(part&&(!Number.isSafeInteger(part)||part<1||part>Math.ceil(s.catalog.length/MARKET_EXPORT_PART_SIZE)))return respond({ok:false,error:"分包序號錯誤"},400);
  const valid=new Set(s.catalog.map(c=>c.code));
  if(selectedCodes.some(c=>!valid.has(c)))return respond({ok:false,error:"ZIP 含非本次任務股票"},400);
  const codes=selectedCodes.length?selectedCodes:code?[code]:
   part?s.catalog.slice((part-1)*MARKET_EXPORT_PART_SIZE,part*MARKET_EXPORT_PART_SIZE).map(c=>c.code):s.catalog.map(c=>c.code);
  const first=Number(s.start.slice(0,4)),last=Number(s.end.slice(0,4));
  const years=year?[Number(year)]:Array.from({length:last-first+1},(_,i)=>first+i);
  const segments=whole?codes.map(stock=>({stock,whole:true})):codes.flatMap(stock=>years.map(y=>({stock,day:y+"-01-01"})));
  // Only part 1 contains the CSV header. GZIP concatenated members form a
  // standards-valid single .gz when the browser appends all parts verbatim.
  const withHeader=!whole||part===1;
  const self=this,head=withHeader?await zip(["daily-research","all-daily-research"].includes(s.mode)?DAILY_HDR.trimEnd()+","+CHIP_HDR.trimEnd()+","+RESEARCH_HDR:["daily-chip","all-daily-chip"].includes(s.mode)?DAILY_HDR.trimEnd()+","+CHIP_HDR:s.mode==="market-daily"?(enriched?CHIP_COLUMNS:MARKET_HDR):DAILY_HDR):null;
  let ix=-1,reader=null;
  const stream=new ReadableStream({async pull(c){
   try{
    if(ix<0){ix=0;if(head){c.enqueue(head);return}}
    for(;;){
     if(reader){
      const n=await reader.read();
      if(!n.done){c.enqueue(n.value);return}
      reader=null
     }
     if(ix>=segments.length){c.close();return}
     const segment=segments[ix++],shard=self.shardFor(s,segment.stock);
     // Year-specific key, no iteration over calendar dates.
     const response=await shard.fetch(whole
      ?"https://private/"+(enriched?"get-chip-years":"get-years")+"?"+new URLSearchParams({startYear:String(first),endYear:String(last)})
      :"https://private/"+(enriched?"get-chip":"get")+"?"+new URLSearchParams({start:segment.day,end:segment.day}));
     if(!response.ok)throw Error(segment.stock+" "+segment.day+" 匯出失敗");
     reader=response.body.getReader()
    }
   }catch(e){c.error(e)}
  }});
  const name=s.mode==="market-daily"?"FinMind_All_TWSE_TPEX_Daily_"+(year||s.start+"_"+s.end)+"_"+(code||"part"+String(part).padStart(2,"0"))+(enriched?"_WITH_INSTITUTIONAL_MARGIN":"")+".csv.gz":"FinMind_FuturesEligibleStocks_"+(["daily-research","all-daily-research"].includes(s.mode)?"Daily_Research_":["daily-chip","all-daily-chip"].includes(s.mode)?"Daily_Chips_":"Daily_")+(code||"ALL")+"_"+(year||s.start+"_"+s.end)+".csv.gz";
  return new Response(stream,{headers:{"content-type":"application/gzip","content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
 async exportData(s,url){
  if(["daily","daily-chip","daily-research","market-daily","all-daily","all-daily-chip","all-daily-research"].includes(s.mode))return this.exportDailyData(s,url);
  if(!["running","paused","done","error","expired"].includes(s.phase))return respond({ok:false,error:"任務尚不可匯出"},400);
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"",
   requestedCodes=url.searchParams.get("codes")||"";
  const selectedCodes=requestedCodes?requestedCodes.split(","):[];
  if(selectedCodes.length>75||selectedCodes.some(x=>!/^[0-9]{4}$/.test(x))||
   new Set(selectedCodes).size!==selectedCodes.length||code&&selectedCodes.length||
   selectedCodes.some(c=>!s.catalog.some(x=>x.code===c)))
   return respond({ok:false,error:"ZIP 股票分包清單錯誤"},400);
  if(code&&!s.catalog.some(c=>c.code===code))return respond({ok:false,error:"商品不在本次任務清單內"},404);
  if(year&&(!/^\d{4}$/.test(year)||year<s.start.slice(0,4)||year>s.end.slice(0,4)))return respond({ok:false,error:"年份不在範圍內"},400);
  if(!code&&!year)return respond({ok:false,error:"請選年度或股票代碼，避免手機下載巨型檔案"},400);
  const first=year&&year+"-01-01">s.start?year+"-01-01":s.start,last=year&&year+"-12-31"<s.end?year+"-12-31":s.end;
  const codes=selectedCodes.length?selectedCodes.map(c=>s.catalog.find(x=>x.code===c)):code?[s.catalog.find(c=>c.code===code)]:s.catalog;
  const self=this,head=await zip(["stocks","all-stocks"].includes(s.mode)?STOCK_HDR:HDR);let ci=-1,reader=null;
  const stream=new ReadableStream({async pull(c){
   try{
    if(ci<0){ci=0;c.enqueue(head);return}
    for(;;){
     if(reader){
      const next=await reader.read();if(!next.done){c.enqueue(next.value);return}
      reader=null
     }
     if(ci>=codes.length){c.close();return}
     const symbol=codes[ci++].code,shard=self.shardFor(s,symbol);
     const response=await shard.fetch("https://private/get?"+new URLSearchParams({start:first,end:last}));
     if(!response.ok)throw Error(symbol+" 資料匯出失敗");
     reader=response.body.getReader()
    }
   }catch(e){c.error(e)}
  }});
  const name=(s.mode==="all-stocks"?"FinMind_All_TWSE_TPEX_1min_":s.mode==="stocks"?"FinMind_FuturesEligibleStocks_1min_":"FinMind_StockFutures_1min_")+(code||"ALL")+"_"+(year||s.start+"_"+s.end)+".csv.gz";
  return new Response(stream,{headers:{"content-type":"application/gzip","content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
}