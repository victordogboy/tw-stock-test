(() => {
 let serial=0,controller;
 const box=document.createElement('section');box.className='card';box.style.cssText='margin:16px;padding:16px;border:1px solid #53627a;border-radius:12px';
 const anchor=document.getElementById('stockInput');
 (anchor?.closest('main')||document.body).appendChild(box);
 const fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
 const line=text=>{const p=document.createElement('p');p.textContent=text;box.appendChild(p);};
 const selected=new URL(location.href).searchParams.get('peStrategy');
 const order=[...new Set([['A','B','C'].includes(selected)?selected:'A','A','B','C'])];
 window.loadForwardPE=async query=>{
  const id=++serial;controller?.abort();controller=new AbortController();box.replaceChildren();
  if(!query){line('輸入股票後顯示預估本益比');return;}
  const code=String(query).trim().match(/^\d{4}(?=\s|$)/)?.[0]||query;
  line('R53｜正在取得 '+code+' 預估 EPS／年度本益比…');
  try{
   const res=await fetch('/api/pe-screener/stock?query='+encodeURIComponent(code),{signal:controller.signal,cache:'no-store'});
   const data=await res.json();if(id!==serial)return;
   if(!res.ok||!data.ok||!data.stock)throw Error(data.error||'請使用明確股票代號查詢');
   const r=data.stock;box.replaceChildren();line('R53｜'+r.code+' '+r.name+' 預估 EPS／年度本益比');
   line('估值股價 '+fmt(r.close)+'｜行情日 '+(r.quoteReportedDate||'未提供')+'｜'+(r.priceSource||'缺來源')+'｜財報 '+(r.financeQuarter||'缺')+'｜營收 '+(r.latestRevenueMonth||'缺'));
   for(const key of order){const m=r.models?.[key];line(key+'：'+(m?.status==='ok'?'全年預估 EPS '+fmt(m.eps)+' 元｜預估本益比 '+fmt(m.pe)+' 倍':m?.status||'缺資料'));
    const d=r.revenueRevision?.models?.[key];if(d?.status==='ok')line('營收 '+r.revenueRevision.previousMonth+' → '+r.revenueRevision.currentMonth+'｜月增 '+fmt(r.revenueRevision.momPct)+'%｜PE '+fmt(d.previousPE)+' → '+fmt(d.currentPE)+'｜降低 '+fmt(d.peDrop)+' 倍（'+fmt(d.peDropPct)+'%）');
   }
   line(r.revenueRevision?.basis||r.revenueRevision?.status||'缺營收比較資料');
   line('使用取得的最新行情快照，非保證盤中即時；預估值依固定獲利率／費用假設計算。');
  }catch(e){if(id===serial&&e.name!=='AbortError'){box.replaceChildren();line('預估本益比取得失敗：'+e.message);}}
 };
 // Place the valuation section immediately after the search controls when available.
 const parent=document.getElementById('banner');if(parent)parent.after(box);
})();
