/* R23.1: the browser only submits/polls jobs. Closing it never stops server alarms. */
(()=>{
 const KEY='twq_background_scan_key_r23',PENDING='twq_background_scan_pending_r23';
 const filters=['minClose','maxClose','minLots','maxStocks','concurrency','finTopN'];
 let timer=null,polling=false,submitting=false,cloudActive=false,lastJob=null;
 const legacyStop=$('stopBtn').onclick;
 function localKey(){try{return localStorage.getItem(KEY)}catch{return null}}
 function validKey(v){return typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)}
 function databaseKey(create=false){
  return new Promise((resolve,reject)=>{
   let db,tx,settled=false,value=null;
   const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(db)db.close();error?reject(error):resolve(value)};
   const timeout=setTimeout(()=>{try{tx?.abort()}catch{}finish(Error('背景工作識別碼儲存逾時'))},5000);
   let open;try{open=indexedDB.open('twq-background-scan',1)}catch(e){finish(e);return}
   open.onupgradeneeded=()=>open.result.createObjectStore('identity');
   open.onerror=()=>finish(open.error);open.onblocked=()=>finish(Error('背景工作儲存被其他分頁阻擋'));
   open.onsuccess=()=>{
    db=open.result;if(settled){db.close();return}
    try{
     tx=db.transaction('identity',create?'readwrite':'readonly');const store=tx.objectStore('identity'),read=store.get(KEY);
     read.onsuccess=()=>{
      value=read.result||null;
      if(value&&!validKey(value)){tx.abort();return}
      // Read and create in one transaction so two tabs cannot create different identities.
      if(!value&&create){value=randomKey();store.put(value,KEY)}
     };
     tx.oncomplete=()=>finish();tx.onerror=()=>finish(tx.error||Error('背景工作識別碼儲存失敗'));tx.onabort=()=>finish(tx.error||Error('背景工作識別碼儲存失敗'));
    }catch(e){finish(e)}
   };
  });
 }
 function randomKey(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')}
 async function key(create=false){
  let v=localKey();if(v){if(!validKey(v))throw Error('背景工作識別碼格式不正確');return v}
  try{v=await databaseKey(false);if(v)return v}catch{}
  if(!create)return null;
  // Recheck after async storage access in case another tab created the local identity.
  v=localKey();if(validKey(v))return v;
  v=randomKey();
  try{localStorage.setItem(KEY,v);if(localStorage.getItem(KEY)===v)return v}catch{}
  // localStorage may be full of old snapshots. Keep all tokens/watchlists/caches intact.
  try{v=await databaseKey(true);if(validKey(v))return v}catch{}
  throw Error('無法持久保存背景工作識別碼，尚未送出掃描；請允許此網站儲存資料後重試');
 }
 function busy(on){
  cloudActive=on;scanBusy=on;setScanControlsBusy(on);$('scanBtn').disabled=on;$('refreshLiveBtn').disabled=on;
  for(const k of filters)$(k).disabled=on;
 }
 async function call(method='GET',body){
  const headers={'X-Scan-Key':await key(method==='POST')||''};
  if(method==='POST')Object.assign(headers,finmindAuthHeaders({'Content-Type':'application/json'}));
  const r=await fetch('/api/scan/job',{method,headers,cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  let j;try{j=await r.json()}catch{throw Error('伺服器未回傳背景掃描資料')}
  if(!r.ok||j.ok===false)throw Error(j.error||'背景掃描連線失敗');return j.job;
 }
 function apply(job){
  if(!job){busy(false);$('status').textContent='目前沒有背景工作（或已超過 24 小時）；可開始新掃描。';return}
  try{localStorage.removeItem(PENDING)}catch{}
  busy(job.active);
  // Keep a newer manual quote refresh when returning to an already imported completed job.
  let cached;try{cached=JSON.parse(localStorage.getItem(SCAN_STATE_KEY)||'null')}catch{}
  const preserveLocal=!job.active&&cached?.backgroundJobComplete&&cached.backgroundJobId===job.id&&cached.savedAt>=job.updatedAt;
  if(lastJob!==job.id&&cached?.backgroundJobId!==job.id)currentRank=job.options.selection;
  lastJob=job.id;
  window.__backgroundScanJobId=job.id;window.__backgroundScanJobComplete=!job.active;
  scanSelection=job.options.selection;scanSelectionWeights=job.options.weights;
  scanSelectionDualWeights=job.options.dualWeights||TWDualAction.defaults;
  if(job.active&&job.options.dualWeights)dualControls?.set(job.options.dualWeights);
  $('scanType').value=scanSelection;
  for(const k of filters)$(k).value=job.options[k];
  SCAN_FILTERS={minClose:job.options.minClose,maxClose:job.options.maxClose,minLots:job.options.minLots};
  SCAN_TARGET_DATE=job.targetDate;SCAN_TARGET_SOURCE=job.targetSource||'';
  if(preserveLocal){$('status').textContent=job.message+'｜已保留此瀏覽器最近更新的榜單';return}
  results=job.results||[];errors=job.errors||[];
  $('errors').textContent=errors.join(' | ')||'—';
  const phases={initializing:0,scanning:5,formalizing:75,chips:83,live:93};
  const spans={initializing:0,scanning:70,formalizing:8,chips:10,live:7};
  $('prog').value=job.phase==='completed'?100:(phases[job.phase]||0)+(spans[job.phase]||0)*(job.total?job.done/job.total:0);
  $('status').textContent=(job.active?'伺服器已接收｜':'')+job.message+(job.active?'｜可離開瀏覽器，掃描會繼續':'');
  $('stats').textContent=`全市場 ${job.universe}｜已掃描 ${job.scanned}｜符合 ${job.qualified}｜略過 ${job.skipped}｜資料日 ${job.targetDate||'確認中'}｜更新 ${new Date(job.updatedAt).toLocaleTimeString('zh-TW')}｜結果保留至 ${new Date(job.expiresAt).toLocaleString('zh-TW')}`;
  if(job.futures)$('futuresStatus').textContent=`期貨名單：${job.futures.source}｜${job.futures.count} 檔${job.futures.degraded?'（備援）':''}`;
  showRank(currentRank);
  if(!results.length&&job.phase==='completed'){
   // An empty completed job is a real result, not a reason to resurrect an old ranking.
   persistScan(true);
  }
 }
 function later(){clearTimeout(timer);if(cloudActive&&document.visibilityState==='visible')timer=setTimeout(poll,5000)}
 async function poll(){
  if(polling||submitting)return;polling=true;
  try{if(!await key())return;apply(await call())}catch(e){$('status').textContent='暫時無法讀取進度：'+e.message+'。伺服器上的工作不會因手機斷線停止，回到頁面會重連。'}
  finally{polling=false;later()}
 }
 $('scanBtn').onclick=async()=>{
  if(scanBusy||submitting)return;
  if(!scanWeightsValid||!dualWeightsValid){$('status').textContent='請確認原 Action 及進場／續抱兩組權重各合計 100%。';return}
  submitting=true;busy(true);clearTimeout(timer);
  try{
   await key(true);
   const id=crypto.randomUUID(),options={selection:$('scanType').value,weights:{...scanWeights},dualWeights:JSON.parse(JSON.stringify(dualWeights))};
   for(const k of filters)options[k]=Number($(k).value);
   currentRank=options.selection;
   $('status').textContent='正在提交背景工作，請等候伺服器確認…';
   apply(await call('POST',{id,options}));
  }catch(e){
   $('status').textContent='背景工作尚未確認：'+e.message+'。請按「讀取背景進度」確認。';
   // Do not silently fall back to a browser scan or create a duplicate after a lost response.
   busy(false);
  }finally{submitting=false;later()}
 };
 $('stopBtn').onclick=async()=>{
  if(!cloudActive){legacyStop();return}
  try{apply(await call('DELETE'));clearTimeout(timer)}catch(e){$('status').textContent='停止尚未確認：'+e.message+'，請重試。'}
 };
 $('reconnectScanBtn').onclick=async()=>{try{if(!await key()){$('status').textContent='此瀏覽器尚未啟動背景掃描。';return}await poll()}catch(e){$('status').textContent=e.message}};
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();else clearTimeout(timer)});
 window.addEventListener('online',poll);window.addEventListener('pageshow',poll);
 // Keep existing watchlists, token slots, weights and ranking caches under their original keys.
 (async()=>{try{if(await key()&&!submitting){busy(true);await poll()}}catch(e){$('status').textContent=e.message}})();
})();
