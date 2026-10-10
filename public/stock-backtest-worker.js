importScripts('/detail-score-r32.js?r32','/stock-backtest-core.js?r33');
let cacheKey='',prepared=null;
self.onmessage=({data:input})=>{
  try{
    const progress=p=>self.postMessage({type:'progress',...p});
    const key=JSON.stringify(input.data);
    if(cacheKey!==key){prepared=TWStockBacktest.prepare(input.data,TWDetailScore,progress);cacheKey=key;}
    const result=input.mode==='optimize'?TWStockBacktest.optimize(prepared.rows,input.params,progress):{full:TWStockBacktest.simulate(prepared.rows,input.params),best:input.params};
    self.postMessage({type:'result',result,coverage:prepared.coverage});
  }catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
