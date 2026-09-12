/* Pure research functions. No network, DOM, dates from the clock, or fitted global state. */
(function(root){
'use strict';
const VERSION='r19', NAMES=['setup','opportunity','entry','hold'], FEATURES=[...NAMES,...NAMES.map(x=>'d'+x[0].toUpperCase()+x.slice(1))];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1)):null;
const key=r=>r.market+':'+r.code;
const validBar=r=>r&&['open','high','low','close','volume'].every(k=>finite(r[k]))&&r.open>0&&r.low>0&&r.high>=Math.max(r.open,r.close,r.low)&&r.low<=Math.min(r.open,r.close)&&r.volume>0;
// Conservatively reject all one-price sessions; daily OHLC cannot establish queue fills.
const executable=r=>validBar(r)&&r.high>r.low;
function netReturn(buy,sell,cost){return (sell*(1-cost.slippage)*(1-cost.fee-cost.tax)/(buy*(1+cost.slippage)*(1+cost.fee))-1)*100;}
function ranked(rows,n=100){
  const seen=new Set();
  for(const r of rows){if(seen.has(key(r)))throw Error('Duplicate market/code');seen.add(key(r));if(!finite(r.volume)||r.volume<0)throw Error('Invalid ranking volume');}
  return rows.filter(r=>/^[1-9]\d{3}$/.test(r.code)&&r.volume>0).sort((a,b)=>b.volume-a.volume||key(a).localeCompare(key(b))).slice(0,n);
}
function prepare(snapshots,markets=['twse','tpex']){
  const grouped=new Map();
  for(const s of snapshots){
    if(!markets.includes(s.market))continue;
    if(!s.ok||!Array.isArray(s.rows))throw Error('Invalid snapshot');
    if(!grouped.has(s.date))grouped.set(s.date,new Map());
    if(grouped.get(s.date).has(s.market))throw Error('Duplicate snapshot');
    grouped.get(s.date).set(s.market,s);
  }
  const dates=[],daily=new Map(),series=new Map(),ranks=new Map();
  for(const [date,g] of [...grouped].sort((a,b)=>a[0].localeCompare(b[0]))){
    if(markets.some(m=>!g.has(m)))throw Error(date+': missing market snapshot');
    if(markets.every(m=>g.get(m).closed))continue;
    if(markets.some(m=>g.get(m).closed))throw Error(date+': inconsistent market calendar');
    const rows=markets.flatMap(m=>g.get(m).rows);
    if(rows.some(r=>r.date!==date||!markets.includes(r.market)))throw Error('Snapshot date/market mismatch');
    if(rows.length<100)throw Error('Full market snapshot has fewer than 100 stocks');
    dates.push(date);daily.set(date,new Map(rows.map(r=>[key(r),r])));
    const top=ranked(rows);ranks.set(date,new Map(top.map((r,i)=>[key(r),i+1])));
    for(const r of rows){if(!series.has(key(r)))series.set(key(r),[]);if(validBar(r))series.get(key(r)).push(r);}
  }
  return {dates,daily,series,ranks};
}
function controls(hist){
  const i=hist.length-1,c=hist[i].close,prev=hist[i-1].close;
  const vols=hist.slice(-6,-1).map(x=>x.volume),mv=mean(vols);
  return {retToday:(c/prev-1)*100,ret5past:(c/hist[i-5].close-1)*100,logVR:Math.log(Math.max(.01,hist[i].volume/mv)),bias20:(c/mean(hist.slice(-20).map(x=>x.close))-1)*100};
}
function sliceChips(chips,cutoff){
  const out={};for(const k of ['margin','inst','daytrade'])out[k]=(chips[k]||[]).filter(r=>r.date<=cutoff).sort((a,b)=>a.date.localeCompare(b.date));return out;
}
function chipReady(chips,earliest){
  return ['margin','inst','daytrade'].every(k=>chips[k].length&&chips[k].at(-1).date>=earliest)&&finite(chips.margin.at(-1).MarginPurchaseTodayBalance);
}
function replayStock(data,id,chips,scoreFn,options){
  const hist=data.series.get(id)||[],out=[],stats={warmup:0,missingChips:0,invalidScore:0};let previous=null;
  const minimum=90, start=data.dates.findIndex(d=>d>=options.start), lag=options.chipLag??1;
  for(let di=Math.max(1,start-1);di<data.dates.length;di++){
    const date=data.dates[di],h=hist.filter(r=>r.date<=date);
    if(h.length<minimum||h.at(-1)?.date!==date){stats.warmup++;previous=null;continue;}
    const cc=sliceChips(chips,data.dates[di-lag]||'');
    if(!chipReady(cc,data.dates[Math.max(0,di-lag-4)])){stats.missingChips++;previous=null;continue;}
    let sc;try{sc=scoreFn(h,cc);}catch(e){stats.invalidScore++;previous=null;continue;}
    if(!NAMES.every(k=>finite(sc[k])&&sc[k]>=0&&sc[k]<=100)){stats.invalidScore++;previous=null;continue;}
    const r={code:h.at(-1).code,market:h.at(-1).market,date,di,rank:data.ranks.get(date)?.get(id)||null,...sc,...controls(h),chipDate:cc.margin.at(-1).date};
    for(const name of NAMES)r['d'+name[0].toUpperCase()+name.slice(1)]=previous&&previous.di===di-1?sc[name]-previous[name]:null;
    if(di>=start)out.push(r);previous=r;
  }
  return {rows:out,stats};
}
function labels(data,r,cost){
  const id=key(r),entry=data.daily.get(data.dates[r.di+1])?.get(id),out={};
  for(const h of [1,3,5,10]){
    const exit=data.daily.get(data.dates[r.di+h+1])?.get(id);
    out['net'+h]=executable(entry)&&executable(exit)?netReturn(entry.open,exit.open,cost):null;
    out['end'+h]=data.dates[r.di+h+1]||null;
  }return out;
}
function pearson(x,y){
  if(x.length<3)return null;const mx=mean(x),my=mean(y);let a=0,b=0,c=0;
  for(let i=0;i<x.length;i++){a+=(x[i]-mx)*(y[i]-my);b+=(x[i]-mx)**2;c+=(y[i]-my)**2;}return b*c?a/Math.sqrt(b*c):null;
}
function rankValues(a){const ix=a.map((v,i)=>({v,i})).sort((x,y)=>x.v-y.v),out=[];for(let i=0;i<ix.length;){let j=i+1;while(j<ix.length&&ix[j].v===ix[i].v)j++;for(let k=i;k<j;k++)out[ix[k].i]=(i+j-1)/2;i=j;}return out;}
function correlation(rows,feature,h=5){
  const byDate=new Map();for(const r of rows)if(r.rank&&finite(r[feature])&&finite(r['net'+h])){if(!byDate.has(r.date))byDate.set(r.date,[]);byDate.get(r.date).push(r);}
  const ics=[],spreads=[];let n=0;
  for(const a of byDate.values()){
    if(a.length<20)continue;n+=a.length;
    const ic=pearson(rankValues(a.map(r=>r[feature])),rankValues(a.map(r=>r['net'+h])));if(finite(ic))ics.push(ic);
    const b=[...a].sort((x,y)=>x[feature]-y[feature]),k=Math.floor(b.length/5);
    // No arbitrary quintile spread when the cutoff is tied (e.g. constant Hold).
    if(b[k-1][feature]<b[b.length-k][feature])spreads.push(mean(b.slice(-k).map(r=>r['net'+h]))-mean(b.slice(0,k).map(r=>r['net'+h])));
  }
  return {feature,h,n,days:ics.length,ic:mean(ics),spread:mean(spreads)};
}
function solve(A,b){
  const m=A.map((r,i)=>[...r,b[i]]),n=b.length;
  for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;
    if(Math.abs(m[p][i])<1e-12)return null;[m[i],m[p]]=[m[p],m[i]];const v=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=v;
    for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}}
  return m.map(r=>r[n]);
}
function fit(rows,keys,y='net5'){
  const a=rows.filter(r=>finite(r[y])&&keys.every(k=>finite(r[k])));if(a.length<100)return null;
  const center=keys.map(k=>mean(a.map(r=>r[k]))),scale=keys.map(k=>sd(a.map(r=>r[k]))||1),p=keys.length+1,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(const r of a){const x=[1,...keys.map((k,i)=>(r[k]-center[i])/scale[i])];for(let i=0;i<p;i++){b[i]+=x[i]*r[y];for(let j=0;j<p;j++)A[i][j]+=x[i]*x[j];}}
  for(let i=1;i<p;i++)A[i][i]+=1; // Fixed ridge, never tuned on the test set.
  const beta=solve(A,b);return beta?{keys,center,scale,beta,n:a.length}:null;
}
function predict(model,r){return model.beta[0]+model.keys.reduce((s,k,i)=>s+model.beta[i+1]*(r[k]-model.center[i])/model.scale[i],0);}
function controlled(train,test){
  const base=['retToday','ret5past','logVR','bias20'];
  return FEATURES.map(feature=>{
    const valid=r=>[...base,feature,'net5'].every(k=>finite(r[k]));const tr=train.filter(valid),te=test.filter(valid);
    const a=fit(tr,base),b=fit(tr,[...base,feature]);if(!a||!b||!te.length)return {feature,n:te.length,beta:null,mseGain:null};
    const ma=mean(te.map(r=>(r.net5-predict(a,r))**2)),mb=mean(te.map(r=>(r.net5-predict(b,r))**2));
    return {feature,n:te.length,beta:b.beta.at(-1),mseGain:ma?100*(ma-mb)/ma:null};
  });
}
function split(dates,start){
  const a=dates.filter(d=>d>=start);if(a.length<160)throw Error('至少需要 160 個交易日，另加 90 日暖機資料');
  const i=Math.floor(a.length*.55),j=Math.floor(a.length*.75);
  return {train:[a[0],a[i-1]],validation:[a[i],a[j-1]],test:[a[j],a.at(-1)]};
}
function weightsScore(r,weights){
  let total=0,den=0;for(let i=0;i<FEATURES.length;i++){if(!weights[i])continue;const v=r[FEATURES[i]];if(!finite(v))return null;const z=i<4?(v-50):Math.max(-50,Math.min(50,v*2.5));total+=weights[i]*z;den+=Math.abs(weights[i]);}return den?50+total/den:50;
}
function candidates(count,seed){
  let s=Number(seed)>>>0;const random=()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296};
  const out=[{id:0,entry:[.3,.3,.4,0,0,0,0,0],exit:[0,0,0,-1,0,0,0,0],entryThreshold:65,exitThreshold:60,maxHold:10}];
  for(let i=1;i<count;i++){
    const w=()=>{let a=FEATURES.map(()=>random()<.35?0:Math.round((random()*2-1)*100)/100);if(a.every(x=>!x))a[2]=1;const z=a.reduce((s,x)=>s+Math.abs(x),0);return a.map(x=>x/z)};
    const ew=w(),xw=w();if(i<=16){ew.fill(0);ew[(i-1)%8]=i<=8?1:-1;}
    out.push({id:i,entry:ew,exit:xw,entryThreshold:[50,55,60,65,70][Math.floor(random()*5)],exitThreshold:[50,55,60,65,70][Math.floor(random()*5)],maxHold:[3,5,10,20][Math.floor(random()*4)]});
  }return out;
}
function simulate(data,rows,p,range,cost){
  const first=data.dates.indexOf(range[0]),last=data.dates.indexOf(range[1]),entryLast=last-26;
  const byId=new Map();for(const r of rows)if(r.di>=first&&r.di<=last){const id=key(r);if(!byId.has(id))byId.set(id,new Map());byId.get(id).set(r.di,r);}
  const trades=[];let unfilled=0,unresolved=0;
  for(const [id,signals] of byId){
    let pos=null,pending=null;
    for(let di=first;di<=last;di++){
      const date=data.dates[di],bar=data.daily.get(date)?.get(id),r=signals.get(di);
      if(pos&&pending?.side==='sell'){
        if(executable(bar)){trades.push({id,signalDate:pos.signalDate,entryDate:pos.date,exitSignalDate:pending.signalDate,exitDate:date,entry:pos.price,exit:bar.open,holdingDays:di-pos.di,net:netReturn(pos.price,bar.open,cost),reason:pending.reason});pos=null;pending=null;}
        else unfilled++;
      }else if(!pos&&pending?.side==='buy'){
        if(executable(bar)){pos={price:bar.open,date,di,signalDate:pending.signalDate};}else unfilled++;
        pending=null; // Entry order valid for the next exchange session only.
      }
      if(pos){
        if(!pending){const risk=r?weightsScore(r,p.exit):null;const timed=di-pos.di+1>=p.maxHold;
          if(timed||(risk!==null&&risk>=p.exitThreshold))pending={side:'sell',signalDate:date,reason:timed?'maxHold':'score'};}
      }else if(di<=entryLast&&r?.rank){
        const sc=weightsScore(r,p.entry);if(sc!==null&&sc>=p.entryThreshold)pending={side:'buy',signalDate:date};
      }
    }
    if(pos)unresolved++;
  }
  trades.sort((a,b)=>a.entryDate.localeCompare(b.entryDate)||a.id.localeCompare(b.id));
  const returns=trades.map(t=>t.net),mu=mean(returns),down=returns.length?Math.sqrt(mean(returns.map(r=>Math.min(0,r)**2))):null;
  return {n:trades.length,mean:unresolved?null:mu,closedMean:mu,win:returns.length?100*returns.filter(r=>r>0).length/returns.length:null,downside:down,objective:mu===null?null:mu-.5*down,unfilled,unresolved,trades,entrySignalEnd:data.dates[entryLast]||null};
}
function select(results,minTrades){return results.filter(x=>x.result.n>=minTrades&&!x.result.unresolved&&finite(x.result.objective)).sort((a,b)=>b.result.objective-a.result.objective||a.p.id-b.p.id);}
function eligible(rows,range){return rows.filter(r=>r.rank&&r.date>=range[0]&&r.date<=range[1]&&r.end10&&r.end10<=range[1]);}
function bootstrapCI(trades,seed=17){
  const groups=new Map();for(const t of trades){if(!groups.has(t.entryDate))groups.set(t.entryDate,[]);groups.get(t.entryDate).push(t.net);}
  const a=[...groups.values()];if(a.length<20)return null;
  // Moving blocks of 20 entry dates preserve overlapping-trade dependence better than IID rows.
  let s=seed>>>0;const rnd=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296),means=[];
  for(let b=0;b<300;b++){let total=0,n=0;for(let i=0;i<a.length;i+=20){const start=Math.floor(rnd()*a.length);for(let k=0;k<Math.min(20,a.length-i);k++)for(const r of a[(start+k)%a.length]){total+=r;n++;}}means.push(total/n);}
  means.sort((a,b)=>a-b);return [means[7],means[292]];
}
const api={VERSION,NAMES,FEATURES,finite,mean,sd,key,validBar,executable,netReturn,ranked,prepare,replayStock,labels,pearson,correlation,controlled,fit,predict,split,weightsScore,candidates,simulate,select,eligible,bootstrapCI};
if(typeof module!=='undefined')module.exports=api;root.ResearchR19=api;
})(typeof globalThis!=='undefined'?globalThis:this);
