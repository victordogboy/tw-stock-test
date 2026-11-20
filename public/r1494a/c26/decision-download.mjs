import {streamZip64} from './decision-zip.mjs';

const root=new URL('../',import.meta.url);
const api='/api/c26/private-feed';
const decode=text=>Uint8Array.from(atob(text.trim()),character=>character.charCodeAt(0));
async function unpack(bytes){
 return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}
async function checked(url,options={}){
 const response=await fetch(url,{cache:'no-store',...options});
 if(!response.ok)throw Error(response.status===401?'請先在此瀏覽器儲存有權限的 FinMind Token':url.pathname||String(url)+' HTTP '+response.status);
 return response;
}
async function verify(bytes,expected){
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 if(Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')!==expected)throw Error('資料版本已變動或檔案不完整，請重新下載');
}
function csv(rows){
 const columns=[...new Set(rows.flatMap(Object.keys))];
 const field=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 return '\uFEFF'+[columns,...rows.map(row=>columns.map(k=>row[k]))].map(row=>row.map(field).join(',')).join('\r\n');
}
export async function buildArchive(token,progress){
 if(!token)throw Error('請先在此瀏覽器儲存 FinMind Token');
 const auth={headers:{Authorization:'Bearer '+token}};
 const asset=path=>checked(new URL(path,root));
 const json=async path=>(await asset(path)).json();
 const entries=[],coverage={},files=[];
 const add=(name,open)=>{files.push(name);entries.push({name,open:async()=>{progress(name);return open()}})};
 const status=await (await checked(api+'/status',auth)).json();
 const runtime=await json('c26/data/portable-runtime-manifest.json');
 const latest=await json('c26/a56/latest-manifest.json');
 const source=await (await checked(api,auth)).arrayBuffer();
 await verify(source,status.sha256);
 const raw=await unpack(source);
 add('source/daily-source.json.gz',()=>new Response(source));
 function table(name,groups){
  const rows=[],dates=[];
  for(const [date,records] of Object.entries(groups).sort()){
   if(!records?.length)continue;
   dates.push(date);
   for(const row of records)rows.push({...row,date});
  }
  coverage[name]={rows:rows.length,first:dates[0]??null,last:dates.at(-1)??null,dates};
  add('csv/'+name+'.csv',()=>new Response(csv(rows)));
 }
 for(const key of ['price','institutional','margin','lending']){
  table(key,Object.fromEntries(Object.entries(raw.days).map(([d,day])=>[d,day[key]])));
 }
 table('market_daily',raw.market_days||{});
 add('source/frozen-inputs.npz',async()=>{
  const bytes=await (await checked(api+'/runtime',auth)).arrayBuffer();
  await verify(bytes,runtime.sha256);return new Response(bytes);
 });
 const minuteBytes=decode(await (await asset('c26/a56/minutes.json.gz.b64')).text());
 add('a56/minute-cases.json.gz',()=>new Response(minuteBytes));
 const minutes={};
 for(const sample of (await unpack(minuteBytes)).cases){
  const rows=minutes[sample.date]??=[];
  sample.bars.forEach(([high,low,volume_shares],minute_index)=>rows.push({stock_id:sample.candidate.code,minute_index,high,low,volume_shares}));
 }
 table('candidate_minutes',minutes);
 for(const path of ['c26/data/portable-runtime-manifest.json','c26/data/universe.json','c26/data/forward-status.json','c26/data/forward-replay.json','c26/data/forward-replay-audit.json','c26/data/forward-chip-parity.json','c26/data/rotation-diagnostic.json','c26/data/verified-next-day-plan.json','c26/a56/summary.json','c26/a56/checkpoint-verification.json','c26/a56/dashboard-history-index.json','fc23/account-seed.json','fc23/refresh-report.json','fc23/historical-sample.json','fc23/snapshot.json']){
  add(path,()=>asset(path));
 }
 add('a56/latest-manifest.json',()=>Response.json(latest));
 add('a56/forward.json',async()=>{const bytes=await (await asset('c26/a56/forward.json')).arrayBuffer();await verify(bytes,latest.forward_sha256);return new Response(bytes)});
 add('r1494a/snapshot.json.gz',()=>asset('snapshot.bin'));
 const base64Asset=(path,name)=>add(name,async()=>new Response(decode(await (await asset(path)).text())));
 base64Asset('c26/a56/dashboard-history.b64','a56/dashboard-history.json.gz');
 for(let year=2021;year<=2026;year++)base64Asset('c26/a56/'+year+'.json.gz.b64','a56/decisions-'+year+'.json.gz');
 for(const name of ['live-bootstrap','shared-seed','supplement','integrated-snapshot'])base64Asset('fc23/'+name+'.b64','fc23/'+name+'.json.gz');
 const parts=async(name,paths,sha)=>add(name,async()=>{
  const strings=[];for(const path of paths)strings.push((await (await asset(path)).text()).trim());
  const bytes=decode(strings.join(''));await verify(bytes,sha);return new Response(bytes);
 });
 const fc=await json('fc23/archive/manifest.json');
 await parts('fc23/full-history.json.gz',fc.parts.map(p=>'fc23/'+p),fc.sha256_gzip);
 const c26=await json('c26/data/historical-assets.json');
 for(const part of Object.values(c26.parts))await parts('c26/'+part.source,part.base64_parts.map(p=>'c26/data/'+p),part.sha256_gzip);
 add('manifest.json',()=>Response.json({source_as_of:status.source_as_of,account_as_of:latest.as_of,coverage,files,
 notes:['CSV 保留來源欄位，可依 date 與 stock_id 合併。法人資料另依 name 區分機構。','candidate_minutes 只涵蓋已封存的候選股事件，minute_index 自開盤起算，保留最高、最低與成交股數。','daily-source.json.gz 含每日完整性、缺漏與來源錯誤紀錄。盤後籌碼請依實際可得時間對齊交易日。','frozen-inputs.npz 為歷史回測輸入，可用 numpy.load(..., allow_pickle=False) 讀取。']}));
 return {date:status.source_as_of,blob:await new Response(streamZip64(entries)).blob()};
}
