/* Shared Action weights for scanner and detail. */
(function(root){
  'use strict';
  const key='twq_action_weights_v1160r2';
  const keys=['entry','setup','opportunity','hold'];
  const defaults={entry:40,setup:30,opportunity:30,hold:0};
  function valid(w){return !!w&&keys.every(k=>Number.isFinite(w[k])&&w[k]>=0&&w[k]<=100)&&Math.abs(keys.reduce((s,k)=>s+w[k],0)-100)<1e-9}
  function read(){
    try{const x=JSON.parse(root.localStorage.getItem(key)||'null');if(!x)return {...defaults};
      const w=Object.fromEntries(keys.map(k=>[k,Number(x[k]??(k==='hold'?0:NaN))]));
      return valid(w)?w:{...defaults};
    }catch(e){return {...defaults}}
  }
  function score(s,w=read()){
    if(!valid(w)||!s)return null;
    if(!keys.every(k=>w[k]===0||(s[k]!=null&&Number.isFinite(Number(s[k])))))return null;
    return Math.round(keys.reduce((sum,k)=>sum+(w[k]===0?0:Number(s[k])*w[k]/100),0));
  }
  function delta(s,p,w=read()){const a=score(s,w),b=score(p,w);return a==null||b==null?null:a-b}
  function save(w){if(!valid(w))return false;try{const raw=JSON.stringify(w);if(root.localStorage.getItem(key)!==raw)root.localStorage.setItem(key,raw)}catch(e){}return true}
  root.TWAction={key,keys,defaults,valid,read,score,delta,save};
})(globalThis);
