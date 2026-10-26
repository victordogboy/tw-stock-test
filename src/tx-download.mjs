// TX 1-minute K cloud downloader. Individual-use data stays in Durable Object storage.
const J=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}});
const DAY=86400000, CK="__Host-txdownload", H="date,minute,session,futures_id,contract_date,open,high,low,close,volume\n";
// Official FinMind TaiwanFuturesKBar data coverage begins on 2011-01-03.
// TX started in 1998, but this API does not expose 2000-2010 one-minute bars.
export const TX_KBAR_FIRST_DATE="2011-01-03";
export const TX_NIGHT_FIRST_DATE="2017-05-15";
const okdate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s).toISOString().slice(0,10)===s;
const nxt=s=>new Date(Date.parse(s)+DAY).toISOString().slice(0,10);
// Saturday 00:00-05:00 holds the tail of Friday's night session.
const nDays=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/DAY)+1;
const isSaturday=s=>new Date(s+"T12:00:00Z").getUTCDay()===6;
const twtoday=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const cookie=req=>(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(CK+"="))?.slice(CK.length+1)||"";
const ident=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
const gzip=async s=>new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const gunzip=async b=>new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const field=x=>{let s=String(x??"");if(/^[=+@]/.test(s))s="'"+s;return /[,"\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
// Accept only standard TX monthly outright contracts, not MTX/TXO or spreads.
// Source quantity is NOT scaled: FinMind KBar may inherit double-sided tick volumes.
export function filterTxRows(data,calendarDate){
 if(!Array.isArray(data))throw Error("期貨資料格式錯誤");
 const lines=[],seen=new Set(),stats={rows:0,dayRows:0,nightRows:0,rejectedProducts:0,rejectedContracts:0,rejectedInvalid:0,duplicates:0,volumeRaw:0,dayVol:{},nightEarlyVol:{},nightLateVol:{}};
 for(const r of data){
  if(String(r?.futures_id??"").trim()!=="TX"){stats.rejectedProducts++;continue}
  const contract=String(r.contract_date??"").trim();
  if(!/^\d{6}$/.test(contract)||Number(contract.slice(4))<1||Number(contract.slice(4))>12){stats.rejectedContracts++;continue}
  const time=String(r.minute??"").trim(),date=String(r.date??"").slice(0,10);
  const m=/^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if(!m||+m[1]>23||+m[2]>59||+m[3]>59||date!==calendarDate){stats.rejectedInvalid++;continue}
  const mins=+m[1]*60+(+m[2]),early=mins<=300,late=mins>=900,day=mins>=525&&mins<=825;
  if(!early&&!late&&!day){stats.rejectedInvalid++;continue}
  const volume=Number(r.volume),open=Number(r.open),high=Number(r.high),low=Number(r.low),close=Number(r.close);
  if(![volume,open,high,low,close].every(Number.isFinite)||!Number.isSafeInteger(volume)||volume<0||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close)){stats.rejectedInvalid++;continue}
  const key=contract+"|"+time;
  if(seen.has(key)){stats.duplicates++;continue}
  seen.add(key);
  const session=day?"day":"night",bucket=day?stats.dayVol:early?stats.nightEarlyVol:stats.nightLateVol;
  bucket[contract]=(bucket[contract]||0)+volume;
  stats.rows++;stats.volumeRaw+=volume;
  if(day)stats.dayRows++;else stats.nightRows++;
  const fields=[date,time,session,"TX",contract,open,high,low,close,volume];
  lines.push({key:date+"|"+time+"|"+contract,line:fields.map(field).join(",")+"\n"});
 }
 lines.sort((a,b)=>a.key.localeCompare(b.key));
 return {lines:lines.map(x=>x.line).join(""),stats};
}
export const TX_CSV_HEADER=H;
export async function txDownloadRoute(req,env){
 const u=new URL(req.url),p=u.pathname,m=req.method;
 if(!env.TX_DOWNLOAD_JOBS)return J({ok:false,error:"尚未設定 TX_DOWNLOAD_JOBS 背景儲存"},503);
 if(!["GET","POST"].includes(m))return J({ok:false,error:"Method not allowed"},405);
 if(m==="POST"&&req.headers.get("origin")&&req.headers.get("origin")!==u.origin)return J({ok:false,error:"來源不符"},403);
 if(p==="/api/tx-download/start"&&m==="POST"){
  // This user's own browser Token is used for the background task. No Cloudflare Secret setup needed.
  const t=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  if(!t||t.length>4096||/[\r\n]/.test(t))return J({ok:false,error:"請先在原本個股分析設定 FinMind Token，或在本頁輸入 Token"},401);
  const body=await req.text();if(body.length>2048)return J({ok:false,error:"設定長度不正確"},400);
  let opt;try{opt=JSON.parse(body)}catch{return J({ok:false,error:"格式無效"},400)}
  const {start,end}=opt||{};
  if(!okdate(start)||!okdate(end)||start<"2000-01-01"||end>twtoday()||end<start)return J({ok:false,error:"日期必須介於 2000/01/01 至今日"},400);
  if(end<TX_KBAR_FIRST_DATE)return J({ok:false,error:"FinMind 台指期分K最早從 2011/01/03 提供；所選範圍沒有可下載的分K，2000～2010 年需另找歷史來源。"},400);
  const effectiveStart=start<TX_KBAR_FIRST_DATE?TX_KBAR_FIRST_DATE:start;
  let id=cookie(req);if(!/^[a-f0-9]{64}$/.test(id))id=ident();
  const stub=env.TX_DOWNLOAD_JOBS.get(env.TX_DOWNLOAD_JOBS.idFromName(id));
  const result=await stub.fetch(new Request("https://job.local/start",{method:"POST",headers:{"authorization":"Bearer "+t,"content-type":"application/json"},body:JSON.stringify({start:effectiveStart,requestedStart:start,end,reset:opt.reset===true})}));
  return new Response(result.body,{status:result.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":CK+"="+id+"; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict"}});
 }
 const id=cookie(req);if(!/^[a-f0-9]{64}$/.test(id))return J({ok:false,error:"尚未建立下載工作"},401);
 const stub=env.TX_DOWNLOAD_JOBS.get(env.TX_DOWNLOAD_JOBS.idFromName(id));
 if(p==="/api/tx-download/status"&&m==="GET")return stub.fetch("https://job.local/status");
 if(p==="/api/tx-download/export"&&m==="GET"){
  const month=u.searchParams.get("month"),year=u.searchParams.get("year");
  if(!/^\d{4}-\d{2}$/.test(month||"")&&!/^\d{4}$/.test(year||"")&&u.searchParams.get("all")!=="1")return J({ok:false,error:"月份／年份無效"},400);
  return stub.fetch("https://job.local/export?"+new URLSearchParams(u.searchParams.get("all")==="1"?{all:"1"}:month?{month}:{year}));
 }
 if(p==="/api/tx-download/audit"&&m==="GET"){
  const date=u.searchParams.get("date")||"";
  if(!okdate(date))return J({ok:false,error:"請選擇有效日期"},400);
  return stub.fetch("https://job.local/audit?date="+date);
 }
 const action=p.split("/").at(-1);
 if(m==="POST"&&["pause","resume","retry","delete"].includes(action)){
  const bearer=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  const headers=action!=="delete"&&bearer&&bearer.length<=4096&&!/[\r\n]/.test(bearer)?{"authorization":"Bearer "+bearer}:{};
  return stub.fetch(new Request("https://job.local/"+action,{method:"POST",headers}));
 }
 return J({ok:false,error:"找不到 API"},404);
}
export class TxDownloadJob{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 summary(s){return {version:s.version||1,start:s.start,requestedStart:s.requestedStart||s.start,availableStart:TX_KBAR_FIRST_DATE,nightStart:TX_NIGHT_FIRST_DATE,unavailableBefore:s.requestedStart&&s.requestedStart<TX_KBAR_FIRST_DATE?{start:s.requestedStart,end:"2011-01-02",reason:"FinMind 無 2000～2010 年 TX 一分 K"}:null,end:s.end,phase:s.phase,current:s.current,total:s.total,processed:s.processed,filled:s.filled,empty:s.empty,failed:s.failed,rows:s.rows,dayRows:s.dayRows,nightRows:s.nightRows,rejectedProducts:s.rejectedProducts||0,rejectedContracts:s.rejectedContracts||0,rejectedInvalid:s.rejectedInvalid||0,duplicates:s.duplicates||0,volumeRaw:s.volumeRaw||0,saturdaysWithData:s.saturdaysWithData||0,errors:s.errors.slice(-20),months:s.months,updatedAt:s.updatedAt,message:s.message}}
 async fetch(req){
  const st=this.ctx.storage,url=new URL(req.url),p=url.pathname;
  if(p==="/start"&&req.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(!token||token.length>4096||/[\r\n]/.test(token))return J({ok:false,error:"缺少有效 FinMind Token"},401);
   const {start,requestedStart=start,end,reset=false}=await req.json();
   if(!okdate(start)||start<TX_KBAR_FIRST_DATE||!okdate(end)||end<start||!okdate(requestedStart)||requestedStart>start)return J({ok:false,error:"任務日期超出 FinMind 有效資料範圍"},400);
   let old=await st.get("state");
   if(reset){await st.deleteAll();await st.deleteAlarm();old=null;}
   // Store only inside this browser's private Durable Object. The token is never returned in a response.
   await st.put("finmind-token",token);
   if(old){
    // Reusing an existing job with another requested range would silently return incomplete history.
    if(old.start!==start||old.end!==end||(old.requestedStart||old.start)!==requestedStart){
     return J({ok:false,error:"目前已有 "+(old.requestedStart||old.start)+"～"+old.end+" 的下載任務。若要改成 "+requestedStart+"～"+end+"，請先備份舊資料，再按「重新下載」；不會自動刪除舊任務。",code:"EXISTING_RANGE_MISMATCH",existing:this.summary(old)},409);
    }
    if(old.phase==="error"){old.phase="running";old.retries=0;old.message="已更新 Token，恢復雲端下載";old.updatedAt=Date.now();await st.put("state",old)}
    if(old.phase==="running")await st.setAlarm(Date.now()+100);
    return J({ok:true,existing:true,...this.summary(old)});
   }
   const s={version:3,start,requestedStart,end,phase:"running",current:start,total:nDays(start,end),processed:0,filled:0,empty:0,failed:0,rows:0,dayRows:0,nightRows:0,rejectedProducts:0,rejectedContracts:0,rejectedInvalid:0,duplicates:0,volumeRaw:0,saturdaysWithData:0,retries:0,errors:[],months:{},createdAt:Date.now(),expiresAt:Date.now()+30*DAY,updatedAt:Date.now(),message:requestedStart<TX_KBAR_FIRST_DATE?"所選 "+requestedStart+" 起，但 FinMind 分K僅 2011/01/03 起可取得；已從 2011 開始下載（日夜盤／週六凌晨）":"已建立全日曆下載工作（包含週六凌晨）"};
   await st.put("state",s);await st.setAlarm(Date.now()+100);return J({ok:true,...this.summary(s)},202)
  });
  let s=await st.get("state");if(!s)return J({ok:false,error:"找不到下載工作"},404);
  if(p==="/status")return J({ok:true,...this.summary(s)});
  if(p==="/export")return this.exportData(url.searchParams.get("month"),url.searchParams.get("year"),s,url.searchParams.get("all")==="1");
  if(p==="/audit")return this.auditVolume(url.searchParams.get("date"),s);
  if(req.method!=="POST")return J({ok:false,error:"不支援操作"},405);
  return this.ctx.blockConcurrencyWhile(async()=>{
   s=await st.get("state");
   if(p!=="/delete"){
    const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
    if(token&&token.length<=4096&&!/[\r\n]/.test(token))await st.put("finmind-token",token);
   }
   if(p==="/delete"){await st.deleteAll();await st.deleteAlarm();return J({ok:true,deleted:true})}
   if(p==="/pause"&&s.phase==="running"){s.phase="paused";s.message="已暫停";await st.put("state",s);await st.setAlarm(s.expiresAt)}
   if(p==="/resume"&&["paused","error"].includes(s.phase)){s.phase="running";s.retries=0;s.message="恢復背景下載";await st.put("state",s);await st.setAlarm(Date.now()+100)}
   if(p==="/retry"&&["done","paused","error"].includes(s.phase)&&s.errors.length){s.retryQueue=s.errors.map(x=>x.date);s.errors=[];s.failed=0;s.retries=0;s.phase="running";s.message="重新補抓失敗日期";await st.put("state",s);await st.setAlarm(Date.now()+100)}
   return J({ok:true,...this.summary(s)})
  })
 }
 async download(date){
  const endpoint="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams({dataset:"TaiwanFuturesKBar",data_id:"TX",start_date:date});
  const token=String((await this.ctx.storage.get("finmind-token"))||this.env.FINMIND_TOKEN||"").trim();
  if(!token){const error=new Error("背景任務沒有 FinMind Token，請重新按開始");error.code=401;throw error}
  const r=await fetch(endpoint,{headers:{"Authorization":"Bearer "+token,"Accept":"application/json"},signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>null),code=Number(j?.status)||r.status;
  if(!r.ok||code!==200||!Array.isArray(j?.data)){
   const message=String(j?.msg||"API error").slice(0,90);
   const e=new Error("FinMind "+code+" "+message);
   e.code=code===400&&/token|sponsor|permission|api.key|invalid|unauthoriz|權限|會員|過期|無效/i.test(message)?403:code;
   throw e;
  }
  const parsed=filterTxRows(j.data,date),n=parsed.stats;
  const bytes=await gzip(new TextEncoder().encode(parsed.lines)),MAX=512*1024,chunks=Math.ceil(bytes.length/MAX);
  for(let i=0;i<chunks;i++)await this.ctx.storage.put("data:"+date+":"+i,bytes.slice(i*MAX,(i+1)*MAX));
  await this.ctx.storage.put("meta:"+date,{...n,chunks});return n
 }
 async alarm(){
  const st=this.ctx.storage;let s=await st.get("state");if(!s)return;
  if(Date.now()>=s.expiresAt){await st.deleteAll();return}
  if(s.phase!=="running"){await st.setAlarm(s.expiresAt);return}
  await st.setAlarm(Date.now()+120000);
  for(let i=0;i<3;i++){
   const fixing=Array.isArray(s.retryQueue)&&s.retryQueue.length>0,date=fixing?s.retryQueue[0]:s.current;
   if(!date||date>s.end){s.phase="done";s.message=s.failed?"下載結束，部分日期需補抓":"全部下載完成";break}
   try{
    const old=await st.get("meta:"+date),n=old||await this.download(date);
    const active=await st.get("state");if(!active||active.phase!=="running")return;
    if(!old){const m=date.slice(0,7);s.months[m]??={days:0,rows:0,dayRows:0,nightRows:0};const g=s.months[m];g.days++;g.rows+=n.rows;g.dayRows+=n.dayRows;g.nightRows+=n.nightRows;s.filled+=Number(n.rows>0);s.empty+=Number(n.rows===0);s.rows+=n.rows;s.dayRows+=n.dayRows;s.nightRows+=n.nightRows;
      for(const k of ["rejectedProducts","rejectedContracts","rejectedInvalid","duplicates","volumeRaw"])s[k]=(s[k]||0)+(n[k]||0);
      if(isSaturday(date)&&n.nightRows>0)s.saturdaysWithData=(s.saturdaysWithData||0)+1;
    }
    if(fixing)s.retryQueue.shift();else{s.current=nxt(date);s.processed++}
    s.retries=0;s.message="已下載 "+s.processed+"/"+s.total+" 天，共 "+s.rows+" 筆";
   }catch(e){
    s.retries++;const c=Number(e.code||0);
    if([401,402,403].includes(c)){s.phase="error";s.message="FinMind Token／會員權限錯誤";break}
    if(s.retries<4){s.message=date+" 暫時失敗，稍後重試";s.updatedAt=Date.now();await st.put("state",s);await st.setAlarm(Date.now()+[5000,15000,60000][s.retries-1]);return}
    s.errors.push({date,error:String(e.message||e).slice(0,100)});s.errors=s.errors.slice(-200);s.failed++;s.retries=0;
    if(fixing)s.retryQueue.shift();else{s.current=nxt(date);s.processed++}
    s.message=date+" 失敗，之後可補抓";
   }
   s.updatedAt=Date.now();await st.put("state",s);
  }
  if(s.phase==="running"&&s.current>s.end&&(!s.retryQueue||!s.retryQueue.length)){s.phase="done";s.message=s.failed?"完成，但有失敗日期":"已完成，可以下載 CSV"}
  s.updatedAt=Date.now();await st.put("state",s);
  await st.setAlarm(s.phase==="running"?Date.now()+1800:s.expiresAt)
 }
 async auditVolume(date,s){
  // Only compare same-day DAY session. Futures NIGHT session belongs to the next
  // trading day, and holidays/weekends break naive calendar joins.
  if(!okdate(date)||date<s.start||date>s.end)return J({ok:false,error:"日期不在下載範圍內"},400);
  const meta=await this.ctx.storage.get("meta:"+date);
  if(!meta)return J({ok:false,error:"當日尚未下載，無法核對"},404);
  const token=String(await this.ctx.storage.get("finmind-token")||"").trim();
  if(!token)return J({ok:false,error:"找不到 FinMind Token"},401);
  const u="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams({dataset:"TaiwanFuturesDaily",data_id:"TX",start_date:date,end_date:date});
  let raw;
  try{
   const response=await fetch(u,{headers:{"Authorization":"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(30000)});
   raw=await response.json();if(!response.ok||Number(raw.status)!==200||!Array.isArray(raw.data))throw Error("日成交 API "+(raw.msg||response.status));
  }catch(e){return J({ok:false,error:"核對失敗："+String(e.message||e).slice(0,120)},502)}
  const daily=new Map();
  for(const r of raw.data){
   const contract=String(r.contract_date||""),v=Number(r.volume);
   if(r.futures_id==="TX"&&r.date===date&&r.trading_session==="position"&&/^\d{6}$/.test(contract)&&Number.isFinite(v)&&v>0)daily.set(contract,v);
  }
  const rows=Object.entries(meta.dayVol||{}).map(([contract,kbarVolume])=>{
   const dailyVolume=daily.get(contract)||null;
   return {contract,minute_volume_raw:kbarVolume,daily_volume_one_side:dailyVolume,ratio_to_daily:dailyVolume?Number((kbarVolume/dailyVolume).toFixed(4)):null};
  }).sort((a,b)=>b.minute_volume_raw-a.minute_volume_raw);
  return J({ok:true,date,metric:"KBar 原始成交量 / TaiwanFuturesDaily 單邊成交量（同交易日一般盤、同合約月份）",rows,note:"接近 2 與雙邊口徑相符，但價差與鉅額交易可能影響比值；不能把所有分鐘量直接除以 2。夜盤涉及下一交易日，本次核對限日盤。"})
 }
 async exportData(month,year,s,all=false){
  if(!all&&month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return J({ok:false,error:"月份無效"},400);
  if(!all&&!month&&!/^\d{4}$/.test(year||""))return J({ok:false,error:"年份無效"},400);
  const scope=all?"full":month||year,dates=[];
  let d=all?s.start:month?month+"-01":year+"-01-01";
  while(all?d<=s.end:d.startsWith(scope)){if(d>=s.start&&d<=s.end)dates.push(d);d=nxt(d)}
  if(!Object.entries(s.months).some(([m,v])=>(all||m.startsWith(scope))&&v.rows))return J({ok:false,error:"尚無可下載資料"},404);
  const st=this.ctx.storage,enc=new TextEncoder();let index=-1,header=null;
  // Concatenated gzip streams are valid RFC 1952. Member one = CSV header;
  // subsequent members = each day's compressed CSV. This avoids buffering
  // six years of data or recompressing a huge file in Cloudflare.
  if(all)header=await gzip(enc.encode(H));
  let chunk=0,meta=null;
  const stream=new ReadableStream({async pull(c){
   try{
    if(index===-1){index=0;c.enqueue(all?header:enc.encode(H));return}
    while(index<dates.length){
     const date=dates[index];
     if(!meta){meta=await st.get("meta:"+date);chunk=0}
     if(!meta||!meta.chunks){index++;meta=null;continue}
     if(chunk>=meta.chunks){index++;meta=null;continue}
     if(all){
      const b=await st.get("data:"+date+":"+(chunk++));
      if(!b)throw Error("缺少 "+date+" 的資料片段");
      c.enqueue(new Uint8Array(b));return
     }
     // Reassemble all gzip chunks for a single calendar date before decompression.
     const parts=[];
     while(chunk<meta.chunks){
      const b=await st.get("data:"+date+":"+(chunk++));
      if(!b)throw Error("缺少 "+date+" 的資料片段");
      parts.push(new Uint8Array(b))
     }
     const total=parts.reduce((a,v)=>a+v.byteLength,0),combined=new Uint8Array(total);
     let off=0;for(const part of parts){combined.set(part,off);off+=part.byteLength}
     index++;meta=null;c.enqueue(await gunzip(combined));return
    }
    c.close();
   }catch(e){c.error(e)}
  }});
  const name=all?"FinMind_TX_1min_"+s.start.replaceAll("-","")+"_"+s.end.replaceAll("-","")+".csv.gz":"FinMind_TX_1min_"+scope+".csv";
  return new Response(stream,{headers:{"content-type":all?"application/gzip":"text/csv; charset=utf-8","content-disposition":'attachment; filename="'+name+'"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
}