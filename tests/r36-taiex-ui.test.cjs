const test=require('node:test'),assert=require('node:assert/strict');
const {page}=require('./helpers/detail-page.cjs');
const fixture=()=>Array.from({length:80},(_,i)=>{const date=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),c=22000+i*10;return {date,futures_id:'TX',contract_date:'202610',trading_session:'position',open:c,close:c+5,max:c+20,min:c-10,volume:10000+i,open_interest:60000+i};});
test('futures page loads data, redraws SAR/audit locally, handles empty night and keeps last good history after failure',async()=>{
 const p=page('futures.html');await new Promise(r=>setImmediate(r));
 const data=fixture();let calls=0;
 // This legacy test exercises TX only; optional VIX has separate regression tests.
 p.nodes.get('txVixEnabled').checked=false;
 p.events.find(e=>e[0]==='txVixEnabled'&&e[1]==='change')[2]();
 p.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,data,source:'fixture',cache_hit:false}));};
 p.nodes.get('txSession').value='position';p.nodes.get('txYears').value='1';
 const fire=(id,name='click')=>p.events.find(e=>e[0]===id&&e[1]===name)[2]();
 await fire('txLoad');assert.equal(calls,1);assert.match(p.nodes.get('txStatus').textContent,/非即時日 K/);assert.match(p.nodes.get('txChartTitle').textContent,/202610/);
 const latest=p.nodes.get('txClose').textContent;assert.notEqual(latest,'—');assert.match(p.nodes.get('txVolume').textContent,/10,079/);
 p.nodes.get('txSarStart').value='0.07';fire('txSarStart','change');assert.equal(JSON.parse(p.storage.get('twq_taiex_view_r36')).sar.start,.07);
 p.nodes.get('txSarMax').value='0.01';fire('txSarMax','change');assert.match(p.nodes.get('txSarError').textContent,/上限不可/);
 p.nodes.get('txAudit').value='40';fire('txAudit','input');assert.match(p.nodes.get('txChartTitle').textContent,new RegExp(data[40].date));assert.notEqual(p.nodes.get('txClose').textContent,latest);
 fire('txLatest');assert.equal(p.nodes.get('txClose').textContent,latest);
 p.nodes.get('txSession').value='after_market';fire('txSession','change');assert.equal(p.nodes.get('txClose').textContent,'—');assert.match(p.nodes.get('txChartTitle').textContent,/沒有資料/);
 p.nodes.get('txSession').value='position';fire('txSession','change');assert.equal(p.nodes.get('txClose').textContent,latest);assert.equal(calls,1);
 p.ctx.fetch=async()=>new Response(JSON.stringify({ok:false,error:'測試權限不足'}),{status:402});await fire('txLoad');assert.match(p.nodes.get('txStatus').textContent,/載入失敗.*保留/);assert.equal(p.nodes.get('txClose').textContent,latest);
});
