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
test('same-price flow has transparent units, symmetric scores and a fixed price-only reference',()=>{
 for(const [amount,score] of [[50000,75],[-50000,25],[0,50],[300000,100],[-300000,0]]){
  const {rows,inst}=data(amount),a=D.samePrice(rows,inst);
  assert.equal(a.score,score);assert.equal(a.netShares,amount*20);assert.equal(a.intervalDays,20);
  assert.equal(a.referenceDate,rows.at(-21).date);assert.equal(a.ratioPct,amount/10000);
  assert.equal(a.proxy,true);assert.match(D.samePriceNote(a),/投信/);
 }
 const {rows,inst}=data();inst[0].Foreign_Investor_buy=1e12;
 assert.equal(D.samePrice(rows,inst).score,75,'unrelated earlier cumulative baseline does not change score');
});
test('historical audit cannot see future chips; intraday uses previous published day without estimated flows',()=>{
 const {rows,inst}=data(),historical=rows.slice(0,140);
 assert.deepEqual(D.samePrice(historical,inst),D.samePrice(historical,inst.slice(0,140)));
 rows.at(-1).intradayProjected=true;rows.at(-1).volume=1e12;inst.at(-1).Foreign_Investor_buy=1e12;
 const a=D.samePrice(rows,inst);assert.equal(a.score,75);assert.equal(a.lag,1);assert.equal(a.intervalDays,19);
 assert.equal(a.chipDate,rows.at(-2).date);assert.equal(a.netShares,19*50000);
});
test('missing observations, missing institutional class, stale chips and zero volume never become neutral',()=>{
 for(const mutate of [d=>d.inst.splice(-5,1),d=>delete d.inst.at(-4).Investment_Trust_sell,d=>d.inst.at(-4)._reportedGroups=['foreign'],d=>d.rows.at(-4).volume=0]){
  const d=data();mutate(d);const a=D.samePrice(d.rows,d.inst);assert.equal(a.score,null);assert.equal(a.missingDays,1);
 }
 const d=data();assert.equal(D.samePrice(d.rows,d.inst.slice(0,-2)).state,'資料落後');
 assert.equal(D.samePrice(d.rows,[]).score,null);
});
test('reference search obeys age/band and does not expand the band to force a score',()=>{
 const {rows,inst}=data();for(let i=0;i<rows.length-19;i++)rows[i].close=90;
 assert.equal(D.samePrice(rows,inst).state,'無同價位基準');
 rows.at(-40).close=100;const a=D.samePrice(rows,inst);assert.equal(a.referenceDate,rows.at(-40).date);
 rows.at(-40).close=90;rows.at(-122).close=100;assert.equal(D.samePrice(rows,inst).score,null);
});
test('capital-change discontinuity refuses score; distribution and broken support remain visible at high scores',()=>{
 const d=data();d.rows.at(-8).close=60;assert.equal(D.samePrice(d.rows,d.inst).state,'價格不可比');
 const e=data(100000);for(const r of e.inst.slice(-5)){r.Foreign_Investor_buy=0;r.Foreign_Investor_sell=1000}
 e.rows.at(-1).close=98;const a=D.samePrice(e.rows,e.inst);
 assert.ok(a.score>=75);assert.equal(a.broken,true);assert.ok(a.recent5<0);assert.match(a.detail,/破位/);
 const f=data();f.rows.at(-1).date=f.rows.at(-2).date;assert.equal(D.samePrice(f.rows,f.inst).score,null);
});
test('detail audit, live card, scanner ordering and generated server use the same result without requests',()=>{
 const {rows,inst}=data();const expected=JSON.stringify(D.samePrice(rows,inst));
 const detail=page('detail.html');detail.ctx.fixtureRows=rows;detail.ctx.fixtureInst=inst;
 vm.runInContext("STATE.prices=fixtureRows;STATE.inst=fixtureInst;STATE.auditIndex=fixtureRows.length-1;STATE.stock={stock_id:'2330',stock_name:'測試'};render();dualLiveRow=detailDualRow(fixtureRows,{inst:fixtureInst});paintDetailDual()",detail.ctx);
 assert.equal(detail.nodes.get('chartSamePriceScore').textContent,'75 / 100');assert.equal(detail.nodes.get('liveSamePriceScore').textContent,'75 / 100');
 assert.equal(vm.runInContext('JSON.stringify(dualAuditRow.samePrice)',detail.ctx),expected);
 vm.runInContext('STATE.auditIndex=150;render()',detail.ctx);assert.match(detail.nodes.get('chartSamePriceNote').textContent,new RegExp(rows[150].date));
 const scan=page('scanner.html');scan.ctx.fixtureRows=rows;scan.ctx.fixtureInst=inst;
 assert.equal(vm.runInContext('JSON.stringify(formalScore(fixtureRows,{inst:fixtureInst}).samePrice)',scan.ctx),expected);
 vm.runInContext("results=[{code:'weak',samePrice:{...TWDualAction.samePrice(fixtureRows,fixtureInst),score:25}},{code:'strong',samePrice:TWDualAction.samePrice(fixtureRows,fixtureInst)}];showRank('samePrice')",scan.ctx);
 const html=scan.nodes.get('rows').innerHTML;assert.ok(html.indexOf('strong')<html.indexOf('weak'));assert.match(html,/data-metric="samePrice"/);
 let calls=0;const runtime=createScanRuntime({options:validateOptions({}),targetDate:rows.at(-1).date},async()=>{calls++;throw Error('unexpected request')});
 assert.equal(JSON.stringify(runtime.formalScore(rows,{inst}).samePrice),expected);assert.equal(calls,0);
});
