// Fail the workflow if an eligible official day was missed, even if the old
// archive was valid. Verify both frozen strategies against the newest day.
import fs from 'node:fs';import z from 'node:zlib';import assert from 'node:assert/strict';
import {run,audit} from '../public/r26-engine/engine.mjs';
import {replayLive} from '../public/r26-engine/live.mjs';
import {replayTwoTxPaper} from '../public/r26-engine/two-tx-paper-live.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {referenceTxMonth,officialCoverage} from '../public/r26-engine/contract-calendar.mjs';
const root='public/r26-engine/data/',read=n=>JSON.parse(z.gunzipSync(fs.readFileSync(root+n)));
const meta=read('manifest.json.gz'),seed=read('recent.json.gz'),archive=read('verified-official-backfill.json.gz');
const calendar=extendTaifexCalendar2026(seed.calendar),local=new Date(Date.now()+8*3600000).toISOString();
const cutoff=local.slice(0,10),hour=Number(local.slice(11,13));
const expected=calendar.filter(d=>d<cutoff||d===cutoff&&hour>=14).at(-1);
assert.ok(expected&&archive.last_complete_trade_day>=expected,'OFFICIAL_ARCHIVE_STALE expected '+expected+' got '+archive.last_complete_trade_day);
const days=calendar.filter(d=>d>meta.end&&d<=expected);
for(const date of days){const rows=archive.rows.filter(r=>r.trade_date===date);officialCoverage(date,referenceTxMonth(date),rows,calendar)}
const raw=z.gunzipSync(Buffer.concat(meta.compressedParts.map(n=>fs.readFileSync(root+n))));
const bars=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4),now=Date.parse(expected+'T14:00:00+08:00');
const gold=audit(run(meta,bars,{end:meta.end}),meta);assert.equal(gold.pass,true);
const records=archive.rows.filter(r=>r.trade_date<=expected),one=replayLive(meta,bars,records,calendar,now),two=replayTwoTxPaper(meta,bars,records,calendar,now);
assert.ok(one.ready&&one.positionConfirmed,JSON.stringify(one.issues));assert.ok(two.ready&&two.positionConfirmed,JSON.stringify(two.issues));
assert.equal(one.session.contract,referenceTxMonth(expected));assert.equal(two.contract,one.session.contract);
console.log('R26_CURRENT_ARCHIVE_ACCEPTANCE',JSON.stringify({gold:gold.compared,through:expected,asOf:one.as_of,added:one.added,contract:one.session.contract,oneReady:one.ready,twoReady:two.ready}));
