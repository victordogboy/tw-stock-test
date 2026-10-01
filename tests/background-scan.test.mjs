import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createScanJobClass,validateOptions,scanRoute} from '../src/scan-job.mjs';
import {createScanRuntime} from '../src/scan-runtime.mjs';
const clone=x=>x===undefined?undefined:structuredClone(x);
class Storage {
 data=new Map();alarm=null;
 async get(k){return clone(this.data.get(k))}
 async put(k,v){if(typeof k==='object'){for(const [a,b]of Object.entries(k))await this.put(a,b);return}assert.ok(JSON.stringify(v).length<128*1024,'storage value too large: '+k);this.data.set(k,clone(v))}
 async delete(k){this.data.delete(k)}
 async deleteAll(){this.data.clear();this.alarm=null}
 async setAlarm(t){this.alarm=t}
 async transaction(fn){const before=new Map(this.data);try{return await fn(this)}catch(e){this.data=before;throw e}}
}
const rows=Array.from({length:220},(_,i)=>{const c=30+i*.05+Math.sin(i/4);return {date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000}});
rows.at(-1).volume=8000000;
const date=rows.at(-1).date;
const options={selection:'holdVolumeDelta',maxStocks:4,finTopN:3,minLots:3000};
const request=(method='GET',id='12345678-1234-4321-1234-123456789012')=>new Request('https://test/api/scan/job',{method,headers:{authorization:'Bearer private-test-token'},...(method==='POST'?{body:JSON.stringify({id,options})}:{})});
function setup(){
 const storage=new Storage(),ctx={storage,blockConcurrencyWhile:fn=>fn()},calls=[];
 const api=async req=>{
  const u=new URL(req.url);calls.push({path:u.pathname,token:req.headers.get('x-finmind-token')});
  const code=u.searchParams.get('code');let j;
  if(u.pathname==='/api/intraday')j={ok:true,quote_valid:true,bar:{...rows.at(-1),last_time:'13:30:00'}};
  else if(u.pathname==='/api/history/auto')j={ok:true,data:code==='2222'?rows.map(r=>({...r,volume:1000})):rows};
  else if(u.pathname==='/api/market/universe')j={data:['1111','2222','3333','4444','5555','6666','7777'].map(code=>({code,name:code,market:'twse'}))};
  else if(u.pathname==='/api/futures/stock-list')j={codes:['2368'],source:'fixture'};
  else if(u.pathname==='/api/chips/hybrid')j={ok:true,margin:[],inst:[],daytrade:[],completeness:0};
  else throw Error(u.pathname);
  return new Response(JSON.stringify(j));
 };
 const Job=createScanJobClass(api);return {storage,ctx,calls,Job,newJob:()=>new Job(ctx,{})};
}
test('background score and original browser score match exactly',()=>{
 const ctx=vm.createContext({console:{warn(){}},document:{getElementById:()=>null},localStorage:{getItem:()=>null}});
 for(const p of ['action-score.js','dual-action.js','hold-change.js','v44-engine.js'])vm.runInContext(readFileSync('public/'+p,'utf8'),ctx);
 const script=[...readFileSync('public/scanner.html','utf8').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('function formalScore'));
 vm.runInContext(script.slice(0,script.indexOf('const WATCH_KEY=')),ctx);ctx.rows=rows;
 const runtime=createScanRuntime({options:validateOptions(options),targetDate:date},()=>{});
 assert.deepEqual(runtime.formalScore(rows),JSON.parse(JSON.stringify(vm.runInContext('formalScore(rows)',ctx))));
});
test('continues entirely via alarms without polling, survives object restarts, resumes same job, removes token',async()=>{
 const h=setup();let res=await h.newJob().fetch(request('POST'));assert.equal(res.status,202);
 const id=(await res.json()).job.id;
 const duplicate=await h.newJob().fetch(request('POST','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));assert.equal((await duplicate.json()).job.id,id);
 let steps=0;
 while((await h.storage.get('job')).phase!=='completed'&&steps++<40){assert.ok(h.storage.alarm);await h.newJob().alarm()}
 const s=await h.storage.get('job');assert.equal(s.phase,'completed');assert.equal(s.scanned,7);assert.equal(s.skipped,1);assert.equal(s.ranked.length,3);assert.equal(await h.storage.get('token'),undefined);
 const j=await (await h.newJob().fetch(request())).json();assert.equal(j.job.id,id);assert.equal(j.job.results.length,3);assert.ok(j.job.results.every(r=>r.scoreSchema==='hold-change-r21'));
 assert.ok(!JSON.stringify(j).includes('private-test-token'));assert.ok(h.calls.every(c=>c.token==='private-test-token'));
 assert.equal((await (await h.newJob().fetch(request('POST'))).json()).job.phase,'completed','same request id must not start another job');
});
test('stop during an in-flight alarm cannot resurrect or overwrite a stopped job',async()=>{
 const h=setup();await h.newJob().fetch(request('POST'));await h.newJob().alarm();
 const old=await h.storage.get('job');await h.newJob().fetch(request('DELETE'));
 old.cursor=100;assert.equal(await h.newJob().commit(old),false);
 await h.newJob().alarm();assert.equal((await h.storage.get('job')).phase,'stopped');assert.equal(await h.storage.get('token'),undefined);
});
test('expired jobs and credentials are cleaned, persistent failures terminate',async()=>{
 const h=setup();await h.newJob().fetch(request('POST'));let s=await h.storage.get('job');s.expiresAt=Date.now()-1;await h.storage.put('job',s);await h.newJob().alarm();assert.equal(h.storage.data.size,0);
 const Job=createScanJobClass(async()=>{throw Error('upstream private-test-token')});
 await new Job(h.ctx,{}).fetch(request('POST'));for(let i=0;i<5;i++)await new Job(h.ctx,{}).alarm();
 s=await h.storage.get('job');assert.equal(s.phase,'failed');assert.equal(await h.storage.get('token'),undefined);assert.ok(!JSON.stringify(s).includes('private-test-token'));
});
test('route requires unguessable capability, rejects cross-origin and invalid settings',async()=>{
 assert.equal((await scanRoute(new Request('https://test/api/scan/job'),{})).status,401);
 assert.equal((await scanRoute(new Request('https://test/api/scan/job',{headers:{'x-scan-key':'a'.repeat(64),origin:'https://evil'}}),{})).status,403);
 assert.equal((await scanRoute(new Request('https://test/api/scan/job',{headers:{'x-scan-key':'a'.repeat(64)}}),{})).status,503);
 assert.throws(()=>validateOptions({maxStocks:100000}));assert.throws(()=>validateOptions({selection:'fake'}));assert.throws(()=>validateOptions({weights:{entry:100,hold:100}}));
});
