import {MinuteMonitor} from './signals.mjs';
const $=id=>document.getElementById(id);
const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d}):'—';
const pct=v=>Number.isFinite(v)?(v>=0?'+':'')+num(v)+'%':'—';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=m=>`${String(9+Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const reason={pending_cycle:'前次出場尚未完成',core_recovery:'C26目標恢復或核心新買',warning_ended:'大盤警戒解除',cycle_expiry:'首次成交後第5交易日'};
const route={A_open:'A 開盤',B_reclaim:'B 跨日',C_intraday:'C 即日'};
const list=a=>a.length?a.map(esc).join('、'):'無';
const table=(head,rows)=>`<div class="tablewrap"><table><thead><tr>${head.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${head.length}">無紀錄</td></tr>`}</tbody></table></div>`;
async function get(path){const r=await fetch(path);if(!r.ok)throw Error(`資料讀取失敗 ${r.status}`);if(!path.endsWith('.b64'))return r.json();const data=Uint8Array.from(atob((await r.text()).trim()),c=>c.charCodeAt(0));const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())}
let summary,days,minuteCases=[],minuteError=null;
function monitorPanel(p,cut){
 const cases=minuteCases.filter(x=>x.date===p.date),bc=p.BC_after_open;
 if(minuteError)return '<h3>已完成分 K 訊號核對</h3><p>'+esc(minuteError)+'</p>';
 if(!p.warning)return '<h3>已完成分 K 訊號核對</h3><p>沒有大盤警戒，本日不啟用反轉監看。</p>';
 if(!bc)return '<h3>已完成分 K 訊號核對</h3><p>本日資金／輪次條件未啟用 B/C 監看。</p>';
 const filled=new Set(p.orders.filter(o=>o.minute<=cut&&o.action==='BUY').map(o=>o.code));
 const rows=p.candidates.slice(0,bc.rank_slots).map(c=>{
  if(bc.blocked.includes(c.code)||filled.has(c.code))return [c.code,'已持有／本日已模擬買入','—','—','—'];
  const x=cases.find(x=>x.candidate.code===c.code);if(!x)return [c.code,'缺少已核對分 K，停止訊號','—','—','—'];
  const m=new MinuteMonitor(x.candidate,bc.budget/p.prior_nav,bc.rank_slots,p.prior_nav);
  let intents=[];const count=Math.min(Math.max(0,cut),210);
  for(let k=0;k<count;k++)intents=m.completed(k,...x.bars[k].map(v=>v===null?NaN:v));
  const status=count===0?'等待第一根完整分 K':m.cReclaimed?'C 已確認收復':m.down?'C 已急跌，等待後續收復':'C 尚未觸發急跌';
  const b=m.bReclaimed?'B 已確認收復':c.B?'B 等待收復':'B 無跨日資格';
  const valid=cut<=210?intents:[];
  return [c.code,status+'；'+b,valid.map(i=>route[i.route]).join('／')||'無',valid.map(i=>num(i.min_price)+'–'+num(i.max_price)).join('／')||'—',valid.map(i=>num(i.shares,0)).join('／')||'—'];
 });
 return '<h3>已完成分 K 訊號核對｜截至 '+esc(time(cut))+'</h3><p class="muted">僅讀取截至指定時間已結束的分鐘資料。條件訊號仍須在下一分鐘核對價格、現金與名額；股數為容量上限，不代表成交。12:30 後不新增訊號。</p>'+table(['股票','已知狀態','條件路徑','下一分鐘價格區間','容量上限（股）'],rows);
}

function validate(s,d){if(s.version!=='A56-LOCK-20261116'||s.status!=='historical_replay_only'||d.length!==1419||d.at(-1).date!==s.data_through)throw Error('版本或交易日數不符');let peak=3e6,mdd=0,orders=0;for(let i=0;i<d.length;i++){const p=d[i];if(!Number.isFinite(p.closing_nav)||p.closing_nav<=0||p.signal>=p.date||(i&&p.date<=d[i-1].date))throw Error('帳本日期或淨值異常');peak=Math.max(peak,p.closing_nav);mdd=Math.min(mdd,p.closing_nav/peak-1);orders+=p.orders.length;if(p.core.length+p.sleeve.length>8)throw Error('持倉超過8檔')}if(Math.abs(mdd*100-s.metrics.mdd_pct)>1e-8||Math.abs((d.at(-1).closing_nav/3e6-1)*100-s.metrics.return_pct)>1e-8||orders!==38||s.trades.length!==19)throw Error('封存績效或成交筆數不符')}
function render(){const p=days[Number($('date').value)],phase=$('phase').value;if(!p)return;const post=phase==='close',intra=phase==='intra';$('timebox').hidden=!intra;$('trades').hidden=!post;const [h,m]=$('clock').value.split(':').map(Number),cut=post?270:intra?(h-9)*60+m:-1;
 const blocked=!p.warning?'未達大盤警戒':p.target>=.4?'C26曝險達40%':p.core_entry.length?'C26有新核心進場':p.pending_buy.length?'有未完成的核心買單':p.pending_exit?'A56有待出場部位':null;
 const a=p.A_open?.order;let html=`<p class="phase">${esc(p.date)}｜訊號日 ${esc(p.signal)}｜${p.warning?'警戒啟動':'未警戒'}</p><p>前五日單日最差 <b>${pct(p.market_day)}</b>；累積 <b>${pct(p.market_5)}</b>；C26目標曝險 <b>${pct(p.target*100)}</b></p><p>前日帳戶權益 ${num(p.prior_nav,0)} 元；現金 ${num(p.cash,0)} 元；核心 ${list(p.core)}；反轉 ${list(p.sleeve)}</p><p>核心計畫進場：${list(p.core_entry)}；計畫出場：${list(p.core_exit)}。反轉首次成交日：${esc(p.first)}。</p><p><b>反轉出場：</b>${p.sell_reason?esc(reason[p.sell_reason])+'，開盤賣出 '+list(p.sleeve):p.sleeve.length?'續抱（若原待售狀態則順延）':'無反轉部位'}</p><p><b>進場門檻：</b>${blocked?esc(blocked):'警戒已達，但仍須核對輪次、名額、現金與成交容量'}</p>`;
 html+=`<h3>A 開盤預定單</h3><p>${a?`${esc(a.code)}，最高 ${num(a.cap)} 元，最多 ${num(a.shares,0)} 股；若開盤超價則不成交。`:'沒有預定的 A 路徑開盤單。'}</p><h3>B/C 盤中觀察候選（盤前價格）</h3>`+table(['排名','股票','近5日跌幅','跌前60日漲幅','A 候選／上限','B 收復–上限','C 觸發／收復–上限'],p.candidates.map((c,i)=>[i+1,c.code,pct(-c.loss),pct(c.strength),c.A?num(c.A_cap):'—',c.B?`${num(c.B.floor)}–${num(c.B.cap)}`:'—',`${num(c.C.arm)}／${num(c.C.floor)}–${num(c.C.cap)}`]));
 if(intra)html+=monitorPanel(p,cut);
 if(intra||post){const bc=p.BC_after_open;html+=`<h3>開盤後資金與名額</h3><p>${bc?`順位母體 ${num(bc.rank_slots,0)}，計算配置 ${num(bc.budget,0)} 元，已持有排除 ${list(bc.blocked)}`:'本日沒有啟用 B/C 成交程序。'} </p><h3>${post?'當日':'截至 '+esc($('clock').value)}反轉模擬成交</h3>`+table(['時間','股票','動作','成交價','股數','金額'],p.orders.filter(o=>o.minute<=cut).map(o=>[time(o.minute),o.code,o.action==='BUY'?'買入':'賣出',num(o.price),num(o.shares,0),num(o.notional,0)]));}
 if(post){html+=`<p><b>盤後帳戶權益：</b>${num(p.closing_nav,0)} 元。</p>`;$('tradeRows').innerHTML=summary.trades.filter(t=>t.sell_date<=p.date).map(t=>`<tr>${[t.code,route[t.route]||t.route,t.buy_date+' '+time(t.buy_minute),num(t.buy_price),t.sell_date+' '+time(t.sell_minute),num(t.sell_price),pct(t.net_pct)].map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
 $('day').innerHTML=html;
}
try{const results=await Promise.all([get('./summary.json'),...Array.from({length:6},(_,i)=>get(`./${2021+i}.json.gz.b64`))]);summary=results[0];days=results.slice(1).flat();validate(summary,days);try{const minuteData=await get('./minutes.json.gz.b64');if(minuteData.version!==summary.version||minuteData.data_through!==summary.data_through||!Array.isArray(minuteData.cases))throw Error('分鐘資料版本不符');minuteCases=minuteData.cases}catch(e){minuteError='分鐘資料未通過核對：'+e.message}const s=summary.metrics;$('metrics').innerHTML=[['A56 累積',pct(s.return_pct)],['最大回撤',pct(s.mdd_pct)],['反轉勝率',num(s.win_pct)+'%'],['反轉實際事件',`${s.events} 段`]].map(([l,v])=>`<div class="stat"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('');$('compare').innerHTML=[['原 C26',summary.core_baseline],['A48-40',summary.a48],['A56-LOCK',s]].map(([l,v])=>`<tr><td>${esc(l)}</td><td class="positive">${pct(v.return_pct)}</td><td class="negative">${pct(v.mdd_pct)}</td></tr>`).join('');const ys=days.map(p=>p.closing_nav/3e6),max=Math.max(...ys);$('chart').innerHTML=`<svg viewBox="0 0 860 190" role="img" aria-label="A56歷史淨值曲線"><path d="M35 4V164H852" stroke="#c5d3ca" fill="none"/><polyline fill="none" stroke="#19654b" stroke-width="2" points="${ys.map((y,i)=>`${35+i/(ys.length-1)*817},${164-y/max*153}`).join(' ')}"/><text x="35" y="183" font-size="11">2021/01/06</text><text x="852" y="183" text-anchor="end" font-size="11">2026/11/12</text><text x="0" y="13" font-size="11">${num(max,1)}×</text></svg>`;$('date').innerHTML=days.map((p,i)=>`<option value="${i}">${p.date}${p.warning?' ⚠':''}</option>`).reverse().join('');$('date').disabled=false;$('last').disabled=false;$('date').value=days.length-1;$('date').onchange=render;$('phase').onchange=render;$('clock').oninput=render;$('last').onclick=()=>{const ix=days.findLastIndex((p,i)=>i<Number($('date').value)&&p.warning);if(ix>=0){$('date').value=ix;render()}};render()}catch(e){$('error').textContent='資料核對失敗：'+e.message;$('date').disabled=true;$('last').disabled=true;}

