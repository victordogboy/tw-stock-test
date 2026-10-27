/* One shared valuation snapshot; sorting never triggers per-stock requests. */
(function(root){
 'use strict';
 let snapshot=null,pending=null,attemptedAt=0,error=false,visible=[];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function cell(r){
  const stock=snapshot?.get(String(r.code)),model=stock?.models?.A;
  const eps=model?.status==='ok'&&Number.isFinite(model.eps)&&model.eps>0?model.eps:null;
  const pe=eps&&Number.isFinite(r.close)&&r.close>0?r.close/eps:null;
  const peText=pe!==null?pe.toFixed(2)+' 倍':error?'取得失敗':snapshot?'—':'讀取中…';
  const note=pe!==null?'A模型｜營收 '+(stock.latestRevenueMonth||'未提供')+'｜財報 '+(stock.financeQuarter||'未提供'):
    error?'稍後切換排序可重試':snapshot?(model?.status==='ok'?'缺有效股價':model?.status||'缺估值資料'):'正在取得全年預估EPS';
  const v=r.liquidityVolume,volume=Number.isFinite(v)&&v>=0?Math.round(v/1000).toLocaleString('zh-TW')+' 張':'—';
  const basis=r.liquidityBasis==='projected'?'預估量':'實際量';
  return '<b>預估PE '+esc(peText)+'</b><br><small class="muted">'+esc(note)+'</small><br><b>'+basis+' '+esc(volume)+'</b><br><small class="muted">'+esc(r.liquidityDate||r.dataDate||'日期未提供')+(r.liveTime?' '+esc(r.liveTime):'')+'</small>';
 }
 function paint(){
  const rows=new Map(visible.map(r=>[String(r.code),r]));
  for(const node of document.querySelectorAll('[data-summary-code]')){
   const r=rows.get(node.dataset.summaryCode);if(r)node.innerHTML=cell(r);
  }
 }
 async function update(rows){
  visible=rows;
  if(!rows.length)return;
  if(pending)return pending;
  const ttl=error?60000:30*60000;
  if(attemptedAt&&Date.now()-attemptedAt<ttl){paint();return;}
  attemptedAt=Date.now();error=false;
  pending=(async()=>{
   try{
    const response=await fetch('/api/pe-screener/data',{cache:'no-store',signal:AbortSignal.timeout(60000)});
    const j=await response.json();if(!response.ok||!j.ok||!Array.isArray(j.rows))throw Error('valuation unavailable');
    snapshot=new Map(j.rows.map(r=>[String(r.code),r]));
   }catch{error=true;snapshot=null;}
   finally{pending=null;paint();}
  })();
  return pending;
 }
 root.TWScanSummary={cell,update};
})(globalThis);
