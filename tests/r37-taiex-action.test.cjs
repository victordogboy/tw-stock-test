const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../public/taiex-action.js');
function bars(){return Array.from({length:180},(_,i)=>{const c=20000+Math.sin(i/7)*300+i;return {date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),contract:'202612',open:c-10,close:c,high:c+35,low:c-35,volume:10000+i*3};});}
const permissive={delta:0,minEntry:0,exit:45,maxAge:0,cost:2};
test('scores are causal, bounded, warmed up, direction-specific; display SAR toggle has no effect',()=>{
 const r=bars(),s=A.analyze(r);assert(s.slice(0,60).every(x=>x===null));
 assert.deepEqual(A.analyze(r.slice(0,120)),s.slice(0,120));assert.deepEqual(A.analyze(r,{}, {enabled:false}),s);
 assert(s.filter(Boolean).every(x=>x.entry>=0&&x.entry<=100&&x.hold>=0&&x.hold<=100));
 assert.notDeepEqual(A.analyze(r,{direction:'short'}),s);
 const normalized=A.analyze(r,{entryWeights:[60,60,50,30]});assert.deepEqual(normalized,s);
});
test('entry requires all gates, blocks simultaneous exit; SAR initial direction is not a reversal',()=>{
 const r=bars(),s=A.analyze(r,permissive);assert(s.some(x=>x?.enter));
 for(const x of s.filter(Boolean))if(x.enter){assert(x.hold>=45);assert(x.delta>=0);assert(x.aligned);assert(!x.leave);}
 assert(A.analyze(r,{...permissive,exit:100}).every(x=>!x?.enter));
 const monotonic=r.map((b,i)=>({...b,open:20000+i*10,close:20005+i*10,high:20020+i*10,low:19990+i*10}));
 assert(A.analyze(monotonic,{delta:0,minEntry:0,maxAge:5}).every(x=>!x?.enter));
});
test('backtest executes next open, matches direction/cost, exits on following open and reports marked equity drawdown',()=>{
 for(const direction of ['long','short']){
 const r=bars(),cfg={...permissive,direction},s=A.analyze(r,cfg),out=A.backtest(r,cfg);assert(out.trades.length>0);
 let net=0;
 for(const t of out.trades){const entry=r.findIndex(b=>b.date===t.entryDate),exit=r.findIndex(b=>b.date===t.exitDate);assert.equal(t.signalDate,r[entry-1].date);assert(s[entry-1].enter);assert.equal(t.entry,r[entry].open);if(t.reason!=='區間結束平倉'){assert(s[exit-1].leave);assert.equal(t.exit,r[exit].open);}else assert.equal(t.exit,r.at(-1).close);assert.equal(t.net,(direction==='long'?1:-1)*(t.exit-t.entry)-cfg.cost);net+=t.net;}
 assert.equal(out.net,net);assert(out.maxDrawdown>=0);
 const free=A.backtest(r,{...cfg,cost:0});assert.equal(free.net-out.net,2*out.trades.length);
 }
});
test('mixed contracts and malformed parameters fail; no-signal metrics do not fabricate a win rate',()=>{
 const r=bars();r[80]={...r[80],contract:'202701'};assert.throws(()=>A.backtest(r),/單一月份/);
 for(const p of [{entryWeights:[0,0,0,0]},{holdWeights:[-1,2,3,4]},{delta:''},{maxAge:1.5},{cost:-1}])assert.throws(()=>A.validate(p));
 const out=A.backtest(bars(),{delta:100});assert.equal(out.trades.length,0);assert.equal(out.winRate,null);assert.equal(out.profitFactor,null);assert.equal(out.net,0);
});
test('page wires local settings, fixed-contract backtest, audit independence and stale-result clearing without API calls',async()=>{
 const {page}=require('./helpers/detail-page.cjs'),p=page('futures.html');await new Promise(r=>setImmediate(r));
 let calls=0;const data=bars().map(b=>({...b,futures_id:'TX',contract_date:b.contract,trading_session:'position',max:b.high,min:b.low,open_interest:1000}));
 p.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,data,source:'fixture'}));};
 const fire=(id,event='click')=>p.events.find(e=>e[0]===id&&e[1]===event)[2]();
 p.nodes.get('txSession').value='position';p.nodes.get('txYears').value='1';await fire('txLoad');assert.equal(p.nodes.get('actRun').disabled,false);assert.match(p.nodes.get('actScores').textContent,/進場 Action/);
 p.nodes.get('txContract').value='202612';fire('txContract','change');assert.equal(p.nodes.get('actRun').disabled,false);
 for(const [id,v]of [['actDelta','0'],['actMinimum','0'],['actAge','0']])p.nodes.get(id).value=v;
 fire('actApply');fire('actRun');assert.match(p.nodes.get('actResult').textContent,/淨損益/);assert(p.nodes.get('actTrades').children.length>0);
 p.nodes.get('txAudit').value='120';fire('txAudit','input');assert.match(p.nodes.get('actResult').textContent,/淨損益/);fire('actRun');for(const tr of p.nodes.get('actTrades').children)assert(tr.children[4].textContent<=data.at(-1).date);
 p.nodes.get('actDelta').value='50';fire('actDelta','input');fire('txLatest');assert.equal(p.nodes.get('actRun').disabled,true);fire('actApply');assert.equal(JSON.parse(p.storage.get('twq_taiex_action_r37')).delta,50);
 p.nodes.get('actCost').value='-1';fire('actApply');assert.match(p.nodes.get('actError').textContent,/沿用/);
 p.nodes.get('txSession').value='after_market';fire('txSession','change');assert.equal(p.nodes.get('actSignal').textContent,'');assert.equal(calls,1);
});
