import test from 'node:test';
import assert from 'node:assert/strict';
import {validCloudBar,mergeCloudSnapshot,validateCloudSnapshot} from '../public/r26-engine/cloud-minute-cache.mjs';
const now=Date.parse('2026-11-11T22:10:00+08:00');
const bar=(time,sessionKey='night:2026-11-11')=>({
 timestamp_tpe:time,contract_date:'202611',session:'night',session_key:sessionKey,
 open:44511,high:44520,low:44501,close:44515,volume:210,
 source:'Yahoo WTXX6',contract_verified:true,time_convention:'minute-start'});
test('only valid named-contract TX OHLC minutes may be cached',()=>{
 assert.equal(validCloudBar(bar('2026-11-11 22:08:00'),now),true);
 assert.equal(validCloudBar(bar('2026-11-12 00:03:00'),Date.parse('2026-11-12T00:10:00+08:00')),true);
 assert.equal(validCloudBar({...bar('2026-11-11 22:08:00'),source:'FinMind TaiwanFuturesKBar'},now),false);
 assert.equal(validCloudBar({...bar('2026-11-11 22:08:00'),contract_verified:false},now),false);
 assert.equal(validCloudBar({...bar('2026-11-11 22:08:00'),low:44530},now),false);
 assert.equal(validCloudBar({...bar('2026-11-11 22:08:00'),session_key:'night:2026-11-10'},now),false);
 assert.equal(validCloudBar(bar('2026-11-11 22:12:00'),now),false);
});
test('merge keeps prior minutes when latest vendor chart carries only a few',()=>{
 const a=mergeCloudSnapshot(null,{contract:'202611',data:[bar('2026-11-11 22:05:00'),bar('2026-11-11 22:06:00')]},now);
 assert.equal(a.rows.length,2);
 const b=mergeCloudSnapshot(a,{contract:'202611',data:[bar('2026-11-11 22:06:00'),bar('2026-11-11 22:08:00')]},now);
 assert.equal(b.rows.length,3);
 assert.equal(b.latest_timestamp_tpe,'2026-11-11 22:08:00');
 assert.equal(validateCloudSnapshot(b,now).rows[0].timestamp_tpe,'2026-11-11 22:05:00');
});
test('fail closed on silently corrupted cloud assets',()=>{
 const a=mergeCloudSnapshot(null,{contract:'202611',data:[bar('2026-11-11 22:08:00')]},now);
 assert.throws(()=>validateCloudSnapshot({...a,latest_timestamp_tpe:'2026-11-11 20:00:00'},now),/MISMATCH/);
 assert.throws(()=>mergeCloudSnapshot(a,{contract:'202612',data:[bar('2026-11-11 22:08:00')]},now),/INVALID/);
});
