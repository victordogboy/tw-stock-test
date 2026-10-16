importScripts('/detail-score-r32.js?r32','/stock-backtest-core.js?r33','/parabolic-sar.js?r35.1','/sar-kd-study.js?r36');
let cacheKey='',prepared=null;
self.onmessage=({data:input})=>{
  try{
    const key=JSON.stringify(input.data);
    if(cacheKey!==key){
      self.postMessage({type:'progress',message:'重播歷史 Action 評分（只使用當日以前資料）…'});
      prepared=TWStockBacktest.prepare(input.data,TWDetailScore,p=>{
        if(p.done%100===0)self.postMessage({type:'progress',message:'重播歷史評分 '+p.done+'/'+p.total});
      });
      cacheKey=key;
    }
    const result=TWSarKdStudy.study(prepared,input.data.prices,input.params,input.sarParams,input.options);
    self.postMessage({type:'result',result,coverage:prepared.coverage});
  }catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
