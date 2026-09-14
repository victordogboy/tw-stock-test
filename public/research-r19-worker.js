importScripts('/v44-engine.js?r19','/research-r19-core.js?r20','/research-r199-portfolio.js?r20');
self.onmessage=async ({data:input})=>{
  try{
    const C=ResearchR19,{snapshots,chips,options}=input;
    const data=C.prepare(snapshots,options.markets,options),splits=C.split(data.dates,options.start);
    const union=new Set();for(const date of data.dates)if(date>=options.start)for(const id of data.ranks.get(date).keys())union.add(id);
    const rows=[],coverage={selectedStocks:union.size,warmup:0,missingChips:0,invalidScore:0,selectedObservations:0,scoredObservations:0};
    const scorer=options.scoreMode==='price'?C.priceScore:(h,cc)=>{const R=combineScores(h,cc.margin,cc.inst,cc.daytrade),E=entryEngine(h,R);return {setup:R.quality,opportunity:E.opportunity,entry:E.score,hold:E.hold};};
    let done=0;
    for(const id of union){
      const r=C.replayStock(data,id,chips[id]||{},scorer,options);
      for(const [k,v] of Object.entries(r.stats))coverage[k]+=v;
      for(const row of r.rows)rows.push({...row,...C.labels(data,row,options.cost)});
      self.postMessage({type:'progress',text:`重播 ${++done}/${union.size} 檔；${rows.length} 筆分數`,value:done/union.size*.55});
    }
    for(const date of data.dates)if(date>=options.start)coverage.selectedObservations+=data.ranks.get(date).size;
    coverage.scoredObservations=rows.filter(r=>r.rank).length;
    const equal=options.goal==='equal';
    if(equal){
      if(options.universe!=='fixed')throw Error('等額研究請選固定股票池');
      options.portfolio={mode:'equal',perStock:100000,ids:options.fixedStocks};
    }
    const evaluate=(p,range)=>{
      const result=C.simulate(data,rows,p,range,options.cost);
      if(equal){
        const a=ResearchPortfolio.run(C,data,rows,p,range,options.cost,options.portfolio);
        result.equalReturn=a.roi;result.equalDrawdown=a.maxDrawdown;
        result.objective=a.roi;result.unresolved=Math.max(result.unresolved,a.unresolved);
      }
      return result;
    };
    const train=C.eligible(rows,splits.train),validation=C.eligible(rows,splits.validation),test=C.eligible(rows,splits.test);
    const correlations=[];
    for(const [i,f] of C.FEATURES.entries()){
      self.postMessage({type:'progress',text:`計算分數相關性 ${i+1}/8：${f}`,value:.55+.1*i/8});
      for(const h of [1,3,5,10])correlations.push({feature:f,h,train:C.correlation(train,f,h),validation:C.correlation(validation,f,h),test:C.correlation(test,f,h)});
    }
    const controls=C.controlled(train,test,(f,i)=>self.postMessage({type:'progress',text:`控制價格後的回歸 ${i+1}/8：${f}`,value:.65+.1*i/8})),pool=options.manual?[C.manualParameters(options.manual)]:C.candidates(options.candidates,options.seed,options.searchLiquidity!==false),results=[];
    for(let i=0;i<pool.length;i++){
      results.push({p:pool[i],result:evaluate(pool[i],splits.train)});
      if(i%8===0)self.postMessage({type:'progress',text:`訓練集搜尋 ${i+1}/${pool.length} 組`,value:.75+.2*i/pool.length});
    }
    self.postMessage({type:'progress',text:'驗證集挑選參數與最終測試',value:.95});
    const ranked=C.select(options.searchLiquidity!==false&&!options.manual?results.filter(x=>x.p.id!==0):results,options.minTrades,options.goal);
    const shortlist=options.manual?results:(options.goal==='winrate'||equal)?ranked:ranked.slice(0,8);
    const validationResults=shortlist.map(x=>({p:x.p,train:x.result,result:evaluate(x.p,splits.validation)}));
    const selected=options.manual?validationResults[0]:C.select(validationResults,Math.max(10,Math.ceil(options.minTrades/2)),options.goal)[0];
    const strip=r=>r?(({trades,...rest})=>rest)(r):null;
    let chosen=null;
    if(selected){
      const result=evaluate(selected.p,splits.test);
      self.postMessage({type:'progress',text:'估計測試期報酬區間',value:.98});
      chosen={parameters:selected.p,train:strip(selected.train),validation:strip(selected.result),test:strip(result),ci:result.unresolved?null:C.bootstrapCI(result.trades,options.seed),trades:result.trades};
    }
    self.postMessage({type:'progress',text:'模擬資金配置與每日帳戶淨值',value:.99});
    const portfolio=chosen?ResearchPortfolio.run(C,data,rows,chosen.parameters,splits.test,options.cost,options.portfolio):null;
    const benchmarkBaseDate=data.dates[data.dates.indexOf(splits.test[0])-1];
    const benchmark=ResearchPortfolio.benchmark(portfolio,input.benchmark?.data,benchmarkBaseDate);if(input.benchmark?.error)benchmark.error=input.benchmark.error;if(input.benchmark?.source)benchmark.source=input.benchmark.source;
    const withoutLiquidity=chosen?C.simulate(data,rows,{...chosen.parameters,minVolumeLots:0,minAvgVolumeLots20:0,minAvgValue20:0},splits.test,options.cost):null;
    const baseline=C.simulate(data,rows,C.candidates(1,options.seed)[0],splits.test,options.cost);
    const report={version:C.VERSION,patch:'20.0',base:'ad5d249cbcc0534741574b03442ac1134e8901c8',options,splits,coverage,provenance:{engine:options.scoreMode==='price'?'R19.2 price-only hypotheses (not V4.4)':'r18 V4.4 unchanged',priceType:'raw OHLC',chipTiming:'prior exchange session; historical revisions not controlled',snapshots:snapshots.map(s=>({date:s.date,market:s.market,source:s.source||'import',market_mapping:s.market_mapping||'reported',cached_at:s.cached_at||null,rows:s.rows.length}))},correlations,controls,chosen,portfolio,benchmark,benchmarkBaseDate,withoutLiquidity:strip(withoutLiquidity),baseline:strip(baseline),candidates:validationResults.map(x=>({parameters:x.p,train:strip(x.train),validation:strip(x.result)})),observations:rows.filter(r=>r.rank)};
    self.postMessage({type:'done',report});
  }catch(e){self.postMessage({type:'error',error:e.message,stack:e.stack});}
};
