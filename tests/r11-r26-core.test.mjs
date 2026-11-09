import test from 'node:test';
import assert from 'node:assert/strict';
import {coreR26FromFeatures,tower3Update} from '../public/r11/r26-core-replay.mjs';
// Extracted independently by executing ORIGINAL R26 startup.py on the pinned 2021–2026 dataset.
// Covers: short, R13 bounce-long, short block, shadow pause, latest end-state.
const keys='index session atr20 prevclose ema20 ema150 ema50 ema50slope3 mom3 mom5 mom10 prior_ret rsi14 atr5over20 dist50 slope50 dd10 atr20slope prior_benchmark_pnl prior_session_tower3 shadow_last4 r10_expected core_signal_expected blocked_expected short_guard_expected add_expected'.split(' ');
const rows=[
[552,'day',260.95,17516,18039.83772727715,17530.213274716807,17970.267872929773,-.07972684834063247,-2.6595133167273426,-2.7859743245832536,-3.1461965893849397,-2.015711822188159,37.733938742155786,1.258478635753976,-1.7408234256745474,-.07972684834063247,-3.119371527112474,.13259548611111094,125,-1,[11,134.5,-169,-179],-1,-1,false,false,false],
[578,'day',309.4,16933,17452.81944578129,17497.044535911667,17695.70733524213,-.28097397500912613,-.9276018099547512,-.04201680672268908,-2.944408532643827,.16483516483516486,38.680686830713924,1.0433096315449257,-2.4651174377573644,-.28097397500912613,-3.332255979314803,.21095890410958895,377,1,[-192,210.5,-218.5,287.5],0,1,false,false,true],
[643,'night',241.9,16684,16832.666407161287,17351.587393535174,17180.152059342265,-.32662691801901006,.4175279040926002,1.649441918147995,-1.5998346424142207,.6821000413393964,43.71353346457242,.8011575031004547,-2.0510626678059722,-.32662691801901006,-2.2240595287308804,.14157621519584707,-66,1,[3,-52,208,67],-1,-1,true,true,false],
[2523,'night',1009.6,33559,33461.74574293669,29075.690485338266,32300.681751803735,.19878092579543524,-.23375594294770205,.24167987321711568,-.14362123613312203,.005942947702060222,52.179467495641624,.7387083993660856,1.2463532569297393,.19878092579543524,-1.0112916006339143,.2622366693755078,-223,-1,[-656.5,-347.5,-651.5,0],1,1,true,false,false],
[2814,'day',773.1,46992,47758.937266774024,42941.75360795569,46949.059988778805,-.037572919807663266,-.32337343163885657,-2.328288707799767,-3.9684387530720473,.7864441857456991,45.33758322185716,1.3555814254300866,.05554263513283555,-.037572919807663266,-4.042167895485707,.05621968713709946,490,1,[-307,489,-162,490],1,1,false,false,false]
].map(row=>Object.fromEntries(keys.map((k,i)=>[k,row[i]])));
test('R26 core gates match original archived long/short/bounce/pause fixtures',()=>{
 for(const x of rows){
  const y=coreR26FromFeatures(x);
  assert.equal(y.r10,x.r10_expected,'r10 '+x.index);
  assert.equal(y.raw_signal,x.core_signal_expected,'original core '+x.index);
  assert.equal(y.blocked,x.blocked_expected,'pause '+x.index);
  assert.equal(y.short_guard,x.short_guard_expected,'short guard '+x.index);
  assert.equal(y.add,x.add_expected,'tower bounce '+x.index);
  assert.equal(y.core_signal,y.blocked?0:y.raw_signal,'effective core '+x.index);
  assert.equal(y.tradeable,false);
 }
});
test('tower can only update from completed session data and prior THREE session highs/lows',()=>{
 assert.equal(tower3Update(0,120,[100,108,111],[90,95,100]),1);
 assert.equal(tower3Update(1,87,[110,115,120],[90,92,95]),-1);
 assert.equal(tower3Update(1,100,[110,115,120],[90,92,95]),1);
 assert.throws(()=>tower3Update(0,100,[110,120],[80,90]));
});
test('absent original A shadow, R26 indicators or tower fail closed',()=>{
 const x=rows[0];for(const overrides of [{shadow_last4:[]},{prior_session_tower3:null},{atr20:0},{ema150:null},{mom5:NaN}]){
  assert.throws(()=>coreR26FromFeatures({...x,...overrides}));
 }
});
