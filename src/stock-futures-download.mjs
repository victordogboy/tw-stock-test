// Isolated all-STOCK-futures minute-bar service. No TX code or storage is shared.
const DAY=86400000, COOKIE="__Host-sf5y", HDR="date,minute,session,futures_id,underlying_stock,contract_size,contract_date,open,high,low,close,volume\n";
const respond=(v,status=200,h={})=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}});
const dateOk=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||"")&&new Date(s).toISOString().slice(0,10)===s;
const next=s=>new Date(Date.parse(s)+DAY).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const dayOf=s=>new Date(s+"T12:00:00Z").getUTCDay();
const cookie=r=>(r.headers.get("cookie")||"").split(";").map(s=>s.trim()).find(s=>s.startsWith(COOKIE+"="))?.slice(COOKIE.length+1)||"";
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
export function filterStockFutureBars(list,symbol,date,meta){
 if(!Array.isArray(list))throw Error("FinMind 格式錯誤：未取得 K 棒陣列");
 const seen=new Map(),items=[],audit={rows:0,day:0,night:0,rawVolume:0,rejectedProduct:0,rejectedContract:0,rejectedInvalid:0,duplicates:0};
 for(const r of list){
  if(String(r?.futures_id||"").trim()!==symbol){audit.rejectedProduct++;continue}
  const contract=String(r.contract_date||"").trim(),minute=String(r.minute||"").trim(),d=String(r.date||"").slice(0,10);
  if(!/^\d{6}$/.test(contract)||+contract.slice(4)<1||+contract.slice(4)>12){audit.rejectedContract++;continue}
  const m=/^(\d{2}):(\d{2}):(\d{2})$/.exec(minute);
  if(!m||d!==date||+m[1]>23||+m[2]>59||+m[3]>59){audit.rejectedInvalid++;continue}
  const clock=+m[1]*60+(+m[2]),day=clock>=525&&clock<=825,night=clock>=1045||clock<=300;
  if(!day&&!night){audit.rejectedInvalid++;continue}
  if(night&&!meta.night){audit.rejectedInvalid++;continue}
  const v=Number(r.volume),prices=[r.open,r.high,r.low,r.close].map(Number);
  if(!Number.isSafeInteger(v)||v<0||!prices.every(z=>Number.isFinite(z)&&z>0)||prices[1]<Math.max(prices[0],prices[3])||prices[2]>Math.min(prices[0],prices[3])){audit.rejectedInvalid++;continue}
  const key=contract+"|"+minute,signature=prices.join(",")+","+v;
  if(seen.has(key)){if(seen.get(key)!==signature)throw Error("同分鐘、同月份期貨 OHLC/成交量相互矛盾");audit.duplicates++;continue}
  seen.set(key,signature);audit.rows++;audit.rawVolume+=v;
  if(day)audit.day++;else audit.night++;
  items.push({key:minute+"|"+contract,line:[d,minute,day?"day":"night",symbol,meta.stock,meta.units,contract,...prices,v].map(column).join(",")+"\n"});
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
export async function stockFuturesRoute(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!env.STOCK_FUTURES_BATCH||!env.STOCK_FUTURES_DATA)return respond({ok:false,error:"個股期貨雲端背景服務尚未部署"},503);
 if(!["GET","POST"].includes(method))return respond({ok:false,error:"不支援此方法"},405);
 if(method==="POST"&&request.headers.get("origin")&&request.headers.get("origin")!==url.origin)return respond({ok:false,error:"來源不符"},403);
 const id=cookie(request),known=/^[a-f0-9]{64}$/.test(id);
 if(path==="/api/stock-futures/catalog"&&method==="GET"){
  try{
   const r=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error("TAIFEX HTTP "+r.status);
   const catalog=parseStockFutureUniverse(await r.text());
   return respond({ok:true,source:"TAIFEX 股票期貨/選擇權交易標的",asOf:new Date().toISOString(),count:catalog.length,catalog});
  }catch(e){return respond({ok:false,error:"取得期交所個股期貨商品清單失敗："+e.message},502)}
 }
 if(path==="/api/stock-futures/start"&&method==="POST"){
  const token=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(token.length<5||token.length>4096||/[\r\n]/.test(token))return respond({ok:false,error:"請使用原本個股分析的 FinMind Sponsor Token"},401);
  const body=await request.text();if(body.length>14000)return respond({ok:false,error:"參數長度過大"},400);
  let args;try{args=JSON.parse(body)}catch{return respond({ok:false,error:"設定格式錯誤"},400)}
  if(!dateOk(args.start)||!dateOk(args.end)||args.start<"2021-01-01"||args.end>today()||args.start>args.end)return respond({ok:false,error:"日期必須在 2021/01/01 至今天"},400);
  const resId=known?id:randomId(),stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(resId));
  const data=await stub.fetch(new Request("https://private/start",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({start:args.start,end:args.end,codes:args.codes||[],reset:args.reset===true})}));
  return new Response(data.body,{status:data.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":COOKIE+"="+resId+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000"}});
 }
 if(!known)return respond({ok:false,error:"沒有這個瀏覽器的下載工作；請先按開始"},401);
 const stub=env.STOCK_FUTURES_BATCH.get(env.STOCK_FUTURES_BATCH.idFromName(id));
 if(path==="/api/stock-futures/status"&&method==="GET")return stub.fetch("https://private/status");
 if(path==="/api/stock-futures/export"&&method==="GET"){
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"";
  if(code&&!/^[A-Z]{2}F$/.test(code)||year&&!/^(202[1-9]|20[3-9]\d)$/.test(year))return respond({ok:false,error:"下載範圍錯誤"},400);
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
export class StockFuturesBatch{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 summary(s){return {ok:true,phase:s.phase,start:s.start,end:s.end,total:s.total,processed:s.processed,queries:s.queries,nonempty:s.nonempty,empty:s.empty,rows:s.rows,night:s.night,duplicates:s.duplicates,rejected:s.rejected,errors:s.errors.slice(-30),codes:s.codes,codeCount:s.catalog.length,currentDate:s.date,currentCode:s.catalog[s.symbolIndex]?.code||null,lastError:s.lastError||"",updatedAt:s.updatedAt,createdAt:s.createdAt,coverage:"TAIFEX 當前標的；歷史終止上市契約可能不在清單內",message:s.message,version:1}}
 shard(code){return this.env.STOCK_FUTURES_DATA.get(this.env.STOCK_FUTURES_DATA.idFromName(code))}
 async fetch(r){
  const p=new URL(r.url).pathname,st=this.ctx.storage;
  if(p==="/start"&&r.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(r.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(!token)return respond({ok:false,error:"沒有 FinMind Token"},401);
   const q=await r.json();let old=await st.get("state");
   if(old&&!q.reset){await st.put("token",token);return respond({...this.summary(old),existing:true})}
   let catalog;
   try{
    const official=await fetch(SOURCE,{headers:{accept:"text/html","user-agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
    if(!official.ok)throw Error("TAIFEX HTTP "+official.status);
    catalog=parseStockFutureUniverse(await official.text());
   }catch(e){return respond({ok:false,error:"不能驗證完整個股期貨商品清單，未啟動下載："+e.message},502)}
   const selected=new Set(Array.isArray(q.codes)?q.codes:[]);
   if(selected.size)catalog=catalog.filter(x=>selected.has(x.code));
   if(!catalog.length)return respond({ok:false,error:"沒有符合的個股期貨"},400);
   if(old&&q.reset){
    // Each private job has its own randomized shard namespace. Old shards expire after 30 days.
    await st.deleteAll()
   }
   const s={phase:"running",shardKey:randomId(),start:q.start,end:q.end,catalog,codes:catalog.map(x=>({code:x.code,name:x.name,stock:x.stock,units:x.units,night:x.night})),date:q.start,symbolIndex:0,total:0,processed:0,queries:0,nonempty:0,empty:0,rows:0,night:0,rejected:0,duplicates:0,retries:0,errors:[],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+30*DAY,message:"已建立雲端任務。以固定速率分批下載，手機可離線"};
   for(let d=q.start;d<=q.end;d=next(d)){const w=dayOf(d);if(w===0)continue;for(const c of catalog)if(w!==6||c.night)s.total++}
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
  if(Date.now()>=s.expiresAt){s.phase="expired";s.message="任務已到期，請先匯出已完成資料";await st.put("state",s);return}
  if(s.phase!=="running"){await st.setAlarm(s.expiresAt);return}
  await st.setAlarm(Date.now()+120000);
  const token=await st.get("token");if(!token){s.phase="error";s.lastError="缺少 Token";await st.put("state",s);return}
  const tasks=[];while(tasks.length<4&&s.date<=s.end){
   const wd=dayOf(s.date),c=s.catalog[s.symbolIndex];
   const day=s.date;
   s.symbolIndex++;if(s.symbolIndex>=s.catalog.length){s.symbolIndex=0;s.date=next(day)}
   if(wd===0||wd===6&&!c.night)continue;
   tasks.push({day,c})
  }
  const result=await Promise.all(tasks.map(async({day,c})=>{
   try{
    const data=await fetchFinMind(token,{dataset:"TaiwanFuturesKBar",data_id:c.code,start_date:day});
    const parsed=filterStockFutureBars(data,c.code,day,c);
    const bytes=await zip(parsed.csv);
    const obj=this.shardFor(s,c.code),resp=await obj.fetch(new Request("https://private/put?date="+day,{method:"POST",body:bytes}));
    if(!resp.ok)throw Error("雲端儲存失敗："+resp.status);
    return {day,c,success:true,...parsed.audit}
   }catch(e){return {day,c,success:false,error:String(e.message||e).slice(0,180),status:Number(e.code||0)}}
  }));
  s.queries+=tasks.length;
  const firstFailure=result.find(x=>!x.success);
  for(let i=0;i<result.length;i++){
   const x=result[i];
   if(x.success&&(!firstFailure||i<result.indexOf(firstFailure))){s.processed++;s.nonempty+=Number(x.rows>0);s.empty+=Number(x.rows===0);s.rows+=x.rows;s.night+=x.night;s.duplicates+=x.duplicates;s.rejected+=x.rejectedProduct+x.rejectedContract+x.rejectedInvalid}
   if(!x.success){s.errors.push({day:x.day,code:x.c.code,error:x.error});s.errors=s.errors.slice(-100)}
  }
  if(firstFailure){
   // Rewind the cursor to the first failing task, and skip already successful chunks via storage
   // instead of silently marking errors as completed.
   s.date=firstFailure.day;s.symbolIndex=s.catalog.findIndex(x=>x.code===firstFailure.c.code);
   s.retries++;
   if([401,402,403].includes(firstFailure.status)||s.retries>=5){s.phase="error";s.lastError=firstFailure.error;s.message="上游失敗；請檢查額度或 Token，然後按繼續"}
   else s.message="FinMind 暫時失敗，雲端正在退避重試"
  }else{s.retries=0;s.message="已檢查 "+s.processed+"/"+s.total+" 個商品／日，累計 "+s.rows+" 根分K"}
  if(s.date>s.end&&s.phase==="running"){s.phase="done";s.message="已完成全清單請求；可按年度下載"}
  s.updatedAt=Date.now();await st.put("state",s);
  await st.setAlarm(s.phase==="running"?Date.now()+(firstFailure?Math.min(300000,15000*2**s.retries):4000):s.expiresAt)
 }
 async exportData(s,url){
  if(!["running","paused","done","error","expired"].includes(s.phase))return respond({ok:false,error:"任務尚不可匯出"},400);
  const code=url.searchParams.get("code")||"",year=url.searchParams.get("year")||"";
  if(code&&!s.catalog.some(c=>c.code===code))return respond({ok:false,error:"商品不在本次任務清單內"},404);
  if(year&&(!/^\d{4}$/.test(year)||year<s.start.slice(0,4)||year>s.end.slice(0,4)))return respond({ok:false,error:"年份不在範圍內"},400);
  if(!code&&!year)return respond({ok:false,error:"請選年度或期貨代碼，避免手機下載巨型檔案"},400);
  const first=year&&year+"-01-01">s.start?year+"-01-01":s.start,last=year&&year+"-12-31"<s.end?year+"-12-31":s.end;
  const codes=code?[s.catalog.find(c=>c.code===code)]:s.catalog;
  const self=this,head=await zip(HDR);let ci=-1,reader=null;
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
  const name="FinMind_StockFutures_1min_"+(code||"ALL")+"_"+(year||s.start+"_"+s.end)+".csv.gz";
  return new Response(stream,{headers:{"content-type":"application/gzip","content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
}