/* C30/A56 233-symbol complete cloud archive export.
 * A single ZIP (stored entries) with individually gzip-compressed per-day NDJSON.
 * No FinMind network calls. No claim that frozen 2016-2026 original raw files are online.
 */
import {c30FreeToken,c30FreeStatus,c30FreeDownloadDay} from './free-sync.mjs?v=20261125-sponsor-diagnose-v5';
const ROOT='/api/c30/free/';
const enc=new TextEncoder();
const u16=(v,i,n)=>v.setUint16(i,n,true);
const u32=(v,i,n)=>v.setUint32(i,n>>>0,true);
const CRC_TABLE=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xedb88320^(c>>>1)):(c>>>1);CRC_TABLE[n]=c>>>0}
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function nameSafe(s){return String(s).replace(/[\/\\\0-\x1f]/g,'_').slice(0,180)}
class ZipWriter{
 constructor(fileWriter=null){this.target=fileWriter;this.parts=[];this.entries=[];this.offset=0;this.closed=false}
 async write(data){if(this.offset+data.byteLength>0xffffffff)throw Error('這份封存超過 ZIP 4GB 上限，請分批匯出或改用 ZIP64');if(!this.target&&this.offset+data.byteLength>350*1024*1024)throw Error('瀏覽器記憶體下載已超過 350MB，請改用支援檔案串流保存的桌面瀏覽器，或分批匯出');if(this.target)await this.target.write(data);else this.parts.push(data);this.offset+=data.byteLength}
 async add(name,blob){
  if(this.entries.length>=65534)throw Error('ZIP 檔案項目過多');
  name=nameSafe(name.replaceAll('\\','/')).replaceAll('_','_'); // flat safe names; no traversal
  const nameBytes=enc.encode(name);
  if(nameBytes.length>65535)throw Error('ZIP filename too long');
  blob=blob instanceof Blob?blob:new Blob([blob]);
  if(blob.size>0xffffffff)throw Error('單個 ZIP 項目超過 4GB');
  const size=blob.size,start=this.offset,STEP=4*1024*1024;
  let accumulator=0xffffffff;
  for(let at=0;at<size;at+=STEP){const part=new Uint8Array(await blob.slice(at,Math.min(size,at+STEP)).arrayBuffer());for(const byte of part)accumulator=CRC_TABLE[(accumulator^byte)&255]^(accumulator>>>8)}
  const crc=(accumulator^0xffffffff)>>>0;
  const head=new Uint8Array(30+nameBytes.length),v=new DataView(head.buffer);
  u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x0800);u16(v,8,0);u32(v,14,crc);u32(v,18,size);u32(v,22,size);u16(v,26,nameBytes.length);
  head.set(nameBytes,30);await this.write(head);for(let at=0;at<size;at+=STEP)await this.write(new Uint8Array(await blob.slice(at,Math.min(size,at+STEP)).arrayBuffer()));
  this.entries.push({nameBytes,size,crc,start});
 }
 async finish(){
  const start=this.offset;
  for(const {nameBytes,size,crc,start:original} of this.entries){
   const head=new Uint8Array(46+nameBytes.length),v=new DataView(head.buffer);
   u32(v,0,0x02014b50);u16(v,4,20);u16(v,6,20);u16(v,8,0x0800);u16(v,10,0);u32(v,16,crc);u32(v,20,size);u32(v,24,size);u16(v,28,nameBytes.length);u32(v,42,original);
   head.set(nameBytes,46);await this.write(head)
  }
  const directoryBytes=this.offset-start;
  const foot=new Uint8Array(22),f=new DataView(foot.buffer);
  u32(f,0,0x06054b50);u16(f,8,this.entries.length);u16(f,10,this.entries.length);u32(f,12,directoryBytes);u32(f,16,start);
  await this.write(foot);
  this.closed=true;
  if(this.target){await this.target.close();return null}
  return new Blob(this.parts,{type:'application/zip'})
 }
 async abort(){try{await this.target?.abort?.()}catch{}}
}
async function gzip(text){
 const b=new Blob([text],{type:'application/x-ndjson'});
 return typeof CompressionStream==='function'?new Response(b.stream().pipeThrough(new CompressionStream('gzip'))).blob():b
}
const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';
async function fetchMinutes(token,date,codes,signal){
 const params=new URLSearchParams({date,dataset:'minute',codes:codes.join(',')});
 const r=await fetch(ROOT+'day?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal});
 const x=await r.json().catch(()=>({}));
 if(!r.ok||!x.ok)throw Error('雲端 '+date+' 分 K 讀取失敗 '+(x.error||r.status));
 return x.items||[];
}
async function previousLocalMinuteRecords(){
 if(typeof indexedDB==='undefined')return [];
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open('C30_StockMinute_Free_v1',1),items=[];
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('days')){const st=db.createObjectStore('days',{keyPath:'id'});st.createIndex('date','date')}};
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{
   const db=req.result,tx=db.transaction('days','readonly');
   tx.objectStore('days').openCursor().onsuccess=e=>{const x=e.target.result;if(x){items.push(x.value);x.continue()}};
   tx.oncomplete=()=>{db.close();resolve(items)};
   tx.onerror=()=>{db.close();reject(tx.error)}
  }
 })
}
async function syncPreviouslyDownloadedMinutes(token,progress,signal){
 const records=await previousLocalMinuteRecords();
 if(!records.length)return {found:0,saved:0,skipped:0};
 const old=await c30FreeStatus(token),done=new Map();
 for(const d of old.days||[])done.set(d.date,new Set(d.minute?.saved_codes||[]));
 let saved=0,skipped=0;
 const taipei=new Date(Date.now()+8*3600000).toISOString(),date=taipei.slice(0,10),cutoff=taipei.slice(11,16)>='20:00'?date:new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 for(let i=0;i<records.length;i++){
  if(signal?.aborted)throw Error('你已取消匯出');
  const rec=records[i];if(!rec||!/^20\d{2}-\d{2}-\d{2}$/.test(rec.date)||rec.date<'2026-11-23'||rec.date>cutoff||!(/^\d{4}$/.test(rec.code))||done.get(rec.date)?.has(rec.code)){skipped++;continue}
  if(!['TWSE','TPEx'].includes(rec.market)||!['Fugle Free API','Yahoo chart fallback'].includes(rec.provider)){skipped++;continue}
  const bars=(rec.rows||[]).map(x=>({date:rec.date,minute:x[0],stock_id:rec.code,open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume_shares:Number(x[5])}));
  if(!bars.length){skipped++;continue}
  const ack=await fetch(ROOT+'minute',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({code:rec.code,market:rec.market,provider:rec.provider,bars}),signal});
  const result=await ack.json().catch(()=>({}));
  if(!ack.ok||!result.ok)throw Error('舊本機分K '+rec.date+' '+rec.code+' 雲端同步失敗：'+(result.error||ack.status));
  const set=done.get(rec.date)||new Set();set.add(rec.code);done.set(rec.date,set);saved++;
  if(saved%20===0)progress('同步本機舊分K至雲端：成功 '+saved+'、已略過 '+skipped+'，共 '+records.length+' 筆股票日');
 }
 return {found:records.length,saved,skipped}
}
async function legacyFileLines(files){return (files||[]).map(x=>({name:x.name,bytes:x.size}))}
export async function exportC30A56AllArchived({
 token=c30FreeToken(),progress=()=>{},includeMinutes=true,legacyFiles=[],syncLocalMinutes=true,signal=null
}={}){
 if(!token)throw Error('請先在原本的 Token 欄位保存 FinMind Token');
 const fileName='C30_A56_233_全部已存資料_'+new Date(Date.now()+8*3600000).toISOString().slice(0,10)+'.zip';
 // File picker must be invoked during the actual button click, before awaiting network I/O.
 let target=null;
 if(typeof globalThis.showSaveFilePicker==='function'){
  try{const handle=await globalThis.showSaveFilePicker({suggestedName:fileName,types:[{description:'ZIP 資料備份',accept:{'application/zip':['.zip']}}]});target=await handle.createWritable()}
  catch(e){if(e.name==='AbortError')throw Error('你已取消另存新檔');progress('無法使用檔案串流儲存，改用瀏覽器下載 ZIP')}
 }
 const zip=new ZipWriter(target);
 const check=()=>{if(signal?.aborted)throw Error('已取消資料匯出，已保存的雲端資料不會刪除')};
 try{
  check();
  const localSync=syncLocalMinutes?await syncPreviouslyDownloadedMinutes(token,progress,signal):{found:0,saved:0,skipped:0};
  const [status,poolResponse]=await Promise.all([c30FreeStatus(token),fetch('/c30/pool.json',{cache:'force-cache',signal})]);
  if(!poolResponse.ok)throw Error('233 檔固定股池未取得');
  const pool=await poolResponse.json();if(pool.stocks?.length!==233)throw Error('股票池不是 233 檔');
  const days=[...(status.days||[])].sort((a,b)=>a.date.localeCompare(b.date));
  if(!days.length&&!legacyFiles.length)throw Error('雲端沒有可下載的資料；請先完成每日更新或選取舊封存檔');
  const missing=['date,dataset,stock_id,coverage'];
  for(const d of days){
   const present={TaiwanStockPrice:new Set(d.price?.saved_codes||[]),
    TaiwanStockInstitutionalInvestorsBuySell:new Set(d.chips?.TaiwanStockInstitutionalInvestorsBuySell?.saved_codes||[]),
    TaiwanStockMarginPurchaseShortSale:new Set(d.chips?.TaiwanStockMarginPurchaseShortSale?.saved_codes||[]),
    TaiwanStockSecuritiesLending:new Set(d.chips?.TaiwanStockSecuritiesLending?.saved_codes||[]),
    TaiwanStockKBar:new Set(d.minute?.saved_codes||[])};
   for(const [type,have] of Object.entries(present))for(const x of pool.stocks)if(!have.has(x.code))missing.push([d.date,type,x.code,'missing_or_not_applicable'].map(quote).join(','))
  }
  const manifest={format:'C30-A56-233-ARCHIVED-RAW-V3',created_at:new Date().toISOString(),
   scope:'All data ACTUALLY present in this token cloud vault, plus optionally attached local legacy files',
   frozen_universe:233,base_engine_validated_to:'2026-11-20',model_replayed:false,
   sources:['TWSE/TPEx daily EOD','FinMind Free per-symbol','FinMind Sponsor day batch / stock 1m','Fugle/Yahoo stock minute'],
   exported_dates:days.map(d=>d.date),include_minutes:includeMinutes,
   counts:days.map(d=>({date:d.date,price:d.price?.saved_codes?.length||0,chip:Object.fromEntries(Object.entries(d.chips||{}).map(([k,v])=>[k,v.saved_codes?.length||0])),minute:d.minute?.saved_codes?.length||0})),
   legacy_files:await legacyFileLines(legacyFiles),local_minute_sync:localSync,
   limitations:['Existing historical raw 2016-2026 DB from other archives is NOT automatically copied into this token vault',
    'Missing or suspended-stock data is listed in missing.csv, and must not be fabricated',
    'Frozen original C30/A56 Python trading engine is NOT run by an export']};
  progress('正在建立 ZIP 清單：'+days.length+' 個交易日、'+legacyFiles.length+' 個舊封存檔');
  await zip.add('manifest.json',JSON.stringify(manifest,null,2));
  await zip.add('missing.csv',new Blob(['\uFEFF'+missing.join('\n')+'\n'],{type:'text/csv;charset=utf-8'}));
  await zip.add('universe_233.json',JSON.stringify(pool,null,2));
  await zip.add('README.txt','This ZIP contains all C30/A56 raw records actually saved in the current private token cloud cache. Historical 2016-2026 raw files only appear if explicitly selected as legacy attachments. Strategies are not replayed.\n');
  const baseline=await fetch('/r1494a/c30/history.b64',{cache:'force-cache',signal});
  if(baseline.ok)await zip.add('C30_original_frozen_model_history.b64',await baseline.blob());
  for(let i=0;i<days.length;i++){
   check();const d=days[i],date=d.date;progress('雲端匯出 '+(i+1)+'/'+days.length+'：'+date+' 日K、籌碼');
   const daily=await c30FreeDownloadDay(date,null,token);
   const lines=[JSON.stringify({kind:'daily',date,datasets:daily.datasets,model_replayed:false})];
   if(includeMinutes){
    const symbols=[...new Set(d.minute?.saved_codes||[])].sort();
    for(let k=0;k<symbols.length;k+=12){
     check();const part=await fetchMinutes(token,date,symbols.slice(k,k+12),signal);
     for(const item of part)lines.push(JSON.stringify({kind:'minute',date,stock_id:item.code,market:item.market,source:item.provider,bars:item.bars||[]}));
     progress('雲端匯出 '+(i+1)+'/'+days.length+'：'+date+'，分鐘 '+Math.min(k+12,symbols.length)+'/'+symbols.length+' 檔')
    }
   }
   const compressed=await gzip(lines.join('\n')+'\n');
   await zip.add('day_'+date+'.ndjson'+(typeof CompressionStream==='function'?'.gz':''),compressed)
  }
  for(let i=0;i<legacyFiles.length;i++){
   check();const file=legacyFiles[i];progress('加入既有歷史封存 '+(i+1)+'/'+legacyFiles.length+'：'+file.name);
   await zip.add('legacy_'+String(i+1).padStart(2,'0')+'_'+nameSafe(file.name),file)
  }
  progress('正在完成 ZIP 索引與完整檔案…');
  const blob=await zip.finish();
  if(blob){
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
  }
  progress('完成：'+fileName+'。含 '+days.length+' 個雲端資料日、'+legacyFiles.length+' 個舊封存，'+(includeMinutes?'已保存的現股1分K':'未勾選分K')+'；沒有重新呼叫 FinMind。');
  return {fileName,dates:days.length,missing:missing.length-1,legacy_files:legacyFiles.length,zip_bytes:zip.offset}
 }catch(e){await zip.abort();throw e}
}
