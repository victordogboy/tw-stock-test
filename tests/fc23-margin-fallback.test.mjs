import test from 'node:test';
import assert from 'node:assert/strict';
import {finmindMargin1494} from '../src/fc23/shared.mjs';

const data=(stock_id,date)=>({date,stock_id,MarginPurchaseTodayBalance:100,ShortSaleTodayBalance:5});
function context(missing=null){
 const cache=new Map(),calls=[];
 const env={FINMIND_TOKEN:'TEST_ONLY_NOT_REAL_TOKEN',BUCKET:{
  async get(k){return cache.has(k)?{json:async()=>cache.get(k)}:null},
  async put(k,text){cache.set(k,JSON.parse(text))}
 }};
 const original=globalThis.fetch;
 globalThis.fetch=async input=>{
  const u=new URL(input),code=u.searchParams.get('data_id'),date=u.searchParams.get('start_date');
  calls.push(code);
  const rows=!code||code===missing?[]:[data(code,date)];
  return Response.json({status:200,data:rows});
 };
 return {env,calls,restore:()=>{globalThis.fetch=original}};
}
test('FinMind Free: bulk 0/3 falls back to three data_id requests and then uses cached balances',async()=>{
 const x=context();
 try{
  const codes=['1565','3078','3081'];
  const first=await finmindMargin1494(x.env,'2026-11-27','tpex',codes);
  assert.deepEqual(first.raw.data,codes.map(code=>[code,100,5]));
  assert.deepEqual(x.calls,[null,...codes]);
  const second=await finmindMargin1494(x.env,'2026-11-27','tpex',codes);
  assert.deepEqual(second.raw.data,first.raw.data);
  assert.deepEqual(x.calls,[null,...codes,null],'cached batches must skip repeated per-stock API calls');
 }finally{x.restore()}
});
test('A missing stock is not silently assigned a zero financing balance',async()=>{
 const x=context('3078');
 try{
  await assert.rejects(()=>finmindMargin1494(x.env,'2026-11-27','tpex',['1565','3078']),/3078.*不能當0/);
 }finally{x.restore()}
});
