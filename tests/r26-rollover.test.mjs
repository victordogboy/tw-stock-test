import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import zlib from 'node:zlib';
import {referenceTxMonth,activeTxMonth,officialCoverage,settlementDate} from '../public/r26-engine/contract-calendar.mjs';
import {physicalSessions,mergeRecords} from '../public/r26-engine/live.mjs';
import {assessSession} from '../public/r26-engine/session-status.mjs';
import {pendingR26OfficialDownloads} from '../public/r26-engine/backfill-plan.mjs';
const calendar=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23'];
const t=s=>Date.parse(s+'+08:00');
test('frozen 2026 contract mapping agrees with gold on every session',()=>{
 const meta=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../public/r26-engine/data/manifest.json.gz',import.meta.url))));
 for(const s of meta.sessions.filter(x=>x.date.startsWith('2026-')))assert.equal(referenceTxMonth(s.date),s.contract,s.date+' sid '+s.sid);
 assert.equal(settlementDate('2026-02-18'),'2026-02-23');
 assert.equal(referenceTxMonth('2026-12-16'),'202701');
});
test('roll at Nov17 night, never wait for Nov18 settlement close or refresh',()=>{
 assert.equal(activeTxMonth(t('2026-11-17T13:44:00'),calendar),'202611');
 assert.equal(activeTxMonth(t('2026-11-17T15:00:00'),calendar),'202612');
 assert.equal(activeTxMonth(t('2026-11-18T02:30:00'),calendar),'202612');
 assert.equal(activeTxMonth(t('2026-11-18T13:00:00'),calendar),'202612');
 assert.equal(activeTxMonth(t('2026-11-21T03:52:00'),calendar),'202612');
 const ss=physicalSessions(calendar,'2026-11-17',t('2026-11-18T14:00:00'));
 assert.deepEqual(ss.map(s=>[s.key,s.contract,s.end]),[['night:2026-11-17','202612','2026-11-18 05:00:00'],['day:2026-11-18','202612','2026-11-18 13:45:00']]);
 const jobs=pendingR26OfficialDownloads(ss,[{session_key:ss[0].key,source:'TAIFEX official ticks',contract_date:'202611'}]);
 assert.equal(jobs[0].contract,'202612');assert.equal(jobs[0].sessions.length,2);
});
const bar=(timestamp_tpe,session,contract_date='202612',source='TAIFEX official ticks')=>({timestamp_tpe,session,session_key:session==='day'?'day:2026-11-18':'night:2026-11-17',trade_date:'2026-11-18',contract_date,contract_verified:true,source,open:40000,high:40001,low:39999,close:40000});
const at=(stamp,i)=>new Date(t(stamp)+i*60000+8*3600000).toISOString().slice(0,19).replace('T',' ');
test('official expiry trade date: 300 next-month day bars and sparse CRC-verified night accepted, old 285 rejected',()=>{
 const day=Array.from({length:300},(_,i)=>bar(at('2026-11-18T08:45:00',i),'day'));
 const night=Array.from({length:677},(_,i)=>bar(at('2026-11-17T15:00:00',i),'night'));
 assert.deepEqual(officialCoverage('2026-11-18','202612',[...night,...day],calendar),{day:300,night:677});
 assert.throws(()=>officialCoverage('2026-11-18','202611',[...night,...day.slice(0,285)].map(r=>({...r,contract_date:'202611'})),calendar),/WRONG_ROLL_CONTRACT/);
 assert.throws(()=>officialCoverage('2026-11-18','202612',[...night,...day.slice(0,285)],calendar),/coverage/);
 assert.throws(()=>officialCoverage('2026-11-18','202612',day,calendar),/coverage/);
 const target=physicalSessions(calendar,'2026-11-17',t('2026-11-18T14:00:00')).at(-1);
 const old=day.map(r=>({...r,contract_date:'202611'}));
 assert.equal(assessSession(target,old,t('2026-11-18T14:00:00')).dataReady,false);
 assert.equal(assessSession(target,[...old,...day],t('2026-11-18T14:00:00')).dataReady,true);
});
test('late named-source minute cannot poison a previously CRC-verified session',()=>{
 const official=bar('2026-11-17 15:00:00','night');
 const missing=bar('2026-11-17 15:01:00','night','202612','Yahoo WTXZ6');
 assert.deepEqual(mergeRecords([official],[missing]),[official]);
});
