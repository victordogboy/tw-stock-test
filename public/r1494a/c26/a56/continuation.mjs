const $=id=>document.getElementById(id);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>Number.isFinite(x)?'NT$ '+x.toLocaleString('zh-TW',{maximumFractionDigits:0}):'—';
let busy=false;
export async function loadContinuation(){
 const el=$('continuation');if(!el||busy)return;busy=true;
 const button=$('refreshContinuation');if(button)button.disabled=true;
 try{
  const r=await fetch('/api/c26/a56/status',{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const s=await r.json();
  if(s.model_version!=='A56'||s.lock_id!=='A56-LOCK-20261116'||s.plan?.readiness!=='blocked'||!Array.isArray(s.plan.actions)||s.plan.actions.length!==0||!Array.isArray(s.blockers)||!Array.isArray(s.required_replay_dates))throw Error('接續狀態格式不符');
  const c=s.checkpoint,source=s.source;
  el.innerHTML='<p><b>已驗證 A56 帳本：</b>'+esc(c?.as_of||'待核對')+'；<b>市場資料：</b>'+esc(source?.as_of||'待核對')+'；<b>下一交易日：</b>'+esc(source?.next_trade_date||'待核對')+'</p>'+
   (c?'<p>已從 '+esc(c.resume_checks)+' 個存檔日期接續重播，與完整帳本一致。封存模擬權益 '+esc(money(c.equity_twd))+'，現金 '+esc(money(c.cash_twd))+'。以上截至 '+esc(c.as_of)+'，不是今日券商持倉。</p>':'')+
   '<p><b>待重播日期：</b>'+esc(s.required_replay_dates.map(x=>x.date+(['available','cached'].includes(x.source_state)?'（來源已備）':'（來源待補）')).join('、')||'尚待確認接續資料')+'</p>'+
   '<ul>'+s.blockers.map(x=>'<li>'+esc(x.message)+'</li>').join('')+'</ul>'+
   '<p class="muted">更新此狀態只重新檢查已發布驗收紀錄，不會執行行情補齊、帳本重播或下單。</p>';
 }catch(e){el.textContent='接續狀態讀取失敗：'+e.message+'。歷史檢視仍可使用；不發布今日買賣指示。';}
 finally{busy=false;if(button)button.disabled=false;}
}
if($('refreshContinuation'))$('refreshContinuation').onclick=loadContinuation;
loadContinuation();
