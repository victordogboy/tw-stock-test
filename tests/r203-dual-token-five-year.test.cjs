const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('dual token manager migrates legacy token and switches the shared active token',()=>{
  const values=new Map([['twq_finmind_token_v1','legacy-token']]);
  const localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const window={},document={getElementById(){return null}};
  vm.runInNewContext(fs.readFileSync('public/finmind-token-manager.js','utf8'),{window,document,localStorage,fetch:async()=>{throw Error('unused')}});
  assert.deepEqual(Array.from(window.TWFinMindTokens.read().tokens),['legacy-token','']);
  window.TWFinMindTokens.write({tokens:['mine','friend'],active:1});
  assert.equal(window.TWFinMindTokens.activeToken(),'friend');
  assert.equal(window.TWFinMindTokens.headers().Authorization,'Bearer friend');
  assert.equal(localStorage.getItem('twq_finmind_token_v1'),'friend');
});

test('scanner, detail and research share dual token storage and chart shows compact scores',()=>{
  const scanner=fs.readFileSync('public/scanner.html','utf8');
  const detail=fs.readFileSync('public/detail.html','utf8');
  const research=fs.readFileSync('public/strategy-regression-lab.html','utf8');
  for(const source of [scanner,detail,research])assert.match(source,/finmind-token-manager\.js/);
  for(const id of ['chartScoreSetup','chartScoreOpportunity','chartScoreEntry','chartScoreHold','chartScoreAction'])assert.match(detail,new RegExp(id));
});

test('worker accepts five signal years plus 180 warm-up days for price and chips',()=>{
  const worker=fs.readFileSync('src/index.js','utf8');
  assert.equal((worker.match(/\/86400000>2010/g)||[]).length>=3,true);
  assert.doesNotMatch(worker,/\/86400000>1280/);
});
