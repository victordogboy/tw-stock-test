const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Minimal DOM harness validates page wiring and text, not browser layout.
const root=require('node:path').join(__dirname,'..','public')+'/';
function page(name){
  const html=fs.readFileSync(root+name,'utf8'),nodes=new Map(),storage=new Map(),events=[];
  const parse=s=>{for(const m of s.matchAll(/id="([^"]+)"[^>]*>/g)){if(!nodes.has(m[1]))nodes.set(m[1],node(m[1]));const v=m[0].match(/value="([^"]*)"/);if(v)nodes.get(m[1]).value=v[1]}};
  function node(id){return {get parentElement(){return node('parent')},get parentNode(){return node('parent')},querySelector:s=>nodes.get(s.replace('#',''))||null,after(){},insertBefore(){},appendChild(){},remove(){},id,_value:'',get value(){return this._value},set value(v){this._value=String(v)},style:{},dataset:{},textContent:'',disabled:false,clientWidth:800,clientHeight:450,offsetWidth:800,offsetHeight:450,classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){events.push([id,name,fn])},getBoundingClientRect(){return {width:800,height:450}},getContext(){return new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||(()=>{})})},set innerHTML(s){this._html=s;parse(s)},get innerHTML(){return this._html||''}}}
  parse(html);
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const ctx=vm.createContext({console:{log:console.log,warn(){}},URL,URLSearchParams,Intl,Date,Math,JSON,Promise,Request,Response,Headers,Map,Set,location:{href:'http://test/'+name,origin:'http://test/'},document:{getElementById:k=>nodes.get(k)||null,querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',createElement:()=>node('')},localStorage,sessionStorage:localStorage,setTimeout(){},setInterval(){},requestAnimationFrame:fn=>fn(),devicePixelRatio:1,addEventListener(){},fetch:async()=>new Response(JSON.stringify({ok:true,configured:false,data:[],futures:[]})),navigator:{},getComputedStyle:()=>({getPropertyValue:()=>''})});
  ctx.window=ctx;
  for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    const src=m[1].match(/src="([^"?]+)[^"]*"/);
    vm.runInContext(src?fs.readFileSync(root+src[1].slice(1),'utf8'):m[2],ctx,{filename:src?src[1]:name});
  }
  return {ctx,nodes,storage,events};
}
function fixture(){const rows=[];for(let i=0;rows.length<200;i++){const d=new Date(Date.UTC(2025,0,1+i));if([0,6].includes(d.getUTCDay()))continue;const c=30+rows.length*.08+Math.sin(rows.length/4);rows.push({date:d.toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000})}return rows}
(async()=>{
const scan=page('scanner.html'),detail=page('detail.html'),rows=fixture();rows.at(-1).volume=8000000;
scan.ctx.fixture=rows;detail.ctx.fixture=rows;
vm.runInContext("results=[{code:'2330',name:'台積電',market:'twse',dataDate:fixture.at(-1).date,...formalScore(fixture),_hist:fixture}];showRank('holdVolumeDelta')",scan.ctx);
assert.match(scan.nodes.get('rows').innerHTML,/量能 \+10 分/);
const expected=vm.runInContext('results[0].holdVolumeDelta',scan.ctx);
vm.runInContext("STATE.prices=fixture;STATE.auditIndex=fixture.length-1;STATE.stock={stock_id:'2330',stock_name:'台積電'};render()",detail.ctx);
assert.equal(Number(detail.nodes.get('chartHoldVolumeDelta').textContent),expected);
assert.match(detail.nodes.get('chartHoldVolumeDeltaSub').textContent,/成交量較前交易日 \+100.0%/);
// An earlier cursor only uses earlier prices and volumes.
vm.runInContext('STATE.auditIndex=80;render()',detail.ctx);
assert.match(detail.nodes.get('chartHoldVolumeDeltaSub').textContent,/0.0%/);
// Old cache must retain symbols/watchlist/token while withholding ambiguous old Hold scores.
scan.storage.set('twq_watchlist_v16','["2330"]');scan.storage.set('twq_finmind_token_v1','test-token');
scan.storage.set('twq_scan_state_v1100',JSON.stringify({results:[{code:'2330',name:'台積電',hold:100,previousScores:{hold:90}}]}));
vm.runInContext('restoreScan()',scan.ctx);
assert.match(scan.nodes.get('status').textContent,/舊版 Hold 待重算/);
assert.match(scan.nodes.get('rows').innerHTML,/待更新/);
assert.equal(scan.storage.get('twq_watchlist_v16'),'["2330"]');assert.equal(scan.storage.get('twq_finmind_token_v1'),'test-token');
// Refresh the retained row with an intraday bar; the same metric reaches the two page paths.
const current={...rows.at(-1),date:'2026-09-21',volume:4000000,last_time:'10:30:00'};
scan.ctx.quote={ok:true,quote_valid:true,bar:current};detail.ctx.quote=scan.ctx.quote;
vm.runInContext("scanTaipeiNow=()=>({date:'2026-09-21',minutes:630});getJSON=async()=>quote;results[0]._hist=fixture.slice(0,-1)",scan.ctx);
await vm.runInContext('liveCurrentRecheckOne(results[0]);',scan.ctx);
assert.equal(vm.runInContext('results[0].holdNeedsRefresh',scan.ctx),false);
const liveExpected=vm.runInContext('results[0].holdVolumeDelta',scan.ctx);
// Clock is fixed for the page's Taipei market-hours check.
const RealDate=Date;
detail.ctx.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-21T02:30:00Z']))}static now(){return new RealDate('2026-09-21T02:30:00Z').getTime()}};
detail.ctx.fetch=async()=>new Response(JSON.stringify(detail.ctx.quote));
vm.runInContext("STATE.prices=fixture.slice(0,-1);STATE.auditIndex=STATE.prices.length-1;document.getElementById('stockInput').value='2330'",detail.ctx);
await vm.runInContext('window.__refreshTodayDetail()',detail.ctx);
assert.equal(Number(detail.nodes.get('liveHoldVolumeDelta').textContent),liveExpected);
assert.match(detail.nodes.get('liveHoldVolumeDeltaSub').textContent,/預估量/);
assert.equal(detail.nodes.get('liveScoreCard').style.display,'block');
// New scanner selection must project volume before candidate selection and preserve it in recheck.
vm.runInContext("SCAN_TARGET_DATE='2026-09-21';scanSelection='holdVolumeDelta';getJSON=async url=>url.startsWith('/api/intraday')?quote:{data:fixture.slice(0,-1)}",scan.ctx);
const stage1=await vm.runInContext("stage1CurrentHistory('2330','twse','2025-01-01','2026-09-21')",scan.ctx);
assert.equal(stage1.hist.at(-1).intradayProjected,true);
assert.ok(stage1.hist.at(-1).volume>current.volume);
scan.ctx.projectedRow={code:'2330',market:'twse',_hist:stage1.hist};
await vm.runInContext('formalizeListedOne(projectedRow)',scan.ctx);
assert.equal(scan.ctx.projectedRow._hist.at(-1).volume,stage1.hist.at(-1).volume);
assert.equal(scan.ctx.projectedRow.holdVolumeProjected,true);
console.log('Full-page script integration passed: both rendered metrics, historical cursor, retained cache/watchlist/token, live refresh, projected scan selection and recheck.');
})().catch(e=>{console.error(e);process.exitCode=1});
