const test=require('node:test'),assert=require('node:assert/strict');
const {page}=require('./helpers/detail-page.cjs');
const flush=()=>new Promise(r=>setImmediate(r));
const tx=date=>[{date,futures_id:'TX',contract_date:date.slice(0,7).replace('-',''),trading_session:'position',open:25000,max:25100,min:24900,close:25050,volume:1000,open_interest:2000}];
async function setup(){
 const p=page('futures.html');await flush();await flush();
 p.nodes.get('txYears').value='5';p.nodes.get('txSession').value='position';
 const fire=(id,type='click')=>p.events.find(e=>e[0]===id&&e[1]===type)[2]();
 return {...p,fire};
}
const failure=(status=502)=>Response.json({ok:false,error:'來源暫時失敗',upstream_status:status},{status});
test('transient history failure retries; VIX request failure leaves TX prices and chart usable',async()=>{
 const p=await setup();let count=0;
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');
  if(u.pathname.endsWith('/vix'))return failure();
  if(++count===1)return failure();
  return Response.json({ok:true,data:tx(u.searchParams.get('end_date')),source:'fixture'});
 };
 await p.fire('txLoad');await flush();
 assert.equal(count,6);assert.notEqual(p.nodes.get('txClose').textContent,'—');
 assert.match(p.nodes.get('txStatus').textContent,/共 5 段/);
 assert.match(p.nodes.get('txVixStatus').textContent,/VIX 疊加未載入/);
 assert.equal(p.nodes.get('txLoad').disabled,false);
});
test('oversized history periods split after bounded retry without silently dropping a half',async()=>{
 const p=await setup();const ranges=[];
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');if(u.pathname.endsWith('/vix'))return failure();
  const a=u.searchParams.get('start_date'),b=u.searchParams.get('end_date');ranges.push([a,b]);
  if((Date.parse(b)-Date.parse(a))/86400000>200)return failure();
  return Response.json({ok:true,data:tx(b),source:'fixture'});
 };
 await p.fire('txLoad');
 assert.ok(ranges.some(([a,b])=>(Date.parse(b)-Date.parse(a))/86400000<200));
 assert.match(p.nodes.get('txStatus').textContent,/共 5 段/);
 assert.doesNotMatch(p.nodes.get('txStatus').textContent,/未完整|失敗/);
});
test('failed older segment exposes only contiguous recent history and real backtest dates',async()=>{
 const p=await setup();let count=0,latest;
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');if(u.pathname.endsWith('/vix'))return failure();
  if(++count>1)return failure(402);
  latest=u.searchParams.get('end_date');return Response.json({ok:true,data:tx(latest),source:'fixture'});
 };
 await p.fire('txLoad');
 assert.equal(count,2,'permission failures must not retry or query older periods');
 assert.notEqual(p.nodes.get('txClose').textContent,'—');
 assert.equal(p.nodes.get('r48Start').value,latest);assert.equal(p.nodes.get('r48End').value,latest);
 assert.match(p.nodes.get('txStatus').textContent,/歷史未完整.*HTTP 402.*回測非完整五年/);
});
test('VIX synchronous failures cannot block TX loading, metrics, cursor or reload',async()=>{
 const p=await setup();p.ctx.TWTaiexVixOverlay=new Proxy({}, {get:()=>()=>{throw Error('broken overlay')}});
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');return Response.json({ok:true,data:tx(u.searchParams.get('end_date')),source:'fixture'});
 };
 await p.fire('txLoad');p.fire('txLatest');
 assert.notEqual(p.nodes.get('txClose').textContent,'—');assert.match(p.nodes.get('txStatus').textContent,/共 5 段/);
 assert.equal(p.nodes.get('txLoad').disabled,false);assert.match(p.nodes.get('txVixStatus').textContent,/VIX 顯示異常/);
});
test('total TX failure still permits independent VIX load and identifies the failed date range',async()=>{
 const p=await setup();let calls=0;
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');
  if(u.pathname.endsWith('/vix')){calls++;return Response.json({ok:true,data:[{date:'2026-10-16',value:20}]});}
  return failure(403);
 };
 await p.fire('txLoad');await flush();
 assert.equal(calls,1);assert.match(p.nodes.get('txStatus').textContent,/載入失敗：\d{4}-\d{2}-\d{2}.*HTTP 403/);
 assert.match(p.nodes.get('txVixStatus').textContent,/美國 VIX.*1 日/);
});
test('failed refresh preserves previous successful history instead of replacing it with partial data',async()=>{
 const p=await setup();let broken=false;
 p.ctx.fetch=async path=>{
  const u=new URL(path,'https://test');if(u.pathname.endsWith('/vix'))return failure();
  if(broken)return failure(429);
  return Response.json({ok:true,data:tx(u.searchParams.get('end_date')),source:'fixture'});
 };
 await p.fire('txLoad');const previous=p.nodes.get('txClose').textContent;broken=true;
 await p.fire('txRefresh');
 assert.equal(p.nodes.get('txClose').textContent,previous);assert.match(p.nodes.get('txStatus').textContent,/保留上次成功資料/);
});
