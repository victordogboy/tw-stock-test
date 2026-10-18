const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({Response,Request,URL,TextDecoder,AbortSignal,Date});
vm.runInContext(fs.readFileSync('src/forward-pe.mjs','utf8').replace('export async function','async function')+';globalThis.fn={forecast,methodModels,revenueRevision,repriceRevision}',ctx);
const {forecast,methodModels,revenueRevision,repriceRevision}=ctx.fn;
const fin={year:2026,quarter:2,sector:'ci',reportedYtdEPS:5,reportedYtdRevenue:1000,grossProfit:500,opExpenses:300,pretax:230,incomeTax:46,netIncome:184,parentIncome:184};
function calc(mon,price=100){const share={close:price};return revenueRevision(share,fin,mon,methodModels(share,fin,mon,forecast(share,fin,mon)));}
const month={year:2026,month:9,ytd:1700,monthRevenue:300,prevMonth:200};
test('same price and statement; reconstruct previous revenue, calculate A and C independently',()=>{
 const r=calc(month);assert.equal(r.momPct,50);assert.equal(r.previousMonth,'2026-08');
 const d=r.models.A;assert.equal(d.previousEPS,11);assert.equal(d.currentEPS,13);
 assert.equal(d.previousPE,100/11);assert.equal(d.currentPE,100/13);
 assert.ok(Math.abs(d.peDropPct-100*(1-11/13))<1e-9);
 assert.ok(r.models.C.peDrop>0);assert.notEqual(r.models.C.currentEPS,d.currentEPS);assert.notEqual(r.models.B.status,'ok');
 const doubled=calc(month,200);assert.equal(doubled.models.A.peDrop,2*d.peDrop);assert.equal(doubled.models.A.peDropPct,d.peDropPct);
});
test('missing, zero prior revenue, cross-year and quarter boundary do not fabricate comparison',()=>{
 for(const m of [null,{...month,prevMonth:0},{...month,month:1}])assert.notEqual(calc(m).status,'ok');
 assert.notEqual(calc({...month,month:6}).models.A.status,'ok');
});
test('falling revenue stays negative; missing quotes may reprice both vintages',()=>{
 assert.ok(calc({...month,monthRevenue:100}).models.A.peDrop<0);
 const r=calc(month,null);assert.equal(r.models.A.previousPE,null);repriceRevision(r,200);
 assert.equal(r.models.A.previousPE,200/11);assert.equal(r.models.A.currentPE,200/13);assert.equal(r.models.A.status,'ok');
});
test('all modified inline scripts parse',()=>{
 for(const file of ['public/pe-scanner.html','public/detail.html']){
  const html=fs.readFileSync(file,'utf8');for(const [,js] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(js);
 }
});
