importScripts('/v44-engine.js?r19','/research-r19-core.js?r19');
self.onmessage=async ({data:input})=>{
  try{
    const C=ResearchR19,{snapshots,chips,options}=input;
    const data=C.prepare(snapshots,options.markets),splits=C.split(data.dates,options.start);
    const union=new Set();for(const date of data.dates)if(date>=options.start)for(const id of data.ranks.get(date).keys())union.add(id);
    const rows=[],coverage={selectedStocks:union.size,warmup:0,missingChips:0,invalidScore:0,selectedObservations:0,scoredObservations:0};
    const scorer=(h,cc)=>{const R=combineScores(h,cc.margin,cc.inst,cc.daytrade),E=entryEngine(h,R);return {setup:R.quality,opportunity:E.opportunity,entry:E.score,hold:E.hold};};
    let done=0;
    for(const id of union){
      const r=C.replayStock(data,id,chips[id]||{},scorer,options);
      for(const [k,v] of Object.entries(r.stats))coverage[k]+=v;
      for(const row of r.rows)rows.push({...row,...C.labels(data,row,options.cost)});
      self.postMessage({type:'progress',text:`重播 ${++done}/${union.size} 檔；${rows.length} 筆分數`,value:done/union.size*.55});
    }
    for(const date of data.dates)if(date>=options.start)coverage.selectedObservations+=data.ranks.get(date).size;
    coverage.scoredObservations=rows.filter(r=>r.rank).length;
    const train=C.eligible(rows,splits.train),validation=C.eligible(rows,splits.validation),test=C.eligible(rows,splits.test);
    const correlations=C.FEATURES.flatMap(f=>[1,3,5,10].map(h=>({feature:f,h,train:C.correlation(train,f,h),validation:C.correlation(validation,f,h),test:C.correlation(test,f,h)})));
    const controls=C.controlled(train,test),pool=C.candidates(options.candidates,options.seed),results=[];
    for(let i=0;i<pool.length;i++){
      results.push({p:pool[i],result:C.simulate(data,rows,pool[i],splits.train,options.cost)});
      if(i%8===0)self.postMessage({type:'progress',text:`訓練集搜尋 ${i+1}/${pool.length} 組`,value:.55+.35*i/pool.length});
    }
    const shortlist=C.select(results,options.minTrades).slice(0,8);
    const validationResults=shortlist.map(x=>({p:x.p,train:x.result,result:C.simulate(data,rows,x.p,splits.validation,options.cost)}));
    const selected=C.select(validationResults,Math.max(10,Math.ceil(options.minTrades/2)))[0];
    const strip=r=>r?(({trades,...rest})=>rest)(r):null;
    let chosen=null;
    if(selected){
      const result=C.simulate(data,rows,selected.p,splits.test,options.cost);
      chosen={parameters:selected.p,train:strip(selected.train),validation:strip(selected.result),test:strip(result),ci:result.unresolved?null:C.bootstrapCI(result.trades,options.seed),trades:result.trades};
    }
    const baseline=C.simulate(data,rows,pool[0],splits.test,options.cost);
    const report={version:C.VERSION,base:'ad5d249cbcc0534741574b03442ac1134e8901c8',options,splits,coverage,provenance:{engine:'r18 V4.4 unchanged',priceType:'raw OHLC',chipTiming:'prior exchange session; historical revisions not controlled',snapshots:snapshots.map(s=>({date:s.date,market:s.market,source:s.source||'import',cached_at:s.cached_at||null,rows:s.rows.length}))},correlations,controls,chosen,baseline:strip(baseline),candidates:validationResults.map(x=>({parameters:x.p,train:strip(x.train),validation:strip(x.result)})),observations:rows.filter(r=>r.rank)};
    self.postMessage({type:'done',report});
  }catch(e){self.postMessage({type:'error',error:e.message,stack:e.stack});}
};
