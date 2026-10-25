// Isolated all-STOCK-futures minute-bar service. No TX code or storage is shared.
const DAY=86400000, COOKIE="__Host-sf5y", STOCK_COOKIE="__Host-underlying1m", HDR="date,minute,session,futures_id,underlying_stock,contract_size,contract_date,open,high,low,close,volume\n";
const STOCK_HDR="date,minute,stock_id,stock_name,qualifying_futures_id,open,high,low,close,volume_raw\n";
const STOCK_MAX_PARALLEL=5, STOCK_REQUEST_SPACING_MS=750; // 4,800 calls/h, below Sponsor's 6,000 calls/h cap
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
export async function stockFuturesRoute(request,env,mode="futures"){
 const isStock=mode==="stocks",root=isStock?"/api/stock-kbar":"/api/stock-futures",cookieName=isStock?STOCK_COOKIE:COOKIE;
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!env.STOCK_FUTURES_BATCH||!env.STOCK_FUTURES_DATA)return respond({ok:false,error:"個股期貨雲端背景服務尚未部署"},503);
 if(!["GET","POST"].includes(method))return respond({ok:false,error:"不支援此方法"},405);
 if(method==="POST"&&request.headers.get("origin")&&request.headers.get("origin")!==url.origin)return respond({ok:false,error:"來源不符"},403);
 const id=cookie(request,cookieName),known=/^[a-f0-9]{64}$/.test(id);
 if(path===root+"/catalog"&&method==="GET"){
  try{
   const r=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error("TAIFEX HTTP "+r.status);
   const all=parseStockFutureUniverse(await r.text());
   const selected=preferMiniStockFutures(all);
   const catalog=isStock?selected.map(c=>({code:c.stock,stock:c.stock,name:c.name,futureCode:c.code,units:c.units,night:false})):selected;
   return respond({ok:true,source:"TAIFEX 股票期貨/選擇權交易標的",asOf:new Date().toISOString(),count:catalog.length,rawCount:all.length,miniCount:selected.filter(x=>x.units===100).length,policy:isStock?"unique-underlying-cash-stock":"one-stock-mini-first-nearest-expiry",dataset:isStock?"TaiwanStockKBar":"TaiwanFuturesKBar",catalog});
  }catch(e){return respond({ok:false,error:"取得期交所個股期貨商品清單失敗："+e.message},502)}
 }
 if(path===root+"/start"&&method==="POST"){
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(token.length<5||token.length>4096||/[\r\n]/.test(token))return respond({ok:false,error:"請使用原本個股分析的 FinMind Sponsor Token"},401);
  const body=await request.text();if(body.length>14000)return respond({ok:false,error:"參數長度過大"},400);
  let args;try{args=JSON.parse(body)}catch{return respond({ok:false,error:"設定格式錯誤"},400)}
  if(!dateOk(args.start)||!dateOk(args.end)||args.start<"2021-01-01"||args.end>today()||args.start>args.end)return respond({ok:false,error:"日期必須在 2021/01/01 至今天"},400);
  const resId=known?id:randomId(),stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(resId));
  const data=await stub.fetch(new Request("https://private/start",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({start:args.start,end:args.end,codes:args.codes||[],reset:args.reset===true,mode:isStock?"stocks":"futures"})}));
  return new Response(data.body,{status:data.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":cookieName+"="+resId+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000"}});
 }
 if(!known)return respond({ok:false,error:"沒有這個瀏覽器的下載工作；請先按開始"},401);
 const stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(id));
 if(path===root+"/status"&&method==="GET")return stub.fetch("https://private/status");
 if(path===root+"/export"&&method==="GET"){
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"";
  if(code&&!(isStock?/^[0-9]{4}$/:/^[A-Z]{2}F$/).test(code)||year&&!/^(202[1-9]|20[3-9]\d)$/.test(year))return respond({ok:false,error:"下載範圍錯誤"},400);
  return stub.fetch("https://private/export?"+new URLSearchParams({code,year}));
 }
 if(method==="POST"&&["pause","resume","delete"].includes(path.split("/").at(-1)))return stub.fetch(new Request("https://private/"+path.split("/").at(-1),{method:"POST"}));
 return respond({ok:false,error:"不存在的 API"},404);
}
export class StockFuturesData{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 async fetch(request){
  const u=new URL(request.url),p=u.pathname;
  if(p==="/put"&&request.method==="POST"){
   const day=u.searchParams.get("date");
   if(!dateOk(day))return respond({ok:false,error:"日期錯誤"},400);
   const bytes=new Uint8Array(await request.arrayBuffer());
   if(bytes.byteLength>8*1024*1024)return respond({ok:false,error:"單日原始資料過大"},413);
   const size=500*1024,parts=Math.ceil(bytes.length/size);
   for(let i=0;i<parts;i++)await this.ctx.storage.put("day:"+day+":"+i,bytes.slice(i*size,(i+1)*size));
   await this.ctx.storage.put("meta:"+day,{parts,bytes:bytes.byteLength});
   const expires=Date.now()+30*DAY;
   await this.ctx.storage.put("expiresAt",expires);
   await this.ctx.storage.setAlarm(expires);
   return respond({ok:true});
  }
  if(p==="/get"){
   const start=u.searchParams.get("start"),end=u.searchParams.get("end");
   if(!dateOk(start)||!dateOk(end)||start>end)return respond({ok:false,error:"日期錯誤"},400);
   let d=start,idx=0,part=null;
   const st=this.ctx.storage;
   const stream=new ReadableStream({async pull(c){
    try{
     while(d<=end){
      if(part===null){part=await st.get("meta:"+d);idx=0}
      if(!part||idx>=part.parts){d=next(d);part=null;continue}
      const bytes=await st.get("day:"+d+":"+(idx++));
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
export class StockFuturesBatch{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 summary(s){return {ok:true,rateLimitPerHour:s.mode==="stocks"?4800:null,barRatePerHour:s.barRatePerHour||0,skipped:s.skipped||0,calendarVerified:!!s.calendarVerified,preflightDone:s.preflightIndex||0,preflightTotal:s.mode==="stocks"?s.catalog.length:0,mode:s.mode||"futures",dataset:s.mode==="stocks"?"TaiwanStockKBar":"TaiwanFuturesKBar",phase:s.phase,start:s.start,end:s.end,total:s.total,processed:s.processed,queries:s.queries,nonempty:s.nonempty,empty:s.empty,rows:s.rows,night:s.night,duplicates:s.duplicates,rejected:s.rejected,excludedFarMonth:s.excludedFarMonth||0,errors:s.errors.slice(-30),codes:s.codes,codeCount:s.catalog.length,currentDate:s.date,currentCode:s.catalog[s.symbolIndex]?.code||null,lastError:s.lastError||"",updatedAt:s.updatedAt,createdAt:s.createdAt,coverage:s.mode==="stocks"?"TAIFEX 現行有期貨的普通股標的（每股票一次）；不含已終止掛牌商品":"TAIFEX 當前標的；歷史終止上市契約可能不在清單內；100 股小型優先；近月單一合約",message:s.message,version:s.version||1}}
 shard(code){return this.env.STOCK_FUTURES_DATA.get(this.env.STOCK_FUTURES_DATA.idFromName(code))}
 async fetch(r){
  const p=new URL(r.url).pathname,st=this.ctx.storage;
  if(p==="/start"&&r.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(!token)return respond({ok:false,error:"沒有 FinMind Token"},401);
   const q=await r.json(),stocksMode=q.mode==="stocks";let old=await st.get("state");
   if(old&&!q.reset){await st.put("token",token);return respond({...this.summary(old),existing:true,message:old.version===2?old.message:"這是舊版全月份／大、小合約混用的任務。請先匯出舊資料，再按『重建小型＋近月任務』重抓。",legacy:old.version!==2})}
   let catalog;
   try{
    const official=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
    if(!official.ok)throw Error("TAIFEX HTTP "+official.status);
    const rawCatalog=parseStockFutureUniverse(await official.text());
    const requested=new Set(Array.isArray(q.codes)?q.codes:[]);
    const preferred=preferMiniStockFutures(rawCatalog);
    if(stocksMode){
     catalog=preferred.map(c=>({...c,code:c.stock,futureCode:c.code,night:false}));
     if(requested.size)catalog=catalog.filter(x=>requested.has(x.stock));
    }else{
     catalog=preferred;
     // Legacy futures path still maps big-contract selections to mini contracts.
     if(requested.size){const stocks=new Set(rawCatalog.filter(x=>requested.has(x.code)).map(x=>x.stock));catalog=catalog.filter(x=>stocks.has(x.stock))}
    }
   }catch(e){return respond({ok:false,error:"不能驗證完整個股期貨商品清單，未啟動下載："+e.message},502)}
   if(!catalog.length)return respond({ok:false,error:stocksMode?"沒有符合條件的現股":"沒有符合的個股期貨"},400);
   if(old&&q.reset){
    // Each private job has its own randomized shard namespace. Old shards expire after 30 days.
    await st.deleteAll()
   }
   const s={phase:"running",shardKey:randomId(),start:q.start,end:q.end,catalog,codes:catalog.map(x=>({code:x.code,name:x.name,stock:x.stock,units:x.units,night:x.night,futureCode:x.futureCode||x.code})),date:q.start,symbolIndex:0,mode:stocksMode?"stocks":"futures",version:stocksMode?4:2,total:0,processed:0,queries:0,nonempty:0,empty:0,rows:0,night:0,rejected:0,excludedFarMonth:0,duplicates:0,retries:0,skipped:0,preflightIndex:0,firstDates:{},errors:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+30*DAY,message:stocksMode?"已建立現股 1 分 K 快速雲端任務；先核對交易日與股票掛牌期間，手機可離線":"已建立小型優先、各交易時段近月合約的雲端任務。手機可離線"};
   for(let d=q.start;d<=q.end;d=next(d)){const w=dayOf(d);if(w===0||w===6&&stocksMode)continue;for(const c of catalog)if(w!==6||c.night)s.total++}
   await st.put("token",token);await st.put("state",s);await st.setAlarm(Date.now()+100);
   return respond(this.summary(s),202)
  });
  let s=await st.get("state");if(!s)return respond({ok:false,error:"找不到下載任務"},404);
  if(p==="/status")return respond(this.summary(s));
  if(p==="/export")return this.exportData(s,new URL(r.url));
  if(r.method!=="POST")return respond({ok:false,error:"操作方法錯誤"},405);
  return this.ctx.blockConcurrencyWhile(async()=>{
   s=await st.get("state");
   if(p==="/delete"){
    for(let i=0;i<s.catalog.length;i+=20)await Promise.all(s.catalog.slice(i,i+20).map(c=>this.shardFor(s,c.code).fetch(new Request("https://private/delete",{method:"POST"}))));
    await st.deleteAll();await st.deleteAlarm();return respond({ok:true,deleted:true})
   }
   if(p==="/pause"&&s.phase==="running"){s.phase="paused";s.message="已暫停";await st.put("state",s);await st.setAlarm(s.expiresAt)}
   if(p==="/resume"&&["paused","error"].includes(s.phase)){s.phase="running";s.lastError="";s.retries=0;s.message="繼續下載";await st.put("state",s);await st.setAlarm(Date.now()+100)}
   return respond(this.summary(s))
  })
 }
 shardFor(s,code){return this.env.STOCK_FUTURES_DATA.get(this.env.STOCK_FUTURES_DATA.idFromName(s.shardKey+":"+code))}
 async alarm(){
  const st=this.ctx.storage,s=await st.get("state");if(!s)return;
  if(Date.now()>=s.expiresAt){await st.deleteAll();await st.deleteAlarm();return}
  if(s.phase!=="running"){await st.setAlarm(s.expiresAt);return}
  await st.setAlarm(Date.now()+120000);
  const token=await st.get("token");
  if(!token){s.phase="error";s.lastError="缺少 Token";await st.put("state",s);await st.setAlarm(s.expiresAt);return}
  const stockMode=s.mode==="stocks";
  const commit=async(n,backoff=0)=>{
   const latest=await st.get("state");
   if(!latest||latest.shardKey!==s.shardKey)return;
   if(latest.phase==="paused")s.phase="paused";
   if(latest.phase==="error"&&s.phase==="running")s.phase="error";
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
  const started=Date.now(),batchSize=stockMode?STOCK_MAX_PARALLEL:4;
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
  const result=await Promise.all(tasks.map(async({day,c,index})=>{
   try{
    const data=await fetchFinMind(token,{dataset:stockMode?"TaiwanStockKBar":"TaiwanFuturesKBar",data_id:c.code,start_date:day});
    const parsed=stockMode?filterUnderlyingStockBars(data,c.stock,day,c):filterStockFutureBars(data,c.code,day,c);
    const bytes=await zip(parsed.csv);
    const obj=this.shardFor(s,c.code),resp=await obj.fetch(new Request("https://private/put?date="+day,{method:"POST",body:bytes}));
    if(!resp.ok)throw Error("雲端儲存失敗："+resp.status);
    return {day,c,index,success:true,...parsed.audit}
   }catch(e){return {day,c,index,success:false,error:String(e.message||e).slice(0,180),status:Number(e.code||0)}}
  }));
  spend(tasks.length,started);
  const firstFailed=result.find(x=>!x.success),failIndex=firstFailed?result.indexOf(firstFailed):-1;
  const allowable=firstFailed?skips.filter(x=>x.day<firstFailed.day||x.day===firstFailed.day&&x.index<firstFailed.index):skips;
  s.skipped=(s.skipped||0)+allowable.length;s.processed+=allowable.length;
  const oldRows=s.rows;
  for(let i=0;i<result.length;i++){
   const x=result[i];
   if(x.success&&(!firstFailed||i<failIndex)){
    s.processed++;s.nonempty+=Number(x.rows>0);s.empty+=Number(x.rows===0);s.rows+=x.rows;
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
 async exportData(s,url){
  if(!["running","paused","done","error","expired"].includes(s.phase))return respond({ok:false,error:"任務尚不可匯出"},400);
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"";
  if(code&&!s.catalog.some(c=>c.code===code))return respond({ok:false,error:"商品不在本次任務清單內"},404);
  if(year&&(!/^\d{4}$/.test(year)||year<s.start.slice(0,4)||year>s.end.slice(0,4)))return respond({ok:false,error:"年份不在範圍內"},400);
  if(!code&&!year)return respond({ok:false,error:"請選年度或股票代碼，避免手機下載巨型檔案"},400);
  const first=year&&year+"-01-01">s.start?year+"-01-01":s.start,last=year&&year+"-12-31"<s.end?year+"-12-31":s.end;
  const codes=code?[s.catalog.find(c=>c.code===code)]:s.catalog;
  const self=this,head=await zip(s.mode==="stocks"?STOCK_HDR:HDR);let ci=-1,reader=null;
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
  const name=(s.mode==="stocks"?"FinMind_FuturesEligibleStocks_1min_":"FinMind_StockFutures_1min_")+(code||"ALL")+"_"+(year||s.start+"_"+s.end)+".csv.gz";
  return new Response(stream,{headers:{"content-type":"application/gzip","content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
}