import {sessionReview} from './session-review.mjs?v=20261118-1';
import {assessExecution,executionLabels,routeLabels} from './execution.mjs?v=20261118-explain1';
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
let lastData=null,lastError='',executionContext=null;
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
 panel.querySelector('[data-review-state]').textContent=executionContext?(executionContext.mode+' · 交易日 '+(executionContext.day||'待確認')+' · 盤前訊號 '+(executionContext.plan?.signal_as_of||'待確認')+(executionContext.reviewOnly?'。保留當日條件、行情證據與觸發紀錄供檢視；隔日計畫另列下方。':'')):'';
 const executions=executionContext?assessExecution({...executionContext,quotes:lastData?.quotes||[]}):[];
 panel.querySelector('[data-executions]').innerHTML=renderExecutionCards(executions,names);
 panel.querySelector('button').disabled=busy;
 panel.querySelector('button').textContent=executionContext?.reviewOnly?'更新收盤檢視行情':'更新盤中報價';
}
async function refresh(force=false){
 if(!visible()||busy||!universe.length||(!force&&Date.now()-lastAttempt<14500))return;
 busy=true;lastAttempt=Date.now();const epoch=generation,codes=universe.map(r=>r.code);paint();
 try{
  const batches=[];for(let i=0;i<codes.length;i+=6)batches.push(codes.slice(i,i+6));
  const results=await Promise.all(batches.map(async batch=>{
   const r=await fetch('/api/c26/a56/quotes?codes='+batch.join(',')+'&minutes=1',{cache:'no-store',signal:AbortSignal.timeout(30000)});
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
 const style=document.createElement('style');style.textContent='.a56-quotes-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.a56-quote{border:1px solid #e0e7e2;border-radius:10px;padding:14px;min-width:0}.a56-quote-price{font-size:27px}.a56-ohl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px;color:#607169}.a56-ohl b{display:block;font-size:18px;color:#233c32;margin-top:4px}.a56-quote p{margin:10px 0 5px}.a56-executions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.a56-execution{font-size:14px;padding:18px}.a56-execution h4{font-size:17px;margin:0}.a56-execution .a56-result{padding:10px 12px;background:#f5f7f2;border-radius:8px;font-size:16px;margin:12px 0}.a56-execution table{width:100%;table-layout:fixed;margin:12px 0;font-size:13px}.a56-execution th,.a56-execution td{white-space:normal!important;padding:9px 6px!important;vertical-align:top;overflow-wrap:anywhere}.a56-execution th:first-child{width:24%}.a56-execution th:nth-child(2){width:33%}.a56-execution .a56-pass{color:#226449}.a56-execution .a56-fail{color:#a13e32}.a56-execution.is-alternative{border-style:dashed;background:#fafbf9}.a56-execution details{margin-top:10px}.a56-execution summary{cursor:pointer;color:#52635c}.a56-execution .sub{font-size:12px}@media(max-width:700px){.a56-executions{grid-template-columns:1fr}}';document.head.append(style);
 panel=document.createElement('details');panel.className='panel';panel.id='a56IntradayQuotes';
 panel.innerHTML='<summary>前次交易日／盤中行情與成交追蹤</summary><div class="row"><h3>盤中報價 · 當日 O／H／L</h3><button type="button">更新盤中報價</button></div><p class="sub" data-status></p><p class="sub">最新價及當日開盤／累計最高／累計最低；Yahoo 行情可能延遲，以各股報價時間為準。盤中行情不代表委託已成交。</p><div class="a56-quotes-grid" data-quotes></div><h3>當日策略與成交追蹤</h3><p data-review-state class="sub" role="status"></p><p class="sub">A 僅判定開盤；B／C 使用完成分K判定路徑，再觀察下一分鐘開盤。下方逐條對照「盤前策略價」與「實際行情」。價格符合仍須核帳，才標示「模型已成交」。Yahoo 行情約延遲 20 分鐘；同檔較晚路徑不重複計入成交。</p><div class="a56-executions" data-executions aria-live="polite"></div>';
 document.querySelector('#planActions').closest('.panel').after(panel);
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
 const review=sessionReview(D,I,plan);
 const trackedPlan=review?.plan||plan,trackedSnapshot=review?.snapshot||D.snapshots[I];
 const rows=active?collectQuoteCodes(trackedSnapshot,trackedPlan):[],key=JSON.stringify([trackedPlan,rows.map(r=>r.code+':'+r.roles.join(','))]);
 names=D.names||{};executionContext={...review,plan:trackedPlan,snapshot:trackedSnapshot,orders:D.orders||[],ready:!!review?.ready};
 if(key!==signature){signature=key;generation++;universe=rows;lastData=null;lastError='';lastAttempt=0}
 paint();refresh();
}

export function renderExecutionCards(executions,names={}){
 const order=r=>r.state==='model_filled'?0:r.state==='price_match'&&!r.alternative_to?1:r.state==='not_filled'?2:r.alternative_to?4:r.state==='blocked'?5:3;
 return [...executions].sort((a,b)=>order(a)-order(b)).map(r=>{
  const alternative=r.alternative_to,label=alternative?'同檔較晚符合・不重複計入':executionLabels[r.state];
  const comparisons=r.comparisons||[];
  const match=comparisons.filter(c=>c.passed===true),fail=comparisons.filter(c=>c.passed===false);
  let why=r.state==='price_match'?match.map(c=>c.observed+'，符合「'+c.strategy+'」').join('；'):r.state==='not_filled'?fail.map(c=>c.observed+'，未符合「'+c.strategy+'」').join('；'):r.reason;
  if(r.state==='price_match')why+='。因此此路徑的價格條件符合，成交仍待核帳。';
  if(alternative)why='同檔較早在 '+time(alternative.time)+' 已由「'+(routeLabels[alternative.route]||alternative.route)+'」符合價格條件。本卡保留後續行情證據，不代表第二筆買入。';
  return '<article class="a56-quote a56-execution'+(alternative?' is-alternative':'')+'"><div class="row"><h4>'+esc(names[r.code]||'')+' '+esc(r.code)+' · '+esc(routeLabels[r.route]||r.route)+'</h4><span class="pill">'+esc(label)+'</span></div>'+
   '<div class="a56-result">'+(r.time?'<b>'+(r.state==='model_filled'?'模型成交價':alternative?'後續符合價':'策略觀察買入價')+' '+num(r.price)+'</b><span class="sub">'+esc(time(r.time)==='—'?r.time:time(r.time))+'</span>':'<b>'+esc(label)+'</b>')+'</div>'+
   (comparisons.length?'<table><thead><tr><th>條件</th><th>盤前策略價</th><th>實際行情／判定</th></tr></thead><tbody>'+comparisons.map(c=>'<tr><td>'+esc(c.label)+'</td><td><b>'+esc(c.strategy)+'</b></td><td class="'+(c.passed===true?'a56-pass':c.passed===false?'a56-fail':'')+'">'+(c.passed===true?'✓ ':c.passed===false?'✕ ':'')+esc(c.observed)+'</td></tr>').join('')+'</tbody></table>':'')+
   '<p><b>為何'+(r.state==='not_filled'?'未買入':r.state==='price_match'?'符合':'如此判定')+'：</b>'+esc(why||r.reason)+'</p>'+
   '<details><summary>成交確認與資料時間</summary><p class="sub">'+esc(r.reason)+'</p><p class="sub">券商實際成交：未確認'+(r.source_time?' · 行情截至 '+esc(time(r.source_time)):'')+'</p></details></article>';
 }).join('')||'<p class="sub">本盤沒有新委託，依原計畫管理持股。</p>';
}
