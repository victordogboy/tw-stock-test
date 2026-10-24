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
  if(!okdate(start)||!okdate(end)||start<"2021-01-01"||end>twtoday()||end<start)return J({ok:false,error:"日期不正確（2021-01-01 至今日）"},400);
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
  // Sponsor endpoint fetches one calendar day. Keep only outright TX month contracts.
  const endpoint="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams({dataset:"TaiwanFuturesKBar",data_id:"TX",start_date:date});
  const token=String((await this.ctx.storage.get("finmind-token"))||this.env.FINMIND_TOKEN||"").trim();
  if(!token){const error=new Error("背景任務沒有 FinMind Token，請重新按開始");error.code=401;throw error}
  const response=await fetch(endpoint,{headers:{"Authorization":"Bearer "+token,"Accept":"application/json"},signal:AbortSignal.timeout(30000)});
  const raw=await response.json().catch(()=>null),code=Number(raw?.status)||response.status;
  if(!response.ok||code!==200||!Array.isArray(raw?.data)){
   const msg=String(raw?.msg||"API error").slice(0,90),e=new Error("FinMind "+code+" "+msg);
   e.code=code===400&&/token|sponsor|permission|api.key|invalid|unauthoriz|權限|會員|過期|無效/i.test(msg)?403:code;
   throw e
  }
  const seen=new Map(),lines=[],n={rows:0,dayRows:0,nightRows:0,saturdayEarlyRows:0,rejectedOther:0,rejectedSpread:0,duplicates:0,dayContract:{}};
  for(const item of raw.data){
   if(String(item.futures_id??"").trim().toUpperCase()!=="TX"){n.rejectedOther++;continue}
   // Spread combinations such as 202610/202611 are not individual monthly futures contracts.
   const contract=String(item.contract_date??"").trim();
   if(!/^\d{6}$/.test(contract)||Number(contract.slice(4,6))<1||Number(contract.slice(4,6))>12){n.rejectedSpread++;continue}
   const minute=String(item.minute??"").trim(),match=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(minute);
   const d=String(item.date??"").slice(0,10);
   if(!match||d!==date){n.rejectedOther++;continue}
   const clock=Number(match[1])*60+Number(match[2]);
   const session=(clock>=900||clock<=300)?"night":clock>=525&&clock<=825?"day":null;
   if(!session){n.rejectedOther++;continue}
   const prices=["open","high","low","close"].map(k=>Number(item[k])),volume=Number(item.volume);
   if(!prices.every(Number.isFinite)||!Number.isFinite(volume)||volume<0){n.rejectedOther++;continue}
   const [open,high,low,close]=prices;
   if(high<Math.max(open,close,low)||low>Math.min(open,close,high)){n.rejectedOther++;continue}
   const key=d+"|"+minute+"|"+contract,signature=[...prices,volume].join("/");
   if(seen.has(key)){
    if(seen.get(key)!==signature){const e=new Error(date+" 同月份同分鐘出現互相矛盾的 K 線，拒絕寫入");e.code=422;throw e}
    n.duplicates++;continue
   }
   seen.set(key,signature);
   const v=row({...item,date:d,minute,contract_date:contract,futures_id:"TX",volume});
   lines.push({minute,contract,line:v.line});
   n.rows++;if(session==="day"){n.dayRows++;n.dayContract[contract]=(n.dayContract[contract]||0)+volume}else n.nightRows++;
   if(weekday(date)===6&&clock<=300)n.saturdayEarlyRows++
  }
  if(raw.data.length>0&&!n.rows){const e=new Error(date+" API 有資料但未找到有效 TX 單式合約，請核對回傳格式");e.code=422;throw e}
  lines.sort((a,b)=>a.minute.localeCompare(b.minute)||a.contract.localeCompare(b.contract));
  const bytes=await gzip(new TextEncoder().encode(lines.map(x=>x.line).join("")));
  // 512 KiB fits current Cloudflare SQLite-backed Durable Object's 2 MiB key/value limit.
  const MAX=512*1024,chunks=Math.ceil(bytes.length/MAX);
  for(let i=0;i<chunks;i++)await this.ctx.storage.put("data:"+date+":"+i,bytes.slice(i*MAX,(i+1)*MAX));
  await this.ctx.storage.put("meta:"+date,{...n,chunks});return n;
 }
 async readDay(date){
  const meta=await this.ctx.storage.get("meta:"+date);
  if(!meta||!meta.chunks)return "";
  const blocks=[];for(let i=0;i<meta.chunks;i++){
   const part=await this.ctx.storage.get("data:"+date+":"+i);
   if(!part)throw Error("缺少 "+date+" 的資料區塊 "+i);
   blocks.push(new Uint8Array(part))
  }
  const total=blocks.reduce((v,b)=>v+b.byteLength,0),all=new Uint8Array(total);let offset=0;
  for(const block of blocks){all.set(block,offset);offset+=block.byteLength}
  return new TextDecoder().decode(await gunzip(all))
 }
 // Per-calendar-day export; no look-ahead to tomorrow's close or dynamic per-minute month hopping.
 selectCsv(text,mode){
  const rows=text.trim().split("\n").filter(Boolean).map(line=>{
   const c=line.split(",");
   if(c.length<10||c[3]!=="TX"||!/^\d{6}$/.test(c[4]))return null;
   const minute=c[1],hh=Number(minute.slice(0,2)),block=hh<=5?"early":hh>=15?"evening":"day";
   return {line,month:c[4],minute,block,key:c[0]+"|"+minute+"|"+c[4]}
  }).filter(Boolean);
  // Older cached files might contain duplicate/spread data, so sanitize exports too.
  const unique=new Map();
  for(const v of rows)if(!unique.has(v.key))unique.set(v.key,v);
  const list=[...unique.values()];
  if(mode==="all")return list.sort((a,b)=>a.minute.localeCompare(b.minute)||a.month.localeCompare(b.month)).map(r=>r.line).join("\n")+(list.length?"\n":"");
  const monthPerBlock=new Map();
  for(const item of list){
   const old=monthPerBlock.get(item.block);
   if(!old||item.month<old)monthPerBlock.set(item.block,item.month)
  }
  return list.filter(v=>v.month===monthPerBlock.get(v.block)).sort((a,b)=>a.minute.localeCompare(b.minute)||a.month.localeCompare(b.month)).map(r=>r.line).join("\n")+(list.length?"\n":"");
 }
 async auditDay(date,s){
  if(!okdate(date)||date<s.start||date>s.end)return J({ok:false,error:"稽核日期超出下載範圍"},400);
  const cached=await this.ctx.storage.get("audit:"+date);
  if(cached)return J({ok:true,cached:true,...cached});
  const csv=await this.readDay(date);
  if(!csv)return J({ok:false,error:"該日期尚無日盤 TX 分K 資料；請選已完成下載的交易日"},400);
  const volumeByContract={};
  for(const line of csv.split("\n")){
   if(!line)continue;const f=line.split(",");
   if(f[3]!=="TX"||!/^\d{6}$/.test(f[4])||f[2]!=="day")continue;
   const volume=Number(f[9]);if(Number.isFinite(volume))volumeByContract[f[4]]=(volumeByContract[f[4]]||0)+volume
  }
  const token=String((await this.ctx.storage.get("finmind-token"))||this.env.FINMIND_TOKEN||"").trim();
  if(!token)return J({ok:false,error:"請重新按「開始」以更新 FinMind Token"},401);
  const endpoint="https://api.finmindtrade.com/api/v4/data?"+new URLSearchParams({dataset:"TaiwanFuturesDaily",data_id:"TX",start_date:date,end_date:nxt(date)});
  const res=await fetch(endpoint,{headers:{authorization:"Bearer "+token,accept:"application/json"},signal:AbortSignal.timeout(30000)});
  const payload=await res.json().catch(()=>null);
  if(!res.ok||Number(payload?.status)!==200||!Array.isArray(payload?.data))return J({ok:false,error:"無法取得 FinMind TaiwanFuturesDaily 官方日盤量做對帳"},502);
  const rows=payload.data.filter(v=>String(v.futures_id).trim().toUpperCase()==="TX"&&String(v.date)===date&&String(v.trading_session)==="position"&&/^\d{6}$/.test(String(v.contract_date))).map(v=>{
   const contract=String(v.contract_date),official=Number(v.volume),raw=volumeByContract[contract]||0,ratio=official>0?raw/official:null;
   return {contract,raw,official,ratio:ratio===null?null:Math.round(ratio*1000)/1000};
  }).filter(v=>v.raw>0&&v.official>0).sort((a,b)=>b.official-a.official);
  const head=rows[0],r=head?.ratio;
  const verdict=!head?"樣本不足，無法判斷":r>=1.85&&r<=2.15?"接近 2 倍：分K量可能是雙邊量":r>=0.85&&r<=1.15?"接近 1 倍：分K量可能是單邊量":"兩者不一致：需核對價差成交及鉅額交易";
  const out={date,verdict,rows:rows.slice(0,12),method:"同日 08:45–13:45 TX 單式合約分K raw volume 加總 / TaiwanFuturesDaily position 同合約成交量；僅診斷近似值，價差、鉅額與缺漏可能造成偏差。"};
  await this.ctx.storage.put("audit:"+date,out);
  return J({ok:true,...out});
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
 async exportData(month,year,all,mode,s){
  if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return J({ok:false,error:"月份無效"},400);
  if(!month&&!all&&!/^\d{4}$/.test(year||""))return J({ok:false,error:"年份無效"},400);
  const scope=all?"full":month||year,dates=[];
  for(let d=s.start;d<=s.end;d=nxt(d))if(all||d.startsWith(scope))dates.push(d);
  if(!dates.length)return J({ok:false,error:"沒有在指定日期範圍內的資料"},404);
  if(!all&&!Object.entries(s.months).some(([m,v])=>m.startsWith(scope)&&v.days))return J({ok:false,error:"尚無可下載資料"},404);
  const self=this,enc=new TextEncoder();let index=-1;
  // Each pull reads one day's compressed storage; never join five years in memory.
  const stream=new ReadableStream({async pull(controller){
   try{
    if(index===-1){index=0;controller.enqueue(enc.encode(H));return}
    if(index>=dates.length){controller.close();return}
    const day=dates[index++],text=await self.readDay(day);
    if(!text)return;
    const result=self.selectCsv(text,mode);
    if(result)controller.enqueue(enc.encode(result));
   }catch(e){controller.error(e)}
  }});
  const compressed=all,body=compressed?stream.pipeThrough(new CompressionStream("gzip")):stream;
  const filename=all?"FinMind_TX_"+s.start+"_"+s.end+"_"+mode+".csv.gz":"FinMind_TX_1min_"+scope+"_"+mode+".csv";
  return new Response(body,{headers:{
   "content-type":compressed?"application/gzip":"text/csv; charset=utf-8",
   "content-disposition":'attachment; filename="'+filename+'"',
   "cache-control":"private, no-store","x-content-type-options":"nosniff"
  }})
 }

}