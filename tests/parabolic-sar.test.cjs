const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SAR = require('../public/parabolic-sar.js');

const bar = (close, high = close + 1, low = close - 1) => ({ close, high, low });

test('SAR follows the candle timeline with no future lookahead', () => {
  const history = [bar(10), bar(11), bar(12), bar(13), bar(14)];
  const before = SAR.calculate(history, 0.05);
  const withFuture = SAR.calculate(history.concat([bar(2, 3, 1)]), 0.05);
  assert.equal(before.length, history.length);
  assert.deepEqual(withFuture.slice(0, history.length), before);
  assert.equal(before[0], null);
  assert.equal(before[4].rising, true);
  assert.equal(withFuture[5].rising, false);
  assert.equal(withFuture[5].reversal, true);
});

test('AF increments on new extremes, resets on reversal, and is capped at 0.20', () => {
  const rising = Array.from({ length: 18 }, (_, i) => bar(20 + i, 21 + i, 19 + i));
  const values = SAR.calculate(rising, 0.05);
  assert.equal(values[1].af, 0.05);
  assert.equal(values[2].af, 0.1);
  assert.equal(values[3].af, 0.15);
  assert.ok(values.every(v => !v || v.af <= 0.2000001));
  const reversed = SAR.calculate([...rising, bar(2, 3, 1)], 0.05).at(-1);
  assert.equal(reversed.rising, false);
  assert.equal(reversed.af, 0.05);
});

test('SAR uses previous two lows/highs as hard bounds', () => {
  const up = SAR.calculate([bar(10, 11, 9), bar(11, 12, 10), bar(12, 13, 11)], 0.05);
  assert.equal(up[2].value, 9);
  const down = SAR.calculate([bar(12, 13, 11), bar(11, 12, 10), bar(10, 11, 9)], 0.05);
  assert.equal(down[2].value, 13);
});

test('AF input is validated and any invalid bar yields no misleading SAR values', () => {
  assert.equal(SAR.normalizeAf(0.05), 0.05);
  assert.equal(SAR.normalizeAf(0.007), 0.007);
  assert.equal(SAR.normalizeAf('99'), SAR.DEFAULT_AF);
  assert.equal(SAR.normalizeAf(-1), SAR.DEFAULT_AF);
  assert.deepEqual(SAR.calculate([bar(10), { close: 11, high: NaN, low: 10 }]), [null, null]);
});

test('detail chart includes SAR controls, external script and Canvas overlay', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/detail.html'), 'utf8');
  for (const label of ['parabolic-sar.js', 'sarEnabled', 'sarAcceleration',
    'sarStatusPill', 'TWParabolicSAR.calculate', 'sarValues.forEach']) {
    assert.ok(html.includes(label), 'missing ' + label);
  }
});
