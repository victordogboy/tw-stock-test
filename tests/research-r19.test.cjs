const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const C=require('../public/research-r19-core.js');
const iso=i=>new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
const cost={fee:.001425,tax:.003,slippage:.0005};
function fixture(n=120,stocks=102){
 const snapshots=Array.from({length:n},(_,i)=>({ok:true,date:iso(i),market:'twse',closed:false,rows:Array.from({length:stocks},(_,j)=>({date:iso(i),market:'twse',code:String(1000+j),name:'fixture',volume:100000+j+(i%2===0&&j===0?10000:0),open:100+i*.1,high:102+i*.1,low:98+i*.1,close:101+i*.1}))}));
 return {snapshots,data:C.prepare(snapshots,['twse'])};
}
function signals(data,id='twse:1000'){
 return data.dates.map((date,di)=>({date,di,code:id.split(':')[1],market:'twse',rank:di===0?1:null,setup:80,opportunity:80,entry:90,hold:20,dSetup:1,dOpportunity:1,dEntry:1,dHold:-1}));
}
const p={id:0,entry:[0,0,1,0,0,0,0,0],exit:[0,0,0,-1,0,0,0,0],entryThreshold:70,exitThreshold:60,maxHold:5};
test('each historical day ranks independently, by shares with deterministic ties',()=>{
 const {data}=fixture(3);assert.equal(data.ranks.get(iso(0)).get('twse:1000'),1);assert.equal(data.ranks.get(iso(1)).has('twse:1000'),false);assert.equal(data.ranks.get(iso(0)).size,100);
 const tie=[{market:'twse',code:'1001',volume:10},{market:'twse',code:'1000',volume:10}];assert.equal(C.ranked(tie,1)[0].code,'1000');
 const old=JSON.stringify([...data.ranks.get(iso(0))]);data.daily.get(iso(2)).get('twse:1000').volume=1e20;assert.equal(JSON.stringify([...data.ranks.get(iso(0))]),old);
});
test('missing one market and malformed volume fail instead of partial ranks',()=>{
 const {snapshots}=fixture(2);assert.throws(()=>C.prepare(snapshots),/missing market/);snapshots[0].rows[0].volume=null;assert.throws(()=>C.prepare(snapshots,['twse']),/volume/);
});
test('signal close cannot be bought; entry and exit execute next session with exact costs',()=>{
 const {data}=fixture();const result=C.simulate(data,signals(data),p,[iso(0),iso(119)],cost);const t=result.trades[0];assert.equal(result.n,1);assert.equal(t.signalDate,iso(0));assert.equal(t.entryDate,iso(1));assert.equal(t.exitSignalDate,iso(1));assert.equal(t.exitDate,iso(2));
 assert.ok(Math.abs(t.net-((100.2*(1-cost.slippage)*(1-cost.fee-cost.tax)/(100.1*(1+cost.slippage)*(1+cost.fee))-1)*100))<1e-10);
 assert.equal(t.holdingDays,1);assert.equal(signals(data)[1].rank,null); // exit works outside top 100
});
test('unfillable next-day entry is cancelled, never silently delayed or bought at signal close',()=>{
 const {data}=fixture();data.daily.get(iso(1)).get('twse:1000').volume=0;const r=C.simulate(data,signals(data),p,[iso(0),iso(119)],cost);assert.equal(r.n,0);assert.equal(r.unfilled,1);
});
test('locked exit waits for an executable opening and unresolved positions disqualify a candidate',()=>{
 const {data}=fixture();const bar=data.daily.get(iso(2)).get('twse:1000');bar.high=bar.low=bar.open=bar.close;
 const r=C.simulate(data,signals(data),p,[iso(0),iso(119)],cost);assert.equal(r.trades[0].exitDate,iso(3));assert.equal(r.unfilled,1);
 for(let i=2;i<120;i++)data.daily.get(iso(i)).delete('twse:1000');const u=C.simulate(data,signals(data),p,[iso(0),iso(119)],cost);assert.equal(u.unresolved,1);assert.equal(C.select([{p,result:u}],0).length,0);
});
test('no duplicate overlapping positions and maxHold also runs when scores are missing',()=>{
 const {data}=fixture();const rows=signals(data).map(r=>({...r,rank:1,hold:100}));const r=C.simulate(data,rows,{...p,exitThreshold:99,maxHold:3},[iso(0),iso(119)],cost);
 for(let i=1;i<r.trades.length;i++)assert.ok(r.trades[i].entryDate>r.trades[i-1].exitDate);assert.equal(r.trades[0].holdingDays,3);
 const partial=C.simulate(data,[rows[0]],{...p,exitThreshold:99,maxHold:3},[iso(0),iso(119)],cost);assert.equal(partial.trades[0].holdingDays,3);
});
test('labels are next-open to future-open, never signal-close returns',()=>{
 const {data}=fixture();const r=signals(data)[0],label=C.labels(data,r,cost);assert.equal(label.net1,C.netReturn(100.1,100.2,cost));assert.equal(label.end10,iso(11));
});
test('26-session entry purge keeps all completed trades in their split, labels never cross',()=>{
 const {data}=fixture(300);const ranges=C.split(data.dates,iso(0));const rows=signals(data).map(r=>({...r,rank:1,hold:100,...C.labels(data,r,cost)}));
 for(const range of Object.values(ranges)){const r=C.simulate(data,rows,{...p,maxHold:20,exitThreshold:99},range,cost);assert.equal(r.unresolved,0);for(const t of r.trades){assert.ok(t.entryDate>range[0]);assert.ok(t.exitDate<=range[1]);assert.ok(t.signalDate<=r.entrySignalEnd);}for(const r of C.eligible(rows,range))assert.ok(r.end10<=range[1]);}
});
test('training results and shortlist do not change when future validation/test prices change',()=>{
 const {data}=fixture(300);const ranges=C.split(data.dates,iso(0)),rows=signals(data).map(r=>({...r,rank:1})),pool=C.candidates(32,123);
 const before=pool.map(p=>({p,result:C.simulate(data,rows,p,ranges.train,cost)}));
 for(const [date,market] of data.daily)if(date>ranges.train[1])for(const r of market.values()){r.open*=10;r.high*=10;r.low*=10;r.close*=10;}
 const after=pool.map(p=>({p,result:C.simulate(data,rows,p,ranges.train,cost)}));assert.deepEqual(before,after);assert.deepEqual(C.select(before,1),C.select(after,1));assert.deepEqual(pool,C.candidates(32,123));
});
test('score replay uses only left-side bars, lagged chips, true prior-session deltas and start boundary',()=>{
 const {data}=fixture(110),chips={margin:[],inst:[],daytrade:[]};for(let i=0;i<110;i++)for(const k of Object.keys(chips))chips[k].push({date:iso(i),MarginPurchaseTodayBalance:100});
 const scorer=(hist,cc)=>{assert.ok(cc.margin.at(-1).date<hist.at(-1).date);return {setup:hist.length%100,opportunity:50,entry:70,hold:80};};
 const a=C.replayStock(data,'twse:1000',chips,scorer,{start:iso(95),chipLag:1});assert.equal(a.rows[0].date,iso(95));assert.equal(a.rows[0].dSetup,1);
 chips.margin[98].MarginPurchaseTodayBalance=null;const b=C.replayStock(data,'twse:1000',chips,scorer,{start:iso(95),chipLag:1});assert.equal(b.rows.find(r=>r.date===iso(99)),undefined);assert.equal(b.rows.find(r=>r.date===iso(100)).dSetup,null);
});
test('actual r18 engine scores are invariant to appending future data',()=>{
 const context=vm.createContext({console:{warn(){}},window:{},document:{getElementById(){return null;}}});vm.runInContext(fs.readFileSync('public/v44-engine.js','utf8'),context);
 const {data}=fixture(110),chips={margin:[],inst:[],daytrade:[]};for(let i=0;i<110;i++)for(const k of Object.keys(chips))chips[k].push({date:iso(i),MarginPurchaseTodayBalance:0});
 const score=(hist,cc)=>{const R=context.combineScores(hist,cc.margin,cc.inst,cc.daytrade),E=context.entryEngine(hist,R);return {setup:R.quality,opportunity:E.opportunity,entry:E.score,hold:E.hold};};
 const a=C.replayStock(data,'twse:1000',chips,score,{start:iso(95),chipLag:1});assert.ok(a.rows.length>0);
 for(const r of data.series.get('twse:1000'))if(r.date>iso(100))r.close*=2;
 const b=C.replayStock(data,'twse:1000',chips,score,{start:iso(95),chipLag:1});assert.deepEqual(a.rows.filter(r=>r.date<=iso(100)),b.rows.filter(r=>r.date<=iso(100)));
});
test('controlled regression fits only training data; held-out targets never change beta',()=>{
 const row=i=>({retToday:Math.sin(i),ret5past:Math.cos(i),logVR:i%7,bias20:i%11,setup:i%100,opportunity:i%80,entry:i%60,hold:i%50,dSetup:i%8,dOpportunity:i%6,dEntry:i%4,dHold:i%3,net5:Math.sin(i)*2+i%5});
 const train=Array.from({length:150},(_,i)=>row(i)),test=Array.from({length:80},(_,i)=>row(i+150));const a=C.controlled(train,test),b=C.controlled(train,test.map(r=>({...r,net5:r.net5+100})));
 assert.deepEqual(a.map(r=>r.beta),b.map(r=>r.beta));assert.notEqual(a[0].mseGain,b[0].mseGain);
});
test('flat feature has no correlation or fabricated quintile spread',()=>{
 const rows=Array.from({length:30},(_,i)=>({date:iso(0),rank:i+1,setup:50,net5:i}));const r=C.correlation(rows,'setup');assert.equal(r.ic,null);assert.equal(r.spread,null);
});
