// Usage: node scripts/backtest-vix-sar.cjs /path/to/data [start] [end]
// Input: tx0.json..tx4.json = consecutive TX history API responses; vix.json = US VIX API response.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const C=require('../public/taiex-futures-core.js'),V=require('../public/taiex-vix-sar.js');
const dir=process.argv[2];if(!dir)throw Error('Provide directory containing tx0..tx4.json and vix.json');
const sources=[];
function read(name){const bytes=fs.readFileSync(path.join(dir,name));sources.push({name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});const d=JSON.parse(bytes);if(!d.ok||!Array.isArray(d.data))throw Error(name+' is not a successful API result');return d;}
const raw=C.normalize([0,1,2,3,4].flatMap(i=>read('tx'+i+'.json').data)).data;
const rows=[...new Set(raw.map(b=>b.contract))].flatMap(contract=>C.series(raw,{session:'position',contract}));
const vix=read('vix.json'),range={start:process.argv[3]||'2021-10-19',end:process.argv[4]||'2026-10-16'};
const results=[];for(const exitDirection of ['up','down']){
 const sar={start:.01,step:.1,max:.2};const {legs,equity,...result}=V.backtest(rows,vix.data,{entry:20,exit:15,exitDirection,cost:0},sar,range);results.push({sar,...result});
}
console.log(JSON.stringify({source:vix.source,assumptions:'US prior-date close; same-day crossing AND SAR; next-open long entry/exit; calendar next-month futures with causal roll-adjusted SAR; 0 costs; forced terminal exits excluded from win rate',sources,results},null,2));
