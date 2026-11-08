'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,n=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('zh-TW',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
const displaySide={BUY:'買進',SELL:'賣出'};
const meanings={new_position:'建立新部位',fc17_confirmed_reentry:'強勢重新買回',topup:'原持股加碼',risk_exit:'停損／風控賣出',protective_stop:'保護性停損',portfolio_reduce:'帳戶曝險減碼',cap16:'單股部位上限減碼',rank_exit:'排名淘汰',replace:'換入更強勢股票',no_touch_no_buy:'未觸及買價',target_exposure_full:'持股／資金額度已滿',no_offer_no_fill:'漲停無賣盤未成交',no_bid_no_fill:'跌停無買盤未成交'};
const meaning=s=>meanings[s]||s||'—';
let state=null;
let ordersPage=0;
const pageSize=80;
function table(rows,cols){
 return '<div class="scroll"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c[0])+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(r=>'<tr>'+cols.map(c=>'<td>'+esc(c[2]?c[2](r[c[1]],r):r[c[1]])+'</td>').join('')+'</tr>').join('')+
 '</tbody></table></div>';
}
async function readFullArchive(){
 const mResp=await fetch('./archive/manifest.json',{cache:'no-store'});
 if(!mResp.ok)throw Error('找不到FC23完整資料索引：HTTP '+mResp.status);
 const m=await mResp.json();
 if(m.mode!=='HISTORICAL_ONLY'||m.parts.length!==8||!m.sha256_gzip)throw Error('完整資料索引異常');
 const parts=await Promise.all(m.parts.map(async path=>{
  const r=await fetch(path,{cache:'force-cache'});
  if(!r.ok)throw Error('封存資料區塊讀取失敗：'+path);
  return (await r.text()).trim();
 }));
 const b64=parts.join('');
 const bin=atob(b64);
 const gz=new Uint8Array(bin.length);
 for(let i=0;i<bin.length;i++)gz[i]=bin.charCodeAt(i);
 if(!crypto?.subtle)throw Error('缺少SHA256驗證功能，拒絕使用歷史交易紀錄');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',gz))).map(c=>c.toString(16).padStart(2,'0')).join('');
 if(digest!==m.sha256_gzip)throw Error('FC23歷史資料雜湊值不一致，禁止使用');
 const raw=await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
 const dat=JSON.parse(raw);
 for(const [name,count] of Object.entries(m.counts))if(dat[name]?.length!==count)throw Error(name+'筆數檢驗失敗');
 const last=dat.daily_nav.at(-1);
 if(last.date!==m.last_date||Math.abs(last.nav-32.8528999624682)>0.001)throw Error('FC23績效／日期驗收失敗');
 return {data:dat,manifest:m};
}
const fmtPnl=x=>Number.isFinite(Number(x))?(Number(x)>=0?'+':'')+num(x)+'%':'—';
function navChart(d){
 const rows=d.daily_nav;
 const vals=rows.map(q=>Number(q.nav));
 const min=Math.min(...vals),max=Math.max(...vals),h=260,w=960,pad=36;
 const pts=rows.map((r,i)=>{
  const x=pad+i/(rows.length-1)*(w-2*pad),y=h-pad-(Number(r.nav)-min)/(max-min||1)*(h-2*pad);
  return x.toFixed(1)+','+y.toFixed(1);
 }).join(' ');
 return '<svg role="img" aria-label="FC23 1407交易日每日歷史淨值" viewBox="0 0 '+w+' '+h+'" style="width:100%;height:auto;max-height:320px">'+
 '<polyline fill="none" stroke="#118a63" stroke-width="2" points="'+pts+'"/>'+
 '<text x="'+pad+'" y="'+(h-6)+'" font-size="14">2021/01</text><text x="'+(w-120)+'" y="'+(h-6)+'" font-size="14">2026/10</text>'+
 '<text x="'+pad+'" y="'+(pad+6)+'" font-size="15">'+num(max)+'倍</text></svg>';
}
function renderOrders(){
 const d=state.data.orders;
 const code=$('fc23-order-ticker').value.trim();
 const side=$('fc23-order-side').value;
 const year=$('fc23-order-year').value;
 const status=$('fc23-order-filled').value;
 const rows=d.filter(o=>(!code||String(o.ticker).includes(code))&&(!side||o.action===side)&&(!year||String(o.execution_date).startsWith(year))&&
  (status==='all'||String(Boolean(o.filled))===status)).slice().reverse();
 const pages=Math.max(1,Math.ceil(rows.length/pageSize));ordersPage=Math.max(0,Math.min(ordersPage,pages-1));
 const display=rows.slice(ordersPage*pageSize,(ordersPage+1)*pageSize);
 const asset=Number($('fc23-initial-capital').value)||3000000;
 $('fc23-full-orders').innerHTML=table(display,[
 ['日期','execution_date'],['股票','ticker'],['動作','action',x=>displaySide[x]||x],['成交','filled',x=>x?'已成交':'未成交'],
 ['價格','fill_price',x=>num(x)],['模擬名目金額(元)','notional_proxy',(x,row)=>row.filled?num(Number(x)*asset,0):'—'],
 ['單筆賣出報酬','realized_pct',(x,row)=>row.action==='SELL'&&row.filled?fmtPnl(x):'—'],['原因','reason',meaning]
 ]);
 $('fc23-order-pagination').innerHTML='共 '+rows.length+' 筆符合條件；第 '+(ordersPage+1)+'／'+pages+' 頁';
 $('fc23-prev').disabled=ordersPage===0;$('fc23-next').disabled=ordersPage>=pages-1;
}
function renderPlans(){
 const date=$('fc23-plan-date').value;
 const rows=state.data.plans.filter(r=>r.execution_date===date);
 $('fc23-plan-title').textContent='FC23歷史隔日計畫：'+date+'（共 '+rows.length+' 筆；當日真實行情已知，僅供重播）';
 $('fc23-full-plans').innerHTML=rows.length?table(rows,[
 ['股票','ticker'],['動作','action'],['分類','category'],['前收盤','close_at_signal',x=>num(x)],
 ['盤前預設觸發價','entry_exit_level',x=>num(x)],['盤前停損','stop_level',x=>num(x)],
 ['實際開盤(事後)','actual_open',x=>num(x)],['盤中高低(事後)','actual_high',x=>num(x)],
 ['原因','reason',meaning],['未成交處理','no_fill_policy']
 ]):'<p class="muted">該歷史交易日沒有預案，可能是空手或無新訊號，請核對完整記錄。</p>';
}
function renderDayStatus(){
 const d=state.data.daily_nav, date=$('fc23-day-date').value;
 const e=d.find(x=>x.date===date);
 if(!e){$('fc23-day-detail').textContent='日期不在完整歷史資料';return;}
 const ix=d.findIndex(x=>x.date===date),prev=ix?d[ix-1]:null;
 const change=prev?(e.nav/prev.nav-1)*100:0;
 const o=state.data.orders.filter(x=>x.execution_date===date);
 const buys=o.filter(x=>x.action==='BUY'&&x.filled),sells=o.filter(x=>x.action==='SELL'&&x.filled),unfilled=o.filter(x=>!x.filled);
 const reason=[...new Set(o.map(x=>meaning(x.reason)))].slice(0,10);
 $('fc23-day-detail').innerHTML='<p>日期：<b>'+esc(date)+'</b> · 淨值：<b>'+num(e.nav,4)+'倍</b> · 當日報酬：<b>'+fmtPnl(change)+'</b> · 持股曝險：<b>'+fmtPnl(Number(e.exposure)*100)+'</b></p>'+
 '<p>成交買進 '+buys.length+' 筆、成交賣出 '+sells.length+' 筆、未成交 '+unfilled.length+' 筆。</p>'+
 '<p>實際歷史交易理由：'+(reason.length?reason.map(esc).join('、'):'本日無交易委託；持續按策略原持倉及風控條件運作')+'</p>';
}
async function init(){
 const {data,manifest}=await readFullArchive();
 state={data,manifest};
 $('fc23-archive-state').textContent='✅ FC23完整歷史資料驗證通過：'+data.orders.length+'筆委託／'+data.plans.length+'筆次日預案／'+data.daily_nav.length+'日淨值；最後資料日期 '+manifest.last_date;
 $('fc23-full-nav').innerHTML=navChart(data);
 const planDays=[...new Set(data.plans.map(x=>x.execution_date))].sort();
 const dayDates=data.daily_nav.map(x=>x.date);
 $('fc23-plan-date').innerHTML=planDays.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
 $('fc23-day-date').innerHTML=dayDates.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
 $('fc23-plan-date').value=planDays.at(-1);$('fc23-day-date').value=dayDates.at(-1);
 $('fc23-plan-date').addEventListener('change',renderPlans);
 $('fc23-day-date').addEventListener('change',renderDayStatus);
 for(const id of ['fc23-order-ticker','fc23-order-side','fc23-order-year','fc23-order-filled','fc23-initial-capital']){
  $(id).addEventListener(id==='fc23-order-ticker'?'input':'change',()=>{ordersPage=0;renderOrders();});
 }
 $('fc23-prev').addEventListener('click',()=>{ordersPage--;renderOrders();});
 $('fc23-next').addEventListener('click',()=>{ordersPage++;renderOrders();});
 renderPlans();renderOrders();renderDayStatus();
}
init().catch(e=>{
 $('fc23-archive-state').textContent='❌ FC23完整歷史資料讀取或SHA256驗證失敗：'+e.message;
});
