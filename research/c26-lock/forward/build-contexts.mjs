/** Technical data only. No FC23/R1494 portfolio or trading decision is used. */
import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {ingest1494,features} from '../../../src/fc23/shared.mjs';
import {contextFc23,ingestFc23Technical} from '../../../src/fc23/features.mjs';
const st=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync('public/r1494a/fc23/shared-seed.b64','utf8'),'base64')));
const raw=JSON.parse(gunzipSync(fs.readFileSync('.c26-private/forward-eod.json.gz')));
const sum=x=>x.reduce((a,b)=>a+b,0),clip=(x,a,b)=>Math.min(b,Math.max(a,x));
function capture(){
 const c=contextFc23(st),base=features(st);
 c.market=st.marketHistory.at(-1);c.marketE=[...st.marketE];c.groups=st.fc23Groups;
 for(let j=0;j<c.F.length;j++){
  const f=c.F[j],s=st.stocks[st.codes[j]],chips=s.chips||[],good=chips.length>=5&&chips.slice(-5).every(x=>x?.institutionalAvailable),vol=good?sum(chips.slice(-5).map(x=>x.volume)):0;
  const hedge=vol>0?sum(chips.slice(-5).map(x=>x.hedge))/vol:0;
  f.baseScore=base[j].score;f.hedgeBonus=Math.fround(.085*clip(hedge/.04,-1,1));f.rankHot=Math.fround(f.rs5>.20&&f.rs20<.24?-.10:0);
  f.code=st.codes[j];f.close=s.c.at(-1);f.mark=s.p;
 }
 return c;
}
const contexts=[capture()];
for(const date of Object.keys(raw.days).filter(d=>d>'2026-10-27').sort()){
 const all=JSON.parse(gunzipSync(fs.readFileSync('.c26-private/market-'+date+'.json.gz')));
 const rows=all.filter(x=>/^\d{4}$/.test(x.stock_id)).map(r=>({code:r.stock_id,name:r.stock_id,open:r.open,high:r.max,low:r.min,close:r.close,volume:r.Trading_Volume,value:r.Trading_money}));
 const inst=raw.days[date].institutional,by=new Map();
 for(const r of inst){const x=by.get(String(r.stock_id))||{foreign:0,trust:0,hedge:0,institutionalAvailable:true};const name=String(r.name),net=r.buy-r.sell;
 if(/Foreign_Investor|外資及陸資|^外資$/.test(name))x.foreign+=net;
 if(/Investment_Trust|投信/.test(name))x.trust+=net;
 if(/Dealer_Hedging|自營商.*避險/.test(name))x.hedge+=net;
 by.set(String(r.stock_id),x)}
 const price=new Map(rows.map(x=>[x.code,x]));const chips={};for(const code of st.codes){const v=by.get(code);chips[code]=v?{...v,volume:price.get(code)?.volume??0}:{institutionalAvailable:false,foreign:0,trust:0,hedge:0,volume:0}}
 ingest1494(st,{date,rows,chips});
 // Halted stock gets no executable price. Advance the calendar for its volume
 // buffer, keep only the previous mark for inventory valuation.
 for(const code of st.codes)if(!price.has(code)){const v=st.fc23Volume[code];v.push(null);if(v.length>21)v.shift();st.fc23Candle[code]=null}
 ingestFc23Technical(st,{date,rows});st.date=date;st.t++;
 const c=capture();
 for(let j=0;j<c.F.length;j++)if(!price.has(st.codes[j])){const f=c.F[j];f.base=false;f.trend=false;f.relaxed=false;f.reentry=false;f.vr=null;f.downShare=null;f.executable=false}else c.F[j].executable=true;
 contexts.push(c);
}
fs.writeFileSync('.c26-private/contexts.json',JSON.stringify(contexts));
console.log('C26_TECHNICAL_CONTEXTS',contexts.length,contexts.at(-1).date);
