// TX 18 key-level optimizer (2026-10-31). Browser-worker edition.
// Port of research engine.py; 1-minute OHLC, stop-first ambiguous bars, settled MDD.
const NAMES=['RangeLimit','TightRange','AddGap','ExitGap','ProfitRatio','ProfitDiv','ShortMinRR','ShortMinRange','ShortMinTarget','LongMinRR','LongMinRange','LongMinTarget'];
const DEFAULT=[200,100,50,50,2,2,.5,200,60,.5,200,60];
const BOUNDS=[[0,100,150,200,250,350,500],[0,50,75,100,125,150,200],[0,25,40,50,65,80,100],[0,25,40,50,65,80,100],[0,1,1.5,2,2.5,3,4],[1,1.5,2,2.5,3,4],[0,.25,.5,.75,1,1.5,2],[0,100,150,200,250,350,500],[0,30,45,60,90,120,180],[0,.25,.5,.75,1,1.5,2],[0,100,150,200,250,350,500],[0,30,45,60,90,120,180]];
const PCT={0:[0,.2,.35,.5,.75,1,1.5,2],1:[0,.1,.2,.3,.45,.6,.8],2:[0,.035,.06,.1,.15,.25,.4],3:[0,.05,.1,.15,.25,.5,1,3,5],7:[0,.2,.3,.45,.65,1,1.5],8:[0,.075,.12,.18,.25,.35,.5],10:[0,.2,.3,.45,.65,1,1.5],11:[0,.075,.12,.18,.25,.35,.5]};
const round=x=>Math.floor(x+.5),flo=Math.floor;
const dateNum=s=>Math.floor(Date.parse(s.slice(0,10)+'T00:00:00Z')/86400000);
let sessions=null,busy=false,abort=false;
const emit=(type,data={})=>{if(typeof self!=='undefined' && self.postMessage) self.postMessage({type,...data});};
const sleep=()=>new Promise(r=>setTimeout(r,0));
function levelsFor(history,op){
 let n=50,o=0,h=0,l=0,ho=0,lo=0,ho2=0,lo2=0;
 for(const s of history){o+=s.open;h+=s.high;l+=s.low;let a=s.high-s.open,b=s.low-s.open;ho+=a;lo+=b;ho2+=a*a;lo2+=b*b}
 const avg=o/n,h0=round(flo(op-avg)+h/n),l0=round(flo(op-avg)+l/n),ah=flo(Math.sqrt(Math.max(0,(ho2-ho*ho/n)/(n-1)))),al=flo(Math.sqrt(Math.max(0,(lo2-lo*lo/n)/(n-1))));
 const last=history[49],a=last.high,b=last.low,c=last.close,d=a-b,cdp=flo((a+b+2*c)/4);
 return [h0,h0+ah,h0+2*ah,h0+3*ah,l0,l0-al,l0-2*al,l0-3*al,cdp,flo(cdp+d),flo(2*cdp-b),flo(cdp-d),flo(2*cdp-a),flo(b+d*1.382),flo(b+d*1.191),flo((a+b)/2),flo(a-d*1.191),flo(a-d*1.382)];
}
function finalize(groups){
 let out=[],skipped=0,raw=0;groups.sort((a,b)=>a.start.localeCompare(b.start));
 for(const s of groups){raw+=s.n;let min=s.start.slice(11,16),expected=s.isnight?840:300;
  if((s.isnight&&min!=='15:00')||(!s.isnight&&min!=='08:45')||s.n<(s.isnight?600:240)||s.multi){skipped++;continue}
  s.bars=Float32Array.from(s.tmp);delete s.tmp;
  s.quality=s.n/expected;out.push(s);
 }
 const prior=[];let eligible=[],lastContract='',lastClose=0;
 for(const s of out){
  if(prior.length===50){s.levels=levelsFor(prior,s.open);s.bh=(s.close-s.open)+(lastContract===s.contract?s.open-lastClose:0);eligible.push(s)}
  if(!s.isnight){prior.push(s);if(prior.length>50)prior.shift()}
  lastContract=s.contract;lastClose=s.close;
 }
 return {sessions:eligible,sourceSessions:groups.length,skipped:skipped,raw:raw};
}
async function importCSV(blob){
 const reader=blob.stream().getReader(),decoder=new TextDecoder(),groups=[];let rest='',count=0,last=null;
 function feed(line){if(!line)return;const p=line.split(',');if(p.length<9||p[0]==='timestamp')return;
  const ts=p[0],td=p[1],session=p[2],contract=p[3],op=+p[4],hi=+p[5],lo=+p[6],cl=+p[7];
  if(!((session==='day'||session==='night')&&Number.isFinite(op)&&hi>=Math.max(op,lo,cl)&&lo<=Math.min(op,hi,cl)))return;
  const key=td+'|'+session;
  if(!last||last.key!==key){last={key,tradeDate:td,start:ts,isnight:session==='night',contract,open:op,high:hi,low:lo,close:cl,n:0,tmp:[],multi:false};groups.push(last)}
  if(last.contract!==contract){last.multi=true;return}
  last.high=Math.max(last.high,hi);last.low=Math.min(last.low,lo);last.close=cl;last.end=ts;last.n++;last.tmp.push(op,hi,lo,cl);count++;
 }
 while(true){const {done,value}=await reader.read();if(done)break;rest+=decoder.decode(value,{stream:true});let start=0,i;
  while((i=rest.indexOf('\n',start))>=0){feed(rest.slice(start,i).trim());start=i+1}
  rest=rest.slice(start);
  if(count%50000<2000){emit('loadProgress',{rows:count,source:blob.size}) ;await sleep()}
 }
 feed(rest.trim());const pack=finalize(groups);emit('loadProgress',{rows:pack.raw,source:blob.size,stage:'finished'});return pack;
}
function oneSession(s,p,cost,details=false){
 const op=s.open,lv=Array.from(new Set(s.levels)).sort((a,b)=>a-b),above=lv.filter(x=>x>op),below=lv.filter(x=>x<=op).reverse();
 const empty=[null,null];if(!above.length||!below.length)return empty;
 const span=above[0]-below[0],result=[];
 for(let ixDir=0;ixDir<2;ixDir++){
  const dir=ixDir===0?1:-1,fwd=dir===1?above:below,back=dir===1?below:above;
  const minrange=p[dir===1?10:7],minrr=p[dir===1?9:6],mintarget=p[dir===1?11:8];
  if(span<minrange){result.push(null);continue}
  const tight=span<p[1]&&fwd.length>1,skip=tight||(dir===1&&p[0]>0&&span>p[0]);let ix=skip&&fwd.length>1?1:0;
  if(ix>=fwd.length){result.push(null);continue}
  let entry=fwd[ix],stopbase=ix?fwd[0]:back[0],halved=p[0]>0&&Math.abs(entry-stopbase)>p[0];
  let stop=halved?round((entry+stopbase)/2):stopbase;
  if(dir*(entry-stop)<=0){result.push(null);continue}
  let adds=[],j=ix+1;
  while(j<fwd.length&&Math.abs(fwd[j]-fwd[j-1])<p[2]){adds.push(fwd[j]);j++}
  while(j+1<fwd.length&&Math.abs(fwd[j+1]-fwd[j])<p[3]){adds.push(fwd[j]);j++}
  let target=NaN;
  if(j<fwd.length){while(j+1<fwd.length&&dir*(fwd[j]-entry)<mintarget)j++;target=fwd[j]}
  if(tight){
   let e0=fwd[0],st0=back[0];if(p[0]>0&&Math.abs(e0-st0)>p[0])st0=round((e0+st0)/2);
   let j0=1,add0=[];
   while(j0<fwd.length&&Math.abs(fwd[j0]-fwd[j0-1])<p[2]){add0.push(fwd[j0]);j0++}
   while(j0+1<fwd.length&&Math.abs(fwd[j0+1]-fwd[j0])<p[3]){add0.push(fwd[j0]);j0++}
   if(j0<fwd.length){
    while(j0+1<fwd.length&&dir*(fwd[j0]-e0)<mintarget)j0++;
    const t0=fwd[j0];let prof0=dir*(t0-e0),risk0=dir*(e0-st0);
    for(const add of add0){prof0+=dir*(t0-add);risk0+=dir*(add-st0)}
    if(risk0>0&&p[4]>0&&p[5]>1&&prof0>p[4]*risk0){let maybe=round(e0+(t0-e0)/p[5]);if(dir*(maybe-e0)>0){entry=maybe;target=t0;stopbase=e0;stop=p[0]>0&&Math.abs(entry-stopbase)>p[0]?round((entry+stopbase)/2):stopbase;adds=[];halved=true}}
   }
  }
  let hasTarget=Number.isFinite(target),profit=hasTarget?dir*(target-entry):0,risk=dir*(entry-stop);
  for(const add of adds){risk+=dir*(add-stop);if(hasTarget)profit+=dir*(target-add)}
  if(hasTarget&&!halved&&!tight&&profit<risk){stop=round((entry+stopbase)/2);risk=dir*(entry-stop);for(const add of adds)risk+=dir*(add-stop)}
  if(hasTarget&&risk>0&&p[4]>0&&p[5]>1&&profit>p[4]*risk){let cand=round(entry+(target-entry)/p[5]);if(dir*(cand-entry)>0){target=cand;adds=adds.filter(x=>dir*(target-x)>0)}}
  if(dir===1&&(!hasTarget||dir*(target-entry)<mintarget)){result.push(null);continue}
  if(hasTarget){profit=dir*(target-entry);risk=dir*(entry-stop);for(const add of adds){profit+=dir*(target-add);risk+=dir*(add-stop)}if(risk<=0||profit<minrr*risk){result.push(null);continue}}
  else if(minrr>0){result.push(null);continue}
  let positions=[],event=0,exitX=0,ambig=0,entryBar=-1,exitBar=-1;
  const se=entry*dir,ss=stop*dir,st=target*dir,b=s.bars;
  for(let bi=0;bi<b.length;bi+=4){let oo=b[bi]*dir,hh=Math.max(b[bi]*dir,b[bi+1]*dir,b[bi+2]*dir,b[bi+3]*dir),ll=Math.min(b[bi]*dir,b[bi+1]*dir,b[bi+2]*dir,b[bi+3]*dir);
   if(!positions.length){if(hh<se)continue;positions.push(Math.max(se,oo));entryBar=bi/4;if(ll<=ss)ambig++}
   if(ll<=ss){if(hasTarget&&hh>=st)ambig++;exitX=Math.min(ss,oo);event=2;exitBar=bi/4;break}
   if(hasTarget&&hh>=st&&bi/4>entryBar){exitX=Math.max(st,oo);event=1;exitBar=bi/4;break}
   for(const add of adds){let v=add*dir;if(hh>=v&&!positions.includes(v)){positions.push(Math.max(v,oo))}}
   if(hasTarget&&hh>=st&&bi/4===entryBar)ambig++;
  }
  if(!positions.length){result.push(null);continue}
  if(event===0){exitX=b[b.length-1]*dir;exitBar=b.length/4-1}
  const gross=positions.reduce((sum,v)=>sum+(exitX-v),0),net=gross-positions.length*cost;
  result.push({net,gross,win:net>0?1:0,entry,stop,target:hasTarget?target:null,exit:exitX*dir,event,contracts:positions.length,ambiguous:ambig,entryBar,exitBar,direction:ixDir===0?'long':'short'});
 }
 return result;
}
function run(data,raw,opts,detail=false){
 let start=dateNum(opts.start),end=dateNum(opts.end),sel=opts.session||'both',cost=Number(opts.cost??2),pct=opts.unit==='percent',trades=[],sessionsOut=[];
 let eq=0,peak=0,dd=0,win=0,n=0,gross=0,long=0,short=0,bh=0,bheq=0,bhpeak=0,bhdd=0,count=0,years=new Map(),months=new Map();
 for(const s of data){const d=dateNum(s.start);if(d<start||d>end||(sel==='day'&&s.isnight)||(sel==='night'&&!s.isnight))continue;
  let p=raw.slice();if(pct)for(let j of [0,1,2,3,7,8,10,11])p[j]=p[j]*s.open/100;
  const pair=oneSession(s,p,cost,detail);let ret=0,trn=0,wins=0;
  for(const t of pair){if(!t)continue;trn++;wins+=t.win;ret+=t.net;gross+=t.gross;if(t.direction==='long')long+=t.net;else short+=t.net;
   if(detail)trades.push({date:s.start.slice(0,10),trade_date:s.tradeDate,session:s.isnight?'night':'day',direction:t.direction,entry:t.entry,stop:t.stop,target:t.target,exit:t.exit,contracts:t.contracts,net_pts_lots:t.net,exit_reason:['close','target','stop'][t.event],ambiguous_bars:t.ambiguous});
  }
  count++;n+=trn;win+=wins;eq+=ret;dd=Math.max(dd,peak-eq);peak=Math.max(peak,eq);bh+=s.bh;bheq+=s.bh;bhdd=Math.max(bhdd,bhpeak-bheq);bhpeak=Math.max(bhpeak,bheq);
  if(detail){sessionsOut.push({date:s.start.slice(0,10),net:ret,bh:s.bh});for(let [m,k] of [[years,s.start.slice(0,4)],[months,s.start.slice(0,7)]]){let row=m.get(k)||{date:k,net:0,bh:0,entries:0,wins:0,eq:0,peak:0,mdd:0};row.net+=ret;row.bh+=s.bh;row.entries+=trn;row.wins+=wins;row.eq+=ret;row.mdd=Math.max(row.mdd,row.peak-row.eq);row.peak=Math.max(row.peak,row.eq);m.set(k,row)}}
 }
 const fix=x=>Math.round(x*10)/10;
 let res={net_pts_lots:fix(eq),max_dd_pts_lots:fix(dd),trades:n,wins:win,win_rate_pct:n?Math.round(win/n*10000)/100:0,gross_pts_lots:fix(gross),long_pts_lots:fix(long),short_pts_lots:fix(short),BH_pts_one_contract:fix(bh),BH_mdd_pts_one_contract:fix(bhdd),sessions:count,cost_points_per_contract_roundtrip:cost};
 if(!detail)return res;
 const grouped=m=>Array.from(m.values()).map(x=>({date:x.date,net_pts_lots:fix(x.net),bh_pts_1lot:fix(x.bh),mdd_closed_session_pts_lots:fix(x.mdd),trades:x.entries,win_rate_pct:x.entries?Math.round(x.wins/x.entries*10000)/100:0}));
 const curves={strategy:[0],benchmark:[0]};let xx=0,yy=0,step=Math.max(1,Math.floor(sessionsOut.length/220));
 for(let i=0;i<sessionsOut.length;i++){xx+=sessionsOut[i].net;yy+=sessionsOut[i].bh;if(i%step===0||i===sessionsOut.length-1){curves.strategy.push(fix(xx));curves.benchmark.push(fix(yy))}}
 return {summary:res,yearly:grouped(years),monthly:grouped(months),trades,chart:curves};
}
function score(r){return r.trades<35?-1e8+r.trades:r.net_pts_lots-.75*r.max_dd_pts_lots-Math.max(0,100-r.trades)*15}
function random(seed){let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
async function optimize(opts){const trials=Math.max(100,Math.min(12000,opts.trials|0)),data=sessions;
 const valid=data.filter(s=>dateNum(s.start)>=dateNum(opts.start)&&dateNum(s.start)<=dateNum(opts.end)&&(opts.session==='both'||(opts.session==='night')===s.isnight));if(valid.length<80)throw Error('最佳化至少需要 80 個有效盤別');
 const rng=random(20261031),seen=new Set(),leader=[];let best=null,bestSc=-Infinity,attempts=0,done=0;
 const useModes=[false,true];
 for(const pct of useModes){for(let i=0;i<Math.floor(trials/2);i++){
   if(abort)throw Error('使用者已取消');
   let grids=BOUNDS.map((v,j)=>pct&&PCT[j]?PCT[j]:v),p;
   if(i===0&&!pct)p=DEFAULT.slice();
   else if(i<10&&!pct){p=DEFAULT.slice();let j=[9,10,11][Math.floor((i-1)/3)%3];p[j]=BOUNDS[j][Math.min((i-1)%3+1,BOUNDS[j].length-1)]}
   else if(i>trials*.35*.7&&leader.length&&rng()<.84){p=leader[Math.floor(rng()*Math.min(25,leader.length))].p.slice();let mods=1+Math.floor(rng()*3);for(let a=0;a<mods;a++){let k=Math.floor(rng()*12),idx=grids[k].reduce((best,v,j)=>Math.abs(v-p[k])<Math.abs(grids[k][best]-p[k])?j:best,0);idx=Math.min(grids[k].length-1,Math.max(0,idx+([-3,-2,-1,1,2,3][Math.floor(rng()*6)])));p[k]=grids[k][idx]}}
   else p=grids.map(g=>g[Math.floor(rng()*g.length)]);
   const key=(pct?'p':'n')+p.join('/');if(seen.has(key))continue;seen.add(key);
   const result=run(valid,p,{...opts,unit:pct?'percent':'points'}),sc=score(result);done++;
   const rec={p,unit:pct?'percent':'points',sc,result};if(leader.length<30||sc>leader[leader.length-1].sc){leader.push(rec);leader.sort((a,b)=>b.sc-a.sc);if(leader.length>30)leader.pop()}
   if(sc>bestSc){bestSc=sc;best=rec}
   if(done%25===0){emit('optProgress',{done,requested:trials,bestScore:Math.round(bestSc),bestNet:best.result.net_pts_lots});await sleep()}
 }}
 if(!best)throw Error('搜尋無有效參數');
 return {selected_range:{start:opts.start,end:opts.end,session:opts.session},trials_evaluated:done,trials_requested:trials,cost:opts.cost,best_params:Object.fromEntries(NAMES.map((k,i)=>[k,best.p[i]])),best_distance_unit:best.unit,best_result:best.result,top10:leader.slice(0,10).map(v=>({score:Math.round(v.sc),net_pts_lots:v.result.net_pts_lots,mdd_pts_lots:v.result.max_dd_pts_lots,unit:v.unit,params:Object.fromEntries(NAMES.map((k,i)=>[k,v.p[i]]))})),in_sample_warning:'此結果只代表所選日期範圍內的樣本內搜尋，不是樣本外驗證。'};
}
async function setData(pack, persist){sessions=pack.sessions;emit('loaded',{count:sessions.length,raw:pack.raw,skipped:pack.skipped,fromCache:!persist,first:sessions[0]?.start,last:sessions[sessions.length-1]?.end});if(persist){const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put({key:'TX20261031',created:Date.now(),pack});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});emit('cached',{ok:true})}}
function openDB(){return new Promise((resolve,reject)=>{let r=indexedDB.open('keylevel-opt-20261031',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function useCache(){const db=await openDB();const item=await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly');let r=tx.objectStore('cache').get('TX20261031');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(!item){emit('needFile');return}await setData(item.pack,false)}
async function handle(m){if(m.type==='cancel'){abort=true;return}if(busy&&m.type!=='cancel')throw Error('另一項計算仍進行中');busy=true;abort=false;
 try{
  if(m.type==='load'){let x=await importCSV(m.file);await setData(x,true)}
  else if(m.type==='restore'){await useCache()}
  else if(m.type==='backtest'){if(!sessions)throw Error('請先匯入五年 1 分 K CSV');let r=run(sessions,m.params,m.options,true);emit('backtestDone',{data:r})}
  else if(m.type==='optimize'){if(!sessions)throw Error('請先匯入五年 1 分 K CSV');emit('optProgress',{done:0,requested:m.options.trials,bestScore:0});let r=await optimize(m.options);emit('optDone',{data:r})}
 }finally{busy=false}
}
if(typeof self!=='undefined'&&self.addEventListener)self.addEventListener('message',e=>handle(e.data).catch(err=>emit('error',{message:String(err.message||err)})));
export {run,oneSession,levelsFor,finalize,DEFAULT,NAMES};