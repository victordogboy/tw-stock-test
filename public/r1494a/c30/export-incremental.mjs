/* Private incrementals for C30/A56 frozen Python engine handoff. NOT an order generator. */
import {c30FreeToken,c30FreeStatus,c30FreeDownloadDay} from './free-sync.mjs?v=20261125-sponsor-diagnose-v5';
export async function exportC30A56FreeInputs(token=c30FreeToken(),progress=()=>{},includeMinutes=false){
 if(!token)throw Error('請設定 FinMind Free Token');
 const status=await c30FreeStatus(token),days=(status.days||[]).filter(x=>x.date>'2026-11-20');
 if(!days.length)throw Error('沒有可匯出的增量日資料');
 if(days.length>40)throw Error('單次請分批匯出 40 個交易日以內');
 const lines=[JSON.stringify({kind:'manifest',format:'C30-A56-Free-v2',anchor:'2026-11-20',pool_size:233,model_replayed:false,days:days.map(d=>({date:d.date,price:d.price?.stock_count||0,chips:Object.fromEntries(Object.entries(d.chips||{}).map(([k,v])=>[k,{saved:v.saved_codes?.length||0,empty:v.empty||0}])),minute:d.minute?.count||0}))})];
 for(let i=0;i<days.length;i++){const d=days[i];progress('從雲端匯出 '+(i+1)+'/'+days.length+'：'+d.date);
  const data=await c30FreeDownloadDay(d.date,null,token);lines.push(JSON.stringify({kind:'daily',date:d.date,datasets:data.datasets,model_replayed:false}));
  if(includeMinutes)for(const code of d.minute?.saved_codes||[]){const r=await fetch('/api/c30/free/day?date='+encodeURIComponent(d.date)+'&dataset=minute&code='+code,{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw Error('分鐘'+code+' 讀取失敗');const j=await r.json();lines.push(JSON.stringify({kind:'minute',date:d.date,code,items:j.items||[]}))}
 }
 const raw=new Blob([lines.join('\n')+'\n'],{type:'application/x-ndjson'}),zip=typeof CompressionStream==='function';const blob=zip?await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob():raw;
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='C30_A56_Free_233_increment_'+days.at(-1).date+'.ndjson'+(zip?'.gz':'');a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 progress('已從封存庫輸出 '+days.length+' 個交易日原始資料；沒有重新向 FinMind 抓取，原 Python 引擎仍須驗證。');
 return {days:days.length,bytes:blob.size};
}