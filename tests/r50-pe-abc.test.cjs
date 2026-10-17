const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function getModels(){
 const source=fs.readFileSync(path.join(__dirname,'../src/forward-pe.mjs'),'utf8')
  .replace('export async function forwardPeRoute','async function forwardPeRoute');
 const context=vm.createContext({Response,Request,URL,TextDecoder,AbortSignal,Date,Math,Number,String,Object,Array,Set,Map});
 vm.runInContext(source+';globalThis.testFns={readFin,forecast,methodModels};',context);
 return context.testFns;
}
function financial(overrides={}){
 return {'年度':'115','季別':'2','基本每股盈餘（元）':'5',
  '營業收入':'1000','營業毛利（毛損）淨額':'500',
  '營業費用':'300','稅前淨利（淨損）':'230','所得稅費用（利益）':'46',
  '本期淨利（淨損）':'184','淨利（淨損）歸屬於母公司業主':'184',
  '出表日期':'115/08/14',...overrides};
}
test('R50 A/B/C are separate; B is never fabricated without 4-8 quarters',()=>{
 const {readFin,forecast,methodModels}=getModels();
 const fin=readFin(financial(),'ci'),mon={year:2026,month:9,ytd:1500,monthRevenue:100},share={close:100};
 const a=forecast(share,fin,mon),m=methodModels(share,fin,mon,a);
 assert.equal(m.A.status,'ok');
 assert.equal(m.A.eps,9);
 assert.equal(m.B.eps,null);
 assert.equal(m.B.pe,null);
 assert.match(m.B.status,/4～8季/);
 assert.equal(m.C.status,'ok');
 assert.ok(Number.isFinite(m.C.eps));
 assert.notEqual(m.C.eps,m.A.eps);
 assert.equal(fin.statementIssueDate,'115/08/14');
});
test('C shows missing field reason; never substitutes A estimation',()=>{
 const {readFin,forecast,methodModels}=getModels();
 const fin=readFin(financial({'營業費用':'--'}),'ci'),mon={year:2026,month:9,ytd:1500,monthRevenue:100},share={close:100};
 const a=forecast(share,fin,mon),m=methodModels(share,fin,mon,a);
 assert.equal(m.A.status,'ok');
 assert.equal(m.C.eps,null);
 assert.match(m.C.status,/opExpenses/);
});
test('R50 UI exposes periods and methods, including C field status and 500 rows',()=>{
 const h=fs.readFileSync(path.join(__dirname,'../public/pe-scanner.html'),'utf8');
 for(const marker of ['id="strategy"','id="stress"','id="audit"','C 資料狀態／缺欄位','r.financeQuarter','r.financeIssueDate','r.latestRevenueMonth','slice(0,500)']){
  assert.ok(h.includes(marker),marker);
 }
});
