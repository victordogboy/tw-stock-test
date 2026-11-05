import { readFile } from 'node:fs/promises';

export async function extendBenchmarks(snapshot, state, seed, bucket, env, fetchDay) {
 const base = JSON.parse(await readFile(new URL('../worker/benchmark49.json', import.meta.url)));
 const codes = Object.keys(base);
 const offset = snapshot.curves.market.length;
 const extra = snapshot.dates.slice(offset);
 const market = state.benchmarkMarket??[];
 const count=extra.length-market.length;
 if(count>0&&count<=state.marketHistory.length)market.push(...state.marketHistory.slice(-count));
 snapshot.curves.market.push(...market);
 state.benchmarkMarket=market;
 const cached=state.benchmark49;
 const curve=cached?.curve??[];
 const prices=cached?.prices??Object.fromEntries(codes.map(code=>[code,seed.stocks[code].p]));
 const notes=cached?.notes??{};
 for (const date of extra.slice(curve.length)) {
  try {
   const stored=await bucket.get('r1494-a/daily/'+date+'.json');
   const day=stored?await stored.json():await fetchDay(date,env,seed);
   if(day.closed)break;
   const rows=new Map(day.rows.map(row=>[row.code,row.close]));
   for(const [code,close] of Object.entries(day.benchmarkCloses||{}))rows.set(code,close);
   const missing=codes.filter(code=>!(rows.get(code)>0));
   const verified=new Set((day.suspensions||[]).filter(x=>x.type==='confirmed suspension').map(x=>x.code));
   if(missing.filter(code=>!verified.has(code)).length>2)break;
   for(const code of codes)if(rows.get(code)>0)prices[code]=rows.get(code);
   if(missing.length)notes[date]=missing;
   curve.push(codes.reduce((sum,code)=>sum+Math.fround(Math.fround(prices[code])/base[code]),0)/codes.length);
  } catch(e) {
   console.warn('49 檔基準待補 '+date+': '+e.message);
   break;
  }
 }
 snapshot.curves.old49.push(...curve);
 snapshot.benchmarkCarry=notes;
 state.benchmark49={curve,prices,notes};
}
