import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {a56Readiness,a56StatusRoute} from '../src/c26/a56-status.mjs';
const read=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const cp=read('public/r1494a/c26/a56/checkpoint-verification.json');
const coverage=read('public/r1494a/c26/data/forward-status.json');
test('real combined account checkpoint is resumable but source coverage never publishes an A56 plan',()=>{
 const s=a56Readiness(cp,coverage);
 assert.equal(s.checkpoint.as_of,'2026-11-12');assert.equal(s.checkpoint.resume_checks,6);
 assert.equal(s.source.as_of,'2026-11-13');
 assert.deepEqual(s.required_replay_dates,[{date:'2026-11-13',source_state:'available'}]);
 assert.equal(s.plan.readiness,'blocked');assert.deepEqual(s.plan.actions,[]);
 assert.equal(s.blockers.length,1);assert.equal(s.blockers[0].code,'A56_FORWARD_REPLAY_REQUIRED');
});
test('wrong lock, incomplete resume checks, missing side accounting and corrupted balances block checkpoint',()=>{
 for(const mutate of [c=>c.version='C26',c=>c.resume_checks.pop(),c=>c.paper_account.holdings[0].side_shares=undefined,c=>c.paper_account.cash_twd+=1,c=>c.resume_checks[0].passed=false,c=>c.as_of='2026-99-99',c=>c.rule.allocation=.5]){
  const c=structuredClone(cp);mutate(c);const s=a56Readiness(c,coverage);
  assert.equal(s.checkpoint,null);assert.equal(s.plan.actions.length,0);
  assert.ok(s.blockers.some(x=>x.code==='A56_CHECKPOINT_UNVERIFIED'));
 }
});
test('missing, misordered and incomplete source data do not erase verified historical account',()=>{
 for(const source of [null,{...coverage,days:[...coverage.days].reverse()},{...coverage,state:'running'}]){
  const s=a56Readiness(cp,source);assert.equal(s.checkpoint.as_of,cp.as_of);assert.equal(s.source,null);assert.deepEqual(s.plan.actions,[]);
 }
 const source=structuredClone(coverage);source.days.find(x=>x.date==='2026-11-13').state='missing';
 assert.equal(a56Readiness(cp,source).source,null);
});
test('GET route reads only sanitized assets and POST never triggers a refresh',async()=>{
 const paths=[];const env={ASSETS:{async fetch(r){paths.push(new URL(r.url).pathname);if(r.url.endsWith('latest-manifest.json'))return new Response('',{status:404});return Response.json(r.url.endsWith('checkpoint-verification.json')?cp:coverage)}}};
 const r=await a56StatusRoute(new Request('https://test/api/c26/a56/status'),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual((await r.json()).plan.actions,[]);assert.equal(paths.length,3);
 const post=await a56StatusRoute(new Request('https://test/api/c26/a56/status',{method:'POST'}),env);
 assert.equal(post.status,405);assert.equal(paths.length,3);
});
test('missing assets fail closed with no invented balances',async()=>{
 const r=await a56StatusRoute(new Request('https://test/api/c26/a56/status'),{}),s=await r.json();
 assert.equal(s.checkpoint,null);assert.equal(s.plan.readiness,'blocked');assert.deepEqual(s.plan.actions,[]);
});
