(function(root){
  'use strict';
  const defaults=Object.freeze({enabled:true,start:0.02,step:0.02,max:0.2});
  const storageKey='twq_chart_sar_v1';
  function validate(input={}){
    const p={...defaults,...input};
    for(const k of ['start','step','max']){
      p[k]=Number(p[k]);
      if(!Number.isFinite(p[k])||p[k]<=0||p[k]>1)throw new Error('加速因子須大於 0 且不超過 1。');
    }
    if(p.max<p.start||p.max<p.step)throw new Error('上限不可小於初始值或每次增加量。');
    p.enabled=p.enabled!==false;
    return p;
  }
  // Wilder recurrence; seed direction from the first two closes. First bar has no SAR.
  // Calculate the entire available prefix before taking the chart's visible window.
  function calculate(rows,input){
    const p=validate(input),out=Array(rows.length).fill(null);
    let seed=null,previous=null,older=null,up,sar,ep,af;
    for(let i=0;i<rows.length;i++){
      const b=rows[i];
      if(!b||![b.high,b.low,b.close].every(Number.isFinite)||b.high<b.low){
        seed=previous=older=null;continue;
      }
      if(!seed){seed=b;continue;}
      if(!previous){
        up=b.close>=seed.close;af=p.start;
        sar=up?Math.min(seed.low,b.low):Math.max(seed.high,b.high);
        ep=up?Math.max(seed.high,b.high):Math.min(seed.low,b.low);
        previous=b;older=seed;
      }else{
        let next=sar+af*(ep-sar);
        next=up?Math.min(next,previous.low,older.low):Math.max(next,previous.high,older.high);
        if((up&&b.low<next)||(!up&&b.high>next)){
          up=!up;
          sar=up?Math.min(ep,b.low):Math.max(ep,b.high);
          ep=up?b.high:b.low;af=p.start;
        }else{
          sar=next;
          if((up&&b.high>ep)||(!up&&b.low<ep)){
            ep=up?b.high:b.low;af=Math.min(p.max,af+p.step);
          }
        }
        older=previous;previous=b;
      }
      out[i]={value:sar,up,af};
    }
    return out;
  }
  let settings={...defaults};
  try{settings=validate(JSON.parse(root.localStorage.getItem(storageKey))||{});}catch{}
  function init(redraw){
    const $=id=>root.document.getElementById(id);
    function fill(){
      $('sarEnabled').checked=settings.enabled;
      for(const k of ['start','step','max'])$('sar'+k).value=settings[k];
    }
    function save(next){
      settings=next;let message='';
      try{root.localStorage.setItem(storageKey,JSON.stringify(settings));}catch{message='目前瀏覽器無法儲存設定，本次仍可使用。';}
      $('sarError').textContent=message;redraw();
    }
    fill();
    $('sarEnabled').addEventListener('change',()=>save({...settings,enabled:$('sarEnabled').checked}));
    for(const k of ['start','step','max'])$('sar'+k).addEventListener('change',()=>{
      try{save(validate({enabled:$('sarEnabled').checked,start:$('sarstart').value,step:$('sarstep').value,max:$('sarmax').value}));}
      catch(e){$('sarError').textContent=e.message+' 圖表維持上一組有效設定。';}
    });
    $('sarReset').addEventListener('click',()=>{settings={...defaults};fill();save(settings);});
  }
  const api={defaults,validate,calculate,init,get settings(){return {...settings};}};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.TWSar=api;
})(typeof window==='object'?window:globalThis);
