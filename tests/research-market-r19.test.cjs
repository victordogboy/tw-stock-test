const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/index.js','utf8').replace('export default {','globalThis.worker = {');
function harness(raw){
 const store=new Map();let calls=0,writes=0;
 const context=vm.createContext({Request,Response,Headers,URL,console,AbortSignal,Date,caches:{default:{async match(k){return store.get(k.url)?.clone();},async put(k,v){writes++;store.set(k.url,v.clone());}}}});
 vm.runInContext(source,context);context.fetchJson=async()=>{calls++;if(raw instanceof Error)throw raw;return raw;};
 return {context,get calls(){return calls;},get writes(){return writes;},async request(method,query='date=2024-01-02&market=twse'){const url=new URL('https://test/api/research/market-day?'+query);const res=await context.worker.fetch(new Request(url,{method}),{});return {status:res.status,body:await res.json()};}};
}
const fields=['證券代號','證券名稱','成交股數','開盤價','最高價','最低價','收盤價'];
const rows=Array.from({length:110},(_,i)=>[String(1000+i),'name','1,000','10','12','9','11']);
const raw={stat:'OK',date:'20240102',tables:[{fields,data:rows}]};
test('GET missing or hit is cache only; POST build cache hit also avoids upstream',async()=>{
 const h=harness(raw);assert.equal((await h.request('GET')).status,404);assert.equal(h.calls,0);assert.equal((await h.request('POST')).status,200);assert.equal(h.calls,1);assert.equal(h.writes,1);assert.equal((await h.request('GET')).body.rows.length,110);assert.equal((await h.request('POST')).status,200);assert.equal(h.calls,1);
});
test('wrong-date or incomplete upstream never publishes successful coverage',async()=>{
 for(const broken of [{...raw,date:'20240103'},{...raw,tables:[{fields,data:rows.slice(0,10)}]},new Error('upstream 503'),{stat:'OK'}]){
  const h=harness(broken);assert.equal((await h.request('POST')).status,502);assert.equal(h.writes,0);assert.equal((await h.request('GET')).status,404);
 }
});
test('explicit no-trading response accepted; malformed empty response rejected',async()=>{
 const h=harness({stat:'很抱歉，沒有符合條件的資料!'});assert.equal((await h.request('POST')).body.closed,true);
 const x=harness({date:'20240102',stat:'OK',tables:[{fields,data:[]}]});assert.equal((await x.request('POST')).body.closed,true);
 const y=harness({date:'20240102',stat:'ERROR',tables:[{fields,data:[]}]});assert.equal((await y.request('POST')).status,502);
});
test('TPEx dated legacy payload preserves volume in shares and missing price as null',()=>{
 const h=harness(raw),legacy={reportDate:'113/01/02',aaData:Array.from({length:105},(_,i)=>[String(5000+i),'name','11','+1','10','12','9','10.3','7,000'])};
 const parsed=h.context.r19Snapshot(legacy,'tpex','2024-01-02');assert.equal(parsed.rows[0].volume,7000);assert.equal(parsed.rows[0].open,10);
 const x=JSON.parse(JSON.stringify(raw));x.tables[0].data[0][3]='--';assert.equal(h.context.r19Snapshot(x,'twse','2024-01-02').rows[0].open,null);
});
test('invalid date, market, future and malformed request fail before upstream',async()=>{
 const h=harness(raw);for(const q of ['market=twse','date=2024-02-30&market=twse','date=2099-01-01&market=twse','date=2024-01-02&market=invalid'])assert.equal((await h.request('POST',q)).status,400);assert.equal(h.calls,0);
});
