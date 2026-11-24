/* Download archived minute bars from Cloudflare. No Fugle/Yahoo request occurs. */
window.C30ExportCloud=async function(dates,label){
 if(!window.C30Cloud.key())throw Error('請先連線 C30 雲端封存資料庫');
 if(!Array.isArray(dates)||!dates.length)throw Error('尚無可匯出的雲端資料日');
 if(dates.length>65)throw Error('請分批匯出（單次最多 65 個交易日），避免手機記憶體不足');
 const csv=v=>{let s=String(v??'');if(/^[=+@\t]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
 const encoder=new TextEncoder();
 const stream=new ReadableStream({
  async start(controller){
   try{
    controller.enqueue(encoder.encode('date,minute,stock_id,market,open,high,low,close,volume_shares,source\n'));
    for(const date of dates){
     const day=await window.C30Cloud.call('day?date='+encodeURIComponent(date));
     for(const item of day.items||[]){
      if(!Array.isArray(item.rows))continue;
      let buffer='';
      for(const bar of item.rows){buffer+=[date,bar[0],item.code,item.market,bar[1],bar[2],bar[3],bar[4],bar[5],item.provider].map(csv).join(',')+'\n';if(buffer.length>200000){controller.enqueue(encoder.encode(buffer));buffer=''}}
      if(buffer)controller.enqueue(encoder.encode(buffer));
     }
    }
    controller.close()
   }catch(e){controller.error(e)}
  }
 });
 let data=stream,extension='.csv';if(typeof CompressionStream==='function'){data=stream.pipeThrough(new CompressionStream('gzip'));extension='.csv.gz'}
 const blob=await new Response(data).blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='C30_Cloud_Stock1m_'+label+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 return {bytes:blob.size,dates:dates.length};
};
