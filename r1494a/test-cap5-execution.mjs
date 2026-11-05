import assert from 'node:assert/strict';
import {buyExecution1494,capPrice1494,CHASE_CAP1494,EXECUTION_REV1494} from './worker/r1494-engine.js';

const at=(open,high,low,level=100)=>buyExecution1494(open,high,low,level);
assert.equal(CHASE_CAP1494,.05);
assert.equal(EXECUTION_REV1494,'cap5-open-sell-v1');
assert.equal(capPrice1494(100),105);
assert.equal(capPrice1494(49.8),52.2); // crossing the 50 TWD tick boundary
assert.deepEqual([at(98,99,97).filled,at(98,99,97).type],[false,'STOP_UNFILLED']);
assert.deepEqual([at(98,102,97).filled,at(98,102,97).price],[true,100]);
assert.deepEqual([at(100,102,98).type,at(100,102,98).price],['STOP_GAP_OPEN',100]);
assert.deepEqual([at(103,110,101).type,at(103,110,101).price],['STOP_GAP_OPEN',103]);
assert.deepEqual([at(105,107,104).type,at(105,107,104).price],['STOP_GAP_OPEN',105]);
assert.deepEqual([at(108,109,106).filled,at(108,109,106).reason],[false,'no_pullback_to_cap']);
assert.deepEqual([at(108,110,105).type,at(108,110,105).price],['LIMIT_PULLBACK_CAP5',105]);
assert.deepEqual([at(108,110,101).type,at(108,110,101).price],['LIMIT_PULLBACK_CAP5',105]);
assert.equal(at(NaN,110,100).type,'INVALID_OHLC');
console.log('R1494-A cap5: tick rounding, direct-open, stop breakout, gap pullback and unfilled cases passed');
