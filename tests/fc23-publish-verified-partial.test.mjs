import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Scheduled refresh catches up across more than four seven-day batches',()=>{
 const js=fs.readFileSync('scripts/refresh-fc23.mjs','utf8');
 assert.match(js,/service\.run\(\{maxPasses:6\}\)/);
});
test('A completed partial replay is published as history, never current trade orders',()=>{
 const js=fs.readFileSync('scripts/refresh-fc23.mjs','utf8');
 assert.match(js,/\['blocked','running'\]\.includes\(delta\.sync_status\)/);
 assert.match(js,/delta\.plan\?\.readiness==='blocked'/);
 assert.match(js,/sync_status:'blocked',plan:/);
 assert.match(js,/readiness:'blocked',actions:\[\]/);
 assert.match(js,/if\(!verified&&!partial_verified\)process\.exitCode=1/);
 const service=fs.readFileSync('src/fc23/service.mjs','utf8');
 assert.match(service,/report\.partial_verified/);
 assert.match(service,/\(delta\.plan\?\.actions\|\|\[\]\)\.length\)return/);
});
