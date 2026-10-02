const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const storage=new Map(),ctx=vm.createContext({localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
vm.runInContext(fs.readFileSync('public/dual-action.js','utf8'),ctx);const D=ctx.TWDualAction;
const scores=hold=>({setup:50,opportunity:60,entry:40,hold,holdVolumeRatio:1});
function fixture(){const rows=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2026,7,i+1)).toISOString().slice(0,10),open:100,high:101,low:99,close:100,volume:1000000}));const inst=rows.map(r=>({date:r.date,Foreign_Investor_buy:0,Foreign_Investor_sell:50000,Investment_Trust_buy:0,Investment_Trust_sell:0,Dealer_Hedging_buy:1e9,Dealer_Hedging_sell:0}));return {rows,inst}}
test('independent defaults, validation, legacy storage and full same-weight recalculation',()=>{
 storage.set('twq_action_weights_v1160r2','legacy');assert.ok(D.valid(D.read()));assert.equal(D.read().buy.hold,55);assert.equal(D.read().stay.hold,80);
 assert.equal(D.save({buy:{hold:100},stay:{hold:100}}),false);
 assert.equal(storage.get('twq_action_weights_v1160r2'),'legacy');
 const w={buy:{setup:0,opportunity:0,entry:0,hold:100},stay:{setup:0,opportunity:0,entry:0,hold:100}};
 const r={...scores(80),previousScores:scores(90),actionTrail:[95,94,93,92,90].map(h=>[50,60,40,h])};
 const m=D.metrics(r,w);assert.equal(m.buy,80);assert.equal(m.buyDelta,-10);assert.equal(m.stayDrop,15);
 w.stay={setup:100,opportunity:0,entry:0,hold:0};assert.equal(D.metrics(r,w).stayDrop,0);assert.equal(D.metrics(r,w).stayDelta,0);
 assert.equal(D.metrics({...r,actionTrail:[]},w).stayDrop,null);assert.equal(D.metrics({...r,holdNeedsRefresh:true},w).buy,null);
 assert.equal(D.score({hold:80},w.buy),80);assert.equal(D.metrics(r,null).buy,null);
});
test('exit delta ranks largest decline first, drawdown positive; original signs retained',()=>{
 const w={buy:{setup:0,opportunity:0,entry:0,hold:100},stay:{setup:0,opportunity:0,entry:0,hold:100}};
 const falling={...scores(60),previousScores:scores(90)},rising={...scores(90),previousScores:scores(80)};
 assert.ok(D.rank(falling,'stayActionDelta',w)>D.rank(rising,'stayActionDelta',w));assert.equal(D.metrics(falling,w).stayDelta,-30);
 assert.ok(D.rank(rising,'buyActionDelta',w)>D.rank(falling,'buyActionDelta',w));
});
test('five previous sessions exclude current, no future access and insufficient warmup remains missing',()=>{
 const {rows}=fixture();while(rows.length<75)rows.push({...rows.at(-1),close:rows.length});const seen=[];
 const trail=D.history(rows,a=>{seen.push(a.length);return scores(a.length)});
 assert.deepEqual(seen,[70,71,72,73,74]);assert.equal(trail.at(-1)[3],74);assert.equal(D.history(rows.slice(0,69),()=>{throw Error('not enough data')}).length,0);
});
test('institutional selling with flat price is observation only; hedging is excluded',()=>{
 const {rows,inst}=fixture(),a=D.absorption(rows,inst);assert.equal(a.state,'承接觀察');assert.equal(a.ratio,-5);assert.equal(a.net5,-250000);assert.equal(a.sellStreak,5);assert.equal(a.scored,false);
 const changed=inst.map(r=>({...r,Dealer_Hedging_sell:1e12}));assert.equal(D.absorption(rows,changed).ratio,-5);
});
test('breakout confirms, support break fails, repeated volume upper wicks warn',()=>{
 const f=fixture();f.rows.at(-1).close=102;f.rows.at(-1).high=102.5;assert.equal(D.absorption(f.rows,f.inst).state,'承接確認');
 f.rows.at(-1).low=98;assert.equal(D.absorption(f.rows,f.inst).state,'承接失敗');
 const g=fixture();for(const i of [31,33])Object.assign(g.rows[i],{volume:2000000,high:110});assert.equal(D.absorption(g.rows,g.inst).state,'賣壓警戒');
});
test('missing day/field/volume are not zeros, one-day sell cannot establish absorption',()=>{
 for(const kind of ['date','field','volume']){const {rows,inst}=fixture();if(kind==='date')inst.splice(-3,1);if(kind==='field')delete inst.at(-2).Investment_Trust_sell;if(kind==='volume')rows.at(-1).volume=0;assert.equal(D.absorption(rows,inst).state,'資料不足',kind)}
 const {rows,inst}=fixture();inst.slice(-5,-1).forEach(r=>r.Foreign_Investor_sell=0);assert.equal(D.absorption(rows,inst).state,'中性');
});
test('future chips never affect audit; intraday excludes same-day chips and reports source date',()=>{
 const {rows,inst}=fixture(),baseline=JSON.stringify(D.absorption(rows,inst));
 assert.equal(JSON.stringify(D.absorption(rows,[...inst,{...inst.at(-1),date:'2099-01-01',Foreign_Investor_buy:1e12}])),baseline);
 rows.at(-1).intradayProjected=true;inst.at(-1).Foreign_Investor_buy=1e12;
 const a=D.absorption(rows,inst);assert.equal(a.chipDate,rows.at(-2).date);assert.equal(a.lag,1);assert.equal(a.state,'承接觀察');
 rows.at(-1).low=98;assert.equal(D.absorption(rows,inst).state,'承接失敗');
 assert.equal(D.absorption(rows,inst.slice(0,-3)).state,'資料落後');
});
test('server validates both groups and uses frozen submitted weights for candidate selection',async()=>{
 const {validateOptions}=await import('../src/scan-job.mjs'),{createScanRuntime}=await import('../src/scan-runtime.mjs');
 const dualWeights={buy:{setup:0,opportunity:0,entry:0,hold:100},stay:{setup:0,opportunity:0,entry:0,hold:100}};
 assert.throws(()=>validateOptions({dualWeights:{...dualWeights,stay:{...dualWeights.stay,setup:10}}}));
 const rt=createScanRuntime({options:validateOptions({selection:'buyActionDelta',dualWeights})},()=>{});
 assert.equal(rt.selectCandidates([{code:'a',...scores(80),previousScores:scores(20)},{code:'b',...scores(95),previousScores:scores(90)}])[0].code,'a');
 assert.equal(rt.selectCandidates([{code:'a',dualSelectionValue:60},{code:'b',dualSelectionValue:5}])[0].code,'a');
});
