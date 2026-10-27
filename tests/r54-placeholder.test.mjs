import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createScanRuntime} from '../src/scan-runtime.mjs';
import {validateOptions} from '../src/scan-job.mjs';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8').replace(/export default\s*\{/,'globalThis.worker = {');
test('Yahoo flat zero-volume placeholder cannot erase all Action delta candidates',async()=>{
 const data=Array.from({length:220},(_,i)=>({date:new Date(Date.UTC(2026,1,1+i)).toISOString().slice(0,10),open:30,high:31,low:29,close:30,volume:4000000}));
 data.push({date:'2026-10-23',open:30,high:30,low:30,close:30,volume:0});
 const ctx=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,Intl,Date,AbortSignal,setTimeout,clearTimeout,
 fetch:async()=>new Response(JSON.stringify({chart:{result:[{timestamp:data.map(r=>Date.parse(r.date+'T01:00:00Z')/1000),indicators:{quote:[Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,data.map(r=>r[k])]))]}}]}}))});
 vm.runInContext(source,ctx);
 const cleaned=await vm.runInContext("fetchYahooHistory('2330','twse','2026-01-01','2026-10-27')",ctx);
 assert.equal(cleaned.data.length,220);
 const q={bar:{date:'2026-10-27',open:30,high:31,low:29,close:30,volume:5000000,last_time:'13:30:00'},quote_valid:true};
 const make=h=>createScanRuntime({targetDate:q.bar.date,options:validateOptions({selection:'buyActionDelta'})},async u=>u.includes('/intraday')?q:{data:h});
 const before=make(data),broken=await before.scan({code:'2330'});assert.equal(before.selectionScore(broken.row),null);
 const after=make(cleaned.data),fixed=await after.scan({code:'2330'});assert.equal(fixed.error,null);assert.equal(fixed.row.holdVolumeRatio,1.25);assert.equal(after.selectCandidates([fixed.row]).length,1);
 assert.equal(vm.runInContext('isYahooPlaceholderBar({open:30,high:31,low:29,close:30,volume:0})',ctx),false);
 assert.equal(vm.runInContext('isYahooPlaceholderBar({open:30,high:30,low:30,close:30,volume:null})',ctx),false);
});
