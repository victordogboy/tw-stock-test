import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createScanRuntime} from '../src/scan-runtime.mjs';
import {validateOptions} from '../src/scan-job.mjs';
const require=createRequire(import.meta.url),{page,fixture}=require('./helpers/detail-page.cjs');
const ctx=vm.createContext({});vm.runInContext(readFileSync('public/dual-action.js','utf8'),ctx);
const D=ctx.TWDualAction;
function data(amount=50000){
 const rows=fixture().map(r=>({...r,open:100,close:100,high:101,low:99,volume:1000000}));
 const inst=rows.map(r=>({date:r.date,Foreign_Investor_buy:Math.max(0,amount),Foreign_Investor_sell:Math.max(0,-amount),Investment_Trust_buy:0,Investment_Trust_sell:0}));
 return {rows,inst};
}
test('R31 compares all price-matched flow levels, not a rolling window or a price quotient',()=>{
 for(const amount of [50000,-50000,0,300000,-300000]){
  const {rows,inst}=data(amount),a=D.samePrice(rows,inst);
  assert.equal(a.sampleCount,56);assert.equal(a.netShares,amount*32.5);
  assert.equal(a.score,Math.round(Math.max(0,Math.min(100,50+10*amount*32.5/1000000))));
  assert.equal(a.referenceStart,rows.at(-61).date);assert.equal(a.referenceEnd,rows.at(-6).date);
  assert.equal(a.proxy,true);assert.match(D.samePriceNote(a),/投信/);
 }
 const d=data();d.inst[0].Foreign_Investor_buy=1e12;
 assert.equal(D.samePrice(d.rows,d.inst).score,66,'arbitrary earlier cumulative origin cancels');
 const a=D.samePrice(d.rows,d.inst,{lookback:20,tolerance:3,minGap:10});
 assert.equal(a.sampleCount,11);assert.equal(a.netShares,750000);
 const zero=data(0);zero.rows.at(-1).close=98;
 assert.equal(D.samePrice(zero.rows,zero.inst).score,50,'price decline alone creates no accumulation');
});
test('historical audit ignores future observations, intraday uses yesterday, close requires exact-date chips',()=>{
 const {rows,inst}=data(),historical=rows.slice(0,140);
 assert.deepEqual(D.samePrice(historical,inst),D.samePrice(historical,inst.slice(0,140)));
 assert.equal(D.samePrice(rows,inst.slice(0,-1)).score,null);
 rows.at(-1).intradayProjected=true;rows.at(-1).volume=1e12;inst.at(-1).Foreign_Investor_buy=1e12;
 const a=D.samePrice(rows,inst);assert.equal(a.lag,1);assert.equal(a.netShares,31.5*50000);assert.equal(a.averageVolume,1000000);
 assert.equal(a.chipDate,rows.at(-2).date);
 assert.equal(D.samePrice(rows,inst.slice(0,-2)).score,null);
});
test('missing observations/classes and absent reference never turn into neutral or fabricated zero',()=>{
 for(const mutate of [d=>d.inst.splice(-5,1),d=>delete d.inst.at(-4).Investment_Trust_sell,d=>d.inst.at(-4)._reportedGroups=['foreign'],d=>d.rows.at(-4).volume=0]){
  const d=data();mutate(d);const a=D.samePrice(d.rows,d.inst);assert.equal(a.score,null);assert.equal(a.missingDays,1);
 }
 const d=data();for(let i=0;i<d.rows.length-4;i++)d.rows[i].close=90;
 assert.equal(D.samePrice(d.rows,d.inst).state,'無同價位基準');
 assert.equal(D.samePrice(d.rows,[]).score,null);
 const dup=data();dup.inst.push({...dup.inst.at(-1)});assert.equal(D.samePrice(dup.rows,dup.inst).score,null);
});
test('large discontinuities refuse score; warnings do not distort the flow signal',()=>{
 const d=data();d.rows.at(-8).close=60;assert.equal(D.samePrice(d.rows,d.inst).state,'價格不可比');
 const e=data(100000);for(const r of e.inst.slice(-5)){r.Foreign_Investor_buy=0;r.Foreign_Investor_sell=1000}
 e.rows.at(-1).close=98;const a=D.samePrice(e.rows,e.inst);
 assert.ok(a.netShares>0);assert.equal(a.broken,true);assert.ok(a.recent5<0);assert.match(a.detail,/低點/);
});
test('detail audit, scan rank and generated server share custom options; stale schema stays unranked',()=>{
 const {rows,inst}=data();const expected=JSON.stringify(D.samePrice(rows,inst));
 const detail=page('detail.html');detail.ctx.fixtureRows=rows;detail.ctx.fixtureInst=inst;
 vm.runInContext("STATE.prices=fixtureRows;STATE.inst=fixtureInst;STATE.auditIndex=fixtureRows.length-1;STATE.stock={stock_id:'2330',stock_name:'測試'};render();dualLiveRow=detailDualRow(fixtureRows,{inst:fixtureInst});paintDetailDual()",detail.ctx);
 assert.equal(detail.nodes.get('chartSamePriceScore').textContent,'66 / 100');assert.equal(detail.nodes.get('liveSamePriceScore').textContent,'66 / 100');
 assert.equal(vm.runInContext('JSON.stringify(dualAuditRow.samePrice)',detail.ctx),expected);
 vm.runInContext('STATE.auditIndex=150;render()',detail.ctx);assert.match(detail.nodes.get('chartSamePriceNote').textContent,new RegExp(rows[150].date));
 const scan=page('scanner.html');scan.ctx.fixtureRows=rows;scan.ctx.fixtureInst=inst;
 assert.equal(vm.runInContext('JSON.stringify(formalScore(fixtureRows,{inst:fixtureInst}).samePrice)',scan.ctx),expected);
 vm.runInContext("results=[{code:'weak',samePrice:{...TWDualAction.samePrice(fixtureRows,fixtureInst),score:25}},{code:'strong',samePrice:TWDualAction.samePrice(fixtureRows,fixtureInst)}];showRank('samePrice')",scan.ctx);
 const html=scan.nodes.get('rows').innerHTML;assert.ok(html.indexOf('strong')<html.indexOf('weak'));
 assert.equal(vm.runInContext("rankVal({samePrice:{schema:'same-price-r29',score:100}},'samePrice')",scan.ctx),-Infinity);
 const opts={lookback:20,tolerance:3,minGap:10};scan.ctx.opts=opts;
 vm.runInContext('scanSamePriceOptions=opts',scan.ctx);
 const runtime=createScanRuntime({options:validateOptions({selection:'samePrice',samePriceOptions:opts}),targetDate:rows.at(-1).date},async()=>{throw Error('unexpected request')});
 assert.equal(JSON.stringify(runtime.formalScore(rows,{inst}).samePrice),vm.runInContext('JSON.stringify(formalScore(fixtureRows,{inst:fixtureInst}).samePrice)',scan.ctx));
 assert.throws(()=>validateOptions({samePriceOptions:{lookback:999}}));
});
test('same-price candidates fetch chips before top-N selection, including low other-score rows',async()=>{
 const {rows,inst}=data(),calls=[];
 const runtime=createScanRuntime({options:validateOptions({selection:'samePrice',minLots:0,maxClose:0}),targetDate:rows.at(-1).date},async path=>{
  const u=new URL(path,'https://test');calls.push(u.pathname);
  if(u.pathname==='/api/history/auto')return {ok:true,data:rows};
  if(u.pathname==='/api/chips/hybrid'){assert.equal(u.searchParams.get('require_current'),'1');return {ok:true,inst,margin:[],daytrade:[],data_dates:{inst:rows.at(-1).date}}}
  throw Error('unexpected '+path);
 });
 const a=await runtime.scan({code:'3443',market:'twse',hasFutures:true});
 assert.equal(a.error,null);assert.equal(a.row.samePrice.score,66);assert.equal(a.row.samePriceChecked,true);
 assert.equal(calls.filter(p=>p==='/api/chips/hybrid').length,1);
 const candidates=runtime.selectCandidates([{code:'other-high',entry:100,hold:100,samePrice:{schema:'same-price-r31',score:20}},{...a.row,entry:0,hold:0}],1);
 assert.equal(candidates[0].code,'3443');
});
