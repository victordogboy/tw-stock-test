const test=require('node:test'),assert=require('node:assert/strict'),A=require('../public/taiex-action.js');
function bars(){return Array.from({length:220},(_,i)=>{const c=20000+Math.sin(i/7)*300+i;return {date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),contract:'202612',open:c-10,close:c,high:c+35,low:c-35,volume:10000+i*3};});}
const cfg={delta:0,minEntry:0,exit:45,maxAge:0,cost:2};
test('date range preserves pre-start warmup, starts flat, closes at end and ignores future bars',()=>{
 const rows=bars(),range={start:rows[80].date,end:rows[160].date},r=A.backtest(rows,cfg,{},range);
 assert.equal(r.start,range.start);assert.equal(r.end,range.end);assert.equal(r.validBars,81);assert(r.trades.length);
 for(const t of r.trades){assert(t.signalDate>=range.start);assert(t.entryDate>range.start);assert(t.exitDate<=range.end);}
 assert.deepEqual(r,A.backtest(rows.slice(0,161),cfg,{},range));
 assert.throws(()=>A.backtest(rows,cfg,{}, {start:'2026-03-01',end:'2026-02-30'}),/日期/);
 assert.throws(()=>A.backtest(rows,cfg,{}, {start:'2026-04-01',end:'2026-03-01'}),/日期/);
 assert.throws(()=>A.backtest(rows,cfg,{}, {start:'2027-01-01',end:'2027-02-01'}),/沒有/);
 const single=A.backtest(rows,cfg,{}, {start:rows[90].date,end:rows[90].date});assert.equal(single.trades.length,0);
});
test('optimizer returns exact grid maximum, filters minimum trades and matches independent backtests',()=>{
 const rows=bars(),range={start:rows[70].date,end:rows[210].date};let last;
 for(const p of A.optimize(rows,cfg,{},range,2))last=p;
 const brute=A.candidateGrid(cfg).map(config=>({config,result:A.backtest(rows,config,{},range)})).filter(x=>x.result.trades.length>=2).sort(A.compare);
 assert(last.total<=2025);assert.equal(last.done,last.total);assert.equal(last.eligible,brute.length);assert.deepEqual(last.top,brute.slice(0,5));
 assert(last.top.every(x=>x.config.cost===2&&x.config.direction==='long'));
 let none;for(const p of A.optimize(rows,cfg,{},range,1000))none=p;assert.equal(none.top.length,0);
 assert.throws(()=>[...A.optimize(rows,cfg,{},range,0)],/最低交易/);
});
test('composition evidence agrees with formula and switches direction',()=>{
 const rows=bars();for(const direction of ['long','short']){const s=A.analyze(rows,{direction}).at(-1);assert.equal(s.entryParts[0],s.evidence.trend.filter(Boolean).length*25);assert.equal(s.holdParts[1],Math.max(0,Math.min(100,50+s.evidence.velocity*35)));assert.equal(s.entryParts[3],Math.max(0,Math.min(100,50+25*s.evidence.move*Math.min(2,s.evidence.ratio))));}
});
test('page selects interval, shows four conditions, optimizes/applies locally and cancels stale searches',async()=>{
 const {page}=require('./helpers/detail-page.cjs'),p=page('futures.html');await new Promise(r=>setImmediate(r));
 const r=bars();let calls=0;
 p.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,source:'fixture',data:r.map(b=>({...b,futures_id:'TX',contract_date:b.contract,trading_session:'position',max:b.high,min:b.low,open_interest:1000}))}));};
 const fire=(id,event='click')=>p.events.find(e=>e[0]===id&&e[1]===event)[2]();
 p.nodes.get('txSession').value='position';p.nodes.get('txYears').value='1';await fire('txLoad');
 assert(p.nodes.get('actOptimize').disabled);p.nodes.get('txContract').value='202612';fire('txContract','change');
 assert.equal(p.nodes.get('actComposition').children.length,5);assert.match(p.nodes.get('actComposition').children[0].children[1].textContent,/MA20/);
 p.nodes.get('actStart').value=r[80].date;p.nodes.get('actEnd').value=r[160].date;fire('actStart','input');fire('actRun');assert.match(p.nodes.get('actResult').textContent,new RegExp(r[80].date));assert.match(p.nodes.get('actResult').textContent,new RegExp(r[160].date));
 p.nodes.get('actMinTrades').value='1';p.ctx.setTimeout=fn=>fn();await fire('actOptimize');assert.match(p.nodes.get('actOptStatus').textContent,/搜尋完成/);assert(p.nodes.get('actOptResults').children.length>0);
 const choose=p.events.filter(e=>e[0]===''&&e[1]==='click').at(-1);assert(choose);choose[2]();assert.match(p.nodes.get('actError').textContent,/已套用樣本內/);assert.match(p.nodes.get('actResult').textContent,/淨損益/);
 p.ctx.setTimeout=fn=>{fire('actCancel');fn();};await fire('actOptimize');assert.match(p.nodes.get('actOptStatus').textContent,/已停止/);assert.equal(p.nodes.get('actOptResults').children.length,0);
 fire('actAllDates');assert.equal(p.nodes.get('actStart').value,r[0].date);assert.equal(calls,1);
});
