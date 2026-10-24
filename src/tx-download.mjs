// TX 1-minute K cloud downloader. Individual-use data stays in Durable Object storage.
const J=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}});
const DAY=86400000, CK="__Host-txdownload", H="date,minute,session,futures_id,contract_date,open,high,low,close,volume\n";
const okdate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s).toISOString().slice(0,10)===s;
const nxt=s=>new Date(Date.parse(s)+DAY).toISOString().slice(0,10);
// Scan every calendar day, including Saturday 00:00-05:00 (Friday night), holidays and Sunday.
const weekday=s=>new Date(s+"T12:00:00Z").getUTCDay();
const nDays=(a,b)=>Math.floor((Date.parse(b)-Date.parse(a))/DAY)+1;
const twtoday=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const cookie=req=>(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(CK+"="))?.slice(CK.length+1)||"";
const ident=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
const gzip=async s=>new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const gunzip=async b=>new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const field=x=>{let s=String(x??"");if(/^[=+@]/.test(s))s="'"+s;return /[,"\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
function row(r){const hh=Number(String(r.minute||"").slice(0,2)),mm=Number(String(r.minute||"").slice(3,5)),v=hh*60+mm,s=(v>=900||v<=300)?"night":(v>=525&&v<=825)?"day":"other";return {session:s,line:[r.date,r.minute,s,r.futures_id,r.contract_date,r.open,r.high,r.low,r.close,r.volume].map(field).join(",")+"\n"}}
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
  if(!okdate(start)||!okdate(end)||start<"2021-01-01"||end>twtoday()||end<start||nDays(start,end)>2200)return J({ok:false,error:"日期不正確（2021-01-01 至今日）"},400);
  let id=cookie(req);if(!/^[a-f0-9]{64}$/.test(id))id=ident();
  const stub=env.TX_DOWNLOAD_JOBS.get(env.TX_DOWNLOAD_JOBS.idFromName(id));
  const result=await stub.fetch(new Request("https://job.local/start",{method:"POST",headers:{"authorization":"Bearer "+t,"content-type":"application/json"},body:JSON.stringify({start,end})}));
  return new Response(result.body,{status:result.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","set-cookie":CK+"="+id+"; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict"}});
 }
 const id=cookie(req);if(!/^[a-f0-9]{64}$/.test(id))return J({ok:false,error:"尚未建立下載工作"},401);
 const stub=env.TX_DOWNLOAD_JOBS.get(env.TX_DOWNLOAD_JOBS.idFromName(id));
 if(p==="/api/tx-download/status"&&m==="GET")return stub.fetch("https://job.local/status");
 if(p==="/api/tx-download/export"&&m==="GET"){
  const month=u.searchParams.get("month"),year=u.searchParams.get("year"),all=u.searchParams.get("all")==="1",mode=u.searchParams.get("mode")==="all"?"all":"front";
  if(!all&&!/^\d{4}-\d{2}$/.test(month||"")&&!/^\d{4}$/.test(year||""))return J({ok:false,error:"月份／年份無效"},400);
  return stub.fetch("https://job.local/export?"+new URLSearchParams({...all?{all:"1"}:month?{month}:{year},mode}));
 }
 if(p==="/api/tx-download/audit"&&m==="GET"){
  const date=u.searchParams.get("date")||"";
  if(!okdate(date))return J({ok:false,error:"稽核日期不正確"},400);
  return stub.fetch("https://job.local/audit?"+new URLSearchParams({date}));
 }
 const action=p.split("/").at(-1);
 if(m==="POST"&&["pause","resume","retry","repair","delete"].includes(action)){
  const bearer=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
  const headers=action!=="delete"&&bearer&&bearer.length<=4096&&!/[\r\n]/.test(bearer)?{"authorization":"Bearer "+bearer}:{};
  return stub.fetch(new Request("https://job.local/"+action,{method:"POST",headers}));
 }
 return J({ok:false,error:"找不到 API"},404);
}
export class TxDownloadJob{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 summary(s){return {start:s.start,end:s.end,phase:s.phase,current:s.current,total:s.total,processed:s.processed,filled:s.filled,empty:s.empty,failed:s.failed,rows:s.rows,dayRows:s.dayRows,nightRows:s.nightRows,saturdayEarlyRows:s.saturdayEarlyRows||0,rejectedOther:s.rejectedOther||0,rejectedSpread:s.rejectedSpread||0,duplicates:s.duplicates||0,errors:s.errors.slice(-20),months:s.months,repairLeft:s.repairQueue?.length||0,updatedAt:s.updatedAt,message:s.message}}
 async fetch(req){
  const st=this.ctx.storage,url=new URL(req.url),p=url.pathname;
  if(p==="/start"&&req.method==="POST")return this.ctx.blockConcurrencyWhile(async()=>{
   const token=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";
   if(!token||token.length>4096||/[\r\n]/.test(token))return J({ok:false,error:"缺少有效 FinMind Token"},401);
   const old=await st.get("state");
   // Store only inside this browser's private Durable Object. The token is never returned in a response.
   await st.put("finmind-token",token);
   if(old){
    if(old.phase==="error"){old.phase="running";old.retries=0;old.message="已更新 Token，恢復雲端下載";old.updatedAt=Date.now();await st.put("state",old)}
    if(old.phase==="running")await st.setAlarm(Date.now()+100);
    return J({ok:true,existing:true,...this.summary(old)});
   }
   const {start,end}=await req.json();
   const s={start,end,phase:"running",current:start,total:nDays(start,end),processed:0,filled:0,empty:0,failed:0,rows:0,dayRows:0,nightRows:0,retries:0,errors:[],months:{},saturdayEarlyRows:0,rejectedOther:0,rejectedSpread:0,duplicates:0,createdAt:Date.now(),expiresAt:Date.now()+30*DAY,updatedAt:Date.now(),message:"已建立背景下載工作"};
   await st.put("state",s);await st.setAlarm(Date.now()+100);return J({ok:true,...this.summary(s)},202)
  });
  let s=await st.get("state");if(!s)return J({ok:false,error:"找不到下載工作"},404);
  if(p==="/status")return J({ok:true,...this.summary(s)});
  if(p==="/export")return this.exportData(url.searchParams.get("month"),url.searchParams.get("year"),url.searchParams.get("all")==="1",url.searchParams.get("mode")==="all"?"all":"front",s);
  if(p==="/audit")return this.auditDay(url.searchParams.get("date"),s);
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
   if(p==="/repair"&&["done","paused","error"].includes(s.phase)){
    const meta=await st.list({prefix:"meta:"});const queued=[];
    for(let d=s.start;d<=s.end;d=nxt(d))if(!meta.has("meta:"+d))queued.push(d);
    s.total=nDays(s.start,s.end);s.processed=meta.size;
    s.repairQueue=queued;s.retryQueue=[];s.current=nxt(s.end);s.phase=queued.length?"running":"done";s.failed=0;s.errors=[];s.retries=0;
    s.message=queued.length?"正在補抓星期六／休市日等 "+queued.length+" 個日曆缺口":"全部日曆日均已查詢";
    await st.put("state",s);await st.setAlarm(s.phase==="running"?Date.now()+100:s.expiresAt);
   }
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
  const lines=[],n={rows:0,dayRows:0,nightRows:0};
  for(const raw of j.data){if(String(raw.futures_id||"").toUpperCase()!=="TX")continue;const v=row(raw);lines.push(v.line);n.rows++;if(v.session==="day")n.dayRows++;if(v.session==="night")n.nightRows++}
  const bytes=await gzip(new TextEncoder().encode(lines.join(""))),MAX=512*1024,chunks=Math.ceil(bytes.length/MAX);
  for(let i=0;i<chunks;i++)await this.ctx.storage.put("data:"+date+":"+i,bytes.slice(i*MAX,(i+1)*MAX));
  await this.ctx.storage.put("meta:"+date,{...n,chunks});return n
 }
 async alarm(){
  const st=this.ctx.storage;let s=await st.get("state");if(!s)return;
  if(Date.now()>=s.expiresAt){await st.deleteAll();return}
  if(s.phase!=="running"){await st.setAlarm(s.expiresAt);return}
  await st.setAlarm(Date.now()+120000);
  for(let i=0;i<3;i++){
   const repair=Array.isArray(s.repairQueue)&&s.repairQueue.length>0;
   const fixing=!repair&&Array.isArray(s.retryQueue)&&s.retryQueue.length>0;
   const date=repair?s.repairQueue[0]:fixing?s.retryQueue[0]:s.current;
   if(!date||date>s.end){s.phase="done";s.message=s.failed?"下載結束，部分日期需補抓":"全部下載完成";break}
   // Never skip a Saturday: its 00:00-05:00 bars belong to Friday's overnight session.
   // Also query closed calendar dates and persist verified empty results. 
   try{
    const old=await st.get("meta:"+date),n=old||await this.download(date);
    const active=await st.get("state");if(!active||active.phase!=="running")return;
    if(!old){const m=date.slice(0,7);s.months[m]??={days:0,rows:0,dayRows:0,nightRows:0};const g=s.months[m];g.days++;g.rows+=n.rows;g.dayRows+=n.dayRows;g.nightRows+=n.nightRows;s.filled+=Number(n.rows>0);s.empty+=Number(n.rows===0);s.rows+=n.rows;s.dayRows+=n.dayRows;s.nightRows+=n.nightRows;
     s.saturdayEarlyRows=(s.saturdayEarlyRows||0)+(n.saturdayEarlyRows||0);s.rejectedOther=(s.rejectedOther||0)+(n.rejectedOther||0);s.rejectedSpread=(s.rejectedSpread||0)+(n.rejectedSpread||0);s.duplicates=(s.duplicates||0)+(n.duplicates||0)}
    if(repair){s.repairQueue.shift();s.processed++}else if(repair){s.repairQueue.shift();s.processed++}else if(fixing)s.retryQueue.shift();else{s.current=nxt(date);s.processed++}
    s.retries=0;s.message="已查詢 "+s.processed+"/"+s.total+" 個日曆日（含星期六），TX "+s.rows+" 根";
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
  if(s.phase==="running"&&s.current>s.end&&(!s.retryQueue||!s.retryQueue.length)&&(!s.repairQueue||!s.repairQueue.length)){s.phase="done";s.message=s.failed?"完成，但有失敗日期":"已完成，可以下載 CSV"}
  s.updatedAt=Date.now();await st.put("state",s);
  await st.setAlarm(s.phase==="running"?Date.now()+1800:s.expiresAt)
 }
 async exportData(month,year,s){
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return J({ok:false,error:"月份無效"},400);
  if(!month&&!/^\d{4}$/.test(year||""))return J({ok:false,error:"年份無效"},400);
  const scope=month||year,dates=[];let d=month?month+"-01":year+"-01-01";
  while(d.startsWith(scope)){if(d>=s.start&&d<=s.end&&weekday(d))dates.push(d);d=nxt(d)}
  if(!Object.entries(s.months).some(([m,v])=>m.startsWith(scope)&&v.days))return J({ok:false,error:"尚無可下載資料"},404);
  const st=this.ctx.storage,enc=new TextEncoder();let index=-1;
  const stream=new ReadableStream({async pull(c){
   try{
    if(index===-1){index=0;c.enqueue(enc.encode(H));return}
    if(index>=dates.length){c.close();return}
    const date=dates[index++],meta=await st.get("meta:"+date);if(!meta||!meta.chunks)return;
    const chunks=[];for(let i=0;i<meta.chunks;i++){const b=await st.get("data:"+date+":"+i);if(!b)throw Error("缺少 "+date+" 的資料片段");chunks.push(new Uint8Array(b))}
    const size=chunks.reduce((v,b)=>v+b.byteLength,0),all=new Uint8Array(size);let off=0;for(const b of chunks){all.set(b,off);off+=b.byteLength}
    c.enqueue(await gunzip(all));
   }catch(e){c.error(e)}
  }});
  return new Response(stream,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="FinMind_TX_1min_'+scope+'.csv"',"cache-control":"private, no-store","x-content-type-options":"nosniff"}})
 }
}