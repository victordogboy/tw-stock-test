'use strict';
const $=id=>document.getElementById(id);
const money=x=>Number(x).toLocaleString('zh-TW',{maximumFractionDigits:2,minimumFractionDigits:2});
const pct=x=>(x>=0?'+':'')+money(x)+'%';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=id=>({'BUY':'買進','SELL':'賣出','new_position':'建立新倉','topup':'原持股補倉','risk_exit':'風控出場','rank_exit':'排名淘汰','cap16':'降低單股曝險','portfolio_reduce':'帳戶減碼'}[id]||id);
const colors={fc23:'#29b788',r1494:'#4d70d9',hold49:'#d57c31',market:'#8b72af'};
function curveSvg(series){
 const width=900,height=300,vals=series.flatMap(a=>a.points.map(b=>b.y)),low=Math.min(0,...vals),high=Math.max(...vals);
 if(!Number.isFinite(low)||!Number.isFinite(high))return '<p>績效資料不完整</p>';
 const pad=36,hi=(high-low)||1;
 const lines=series.map(s=>{
  const p=s.points.map((d,i)=>[pad+(d.x/69)*(width-2*pad),height-pad-(d.y-low)/hi*(height-2*pad)]);
  return '<polyline fill="none" stroke="'+colors[s.key]+'" stroke-width="3" points="'+p.map(x=>x.map(z=>z.toFixed(1)).join(',')).join(' ')+'"></polyline>';
 }).join('');
 return '<svg role="img" aria-label="2021至2026年10月策略與基準累積淨值走勢比較" viewBox="0 0 '+width+' '+height+'" style="width:100%;height:auto;max-height:340px"><line x1="'+pad+'" x2="'+(width-pad)+'" y1="'+(height-pad)+'" y2="'+(height-pad)+'" stroke="#a6bdb1"/>'+
 '<line x1="'+pad+'" x2="'+pad+'" y1="'+pad+'" y2="'+(height-pad)+'" stroke="#a6bdb1"/>'+
 '<text x="'+(pad+5)+'" y="'+(pad+1)+'" font-size="15" fill="#51695b">'+money(high)+'倍</text>'+
 '<text x="'+(pad+4)+'" y="'+(height-pad-6)+'" font-size="15" fill="#51695b">'+money(low)+'倍</text>'+
 '<text x="'+pad+'" y="'+(height-4)+'" font-size="14" fill="#51695b">2021</text>'+
 '<text x="'+(width-pad-36)+'" y="'+(height-4)+'" font-size="14" fill="#51695b">2026/10</text>'+lines+'</svg>';
}
function findEndIndex(d,year,month){
 const cap=year+'-'+String(month).padStart(2,'0')+'-31';let idx=-1;
 for(let i=0;i<d.dates.length;i++)if(d.dates[i]<=cap&&d.dates[i]<='2026-10-27')idx=i;
 return idx;
}
function mapSeries(s,curve,dates){
 const offset=dates.length-curve.length;
 const vals=[];
 for(let j=0;j<s.monthly.length;j++){const m=s.monthly[j].month,ix=findEndIndex({dates},Number(m.slice(0,4)),Number(m.slice(5)));const k=ix-offset; vals.push(k>=0&&k<curve.length?curve[k]:null);}
 const start=curve[0]||1;
 return vals.map((v,i)=>({x:i,y:Number.isFinite(v)?v/start:NaN})).filter(q=>Number.isFinite(q.y));
}
function renderFills(d){
 const sel=$('fc23-fill-side')?.value||'all';
 const rows=d.fills.filter(x=>sel==='all'||x[2]===sel).slice().reverse();
 const head='<tr><th>日期</th><th>股票</th><th>操作</th><th>價格</th><th>原始報酬</th><th>原因</th></tr>';
 $('fc23-fills').innerHTML='<div class="scroll"><table><thead>'+head+'</thead><tbody>'+
 rows.map(r=>'<tr><td>'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td>'+esc(label(r[2]))+'</td><td>'+money(r[4])+'</td><td style="color:'+(Number(r[5])>=0?'#18694f':'#b64d43')+'">'+(r[5]===null?'—':pct(r[5]))+'</td><td>'+esc(label(r[3]))+'</td></tr>').join('')+
 '</tbody></table></div>';
}
async function loadBench(){
 const r=await fetch('../snapshot.bin',{cache:'no-store'});
 if(!r.ok)throw Error('共用R1494來源讀取失敗：HTTP '+r.status);
 if(typeof DecompressionStream==='undefined')throw Error('瀏覽器不支援gzip串流解碼');
 const obj=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
 if(obj.model_version!=='R1494-A'||!obj.curves||!obj.dates)throw Error('原站資料格式與預期不同');
 return obj;
}
async function init(){
 const [h,bench]=await Promise.all([fetch('./historical-sample.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('FC23歷史逐筆資料缺漏');return r.json();}),loadBench()]);
 if(h.mode!=='HISTORICAL_ONLY'||h.monthly?.length!==70)throw Error('FC23資料檢查未通過');
 const latest=bench.status?.data_as_of||bench.asOf||bench.snapshots?.at(-1)?.date||'未知';
 $('fc23-shared-data').innerHTML='<strong>共用R1494-A資料更新</strong>：最近日K <b>'+esc(latest)+'</b>；原站下一交易日 <b>'+esc(bench.plan?.trade_date)+'</b>'+
 '. <span class="fc23-warning">資料來源可共用，但FC23自己的最新買賣計畫仍需由原FC23引擎重新計算。</span>';
 const cap='2026-10-27';
 const months=h.monthly;
 const fc23=months.map((row,i)=>({x:i,y:row.nav}));
 const candidates=[
  {key:'fc23',points:fc23},
  {key:'r1494',points:mapSeries(h,bench.curves.strategy,bench.dates)},
  {key:'hold49',points:mapSeries(h,bench.curves.old49,bench.dates)},
  {key:'market',points:mapSeries(h,bench.curves.market,bench.dates)}];
 const names={fc23:'FC23（封存2026/10）',r1494:'R1494-A（同期）',hold49:'49檔等額長抱（同期）',market:'大盤代理（同期）'};
 const first=Object.fromEntries(candidates.map(c=>[c.key,c.points.find(x=>x.x===0)?.y||1]));
 const ledger=candidates.map(c=>{const last=c.points.at(-1);return [names[c.key],last?last.y:NaN];});
 $('fc23-compare-legend').innerHTML=ledger.map((a,i)=>'<span style="display:inline-flex;gap:6px;align-items:center;margin:5px 17px 5px 0"><i style="background:'+colors[candidates[i].key]+';width:11px;height:11px;display:inline-block;border-radius:6px"></i>'+esc(a[0])+': <strong>'+pct((a[1]-1)*100)+'</strong></span>').join('');
 $('fc23-performance-chart').innerHTML=curveSvg(candidates);
 $('fc23-fills-comment').textContent='顯示FC23封存引擎實際成交的最後'+h.fills.length+'筆；賣出報酬是相對原持股成本的單筆比率，未單獨扣交易費用。這不是完整逐筆列表，也不是R1494交易紀錄。';
 renderFills(h);$('fc23-fill-side').addEventListener('change',()=>renderFills(h));
 $('fc23-why').innerHTML='<strong>FC23 歷史封存與最新紙上計畫的區別</strong><p>本區的歷史績效、成交樣本與逐筆交易都固定截至 <b>'+esc(cap)+'</b>。最新FC23獨立紙上持倉、下一交易日計畫及沒有訊號的原因，請看本頁上方「FC23 最新紙上進出計畫」。該區直接查詢FC23自己的最新後端，不會混用R1494-A訊號。</p>'+
 '<p>共用行情來源最近更新到 <b>'+esc(latest)+'</b>；這個日期不等於FC23紙上模型一定更新成功，須以上方FC23自身的驗證狀態為準。</p>';
}

init().catch(e=>{if($('fc23-shared-data'))$('fc23-shared-data').textContent='⚠️ '+e.message+'。FC23當期交易訊號仍禁止使用。';});
