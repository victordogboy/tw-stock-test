import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('public/r1494a/fc23/live-status.js','utf8');
const archived=JSON.parse(fs.readFileSync('public/r1494a/fc23/snapshot.json','utf8'));
assert.equal(archived.state,'HISTORICAL_ONLY','historical research archive must remain frozen');
const current={
  model_version:'FC23',data_as_of:'2026-11-09',checkedThrough:'2026-11-09',sync_status:'current',
  snapshots:[{date:'2026-11-09',holdings:[]}],lastError:null,
  plan:{readiness:'ready',trade_date:'2026-11-10',actions:[],
    decision:{breadth:.2643885,breadthDelta:-.3330844,market20:-.230919,marketCold:true,
      reentryCandidates:0,rebalance:false,riskRelease:false,target:.010418625},
    snapshot:{bear:true,overlay:true,target:.010418625}}
};
const blocked={...current,sync_status:'blocked',lastError:{message:'缺少最新行情'},plan:{...current.plan,readiness:'blocked',blockedReason:'缺少最新行情'}};
async function check(data) {
  const nodes=new Map();
  const node=id=>nodes.get(id)||nodes.set(id,{textContent:'',innerHTML:'',disabled:false,addEventListener(ev,cb){this.handlers??={};this.handlers[ev]=cb;}}).get(id);
  let onReady;
  const requests=[];
  const sandbox={
    document:{getElementById:node,addEventListener(name,fn){if(name==='DOMContentLoaded')onReady=fn;}},
    fetch:async url=>{requests.push(String(url));return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});},
    Response,Date,Number,Promise,setTimeout,clearTimeout,console
  };
  vm.runInNewContext(source,sandbox,{filename:'live-status.js'});
  assert.equal(typeof onReady,'function');
  onReady();
  for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(requests.some(x=>x.includes('/api/fc23/snapshot')),'must query FC23 own API');
  return node;
}
const ready=await check(current);
assert.ok(ready('fc23-live-state').textContent.includes('已計算'),'paper plan must be visible');
assert.ok(ready('fc23-live-actions').innerHTML.includes('沒有個股交易指令'),'0 planned trades is NOT frozen');
assert.ok(ready('fc23-live-risks').innerHTML.includes('三日急跌'),'must explain market risk');
assert.ok(ready('block').textContent.includes('紙上模擬'),'never claim broker has executed');
const error=await check(blocked);
assert.ok(error('fc23-live-explanation').innerHTML.includes('未通過'),'must block stale plan');
assert.ok(error('fc23-live-explanation').innerHTML.includes('缺少最新行情'),'show actual blocking cause');
console.log('PASS FC23 dynamic paper plan with no trade, market risk and hard block; archive untouched');
