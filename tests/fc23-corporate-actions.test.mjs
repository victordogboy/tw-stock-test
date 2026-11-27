import test from 'node:test';
import assert from 'node:assert/strict';
import {ENNOSTAR_3714,apply3714CashReduction} from '../src/fc23/corporate-actions.mjs';

const ratio=ENNOSTAR_3714.newSharesPerThousand/1000, refund=ENNOSTAR_3714.cashPerOldShare;
const code='3714';
function sharedState(q=1000){
 return {
  codes:[code,'2330'],qty:[q,0],basis:[53,0],peak:[60,0],cash:300000,
  watchPrice:[58,0],marketCodes:['2330',code],marketBase:[100,56.7],
  stocks:{[code]:{p:56.7,c:[55,56.7],pc:[55,56.7],e:[54,50,49],tr:[2,2.5],
   v:[10000,12000],a:[570000,680000],chips:[{volume:12000,foreign:500,trust:100,hedge:-20,margin:500,short:80}]}}
 };
}
test('3714 11/16 cash reduction preserves prior simulated equity at adjusted reference',()=>{
 const st=sharedState(),originalNav=st.cash+st.qty[0]*st.stocks[code].p;
 const entry=apply3714CashReduction(st,'2026-11-16');
 assert.ok(entry);
 assert.ok(Math.abs(st.qty[0]-1000*ratio)<1e-8);
 assert.ok(Math.abs(st.cash-(300000+1000*refund))<1e-8);
 assert.ok(Math.abs(st.basis[0]-(53-refund)/ratio)<1e-8);
 assert.ok(Math.abs(st.cash+st.qty[0]*st.stocks[code].p-originalNav)<1e-7);
 assert.ok(Math.abs(st.marketBase[1]-56.7*entry.priceScale)<1e-7);
 assert.ok(Math.abs(st.stocks[code].v[0]-10000*ratio)<1e-7);
 assert.equal(st.stocks[code].a[0],570000,'trade money not split-scaled');
 assert.equal(apply3714CashReduction(st,'2026-11-16'),null,'event cannot pay twice');
 assert.ok(Math.abs(st.cash+st.qty[0]*st.stocks[code].p-originalNav)<1e-7);
});
test('FC23 account without price history receives its own shares and cash, independent of R1494',()=>{
 const acct={codes:[code],qty:[30],basis:[53],peak:[60],cash:5000};
 const event=apply3714CashReduction(acct,'2026-11-16',56.7);
 assert.ok(Math.abs(acct.cash-(5000+30*refund))<1e-9);
 assert.ok(Math.abs(acct.qty[0]-30*ratio)<1e-9);
 assert.ok(Math.abs(acct.cash+acct.qty[0]*event.referenceNewSharePrice-(5000+30*56.7))<1e-7);
});
test('Unverified discontinuities are not implicitly authorized',()=>{
 const st=sharedState(0),before=structuredClone(st);
 assert.equal(apply3714CashReduction(st,'2026-11-17'),null);
 assert.deepEqual(st,before);
 assert.throws(()=>apply3714CashReduction({codes:[code],qty:[0],cash:0},'2026-11-16'),/最後成交價缺漏/);
});
