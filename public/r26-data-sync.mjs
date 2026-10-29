// R26 actual minute-bar coverage inspector, isolated from the frozen trading engine.
// No trading signal or simulated fill is created here. FinMind API is historical, not live.
export const TPE_OFFSET="+08:00";
export const MINUTE_MS=60000;
export function taipeiParts(when=new Date()){
 const fields=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(when);
 const x=Object.fromEntries(fields.map(p=>[p.type,p.value]));
 return {date:x.year+"-"+x.month+"-"+x.day,hour:Number(x.hour),minute:Number(x.minute)};
}
export function dayShift(date,days){
 return new Date(Date.parse(date+"T00:00:00Z")+days*86400000).toISOString().slice(0,10)
}
export function weekday(date){return new Date(date+"T12:00:00Z").getUTCDay()}
export function nextRegularDay(date){
 let d=date;
 do{d=dayShift(d,1)}while(weekday(d)===0||weekday(d)===6);
 return d // Only weekday estimate. Exchange calendar may have holidays.
}
export function referenceTxMonth(date){
 const [year,month]=date.split("-").map(Number);
 const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 const thirdWed=1+(3-first+7)%7+14;
 const actual=Number(date.slice(8));
 let y=year,m=month;
 if(actual>thirdWed){m++;if(m===13){y++;m=1}}
 return String(y)+String(m).padStart(2,"0");
}
export function buildPhysicalSessions(startDate,now=new Date()){
 const nowMs=now.getTime(),today=taipeiParts(now).date,out=[];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))return out;
 const first=Math.max(Date.parse(startDate+"T00:00:00Z"),Date.parse(today+"T00:00:00Z")-12*86400000);
 for(let ms=first;ms<=Date.parse(today+"T00:00:00Z");ms+=86400000){
  const d=new Date(ms).toISOString().slice(0,10),wd=weekday(d);
  if(wd===0||wd===6)continue;
  for(const type of ["day","night"]){
   const start=Date.parse(d+(type==="day"?"T08:45:00":"T15:00:00")+TPE_OFFSET);
   const end=Date.parse((type==="day"?d:dayShift(d,1))+(type==="day"?"T13:45:00":"T05:00:00")+TPE_OFFSET);
   if(nowMs<start)continue;
   const minutes=type==="day"?300:840;
   const elapsed=Math.max(0,Math.min(minutes,Math.ceil((Math.min(nowMs,end)-start)/60000)));
   out.push({key:type+":"+d,date:d,type,tradeDate:type==="day"?d:nextRegularDay(d),
    startedAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),
    expected:minutes,elapsed,complete:nowMs>=end});
  }
 }
 return out
}
export function summarizeCoverage(bars,sessions,contract){
 const accepted=bars.filter(r=>String(r.contract_date)===contract);
 return sessions.map(s=>{
  const selected=accepted.filter(r=>r.session_key===s.key);
  const minutes=new Set(selected.map(r=>String(r.timestamp_tpe).slice(0,16)));
  const count=minutes.size;
  const times=[...minutes].sort();
  const last=times.at(-1)||null;
  const expected=s.complete?s.expected:s.elapsed;
  const trailingMins=s.complete?Math.max(0,Math.floor((Date.parse(s.endsAt)-Date.parse((last||"2000-01-01 00:00").replace(" ","T")+TPE_OFFSET))/60000)):null;
  const status=count===0?"no_bars":count<Math.min(expected,s.type==="day"?300:840)?"partial":"available";
  return {...s,contract,count,last,expectedSoFar:expected,
   gapEstimate:Math.max(0,expected-count),trailingMins,
   status,source:"FinMind TaiwanFuturesKBar",tradeDateVerified:false}
 })
}
export function lastDataDate(bars){
 const timestamps=bars.map(x=>x.timestamp_tpe).sort();return timestamps.at(-1)||null
}
function getSavedToken(){
 // Prefer the current shared scanner token: an old R26-specific token may
 // have expired while the scanner token was refreshed separately.
 try{
  const j=JSON.parse(localStorage.getItem("twq_finmind_tokens_v2")||"null");
  const active=Number(j?.active)===1?1:0;
  const shared=String(j?.tokens?.[active]||"").trim();
  if(shared)return shared;
 }catch{}
 try{return String(localStorage.getItem("R26_FinMind_Token")||
  localStorage.getItem("twq_finmind_token_v1")||"").trim()}catch{return ""}
}
function openDatabase(){
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open("r26-verified-TX",1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("bars"))r.result.createObjectStore("bars",{keyPath:"key"})};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)
 })
}
async function readCached(contract){
 const db=await openDatabase();
 try{return await new Promise((resolve,reject)=>{
  const request=db.transaction("bars","readonly").objectStore("bars").getAll();
  request.onsuccess=()=>resolve(request.result.filter(x=>x.contract_date===contract));
  request.onerror=()=>reject(request.error)
 })}finally{db.close()}
}
async function writeCached(rows){
 if(!rows.length)return;
 const db=await openDatabase();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction("bars","readwrite"),store=tx.objectStore("bars");
  for(const r of rows)store.put({key:r.contract_date+"|"+r.timestamp_tpe,...r});
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)
 })}finally{db.close()}
}
function get(id){return document.getElementById(id)}
function safeDate(iso){return String(iso||"—").replace("T"," ").slice(0,19)}
function renderCoverage(rows,anchor,now,contract){
 const sessions=buildPhysicalSessions(anchor.slice(0,10),now).filter(x=>Date.parse(x.endsAt)>Date.parse(anchor));
 const audit=summarizeCoverage(rows,sessions,contract),last=lastDataDate(rows);
 const completed=audit.filter(x=>x.complete),missing=completed.filter(x=>x.count===0);
 const details=completed.filter(x=>x.count>0&&x.gapEstimate>0);
 const fmt=new Intl.NumberFormat("zh-TW");
 get("r26DataLatest").textContent=last?last+"（台灣時間）":"尚無指定月份分鐘 K";
 get("r26DataCount").textContent=fmt.format(rows.length)+" 根／"+audit.length+" 個應檢查時段";
 get("r26DataMissing").textContent=missing.length+" 盤完全無資料；"+details.length+" 盤有分鐘缺口";
 get("r26DataTable").replaceChildren();
 for(const s of audit.slice(-9).reverse()){
  const tr=document.createElement("tr");
  const cells=[s.date+" "+(s.type==="day"?"日盤":"夜盤"),s.tradeDate+(s.type==="night"?"（預估）":""),s.contract,
   String(s.count)+" / "+String(s.expectedSoFar),
   s.last?String(s.last).slice(11,16):"—",
   s.complete?"已結束；未驗證完整":"進行中／可能尚未公布"];
  for(const val of cells){const td=document.createElement("td");td.textContent=val;tr.append(td)}
  get("r26DataTable").append(tr);
 }
 const hasBreak=missing.length>0||details.length>0;
 const statusText=hasBreak?"⚠ 仍有歷史分 K 未確認，策略必須停止更新":
   audit.length?"✅ 已取得部分或全部歷史分 K，但尚未進行原凍結引擎重播":"⚠ 尚未確認新增盤的分鐘 K";
 get("r26DataHealth").textContent=statusText;
 const old=new Date(anchor).getTime();
 const freshness=last?Date.parse(last.replace(" ","T")+TPE_OFFSET):old;
 get("r26DataGap").textContent="金標模型最後完成："+safeDate(anchor)+"；目前分 K 最後取得："+(last||"未知")+
  "。兩者不能互相取代。FinMind 歷史分 K 非 5 秒即時行情，Yahoo WTX& 非指定月份 TX 合約。"+
  "夜盤交易日僅以平日預估，實際應核對期交所休市日。";
 return {audit,hasBreak,last,freezeAsOf:anchor,latestKTime:freshness,rawBarCount:rows.length,
  replayExecuted:false,signalAllowed:false}
}
function init(){
 const card=get("r26DataHealthPanel");if(!card)return;
 const dateTag=get("r26NowDate");
 const paintDate=()=>{if(dateTag)dateTag.textContent="臺灣日期 "+taipeiParts().date+" · 凍結模型非即時訊號"};
 paintDate();
 setInterval(paintDate,60000);
 let loading=false,invalidToken=false,lastFetched=0,replay=null,contract="",rows=[],lastReport=null;
 const tokenInput=get("r26DataToken"),contractInput=get("r26DataContract");
 const token=getSavedToken();
 if(token)tokenInput.placeholder="找到此瀏覽器先前保存的 FinMind Token，可留空";
 else tokenInput.placeholder="目前沒有可用 Token，請貼上 FinMind 會員 Token";
 const anchorLabel=get("r26FreezeLabel");
 function message(t){get("r26DataProgress").textContent=t}
 function draw(){if(!replay)return;lastReport=renderCoverage(rows,replay.as_of,new Date(),contract)}
 async function startAudit(manual=false){
  if(loading)return;loading=true;get("r26DataRefresh").disabled=true;
  try{
   if(!replay){
    const r=await fetch("/r26-replay-latest.json",{cache:"no-store"});
    if(!r.ok)throw Error("封存 R26 歷史資料無法讀取");
    replay=await r.json();
    if(!replay.as_of||!replay.contract)throw Error("R26 封存資料缺少日期或合約資訊");
    contract=String(replay.contract).replace(/^TX/,"");
    const inferred=referenceTxMonth(taipeiParts().date);
    if(inferred!==contract){
     message("封存合約 "+contract+" 與今日參考近月 "+inferred+" 不同，請核對換月後再補抓。");
     contract=inferred
    }
    contractInput.value=contract;
    anchorLabel.textContent="凍結模型資料截至 "+safeDate(replay.as_of)+"；僅供歷史對照";
    try{rows=await readCached(contract)}
    catch(e){rows=[];message("瀏覽器歷史快取不可讀，改由 FinMind 補抓，不影響既有策略金標。")}
    draw();
   }
   const bearer=String(tokenInput.value||getSavedToken()).trim();
   if(!bearer){message("未找到 FinMind Token：可以先查看上次快取，或在此貼上 Token 後按「補抓」。");return}
   if(manual&&tokenInput.value.trim())try{localStorage.setItem("R26_FinMind_Token",tokenInput.value.trim())}catch{}
   if(invalidToken&&!manual){message("Token 曾被來源拒絕；自動補抓暫停，避免無效重試。");return}
   if(!manual&&Date.now()-lastFetched<10*60000)return;
   lastFetched=Date.now();
   const now=taipeiParts(),startDate=replay.as_of.slice(0,10);
   let begin=Math.max(Date.parse(startDate+"T00:00:00Z"),Date.parse(now.date+"T00:00:00Z")-4*86400000);
   const dates=[];
   for(let ms=begin;ms<=Date.parse(now.date+"T00:00:00Z");ms+=86400000)dates.push(new Date(ms).toISOString().slice(0,10));
   message("正在補抓 "+dates.length+" 個日曆日的 TX"+contract+" 歷史分 K；來源不保證盤中即時更新。");
   let count=0,errors=[];
   for(const date of dates){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),26000);
    try{
     const api="/api/r26/kbar?date="+encodeURIComponent(date)+"&contract="+encodeURIComponent(contract);
     const resp=await fetch(api,{headers:{Authorization:"Bearer "+bearer},cache:"no-store",signal:ctrl.signal});
     const j=await resp.json();
     if(!resp.ok||!j.ok){
      const err=String(j.reason||j.error||"HTTP "+resp.status);
      if(/token.*(illegal|invalid|expired)|unauthorized|forbidden|denied/i.test(err))invalidToken=true;
      throw Error(date+"："+err);
     }
     if(!Array.isArray(j.data))throw Error(date+"：分 K 格式不正確");
     const filtered=j.data.filter(x=>x.contract_date===contract&&x.source==="FinMind TaiwanFuturesKBar");
     count+=filtered.length;
     try{await writeCached(filtered)}catch(e){
      message("IndexedDB 儲存失敗；本次分 K 仍可顯示，但重新開頁可能需要再下載。")
     }
     const merged=new Map(rows.map(x=>[x.contract_date+"|"+x.timestamp_tpe,x]));
     for(const x of filtered)merged.set(x.contract_date+"|"+x.timestamp_tpe,x);
     rows=[...merged.values()];
     draw();message("已抓 "+date+"：新增或確認 "+filtered.length+" 根，累計本次 "+count+" 根");
    }catch(e){
     errors.push(String(e?.message||e));
     if(invalidToken)break
    }finally{clearTimeout(timer)}
   }
   draw();
   message(errors.length?"部分日期失敗："+errors.slice(-3).join("；")+"。已保留可用的歷史快取。":
    "補抓完成，本次回傳 "+count+" 根。注意：尚未接通凍結版 R26 策略引擎，不能給出新的交易訊號。");
  }catch(e){message("無法檢查分鐘資料："+String(e?.message||e))}
  finally{loading=false;get("r26DataRefresh").disabled=false}
 }
 tokenInput.addEventListener("change",()=>{
  const t=tokenInput.value.trim();
  if(t){try{localStorage.setItem("R26_FinMind_Token",t)}catch{}invalidToken=false}
 });
 get("r26DataRefresh").addEventListener("click",()=>{invalidToken=false;startAudit(true)});
 get("r26DataClearToken").addEventListener("click",()=>{try{localStorage.removeItem("R26_FinMind_Token")}catch{}tokenInput.value="";invalidToken=true;message("已清除這個頁面使用的 Token")});
 get("r26DataExport").addEventListener("click",()=>{
  if(!lastReport)return;
  const payload={generated_at:new Date().toISOString(),contract,replay_baseline:replay?.as_of,
   ...lastReport,note:"No frozen engine replay performed; snapshot quote is not named-contract minute data."};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const u=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=u;a.download="R26_data_coverage_"+taipeiParts().date+".json";a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)
 });
 startAudit(false);
 const timer=setInterval(()=>{if(document.visibilityState==="visible")startAudit(false)},60000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")startAudit(false)});
}
if(typeof document!=="undefined")init();
