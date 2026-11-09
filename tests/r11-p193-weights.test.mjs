import test from 'node:test';
import assert from 'node:assert/strict';
import {p193Weights} from '../public/r11/p193-weights.mjs';
// Fixtures are rolling statistics measured from ORIGINAL R18-A/P193 causal archival replay.
// Reconstruct 60 prior-session values preserving all five lookback sums and 5/15 P40 pnl sums.
const cases=[
{i:120,atr:177.3,night:true,p5:28.5,p15:167.5,m8:36,m15:-246,m20:21,m30:269,m60:585,w:.8,h:0},
{i:121,atr:177.3,night:false,p5:79,p15:254,m8:147,m15:-197,m20:33,m30:280,m60:631,w:.8,h:0},
{i:150,atr:230.05,night:true,p5:-194,p15:398,m8:-202,m15:45,m20:-164,m30:-707,m60:-438,w:.6,h:0},
{i:300,atr:235.85,night:true,p5:-68,p15:217,m8:-191,m15:344,m20:373,m30:492,m60:-542,w:.5,h:0},
{i:450,atr:225.3,night:true,p5:97,p15:401,m8:-172,m15:-269,m20:-229,m30:-575,m60:-355,w:.6,h:0},
{i:700,atr:170.25,night:true,p5:98.5,p15:-228.5,m8:-77,m15:170,m20:257,m30:298,m60:415,w:.8,h:0},
{i:1100,atr:160.65,night:true,p5:252,p15:-140,m8:328,m15:190,m20:68,m30:-249,m60:60,w:.8,h:0},
{i:1500,atr:395.85,night:true,p5:140.5,p15:148.5,m8:369,m15:105,m20:-691,m30:332,m60:491,w:.5,h:0},
{i:1800,atr:289.25,night:true,p5:99,p15:-63,m8:-327,m15:85,m20:84,m30:193,m60:1150,w:.5,h:0},
{i:2100,atr:568.25,night:true,p5:972,p15:672.5,m8:1641,m15:1155,m20:787,m30:1664,m60:4074,w:.5,h:-.5},
{i:2398,atr:792.5,night:true,p5:80.5,p15:1620.5,m8:-114,m15:1136,m20:1324,m30:702,m60:1744,w:.45,h:0},
{i:2427,atr:773.1,night:false,p5:422,p15:-1621,m8:-575,m15:-1938,m20:-2330,m30:-1096,m60:-67,w:.35,h:-.3}
];
const samples=(s)=>{
 const p40=[...Array(45).fill(0),...Array(10).fill((s.p15-s.p5)/10),...Array(5).fill(s.p5/5)];
 const market=[...Array(30).fill((s.m60-s.m30)/30),...Array(10).fill((s.m30-s.m20)/10),
   ...Array(5).fill((s.m20-s.m15)/5),...Array(7).fill((s.m15-s.m8)/7),...Array(8).fill(s.m8/8)];
 return [p40,market];
};
test('P193 causal w/h matches 12 original R18-A historical states',()=>{
 for(const s of cases){const [p,m]=samples(s);const x=p193Weights(s.atr,s.night?'night':'day',p,m);
  assert.ok(Math.abs(x.w-s.w)<1e-7,'historical state '+s.i+' w '+x.w+' expected '+s.w);
  assert.ok(Math.abs(x.h-s.h)<1e-7,'historical state '+s.i+' h '+x.h+' expected '+s.h);
  assert.equal(x.paper_only,true);
 }
});
test('original P193 additional direction/ATR regimes reconstruct causally',()=>{
 const zero=Array(60).fill(0);
 const a=p193Weights(1200,'day',zero,[...Array(40).fill(0),...Array(20).fill(50)]);
 assert.ok(Math.abs(a.w-.25)<1e-7);assert.ok(Math.abs(a.h+.75)<1e-7); // -0.4 day high ATR + -0.4 m15, clipped to -(1-w)=-0.75
 const b=p193Weights(400,'day',zero,Array(60).fill(-40));
 assert.ok(Math.abs(b.w-.5)<1e-7);assert.ok(Math.abs(b.h+.3)<1e-7);
});
test('unverified incomplete inputs and nonaligned histories rejected',()=>{
 const p=Array(60).fill(0),m=Array(60).fill(0);
 assert.throws(()=>p193Weights(0,'day',p,m));
 assert.throws(()=>p193Weights(100,'unknown',p,m));
 assert.throws(()=>p193Weights(100,'day',p.slice(1),m));
 assert.throws(()=>p193Weights(100,'day',p,[...m.slice(0,59),NaN]));
});
