import {test} from 'node:test';import assert from 'node:assert/strict';
import {refreshDecision} from '../research/a56-live/refresh-needed.mjs';
const sample={event:'schedule',cron:'7,22,37,52 * * * *',queue:{state:'completed'},status:{model_version:'A56',source:{as_of:'2026-11-16',next_trade_date:'2026-11-17'},model_archive:{as_of:'2026-11-16'}},now:new Date('2026-11-17T16:48:00Z')};
test('a completed old request cannot suppress a newly completed exchange day',()=>{
 assert.equal(refreshDecision(sample).reason,'next_completed_session_due');
 assert.equal(refreshDecision({...sample,now:new Date('2026-11-17T11:59:00Z')}).proceed,false);
 assert.equal(refreshDecision({...sample,now:new Date('2026-11-17T12:00:00Z')}).proceed,true);
});
test('missing status and failed HTTP results trigger source checks instead of silent skips',()=>{
 for(const x of [{queue:null},{status:null},{queue:{state:'failed'}},{queue:{state:'queued'}},{queue:{state:'running'}}])assert.equal(refreshDecision({...sample,...x}).proceed,true);
});
test('a lagging account replays even if the source was already staged by the device',()=>{
 const s=structuredClone(sample);s.status.source.as_of='2026-11-17';s.status.source.next_trade_date='2026-11-18';
 assert.equal(refreshDecision(s).reason,'account_behind_verified_source');
});
test('verified latest session and weekend/holiday exchange boundaries do not cause redundant replay',()=>{
 const s=structuredClone(sample);s.status.model_archive.as_of='2026-11-17';s.status.source={as_of:'2026-11-17',next_trade_date:'2026-11-18'};
 assert.equal(refreshDecision(s).proceed,false);
 s.now=new Date('2026-11-22T16:00:00Z');s.status.source={as_of:'2026-11-20',next_trade_date:'2026-11-23'};s.status.model_archive.as_of='2026-11-20';assert.equal(refreshDecision(s).proceed,false);
 assert.equal(refreshDecision({...s,event:'push'}).proceed,true);
});
