const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const scanner=fs.readFileSync('public/scanner.html','utf8');

test('watchlist refresh resolves official names without a page-load hotfix',()=>{
  assert.match(scanner,/async function getWatchNameMap\(\)/);
  assert.match(scanner,/const nameMap=await getWatchNameMap\(\)/);
  assert.match(scanner,/nameMap\.get\(String\(code\)\)/);
  assert.doesNotMatch(scanner,/r204Boot|_r204/);
});

test('a numeric saved name is not reused as a stock name',()=>{
  assert.match(scanner,/function validStockName\(name,code\)/);
  assert.match(scanner,/!\/\^\\d\{4\}\$\/\.test\(s\)/);
  assert.match(scanner,/validStockName\(savedName,code\)/);
});
