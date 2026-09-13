const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../public/research-r19-core.js');
test('optimized standard deviation preserves sample formula and reads input linearly',()=>{
 const a=[1,2,3,7,19],m=C.mean(a);assert.equal(C.sd(a),Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)));assert.equal(C.sd([1]),null);
 let reads=0;const b=new Proxy(Array.from({length:10000},(_,i)=>i),{get(t,k){if(/^\d+$/.test(String(k)))reads++;return t[k];}});assert.ok(Number.isFinite(C.sd(b)));assert.ok(reads<=b.length*3);
});
