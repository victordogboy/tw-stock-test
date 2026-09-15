const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('research UI hotfix defaults to five calendar years instead of legacy 540 days',()=>{
  const manager=fs.readFileSync('public/finmind-token-manager.js','utf8');
  const ui=fs.readFileSync('public/research-r19-ui.js','utf8');
  assert.match(manager,/setUTCFullYear\(d\.getUTCFullYear\(\)-5\)/);
  assert.match(manager,/1827\*DAY/);
  assert.match(manager,/fixResearchDates/);
  // Keep the backend allowance large enough for 5 signal years + 180 warm-up days.
  const worker=fs.readFileSync('src/index.js','utf8');
  assert.ok((worker.match(/\/86400000>2010/g)||[]).length>=3);
  // Document the legacy initializer that R20.4 intentionally overrides after all scripts load.
  assert.match(ui,/day\(twToday,-540\)/);
});

test('saved scanner/watch names are repaired when name is missing or equals code',()=>{
  const manager=fs.readFileSync('public/finmind-token-manager.js','utf8');
  assert.match(manager,/name=code/);
  assert.match(manager,/twq_scan_state_v1100/);
  assert.match(manager,/twq_watchsnap_v16/);
  assert.match(manager,/api\/market\/universe/);
  assert.match(manager,/repairNames\(results,names\)/);
});
