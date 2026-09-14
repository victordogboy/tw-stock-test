const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('equal worker selects and reports the same cash model',async()=>{
 const snapshots=[],chips={};const dates=[];
 for(let i=0;dates.length<280;i++){const d=new Date(Date.UTC(2024,0,1)+i*86400000);if(d.getUTCDay()%6)dates.push(d.toISOString().slice(0,10));}
 for(let i=0;i<dates.length;i++){
  const date=dates[i];snapshots.push({ok:true,date,market:'twse',rows:Array.from({length:100},(_,j)=>{const p=100+i*.08+Math.sin(i*.19+j)*3;return {date,market:'twse',code:String(1000+j),volume:100000+i*20+j,open:p,high:p+2,low:p-2,close:p+.5};})});
  for(let j=0;j<3;j++){
   const id='twse:'+String(1000+j);chips[id]||={margin:[],inst:[],daytrade:[]};
   chips[id].margin.push({date,MarginPurchaseTodayBalance:1000,MarginPurchaseYesterdayBalance:1000});
   chips[id].inst.push({date,Foreign_Investor_buy:100,Foreign_Investor_sell:80});chips[id].daytrade.push({date,Volume:100});
  }
 }
 const messages=[],ctx=vm.createContext({console:{warn(){}},setTimeout,clearTimeout});ctx.self=ctx;ctx.postMessage=m=>messages.push(m);ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync('public'+f.split('?')[0],'utf8'),ctx));
 vm.runInContext(fs.readFileSync('public/research-r19-worker.js','utf8'),ctx);
 await ctx.onmessage({data:{snapshots,chips,options:{goal:'equal',universe:'fixed',fixedStocks:Array.from({length:100},(_,i)=>'twse:'+String(1000+i)),manual:{entry:[1,0,0,0,0,0,0,0],exit:[1,0,0,0,0,0,0,0],entryThreshold:0,exitThreshold:0,maxHold:1},start:dates[90],end:dates.at(-1),markets:['twse'],cost:{fee:.001425,tax:.003,slippage:.0005},chipLag:1,candidates:32,seed:123,minTrades:20}}});
 const error=messages.find(m=>m.type==='error');assert.equal(error,undefined,error?.stack);
 const r=messages.find(m=>m.type==='done')?.report;assert.ok(r);assert.equal(r.correlations.length,32);assert.equal(r.controls.length,8);assert.equal(r.coverage.selectedStocks,100);assert.ok(r.coverage.scoredObservations>0);assert.ok(r.coverage.scoredObservations<r.coverage.selectedObservations);assert.ok(r.observations.every(x=>x.date>=dates[90]));
 if(r.chosen)assert.ok(r.chosen.trades.every(t=>t.signalDate>=r.splits.test[0]&&t.exitDate<=r.splits.test[1]));
 assert.ok(r.chosen);assert.ok(Math.abs(r.chosen.test.equalReturn-r.portfolio.roi)<1e-9);assert.equal(r.portfolio.stockResults.length,100);assert.equal(r.portfolio.model,'equal-stock-fractional-r20');
});
