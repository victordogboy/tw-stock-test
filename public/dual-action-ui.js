(function(root){
 'use strict';
 const D=root.TWDualAction;
 function controls(el,onChange){
  let weights=D.read(),valid=true;
  el.innerHTML='<b>R24｜進場／續抱 Action 分開設定</b><p class="small muted">兩組各自合計100%，與個股頁共用。續抱分數越低越弱；負日變化與高點回落是警訊，不是自動賣出指令。比例尚未經回測最佳化。更改權重只重排目前名單；全市場候選需重新掃描。</p>'+['buy','stay'].map(group=>`<fieldset style="border:1px solid #394969;border-radius:10px;margin:8px 0"><legend>${group==='buy'?'進場 Action':'續抱 Action（出場觀察）'}</legend><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">${D.keys.map(k=>`<label style="font-size:12px">${k==='opportunity'?'Opp.':k} %<input style="width:100%;box-sizing:border-box;min-width:0;background:#0d1425;color:#edf3ff;border:1px solid #394969;border-radius:8px;padding:9px 6px" type="number" min="0" max="100" step="1" data-group="${group}" data-key="${k}" value="${weights[group][k]}"></label>`).join('')}</div></fieldset>`).join('')+'<button type="button" data-reset>恢復雙組預設</button><p data-status class="small muted"></p>';
  const inputs=[...el.querySelectorAll('input')],status=el.querySelector('[data-status]');
  function apply(save=true){weights={buy:{},stay:{}};for(const n of inputs)weights[n.dataset.group][n.dataset.key]=n.value.trim()===''?NaN:Number(n.value);valid=D.valid(weights);const saved=valid&&(!save||D.save(weights));status.textContent=valid?(saved?'設定有效｜兩組各100%':'本次設定有效，但瀏覽器儲存失敗；重新開啟後需重設'):'兩組都必須合計100%；雙 Action 暫不計分，不能啟動掃描。';onChange(weights,valid)}
  function fill(w){for(const n of inputs)n.value=w[n.dataset.group][n.dataset.key]}
  inputs.forEach(n=>n.addEventListener('input',()=>apply()));
  el.querySelector('[data-reset]').onclick=()=>{fill(D.defaults);apply()};
  root.addEventListener('storage',e=>{if(e.key===D.key){fill(D.read());apply(false)}});
  apply(false);
  return {set(w){if(D.valid(w)){fill(w);apply()}},busy(b){inputs.forEach(n=>n.disabled=b);el.querySelector('[data-reset]').disabled=b}};
 }
 function paint(el,row,weights,title){
  if(!el)return;el.replaceChildren();const head=document.createElement('b');head.textContent=title;el.append(head);
  const m=D.metrics(row,weights),grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px';
  for(const [label,value,delta] of [['進場 Action',m.buy],['進場日變化',m.buyDelta,true],['續抱 Action',m.stay],['續抱日變化',m.stayDelta,true],['距前5日最高分回落',m.stayDrop]]){const cell=document.createElement('div');cell.style.cssText='padding:8px;border:1px solid #394969;border-radius:8px';const l=document.createElement('div');l.className='label';l.textContent=label;const v=document.createElement('b');v.style.fontSize='22px';v.textContent=delta?D.signed(value):value??'—';if(delta)v.style.color=value>0?'#ff8585':value<0?'#65d99a':'';cell.append(l,v);grid.append(cell)}
  el.append(grid);for(const text of [`分數日 ${row?.dataDate||'—'}｜比較 ${row?.previousDate||'—'}｜五日回落不含今日作為基準；資料不足顯示 —`,row?.priceGuard?.broken?'價格結構破位：出場警戒優先，不以其他分數抵銷。':'分數轉弱需搭配支撐；承接提示不計分。',D.note(row?.absorption),row?.absorption?.ratio!=null?`近5日外資＋投信淨額 ${Math.round(row.absorption.net5/1000)} 張，占同期成交量 ${row.absorption.ratio.toFixed(2)}%；同期股價 ${row.absorption.return5.toFixed(2)}%。`:'']){if(!text)continue;const p=document.createElement('p');p.className='small muted';p.textContent=text;el.append(p)}
 }
 root.TWDualUI={controls,paint};
})(globalThis);
