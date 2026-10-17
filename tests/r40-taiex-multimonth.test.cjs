const test=require('node:test'),assert=require('node:assert/strict'),A=require('../public/taiex-action.js');
const {multiFixture,apiFixture}=require('./helpers/taiex-multi.cjs');
const config={delta:0,minEntry:0,exit:0,maxAge:0,cost:3},range={start:'2025-10-01',end:'2026-02-28'};
test('calendar roll spans all requested months, handles year boundary and uses own-contract fills with costs',()=>{
 assert.equal(A.nextMonth('2025-12-31'),'202601');
 const rows=multiFixture(),r=A.backtestMulti(rows,config,{},range);
 assert.deepEqual(r.months,['202511','202512','202601','202602','202603']);assert.equal(r.start,range.start);assert.equal(r.end,range.end);assert.equal(r.rollovers,4);assert(r.trades.length>=5);
 assert(r.trades.some(t=>t.reason==='換月平倉'));assert.equal(r.gross-r.net,r.trades.length*3);
 for(const t of r.trades){const entry=rows.find(b=>b.contract===t.contract&&b.date===t.entryDate),exit=rows.find(b=>b.contract===t.contract&&b.date===t.exitDate);assert.equal(t.entry,entry.open);assert.equal(t.exit,t.reason==='區間結束平倉'?exit.close:exit.open);assert.equal(t.net,t.exit-t.entry-3);assert(t.signalDate>=range.start);}
 // Constant offsets between contracts must never become P&L or change scores.
 const shifted=rows.map(b=>{const gap=Number(b.contract.slice(4))*10000;return {...b,open:b.open+gap,high:b.high+gap,low:b.low+gap,close:b.close+gap};});
 const other=A.backtestMulti(shifted,config,{},range);assert.equal(other.net,r.net);assert.equal(other.maxDrawdown,r.maxDrawdown);assert.equal(other.trades.length,r.trades.length);
});
test('global drawdown matches chronological realized + open-trade ledger; long and short costs and causality',()=>{
 const rows=multiFixture();for(const direction of ['long','short']){
 const p={...config,direction},r=A.backtestMulti(rows,p,{},range),d=direction==='long'?1:-1;
 let peak=0,dd=0;const dates=[...new Set(rows.filter(b=>b.date>=range.start&&b.date<=range.end).map(b=>b.date))];
 for(const date of dates){let eq=r.trades.filter(t=>t.exitDate<=date).reduce((v,t)=>v+t.net,0);for(const t of r.trades.filter(t=>t.entryDate<=date&&t.exitDate>date)){const b=rows.find(b=>b.date===date&&b.contract===t.contract);eq+=d*(b.close-t.entry)-p.cost;}peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
 assert.equal(r.maxDrawdown,dd);assert.deepEqual(r,A.backtestMulti(rows.filter(b=>b.date<=range.end),p,{},range));
 const free=A.backtestMulti(rows,{...p,cost:0},{},range);assert.equal(free.net-r.net,r.trades.length*3);
 }
});
test('missing target or old-contract roll prices fail instead of fabricating or silently skipping a month',()=>{
 const rows=multiFixture();assert.throws(()=>A.backtestMulti(rows.filter(b=>!(b.date==='2025-11-01'&&b.contract==='202512')),config,{},range),/缺少次月合約/);
 assert.throws(()=>A.backtestMulti(rows.filter(b=>!(b.date==='2025-11-01'&&b.contract==='202511')),config,{},range),/缺少舊合約/);
});
test('optimizer ranks combined months and each finalist exactly matches direct multi-month simulation',()=>{
 const rows=multiFixture();let last;
 for(const p of A.optimizeMulti(rows,config,{},range,5))last=p;
 assert.equal(last.done,last.total);assert.equal(last.months.length,5);assert(last.top.length>0);assert(last.maxTrades>=5);
 for(const item of last.top)assert.deepEqual(item.result,A.backtestMulti(rows,item.config,{},range));
 assert.deepEqual([...last.top].sort(A.compare),last.top);
 let none;for(const p of A.optimizeMulti(rows,config,{},range,1000))none=p;assert.equal(none.top.length,0);assert(none.maxTrades<1000);
 assert.throws(()=>[...A.optimizeMulti(rows,config,{},range,0)],/最低交易/);
});
test('near page tests requested interval across months and displays contracts; fixed-month mode remains available',async()=>{
 const {page}=require('./helpers/detail-page.cjs'),p=page('futures.html');await new Promise(r=>setImmediate(r));let calls=0;
 p.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,data:apiFixture(multiFixture()),source:'fixture'}));};
 const fire=(id,event='click')=>p.events.find(e=>e[0]===id&&e[1]===event)[2]();
 p.nodes.get('txSession').value='position';p.nodes.get('txYears').value='1';await fire('txLoad');
 p.nodes.get('actStart').value=range.start;p.nodes.get('actEnd').value=range.end;
 for(const [id,v]of [['actDelta','0'],['actMinimum','0'],['actAge','0'],['actExit','0']])p.nodes.get(id).value=v;fire('actApply');
 p.nodes.get('txAudit').value='3';fire('txAudit','input');fire('actRun');assert.match(p.nodes.get('actResult').textContent,/涵蓋 5 個合約/);assert.match(p.nodes.get('actScope').textContent,/每月交易次月/);assert(p.nodes.get('actTrades').children.length>=5);assert.equal(p.nodes.get('actTrades').children[0].children[0].textContent,'202511');
 p.ctx.setTimeout=fn=>fn();await fire('actOptimize');assert.match(p.nodes.get('actOptStatus').textContent,/涵蓋 5 個合約/);
 p.nodes.get('txContract').value='202603';fire('txContract','change');fire('actRun');assert.match(p.nodes.get('actResult').textContent,/合約 202603/);assert.doesNotMatch(p.nodes.get('actResult').textContent,/涵蓋 5/);assert.equal(calls,1);
});
