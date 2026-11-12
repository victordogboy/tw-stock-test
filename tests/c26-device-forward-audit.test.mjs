import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('public/r1494a/c26/index.html','utf8');
const src=fs.readFileSync('public/r1494a/c26/forward-audit.mjs','utf8');
const universe=JSON.parse(fs.readFileSync('public/r1494a/c26/data/universe.json','utf8'));
test('C26 device audit is visible with no false live plan',()=>{
 assert.equal(universe.codes.length,233);
 assert.equal(new Set(universe.codes).size,233);
 assert.match(html,/c26-device-audit/);
 assert.match(html,/c26-forward-stage/);
 assert.match(html,/forward-audit\.mjs/);
 assert.match(src,/https:\/\/api\.finmindtrade\.com\/api\/v4\/data/);
 assert.doesNotMatch(src,/localStorage\.setItem|sessionStorage\.setItem|sendBeacon/);
});
test('FinMind browser preflight validates data without uploading token to our backend',async()=>{
 const elements=Object.fromEntries(['c26-forward-stage','c26-device-audit-results','c26-device-audit','c26-forward-state-refresh'].map(id=>[id,{
  textContent:'',disabled:false,listeners:{},addEventListener(type,cb){this.listeners[type]=cb}
 }]));
 globalThis.document={getElementById(id){return elements[id]||null}};
 globalThis.window={C26DeviceFinMind:{activeToken:()=>'dummy_test_token_never_real'}};
 const date='2026-11-12';
 const coverage={source_as_of:date,staged_trade_dates:12,available_trade_dates:12,
   latest_price_valid:232,latest_institutional_codes:232,latest_missing_codes:['3714'],
   checkpoint_ohlc_parity:{pass:true},feature_parity:'NOT_VERIFIED',portfolio_replay:'NOT_REPLAYED'};
 const records=universe.codes.filter(x=>x!=='3714').map(stock_id=>({
  date,stock_id,open:100,max:110,min:90,close:103,Trading_Volume:100000
 }));
 const chips=records.map(({date,stock_id})=>({date,stock_id,name:'Foreign_Investor',buy:2,sell:1}));
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url:String(url),opts});
  let data=null;
  if(String(url).includes('/api/c26/status'))data={lock_id:universe.lock_id,forward_coverage:coverage,
    plan:{readiness:'blocked',trade_date:'2026-11-13',actions:[],plan_gate_error:'feature parity required'}};
  else if(String(url)==='./data/universe.json')data=universe;
  else if(String(url).includes('api.finmindtrade.com')){
    data={status:200,data:String(url).includes('TaiwanStockInstitutionalInvestorsBuySell')?chips:records};
  }else throw Error('unexpected '+url);
  return {ok:true,status:200,json:async()=>data};
 };
 const mod=await import('../public/r1494a/c26/forward-audit.mjs');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(elements['c26-forward-stage'].textContent,/NOT_REPLAYED/);
 assert.match(elements['c26-forward-stage'].textContent,/feature parity required/);
 assert.equal(mod.valPrice({open:100,max:110,min:90,close:102,Trading_Volume:0}),true);
 assert.equal(mod.valPrice({open:120,max:110,min:90,close:102,Trading_Volume:0}),false);
 await elements['c26-device-audit'].listeners.click();
 assert.match(elements['c26-device-audit-results'].textContent,/有效日 K：232\/233/);
 assert.match(elements['c26-device-audit-results'].textContent,/缺少日 K：3714/);
 assert.match(elements['c26-device-audit-results'].textContent,/尚未完成驗證，不會產生交易訊號/);
 const thirdPartyCalls=calls.filter(x=>x.url.includes('api.finmindtrade.com'));
 assert.equal(thirdPartyCalls.length,2);
 assert.ok(thirdPartyCalls.every(c=>c.opts.headers.Authorization==='Bearer dummy_test_token_never_real'));
 assert.ok(calls.filter(c=>c.url.includes('/api/c26/status')||c.url.includes('universe.json')).every(c=>!c.opts.headers?.Authorization));
 assert.equal(elements['c26-device-audit'].disabled,false);
});
