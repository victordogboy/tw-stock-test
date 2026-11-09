import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeR11TxSessions} from '../public/r11/session-trade-date.mjs';
const bar=(when,contract='202611')=>({timestamp_tpe:when,contract_date:contract,open:27000,high:27005,low:26995,close:27002,volume:1});
test('Friday 15:00 night is MONDAY trade date after two nontrading dates',()=>{
 const x=normalizeR11TxSessions([bar('2026-11-06 15:00:00'),bar('2026-11-07 05:00:00')],
  ['2026-11-06','2026-11-09','2026-11-10'],{calendarVerified:true});
 assert.equal(x.sessions.length,1);
 assert.equal(x.sessions[0].physical_open_date,'2026-11-06');
 assert.equal(x.sessions[0].trade_date,'2026-11-09');
 assert.equal(x.sessions[0].session,'night');
 assert.equal(x.sessions[0].closing_verified,true);
 assert.equal(x.tradeable,false);
});
test('Thursday night maps to Friday; same Friday day maps to Friday; night sorts first',()=>{
 const x=normalizeR11TxSessions([bar('2026-11-05 15:00:00'),bar('2026-11-06 04:59:00'),
  bar('2026-11-06 08:45:00'),bar('2026-11-06 13:45:00')],
  ['2026-11-05','2026-11-06','2026-11-09'],{calendarVerified:true});
 assert.deepEqual(x.sessions.map(s=>s.trade_date+'|'+s.session),
  ['2026-11-06|night','2026-11-06|day']);
 assert.equal(x.sessions[1].closing_verified,true);
});
test('holiday shifts night to next real trading date and never invents calendar dates',()=>{
 const x=normalizeR11TxSessions([bar('2026-11-09 15:00:00'),bar('2026-11-10 04:59:00')],
  ['2026-11-09','2026-11-11'],{calendarVerified:true});
 assert.equal(x.sessions[0].trade_date,'2026-11-11');
 const blocked=normalizeR11TxSessions([bar('2026-11-09 15:00:00')],['2026-11-09']);
 assert.equal(blocked.sessions.length,0);
 assert.ok(blocked.errors.some(s=>s.includes('EXCHANGE_TRADING_DAY_UNKNOWN')));
});
test('original R26 sparse nights remain visible; data coverage is not falsely certified',()=>{
 const x=normalizeR11TxSessions([bar('2026-10-20 15:00:00'),bar('2026-10-21 04:59:00')],
  ['2026-10-20','2026-10-21'],{calendarVerified:true});
 assert.equal(x.sessions[0].bars,2);
 assert.equal(x.sessions[0].archive_sparse_compatible,true);
 assert.equal(x.sessions[0].data_coverage_verified,false);
 assert.equal(x.sessions[0].missing_internal_minutes,838);
 assert.equal(x.sessions[0].closing_verified,true);
});
test('05:00 R26 night and 13:45 R26 day are valid original timestamp conventions',()=>{
 const x=normalizeR11TxSessions([bar('2026-10-20 15:00:00'),bar('2026-10-21 05:00:00'),
  bar('2026-10-21 08:45:00'),bar('2026-10-21 13:45:00')],
  ['2026-10-20','2026-10-21'],{calendarVerified:true});
 assert.equal(x.errors.length,0);assert.equal(x.sessions.length,2);
 assert.ok(x.sessions.every(s=>s.closing_verified));
});
test('no future trade date or no independent official calendar fails closed',()=>{
 const x=normalizeR11TxSessions([bar('2026-11-10 15:00:00')],['2026-11-10']);
 assert.equal(x.sessions.length,0);assert.ok(x.errors.length>0);
 const y=normalizeR11TxSessions([bar('2026-11-09 15:00:00')],['2026-11-09','2026-11-10']);
 assert.equal(y.sessions[0].calendar_verified,false);
 assert.equal(y.sessions[0].data_coverage_verified,false);
});
