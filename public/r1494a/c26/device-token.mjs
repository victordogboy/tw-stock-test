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
 pacing.innerHTML='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-bottom:8px"><label for="c30-source-tier" style="font-weight:600">FinMind 會員資料模式</label><select id="c30-source-tier" style="padding:8px;color:#173b2d;background:white;border:1px solid #92b6a2;border-radius:7px"><option value="free">Free：逐檔補齊</option><option value="sponsor">Sponsor（S）：整日籌碼＋現股1分K</option></select></div><div style="display:flex;align-items:center;flex-wrap:wrap;gap:9px"><label for="c30-free-interval" style="font-weight:600">每次 API 請求間隔</label><input id="c30-free-interval" type="number" min="1" max="30" step="0.5" value="1" aria-describedby="c30-free-interval-hint" style="width:90px;padding:7px;border:1px solid #92b6a2;border-radius:7px;color:#173b2d;background:white"><span>秒／次</span><span id="c30-free-interval-current" style="font-size:13px;color:#176247">Free 預設 1.0 秒</span></div><p id="c30-free-interval-hint" style="margin:6px 0 0;font-size:12px;color:#516c5c">Free 最快 1 秒、Sponsor S 預設 0.1 秒且可降至 0.05 秒。Sponsor 官方每小時上限 6,000 次，本網站安全額度為 5,600 次；高速只適合短時間補檔，達額度會自動暫停。實際請求也受 API 回應時間與其他裝置流量影響。</p>';
 pacing.hidden=!['C30','A56'].includes(doc.getElementById('strategy')?.value);
 panel.append(pacing);
 const pacingInput=pacing.querySelector('#c30-free-interval'),pacingCurrent=pacing.querySelector('#c30-free-interval-current'),tierSelect=pacing.querySelector('#c30-source-tier');
 tierSelect.value=globalThis.localStorage?.getItem('c30-a56-source-tier-v1')==='sponsor'?'sponsor':'free';
 const pacingText=(ms,tier)=> (tier==='sponsor'?'Sponsor S':'Free')+' '+(ms/1000).toFixed(2)+' 秒／次；短時間理論 '+Math.floor(3600000/ms).toLocaleString('zh-TW')+' 次／小時，額度限制 '+(tier==='sponsor'?'6,000':'600')+' 次／小時';
 function applyTierPacing(){
  const tier=tierSelect.value,sponsor=tier==='sponsor',key=sponsor?'c30-a56-sponsor-request-interval-ms-v1':'c30-a56-request-interval-ms-v2',min=sponsor?50:1000,step=sponsor?50:500;
  const raw=globalThis.localStorage?.getItem(key),candidate=raw?Number(raw):NaN,ms=Number.isFinite(candidate)&&candidate>=min&&candidate<=30000&&candidate%step===0?candidate:(sponsor?100:1000);
  pacingInput.min=String(min/1000);pacingInput.max='30';pacingInput.step=String(step/1000);pacingInput.value=String(ms/1000);
  pacingCurrent.textContent=pacingText(ms,tier);
 }
 applyTierPacing();
 tierSelect.onchange=async()=>{
  try{const m=await import('../c30/free-sync.mjs?v=20261125-sponsor-diagnose-v5');m.setC30SourceTier(tierSelect.value);applyTierPacing();message.textContent='已切換 '+(tierSelect.value==='sponsor'?'Sponsor S（預設 0.1 秒）':'Free（預設 1 秒）')+'；先前雲端資料仍保留。'}
  catch(e){message.textContent='切換失敗：'+e.message}
 };
 pacingInput.onchange=async()=>{
  try{const m=await import('../c30/free-sync.mjs?v=20261125-sponsor-diagnose-v5'),ms=m.setC30FreeIntervalMs(Number(pacingInput.value)*1000,tierSelect.value);pacingInput.value=String(ms/1000);pacingCurrent.textContent=pacingText(ms,tierSelect.value);message.textContent='已儲存 '+(ms/1000).toFixed(2)+' 秒／次；後續請求套用，達每小時額度仍會自動停止。'}
  catch(e){message.textContent='設定失敗：'+e.message;applyTierPacing()}
 };
 const backupOptions=doc.createElement('div');backupOptions.id='c30-backup-options';backupOptions.style.cssText='margin-top:9px;padding:10px;background:#f4faf6;border:1px solid #b8ccbf;border-radius:9px';
 backupOptions.hidden=!['C30','A56'].includes(doc.getElementById('strategy')?.value);
 backupOptions.innerHTML='<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><label><input type="checkbox" id="c30-backup-minutes" checked> ZIP 包含所有雲端現股 1 分 K</label><label><input type="checkbox" id="c30-backup-sync-local" checked> 匯出前同步本機舊分 K（不重下載）</label><label>可選擇原本十年歷史 ZIP／CSV 一併打包：<input type="file" id="c30-backup-legacy" multiple accept=".zip,.csv,.gz,.npz,.json,.parquet" style="max-width:250px"></label></div><p style="font-size:12px;margin:5px 0;color:#5b7261">包含雲端日K、籌碼、已保存分K、233檔股票池、缺漏清單和凍結模型快照；以前未上傳的原始十年資料需自行選取，系統不會虛構。</p>';
 panel.append(backupOptions);
 const backupCancel=doc.createElement('button');backupCancel.id='c30-backup-cancel';backupCancel.type='button';backupCancel.textContent='取消 ZIP 匯出';backupCancel.hidden=true;let backupAbort=null;backupCancel.onclick=()=>backupAbort?.abort();panel.append(backupCancel);
 const diagnosePanel=doc.createElement('section');diagnosePanel.id='c30-diagnostic-panel';
 diagnosePanel.hidden=!['C30','A56'].includes(doc.getElementById('strategy')?.value);
 diagnosePanel.style.cssText='margin-top:10px;padding:12px;border:1px solid #deb885;border-radius:9px;background:#fffaf1';
 diagnosePanel.innerHTML='<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px"><button id="c30-sponsor-test" type="button" style="border-color:#9d7b47;background:#fff4d7;color:#624714;font-weight:600">測試 Sponsor 日K＋分K（最多2筆）</button><span style="font-size:12px;color:#7a694e">先驗證 FinMind 回傳格式與權限，再大量下載；不會刪除雲端資料</span></div><pre id="c30-diagnostic-output" style="white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0;font-size:12px;max-height:220px;overflow:auto;color:#523d2b">尚未診斷。若上次下載失敗，這裡會顯示保留的錯誤原因。</pre>';
 panel.append(diagnosePanel);
 const freeStop=doc.createElement('button');
 freeStop.type='button';freeStop.textContent='停止背景補檔';freeStop.hidden=true;panel.querySelector('div').append(freeStop);
 let backgroundPoll;
 const backgroundCall=async(path,token,body)=>{
  const response=await fetch('/api/c30/background/'+path,{cache:'no-store',method:body?'POST':'GET',headers:{authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'背景任務 HTTP '+response.status);
  return data.job;
 };
 const renderBackground=job=>{
  if(!job)return;
  const active=['queued','running','waiting'].includes(job.state);
  freeStop.hidden=!active;
  const labels={queued:'已排程',running:'補檔中',waiting:'等待 API 額度或請求間隔',cancelled:'已停止',completed:'已完成',partial:'完成但有缺漏',failed:'失敗',expired:'已逾時，可再續傳'};
  backgroundStatus.textContent='背景補檔'+labels[job.state]+'｜成功 '+job.done+' 組'+(job.current&&active?'｜'+job.current:'')+(job.errors.length?'｜最後錯誤 '+job.errors.at(-1):'');
  if(!active){clearInterval(backgroundPoll);backgroundPoll=null}
 };
 const backgroundStatus=doc.createElement('p');backgroundStatus.setAttribute('role','status');panel.append(backgroundStatus);
 const watchBackground=async(token,job)=>{
  if(job)renderBackground(job);
  const check=async()=>{
   const state=await backgroundCall('status',token);
   renderBackground(state);
   return ['queued','running','waiting'].includes(state?.state);
  };
  clearInterval(backgroundPoll);
  if(await check())backgroundPoll=setInterval(()=>check().catch(()=>{}),3000);
 };
 freeStop.onclick=async()=>{
  try{renderBackground(await backgroundCall('stop',readToken(),{}))}
  catch(error){backgroundStatus.textContent=error.message}
 };
 const download=doc.createElement('button');
 download.type='button';download.id='c26-archive-download';
 download.textContent=['C30','A56'].includes(doc.getElementById('strategy')?.value)?'下載全部已封存的 233 檔資料（ZIP）':'下載已存回測資料（ZIP）';
 panel.querySelector('div').append(download);
 const jobs=doc.createElement('a');
 jobs.href='/stock-futures-download.html';jobs.textContent='股期下載器已存任務';
 panel.querySelector('div').append(jobs);
 download.onclick=async()=>{
  download.disabled=true;
  try{
   if(['C30','A56'].includes(doc.getElementById('strategy')?.value)){
    backupAbort=new AbortController();backupCancel.hidden=false;
    const {exportC30A56AllArchived}=await import('../c30/export-all-zip.mjs?v=20261125-sponsor-diagnose-v5');
    await exportC30A56AllArchived({token:readToken(),progress:say,includeMinutes:doc.getElementById('c30-backup-minutes').checked,
      legacyFiles:[...doc.getElementById('c30-backup-legacy').files],syncLocalMinutes:doc.getElementById('c30-backup-sync-local').checked,signal:backupAbort.signal});
    return;
   }
   const {buildArchive}=await import('./decision-download.mjs');
   const {blob,date}=await buildArchive(readToken(),name=>say('正在打包 '+name));
   const link=doc.createElement('a');
   link.href=URL.createObjectURL(blob);link.download='策略回測資料_'+date+'.zip';
   panel.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),60000);
   say('已產生 ZIP，日頻來源核對至 '+date+'。各資料集的日期與筆數請見 manifest.json。');
  }catch(error){say('下載未完成：'+error.message)}finally{download.disabled=false;backupCancel.hidden=true;backupAbort=null}
 };
 host.prepend(panel);
 const input=doc.getElementById('c26-device-token'),message=doc.getElementById('c26-token-message');
 const say=x=>message.textContent=x;
 const diagnosis=doc.getElementById('c30-diagnostic-output');
 try{const last=JSON.parse(globalThis.localStorage?.getItem('c30-a56-last-source-diagnostics-v1')||'{}');
  if(last.items?.length)diagnosis.textContent='上次錯誤（'+(last.at||'')+'）：\n'+last.items.slice(-5).map(x=>[x.label||x.dataset||x.path,'HTTP '+(x.http||'?'),x.code||'',x.error||''].filter(Boolean).join('｜')).join('\n')
 }catch{}
 doc.getElementById('c30-sponsor-test').onclick=async()=>{
  const button=doc.getElementById('c30-sponsor-test');button.disabled=true;
  try{
   const token=saveToken(input.value),m=await import('../c30/free-sync.mjs?v=20261125-sponsor-diagnose-v5');
   const result=await m.diagnoseC30Sponsor(token,x=>{diagnosis.textContent=x;say(x)});
   diagnosis.textContent='Sponsor 單筆診斷（'+result.date+'）：\n'+result.results.map(x=>x.dataset+'｜'+(x.ok?'成功 '+x.rows+' 筆':'失敗 HTTP '+(x.http||'?')+' ['+(x.code||'-')+'] '+x.message)).join('\n')+
    '\n'+(result.ok?'兩種資料都可讀取，現在可以開始增量下載。':'至少一項失敗。請先檢查上述 HTTP／原因；大量補檔不應繼續。');
  }catch(e){diagnosis.textContent='診斷中止：'+String(e.message||e)}
  finally{button.disabled=false}
 };

 input.value=readToken();if(input.value)watchBackground(input.value).catch(()=>{});say(input.value?'已記住此瀏覽器的 Token。':'尚未設定 Token。');
 doc.getElementById('c26-token-save').onclick=()=>{try{input.value=saveToken(input.value);say('已儲存在此瀏覽器。')}catch(e){say(e.message)}};
 doc.getElementById('c26-token-clear').onclick=()=>{clearToken();try{globalThis.TWFinMindTokens?.write({tokens:['',''],active:0})}catch{}input.value='';say('已清除這個瀏覽器的 Token。')};
 doc.getElementById('c26-token-update').textContent=['C30','A56'].includes(doc.getElementById('strategy')?.value)?'更新 233 檔（Free／Sponsor S）':'使用 Token 更新 C26 資料';
 doc.getElementById('c26-token-update').onclick=async()=>{
  const buttons=panel.querySelectorAll('button');
  try{
   const token=saveToken(input.value);for(const b of buttons)b.disabled=true;
   const selected=doc.getElementById('strategy')?.value;
   if(selected==='C30'||selected==='A56'){
    const free=await import('../c30/free-sync.mjs?v=20261125-sponsor-diagnose-v5');
    const job=await backgroundCall('start',token,{tier:free.getC30SourceTier(),interval:free.getC30FreeIntervalMs()});
    await watchBackground(token,job);
    say('背景任務已提交，可以離開頁面。FinMind Token 僅在補檔任務期間加密暫存。');
    return;
   }
   const status=await updateDeviceSource(token,say);
   if(doc.getElementById('strategy')?.value==='A56'){
    const queued=await fetch('/api/c26/a56/refresh',{method:'POST',cache:'no-store'});if(!queued.ok)throw Error('A56原引擎更新排程未成功');
    say('資料已保存並核對至 '+status.source_as_of+'；已請求 A56 合併帳本與盤前計畫更新，完成後主頁同步重載。');
    if(typeof globalThis.poll==='function')globalThis.poll();
   }else say('資料已保存並核對至 '+status.source_as_of+'；'+status.available_days+' 個接續交易日。C26 交易計畫仍須通過原引擎逐日重播。');
  }catch(e){say('更新未完成：'+e.message)}finally{for(const b of buttons)b.disabled=false}
 };
}
if(typeof document!=='undefined')mountTokenPanel();
