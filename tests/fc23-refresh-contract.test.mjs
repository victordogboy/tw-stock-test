import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Fc23Service} from '../src/fc23/service.mjs';

const map=new Map();
let alarmCount=0,alarmAt=0;
const storage={
 async get(key){return map.get(key)},
 async put(key,value){map.set(key,value)},
 async setAlarm(at){alarmCount++;alarmAt=at},
 async deleteAlarm(){alarmAt=0}
};
const service=new Fc23Service({storage,waitUntil(){throw Error('Should schedule a durable alarm')}},{});
const post=()=>service.fetch(new Request('https://fc23.internal/fc23/refresh',{method:'POST'}));
let r=await post();assert.equal(r.status,202);
const queued=await r.json();assert.equal(queued.progress.state,'queued');
assert.equal(alarmCount,1);assert.ok(alarmAt>Date.now()-1000);
r=await service.fetch(new Request('https://fc23.internal/fc23/snapshot'));
const snapshot=await r.json();assert.equal(snapshot.running,true);
assert.equal(snapshot.progress.state,'queued');
assert.equal(snapshot.data_as_of,'2026-10-27');
await post();assert.equal(alarmCount,1,'Concurrent clicks should not restart the same job');
await service.progress({state:'blocked',phase:'2026-11-05 官方來源日線缺漏',data_as_of:'2026-11-04'});
r=await service.fetch(new Request('https://fc23.internal/fc23/snapshot'));
assert.equal((await r.json()).running,false);
await post();assert.equal(alarmCount,2,'A blocked job must be retryable');
assert.equal((await service.fetch(new Request('https://fc23.internal/fc23/refresh'))).status,405);

const html=fs.readFileSync('public/r1494a/index.html','utf8');
const switcher=fs.readFileSync('public/r1494a/strategy-switch.js','utf8');
assert.match(html,/\$\('#refresh'\)\.onclick=\(\)=>poll\(true\)/);
assert.match(switcher,/if\(refresh\)\s*\{/);
assert.match(switcher,/refresh\?30:1/);
console.log('PASS: FC23 button queues a durable refresh; normal page load stays read-only; errors are visible and retryable');
