const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('public/pe-scanner.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
test('volume dates run in bounded parallel groups and use latest five despite response order',async()=>{
 let active=0,peak=0;const nodes=new Map();
 const ctx=vm.createContext({Date,Intl,AbortSignal,document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}},fetch:async url=>{
  active++;peak=Math.max(peak,active);const date=new URL('https://test'+url).searchParams.get('date');
  await new Promise(r=>setTimeout(r,date.endsWith('16')?8:1));active--;
  return {ok:true,json:async()=>({ok:true,rows:Array.from({length:100},(_,i)=>({code:String(2000+i),volume:Number(date.slice(-2))*1000}))})};
 }});
 vm.runInContext(script.slice(0,script.indexOf("['minprice','maxprice'")),ctx);
 vm.runInContext("render=()=>{};oldDates=()=>['2026-10-16','2026-10-15','2026-10-14','2026-10-13','2026-10-12','2026-10-09'];globalThis.job=buildVolumes('twse');",ctx);
 const result=await ctx.job;assert.equal(peak,3);assert.equal(result.avg.get('2000'),14);assert.equal(result.dates.length,5);assert.equal(nodes.get('progressTwse').value,5);
});
test('successful per-stock volume reuses cache without another upstream request',async()=>{
 let calls=0;const cache=new Map();const ctx=vm.createContext({Request,Response,URL,Date,AbortSignal,TextDecoder,caches:{default:{match:async k=>cache.get(k.url)?.clone(),put:async(k,v)=>cache.set(k.url,v.clone())}}});
 const src=fs.readFileSync('src/forward-pe.mjs','utf8').replace('export async function','async function');
 vm.runInContext(src+';globalThis.volumeBatch=volumeBatch;yahooFiveDayVolume=async c=>{globalThis.calls++;return {code:c,avg5Lots:2000,dates:[1,2,3,4,5]}};globalThis.calls=0;',ctx);
 const url=new URL('https://test/api/pe-screener/volume-batch?market=twse&codes=2330');
 await ctx.volumeBatch(url);const second=await (await ctx.volumeBatch(url)).json();assert.equal(ctx.calls,1);assert.equal(second.data[0].cacheHit,true);
});
