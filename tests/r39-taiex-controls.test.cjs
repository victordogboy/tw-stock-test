const test=require('node:test'),assert=require('node:assert/strict');
const {page}=require('./helpers/detail-page.cjs');
test('near mode with early audit still runs full date range; latest control and chart scroll preserve backtest',async()=>{
 const p=page('futures.html');await new Promise(r=>setImmediate(r));
 const data=Array.from({length:180},(_,i)=>{const c=20000+Math.sin(i/7)*300+i;return {date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),futures_id:'TX',contract_date:'202612',trading_session:'position',open:c-10,close:c,max:c+35,min:c-35,volume:10000,open_interest:1000};});
 let calls=0;p.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,data:[...data,...data.slice(0,90).map(b=>({...b,contract_date:'202611'}))],source:'fixture'}));};
 const fire=(id,event='click',value)=>p.events.find(e=>e[0]===id&&e[1]===event)[2](value);
 p.nodes.get('txYears').value='1';p.nodes.get('txSession').value='position';await fire('txLoad');
 p.nodes.get('txAudit').value='3';fire('txAudit','input');assert.match(p.nodes.get('actScores').textContent,/目前 4 根/);assert.equal(p.nodes.get('actRun').disabled,false);assert.equal(p.nodes.get('actOptimize').disabled,false);
 fire('actRun');const result=p.nodes.get('actResult').textContent;assert.match(result,/合約 202612/);assert(result.includes(data.at(-1).date));
 p.nodes.get('actMinTrades').value='1';p.ctx.setTimeout=fn=>fn();await fire('actOptimize');assert.match(p.nodes.get('actOptStatus').textContent,/搜尋完成/);
 fire('actLatest');assert.match(p.nodes.get('actScores').textContent,/進場 Action/);assert.equal(p.nodes.get('actResult').textContent,result);
 const pointer=(x,y)=>({clientX:x,clientY:y,pointerId:1});
 fire('txChart','pointerdown',pointer(100,100));fire('txChart','pointermove',pointer(100,150));fire('txChart','pointerup',pointer(100,150));assert.equal(p.nodes.get('txAudit').value,'179');
 fire('txChart','pointerdown',pointer(100,100));fire('txChart','pointercancel');fire('txChart','pointerup',pointer(100,100));assert.equal(p.nodes.get('txAudit').value,'179');
 // The DOM harness omits left by default; give chart the actual coordinate origin.
 p.nodes.get('txChart').getBoundingClientRect=()=>({left:0});
 fire('txChart','pointerdown',pointer(100,100));fire('txChart','pointerup',pointer(100,100));assert.notEqual(p.nodes.get('txAudit').value,'179');assert.equal(p.nodes.get('actResult').textContent,result);
 p.nodes.get('actEnd').value=data[80].date;fire('actEnd','input');fire('actRun');assert.match(p.nodes.get('actResult').textContent,/合約 202611/);
 assert.equal(calls,1);
});
