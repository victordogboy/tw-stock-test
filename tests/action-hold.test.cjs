const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const scripts = html => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const storage = new Map();
const ctx = vm.createContext({
  console: {warn(){}},
  document: {getElementById(){return null}},
  localStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}
});
vm.runInContext(read('public/action-score.js'), ctx);
const A = ctx.TWAction;
storage.set(A.key, JSON.stringify({entry:40,setup:30,opportunity:30}));
assert.equal(A.read().hold, 0, 'migrate existing three-factor weights');
const weights = {entry:10,setup:20,opportunity:30,hold:40};
assert.equal(A.score({entry:10,setup:20,opportunity:30,hold:100},weights),54);
const holdOnly = {entry:0,setup:0,opportunity:0,hold:100};
assert.equal(A.score({hold:87},holdOnly),87);
assert.equal(A.delta({hold:95},{hold:80},holdOnly),15);
assert.equal(A.score({hold:87},{...holdOnly,entry:-1}),null);
assert.equal(A.delta({hold:95},null,holdOnly),null);
assert.equal(A.save(weights),true);
assert.equal(A.read().hold,40);
assert.equal(A.save({...weights,hold:41}),false);
vm.runInContext(read('public/hold-change.js'),ctx);
vm.runInContext(read('public/v44-engine.js'),ctx);
const scanner = scripts(read('public/scanner.html')).at(-1);
vm.runInContext(scanner.slice(0,scanner.indexOf('const WATCH_KEY=')),ctx);
const rows = [];
for(let i=0;rows.length<200;i++){
  const date = new Date(Date.UTC(2025,0,1+i));
  if([0,6].includes(date.getUTCDay()))continue;
  const c=30+rows.length*.08+Math.sin(rows.length/4);
  rows.push({date:date.toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000+rows.length*1000});
}
ctx.fixture=rows;
const current=vm.runInContext('formalScore(fixture)',ctx);
const previous=vm.runInContext('scoreAt(fixture.slice(0,-1))',ctx);
assert.equal(JSON.stringify(current.previousScores),JSON.stringify(previous));
assert.equal(current.previousDate,rows.at(-2).date);
const changed=rows.map(x=>({...x}));
changed.at(-1).close*=1.1;changed.at(-1).high=changed.at(-1).close;
ctx.fixture=changed;
const updated=vm.runInContext('formalScore(fixture)',ctx);
assert.equal(JSON.stringify(updated.previousScores),JSON.stringify(current.previousScores),
  'today price must not change prior-session baseline');

// The original Hold and its delta remain unchanged when only volume changes.
// Volume confirmation belongs exclusively to the new change metric.
const normalVol=rows.map(x=>({...x}));
ctx.fixture=normalVol;
const normalHold=vm.runInContext('formalScore(fixture)',ctx);
const surgeVol=normalVol.map(x=>({...x}));
surgeVol.at(-1).volume=surgeVol.at(-2).volume*2.05;
ctx.fixture=surgeVol;
const surgeHold=vm.runInContext('formalScore(fixture)',ctx);
assert.equal(surgeHold.hold,normalHold.hold,'volume must not change original Hold');
assert.equal(surgeHold.holdDelta,normalHold.holdDelta,'volume must not change original ΔHold');
assert.equal(surgeHold.holdVolumeBonus,10);
assert.equal(surgeHold.holdVolumeDelta,surgeHold.holdDelta+10);
assert.equal(surgeHold.holdVolumeRatio,2.05);
assert.equal(JSON.stringify(surgeHold.previousScores),JSON.stringify(normalHold.previousScores),
  'today volume must not change previous-session scores');
ctx.futureChips={inst:[{date:'2099-01-01',Foreign_Investor_buy:1e15}]};
assert.equal(JSON.stringify(vm.runInContext('formalScore(fixture,futureChips)',ctx)),JSON.stringify(surgeHold),
  'future chip rows must be excluded');
assert.equal(vm.runInContext("scanDelta({hold:99,previousScores:{hold:90}},'holdDelta')",ctx),9);
for(const file of ['public/scanner.html','public/detail.html']){
  for(const script of scripts(read(file)))new vm.Script(script,{filename:file});
}
console.log('Action weights, migration, deltas, no-lookahead and page syntax passed.');
