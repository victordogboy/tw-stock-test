import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taiexFuturesRoute} from '../src/taiex-futures.mjs';
import {taiexVixRoute,parseFredVixCsv} from '../src/taiex-vix.mjs';
const history='https://test/api/futures/taiex/history?start_date=2026-10-01&end_date=2026-10-19';
const vix='https://test/api/futures/taiex/vix?market=us&start_date=2026-10-01&end_date=2026-10-19';
function setup(t,fetch){const old=globalThis.fetch,cache=globalThis.caches;globalThis.fetch=fetch;globalThis.caches=undefined;t.after(()=>{globalThis.fetch=old;globalThis.caches=cache;});}
test('public TX history strips browser and server credentials',async t=>{
 let called=0;setup(t,async(u,o)=>{called++;assert.equal(o.headers.Authorization,undefined);assert.ok(!u.includes('secret'));return Response.json({status:200,data:[]});});
 const r=await taiexFuturesRoute(new Request(history+'&auth=public',{headers:{Authorization:'Bearer browser-secret'}}),{FINMIND_TOKEN:'server-secret'});
 assert.equal(r.status,200);assert.equal(called,1);
});
test('FinMind token-illegal 400 becomes actionable 401 without echoing source text or retry',async t=>{
 let called=0;setup(t,async()=>{called++;return Response.json({status:400,msg:'Token is illegal. secret-data'},{status:400});});
 const r=await taiexFuturesRoute(new Request(history,{headers:{Authorization:'Bearer secret'}}));const d=await r.json();
 assert.equal(r.status,401);assert.equal(d.code,'INVALID_TOKEN');assert.equal(d.upstream_status,400);assert.ok(!JSON.stringify(d).includes('secret'));assert.equal(called,1);
});
test('FRED parser rejects missing values, wrong columns and out-of-range rows',()=>{
 assert.deepEqual(parseFredVixCsv('observation_date,VIXCLS\n2026-10-02,20\n2026-10-01,.\n2026-10-03,\n2026-10-04,-1\n2026-09-30,30','2026-10-01','2026-10-19'),[{date:'2026-10-02',value:20}]);
 assert.throws(()=>parseFredVixCsv('<html>error</html>','2026-10-01','2026-10-19'));
});
test('VIX falls back after failed and malformed Cboe responses, reports FRED actual date',async t=>{
 const calls=[];setup(t,async(u,o)=>{calls.push(u);assert.equal(o.headers.Authorization,undefined);
 if(u.includes('cdn-api'))return new Response('unavailable',{status:503});
 if(u.includes('cdn.cboe'))return new Response('<html>bad gateway</html>');
 return new Response('observation_date,VIXCLS\n2026-10-15,16.46\n2026-10-16,');});
 const r=await taiexVixRoute(new Request(vix,{headers:{Authorization:'Bearer private-token'}}));const d=await r.json();
 assert.equal(r.status,200);assert.equal(calls.length,3);assert.match(d.source,/FRED/);assert.equal(d.data.at(-1).date,'2026-10-15');
});
test('valid Cboe data does not query FRED; total failure never fabricates values',async t=>{
 let called=0;setup(t,async()=>{called++;return new Response('DATE,OPEN,HIGH,LOW,CLOSE\n10/16/2026,20,22,19,21');});
 let r=await taiexVixRoute(new Request(vix));assert.equal(r.status,200);assert.equal(called,1);assert.match((await r.json()).source,/Cboe/);
 globalThis.fetch=async()=>new Response('unavailable',{status:503});r=await taiexVixRoute(new Request(vix));assert.equal(r.status,502);assert.match((await r.json()).error,/Cboe 與 FRED/);
});
