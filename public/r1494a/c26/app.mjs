/* C26 isolated historical reader. Never uses FC23/R1494-A live orders as C26 instructions. */
const ROOT='/r1494a/c26/';
const EXPECTED={days:1407,orders:1758,buyFills:539,sellFills:1028,unfilledBuys:191,newBuys:309,ret:1720.495844396837,mdd:-17.989769234703846,lastNav:18.20495844396837};
const finite=n=>Number.isFinite(n),money=n=>finite(n)?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
const percent=n=>finite(n)?`${n>=0?'+':''}${money(100*n)}%`:'—';
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
export function parseCsv(source){
  const text=source.replace(/^\ufeff/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
    }else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.length))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('CSV 引號未正確結束');
  if(row.length||cell){row.push(cell);rows.push(row);}
  if(!rows.length)return [];
  const keys=rows.shift();return rows.map((values,i)=>{
    if(values.length!==keys.length)throw Error(`CSV 第${i+2}列欄數不符`);
    return Object.fromEntries(keys.map((key,j)=>[key,values[j]]));
  });
}
export function computeMdd(values){let peak=1,mdd=0;for(const nav of values){if(!finite(nav)||nav<=0)throw Error('淨值含無效數值');peak=Math.max(peak,nav);mdd=Math.min(mdd,nav/peak-1);}return mdd*100;}
export function validateC26(daily,orders,manifest){
  if(!manifest||manifest.lock_id!=='C26-EVENT-CORR-LOCK-20261112'||manifest.live_trading_enabled!==false)throw Error('不是受控的 C26 凍結版本');
  if(daily.length!==EXPECTED.days||orders.length!==EXPECTED.orders)throw Error(`回放筆數不符：${daily.length} 日、${orders.length} 筆委託`);
  if(daily[0].date!=='2021-01-06'||daily.at(-1).date!=='2026-10-27')throw Error('C26歷史日期不符');
  const values=daily.map(x=>Number(x.nav));
  if(Math.abs(values.at(-1)-EXPECTED.lastNav)>1e-8)throw Error('最終淨值不符合 C26 凍結資料');
  if(Math.abs(computeMdd(values)-EXPECTED.mdd)>1e-6)throw Error('最大回撤不符合 C26 凍結資料');
  if(Math.abs((values.at(-1)-1)*100-EXPECTED.ret)>1e-6)throw Error('累積淨報酬不符');
  for(let i=1;i<daily.length;i++)if(daily[i].date<=daily[i-1].date)throw Error('回放日線日期未遞增');
  let buy=0,sell=0,notFilled=0,newFills=0;const validReasons=new Set(['new_position','fc17_confirmed_reentry','previous_limit_missed']);
  for(const o of orders){
    if(!o.signal_date||!o.execution_date||o.signal_date>=o.execution_date)throw Error('委託使用不合法訊號日期');
    if(!['BUY','SELL'].includes(o.action))throw Error('不合法交易方向');
    if(!['True','False','true','false','1','0'].includes(String(o.filled)))throw Error('委託成交欄位無效');
    const filled=['True','true','1'].includes(String(o.filled));
    if(!filled){if(o.action!=='BUY')throw Error('非買入委託未成交，與凍結紀錄不符');notFilled++;}
    else if(o.action==='BUY'){buy++;if(validReasons.has(o.reason)){newFills++;if(Number(o.notional_proxy)*3000000<9999.99)throw Error('微額進場未通過最低一萬元限制');}}
    else sell++;
  }
  if(buy!==EXPECTED.buyFills||sell!==EXPECTED.sellFills||notFilled!==EXPECTED.unfilledBuys||newFills!==EXPECTED.newBuys)throw Error('成交分類筆數與 C26 封存紀錄不同');
  return {nav:values,ret:EXPECTED.ret,mdd:EXPECTED.mdd,orders:orders.length,buys:buy,sells:sell,newFills};
}
const inflate=async(bytes,kind)=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(kind))).arrayBuffer());
const textDecoder=new TextDecoder('utf-8');
async function gzipText(bytes){return textDecoder.decode(await inflate(bytes,'gzip'));}
/* Selective ZIP extraction: read central directory, never fetch the 133MB data payload into RAM. */
export async function readZipEntries(file,matchers){
  const tailOffset=Math.max(0,file.size-66000),tail=new Uint8Array(await file.slice(tailOffset).arrayBuffer());
  let eo=-1;for(let i=tail.length-22;i>=0;i--)if(tail[i]===0x50&&tail[i+1]===0x4b&&tail[i+2]===0x05&&tail[i+3]===0x06){eo=i;break;}
  if(eo<0)throw Error('ZIP 缺少目錄結尾');
  const ed=new DataView(tail.buffer,tail.byteOffset+eo);const count=ed.getUint16(10,true),cdSize=ed.getUint32(12,true),cdOffset=ed.getUint32(16,true);
  if(cdSize>20*1024*1024||count>100000||cdOffset+cdSize>file.size)throw Error('ZIP 中央目錄不合法');
  const cdir=new Uint8Array(await file.slice(cdOffset,cdOffset+cdSize).arrayBuffer());const dv=new DataView(cdir.buffer);let pos=0;const found={};
  for(let i=0;i<count;i++){
    if(pos+46>cdir.length||dv.getUint32(pos,true)!==0x02014b50)throw Error('ZIP 中央目錄結構不符');
    const method=dv.getUint16(pos+10,true),size=dv.getUint32(pos+20,true),uncompressed=dv.getUint32(pos+24,true),flen=dv.getUint16(pos+28,true),extra=dv.getUint16(pos+30,true),comment=dv.getUint16(pos+32,true),offset=dv.getUint32(pos+42,true);
    const filename=textDecoder.decode(cdir.subarray(pos+46,pos+46+flen));
    pos+=46+flen+extra+comment;
    const selected=matchers.find(m=>filename.endsWith(m));if(!selected)continue;
    if(size>12*1024*1024||uncompressed>25*1024*1024)throw Error('C26 ZIP 文件過大');
    const header=new DataView(await file.slice(offset,offset+30).arrayBuffer());
    if(header.getUint32(0,true)!==0x04034b50)throw Error('ZIP 本地標頭無效');
    const start=offset+30+header.getUint16(26,true)+header.getUint16(28,true);
    const contents=new Uint8Array(await file.slice(start,start+size).arrayBuffer());
    const raw=method===0?contents:method===8?await inflate(contents,'deflate-raw'):(()=>{throw Error('ZIP 壓縮方式不支援');})();
    if(raw.byteLength!==uncompressed)throw Error('ZIP 解壓長度不符');
    found[selected]=new Uint8Array(raw);
  }
  return found;
}
function modelDateSet(daily,orders){
  let next=0;const events=[];const history=[];const pos=new Map();
  const fills=orders.filter(o=>['True','true','1'].includes(String(o.filled))).sort((a,b)=>a.execution_date.localeCompare(b.execution_date));
  for(const day of daily){
    const today=[];while(next<fills.length&&fills[next].execution_date<=day.date){
      const o=fills[next++];const ticker=String(o.ticker).padStart(4,'0'),q=Number(o.shares_proxy),prior=pos.get(ticker)||0;
      if(!finite(q)||q<0)throw Error('股數不合法');
      const updated=prior+(o.action==='BUY'?q:-q);
      if(updated<-1e-8)throw Error('歷史交易造成負股數');
      if(updated<1e-11)pos.delete(ticker);else pos.set(ticker,updated);
      today.push(o);
    }
    if(pos.size>8)throw Error('歷史持倉超過8檔');
    history.push([...pos].map(([code,shares])=>({code,shares})));events.push(today);
  }
  return {history,events};
}
function graph(values){
  const width=980,height=290,left=54,right=24,top=18,bottom=30,low=Math.min(0,...values),high=Math.max(...values,1),hi=Math.max(1e-8,high-low);
  const coords=values.map((v,i)=>[(left+i*(width-left-right)/(values.length-1)).toFixed(2),(height-bottom-(v-low)/hi*(height-top-bottom)).toFixed(2)].join(','));
  return `<svg role="img" aria-label="C26真實歷史回放1407日淨值曲線" viewBox="0 0 ${width} ${height}"><line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" stroke="#9db3a3"/><polyline fill="none" stroke="#17684f" stroke-width="2.8" points="${coords.join(' ')}"/><text x="4" y="${top+10}" font-size="14" fill="#456255">${money(high)}×</text><text x="${left}" y="${height-5}" font-size="13" fill="#456255">2021/01</text><text x="${width-right}" y="${height-5}" text-anchor="end" font-size="13" fill="#456255">2026/10</text></svg>`;
}
function periodRows(daily,monthly){
  const segments=new Map();for(let i=0;i<daily.length;i++){const d=daily[i].date,key=d.slice(0,monthly?7:4);if(!segments.has(key))segments.set(key,[]);segments.get(key).push(i);}
  return [...segments].reverse().map(([label,indices])=>{
    const first=indices[0],last=indices.at(-1),begin=first?Number(daily[first-1].nav):1;let peak=begin,draw=0;
    for(const j of indices){const now=Number(daily[j].nav);peak=Math.max(peak,now);draw=Math.min(draw,now/peak-1);}
    const ret=Number(daily[last].nav)/begin-1;
    return `<tr><td>${label}</td><td>${percent(ret)}</td><td class="red">${percent(draw)}</td></tr>`;
  }).join('');
}
async function init(){
  const manifest=await (await fetch('./manifest.json',{cache:'no-store'})).json();
  if(manifest.lock_id!=='C26-EVENT-CORR-LOCK-20261112'||manifest.live_plan_readiness!=='blocked'||manifest.live_trading_enabled!==false)throw Error('C26版本／交易安全設定不符');
  $('c26-lock-id').textContent=manifest.lock_id;
  let stored=null;
  const error=message=>$('c26-archive-state').textContent=`C26 封存讀取失敗：${message}；不發佈任何最新交易指令。`;
  const read=async function(files){
    const inputs={};for(const file of files){const name=file.name;
      if(name.endsWith('.zip'))Object.assign(inputs,await readZipEntries(file,['C26_daily_nav.csv.gz','C26_orders.csv.gz','C26_metrics.json']));
      else if(name.endsWith('.gz')||name.endsWith('.json'))inputs[name]=new Uint8Array(await file.arrayBuffer());
    }
    for(const k of ['C26_daily_nav.csv.gz','C26_orders.csv.gz'])if(!inputs[k])throw Error('缺少 '+k+'，請選擇完整封存ZIP或一起上傳兩個CSV.gz');
    const daily=parseCsv(await gzipText(inputs['C26_daily_nav.csv.gz'])),orders=parseCsv(await gzipText(inputs['C26_orders.csv.gz']));
    validateC26(daily,orders,manifest);
    if(inputs['C26_metrics.json']){
      const metrics=JSON.parse(textDecoder.decode(inputs['C26_metrics.json']));
      if(Math.abs(Number(metrics.return_pct)-EXPECTED.ret)>1e-6||Math.abs(Number(metrics.mdd_pct)-EXPECTED.mdd)>1e-6||metrics.online_deployed!==false)throw Error('ZIP內凍結績效或上線標誌不符');
    }
    const precomputed=modelDateSet(daily,orders);stored={daily,orders,precomputed};
    $('c26-archive-state').textContent=`C26 歷史資料驗證通過：${daily.length}交易日、${orders.length}筆委託、539筆買入與1,028筆賣出成交，最後資料日 ${daily.at(-1).date}。本機讀取，沒有上傳。`;
    $('c26-chart').innerHTML=graph(daily.map(d=>Number(d.nav)));
    $('c26-nav-summary').textContent=`期末模擬淨值 ${money(Number(daily.at(-1).nav)*3000000)} 元（初始300萬元）；回撤 ${EXPECTED.mdd.toFixed(4)}%。`;
    $('c26-date').disabled=false;$('c26-date').innerHTML=daily.map((d,i)=>`<option value="${i}">${safe(d.date)}</option>`).reverse().join('');$('c26-date').value=String(daily.length-1);
    showDay();showPeriods();showOrders();
  };
  const showDay=()=>{
    if(!stored)return;const {daily,precomputed}=stored;const i=Number($('c26-date').value),d=daily[i],cash=Math.max(0,Number($('c26-capital').value)||3000000),factor=cash/3000000;
    const holdings=precomputed.history[i],actions=precomputed.events[i];
    $('c26-day-summary').textContent=`${d.date}｜歷史模型資產 ${money(Number(d.nav)*cash)} 元｜持股 ${holdings.length}/8｜當日已成交買入 ${actions.filter(o=>o.action==='BUY').length}、賣出 ${actions.filter(o=>o.action==='SELL').length}。${actions.map(o=>`${o.ticker} ${o.action==='BUY'?'買':'賣'} ${o.reason}`).join('；')||'當日沒有交易'}。模型股數以初始300萬計，金額換算倍數${money(factor)}。`;
    $('c26-holdings').innerHTML=holdings.map(h=>`<tr><td>${safe(h.code)}</td><td>${money(h.shares)}</td></tr>`).join('')||'<tr><td colspan="2">歷史模型空手</td></tr>';
  };
  const showPeriods=()=>{if(!stored)return;$('c26-periods').innerHTML=periodRows(stored.daily,$('c26-month-mode').value==='monthly');};
  const showOrders=()=>{
    if(!stored)return;const side=$('c26-order-side').value,fill=$('c26-order-fill').value,code=$('c26-order-code').value.trim();const dates=stored.daily;
    const rows=stored.orders.filter(o=>(side==='all'||o.action===side)&&(fill==='all'||String(o.filled).toLowerCase()===(fill==='true'?'true':'false'))&&(!code||String(o.ticker).includes(code))).slice(-250).reverse();
    $('c26-order-count').textContent=`符合篩選 ${rows.length} 筆（最多顯示最近250筆，完整封存共1,758筆）`;
    $('c26-orders').innerHTML=rows.map(o=>`<tr><td>${safe(o.execution_date)}</td><td>${safe(o.ticker)}</td><td>${o.action==='BUY'?'買入':'賣出'}</td><td>${String(o.filled).toLowerCase()==='true'?'成交':'未成交'}</td><td>${money(Number(o.fill_price))}</td><td>${safe(o.reason)}</td></tr>`).join('')||'<tr><td colspan="6">沒有符合條件紀錄</td></tr>';
  };
  $('c26-file').addEventListener('change',async ev=>{stored=null;$('c26-archive-state').textContent='讀取並驗證 C26 歷史資料中…';try{await read(ev.target.files);}catch(e){error(e.message);$('c26-date').disabled=true;$('c26-chart').innerHTML='<p>尚未驗證的檔案不展示為C26歷史交易。</p>';$('c26-day-summary').textContent='歷史資料尚未驗證';$('c26-holdings').innerHTML='';$('c26-orders').innerHTML='';}});
  $('c26-date').addEventListener('change',showDay);$('c26-capital').addEventListener('change',showDay);$('c26-month-mode').addEventListener('change',showPeriods);
  for(const id of ['c26-order-side','c26-order-fill','c26-order-code'])$(id).addEventListener('input',showOrders);
}
if(typeof document!=='undefined')init().catch(e=>{$('c26-archive-state').textContent=`C26 凍結資訊無法確認：${e.message}`;$('c26-live-readiness').textContent='C26 最新交易計畫：BLOCKED';});