import test from 'node:test';
import assert from 'node:assert/strict';
import {extendTaifexCalendar2026,TAIFEX_2026_CLOSED} from '../public/r26-engine/calendar-2026.mjs';
import {physicalSessions} from '../public/r26-engine/live.mjs';
const input=['2026-10-21','2026-10-22','2026-10-27','2026-10-28','2026-10-29'];
const c=extendTaifexCalendar2026(input);
test('published 2026 exchange calendar continues into November without fake holiday sessions',()=>{
 assert.ok(c.includes('2026-11-11'));
 assert.ok(c.includes('2026-11-12'));
 for(const d of ['2026-10-23','2026-10-26','2026-12-25']){assert.ok(TAIFEX_2026_CLOSED.has(d));assert.ok(!c.includes(d))}
 assert.ok(c.every((d,i)=>i===0||d>c[i-1]));
});
test('Oct22 night is properly assigned the post-typhoon Oct27 trading day',()=>{
 const s=physicalSessions(c,'2026-10-22',Date.parse('2026-10-27T14:00:00+08:00'));
 assert.equal(s[0].start,'2026-10-22 15:00:00');
 assert.equal(s[0].date,'2026-10-27');
});
test('Nov11 night is physically Nov11, but trade-date Nov12',()=>{
 const ss=physicalSessions(c,'2026-11-10',Date.parse('2026-11-11T16:30:00+08:00'));
 const t=ss.find(s=>s.date==='2026-11-12'&&s.sid===0);
 assert.ok(t);
 assert.equal(t.start,'2026-11-11 15:00:00');
 assert.equal(t.key,'night:2026-11-11');
});
