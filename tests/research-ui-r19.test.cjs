const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../public/research-r19-core.js');
class Element{constructor(value=''){this.value=value;this.textContent='';this.disabled=false;this.children=[];}append(x){this.children.push(x);}setAttribute(){}click(){}}
function harness(withManual=false){
 const ids=['end','start','check','build','run','restore','backup','market','candidates','seed','minTrades','fee','tax','slippage','status','progress','cache','export','summary','metrics','weights','correlations','controls','shortlist','stop'];
 if(withManual)ids.push('manualWeights','manualRun','loadBest','manualEntryThreshold','manualExitThreshold','manualMaxHold','simpleResult');
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()])),records=new Map();let calls=0;
 const db={transaction(){const tx={objectStore(){return {get(k){const q={};queueMicrotask(()=>{q.result=records.get(k);q.onsuccess?.();});return q;},put(v,k){records.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}}}};return tx;}};
 const context=vm.createContext({console,Date,JSON,Map,Set,Blob,URL,ResearchR19:C,AbortController,AbortSignal,setTimeout,clearTimeout,document:{getElementById:id=>elements[id],createElement:()=>{const e=new Element();Object.defineProperty(e,'id',{set(v){elements[v]=e;}});return e;}},indexedDB:{open(){const q={};queueMicrotask(()=>{q.result=db;q.onsuccess?.();});return q;}},localStorage:{getItem(){return '';}},confirm(){return true;},fetch(){calls++;throw Error('Unexpected upstream call');},Worker:class{postMessage(input){queueMicrotask(()=>this.onmessage({data:{type:'done',report:{chosen:null,options:input.options,splits:{train:['2024-07-01','2025-01-01'],validation:['2025-01-02','2025-03-01'],test:['2025-03-02','2025-07-01']},coverage:{scoredObservations:100,selectedObservations:100},correlations:[],controls:[],candidates:[],baseline:{n:0}}}}));}terminate(){}}});
 vm.runInContext(fs.readFileSync('public/research-r19-ui.js','utf8'),context);
 Object.entries({start:'2024-07-01',end:'2025-07-01',market:'twse',seed:'123',minTrades:'20',candidates:'64',fee:'0.1425',tax:'0.3',slippage:'0.05'}).forEach(([id,v])=>elements[id].value=v);
 return {context,elements,records,get calls(){return calls;}};
}
test('cache-only UI flow completes and renders with zero network calls',async()=>{
 const h=harness(),o=vm.runInContext('options()',h.context),items=vm.runInContext('expected(options())',h.context);
 for(const {date,market} of items)h.records.set('market:'+market+':'+date,{ok:true,date,market,rows:Array.from({length:100},(_,i)=>({date,market,code:String(1000+i),volume:1000+i,open:100,high:101,low:99,close:100}))});
 for(let i=0;i<100;i++)h.records.set('chips:twse:'+String(1000+i),{coverage_start:o.warmupStart,coverage_end:o.end,completeness:100,chips:{margin:[],inst:[],daytrade:[]}});
 await vm.runInContext("gather('local')",h.context);assert.equal(h.calls,0);assert.match(h.elements.status.textContent,/研究完成/);assert.equal(h.elements.run.disabled,false);assert.equal(h.elements.export.disabled,false);assert.ok(h.records.has('last-report'));
});
test('missing local snapshots stops without fetching and unlocks UI',async()=>{
 const h=harness();await vm.runInContext("gather('local')",h.context);assert.equal(h.calls,0);assert.match(h.elements.status.textContent,/本機資料不足/);assert.equal(h.elements.run.disabled,false);assert.equal(h.records.has('last-report'),false);
});
test('fixed pure-price cached UI does not fetch market snapshots or FinMind chips',async()=>{
 const h=harness();for(const [id,value] of Object.entries({universe:'fixed',scoreMode:'price',fixedStocks:'twse:2330',poolDate:'2025-07-01'}))h.elements[id]=new Element(value);
 const o=vm.runInContext('options()',h.context),data=[];
 for(let d=o.warmupStart;d<=o.end;d=new Date(Date.parse(d)+86400000).toISOString().slice(0,10))if(new Date(d).getUTCDay()%6)data.push({date:d,open:100,close:101,high:102,low:99,volume:10000});
 for(const id of ['twse:0050','twse:2330'])h.records.set(`price192:${id}:${o.warmupStart}:${o.end}`,{data});
 await vm.runInContext("gather('local')",h.context);assert.equal(h.calls,0);assert.match(h.elements.status.textContent,/研究完成/);assert.equal(h.elements.export.disabled,false);
});
function partialHarness(scoreMode='full'){
 const h=harness();for(const [id,value] of Object.entries({universe:'fixed',scoreMode,fixedStocks:'twse:2330 twse:2317',poolDate:'2025-07-01'}))h.elements[id]=new Element(value);
 const o=vm.runInContext('options()',h.context),data=[];
 for(let d=o.warmupStart;d<=o.end;d=new Date(Date.parse(d)+86400000).toISOString().slice(0,10))if(new Date(d).getUTCDay()%6)data.push({date:d,open:100,close:101,high:102,low:99,volume:10000});
 for(const id of ['twse:0050','twse:2330'])h.records.set(`price192:${id}:${o.warmupStart}:${o.end}`,{data});return {h,o,data};
}
test('partial run preserves intended universe, lists missing prices, and explicitly falls back to price without chips',async()=>{
 const {h}=partialHarness();await vm.runInContext("gather('partial')",h.context);assert.equal(h.calls,0);const r=h.records.get('last-report');assert.ok(r);assert.equal(r.options.fixedStocks.length,2);assert.equal(r.options.partialInfo.availablePriceStocks,1);assert.deepEqual([...r.options.partialInfo.missingPrice],['twse:2317']);assert.equal(r.options.scoreMode,'price');assert.equal(r.options.partialInfo.requestedScoreMode,'full');assert.match(h.elements.summary.textContent,/不是原版/);
});
test('build source failure automatically calculates locally without further provider calls',async()=>{
 const {h}=partialHarness();await vm.runInContext("gather('build')",h.context);assert.equal(h.calls,1);const r=h.records.get('last-report');assert.ok(r);assert.equal(r.options.partial,true);assert.match(r.options.downloadFailure,/Unexpected upstream/);assert.equal(h.elements.run.disabled,false);
});
test('partial original scores retain only available full-chip inputs and never silently switch when any are available',async()=>{
 const {h,o}=partialHarness();h.records.set('chips:twse:2330',{coverage_start:o.warmupStart,coverage_end:o.end,completeness:100,chips:{margin:[],inst:[],daytrade:[]}});
 await vm.runInContext("gather('partial')",h.context);assert.equal(h.calls,0);const r=h.records.get('last-report');assert.equal(r.options.scoreMode,'full');assert.equal(r.options.partialInfo.availableChipStocks,1);assert.equal(r.options.partialInfo.fallback,undefined);
});
test('partial data without calendar stops rather than inventing trading sessions',async()=>{
 const {h,o}=partialHarness();h.records.delete(`price192:twse:0050:${o.warmupStart}:${o.end}`);await vm.runInContext("gather('partial')",h.context);assert.equal(h.calls,0);assert.equal(h.records.has('last-report'),false);assert.match(h.elements.status.textContent,/日曆代理/);
});
test('individual chip pieces are saved before later quota failure and reused on resume',async()=>{
 const {h,o}=partialHarness();let calls=[];
 h.context.fetch=async(path,opts)=>{calls.push([path,opts.method]);const u=new URL(path,'https://test'),kind=u.searchParams.get('kind');if(opts.method==='GET')return new Response(JSON.stringify({ok:false}),{status:404});if(kind==='inst')return new Response(JSON.stringify({ok:false,error:'quota',reason:'quota'}),{status:429});return new Response(JSON.stringify({ok:true,kind,data:[{date:'2025-06-01',MarginPurchaseTodayBalance:10}]}));};
 h.context.Response=Response;
 const data=C.prepare([{ok:true,date:'2025-06-01',market:'twse',rows:[]}],['twse'],{universe:'fixed',fixedStocks:['twse:2330']});data.series.set('twse:2330',[{date:'2025-06-01'}]);h.context.fixtureData=data;h.context.fixtureOptions=o;
 await assert.rejects(vm.runInContext("chipState(fixtureData,fixtureOptions,'build')",h.context),/配額/);
 const key=`piece196:twse:2330:margin:${o.warmupStart}:${o.end}`;assert.ok(h.records.has(key));assert.equal(calls.filter(x=>x[0].includes('daytrade')).length,0);
 calls=[];await assert.rejects(vm.runInContext("chipState(fixtureData,fixtureOptions,'build')",h.context));assert.equal(calls.filter(x=>x[0].includes('kind=margin')).length,0);
});

test('manual form passes changed thresholds and weights using previous report data, with zero API calls',async()=>{
 const h=harness(true);for(const [id,value] of Object.entries({universe:'fixed',scoreMode:'price',fixedStocks:'twse:2330',poolDate:'2025-07-01'}))h.elements[id]=new Element(value);
 const o=vm.runInContext('options()',h.context),data=[];for(let d=o.warmupStart;d<=o.end;d=new Date(Date.parse(d)+86400000).toISOString().slice(0,10))if(new Date(d).getUTCDay()%6)data.push({date:d,open:100,close:101,high:102,low:99,volume:1000});
 for(const id of ['twse:0050','twse:2330'])h.records.set(`price192:${id}:${o.warmupStart}:${o.end}`,{data});
 h.context.previousOptions=o;vm.runInContext("report={options:previousOptions};fillManual({entry:[.2,.3,.5,0,0,0,0,0],exit:[0,0,0,-1,0,0,0,0],entryThreshold:61,exitThreshold:64,maxHold:12})",h.context);
 h.elements.manualEntryThreshold.value='58';h.elements.manualExitThreshold.value='66';h.elements.manualMaxHold.value='8';h.elements.start.value='2025-01-01';
 await vm.runInContext("gather('manual')",h.context);assert.equal(h.calls,0);const r=h.records.get('last-report');assert.ok(r);assert.equal(r.options.manual.entryThreshold,58);assert.equal(r.options.manual.exitThreshold,66);assert.equal(r.options.manual.maxHold,8);assert.equal(r.options.start,o.start);assert.equal(r.options.exploratoryRetest,true);
});
test('one invalid stock price no longer prevents cached-price stocks from downloading chips',async()=>{
 const {h}=partialHarness('full'),calls=[];
 h.context.fetch=async(path,opts)=>{
  calls.push(path);if(opts.method==='GET')return new Response(JSON.stringify({ok:false}),{status:404});
  if(path.includes('stock-history'))return new Response(JSON.stringify({ok:false,error:'2024-01-02 個股 OHLC／成交量驗證失敗'}),{status:502});
  const kind=new URL(path,'https://test').searchParams.get('kind');return new Response(JSON.stringify({ok:true,kind,data:[{date:'2025-06-01',MarginPurchaseTodayBalance:10}]}));
 };
 await vm.runInContext("gather('build')",h.context);const r=h.records.get('last-report');assert.ok(r);assert.equal(r.options.scoreMode,'full');assert.equal(r.options.partialInfo.availableChipStocks,1);assert.equal(r.options.partialInfo.missingPrice[0],'twse:2317');assert.match(r.options.priceDiagnostics[0].error,/驗證失敗/);assert.ok(calls.some(p=>p.includes('chip-piece')&&p.includes('code=2330')));assert.ok(!calls.some(p=>p.includes('chip-piece')&&p.includes('code=2317')));
});
test('account report renderer displays monetary results separately from signal percentages',()=>{
 const h=harness();for(const id of ['portfolioSummary','accountROI','accountProfit','accountDD','accountWin','accountPayoff','accountTrades','equityChart','monthly','accountTradesTable'])h.elements[id]=new Element();
 h.context.accountFixture={options:{scoreMode:'price',partial:true},portfolio:{roi:10,netProfit:100,maxDrawdown:5,win:50,payoffRatio:2,n:2,range:['2024-01-01','2024-01-31'],initial:1000,finalEquity:1100,maxInvested:1000,wins:1,losses:1,breakeven:0,maxDrawdownMoney:50,skippedSlots:1,skippedFunds:0,unresolved:0,staleMarks:0,curve:[{roi:0},{roi:10}],monthly:[{month:'2024-01',returnPct:10,pnl:100,endEquity:1100}],trades:[]}};
 vm.runInContext('renderPortfolio(accountFixture)',h.context);assert.equal(h.elements.accountROI.textContent,'10.00%');assert.equal(h.elements.accountProfit.textContent,'NT$ 100');assert.equal(h.elements.accountDD.textContent,'-5.00%');assert.match(h.elements.portfolioSummary.textContent,/純價量/);assert.match(h.elements.equityChart.innerHTML,/polyline/);assert.equal(h.calls,0);
});
