const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('src/index.js','utf8').replace('export default {','globalThis.worker = {');
const I=require('../public/research-r191-import.js');
function harness(){
 const store=new Map(),calls=[];let officialCalls=0;
 const c=vm.createContext({Request,Response,Headers,URL,URLSearchParams,AbortSignal,console,caches:{default:{async match(k){return store.get(k.url)?.clone();},async put(k,r){store.set(k.url,r.clone());}}}});vm.runInContext(source,c);const realDS=c.r191FinMindDS;
 c.requestFinMindToken=async()=> 'fake-test-token';
 c.fetchJson=async()=>{officialCalls++;throw Error('Upstream 307: <html>因為安全性考量 FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.</html>');};
 c.r191FinMindDS=async(dataset,date)=>{calls.push({dataset,date});if(dataset==='TaiwanStockInfo')return info;return raw;};
 return {c,realDS,store,calls,get officialCalls(){return officialCalls;},async request(method,market='twse',provider='official',date='2024-01-02'){const u=new URL(`https://test/api/research/market-day?date=${date}&market=${market}&source=${provider}`);const r=await c.worker.fetch(new Request(u,{method}),{});return {status:r.status,body:await r.json()};}};
}
const info=Array.from({length:220},(_,i)=>({stock_id:String(1000+i),type:i<110?'twse':'tpex',stock_name:'fixture',date:'2026-09-11'}));
const raw=info.map(x=>({stock_id:x.stock_id,date:'2024-01-02',Trading_Volume:1000,open:10,max:12,min:9,close:11}));
test('security block returns concise diagnosis, never retries alternate same-site path, and opens cooldown',async()=>{
 const h=harness();const r=await h.request('POST','tpex');assert.equal(r.status,503);assert.equal(r.body.code,'SOURCE_BLOCKED');assert.equal(r.body.error.includes('<html>'),false);assert.equal(h.officialCalls,1);assert.equal((await h.request('POST','tpex','official','2024-01-03')).body.code,'SOURCE_BLOCKED');assert.equal(h.officialCalls,1);assert.equal((await h.request('GET','tpex')).status,404);
});
test('FinMind must be explicitly selected; GET never calls data provider',async()=>{
 const h=harness();assert.equal((await h.request('GET','twse','finmind')).status,404);assert.equal(h.calls.length,0);
 const r=await h.request('POST','twse','finmind');assert.equal(r.status,200);assert.equal(r.body.rows.length,110);assert.equal(r.body.market_mapping,'provider-end-date-inference');assert.equal(h.officialCalls,0);
 assert.equal((await h.request('POST','tpex','finmind')).status,200);assert.equal(h.calls.filter(x=>x.dataset==='TaiwanStockPrice').length,1);
 assert.equal((await h.request('GET','twse','official')).status,404); // source caches cannot masquerade as official
});
test('absent token or failed membership does not publish successful market data',async()=>{
 const h=harness();h.c.requestFinMindToken=async()=>'';assert.equal((await h.request('POST','twse','finmind')).body.code,'TOKEN_REQUIRED');assert.equal(h.calls.length,0);
 h.c.requestFinMindToken=async()=> 'fake';h.c.r191FinMindDS=async()=>{throw h.c.r191Failure('PROVIDER_ACCESS','membership required');};assert.equal((await h.request('POST','twse','finmind')).body.code,'PROVIDER_ACCESS');assert.equal((await h.request('GET','twse','finmind')).status,404);
});
test('mapping respects transfer end dates; missing, conflicting, stale classifications reject the day',()=>{
 const h=harness(),meta=[{type:'emerging',date:'2024-06-01'},{type:'tpex',date:'2026-09-11'}];assert.equal(h.c.r191Classify(meta,'2024-01-02').type,'emerging');assert.equal(h.c.r191Classify(meta,'2024-06-02').type,'tpex');
 assert.equal(h.c.r191Classify([{type:'twse',date:'2024-01-01'}],'2024-01-02'),null);
 assert.equal(h.c.r191Classify([{type:'twse',date:'2025-01-01'},{type:'tpex',date:'2025-01-01'}],'2024-01-02'),null);
 assert.throws(()=>h.c.r191NormalizeFinMind(raw,info.slice(1),'2024-01-02'),/歷史市場別/);
 assert.throws(()=>h.c.r191NormalizeFinMind([{...raw[0],date:'2024-01-03'}],info,'2024-01-02'),/日期不符/);
});
test('unexpected empty trading-day data remains a miss, not a fabricated holiday',async()=>{
 const h=harness();h.c.r191FinMindDS=async dataset=>dataset==='TaiwanStockPrice'?[]:[{date:'2024-01-01'},{date:'2024-01-02'},{date:'2024-01-03'}];assert.equal((await h.request('POST','twse','finmind')).body.code,'PROVIDER_EMPTY');assert.equal((await h.request('GET','twse','finmind')).status,404);
});
test('import accepts complete normalized history and rejects duplicate/partial/inconsistent reports',()=>{
 const s={date:'2024-01-02',market:'twse',rows:raw.slice(0,110).map(r=>({date:r.date,market:'twse',code:r.stock_id,open:10,high:12,low:9,close:11,volume:1000}))};
 const a=I.normalizeImport({snapshots:[s]});assert.equal(a[0].provider,'import');assert.equal(a[0].rows.length,110);
 assert.throws(()=>I.normalizeImport([s,s]),/重複/);assert.throws(()=>I.normalizeImport([{...s,rows:s.rows.slice(0,99)}]),/完整市場/);
 assert.throws(()=>I.normalizeImport([{...s,rows:[{...s.rows[0],volume:null},...s.rows.slice(1)]}]),/成交股數/);
});
test('direct FinMind call authenticates via header, never embeds token in URL or leaks provider HTML',async()=>{
 const h=harness();h.c.r191FinMindDS=h.realDS;let request;h.c.fetch=async (url,init)=>{request={url,init};return new Response(JSON.stringify({status:200,data:raw}));};const data=await h.c.r191FinMindDS('TaiwanStockPrice','2024-01-02','test-secret');assert.equal(data.length,220);assert.equal(request.url.includes('test-secret'),false);assert.equal(request.init.headers.Authorization,'Bearer test-secret');assert.equal(new URL(request.url).searchParams.has('data_id'),false);
 h.c.fetch=async()=>new Response('<html>secret</html>',{status:403});await assert.rejects(h.c.r191FinMindDS('TaiwanStockPrice','2024-01-02','test-secret'),e=>!e.message.includes('secret'));
});
