import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../public/r11/index.html',import.meta.url),'utf8');
test('seed import remains browser-local with no network POST',()=>{
 assert.ok(page.includes('id="seed-file" type="file"'));
 assert.ok(page.includes("JSON.parse(await file.text())"));
 assert.ok(page.includes('auditR11Seed(seed)'));
 assert.ok(page.includes('nextR11P193Checkpoint(seed,prior'));
 assert.ok(page.includes('FIRST_POST_CUTOFF_ORACLE_MISMATCH'));
 assert.ok(!page.includes("fetch('/api/r11/seed"));
 assert.ok(page.includes('selectedSeed=seed'));
});
test('R11 archived P40 seed is not persisted in browser localStorage or Cloudflare',()=>{
 assert.ok(!page.includes('localStorage.setItem(\'r11-seed'));
 assert.ok(!page.includes('vaultAccess(\'r11-seed'));
 assert.ok(page.includes('selectedSeed=null'));
});
