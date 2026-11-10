import test from 'node:test';
import assert from 'node:assert/strict';
import {p40MakePlan,p40KeyLevels,replayP40Session,P40_PARAMS} from '../public/r11/p40-shadow-engine.mjs';
const verified={signal_verified:true,bars_verified:true,contract_verified:true,calendar_verified:true,atr_verified:true,levels_verified:true};
const blank={pos:0,last_close:0,last_contract:null,has_prior:false,equity:0};
const one=(params={})=>({...verified,session:'day',contract:'202611',atr:10,signal:1,blocked:false,entrygate:false,
  levels:[70,80,90,100,120,130,140],bars:[[110,115,106,112]],...params});

test('original P40 carries 1TX across overnight gap and charges 2 sides on contract roll',()=>{
 const p={pos:1,last_close:101,last_contract:'202611',has_prior:true,equity:0};
 const a=replayP40Session(one(),p);assert.equal(a.pnl,11);assert.equal(a.held_end,1);
 const b=replayP40Session(one(),{...p,last_contract:'202610'});
 assert.equal(b.pnl,-3);assert.equal(b.held_end,1);
 const c=replayP40Session(one({blocked:true}),p);
 assert.equal(c.pnl,6.5);assert.equal(c.held_end,0);
 assert.equal(a.tradeable,false);assert.equal(a.paper_only,true);
});

test('P40 recovery 15 minutes after core stop; A-shadow never re-enters',()=>{
 const s=one({session:'night',atr:20,entrygate:true,levels:[70,80,82,100,140,180],
  bars:[[100,102,80,85],...Array.from({length:15},()=>[88,90,84,87]),[90,96,84,95]]});
 const p=replayP40Session(s,blank,'P40');
 const a=replayP40Session(s,blank,'A_SHADOW');
 assert.equal(p.pnl,-22.5);assert.equal(p.held_end,1);assert.equal(p.counts.nrecoveries,1);
 assert.equal(a.pnl,-23);assert.equal(a.held_end,0);assert.equal(a.counts.nrecoveries,0);
});

test('ambiguous same-minute breakout is canceled; short stop wins over take profit',()=>{
 const levels=[38811,39103,39402,39486,40150,40376,40483,40669,41051,41188,41564,41707,41863,41941,42783,43178,43573,43968];
 const ambiguous=replayP40Session(one({session:'day',atr:1400,signal:0,levels,
  bars:[[42331,42800,41900,42330]]}),blank);
 assert.equal(ambiguous.pnl,0);assert.equal(ambiguous.counts.namb,1);
 const actual=[16645,16728,16755,16775,16789,16811,16894,16903,16911,16951,17032,17066,17079,17082,17127,17145,17208,17271];
 const short=replayP40Session(one({session:'night',signal:0,atr:220,levels:actual,
  bars:[[16997,17040,16800,16930]]}),blank);
 assert.equal(short.pnl,-86);assert.equal(short.held_end,0);assert.equal(short.counts.nkeys,1);
});

test('key-level P40 rec plan parity with authentic 2021/2022/2026 Python source',()=>{
 const fixtures=[
  {open:17269,levels:[16921,17000,17002,17006,17023,17047,17083,17087,17134,17143,17160,17164,17174,17361,17434,17507,17580],
   expect:{entry:-17174,stop:-17268,target:-17047,adds:[-17164,-17160,-17143,-17134,-17087]}},
  {open:16997,levels:[16645,16728,16755,16775,16789,16811,16894,16903,16911,16951,17032,17066,17079,17082,17127,17145,17208,17271],
   expect:{entry:-16951,stop:-17032,target:-16811,adds:[-16911,-16903]}},
  {open:42331,levels:[38811,39103,39402,39486,40150,40376,40483,40669,41051,41188,41564,41707,41863,41941,42783,43178,43573,43968],
   expect:{entry:-41941,stop:-42362,target:-41564,adds:[-41863]}}
 ];
 for(const f of fixtures){
  const factor=Math.min(2.5,Math.max(.5,f.open/20000));
  const p=P40_PARAMS.map((v,i)=>[0,1,2,3,7,8,10,11].includes(i)?v*factor:v);
  assert.deepEqual(p40MakePlan(f.levels,f.open,1,p),f.expect);
 }
});

test('50-day key levels and all upstream causal gates fail closed',()=>{
 assert.throws(()=>p40KeyLevels(Array(49).fill({complete:true,open:100,high:110,low:90,close:100}),110),/50_COMPLETE_DAYS/);
 assert.throws(()=>p40KeyLevels(Array(50).fill({complete:false,open:100,high:110,low:90,close:100}),110),/UNVERIFIED_DAY/);
 const days=Array.from({length:50},(_,i)=>({complete:true,open:100+i,high:112+i,low:88+i,close:104+i}));
 const lv=p40KeyLevels(days,170);assert.ok(lv.length>0);assert.ok(lv.every(Number.isFinite));
 assert.throws(()=>replayP40Session({...one(),signal_verified:false},blank),/VERIFIED_FEATURES/);
 assert.throws(()=>replayP40Session({...one(),bars:[[100,99,90,101]]},blank),/BARS/);
 assert.throws(()=>replayP40Session(one(),{...blank,pos:2}),/PRIOR_STATE/);
});
