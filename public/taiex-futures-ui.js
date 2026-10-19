(function(){
  'use strict';
  const $=id=>document.getElementById(id),core=TWTaiexFutures,key='twq_taiex_view_r36';
  const fmt=(v,n=0)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
  const signed=(v,n=0)=>Number.isFinite(v)?(v>0?'+':'')+fmt(v,n):'—';
  const sessionNames={position:'日盤',after_market:'夜盤',combined:'夜盤＋日盤'};
  let raw=[],rows=[],index=0,config={...TWParabolicSAR.defaults},controller,canvasView=null;
  function text(id,value){$(id).textContent=value;}
  function save(){try{localStorage.setItem(key,JSON.stringify({session:$('txSession').value,years:$('txYears').value,chartBars:$('txChartBars').value,sar:config}));}catch{}}
  function fillSar(){ $('txSarEnabled').checked=config.enabled;for(const [id,k] of [['txSarStart','start'],['txSarStep','step'],['txSarMax','max']])$(id).value=String(config[k]); }
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved){if(sessionNames[saved.session])$('txSession').value=saved.session;if(['1','3','5'].includes(saved.years))$('txYears').value=saved.years;if(['100','250','600','1250','all'].includes(saved.chartBars))$('txChartBars').value=saved.chartBars;config=TWParabolicSAR.validate(saved.sar||{});}
    else {const stock=JSON.parse(localStorage.getItem('twq_detail_sar_v1')||'null');if(stock)config=TWParabolicSAR.validate({enabled:stock.enabled!==false,start:stock.af,step:stock.step??stock.af,max:stock.max??.2});}
  }catch{}
  fillSar();
  function tokenStatus(){text('txTokenStatus','目前選用：'+TWFinMindTokens.masked(TWFinMindTokens.activeToken())+'；變更後按「載入分析」。');}
  TWFinMindTokens.bind({onChange:tokenStatus});tokenStatus();
  async function get(path,signal){
    const response=await fetch(path,{headers:TWFinMindTokens.headers(),cache:'no-store',signal});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.ok)throw new Error(data?.error||'資料服務暫時無法使用');return data;
  }
  async function load(force=false){
    controller?.abort();controller=new AbortController();const active=controller;
    for(const id of ['txLoad','txRefresh'])$(id).disabled=true;
    text('txStatus','正在取得台指期日 K…');
    const end=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),start=new Date(Date.parse(end+'T00:00:00Z')-(Number($('txYears').value)*366+90)*86400000).toISOString().slice(0,10);
    try{
      // Split multi-year requests into independently cached periods; a five-year
      // history is not assumed to fit in a single upstream response.
      const from=Date.parse(start+'T00:00:00Z'),to=Date.parse(end+'T00:00:00Z'),day=86400000;
      const chunkDays=Number($('txYears').value)>1?395:2000;
      const periods=[];for(let cursor=from;cursor<=to;cursor+=chunkDays*day){
       const until=Math.min(to,cursor+(chunkDays-1)*day);
       periods.push({start_date:new Date(cursor).toISOString().slice(0,10),end_date:new Date(until).toISOString().slice(0,10)});
      }
      let combined=[],allCached=true,source='';
      for(let j=0;j<periods.length;j++){
       text('txStatus','正在載入歷史日 K：第 '+(j+1)+'／'+periods.length+' 段（'+periods[j].start_date+' ～ '+periods[j].end_date+'）…');
       const result=await get('/api/futures/taiex/history?'+new URLSearchParams({...periods[j],...(force?{refresh:'1'}:{})}),active.signal);
       if(active!==controller)return;
       combined.push(...result.data);source=result.source;allCached=allCached&&result.cache_hit;
      }
      const normalized=core.normalize(combined);if(!normalized.data.length)throw new Error('所選期間沒有有效 TX 月份合約行情；請檢查 Token 或稍後更新。');
      raw=normalized.data;
      const selected=$('txContract').value,contracts=[...new Set(raw.map(r=>r.contract))].sort().reverse();
      $('txContract').replaceChildren();
      for(const value of ['near',...contracts]){const option=document.createElement('option');option.value=value;option.textContent=value==='near'?'近月連續（未還原價差）':value.slice(0,4)+'年'+value.slice(4)+'月';$('txContract').append(option);}
      $('txContract').value=contracts.includes(selected)?selected:'near';
      selectSeries();save();
      window.TWTaiexVixOverlay?.setRange(raw[0].date,raw.at(-1).date,force);
      text('txStatus',source+'｜資料交易日 '+raw[0].date+' ～ '+raw.at(-1).date+'｜'+(allCached?'快取':'已更新')+'｜共 '+periods.length+' 段｜非即時日 K'+(normalized.rejected?'｜已排除 '+normalized.rejected+' 筆非月份合約或無效資料':''));
    }catch(e){if(e.name!=='AbortError'&&active===controller)text('txStatus','載入失敗：'+e.message+(raw.length?'；下方保留上次成功資料。':''));}
    finally{if(active===controller)for(const id of ['txLoad','txRefresh'])$(id).disabled=false;}
  }
  function selectSeries(){rows=core.series(raw,{session:$('txSession').value,contract:$('txContract').value});index=Math.max(0,rows.length-1);$('txAudit').max=String(index);$('txAudit').value=String(index);$('txAudit').disabled=!rows.length;render();if($('txChart').parentElement)$('txChart').parentElement.scrollLeft=$('txChart').scrollWidth;}
  function render(){
    window.TWTaiexActionUI?.render({raw,rows,index,session:$('txSession').value,contract:$('txContract').value,sar:config});
    window.TWTaiexR46UI?.render({raw,rows,index,session:$('txSession').value,contract:$('txContract').value,sar:config});
    window.TWTaiexR48UI?.render({raw,rows,index,session:$('txSession').value,contract:$('txContract').value,sar:config});
    const prefix=rows.slice(0,index+1),s=core.summary(prefix),sar=config.enabled?TWParabolicSAR.calculate(prefix,config):[],point=sar.at(-1);
    if(!s){for(const id of ['txClose','txChange','txVolume','txVolumeRatio','txOi','txOiChange','txSar','txSarAf','txOhlc','txAuditDate','txAnalysis','txRollNote'])text(id,'—');text('txChartTitle','所選時段或合約沒有資料');window.TWTaiexVixOverlay?.summary(null);$('txMaTable').replaceChildren();draw([],[]);return;}
    const b=s.bar;
    text('txChartTitle','台指期 '+b.contract+'｜'+sessionNames[$('txSession').value]+'｜'+b.date);text('txAuditDate',b.date);window.TWTaiexVixOverlay?.summary(b);
    text('txClose',fmt(b.close));$('txClose').className=s.change>0?'up':s.change<0?'down':'';
    text('txChange',b.rollover?'換月：不計跨合約漲跌':s.change===null?'尚無前一日資料':signed(s.change)+' 點（'+signed(s.changePercent,2)+'%）');
    text('txVolume',fmt(b.volume));text('txVolumeRatio','較前 20 日均量 '+fmt(s.volumeRatio,2)+' 倍');
    text('txOi',fmt(b.openInterest));text('txOiChange',$('txSession').value==='after_market'?'夜盤未提供可靠未平倉量':b.rollover?'換月：不比較跨合約未平倉量':'較前一日 '+signed(s.oiChange)+' 口');
    text('txSar',!config.enabled?'已關閉':point?(point.rising?'多頭 ':'空頭 ')+fmt(point.value,2):'資料不足');
    text('txSarAf',point?'目前 AF '+point.af+(point.reversal?'｜本日轉向':''):'—');
    text('txOhlc','審計日 '+b.date+'｜開 '+fmt(b.open)+'／高 '+fmt(b.high)+'／低 '+fmt(b.low)+'／收 '+fmt(b.close)+' 點');
    const notes=[];
    if($('txContract').value==='near')notes.push('近月連續採每日最早有有效行情的月份，未還原轉倉價差；圖中虛線標記換月，指標可能受價差影響。');
    if(b.rollover)notes.push('本審計日發生換月。');
    if($('txSession').value==='combined'&&b.nightMissing)notes.push('本日未取得夜盤，僅顯示日盤數值。');
    text('txRollNote',notes.join(' '));
    const aligned=s.ma60!==null?(s.ma5>s.ma10&&s.ma10>s.ma20&&s.ma20>s.ma60?'均線呈多頭排列':s.ma5<s.ma10&&s.ma10<s.ma20&&s.ma20<s.ma60?'均線呈空頭排列':'均線尚未一致排列'):'不足 60 根，長期均線尚未完整';
    text('txAnalysis',aligned+'。'+(s.ma20===null?'':('收盤'+(b.close>=s.ma20?'位於':'低於')+' MA20'+(b.close>=s.ma20?' 上方':'')+'。'))+(point?'SAR 目前為'+(point.rising?'多頭':'空頭')+'，距收盤 '+fmt(Math.abs(b.close-point.value),2)+' 點。':'')+(s.volumeRatio===null?'前 20 日量能樣本不足。':'成交量為前 20 日均量的 '+fmt(s.volumeRatio,2)+' 倍。'));
    $('txMaTable').replaceChildren();for(const n of [5,10,20,60]){const cell=document.createElement('div');cell.textContent='MA'+n;const value=document.createElement('b');value.textContent=fmt(s['ma'+n],2);cell.append(value);$('txMaTable').append(cell);}
    draw(prefix,sar);
  }
  function draw(prefix,sar){
    const canvas=$('txChart'),ctx=canvas.getContext('2d');
    const limit=$('txChartBars').value==='all'?prefix.length:Number($('txChartBars').value)||100;
    const view=prefix.slice(-limit),offset=prefix.length-view.length,n=view.length;canvasView=null;
    const wrapper=canvas.parentElement||{clientWidth:canvas.clientWidth,scrollLeft:0};
    const availableWidth=wrapper.clientWidth||canvas.clientWidth||340,priorScroll=wrapper.scrollLeft||0;
    canvas.style.width=Math.max(availableWidth,n*7+74)+'px';
    const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    if(!n){ctx.fillStyle='#9bacc7';ctx.fillText('尚無可顯示的 K 線',20,30);return;}
    const left=62,right=window.TWTaiexVixOverlay?.isEnabled()?52:12,top=18,bottom=24,priceBottom=h-104;
    const maValues=[5,10,20,60].map(period=>view.map((_,i)=>core.sma(prefix,period,offset+i)));
    const points=sar.slice(-n),values=[...view.flatMap(b=>[b.low,b.high]),...maValues.flat().filter(Number.isFinite),...points.filter(Boolean).map(p=>p.value)];
    const min=Math.min(...values),max=Math.max(...values),pad=(max-min)*.07||1,lo=min-pad,hi=max+pad;
    const x=i=>left+(i+.5)*(w-left-right)/n,y=p=>top+(hi-p)/(hi-lo)*(priceBottom-top),width=Math.max(1,(w-left-right)/n*.62);
    ctx.font='10px system-ui';ctx.strokeStyle='#263750';ctx.lineWidth=1;ctx.fillStyle='#9bacc7';
    for(let k=0;k<5;k++){const yy=top+(priceBottom-top)*k/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.fillText(fmt(hi-(hi-lo)*k/4),2,yy+3);}
    const vmax=Math.max(...view.map(b=>b.volume),1);
    view.forEach((b,i)=>{const xx=x(i),color=b.close>b.open?'#ff7585':b.close<b.open?'#3fd5a5':'#f4c95d';ctx.fillStyle=color;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(xx,y(b.high));ctx.lineTo(xx,y(b.low));ctx.stroke();ctx.fillRect(xx-width/2,Math.min(y(b.open),y(b.close)),width,Math.max(1,Math.abs(y(b.open)-y(b.close))));ctx.globalAlpha=.55;const vh=b.volume/vmax*65;ctx.fillRect(xx-width/2,h-bottom-vh,width,vh);ctx.globalAlpha=1;if(b.rollover){ctx.strokeStyle='#ad935f';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,priceBottom);ctx.stroke();ctx.setLineDash([]);}});
    ['#f4c95d','#67a5ff','#bd8cff','#35d6a0'].forEach((color,j)=>{ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.beginPath();let begun=false;maValues[j].forEach((v,i)=>{if(!Number.isFinite(v))return;if(!begun){ctx.moveTo(x(i),y(v));begun=true;}else ctx.lineTo(x(i),y(v));});ctx.stroke();});
    points.forEach((p,i)=>{if(!p)return;ctx.beginPath();ctx.fillStyle=p.rising?'#ffa94d':'#63c9f4';ctx.arc(x(i),y(p.value),Math.max(1.5,Math.min(3,(w-left-right)/n*.3)),0,2*Math.PI);ctx.fill();});
    window.TWTaiexVixOverlay?.draw(ctx,{view,w,top,priceBottom,right,x});
    // A five-year candle range needs yearly separators, not just first/last labels.
    if(n>250)for(let i=1;i<n;i++)if(view[i].date.slice(0,4)!==view[i-1].date.slice(0,4)){
      const xx=x(i);ctx.strokeStyle='#30415a';ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,priceBottom);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#9bacc7';ctx.fillText(view[i].date.slice(0,4),xx+3,h-5);
    }
    ctx.fillStyle='#9bacc7';ctx.fillText(view[0].date,left,h-5);ctx.fillText(view.at(-1).date,w-right-62,h-5);
    canvasView={left,right,w,n,offset};wrapper.scrollLeft=priorScroll;
  }
  window.TWTaiexVixOverlay?.init(()=>render());
  $('txLoad').addEventListener('click',()=>load());$('txRefresh').addEventListener('click',()=>load(true));
  for(const id of ['txSession','txContract'])$(id).addEventListener('change',()=>{selectSeries();save();});
  $('txYears').addEventListener('change',()=>save());
  $('txChartBars').addEventListener('change',()=>{save();render();if($('txChart').parentElement)$('txChart').parentElement.scrollLeft=$('txChart').scrollWidth;});
  $('txAudit').addEventListener('input',()=>{index=Number($('txAudit').value);render();});
  for(const id of ['txLatest','actLatest'])$(id).addEventListener('click',()=>{index=Math.max(0,rows.length-1);$('txAudit').value=String(index);render();if($('txChart').parentElement)$('txChart').parentElement.scrollLeft=$('txChart').scrollWidth;});
  let chartPress=null;
  $('txChart').addEventListener('pointerdown',e=>{chartPress={x:e.clientX,y:e.clientY,id:e.pointerId};});
  $('txChart').addEventListener('pointermove',e=>{if(chartPress&&Math.hypot(e.clientX-chartPress.x,e.clientY-chartPress.y)>8)chartPress=null;});
  $('txChart').addEventListener('pointercancel',()=>{chartPress=null;});
  $('txChart').addEventListener('pointerup',event=>{const press=chartPress;chartPress=null;if(!press||press.id!==event.pointerId||Math.hypot(event.clientX-press.x,event.clientY-press.y)>8||!canvasView)return;const v=canvasView,px=event.clientX-$('txChart').getBoundingClientRect().left;if(px<v.left||px>v.w-v.right)return;index=v.offset+Math.min(v.n-1,Math.floor((px-v.left)/(v.w-v.left-v.right)*v.n));$('txAudit').value=String(index);render();});
  $('txSarEnabled').addEventListener('change',()=>{config.enabled=$('txSarEnabled').checked;fillSar();text('txSarError','');save();render();});
  for(const id of ['txSarStart','txSarStep','txSarMax'])$(id).addEventListener('change',()=>{try{config=TWParabolicSAR.validate({enabled:$('txSarEnabled').checked,start:$('txSarStart').value,step:$('txSarStep').value,max:$('txSarMax').value});fillSar();text('txSarError','');save();render();}catch(e){text('txSarError',e.message+' 圖表沿用上一組有效設定。');}});
  $('txSarReset').addEventListener('click',()=>{config={...TWParabolicSAR.defaults};fillSar();text('txSarError','');save();render();});
  $('txQuote').addEventListener('click',async()=>{
    $('txQuote').disabled=true;text('txQuoteStatus','正在查詢近月報價…');
    try{const result=await get('/api/futures/taiex/quote',AbortSignal.timeout(30000)),q=result.data[0];const close=core.number(q.close),volume=core.number(q.total_volume);if(!(close>0))throw new Error('來源未提供有效近月價格');text('txQuoteStatus','TXFR1 近月｜'+fmt(close)+' 點｜漲跌 '+signed(core.number(q.change_price))+' 點｜成交 '+fmt(volume)+' 口｜來源時間（台灣）：'+String(q.date||'未提供')+'。僅顯示來源最後報價，未混入歷史日 K。');}catch(e){text('txQuoteStatus',e.message);}finally{$('txQuote').disabled=false;}
  });
  window.addEventListener('resize',()=>render());
  load();
})();
