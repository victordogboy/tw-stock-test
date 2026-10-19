// R49 - Independently loaded VIX overlay: no change to any Action/optimizer inputs.
(function(root){
 'use strict';
 const $=id=>document.getElementById(id),storeKey='twq_taiex_vix_r49';
 const fmt=x=>Number.isFinite(x)?x.toFixed(2):'—';
 const colors={tw:'#f3a1ff',us:'#ffb26c'};
 let market='us',enabled=true,viewStart='',viewEnd='',redraw=()=>{},generation=0,controller=null;
 const cache={us:null,tw:null};
 function status(s){const e=$('txVixStatus');if(e)e.textContent=s;}
 try{
   const saved=JSON.parse(localStorage.getItem(storeKey)||'null');
   if(saved&&['us','tw'].includes(saved.market))market=saved.market;
   if(saved&&typeof saved.enabled==='boolean')enabled=saved.enabled;
 }catch{}
 function persist(){try{localStorage.setItem(storeKey,JSON.stringify({market,enabled}));}catch{}}
 function inRangeData(state){return state?.data||[];}
 function activeData(){return inRangeData(cache[market]);}
 function normalize(rows){
   return [...new Map((rows||[]).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))&&Number.isFinite(Number(r.value))&&Number(r.value)>0)
       .map(r=>[r.date,{date:r.date,value:Number(r.value),...(r.time?{time:r.time}:{})}])).values()]
       .sort((a,b)=>a.date.localeCompare(b.date));
 }
 function associated(bars){
   const data=activeData(),out=[];
   if(!data.length)return bars.map(()=>null);
   if(market==='tw'){
     const byDate=new Map(data.map(r=>[r.date,r]));
     return bars.map(bar=>byDate.get(bar.date)||null);
   }
   // Cboe's 'DATE' is a US market date; Taiwan daytime must not see the
   // *same US date* close, which completes after Taiwan closes.
   let j=-1;
   for(const bar of bars){
     while(j+1<data.length&&data[j+1].date<bar.date)j++;
     const p=j>=0?data[j]:null;
     const gap=p?(Date.parse(bar.date)-Date.parse(p.date))/86400000:Infinity;
     out.push(gap>=1&&gap<=7?p:null);
   }
   return out;
 }
 function summary(bar){
   if(!enabled){$('txVixAudit').textContent='VIX 疊加已關閉';return;}
   if(!bar){$('txVixAudit').textContent='VIX：尚無台指期審計日期';return;}
   const point=associated([bar])[0];
   const name=market==='tw'?'台灣 VIX':'美國 VIX';
   $('txVixAudit').textContent=point
     ?name+' '+fmt(point.value)+'｜VIX 資料日 '+point.date+(market==='tw'?'（日盤最後觀測）':'（台指期日盤前已公布的美股收盤）')
     :name+'｜'+bar.date+' 無可對齊資料'+(market==='tw'?'（FinMind 僅自 2026-03 起提供）':'');
 }
 function draw(ctx,{view,w,top,priceBottom,right,x}){
   if(!enabled||view.length<2||!activeData().length)return;
   const p=associated(view),valid=p.filter(Boolean).map(t=>t.value);
   if(valid.length<2)return;
   const lo0=Math.min(...valid),hi0=Math.max(...valid),pad=Math.max((hi0-lo0)*.10,.5);
   const lo=Math.max(0,lo0-pad),hi=hi0+pad;
   const y=v=>top+(hi-v)/(hi-lo)*(priceBottom-top);
   ctx.save();
   ctx.beginPath();ctx.rect(60,top,w-60-right,priceBottom-top);ctx.clip();
   ctx.lineWidth=2;ctx.strokeStyle=colors[market];ctx.globalAlpha=.92;ctx.beginPath();
   let begun=false,lastIndex=-1;
   p.forEach((o,i)=>{
     if(!o){begun=false;return;}
     // Never draw misleading long jumps over missing TW dates.
     if(!begun||i-lastIndex>1){ctx.moveTo(x(i),y(o.value));begun=true;}
     else ctx.lineTo(x(i),y(o.value));
     lastIndex=i;
   });
   ctx.stroke();ctx.restore();
   ctx.save();ctx.font='10px system-ui';ctx.fillStyle=colors[market];ctx.textAlign='right';
   for(let i=0;i<5;i++){
     const v=hi-(hi-lo)*i/4,yy=top+(priceBottom-top)*i/4;
     ctx.fillText(fmt(v),w-3,yy+3);
   }
   ctx.fillText(market==='tw'?'TW VIX':'US VIX',w-3,12);ctx.restore();
 }
 async function get(path,signal){
   const response=await fetch(path,{cache:'no-store',headers:root.TWFinMindTokens?.headers?.()||{},signal});
   const data=await response.json().catch(()=>null);
   if(!response.ok||!data?.ok)throw Error(data?.error||'VIX 資料取得失敗（HTTP '+response.status+'）');
   return data;
 }
 function chunks(from,to){
   const day=86400000,start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z'),a=[];
   for(let cursor=start;cursor<=end;cursor+=14*day)
     a.push([new Date(cursor).toISOString().slice(0,10),new Date(Math.min(end,cursor+13*day)).toISOString().slice(0,10)]);
   return a;
 }
 async function load(from=viewStart,to=viewEnd,force=false){
   if(!from||!to||!enabled)return;
   viewStart=from;viewEnd=to;
   const localMarket=market;
   const effectiveStart=localMarket==='tw'&&from<'2026-03-01'?'2026-03-01':from;
   const key=effectiveStart+'|'+to;
   if(cache[localMarket]?.key===key&&!force){status(cache[localMarket].status);redraw();return;}
   const run=++generation;controller?.abort();controller=new AbortController();
   const signal=controller.signal;
   if(to<effectiveStart){cache[localMarket]={key,data:[],status:'台灣 VIX 歷史自 2026-03 起，選擇區間沒有資料'};status(cache[localMarket].status);redraw();return;}
   status('載入 '+(localMarket==='tw'?'台灣':'美國')+' VIX 中…');
   try{
     const periods=localMarket==='tw'?chunks(effectiveStart,to):[[effectiveStart,to]];
     let results=[];
     for(let i=0;i<periods.length;i+=3){
       if(run!==generation)return;
       status('VIX 下載 '+Math.min(i+3,periods.length)+'／'+periods.length+' 段…（不影響原台指期 K 線）');
       const group=await Promise.all(periods.slice(i,i+3).map(([start,end])=>
         get('/api/futures/taiex/vix?'+new URLSearchParams({market:localMarket,start_date:start,end_date:end,...(force?{refresh:'1'}:{})}),signal)
       ));
       for(const item of group)results.push(...item.data);
     }
     if(run!==generation)return;
     const data=normalize(results),name=localMarket==='tw'?'台灣 VIX':'美國 VIX';
     const message=data.length?
       name+'｜'+data[0].date+'～'+data.at(-1).date+'｜'+data.length+' 日｜'+
       (localMarket==='tw'?'FinMind 日盤最後有效值（需 Backer；2026/03 起）':'Cboe 官方日收盤（美國交易日）') :
       name+' 在所選時間內沒有資料；不使用推算值';
     cache[localMarket]={key,data,status:message};
     status(message);redraw();
   }catch(e){
     if(signal.aborted||run!==generation)return;
     status('VIX 疊加未載入：'+e.message+'。原台指期 K 線維持正常。');
     if(!cache[localMarket]||cache[localMarket].key!==key)cache[localMarket]={key,data:[],status:e.message};
     redraw();
   }
 }
 function setRange(from,to,force=false){
   const changed=from!==viewStart||to!==viewEnd;
   viewStart=from;viewEnd=to;
   if(enabled&&(changed||force||!cache[market]))load(from,to,force);
 }
 function init(cb){
   redraw=typeof cb==='function'?cb:()=>{};
   $('txVixEnabled').checked=enabled;$('txVixMarket').value=market;
   $('txVixEnabled').addEventListener('change',()=>{
     enabled=$('txVixEnabled').checked;persist();
     if(enabled)load(viewStart,viewEnd);else{generation++;controller?.abort();status('VIX 疊加已關閉');}
     redraw();
   });
   $('txVixMarket').addEventListener('change',()=>{
     market=$('txVixMarket').value;persist();generation++;controller?.abort();
     if(enabled)load(viewStart,viewEnd);redraw();
   });
   $('txVixReload').addEventListener('click',()=>{if(enabled)load(viewStart,viewEnd,true);});
   if(!enabled)status('VIX 疊加已關閉');
 }
 root.TWTaiexVixOverlay={init,setRange,load,draw,summary,isEnabled:()=>enabled,market:()=>market,associated};
})(window);
