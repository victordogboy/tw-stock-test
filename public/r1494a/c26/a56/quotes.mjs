/* Live market view is deliberately separate from the frozen A56 ledger. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number.isFinite(x)?x.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
const time=x=>Number.isFinite(Date.parse(x))?new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
export function collectQuoteCodes(snapshot,plan){
 const rows=new Map();
 const add=(c,role)=>{c=String(c||'');if(!/^\d{4,6}$/.test(c))return;if(!rows.has(c))rows.set(c,{code:c,roles:[]});if(!rows.get(c).roles.includes(role))rows.get(c).roles.push(role)};
 for(const h of snapshot?.holdings||[])add(h.code,'持股');
 for(const a of plan?.actions||[])add(a.code,{BUY:'條件買入',SELL:'預計賣出',HOLD:'續抱'}[a.side]||'計畫');
 for(const c of plan?.candidates||[])add(c.code,'反轉候選');
 return [...rows.values()];
}
let panel,active=false,universe=[],names={},signature='',lastAttempt=0,busy=false,generation=0;
let lastData=null,lastError='';
const visible=()=>active&&document.querySelector('#strategy')?.value==='A56'&&!document.hidden&&document.querySelector('#overview')?.classList.contains('active');
function paint(){
 if(!panel)return;
 panel.hidden=!active||document.querySelector('#strategy')?.value!=='A56';
 const status=panel.querySelector('[data-status]');
 status.textContent=lastError||(!lastData?'讀取 Yahoo 盤中報價…':'Yahoo Finance · 每 15 秒查詢 · 最近取得 '+time(lastData.fetched_at));
 const quotes=new Map((lastData?.quotes||[]).map(q=>[q.code,q]));
 panel.querySelector('[data-quotes]').innerHTML=universe.map(row=>{
  const q=quotes.get(row.code),ok=q?.status==='available';
  const age=ok?Math.max(0,Math.round((Date.now()-Date.parse(q.source_time))/1000)):0;
  const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const stale=ok&&q.trade_date!==today,delay=ok&&q.session_state==='trading'&&age>180;
  const state=!ok?(lastData?'暫無有效報價':'讀取中'):stale?'舊日行情，非今日盤中':q.session_state==='closed'?'當日收盤':delay?'報價延遲':'當日盤中';
  return '<article class="a56-quote"><div class="row"><b>'+esc(names[row.code]||'')+' '+row.code+'</b><span class="pill">'+esc(row.roles.join('／'))+'</span></div>'+
   '<div class="row"><strong class="a56-quote-price">'+(ok?num(q.price):'—')+'</strong><span>'+ (ok&&Number.isFinite(q.change_pct)?(q.change_pct>=0?'+':'')+num(q.change_pct)+'%':'')+'</span></div>'+
   '<div class="a56-ohl">'+[['O 開盤',q?.open],['H 最高',q?.high],['L 最低',q?.low]].map(([label,v])=>'<div>'+label+'<b>'+ (ok?num(v):'—')+'</b></div>').join('')+'</div>'+
   '<p class="sub" style="color:'+(stale||delay||!ok?'#92651b':'#4c6c60')+'">'+state+' · '+(ok?esc(time(q.source_time)):'請稍後重試')+'</p>'+
   (ok?'<a class="sub" target="_blank" rel="noopener noreferrer" href="'+esc(q.source_url)+'">Yahoo '+esc(q.symbol)+'</a>':'')+'</article>';
 }).join('')||'<p>目前沒有持股或計畫標的。</p>';
 panel.querySelector('button').disabled=busy;
}
async function refresh(force=false){
 if(!visible()||busy||!universe.length||(!force&&Date.now()-lastAttempt<14500))return;
 busy=true;lastAttempt=Date.now();const epoch=generation,codes=universe.map(r=>r.code);paint();
 try{
  const batches=[];for(let i=0;i<codes.length;i+=12)batches.push(codes.slice(i,i+12));
  const results=await Promise.all(batches.map(async batch=>{
   const r=await fetch('/api/c26/a56/quotes?codes='+batch.join(','),{cache:'no-store',signal:AbortSignal.timeout(18000)});
   const d=await r.json();if(!Array.isArray(d.quotes))throw Error('報價服務 HTTP '+r.status);return d;
  }));
  if(epoch!==generation)return;
  lastData={fetched_at:results.map(d=>d.fetched_at).sort()[0],quotes:results.flatMap(d=>d.quotes)};lastError='';
  if(!lastData.quotes.some(q=>q.status==='available'))lastError='Yahoo 暫無有效報價；15 秒後重試。';
 }catch(e){if(epoch===generation)lastError='報價讀取失敗，稍後自動重試；下方若有數值，請以各股報價時間判斷。'}
 finally{busy=false;paint()}
}
function mount(){
 if(panel)return;
 const style=document.createElement('style');style.textContent='.a56-quotes-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.a56-quote{border:1px solid #e0e7e2;border-radius:10px;padding:14px;min-width:0}.a56-quote-price{font-size:27px}.a56-ohl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px;color:#607169}.a56-ohl b{display:block;font-size:18px;color:#233c32;margin-top:4px}.a56-quote p{margin:10px 0 5px}';document.head.append(style);
 panel=document.createElement('div');panel.className='panel';panel.id='a56IntradayQuotes';
 panel.innerHTML='<div class="row"><h3>盤中報價 · 當日 O／H／L</h3><button type="button">更新盤中報價</button></div><p class="sub" data-status></p><p class="sub">最新價及當日開盤／累計最高／累計最低；Yahoo 行情可能延遲，以各股報價時間為準。盤中行情不代表委託已成交。</p><div class="a56-quotes-grid" data-quotes></div>';
 document.querySelector('#overview').prepend(panel);
 panel.querySelector('button').onclick=()=>refresh(true);
 document.querySelector('#refresh')?.addEventListener('click',()=>refresh(true));
 document.querySelector('#strategy')?.addEventListener('change',()=>{if(document.querySelector('#strategy').value!=='A56'){active=false;generation++;paint()}});
 document.addEventListener('visibilitychange',()=>refresh());
 document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>queueMicrotask(()=>refresh())));
 setInterval(()=>refresh(),15000);
}
export function syncA56Quotes(D,I,plan){
 // Snapshot-only renderers have no live DOM; quotes are a browser enhancement.
 if(typeof document==='undefined'||typeof document.createElement!=='function')return;
 mount();active=I===D.dates.length-1;
 const rows=active?collectQuoteCodes(D.snapshots[I],plan):[],key=rows.map(r=>r.code+':'+r.roles.join(',')).join('|');
 names=D.names||{};
 if(key!==signature){signature=key;generation++;universe=rows;lastData=null;lastError='';lastAttempt=0}
 paint();refresh();
}
