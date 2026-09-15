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
})(window);
