const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const backendFile=path.join(__dirname,'../src/forward-pe.mjs');
const frontendFile=path.join(__dirname,'../public/pe-scanner.html');
function makeApi(rows){
 const source=fs.readFileSync(backendFile,'utf8').replace('export async function forwardPeRoute','async function forwardPeRoute');
 const snapshot={ok:true,date:'2026-10-16T06:00:00Z',priceBasis:'exchange daily quote',
  rows,errors:[],sources:{twse:true,tpex:true}};
 const fakeCache={match:async()=>new Response(JSON.stringify(snapshot),{headers:{'content-type':'application/json'}})};
 const context=vm.createContext({Request,Response,URL,AbortSignal,TextDecoder,Date,
  caches:{default:fakeCache},fetch:async()=>{throw Error('offline Yahoo volumes')}});
 vm.runInContext(source+';globalThis.route=forwardPeRoute',context);
 return context.route;
}
test('unfiltered single-stock query returns a stock even when outside bulk thresholds and with negative EPS',async()=>{
 const stock={code:'9999',name:'測試樣本',market:'twse',close:3,volumeTodayLots:2,
  financeYtdEPS:-5,sourceStatus:'已公布EPS負值',
  models:{A:{status:'已公布EPS負值',eps:null,pe:null},B:{status:'缺4季歷史資料',eps:null,pe:null},C:{status:'無法計算',eps:null,pe:null}}};
 const api=makeApi([stock]);
 const response=await api(new Request('https://test.example/api/pe-screener/stock?query=9999'),{},()=>{throw Error('external request unexpected')});
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.stock.code,'9999');
 assert.equal(data.stock.close,3);
 assert.equal(data.stock.models.A.eps,null);
 assert.equal(data.volume5.ok,false);
 assert.equal(data.snapshotTime,'2026-10-16T06:00:00Z');
});
test('single-stock lookup supports exact Chinese names and ambiguous partial names',async()=>{
 const api=makeApi([
  {code:'1001',name:'測試甲',models:{}},
  {code:'1002',name:'測試乙',models:{}}
 ]);
 const exact=await (await api(new Request('https://test.example/api/pe-screener/stock?query='+encodeURIComponent('測試甲')),{},()=>{})).json();
 assert.equal(exact.stock.code,'1001');
 const ambiguous=await (await api(new Request('https://test.example/api/pe-screener/stock?query='+encodeURIComponent('測試')),{},()=>{})).json();
 assert.equal(ambiguous.ambiguous,true);
 assert.equal(ambiguous.candidates.length,2);
});
test('R51 frontend contains independent controls, maximum price, date + fundamentals',()=>{
 const html=fs.readFileSync(frontendFile,'utf8');
 const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new vm.Script(js);
 for(const field of ['id="maxprice"','id="singleQuery"','id="singleLookup"','id="singleOutput"',
  'id="marketPanel"','id="singlePanel"','function lookupStock(', '/api/pe-screener/stock',
  'financeGrossProfit','financeYtdEPS','quoteReportedDate']){
  assert.ok(html.includes(field),'Missing '+field);
 }
 assert.equal(html.includes('id="search"'),false);
 assert.match(js,/const highest=num\('maxprice',0\)/);
 assert.match(js,/x\.close<=num\('maxprice',0\)/);
});
