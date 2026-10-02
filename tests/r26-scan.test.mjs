import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createScanRuntime} from '../src/scan-runtime.mjs';
import {validateOptions} from '../src/scan-job.mjs';
const context=vm.createContext({});
vm.runInContext(readFileSync('public/dual-action.js','utf8'),context);
const D=context.TWDualAction,w={buy:{setup:0,opportunity:0,entry:0,hold:100},stay:{setup:0,opportunity:0,entry:0,hold:100}};
const base={hold:80,previousScores:{hold:75}};
test('dual deltas use volume confirmation once; scores stay unchanged; missing volume stays missing',()=>{
 for(const [ratio,bonus] of [[.5,-4],[1,0],[1.2,4],[1.5,7],[2,10]]){
  const m=D.metrics({...base,volume:ratio*1000,previousVolume:1000},w);
  assert.equal(m.buy,80);assert.equal(m.stay,80);assert.equal(m.buyScoreDelta,5);
  assert.equal(m.buyDelta,5+bonus);assert.equal(m.stayDelta,5+bonus);
 }
 assert.equal(D.metrics(base,w).buyDelta,null);
 assert.equal(D.metrics({...base,volume:100,previousVolume:0},w).stayDelta,null);
});
const rows=Array.from({length:220},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:30,high:31,low:29,close:30,volume:1000000}));
test('illiquid lagging daily rows skip the second quote request without changing liquidity threshold',async()=>{
 const calls=[],rt=createScanRuntime({options:validateOptions({minLots:3000}),targetDate:'2026-09-30'},async url=>{calls.push(url);return {data:rows}});
 const result=await rt.scan({code:'2330',market:'twse'});
 assert.equal(result.row,null);assert.match(result.error,/低於最低成交量/);
 assert.equal(calls.length,1);assert.match(calls[0],/history/);
});
test('official closing volume survives the final realtime phase',async()=>{
 const last=rows.at(-1),official={...last,volume:4000000};
 const rt=createScanRuntime({options:validateOptions({minLots:0}),targetDate:last.date},async()=>({quote_valid:true,bar:{...last,volume:1000000,last_time:'13:30:00'}}));
 const row={code:'2330',market:'twse',dataDate:last.date,_hist:rows.slice(0,-1).concat(official),formalPrice:true};
 await rt.liveCurrentRecheckOne(row);
 assert.equal(row.liveProjectedVolume,4000000);assert.equal(row.holdVolumeProjected,false);assert.equal(row.holdVolumeRatio,4);
});
// Exercise the actual reordering function against a small DOM implementing
// move semantics, including switching repeatedly between unrelated columns.
test('all selected metrics move before other scores with header/body alignment',()=>{
 const source=readFileSync('public/scanner.html','utf8');
 const keys=['setup','opportunity','entry','hold','holdDelta','holdVolumeDelta','buyAction','buyActionDelta','stayAction','stayActionDelta','stayDrawdown'];
 function row(){const children=['code','name',...keys,'date'].map(metric=>({metric,classList:{toggle(){}}}));return {children,querySelector(q){return children.find(c=>q.includes('"'+c.metric+'"'))},querySelectorAll(){return children.filter(c=>keys.includes(c.metric))},insertBefore(cell,anchor){if(cell===anchor)return;children.splice(children.indexOf(cell),1);children.splice(children.indexOf(anchor),0,cell)}}}
 const header=row(),body=row(),tabs={children:keys.map(key=>({key})),querySelector(q){return this.children.find(c=>q.includes('"'+c.key+'"'))},prepend(c){this.children.splice(this.children.indexOf(c),1);this.children.unshift(c)}};
 const ctx=vm.createContext({$:id=>id==='rankTable'?{rows:[header,body]}:tabs});
 vm.runInContext(source.slice(source.indexOf('function moveSelectedMetricFirst'),source.indexOf('function safeText')),ctx);
 for(const key of [...keys,...keys.slice().reverse()]){
  ctx.moveSelectedMetricFirst(key);
  assert.equal(header.children[2].metric,key);assert.equal(body.children[2].metric,key);assert.equal(tabs.children[0].key,key);
  assert.deepEqual(header.children.map(c=>c.metric),body.children.map(c=>c.metric));
 }
 assert.equal((source.match(/id="rankTable"/g)||[]).length,1);
 assert.doesNotMatch(source,/<(?:button|option)[^>]*(?:data-rank|value)="action(?:Delta)?"/);
});
