(function(global){
  'use strict';
  const STORE_KEY='twq_finmind_tokens_v2';
  const LEGACY_KEY='twq_finmind_token_v1';
  const clean=value=>String(value||'').trim();
  function read(){
    let saved={tokens:['',''],active:0};
    try{
      const parsed=JSON.parse(localStorage.getItem(STORE_KEY)||'null');
      if(parsed&&Array.isArray(parsed.tokens))saved={tokens:[clean(parsed.tokens[0]),clean(parsed.tokens[1])],active:Number(parsed.active)===1?1:0};
      const legacy=clean(localStorage.getItem(LEGACY_KEY));
      if(legacy&&!saved.tokens[0])saved.tokens[0]=legacy;
    }catch(e){}
    return saved;
  }
  function write(state){
    const next={tokens:[clean(state.tokens?.[0]),clean(state.tokens?.[1])],active:Number(state.active)===1?1:0};
    localStorage.setItem(STORE_KEY,JSON.stringify(next));
    if(next.tokens[next.active])localStorage.setItem(LEGACY_KEY,next.tokens[next.active]);
    else localStorage.removeItem(LEGACY_KEY);
    return next;
  }
  function activeToken(){const s=read();return clean(s.tokens[s.active])}
  function headers(extra={}){const token=activeToken();return token?{...extra,Authorization:'Bearer '+token}:{...extra}}
  function masked(token){token=clean(token);return token?('••••'+token.slice(-4)):'未設定'}
  function bind(opts={}){
    const one=document.getElementById(opts.one||'finmindTokenInput1'),two=document.getElementById(opts.two||'finmindTokenInput2'),active=document.getElementById(opts.active||'finmindTokenActive'),save=document.getElementById(opts.save||'saveFinmindTokensBtn'),clear=document.getElementById(opts.clear||'clearFinmindTokensBtn');
    if(!one||!two||!active||!save)return;
    const load=()=>{const s=read();one.value=s.tokens[0];two.value=s.tokens[1];active.value=String(s.active)};load();
    save.onclick=async()=>{
      const s=write({tokens:[one.value,two.value],active:Number(active.value)});
      if(!s.tokens.some(Boolean)){alert('請至少輸入一組 FinMind API Token');return}
      if(!s.tokens[s.active]){alert('目前選用的 Token 尚未填寫');return}
      if(opts.onChange)await opts.onChange();
    };
    active.onchange=async()=>{
      const s=write({tokens:[one.value,two.value],active:Number(active.value)});
      if(opts.onChange)await opts.onChange();
    };
    if(clear)clear.onclick=async()=>{
      localStorage.removeItem(STORE_KEY);localStorage.removeItem(LEGACY_KEY);one.value='';two.value='';active.value='0';
      if(opts.onChange)await opts.onChange();
    };
  }
  global.TWFinMindTokens={read,write,activeToken,headers,masked,bind,STORE_KEY};

  // R20.4: R20.3 expanded the backend to five years but the research UI still
  // initialized start to only 540 days ago. Keep the editable fields, but make
  // the default a real five-calendar-year signal window.
  const DAY=86400000;
  const iso=d=>d.toISOString().slice(0,10);
  function fiveYearStart(end){
    const e=new Date(end+'T12:00:00Z'),d=new Date(e);d.setUTCFullYear(d.getUTCFullYear()-5);
    const clamp=new Date(e.getTime()-1827*DAY);
    return iso(d<clamp?clamp:d);
  }
  function fixResearchDates(){
    if(!/strategy-regression-lab\.html$/.test(location.pathname))return;
    const start=document.getElementById('start'),end=document.getElementById('end');
    if(start&&end&&end.value){start.value=fiveYearStart(end.value);start.min='2010-07-01';start.max=end.value;}
  }

  // R20.4: old persisted scan/watch records can contain name=code. Rehydrate
  // names from the current official universe, update live results, and persist
  // the repaired records so the bug does not return after reload.
  const validName=(name,code)=>{const s=clean(name);return !!s&&s!==String(code)&&!/^\d{4}$/.test(s)};
  function repairNames(obj,names){
    let changed=false;if(!obj||typeof obj!=='object')return false;
    if(Array.isArray(obj)){for(const x of obj)changed=repairNames(x,names)||changed;return changed;}
    const code=clean(obj.code||obj.stock_id);
    if(/^\d{4}$/.test(code)&&names.has(code)&&!validName(obj.name,code)){obj.name=names.get(code);changed=true;}
    for(const v of Object.values(obj))if(v&&typeof v==='object')changed=repairNames(v,names)||changed;
    return changed;
  }
  function repairStore(storage,key,names){try{const raw=storage.getItem(key);if(!raw)return;const x=JSON.parse(raw);if(repairNames(x,names))storage.setItem(key,JSON.stringify(x));}catch{}}
  async function fixScannerNames(){
    if(!/scanner\.html$/.test(location.pathname))return;
    try{
      const r=await fetch('/api/market/universe?_r204='+Date.now(),{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok||!Array.isArray(j.data))return;
      const names=new Map(j.data.map(x=>[clean(x.code),clean(x.name)]).filter(([c,n])=>/^\d{4}$/.test(c)&&validName(n,c)));
      if(!names.size)return;
      repairStore(localStorage,'twq_scan_state_v1100',names);repairStore(sessionStorage,'twq_scan_state_v1100',names);repairStore(localStorage,'twq_watchsnap_v16',names);
      try{if(typeof results!=='undefined'&&Array.isArray(results)){repairNames(results,names);if(typeof persistScan==='function')persistScan();if(typeof renderRankOnly==='function')renderRankOnly(typeof currentRank==='string'?currentRank:'entry');}}catch{}
      try{if(typeof renderWatchlist==='function')renderWatchlist();}catch{}
    }catch(e){console.warn('R20.4 name repair skipped',e);}
  }
  function r204Boot(){fixResearchDates();fixScannerNames();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',r204Boot,{once:true});else setTimeout(r204Boot,0);
  global.TWR204={fiveYearStart,validName,repairNames};
})(window);
