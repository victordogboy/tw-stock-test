const KEY='c26-finmind-device-token-v1';
const API='/api/c26/private-feed';
export const cleanToken=x=>String(x||'').trim().replace(/\\_/g,'_');
export function readToken(storage=globalThis.localStorage){try{return cleanToken(storage.getItem(KEY))}catch{return ''}}
export function saveToken(value,storage=globalThis.localStorage){const token=cleanToken(value);if(token.length<30||token.length>4096||/\s/.test(token))throw Error('請貼上完整 FinMind Token');storage.setItem(KEY,token);return token}
export function clearToken(storage=globalThis.localStorage){storage.removeItem(KEY)}
const addDate=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function unzip(bytes){return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text())}
async function zip(value){return new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()}
async function request(token,suffix='',options={}){
 const r=await fetch(API+suffix,{...options,headers:{...options.headers,Authorization:'Bearer '+token},cache:'no-store'});
 if(!r.ok){let message;try{message=(await r.json()).error}catch{}throw Error(message||'資料更新 HTTP '+r.status)}
 return r;
}
const datasets={price:'TaiwanStockPrice',institutional:'TaiwanStockInstitutionalInvestorsBuySell',margin:'TaiwanStockMarginPurchaseShortSale',lending:'TaiwanStockSecuritiesLending'};
function price(v){const r={stock_id:String(v.stock_id),open:Number(v.open),high:Number(v.max),low:Number(v.min),close:Number(v.close),volume:Number(v.Trading_Volume),value:Number(v.Trading_money)};
 r.valid=Object.values(r).slice(1).every(Number.isFinite)&&r.open>0&&r.low>0&&r.high>=r.low&&r.open>=r.low-.001&&r.open<=r.high+.001&&r.close>=r.low-.001&&r.close<=r.high+.001&&r.volume>=0;return r}
export async function updateDeviceSource(token,progress=()=>{}){
 const config=await fetch(new URL('./device-source-config.json',import.meta.url),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('無法讀取 C26 標的設定');return r.json()});
 const pool=new Set(config.codes);
 async function pull(dataset,date){
  for(let n=0;n<3;n++)try{
   const r=await request(token,'/finmind',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({dataset,date})});
   return (await r.json()).data;
  }catch(e){if(n===2)throw e;await new Promise(r=>setTimeout(r,1200*(n+1)))}
 }
 progress('正在核對交易日與已保存資料…');
 const calendar=(await pull('TaiwanStockTradingDate')).map(x=>x.date).filter(x=>/^20\d\d-\d\d-\d\d$/.test(x)).sort();
 if(!calendar.includes('2026-10-27'))throw Error('FinMind 交易日資料不完整');
 const clock=new Date(Date.now()+8*3600000).toISOString();
 const through=clock.slice(11,16)>='20:00'?clock.slice(0,10):addDate(clock.slice(0,10),-1);
 // Sessions in the frozen overlap come from the archived feature reference.
 const overlap=['2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-27'];
 const dates=[...overlap,...new Set(calendar.filter(x=>x>'2026-10-27'&&x<=through))];
 let days={},marketDays={};
 const restored=await fetch(API,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(restored.ok){const previous=await unzip(await restored.arrayBuffer());if(previous.lock_id!==config.lock_id||previous.pool_sha256!==config.pool_sha256)throw Error('既存 C26 資料版本不符');days=previous.days||{};marketDays=previous.market_days||{}}
 else if(restored.status!==404)throw Error('無法讀取原有資料 HTTP '+restored.status);
 for(let i=0;i<dates.length;i++){
  const date=dates[i];
  if(i<dates.length-2&&days[date]?.source_state==='available'){progress(`沿用已核對 ${date}（${i+1}/${dates.length}）`);continue}
  const day={date,source_state:'partial',datasets:{},price:[],institutional:[],margin:[],lending:[],missing:[],invalid:[],source_errors:[],price_valid:0,institutional_codes:0};
  for(const [key,dataset] of Object.entries(datasets)){
   progress(`更新 ${date}（${i+1}/${dates.length}）・${{price:'日K',institutional:'法人',margin:'融資券',lending:'借券'}[key]}`);
   const all=(await pull(dataset,date)).filter(x=>x.date===date);
   if((key==='price'||key==='institutional')&&!all.length)throw Error(date+' '+dataset+' 回傳 0 筆，保留已驗證資料');
   const rows=all.filter(x=>pool.has(String(x.stock_id)));
   day.datasets[key]={total_rows:all.length,pool_rows:rows.length,state:'received'};
   if(key==='price'){
    day.price=rows.map(price).sort((a,b)=>a.stock_id.localeCompare(b.stock_id));
    if(new Set(day.price.map(x=>x.stock_id)).size!==day.price.length)throw Error(date+' 日K重複');
    const found=new Set(day.price.map(x=>x.stock_id));day.missing=config.codes.filter(x=>!found.has(x));day.invalid=day.price.filter(x=>!x.valid).map(x=>x.stock_id);day.price_valid=day.price.length-day.invalid.length;
   }else{day[key]=rows.map(x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='date')));if(key==='institutional')day.institutional_codes=new Set(rows.map(x=>String(x.stock_id))).size}
  }
  day.source_state=day.price_valid>=210&&day.institutional_codes>=190?'available':'partial';days[date]=day;
 }
 const boundary=new Map((days['2026-10-27']?.price||[]).map(x=>[x.stock_id,x.close]));
 if(!Object.entries(config.boundary).every(([code,mark])=>Number.isFinite(boundary.get(code))&&Math.abs(boundary.get(code)-mark)<=Math.max(.0005,Math.abs(mark)*1e-6)))throw Error('10/27 持股價格邊界不符，未覆寫雲端資料');
 const payload={lock_id:config.lock_id,source:'FinMind private Actions secret',reference_end:'2026-10-27',pool_sha256:config.pool_sha256,generated_at:new Date().toISOString(),through_requested:through,days,market_days:marketDays};
 progress('正在保存及核對雲端資料…');
 const ack=await request(token,'',{method:'POST',headers:{'content-type':'application/gzip'},body:await zip(payload)}).then(r=>r.json());
 const stored=await request(token,'/status').then(r=>r.json());
 if(!ack.stored||stored.sha256!==ack.sha256)throw Error('雲端保存核對失敗');
 return stored;
}
export function mountTokenPanel(doc=document){
 if(doc.getElementById('c26-device-token-panel'))return;
 const host=doc.querySelector('main');if(!host)return;
 const legacy=doc.getElementById('finmind-device-panel');
 legacy?.remove();
 try{if(!readToken()&&globalThis.TWFinMindTokens?.activeToken())saveToken(globalThis.TWFinMindTokens.activeToken())}catch{}
 globalThis.C26DeviceFinMind=Object.freeze({activeToken:()=>readToken(),headers:extra=>({...extra,...(readToken()?{Authorization:'Bearer '+readToken()}:{})})});
 const panel=doc.createElement('section');panel.id='c26-device-token-panel';
 panel.style.cssText='border:1px solid #b8ccbf;background:#f4faf6;border-radius:12px;padding:16px;margin:18px 0;color:#173b2d';
 panel.innerHTML='<h2 style="margin:0 0 8px;font-size:18px">FinMind Token · 僅記住此瀏覽器</h2><p style="margin:0 0 10px;font-size:13px">Token 只保存在此裝置的這個瀏覽器。更新時以 HTTPS 傳送，不寫入伺服器儲存。換裝置、換瀏覽器或清除網站資料後需重新輸入。</p><div style="display:flex;flex-wrap:wrap;gap:8px"><input id="c26-device-token" type="password" autocomplete="off" spellcheck="false" aria-label="FinMind Token" placeholder="貼上 FinMind Token" style="flex:1;min-width:180px;padding:10px;border:1px solid #aebfb3;border-radius:7px"><button id="c26-token-save" type="button">儲存到此瀏覽器</button><button id="c26-token-update" type="button">使用 Token 更新 C26 資料</button><button id="c26-token-clear" type="button">清除本機 Token</button></div><p id="c26-token-message" role="status" aria-live="polite" style="font-size:13px;margin:10px 0 0"></p>';
 const pacing=doc.createElement('div');pacing.id='c30-free-pacing-panel';
 pacing.style.cssText='margin-top:12px;padding:11px 12px;background:#e9f3ee;border:1px solid #b6cfbe;border-radius:9px';
 pacing.innerHTML='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:9px"><label for="c30-free-interval" style="font-weight:600">FinMind Free 請求間隔</label><input id="c30-free-interval" type="number" min="6.5" max="30" step="0.5" value="8" aria-describedby="c30-free-interval-hint" style="width:85px;padding:7px;border:1px solid #92b6a2;border-radius:7px;color:#173b2d;background:white"><span>秒／次</span><span id="c30-free-interval-current" style="font-size:13px;color:#176247">目前 8 秒（約 450 次／小時）</span></div><p id="c30-free-interval-hint" style="margin:6px 0 0;font-size:12px;color:#516c5c">可調 6.5～30 秒，每次 0.5 秒；同一瀏覽器保存設定，下載途中調整從下一筆請求生效。其他 App／裝置使用同一 Token 的流量不在此數字內。</p>';
 pacing.hidden=!['C30','A56'].includes(doc.getElementById('strategy')?.value);
 panel.append(pacing);
 const pacingInput=pacing.querySelector('#c30-free-interval'),pacingCurrent=pacing.querySelector('#c30-free-interval-current');
 const pacingText=ms=>'目前 '+(ms/1000).toFixed(1)+' 秒（約 '+Math.floor(3600000/ms)+' 次／小時）';
 const savedInterval=Number(globalThis.localStorage?.getItem('c30-a56-free-request-interval-ms-v1'));
 const initialInterval=Number.isFinite(savedInterval)&&savedInterval>=6500&&savedInterval<=30000&&savedInterval%500===0?savedInterval:8000;
 pacingInput.value=String(initialInterval/1000);pacingCurrent.textContent=pacingText(initialInterval);
 pacingInput.onchange=async()=>{try{const m=await import('../c30/free-sync.mjs?v=20261125-adjustable-v1');const ms=m.setC30FreeIntervalMs(Number(pacingInput.value)*1000);pacingInput.value=String(ms/1000);pacingCurrent.textContent=pacingText(ms);message.textContent='已儲存 Free 請求間隔 '+(ms/1000)+' 秒；不會刪除雲端資料。'}catch(e){message.textContent='間隔設定失敗：'+e.message;pacingInput.value=String(initialInterval/1000)}};
 const freeStop=doc.createElement('button');freeStop.id='c30-free-stop';freeStop.type='button';freeStop.textContent='暫停 Free 下載（已存資料保留）';freeStop.hidden=true;freeStop.onclick=async()=>{const m=await import('../c30/free-sync.mjs?v=20261125-free-v2');m.stopC30FreeSync();};panel.querySelector('div').append(freeStop);
 const download=doc.createElement('button');
 download.type='button';download.id='c26-archive-download';
 download.textContent=['C30','A56'].includes(doc.getElementById('strategy')?.value)?'下載 Free 雲端增量資料（NDJSON.gz）':'下載已存回測資料（ZIP）';
 panel.querySelector('div').append(download);
 const jobs=doc.createElement('a');
 jobs.href='/stock-futures-download.html';jobs.textContent='股期下載器已存任務';
 panel.querySelector('div').append(jobs);
 download.onclick=async()=>{
  download.disabled=true;
  try{
   if(['C30','A56'].includes(doc.getElementById('strategy')?.value)){
    const {exportC30A56FreeInputs}=await import('../c30/export-incremental.mjs?v=20261125-free-v2');
    await exportC30A56FreeInputs(readToken(),say,false);
    return;
   }
   const {buildArchive}=await import('./decision-download.mjs');
   const {blob,date}=await buildArchive(readToken(),name=>say('正在打包 '+name));
   const link=doc.createElement('a');
   link.href=URL.createObjectURL(blob);link.download='策略回測資料_'+date+'.zip';
   panel.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),60000);
   say('已產生 ZIP，日頻來源核對至 '+date+'。各資料集的日期與筆數請見 manifest.json。');
  }catch(error){say('下載未完成：'+error.message)}finally{download.disabled=false}
 };
 host.prepend(panel);
 const input=doc.getElementById('c26-device-token'),message=doc.getElementById('c26-token-message');
 const say=x=>message.textContent=x;
 input.value=readToken();say(input.value?'已記住此瀏覽器的 Token。':'尚未設定 Token。');
 doc.getElementById('c26-token-save').onclick=()=>{try{input.value=saveToken(input.value);say('已儲存在此瀏覽器。')}catch(e){say(e.message)}};
 doc.getElementById('c26-token-clear').onclick=()=>{clearToken();try{globalThis.TWFinMindTokens?.write({tokens:['',''],active:0})}catch{}input.value='';say('已清除這個瀏覽器的 Token。')};
 doc.getElementById('c26-token-update').textContent=['C30','A56'].includes(doc.getElementById('strategy')?.value)?'Free 更新 233 檔 C30/A56 資料':'使用 Token 更新 C26 資料';
 doc.getElementById('c26-token-update').onclick=async()=>{
  const buttons=panel.querySelectorAll('button');
  try{
   const token=saveToken(input.value);for(const b of buttons)b.disabled=true;const isFree=['C30','A56'].includes(doc.getElementById('strategy')?.value);if(isFree){freeStop.hidden=false;freeStop.disabled=false;}
   const selected=doc.getElementById('strategy')?.value;
   if(selected==='C30'||selected==='A56'){
    const free=await import('../c30/free-sync.mjs?v=20261125-free-v2');
    const state=await free.updateC30A56Free(token,say,{auto:false,maxRequests:1000});
    say(selected+' 免費增量：官方日K至 '+(state.latest_price_date||'尚未核對')+'，雲端 '+state.stored_days+' 個交易日；'+state.complete_days+' 個四類資料完整日；尚有 '+(state.pending||0)+' 組逐檔查詢待補'+(state.errors.length?'，失敗 '+state.errors.length+' 組':'')+'。關閉網頁後雲端已存內容保留；原策略需獨立引擎重播。');
    if(typeof globalThis.poll==='function')globalThis.poll(false);
    return;
   }
   const status=await updateDeviceSource(token,say);
   if(doc.getElementById('strategy')?.value==='A56'){
    const queued=await fetch('/api/c26/a56/refresh',{method:'POST',cache:'no-store'});if(!queued.ok)throw Error('A56原引擎更新排程未成功');
    say('資料已保存並核對至 '+status.source_as_of+'；已請求 A56 合併帳本與盤前計畫更新，完成後主頁同步重載。');
    if(typeof globalThis.poll==='function')globalThis.poll();
   }else say('資料已保存並核對至 '+status.source_as_of+'；'+status.available_days+' 個接續交易日。C26 交易計畫仍須通過原引擎逐日重播。');
  }catch(e){say('更新未完成：'+e.message)}finally{for(const b of buttons)b.disabled=false;freeStop.hidden=true}
 };
}
if(typeof document!=='undefined')mountTokenPanel();
