const test=require('node:test'),assert=require('node:assert/strict');
const {page}=require('./helpers/detail-page.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const makeTx=()=>Array.from({length:12},(_,i)=>{
 const date=new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),c=26000+50*i;
 return {date,futures_id:'TX',contract_date:'202611',trading_session:'position',open:c,max:c+55,min:c-20,close:c+25,volume:10000,open_interest:50000};
});
test('R49 live canvas overlay: US prev-close and TW same-day source switch, cursor and opt-out',async()=>{
 const p=page('futures.html');await flush();
 const tx=makeTx(),calls=[];
 p.ctx.fetch=async path=>{
  const url=new URL(String(path),'https://test.local');calls.push(url.pathname);
  if(url.pathname.endsWith('/vix')){
    const market=url.searchParams.get('market');
    const data=market==='us'?[{date:'2026-10-09',value:17.3},{date:'2026-10-10',value:99.1}]:
      [{date:'2026-10-12',value:20.75,time:'13:44:45'}];
    return Response.json({ok:true,data,source:'fixture'});
  }
  return Response.json({ok:true,data:tx,source:'fixture',cache_hit:false});
 };
 const fire=(id,type='click')=>{
  const found=p.events.find(e=>e[0]===id&&e[1]===type);
  assert.ok(found,'missing event '+id+' '+type);return found[2]();
 };
 p.nodes.get('txSession').value='position';
 await fire('txLoad');await flush();await flush();
 assert.match(p.nodes.get('txVixStatus').textContent,/美國 VIX/);
 assert.match(p.nodes.get('txVixAudit').textContent,/2026-10-09/,'must not use same-day US close');
 assert.doesNotMatch(p.nodes.get('txVixAudit').textContent,/99\.10/);
 p.nodes.get('txVixMarket').value='tw';fire('txVixMarket','change');await flush();await flush();
 assert.match(p.nodes.get('txVixStatus').textContent,/台灣 VIX/);
 assert.match(p.nodes.get('txVixAudit').textContent,/20\.75/);
 const count=calls.length;
 p.nodes.get('txVixEnabled').checked=false;fire('txVixEnabled','change');
 fire('txLatest');assert.match(p.nodes.get('txVixAudit').textContent,/已關閉/);
 assert.equal(calls.length,count,'cursor updates must not trigger API');
});
