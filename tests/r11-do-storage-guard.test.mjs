import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StockFuturesData} from '../src/stock-futures-download.mjs';

function store(){
 const rows=new Map();let writes=0,alarms=0;
 return {rows,get:async key=>rows.get(key),put:async(key,value)=>{rows.set(key,value);writes++;},setAlarm:async()=>{alarms++;},
 stats:()=>({writes,alarms})};
}
test('same compressed data upload is idempotent and does not reset storage expiry',async()=>{
 const storage=store(),obj=new StockFuturesData({storage},{}),date='2026-11-06';
 const upload=async body=>obj.fetch(new Request('https://private/put?date='+date+'&ttl=30',{method:'POST',body:new Uint8Array(body)}));
 const a=await upload([1,2,3,4]),first=storage.stats(),j1=await a.json();
 assert.equal(a.status,200);assert.equal(j1.unchanged,false);assert.ok(first.writes>=3);assert.equal(first.alarms,1);
 const b=await upload([1,2,3,4]),j2=await b.json();
 assert.equal(j2.unchanged,true);assert.deepEqual(storage.stats(),first);
 const c=await upload([1,2,3,5]),j3=await c.json();
 assert.equal(j3.unchanged,false);assert.equal(storage.stats().writes,first.writes+2);assert.equal(storage.stats().alarms,1);
 assert.equal(storage.rows.get('meta:'+date).sha256.length,64);
});
test('known busy loops now have minimum interval and source route is read-only',()=>{
 const dl=readFileSync(new URL('../src/stock-futures-download.mjs',import.meta.url),'utf8');
 const fc=readFileSync(new URL('../src/fc23/service.mjs',import.meta.url),'utf8');
 const pre=readFileSync(new URL('../src/r11-preopen.mjs',import.meta.url),'utf8');
 assert.ok(dl.includes('Math.max(Date.now()+5000,s.nextAllowedAt'));
 assert.ok(dl.includes('Math.max(Date.now()+5000,job.nextAllowedAt)'));
 assert.ok(fc.includes('setAlarm(Date.now()+10*60*1000)'));
 assert.ok(!fc.includes('setAlarm(Date.now()+1500)'));
 assert.ok(!/\.storage\.(put|delete|deleteAll|setAlarm)/.test(pre));
});
