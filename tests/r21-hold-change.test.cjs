const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
const context=()=>{
  const ctx=vm.createContext({console:{warn(){}},document:{getElementById(){return null}},localStorage:{getItem(){return null}}});
  for(const file of ['public/action-score.js','public/hold-change.js','public/v44-engine.js'])vm.runInContext(read(file),ctx);
  const scanner=[...read('public/scanner.html').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(scanner.slice(0,scanner.indexOf('const WATCH_KEY=')),ctx);
  return ctx;
};
const ctx=context(),H=ctx.TWHoldChange;

test('new metric adds volume points without changing original Hold or clipping its delta',()=>{
  const current={hold:100},previous={hold:90};
  const c=H.calculate(current,previous,200,100);
  assert.equal(c.holdDelta,10);
  assert.equal(c.holdVolumeDelta,20);
  assert.equal(c.holdVolumeChangePct,100);
  assert.deepEqual(current,{hold:100});
  assert.deepEqual(previous,{hold:90});
  assert.equal(H.calculate({hold:0},{hold:100},20,100).holdVolumeDelta,-104);
  assert.equal(H.calculate({hold:100},{hold:0},200,100).holdVolumeDelta,110);
});

test('volume boundaries, unchanged volume and missing data are handled explicitly',()=>{
  for(const [volume,bonus] of [[0,-4],[59,-4],[60,0],[100,0],[119,0],[120,4],[149,4],[150,7],[199,7],[200,10]]){
    const c=H.calculate({hold:60},{hold:50},volume,100);
    assert.equal(c.holdVolumeBonus,bonus,String(volume));
    assert.equal(c.holdVolumeDelta,10+bonus);
  }
  for(const [current,previous] of [[100,0],[null,100],[100,null],[NaN,100],[Infinity,100],[-1,100]]){
    const c=H.calculate({hold:60},{hold:50},current,previous);
    assert.equal(c.holdDelta,10);
    assert.equal(c.holdVolumeDelta,null);
  }
  assert.equal(H.calculate({hold:60},null,200,100).holdVolumeDelta,null);
  assert.equal(H.calculate({hold:null},{hold:50},200,100).holdDelta,null);
  assert.equal(H.signed(-0.0001,1),'0.0');
});

test('original and combined rankings choose different stocks, exclude missing scores and sort negatives',()=>{
  ctx.candidates=[
    {code:'1111',hold:70,previousScores:{hold:60},holdVolumeDelta:6},
    {code:'2222',hold:66,previousScores:{hold:60},holdVolumeDelta:16},
    {code:'3333',hold:56,previousScores:{hold:60},holdVolumeDelta:-4},
    {code:'4444',hold:51,previousScores:{hold:60},holdVolumeDelta:-9},
    {code:'5555',hold:100,previousScores:null,holdVolumeDelta:null}
  ];
  vm.runInContext("scanSelection='holdDelta'",ctx);
  assert.equal(vm.runInContext('selectCandidates(candidates,1)[0].code',ctx),'1111');
  vm.runInContext("scanSelection='holdVolumeDelta'",ctx);
  assert.equal(vm.runInContext('selectCandidates(candidates).map(x=>x.code).join() ',ctx),'2222,1111,3333,4444');
});

test('Scan and individual page use the same original engine and historical cutoff',()=>{
  const detail=read('public/detail.html');
  const fn=name=>detail.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0];
  assert.equal(vm.runInContext('entryEngine.toString()',ctx),fn('entryEngine'));
  assert.equal(vm.runInContext('combineScores.toString()',ctx),fn('combineScores'));
  const rows=[];
  for(let i=0;i<100;i++){
    const c=30+i*.05+Math.sin(i/4);
    rows.push({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000});
  }
  rows.at(-1).volume=8000000;
  ctx.rows=rows;
  vm.runInContext('const STATE={margin:[],inst:[],daytrade:[]};'+fn('detailHoldChange'),ctx);
  const scanner=vm.runInContext('formalScore(rows)',ctx);
  const single=vm.runInContext('detailHoldChange(rows,entryEngine(rows,combineScores(rows,[],[],[])))',ctx);
  for(const key of ['holdDelta','holdVolumeDelta','holdVolumeBonus','holdVolumeRatio','previousDate'])assert.equal(single[key],scanner[key],key);
  const historical=vm.runInContext('detailHoldChange(rows.slice(0,90),entryEngine(rows.slice(0,90),combineScores(rows.slice(0,90),[],[],[])))',ctx);
  rows.at(-1).close=1000;rows.at(-1).volume=1e12;
  const after=vm.runInContext('detailHoldChange(rows.slice(0,90),entryEngine(rows.slice(0,90),combineScores(rows.slice(0,90),[],[],[])))',ctx);
  assert.equal(JSON.stringify(after),JSON.stringify(historical));
});
