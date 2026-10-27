const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('all metric choices leave selected third and summary fourth in header and body',()=>{
 const html=fs.readFileSync('public/scanner.html','utf8');
 const keys=['setup','opportunity','entry','hold','holdDelta','holdVolumeDelta','buyAction','buyActionDelta','stayAction','stayActionDelta','stayDrawdown','samePrice'];
 const make=()=>({children:['code','name','summary',...keys].map(key=>({key,classList:{toggle(){}}})),querySelector(q){return this.children.find(x=>q==='[data-fixed-summary]'?x.key==='summary':q==='[data-metric="'+x.key+'"]')},querySelectorAll(){return this.children.filter(x=>keys.includes(x.key))},insertBefore(x,before){if(x===before)return;this.children.splice(this.children.indexOf(x),1);this.children.splice(before?this.children.indexOf(before):this.children.length,0,x)}});
 const table={rows:[make(),make()]},ctx=vm.createContext({$:id=>id==='rankTable'?table:null});
 vm.runInContext(html.slice(html.indexOf('function moveSelectedMetricFirst'),html.indexOf('function safeText')),ctx);
 for(const key of [...keys,...keys].reverse()){
  ctx.moveSelectedMetricFirst(key);
  for(const row of table.rows)assert.deepEqual(row.children.slice(0,4).map(x=>x.key),['code','name',key,'summary']);
 }
});
test('batch valuation uses row price, keeps quantity when unavailable and does not refetch on sorting',async()=>{
 let calls=0;const ctx=vm.createContext({Map,Date,Number,AbortSignal,document:{querySelectorAll:()=>[]},fetch:async()=>{calls++;return {ok:true,json:async()=>({ok:true,rows:[{code:'2330',models:{A:{status:'ok',eps:80}},latestRevenueMonth:'2026-09',financeQuarter:'2026Q2'}]})}}});
 vm.runInContext(fs.readFileSync('public/scan-summary.js','utf8'),ctx);
 const r={code:'2330',close:1980,liquidityVolume:3500000,liquidityBasis:'projected',liquidityDate:'2026-10-27'};
 await ctx.TWScanSummary.update([r]);await ctx.TWScanSummary.update([r]);assert.equal(calls,1);
 assert.match(ctx.TWScanSummary.cell(r),/24.75 倍/);assert.match(ctx.TWScanSummary.cell(r),/預估量 3,500 張/);
 assert.match(ctx.TWScanSummary.cell({...r,code:'9999',liquidityBasis:'actual'}),/缺估值資料/);
 assert.match(ctx.TWScanSummary.cell({...r,liquidityBasis:'actual'}),/實際量 3,500 張/);
});
