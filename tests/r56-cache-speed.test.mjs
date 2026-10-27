import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ValuationCache} from '../src/valuation-cache.mjs';
import {createScanRuntime} from '../src/scan-runtime.mjs';
import {validateOptions} from '../src/scan-job.mjs';
const summary=fs.readFileSync(new URL('../public/scan-summary.js',import.meta.url),'utf8');
test('reopen renders saved EPS with new price immediately; network failure retains saved result',async()=>{
 const storage=new Map(),row={code:'2330',close:1000};
 const page=fetch=>{const ctx=vm.createContext({Map,Date,Number,Intl,AbortSignal,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{querySelectorAll:()=>[]},fetch});vm.runInContext(summary,ctx);return ctx.TWScanSummary;};
 const first=page(async()=>({ok:true,json:async()=>({ok:true,checkedAt:Date.now(),rows:[{code:'2330',models:{A:{status:'ok',eps:50}}}]})}));
 await first.update([row]);
 const reopened=page(async()=>{throw Error('offline')});
 assert.match(reopened.cell({...row,close:1500}),/30.00 倍/);
 await reopened.update([row]);assert.match(reopened.cell(row),/20.00 倍/);assert.match(reopened.cell(row),/保留上次資料/);
});
test('durable snapshot survives instance restart; stale read returns immediately and schedules refresh; failed refresh retains data',async()=>{
 const saved={ok:true,rows:[{code:'2330'}],checkedAt:Date.now()-7*3600000},map=new Map([['snapshot',saved]]),waits=[];
 const ctx={storage:{get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)},waitUntil:p=>waits.push(p)};
 const cache=new ValuationCache(ctx,{});cache.refresh=async()=>{throw Error('offline')};
 assert.deepEqual((await (await cache.fetch(new Request('https://v/snapshot'))).json()).rows,saved.rows);assert.equal(waits.length,1);await Promise.all(waits);
 const failed=await (await cache.fetch(new Request('https://v/refresh'))).json();assert.equal(failed.refreshError,true);assert.deepEqual(map.get('snapshot'),saved);
 const restarted=new ValuationCache(ctx,{});restarted.refresh=async()=>saved;
 assert.deepEqual((await (await restarted.fetch(new Request('https://v/snapshot'))).json()).rows,saved.rows);
});
test('late-session prefilter skips history for guaranteed failures and reuses quote for candidates',async t=>{
 const RealDate=Date,at='2026-10-27T12:30:00+08:00';globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[at]))}static now(){return new RealDate(at).getTime()}};t.after(()=>globalThis.Date=RealDate);
 const hist=Array.from({length:220},(_,i)=>({date:new RealDate(Date.UTC(2026,1,1+i)).toISOString().slice(0,10),open:30,high:31,low:29,close:30,volume:4000000}));
 const calls=[];const get=async url=>{calls.push(url);return url.includes('intraday')?{quote_valid:true,bar:{date:'2026-10-27',open:30,high:31,low:29,close:30,volume:url.includes('2330')?4000000:1000,last_time:'12:30:00'}}:{data:hist}};
 const rt=createScanRuntime({targetDate:'2026-10-27',options:validateOptions({})},get);
 assert.equal((await rt.scan({code:'2317'})).row,null);assert.equal(calls.length,1);
 assert.ok((await rt.scan({code:'2330'})).row);assert.equal(calls.length,3);assert.equal(calls.filter(x=>x.includes('2330')&&x.includes('intraday')).length,1);
});
