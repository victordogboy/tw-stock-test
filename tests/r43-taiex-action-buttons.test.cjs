const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {multiFixture,apiFixture}=require('./helpers/taiex-multi.cjs');
const {page}=require('./helpers/detail-page.cjs');

test('R43 Action UI JavaScript parses before any page events',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../public/taiex-action-ui.js'),'utf8');
  assert.doesNotThrow(()=>new vm.Script(script,{filename:'taiex-action-ui.js'}));
});

test('R43 loads Action score, attaches optimizer/backtest click events and gives an actual result',async()=>{
  const p=page('futures.html');
  await new Promise(resolve=>setImmediate(resolve));
  const rows=apiFixture(multiFixture());
  let networkCalls=0;
  p.ctx.fetch=async()=>{networkCalls++;return new Response(JSON.stringify({ok:true,data:rows,source:'synthetic-fixture'}));};
  p.nodes.get('txSession').value='position';
  p.nodes.get('txYears').value='1';
  const fire=(id,event='click')=>{
    const handler=p.events.find(x=>x[0]===id&&x[1]===event);
    assert(handler,'Missing handler for '+id+' / '+event);
    return handler[2]();
  };
  await fire('txLoad');
  assert.match(p.nodes.get('actScores').textContent,/進場 Action/);
  assert.equal(p.nodes.get('actRun').disabled,false);
  assert.equal(p.nodes.get('actOptimize').disabled,false);
  fire('actAllDates');
  fire('actRun');
  assert.match(p.nodes.get('actResult').textContent,/已平倉/);
  p.ctx.setTimeout=fn=>fn();
  await fire('actOptimize');
  assert.match(p.nodes.get('actOptStatus').textContent,/搜尋完成|沒有候選達到最低交易筆數/);
  assert(!/尚未最佳化|準備搜尋/.test(p.nodes.get('actOptStatus').textContent));
  assert.equal(networkCalls,1,'optimization must not silently request more data');
});
