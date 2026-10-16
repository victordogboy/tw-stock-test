const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const SAR=require('../public/parabolic-sar.js');
const {page,fixture}=require('./helpers/detail-page.cjs');
const bar=(high,low,close)=>( {high,low,close} );
test('SAR hand-calculated trend, new extremes, AF cap and reversal reset',()=>{
  const rows=[bar(10,8,9),bar(11,9,10),bar(12,10,11),bar(13,11,12),bar(14,12,13),bar(9,7,8),bar(8,6,7),bar(15,8,14)];
  const a=SAR.calculate(rows,{start:.02,step:.02,max:.06});
  assert.equal(a[0],null);
  assert.deepEqual(a[1],{value:8,up:true,af:.02});
  assert.deepEqual(a[2],{value:8,up:true,af:.04});
  assert.ok(Math.abs(a[3].value-8.16)<1e-10);assert.equal(a[3].af,.06);
  assert.ok(Math.abs(a[4].value-8.4504)<1e-10);assert.equal(a[4].af,.06);
  assert.deepEqual(a[5],{value:14,up:false,af:.02});
  assert.deepEqual(a[6],{value:14,up:false,af:.04});
  assert.deepEqual(a[7],{value:6,up:true,af:.02});
  const mirrored=rows.map(b=>bar(30-b.low,30-b.high,30-b.close));
  SAR.calculate(mirrored,{start:.02,step:.02,max:.06}).forEach((p,i)=>{
    if(p){assert.equal(p.up,!a[i].up);assert.ok(Math.abs(p.value-(30-a[i].value))<1e-10);}
  });
});
test('SAR is prefix-invariant, supports parameters and handles short/invalid history',()=>{
  const rows=fixture(),all=SAR.calculate(rows);
  for(let n=1;n<rows.length;n++)assert.deepEqual(SAR.calculate(rows.slice(0,n)),all.slice(0,n));
  assert.notDeepEqual(SAR.calculate(rows,{start:.04,step:.03,max:.3}),all);
  assert.deepEqual(SAR.calculate([]),[]);assert.deepEqual(SAR.calculate([bar(1,1,1)]),[null]);
  assert.ok(SAR.calculate(Array(10).fill(bar(1,1,1))).slice(1).every(p=>p.value===1));
  assert.deepEqual(SAR.calculate([bar(3,1,2),bar(NaN,1,2),bar(4,2,3)]),[null,null,null]);
  for(const p of [{start:0},{step:-1},{max:Infinity},{start:.3,max:.2},{step:.3,max:.2}])assert.throws(()=>SAR.validate(p));
});
test('detail chart draws last 100 SAR points from full history; settings persist and invalid edits retain chart',()=>{
  const p=page('detail.html'),arcs=[];p.ctx.rows=fixture();
  p.nodes.get('chart').getContext=()=>new Proxy({arc:(...a)=>arcs.push(a)},{get:(o,k)=>o[k]||(()=>{})});
  vm.runInContext('drawPriceChart(rows)',p.ctx);assert.equal(arcs.length,100);
  const initial=p.nodes.get('sarValue').textContent;assert.match(initial,/SAR/);
  const fire=(id,event)=>p.events.find(e=>e[0]===id&&e[1]===event)[2]();
  p.nodes.get('sarstart').value=.04;fire('sarstart','change');assert.equal(JSON.parse(p.storage.get('twq_chart_sar_v1')).start,.04);
  p.nodes.get('sarmax').value=.01;fire('sarmax','change');assert.match(p.nodes.get('sarError').textContent,/上限不可/);assert.equal(p.ctx.TWSar.settings.max,.2);
  arcs.length=0;p.nodes.get('sarEnabled').checked=false;fire('sarEnabled','change');assert.equal(arcs.length,0);assert.match(p.nodes.get('sarValue').textContent,/已隱藏/);
  fire('sarReset','click');assert.equal(p.nodes.get('sarstart').value,'0.02');assert.equal(p.nodes.get('sarValue').textContent,initial);
  vm.runInContext('drawPriceChart(rows.slice(0,120))',p.ctx);assert.match(p.nodes.get('sarValue').textContent,new RegExp(p.ctx.rows[119].date));
});
