const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../public/research-r19-core.js');
test('winrate objective changes winner, enforces sample and closure gates',()=>{
 const r=(id,win,objective,n=30,unresolved=0)=>({p:{id},result:{win,objective,n,unresolved,mean:objective}});
 const a=[r(0,50,5),r(1,80,1),r(2,100,9,1),r(3,99,8,50,1)];
 assert.equal(C.select(a,20,'winrate')[0].p.id,1);assert.equal(C.select(a,20,'balanced')[0].p.id,0);
});
test('manual weights normalize and validate; holding limit preserves split buffer',()=>{
 const p={entry:[20,30,50,0,0,0,0,0],exit:[0,0,0,-100,0,0,0,0],entryThreshold:61,exitThreshold:64,maxHold:12};
 const q=C.manualParameters(p);assert.deepEqual(q.entry,[.2,.3,.5,0,0,0,0,0]);assert.equal(q.exit[3],-1);assert.equal(q.entryThreshold,61);
 for(const bad of [{...p,maxHold:21},{...p,entry:Array(8).fill(0)},{...p,exitThreshold:NaN}])assert.throws(()=>C.manualParameters(bad));
});
const src=fs.readFileSync('src/index.js','utf8').replace('export default {','globalThis.worker = {');
test('chip endpoint calls only requested dataset, no prices; caches independent pieces and reports quota',async()=>{
 const store=new Map(),calls=[];const ctx=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,AbortSignal,caches:{default:{async match(k){return store.get(k.url)?.clone()},async put(k,r){store.set(k.url,r.clone())}}},fetch:async(u,o)=>{calls.push({u,o});const kind=new URL(u).searchParams.get('dataset');return new Response(JSON.stringify(kind==='TaiwanStockDayTrading'?{status:429}:{status:200,data:[{stock_id:'2330',date:'2024-01-02',MarginPurchaseTodayBalance:10,MarginPurchaseYesterdayBalance:9}]}));}});vm.runInContext(src,ctx);ctx.requestFinMindToken=async()=> 'secret';
 async function run(kind,method='POST'){const u=new URL(`https://test/api/research/chip-piece?code=2330&market=twse&start_date=2024-01-01&end_date=2024-12-31&kind=${kind}`);const r=await ctx.worker.fetch(new Request(u,{method}),{});return {status:r.status,j:await r.json()};}
 assert.equal((await run('margin','GET')).status,404);assert.equal(calls.length,0);assert.equal((await run('margin')).status,200);assert.equal((await run('daytrade')).j.reason,'quota');assert.equal((await run('margin')).status,200);assert.equal(calls.length,2);assert.ok(calls.every(x=>!x.u.includes('secret')&&!x.u.includes('TaiwanStockPrice')));assert.equal(calls[0].o.headers.Authorization,'Bearer secret');
});
