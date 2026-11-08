// Existing verified R1494 data collection and technical indicators; isolated FC23 storage.
let SEED1494,HISTORY1494={},SUPPLEMENT1494={},HOOKS={};
export function initShared(seed,supplement={},hooks={}){SEED1494=seed;SUPPLEMENT1494=supplement;HOOKS=hooks}
function applyCostTrade(ledger,o){if(!(o.price>0)||!(o.notional>=0))throw Error('成本記錄缺少有效成交參考價：'+o.date+' '+o.code);const p=o.price,n=o.notional,q=n/p;const v=ledger[o.code]??(ledger[o.code]={quantity:0,cost:0,totalBought:0,entryDate:null,lastBuyDate:null,firstEntryPrice:null});if(o.side==='BUY'||o.side==='ADD'){if(v.quantity<1e-14)Object.assign(v,{quantity:0,cost:0,totalBought:0,entryDate:o.date,lastBuyDate:o.date,firstEntryPrice:p});v.quantity+=q;v.cost+=n;v.totalBought+=n;v.lastBuyDate=o.date}else if(['SELL','REDUCE','TRIM'].includes(o.side)){if(!(v.quantity>0))throw Error('無持倉的賣出成本記錄：'+o.code);const avg=v.cost/v.quantity,soldCost=q*avg;Object.assign(o,{avgEntryPrice:avg,entryDate:v.entryDate,soldCostNotional:soldCost,realizedNotional:n-soldCost,realizedPct:p/avg-1});const f=Math.max(0,1-q/v.quantity);v.quantity*=f;v.cost*=f;if(o.side==='SELL'||v.quantity<1e-14){v.quantity=0;v.cost=0}}return v}
function decorateHoldingCost(h,s,ledger){const v=ledger[h.code];if(!v||!(v.quantity>0)||!(v.cost>0))throw Error('找不到持股成本：'+h.code);const quantity=h.quantity??h.weight*s.nav/h.price;if(Math.abs(quantity-v.quantity)>1e-9*Math.max(1,quantity))throw Error('持股數量與成本台帳不符：'+h.code);const avg=v.cost/v.quantity,mv=v.quantity*h.price;return Object.assign(h,{quantity:v.quantity,avgEntryPrice:avg,firstEntryPrice:v.firstEntryPrice,entryDate:v.entryDate,lastBuyDate:v.lastBuyDate,entryTime:'收盤模擬（無逐筆時分秒）',costNotional:v.cost,totalBuyNotional:v.totalBought,marketNotional:mv,unrealizedNotional:mv-v.cost,unrealizedPct:h.price/avg-1})}
async function hydrateCostState(st,env){const ledger=structuredClone(SEED.costLedger),by=new Map(),lastPrices=new Map(SNAPSHOT.snapshots.at(-1).holdings.map(h=>[h.code,h.price]));if(!ledger)throw Error('初始成本台帳未準備');for(const o of st.newOrders){if(!by.has(o.date))by.set(o.date,[]);by.get(o.date).push(o)}for(const s of st.newSnapshots){const orders=by.get(s.date)||[];let daily=null;if(orders.some(o=>!o.price)&&env?.BUCKET){const obj=await env.BUCKET.get('r290/daily/'+s.date+'.json');if(obj)daily=new Map((await obj.json()).rows.map(r=>[r.code,r]))}const hPrices=new Map(s.holdings.map(h=>[h.code,h.price]));for(const o of orders){if(!o.price){const row=daily?.get(o.code);o.price=row?.close>0?Math.fround(row.close):hPrices.get(o.code)||lastPrices.get(o.code)}o.quantity=o.notional/o.price;o.executionTime='收盤模擬（無逐筆時分秒）';applyCostTrade(ledger,o)}for(const h of s.holdings){decorateHoldingCost(h,s,ledger);lastPrices.set(h.code,h.price)}}st.costLedger=ledger;st.accountingVersion=1;st.accountingThrough=st.date;return st}


const f32=Math.fround,clip=(v,a,b)=>Math.max(a,Math.min(b,v)),sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>a.length&&a.every(Number.isFinite)?sum(a)/a.length:null;
function ret(c,n){const a=c.at(-1),b=c.at(-1-n);return a>0&&b>0?f32(f32(a/b)-1):null}
function stockFeature(s){const c=s.c,p=c.at(-1),r10=ret(c,10),r20=ret(c,20),r60=ret(c,60);const rr=[];for(let i=Math.max(1,c.length-20);i<c.length;i++)if(c[i]>0&&c[i-1]>0)rr.push(f32(f32(c[i]/c[i-1])-1));const mu=rr.length?sum(rr)/rr.length:0,std=rr.length>=15?Math.sqrt(sum(rr.map(v=>(v-mu)**2))/(rr.length-1)):null;const v20=mean(s.v),a20=mean(s.a);let bad=false;for(let i=Math.max(1,c.length-50);i<c.length;i++)if(c[i]>0&&c[i-1]>0&&Math.abs(f32(f32(c[i]/c[i-1])-1))>.25)bad=true;const e60=s.n>=60?s.e[1]:null,e120=s.n>=120?s.e[2]:null;const base=!!(v20>=1e6&&a20>=30e6&&p>0&&e120!=null&&!bad);const trend=p>e60&&p>e120&&r20>-.04&&r60>0,relaxed=p>e120&&r60>-.08&&r20>-.12;const s3=std==null||r10==null||r20==null||r60==null?-10:f32(f32(f32(.35*r20)+f32(.65*r60))-.9*Math.max(std,.005)-f32(.12*Math.max(0,-r10)));const atr=s.tr&&mean(s.tr)!=null?f32(f32(mean(s.tr))/Math.max(p,1e-10)):0,vr=v20?f32(s.v.at(-1)/Math.max(f32(v20),1)):0;return {p,r10,r20,r60,base,trend,relaxed,s3,atr,vr,e20:s.n>=20?f32(s.e[0]):0}}
function features(st){const F=st.codes.map(k=>stockFeature(st.stocks[k])),v=F.map(x=>x.r20).filter(Number.isFinite).sort((a,b)=>a-b),med=v.length?(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2:0;const mr=n=>st.marketHistory.at(-1)/st.marketHistory.at(-1-n)-1;for(let j=0;j<F.length;j++){const x=F[j],c=st.stocks[st.codes[j]].c;const rs=f32((x.r20??0)-f32(med));const factor=f32(clip(f32(rs/.25),-1.5,1.5)+(x.vr>1.5&&x.r20>0?.45:0)-clip(f32(x.atr/.1),0,1));x.score=f32(x.s3+f32(.12*factor));for(const n of [5,10,20,60])x['rs'+n]=f32(clip((ret(c,n)??0)-mr(n),-1,1));}return F}
function push(a,v,n){a.push(v);if(a.length>n)a.splice(0,a.length-n)}
function ingestStock(s,r){const last=s.c.at(-1),valid=r&&r.close>0&&r.high>=r.low&&r.close<=r.high+.001&&r.close>=r.low-.001;const c=valid?f32(r.close):null;push(s.c,c,121);push(s.v,r?f32(r.volume):null,20);push(s.a,r?f32(r.value):null,20);for(let j=0;j<3;j++){const alpha=2/([20,60,120][j]+1);if(s.e[j]!=null)s.w[j]*=1-alpha;if(c!=null){if(s.e[j]==null)s.e[j]=c;else s.e[j]=(s.w[j]*s.e[j]+alpha*c)/(s.w[j]+alpha);s.w[j]=1}}if(c!=null){s.n++;s.p=c}if(s.tr){let tr=null;if(c!=null&&last!=null){let h=Math.max(f32(r.high),c),l=Math.min(f32(r.low),c);if(!(h>=l&&h<4*c&&l>.2*c)){h=c;l=c}tr=Math.max(h-l,Math.abs(h-last),Math.abs(l-last))}push(s.tr,tr,14)}return !!(valid&&r.volume>0)}
function breadth(st){let den=0,num=0;for(const s of Object.values(st.stocks)){const c=s.c.at(-1),v=mean(s.v),a=mean(s.a);if(a>=30e6&&v>=1e6&&c>0&&s.n>=120){den++;if(c>s.e[2])num++}}return f32(num/Math.max(1,den))}
function advance(st,day,{plan=false,featureOverride=null}={}){if(!plan&&day.date<=st.date)throw Error('資料日期未向前');const savedPlan=plan?null:previewPlan(st);const F=featureOverride||features(st),M=st.codes.length,t=st.t+1,prev={basket:st.basket,bear:st.bear,overlay:st.overlay};const current=st.qty.map((q,j)=>q>1e-14?j:-1).filter(j=>j>=0);for(const j of current)st.held[j]++;const b=st.breadthHistory.at(-1),delta=b-st.breadthHistory.at(-11);let target=delta<-.16?.35:delta<-.08?.7:1;const weighted=n=>{const w=current.map(j=>st.qty[j]*st.stocks[st.codes[j]].p),tot=sum(w);return sum(current.map((j,k)=>w[k]/Math.max(tot,1e-12)*F[j]['rs'+n]))};if(t>=60&&current.length>=2){if(weighted(10)<-.04)st.basket=true;else if(weighted(5)>.01)st.basket=false}const mh=st.marketHistory,m20=mh.at(-1)/mh.at(-21)-1;st.overlay=t>=65&&m20<-.15;if(st.overlay)target*=.7;if(st.basket)target*=.5;if(t>121){const p=mh.at(-1);if(p<st.marketE[2]&&st.marketE[0]<st.marketE[1])st.bear=true;else if(p>st.marketE[1]&&st.marketE[0]>st.marketE[1])st.bear=false;if(st.bear)target*=.35}
const rebal=t%20===0,toSell=new Map(),entrants=[];for(const j of current){const x=F[j];let stop=!x.relaxed||x.r20<-.15||(st.peak[j]>0&&x.p/st.peak[j]-1<-.15);if(t>=22&&st.held[j]>=5)stop ||=x.rs20<-.10&&x.p<x.e20;if(stop)toSell.set(j,'risk_exit')}
const top=F.map((x,j)=>j).filter(j=>F[j].base&&F[j].trend&&st.cool[j]===0).sort((a,b)=>F[b].score-F[a].score||a-b).slice(0,40),rank=Array(M).fill(999);top.forEach((j,k)=>rank[j]=k+1);
if(rebal){for(const j of current)if(rank[j]>24&&st.held[j]>=20)toSell.set(j,'rank_exit');const stay=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(stay.includes(j)||toSell.has(j)||entrants.includes(j))continue;if(stay.length+entrants.length<8){entrants.push(j);continue}if(!stay.length)continue;const worst=stay.reduce((a,b)=>F[a].score<=F[b].score?a:b);if(st.held[worst]>=20&&F[j].score-F[worst].score>=.25){stay.splice(stay.indexOf(worst),1);toSell.set(worst,'replacement');entrants.push(j)}}}
if(((prev.bear&&!st.bear)||(prev.basket&&!st.basket)||(prev.overlay&&!st.overlay))&&!rebal){const alive=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(alive.length+entrants.length>=8)break;if(!alive.includes(j)&&!toSell.has(j)&&!entrants.includes(j))entrants.push(j)}}
const rows=new Map(day.rows.map(r=>[r.code,r])),px=[],exec=[];for(let j=0;j<M;j++){const s=st.stocks[st.codes[j]],r=rows.get(st.codes[j]);if(plan){px[j]=s.p;exec[j]=s.c.at(-1)>0&&s.v.at(-1)>0}else{px[j]=r&&r.close>0&&r.high>=r.low&&r.close<=r.high+.001&&r.close>=r.low-.001?f32(r.close):s.p;exec[j]=!!(r&&r.volume>0&&r.close>0&&r.high>=r.low&&r.close<=r.high+.001&&r.close>=r.low-.001)}}
const invested=()=>sum(st.qty.map((q,j)=>q*px[j])),nav=()=>st.cash+invested(),events=[];const event=(j,side,notional,reason)=>events.push({date:day.date,code:st.codes[j],side,notional,reason,price:px[j],quantity:notional/px[j],executionTime:'收盤模擬（無逐筆時分秒）'});for(const [j,why] of toSell){if(!exec[j])continue;const val=st.qty[j]*px[j];st.cash+=val;st.qty[j]=0;st.held[j]=-1;st.peak[j]=0;st.cool[j]=why==='risk_exit'?10:0;event(j,'SELL',val,why)}st.cool=st.cool.map(c=>Math.max(0,c-1));
if(rebal||t%5===0||prev.bear!==st.bear||prev.basket!==st.basket||prev.overlay!==st.overlay){let inv=invested(),n=nav();if(inv>target*n+1e-10){const fac=target*n/Math.max(inv,1e-10),sold=inv*(1-fac);for(let j=0;j<M;j++)if(st.qty[j]>1e-14)event(j,'REDUCE',st.qty[j]*px[j]*(1-fac),'exposure');st.cash+=sold;st.qty=st.qty.map(q=>q*fac)}for(const j of entrants){if(!exec[j]||st.qty[j]>0)continue;n=nav();const spend=Math.min(st.cash,Math.max(0,target*n-invested()),n/8);if(spend<=1e-10)continue;st.qty[j]+=spend/px[j];st.cash-=spend;st.held[j]=0;st.peak[j]=px[j];event(j,'BUY',spend,'rank')}n=nav();const excess=st.qty.map((q,j)=>Math.max(q*px[j]-.16*n,0));for(let j=0;j<M;j++)if(excess[j]>.002*n){st.qty[j]-=excess[j]/px[j];st.cash+=excess[j];event(j,'TRIM',excess[j],'cap_16pct')}let room=Math.max(0,Math.min(st.cash,target*n-invested()));if(room>.001*n){const live=st.qty.map((q,j)=>q>1e-14?j:-1).filter(j=>j>=0).sort((a,b)=>st.qty[a]*px[a]-st.qty[b]*px[b]);for(const j of live){const add=Math.min(room,Math.max(0,.16*n-st.qty[j]*px[j]));if(add<=1e-10)continue;st.qty[j]+=add/px[j];st.cash-=add;room-=add;event(j,'ADD',add,'restore');if(room<=1e-10)break}}}
const n=nav(),holdings=[];for(let j=0;j<M;j++)if(st.qty[j]>1e-14){st.peak[j]=Math.max(st.peak[j],px[j]);holdings.push({code:st.codes[j],quantity:st.qty[j],weight:st.qty[j]*px[j]/n,price:px[j],days:st.held[j],peak:st.peak[j],trail:st.peak[j]*.85,score:F[j].score,rank:rank[j],rs20:F[j].rs20,rs60:F[j].rs60})}const snapshot={date:day.date,signal:st.date,nav:n,exposure:invested()/n,target,breadth:b,breadthChange:delta,market20:m20,basket:st.basket,bear:st.bear,overlay:st.overlay,rebalance:rebal,t,holdings};
if(!plan){for(const [k,s] of Object.entries(st.stocks))ingestStock(s,rows.get(k));for(const r of day.rows)if(!st.stocks[r.code]&&/^\d{4}$/.test(r.code)){const s={c:[],v:[],a:[],e:[null,null,null],w:[1,1,1],n:0,p:null,market:r.market};ingestStock(s,r);st.stocks[r.code]=s;st.names[r.code]=r.name}const market=sum(st.marketCodes.map((k,j)=>st.stocks[k].p/st.marketBase[j]))/200;push(st.marketHistory,market,121);for(let j=0;j<3;j++){const alpha=2/([20,60,120][j]+1);st.marketE[j]=(1-alpha)*st.marketE[j]+alpha*market}push(st.breadthHistory,breadth(st),11);st.date=day.date;st.t=t;st.planHistory??={};st.planHistory[savedPlan.asOf]=compactPlan(savedPlan);st.newSnapshots.push(snapshot);st.newOrders.push(...events);st.revision++;}
return {snapshot,events};}
function previewPlan(st,featureOverride=null){const copy=structuredClone(st),result=advance(copy,{date:'下一交易日收盤（估算）',rows:[]},{plan:true,featureOverride});const currentNav=st.cash+sum(st.qty.map((q,j)=>q*st.stocks[st.codes[j]].p));result.asOf=st.date;result.executionRule='下一交易日收盤模擬成交';result.executionPriceKnown=false;result.autoBrokerExecution=false;result.actions=result.events.map(o=>{const j=st.codes.indexOf(o.code),after=result.snapshot.holdings.find(h=>h.code===o.code);return {...o,direction:['BUY','ADD'].includes(o.side)?'BUY':'SELL',referencePrice:o.price,referenceDate:st.date,executionPrice:null,status:'預計，尚未執行',beforeWeight:st.qty[j]*st.stocks[o.code].p/currentNav,afterWeight:after?.weight||0,condition:['BUY','ADD'].includes(o.side)?'下一交易日可成交，並有現金及目標曝險空間':'下一交易日可成交；收盤後記錄模型成交'}});return result}
function compactPlan(p){return {asOf:p.asOf,snapshot:{rebalance:p.snapshot.rebalance},actions:p.actions,provenance:"當日收盤資料計算的隔日估算"}}


const number=v=>{if(v==null||String(v).trim()==='')return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:null};
function parseOfficial(raw,type,date){const want=date.replaceAll('-','');if(raw.date&&raw.date!==want)throw Error(type+' 回傳日期 '+raw.date+' 與請求 '+want+' 不符');const tables=raw.tables||[];const table=tables.find(t=>(t.fields||[]).includes(type==='twse'?'證券代號':'代號'));if(!table||!table.data?.length){const status=String(raw.stat||'');if(/沒有|無資料|查無|很抱歉|no data/i.test(status)||raw.date===want&&(tables.length===0||table&&table.data?.length===0&&/^ok$/i.test(status)))return {closed:true,rows:[]};throw Error(type+' 無資料但無法確認休市：'+status)}const f=table.fields,at=(a,name)=>a[f.indexOf(name)],rows=[];for(const a of table.data){const code=String(at(a,type==='twse'?'證券代號':'代號')).trim();if(!/^\d{4}$/.test(code))continue;const get=key=>number(at(a,key));const row=type==='twse'?{code,name:at(a,'證券名稱'),open:get('開盤價'),high:get('最高價'),low:get('最低價'),close:get('收盤價'),volume:get('成交股數'),value:get('成交金額'),market:'twse'}:{code,name:at(a,'名稱'),open:get('開盤'),high:get('最高'),low:get('最低'),close:get('收盤'),volume:get('成交股數'),value:get('成交金額(元)'),market:'tpex'};rows.push(row)}if(rows.length<500)throw Error(type+' 全市場列數異常 '+rows.length);return {closed:false,rows}}
const URLS={twse:d=>'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date='+d.replaceAll('-','')+'&type=ALLBUT0999',tpex:d=>'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date='+encodeURIComponent(d.replaceAll('-','/'))+'&response=json'};
function sourceError(error,label='官方資料來源'){
 const raw=String(error?.message||error);if(/^(上市|上櫃)/.test(raw))return raw.replace(/https?:\/\/[^\s,]+/g,'').slice(0,240);const message=/redirect|重新導向/i.test(raw)?label+'重新導向異常':/timeout|timed out|aborted/i.test(raw)?label+'連線逾時':/HTTP \d+/.test(raw)?label+'回應 '+raw.match(/HTTP \d+/)[0]:raw.replace(/https?:\/\/[^\s,]+/g,'').slice(0,180);
 return message||label+'暫時無法取得';
}
async function fetchOfficialJSON(url,label='官方資料來源'){
 let current=url;for(let hop=0;hop<3;hop++){
  let r;try{r=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','Accept-Language':'zh-TW'}})}catch(e){throw Error(sourceError(e,label))}
  if(r.status>=300&&r.status<400){const location=r.headers.get('location');if(!location)throw Error(label+'重新導向缺少位置');const next=new URL(location,current);if(next.hostname!==new URL(url).hostname||/\/errors?(?:\/|$)/i.test(next.pathname)||next.href===current)throw Error(label+'重新導向異常');current=next.href;continue}
  if(!r.ok)throw Error(label+' HTTP '+r.status);try{return await r.json()}catch{throw Error(label+'未回傳有效JSON')}
 }throw Error(label+'重新導向次數超過上限');
}
function parseLatestOfficial(raw,type,date){
 if(!Array.isArray(raw)||raw.length<500)throw Error('官方OpenAPI資料筆數不足');if(raw.some(r=>dateOf(r.Date)!==date))throw Error('官方OpenAPI日期不是 '+date+'，拒絕使用舊資料');
 const rows=raw.map(r=>({...normalize(r,type),market:type})).filter(r=>/^\d{4}$/.test(r.code));if(rows.length<500)throw Error('官方OpenAPI普通股資料不足');return {closed:false,rows};
}
function parseEnglishTpex1494(raw,date){
 const headers = {Code:'代號',Name:'名稱',Open:'開盤',High:'最高',Low:'最低',Close:'收盤','Trading Shares':'成交股數','Trans. Amount (NTD)':'成交金額(元)'};
 const tables = raw.tables?.map(t=>({...t,fields:t.fields?.map(f=>headers[f]??f)}));
 return parseOfficial({...raw,tables},'tpex',date);
}
async function officialMarket(date,type){
 const latest={twse:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',tpex:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'},label=type==='twse'?'上市日線':'上櫃日線',failures=[];
 // Latest OpenAPI can recover the current session only, never relabel old dates.
 for(const [url,parse] of [[URLS[type](date),r=>parseOfficial(r,type,date)],...(type==='tpex'?[[URLS[type](date).replace('/zh-tw/','/en-us/'),r=>parseEnglishTpex1494(r,date)]]:[]),[latest[type],r=>parseLatestOfficial(r,type,date)]])try{return {type,url,...parse(await fetchOfficialJSON(url,label))}}catch(e){failures.push(sourceError(e,label))}
 throw Error(label+'取得失敗：'+[...new Set(failures)].join('；'));
}
async function officialDay(date){const v=await Promise.all(['twse','tpex'].map(type=>officialMarket(date,type)));if(v.every(x=>x.closed))return {date,closed:true,rows:[],sources:v.map(x=>({type:x.type,url:x.url}))};if(v.some(x=>x.closed))throw Error('上市／上櫃來源對交易日判定不一致');const rows=v.flatMap(x=>x.rows);if(new Set(rows.map(r=>r.code)).size!==rows.length)throw Error('同日上市上櫃出現重複股票代號');return {date,closed:false,rows,sources:v.map(x=>({type:x.type,url:x.url,rows:x.rows.length}))}}
async function finmindDay(date,token){const url='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanStockPrice',start_date:date,end_date:date});const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(23000)});if(!r.ok)throw Error('FinMind HTTP '+r.status);const d=await r.json();if(d.status!==200||!Array.isArray(d.data))throw Error('FinMind '+(d.msg||'回傳格式錯誤'));if(d.data.some(r=>r.date!==date))throw Error('FinMind 回傳日期不一致');const rows=d.data.filter(r=>/^\d{4}$/.test(r.stock_id)).map(r=>({code:r.stock_id,name:r.stock_id,open:r.open,high:r.max,low:r.min,close:r.close,volume:r.Trading_Volume,value:r.Trading_money,market:null}));if(rows.length<1500)throw Error('FinMind 全市場列數不足');return {date,rows,sources:[{type:'FinMind',url:'https://api.finmindtrade.com/api/v4/data',rows:rows.length}],closed:false}}
function nextDate(s){const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
function cutoff(){const tw=new Date(Date.now()+8*3600e3),day=tw.toISOString().slice(0,10);return tw.getUTCHours()>=19?day:new Date(new Date(day+'T00:00:00Z').getTime()-86400e3).toISOString().slice(0,10)}
async function loadState(env){const obj=env.BUCKET?await env.BUCKET.get('r290/state-v2.json'):null;const st=obj?await obj.json():structuredClone(SEED);await hydrateCostState(st,env);return {st,etag:obj?.etag||null}}
async function saveState(env,st,etag){await hydrateCostState(st,env);if(!env.BUCKET)throw Error('永久儲存未連線，未提交更新');const result=await env.BUCKET.put('r290/state-v2.json',JSON.stringify(st),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!result)throw Error('另一個更新已提交，請重新整理');return result.etag}
let runningUpdate=null;
async function doUpdate(env,{through=cutoff(),maxDays=7}={}){if(through>cutoff())throw Error('只可更新到臺灣時間 19:00 後的完整日線');let {st,etag}=await loadState(env);if(!env.BUCKET)throw Error('永久儲存尚未可用');const report=[],start=st.date;let cursor=st.lastChecked||st.date;for(let n=0;n<Math.min(maxDays,7);n++){const date=nextDate(cursor);if(date>through)break;const weekday=new Date(date+'T00:00:00Z').getUTCDay();if(weekday===0||weekday===6){cursor=date;st.lastChecked=date;continue}try{let day;const cached=await env.BUCKET.get('r290/daily/'+date+'.json');try{day=cached?await cached.json():await officialDay(date)}catch(e){if(!env.FINMIND_TOKEN)throw e;day=await finmindDay(date,env.FINMIND_TOKEN)}if(day.closed){report.push({date,status:'closed'});cursor=date;st.lastChecked=date;continue}const mapped=new Map(day.rows.map(r=>[r.code,r]));const covered=st.codes.filter(k=>mapped.has(k)).length;if(covered<st.codes.length*.95)throw Error('研究池覆蓋不足 '+covered+'/'+st.codes.length);for(const r of day.rows){if(r.volume<0||r.value<0)throw Error('成交量／金額為負數')}await env.BUCKET.put('r290/daily/'+date+'.json',JSON.stringify(day),{httpMetadata:{contentType:'application/json'}});const applied=advance(st,day);st.lastChecked=date;st.lastSources=day.sources;st.lastUpdatedAt=new Date().toISOString();report.push({date,status:'updated',rows:day.rows.length,universeCovered:covered,nav:applied.snapshot.nav,events:applied.events.length});cursor=date;}catch(e){st.lastError={date,message:sourceError(e),at:new Date().toISOString()};report.push({date,status:'error',message:st.lastError.message});break}}
if(!report.some(r=>r.status==='error'))st.lastError=null;st.lastAttemptAt=new Date().toISOString();await saveState(env,st,etag);return {from:start,to:st.date,checkedThrough:st.lastChecked,requestedThrough:through,more:st.lastChecked<through,report,signalReady:st.date===through,revision:st.revision,lastError:st.lastError}}
async function update(env,options){if(runningUpdate)return runningUpdate;runningUpdate=doUpdate(env,options).finally(()=>runningUpdate=null);return runningUpdate}
async function liveSnapshot(env){const {st}=await loadState(env),historical=SNAPSHOT,plan=previewPlan(st);const pl=structuredClone(st.costLedger);for(const o of plan.events)applyCostTrade(pl,o);for(const h of plan.snapshot.holdings)decorateHoldingCost(h,plan.snapshot,pl);const history={...historical.planHistory,...st.planHistory};if(st.newSnapshots.some(s=>!history[s.signal])){const replay=structuredClone(SEED);for(const snap of st.newSnapshots){const obj=env.BUCKET?await env.BUCKET.get('r290/daily/'+snap.date+'.json'):null;if(!obj)break;history[replay.date]=compactPlan(previewPlan(replay));advance(replay,await obj.json())}}history[st.date]=compactPlan(plan);return {...historical,planHistory:history,snapshots:historical.snapshots.concat(st.newSnapshots),dates:historical.dates.concat(st.newSnapshots.map(x=>x.date)),orders:historical.orders.concat(st.newOrders),live:{date:st.date,asOf:st.lastUpdatedAt||null,checkedThrough:st.lastChecked,lastAttemptAt:st.lastAttemptAt||null,error:st.lastError||null,storage:!!env.BUCKET,source:st.lastSources||[],revision:st.revision,cutoff:cutoff(),pendingPlan:plan,formulaVersion:st.formulaVersion,accountingVersion:st.accountingVersion,costBasisMethod:'moving-average',executionTime:'收盤模擬（無逐筆時分秒）',replayValidation:{days:78,maxNavError:5.33e-15,holdingsMismatch:0}},names:{...historical.names,...st.names}}}

async function importOfficial(env,input){const {date,twse,tpex}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>cutoff())throw Error('匯入日期不合法或日線尚未完整');let {st,etag}=await loadState(env);if(date<=st.date)return {to:st.date,revision:st.revision,alreadyApplied:true};let expected=nextDate(st.lastChecked||st.date);while([0,6].includes(new Date(expected+'T00:00:00Z').getUTCDay()))expected=nextDate(expected);if(date!==expected)throw Error('必須先補 '+expected+'，不能跳過缺日');const a=parseOfficial(twse,'twse',date),b=parseOfficial(tpex,'tpex',date);if(a.closed!==b.closed)throw Error('上市上櫃交易日不一致');const day={date,rows:[...a.rows,...b.rows],sources:[{type:'TWSE',url:URLS.twse(date),rows:a.rows.length},{type:'TPEx',url:URLS.tpex(date),rows:b.rows.length}],closed:a.closed};let events=0;if(!day.closed){if(new Set(day.rows.map(r=>r.code)).size!==day.rows.length)throw Error('重複股票代號');const found=new Set(day.rows.map(r=>r.code));const covered=st.codes.filter(k=>found.has(k)).length;if(covered<st.codes.length*.95)throw Error('研究池覆蓋不足');for(const r of day.rows)if(r.volume<0||r.value<0)throw Error('量價欄位不合法');await env.BUCKET.put('r290/daily/'+date+'.json',JSON.stringify(day),{httpMetadata:{contentType:'application/json'}});events=advance(st,day).events.length;st.lastUpdatedAt=new Date().toISOString();st.lastSources=day.sources}st.lastChecked=date;st.lastError=null;st.lastAttemptAt=new Date().toISOString();await saveState(env,st,etag);return {to:st.date,checkedThrough:date,revision:st.revision,events,rows:day.rows.length,closed:day.closed}}


// R1494-A: port of the frozen Python R1002/R1491/R1494 replay.
const MODEL1494='R1494-A';
const FIELDS1494=['p','base','trend','relaxed','r20','score','e20','rs5','rs10','rs20','rs60','atr','chipExit'];
function tick1494(p){return p<10?.01:p<50?.05:p<100?.1:p<500?.5:p<1000?1:5}
function breakout1494(p,atr){const v=p*(1+.1*Math.max(.005,Math.min(.25,atr)));return Math.round(Math.ceil((v-1e-8)/tick1494(v))*tick1494(v)*1e4)/1e4}
// Every planned entry fixes both the breakout stop and the maximum chase price before the next open.
// Stock tick rounding applies to the cap, not to the underlying breakout signal.
const CHASE_CAP1494=.05,EXECUTION_REV1494='cap5-open-sell-v1';
function capPrice1494(level){const raw=level*(1+CHASE_CAP1494),tick=tick1494(raw);return Math.round(Math.floor((raw+1e-8)/tick)*tick*1e4)/1e4}
function buyExecution1494(open,high,low,level){
 const cap=capPrice1494(level);
 if(![open,high,low,level].every(Number.isFinite)||open<=0||high<low||low<=0||level<=0)return {filled:false,price:null,type:'INVALID_OHLC',reason:'bad_market_data',cap};
 if(open>=level&&open<=cap)return {filled:true,price:open,type:'STOP_GAP_OPEN',reason:'new_position',cap};
 if(open>cap)return low<=cap?{filled:true,price:cap,type:'LIMIT_PULLBACK_CAP5',reason:'new_position',cap}:{filled:false,price:null,type:'GAP_ABOVE_CAP_UNFILLED',reason:'no_pullback_to_cap',cap};
 return high>=level?{filled:true,price:level,type:'STOP_TOUCHED',reason:'new_position',cap}:{filled:false,price:null,type:'STOP_UNFILLED',reason:'no_touch_no_buy',cap};
}
function context1494(st){
 const F=features(st).map((x,j)=>{const s=st.stocks[st.codes[j]],chips=s.chips||[];for(const n of [5,10,20,60]){const a=s.pc?.at(-1),b=s.pc?.at(-1-n),mh=st.marketHistory;if(a>0&&b>0&&mh.length>n){const rs=clip(a/Math.max(b,1e-9)-1-(mh.at(-1)/mh.at(-1-n)-1),-1,1);x['rs'+n]=n===10?rs:Math.fround(rs)}}const good=chips.length>=5&&chips.slice(-5).every(c=>c&&c.institutionalAvailable);const vol=good?sum(chips.slice(-5).map(c=>c.volume)):0;const f=good&&vol>0?sum(chips.slice(-5).map(c=>c.foreign))/vol:null,trust=good&&vol>0?sum(chips.slice(-5).map(c=>c.trust))/vol:null,hedge=good&&vol>0?sum(chips.slice(-5).map(c=>c.hedge))/vol:null;return {...x,score:x.score+.085*clip((hedge??0)/.04,-1,1),chipExit:f!=null&&trust!=null&&x.p<x.e20&&x.rs20<0&&f<-.02&&trust<-.01}});
 const mh=st.marketHistory,t=st.t+1,b=st.breadthHistory.at(-1),d20=b-st.breadthHistory.at(-21),m40=mh.at(-1)/mh.at(-41)-1;
 return {t,F,breadth:b,breadthDelta:b-st.breadthHistory.at(-11),gate:(t>=41&&m40<-.125?.9:1)*(b<.60&&d20<-.10?.9:1),market20:t>=21?mh.at(-1)/mh.at(-21)-1:0,marketDown:t>121&&mh.at(-1)<st.marketE[2]&&st.marketE[0]<st.marketE[1],marketUp:t>121&&mh.at(-1)>st.marketE[1]&&st.marketE[0]>st.marketE[1],market40:m40};
}
function decide1494(st,context){
 const c=context||context1494(st),F=c.F.map(x=>Array.isArray(x)?Object.fromEntries(FIELDS1494.map((k,i)=>[k,x[i]])):x),t=c.t,M=st.codes.length;
 const excluded=new Set(st.excludedCodes||[]);
 const current=st.qty.flatMap((q,j)=>q>1e-13?[j]:[]),held=st.held.map((h,j)=>h+(st.qty[j]>1e-13?1:0));
 let basket=st.basket,bear=st.bear,overlay=st.overlay,target=c.breadthDelta<-.16?.35:c.breadthDelta<-.08?.7:1;
 const weighted=n=>{const v=current.map(j=>st.qty[j]*F[j].p),vsum=sum(v);return sum(current.map((j,k)=>v[k]/Math.max(vsum,1e-12)*F[j]['rs'+n]))};
 if(t>=60&&current.length>=2){if(weighted(10)<-.035)basket=true;else if(weighted(5)>-.005)basket=false}
 if(basket)target*=.5;if(t>121){if(c.marketDown)bear=true;else if(c.marketUp)bear=false;if(bear)target*=.35}if(t>=65)overlay=c.market20<-.15;if(overlay)target*=.7;target*=c.gate;
 const rebal=t%20===0,toSell=new Map(),early=[];
 for(const j of current){const x=F[j];let stop=!x.relaxed||x.r20<-.15||(st.peak[j]>0&&x.p/st.peak[j]-1<-.15);if(t>=22&&held[j]>=5&&x.rs20<-.10&&x.p<x.e20)stop=true;if(x.chipExit)stop=true;const extra=held[j]>=15&&Number.isFinite(x.rs5)&&Number.isFinite(x.rs20)&&Number.isFinite(x.p)&&x.p<x.e20&&x.rs20<-.07;if(extra&&!stop){early.push(j);stop=true}if(stop)toSell.set(j,'risk_exit')}
 for(const j of st.pending_sell||[])if(st.qty[j]>1e-13)toSell.set(j,'deferred_locked_exit');
 const top=F.map((x,j)=>j).filter(j=>!excluded.has(st.codes[j])&&F[j].base&&F[j].trend&&st.cool[j]===0&&Number.isFinite(F[j].score)).sort((a,b)=>F[b].score-F[a].score||a-b).slice(0,40),rank=Array(M).fill(999);top.forEach((j,k)=>rank[j]=k+1);const entrants=[];
 if(rebal){for(const j of current)if(rank[j]>24&&held[j]>=20)toSell.set(j,'rank_exit');const stay=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(stay.includes(j)||toSell.has(j)||entrants.includes(j))continue;if(stay.length+entrants.length<8){entrants.push(j);continue}if(!stay.length)continue;const worst=stay.reduce((a,b)=>F[a].score<=F[b].score?a:b);if(held[worst]>=20&&F[j].score-F[worst].score>=.25){stay.splice(stay.indexOf(worst),1);toSell.set(worst,'replace');entrants.push(j)}}}
 const riskRelease=(st.bear&&!bear)||(st.basket&&!basket)||(st.overlay&&!overlay);if(riskRelease&&!rebal){const alive=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(alive.length+entrants.length>=8)break;if(alive.includes(j)||toSell.has(j)||entrants.includes(j))continue;entrants.push(j)}}
 const rebalance=rebal||t%5===0||st.bear!==bear||st.basket!==basket||st.overlay!==overlay||t>=1&&Math.abs(c.gate-st.gate)>1e-8;
 return {c,F,t,held,basket,bear,overlay,target,rebal,toSell,early,rank,entrants,riskRelease,rebalance};
}
function advance1494(st,day,context=null){
 if(day.date<=st.date)throw Error('R1494-A 日期未向前');const d=decide1494(st,context),{F,t,target,toSell,rank,entrants}=d,M=st.codes.length,rows=new Map(day.rows.map(r=>[r.code,r])),r=st.codes.map(k=>rows.get(k));
 const valid=j=>r[j]?.valid??!!(r[j]&&r[j].open>0&&r[j].low>0&&r[j].high>=r[j].low&&r[j].open>=r[j].low-1e-9&&r[j].open<=r[j].high+1e-9&&r[j].close>=r[j].low-1e-9&&r[j].close<=r[j].high+1e-9);
 const executable=j=>!st.excludedCodes?.includes(st.codes[j])&&(r[j]?.executable??!!(r[j]?.volume>0&&valid(j)));const lock=(j,up)=>{const row=r[j];if(!valid(j))return false;return row.high===row.low&&row.open===row.high&&row.close===row.high&&(up?row.close/F[j].p>1.08:row.close/F[j].p<.92)};const up=j=>r[j]?.lockUp??lock(j,true),down=j=>r[j]?.lockDown??lock(j,false);
 const px=r.map((row,j)=>row?.mark??(row?.close>0?Math.fround(row.close):st.stocks?.[st.codes[j]]?.p??F[j].p)),op=r.map((row,j)=>Number.isFinite(row?.open)?row.open:px[j]);
 const live=()=>st.qty.flatMap((q,j)=>q>1e-13?[j]:[]),investment=()=>sum(st.qty.map((q,j)=>q*op[j])),events=[];st.held=d.held;st.pending_sell??=[];st.basis??=Array(M).fill(0);st.entryDates??={};st.lastBuyDates??={};st.firstPrices??={};st.totalBought??={};
 const event=(j,side,typ,price,q,reason,level=null,filled=true)=>{const cost=q*st.basis[j],notional=filled?q*price:0;events.push({date:day.date,signal:st.date,code:st.codes[j],side,orderType:typ,price,quantity:q,notional,reason,level,limitPrice:side==='BUY'&&Number.isFinite(level)?capPrice1494(level):null,filled,trade_status:filled?'paper_filled':'unconfirmed',ledger:'R1494_A_paper',executionTime:typ==='STOP_TOUCHED'?'日K碰價模擬（無盤中時間）':'現股開盤模擬 09:00',...side==='SELL'&&filled?{avgEntryPrice:st.basis[j],entryDate:st.entryDates[st.codes[j]],soldCostNotional:cost,realizedNotional:notional-cost,realizedPct:price/st.basis[j]-1}:{}})};
 const reduce=(j,q,price,reason)=>{if(q<=1e-14)return;event(j,'SELL','MARKET_OPEN',price,q,reason);st.cash+=q*price;st.qty[j]-=q;if(st.qty[j]<=1e-13){st.qty[j]=0;st.held[j]=-1;st.peak[j]=0;st.basis[j]=0;st.cool[j]=d.early.includes(j)&&reason==='risk_exit'?5:['risk_exit','protective_stop','profit_take'].includes(reason)?10:0;st.pending_sell=st.pending_sell.filter(k=>k!==j)}};
 const add=(j,spend,price,typ,level,reason)=>{if(spend<=1e-13||price<=0)return false;const q=spend/price,code=st.codes[j];if(st.qty[j]<=1e-13){st.entryDates[code]=day.date;st.firstPrices[code]=price;st.totalBought[code]=0}st.lastBuyDates[code]=day.date;st.totalBought[code]=(st.totalBought[code]||0)+spend;st.basis[j]=(st.qty[j]*st.basis[j]+spend)/(st.qty[j]+q);st.qty[j]+=q;st.cash-=spend;if(st.held[j]<0){st.held[j]=0;st.peak[j]=t?F[j].p:price}event(j,'BUY',typ,price,q,reason,level);return true};
 for(const [j,why] of [...toSell].sort((a,b)=>a[0]-b[0])){if(st.qty[j]<=1e-13)continue;if(!executable(j)||!valid(j)||down(j)){if(!st.pending_sell.includes(j))st.pending_sell.push(j);event(j,'SELL',down(j)?'LOCKED_LIMIT_DOWN':'INVALID_OHLC',null,0,down(j)?'no_bid_no_fill':'bad_market_data',null,false);continue}reduce(j,st.qty[j],op[j],why)}st.cool=st.cool.map(c=>Math.max(0,c-1));
 if(d.rebalance){let inv=investment(),n=st.cash+inv;if(inv>target*n+1e-10){const fac=Math.max(0,target*n/Math.max(inv,1e-10));for(const j of live())if(executable(j)&&!down(j))reduce(j,st.qty[j]*(1-fac),op[j],'portfolio_reduce')}
 n=st.cash+investment();for(const j of live()){if(!executable(j)||down(j))continue;const v=st.qty[j]*op[j],lim=.16*n;if(v>lim+.002*n)reduce(j,(v-lim)/op[j],op[j],'cap16')}
 const invested=investment(),navopen=st.cash+invested;let room=Math.max(0,target*navopen-invested);if(room>.001*navopen){for(const j of live().sort((a,b)=>st.qty[a]*op[a]-st.qty[b]*op[b])){if(toSell.has(j)||!executable(j)||up(j))continue;const cap=Math.max(0,.16*navopen-st.qty[j]*op[j]),spend=Math.min(room,cap,st.cash);if(spend<=1e-12)continue;add(j,spend,op[j],'MARKET_OPEN',null,'topup');room-=spend}}}
 let cashForBuys=st.cash;if(d.rebal||d.riskRelease){for(const j of entrants){if(st.qty[j]>1e-13||!executable(j)||live().length>=8)continue;const level=breakout1494(F[j].p,F[j].atr);if(!valid(j)||up(j)){event(j,'BUY',up(j)?'LOCKED_LIMIT_UP':'INVALID_OHLC',null,0,up(j)?'no_offer_no_fill':'bad_market_data',level,false);continue}const buy=buyExecution1494(op[j],r[j].high,r[j].low,level);if(!buy.filled){event(j,'BUY',buy.type,null,0,buy.reason,level,false);continue}const invested=investment(),n=st.cash+invested,spend=Math.min(Math.max(0,cashForBuys),Math.max(0,target*n-invested),n/8,.16*n);if(spend<=1e-12){event(j,'BUY','INSUFFICIENT_CASH',null,0,'target_exposure_full',level,false);continue}if(add(j,spend,buy.price,buy.type,level,'new_position'))cashForBuys-=spend}}
 const inv=sum(st.qty.map((q,j)=>q*px[j])),nav=st.cash+inv;for(const j of live())st.peak[j]=Math.max(st.peak[j],px[j]);
 const holdings=live().map(j=>{const q=st.qty[j],code=st.codes[j],cost=q*st.basis[j],mv=q*px[j];return {code,quantity:q,price:px[j],weight:mv/nav,days:st.held[j],peak:st.peak[j],trail:st.peak[j]*.85,rank:rank[j],score:F[j].score,rs20:F[j].rs20,rs60:F[j].rs60,avgEntryPrice:st.basis[j],entryDate:st.entryDates[code],lastBuyDate:st.lastBuyDates[code],firstEntryPrice:st.firstPrices[code],entryTime:'現股開盤或突破碰價模擬；非券商成交',costNotional:cost,totalBuyNotional:st.totalBought[code],marketNotional:mv,unrealizedNotional:mv-cost,unrealizedPct:px[j]/st.basis[j]-1}});
 const snapshot={date:day.date,signal:st.date,nav,exposure:inv/nav,target,t,holdings,basket:d.basket,bear:d.bear,overlay:d.overlay,market20:d.c.market20,gate:d.c.gate,breadth:d.c.breadth,breadthChange:d.c.breadthDelta,rebalance:d.rebal,ledger:'R1494_A_paper'};
 Object.assign(st,{date:day.date,t,basket:d.basket,bear:d.bear,overlay:d.overlay,gate:d.c.gate});return {snapshot,events};
}
function plan1494(st,context=null){const d=decide1494(st,context),nav=st.cash+sum(st.qty.map((q,j)=>q*d.F[j].p)),actions=[];for(const [j,reason] of d.toSell)if(!st.excludedCodes?.includes(st.codes[j]))actions.push({code:st.codes[j],side:'SELL',method:'SELL_OPEN',referencePrice:d.F[j].p,quantity:st.qty[j],reason,status:'unconfirmed'});if(d.rebalance)actions.push({code:null,side:'REBALANCE',method:'OPEN_ALLOCATION',target:d.target,reason:'曝險調整、單檔16%上限及既有持股開盤回補；金額依開盤價計算',status:'unconfirmed'});if(d.rebal||d.riskRelease)for(const j of d.entrants)actions.push({code:st.codes[j],side:'BUY',method:'BUY_STOP_BREAKOUT_CAP5',referencePrice:d.F[j].p,level:breakout1494(d.F[j].p,d.F[j].atr),capPrice:capPrice1494(breakout1494(d.F[j].p,d.F[j].atr)),chaseCapPct:CHASE_CAP1494,budgetCap:nav/8,reason:'候選排名；須依序檢查餘額、曝險與8檔上限',status:'unconfirmed'});return {model_version:MODEL1494,ledger:'R1494_A_paper',signal_as_of:st.date,trade_date:nextSession1494(st.date),snapshot:{target:d.target,basket:d.basket,bear:d.bear,overlay:d.overlay,gate:d.c.gate},actions,executionRevision:EXECUTION_REV1494,executionRule:'前日凍結突破價與+5%買入上限；開盤介於突破價及上限之間按開盤買；開盤高於上限等回落到上限；開盤低於突破價等觸突破；未觸不買；賣出按次日開盤',actualBrokerConnected:false}}
function nextSession1494(date){let v=nextDate(date);while([0,6].includes(new Date(v+'T00:00:00Z').getUTCDay()))v=nextDate(v);return v}


const KEY1494='r1494-a/state-v1.json';let running1494=null;
function ingest1494(st,day){const rows=new Map(day.rows.map(r=>[r.code,r]));for(const [k,s] of Object.entries(st.stocks)){ingestStock(s,rows.get(k));if(s.pc)push(s.pc,s.p,121);if(st.codes.includes(k))push(s.chips??=[],day.chips[k],5)}for(const r of day.rows)if(!st.stocks[r.code]&&/^\d{4}$/.test(r.code)){const s={c:[],v:[],a:[],e:[null,null,null],w:[1,1,1],n:0,p:null,market:r.market};ingestStock(s,r);st.stocks[r.code]=s;st.names[r.code]=r.name}
 const mk=sum(st.marketCodes.map((k,j)=>st.stocks[k].p/st.marketBase[j]))/200;push(st.marketHistory,mk,121);for(let j=0;j<3;j++){const alpha=2/([20,60,120][j]+1);st.marketE[j]=(1-alpha)*st.marketE[j]+alpha*mk}push(st.breadthHistory,breadth(st),21)}
async function load1494(env){const obj=env.BUCKET?await env.BUCKET.get(KEY1494):null;return {st:obj?await obj.json():structuredClone(SEED1494),etag:obj?.etag||null}}
async function save1494(env,st,etag){if(!env.BUCKET)throw Error('永久儲存未連線');const r=await env.BUCKET.put(KEY1494,JSON.stringify(st),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!r)throw Error('另一項更新已提交，請重新讀取');return r.etag}
function hash1494(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join(''))}
async function freeze1494(env,st){const p=plan1494(st);p.universe_sha256=st.universe_sha256;p.data_version=st.dataVersion||'frozen-20261027';p.created_at=new Date().toISOString();p.trade_date_calendar_status='下一個平日；正式交易日待官方行情確認';const key='r1494-a/plans-cap5/'+p.signal_as_of+'.json',old=await env.BUCKET.get(key);if(old)return old.json();p.plan_sha256=await hash1494(JSON.stringify({...p,created_at:null}));const wrote=await env.BUCKET.put(key,JSON.stringify(p),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!wrote){const existing=await env.BUCKET.get(key);if(!existing)throw Error('計畫凍結衝突');return existing.json()}return p}
async function chipRequest1494(url){return fetchOfficialJSON(url,'法人／融資券來源')}
function chipTable1494(raw,date,kind){if(raw.date&&dateOf(raw.date)!==date)throw Error(kind+' 籌碼日期不符');const ts=raw.tables||[{fields:raw.fields,data:raw.data}];const table=ts.find(t=>Array.isArray(t.fields)&&t.fields.some(f=>/^(證券代號|代號|股票代號)$/.test(f)));if(!table?.data?.length)throw Error(kind+' 籌碼欄位未通過檢查');if(table.date&&dateOf(table.date)!==date)throw Error(kind+' 表內籌碼日期不符');return table}
async function finmindMargin1494(env,date,market,codes){
 const dataset='TaiwanStockMarginPurchaseShortSale';
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 async function query(code){
  const params=new URLSearchParams({dataset,start_date:date,end_date:date});
  if(code)params.set('data_id',code);
  const response=await fetch(endpoint+'?'+params,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:env.FINMIND_TOKEN?{Authorization:'Bearer '+env.FINMIND_TOKEN}:{}});
  if(!response.ok)throw Error('HTTP '+response.status);
  const result=await response.json();
  if(result.status!==200||!Array.isArray(result.data))throw Error('API 狀態 '+result.status);
  const found=new Map();
  for(const r of result.data){
   if(r.date!==date||code&&r.stock_id!==code)throw Error('日期或代號不符');
   if(!codes.includes(r.stock_id))continue;
   const values=[number(r.MarginPurchaseTodayBalance),number(r.ShortSaleTodayBalance)];
   if(found.has(r.stock_id)||!values.every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('餘額或代號異常');
   found.set(r.stock_id,[r.stock_id,...values]);
  }
  return [...found.values()];
 }
 const key='r1494-a/finmind-margin/'+date+'/'+market+'/';
 let records=[];
 if(env.FINMIND_TOKEN)records=await query(null);
 else{
  // Persist verified batches independently so later syncs resume within Worker limits.
  const batches=Array.from({length:Math.ceil(codes.length/6)},(_,i)=>codes.slice(i*6,i*6+6));
  let fetched=0;
  for(const batch of batches){
   const path=key+batch.join('-')+'.json',cached=await env.BUCKET.get(path);
   if(cached){records.push(...await cached.json());continue}
   if(fetched>=2)throw Error('已暫存 '+records.length+'/'+codes.length+' 檔，下次更新接續');
   const first=await query(batch[0]);
   if(!first.length)throw Error(batch[0]+' 尚無 '+date+' 資料');
   const group=first.concat((await Promise.all(batch.slice(1).map(query))).flat());
   if(group.length!==batch.length)throw Error('部分個股尚無 '+date+' 資料');
   await env.BUCKET.put(path,JSON.stringify(group));records.push(...group);fetched++;
  }
 }
 if(!codes.length||records.length!==codes.length)throw Error('當日覆蓋 '+records.length+'/'+codes.length+' 檔');
 return {market,kind:'margin',url:endpoint+'?dataset='+dataset,raw:{date:date.replaceAll('-',''),fields:['股票代號','融資今日餘額','融券今日餘額'],data:records}};
}
async function finmindInstitutional1494(env,date,market,codes){
 const dataset='TaiwanStockInstitutionalInvestorsBuySell';
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 if(!env.FINMIND_TOKEN)throw Error('缺少 Actions Secret FINMIND_TOKEN');
 const params=new URLSearchParams({dataset,start_date:date,end_date:date});
 const response=await fetch(endpoint+'?'+params,{signal:AbortSignal.timeout(23000),headers:{Authorization:'Bearer '+env.FINMIND_TOKEN}});
 if(!response.ok)throw Error('HTTP '+response.status);
 const result=await response.json();
 if(result.status!==200||!Array.isArray(result.data))throw Error('API 狀態 '+result.status);
 const expected=new Set(codes), fields=['Foreign_Investor','Investment_Trust','Dealer_Hedging'], records=new Map();
 for(const row of result.data){
  if(row.date!==date)throw Error('法人日期不符');
  if(!expected.has(row.stock_id)||!fields.includes(row.name))continue;
  const buy=number(row.buy),sell=number(row.sell);
  const values=records.get(row.stock_id)??new Map();
  if(values.has(row.name)||![buy,sell].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('法人欄位或代號異常');
  values.set(row.name,buy-sell);records.set(row.stock_id,values);
 }
 const data=codes.map(code=>[code,...fields.map(field=>records.get(code)?.get(field))]);
 const missing=data.filter(row=>row.slice(1).some(v=>v==null));
 if(!data.length||missing.length)throw Error('法人欄位覆蓋 '+(data.length-missing.length)+'/'+data.length+' 檔');
 return {market,kind:'inst',url:endpoint+'?dataset='+dataset,raw:{date:date.replaceAll('-',''),fields:['股票代號','外資買賣超股數','投信買賣超股數','自營商買賣超股數(避險)'],data}};
}
async function stageChipSource1494(env,{date,market,kind,raw}){
 const {st}=await load1494(env);
 if(date!==nextSession1494(st.lastChecked||st.date)||date>cutoff()||dateOf(raw?.date)!==date)throw Error('匯入日期不符');
 if(!['twse','tpex'].includes(market)||!['inst','margin'].includes(kind))throw Error('來源類型不符');
 const source={market,kind,raw,url:'official-executor-import:'+market+'-'+kind};
 const parsed=parseChips1494(date,[],[source]);
 const expected=st.codes.filter(k=>st.stocks[k]?.market===market);
 if(!expected.length||expected.some(k=>!parsed.chips[k]))throw Error('研究池覆蓋不足');
 await env.BUCKET.put('r1494-a/official-source/'+date+'/'+market+'-'+kind,JSON.stringify(source),{onlyIf:{etagDoesNotMatch:'*'}});
 return {date,market,kind,covered:expected.length};
}
async function officialChips1494(date,rows,env,st){const ds=date.replaceAll('-',''),sl=date.replaceAll('-','/');const sources=[
 ['twse','inst','https://www.twse.com.tw/fund/T86?response=json&date='+ds+'&selectType=ALLBUT0999'],
 ['tpex','inst','https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date='+encodeURIComponent(sl)+'&type=Daily&sect=EW&response=json'],
 ['twse','margin','https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date='+ds+'&selectType=ALL'],
 ['tpex','margin','https://www.tpex.org.tw/www/zh-tw/margin/balance?date='+encodeURIComponent(sl)+'&response=json']];
 const rawSources=await Promise.all(sources.map(async([market,kind,url])=>{
  const stored=await env.BUCKET.get('r1494-a/official-source/'+date+'/'+market+'-'+kind);
  if(stored)return stored.json();
  const label=(market==='twse'?'上市':'上櫃')+(kind==='inst'?'三大法人':'融資券');
  const alternate=market==='twse'?url.replace('/fund/','/rwd/zh/fund/').replace('/exchangeReport/','/rwd/zh/marginTrading/'):url.replace('/zh-tw/','/en/');
  const errors=[];
  const datedT86='https://www.twse.com.tw/rwd/zh/fund/T86?date='+ds+'&selectType=';
  const candidates=market==='twse'&&kind==='inst'
   ? [datedT86+'ALLBUT0999&response=json',datedT86+'ALL&response=json',url,alternate]
   : market==='twse'?[url,alternate]:[url];
  for(const candidate of new Set(candidates)){
   try{
    const raw=await fetchOfficialJSON(candidate,label);
    if(!raw.date&&/沒有符合條件|查無資料/.test(raw.stat||''))throw Error(label+'尚無該日資料');
    chipTable1494(raw,date,kind);
    return {market,kind,url:candidate,raw};
   }catch(e){errors.push(sourceError(e,label))}
  }
  const markets=new Map(rows.map(r=>[r.code,r.market]));
  const suspended=new Set(confirmedSuspensions1494(date).map(s=>s.code));
  const codes=st.codes.filter(k=>!suspended.has(k)&&(markets.get(k)||st.stocks[k]?.market)===market);
  try{return await (kind==='margin'?finmindMargin1494:finmindInstitutional1494)(env,date,market,codes)}
  catch(e){errors.push('FinMind '+e.message)}
  throw Error(label+'取得失敗：'+[...new Set(errors)].join('；'));
 }));return parseChips1494(date,rows,rawSources);}
function parseChips1494(date,rows,rawSources){const chips={},marketRows=new Map(rows.map(r=>[r.code,r]));for(const {market,kind,url,raw} of rawSources){const tab=chipTable1494(raw,date,kind),f=tab.fields.map(x=>String(x).replace(/\s|<[^>]*>/g,''));const codeIdx=f.findIndex(x=>/^(證券代號|代號|股票代號)$/.test(x));let count=0;
 for(const a of tab.data){const code=String(a[codeIdx]).trim();if(!SEED1494.codes.includes(code))continue;const get=(pattern)=>{const i=f.findIndex(x=>pattern.test(x));return i>=0?number(a[i]):null};const c=chips[code]??={date,volume:marketRows.get(code)?.volume??0};if(kind==='inst'){let foreign=get(/^(外陸資|外資及陸資|外資).*買賣超(股數)?(\(不含外資自營商\))?$/),trust=get(/^投信.*買賣超(股數)?$/),hedge=get(/^自營商.*(避險).*買賣超|^自營商買賣超股數\(避險\)$/);
 // TPEx's dated Daily report has seven explicitly ordered B/S/net groups.
 if(market==='tpex'&&f.length===24&&f[23]==='三大法人買賣超股數合計'&&Array.from({length:7},(_,n)=>f.slice(2+3*n,5+3*n).join(',')).every(x=>x==='買進股數,賣出股數,買賣超股數')){
  const v=a.map(number);for(let n=0;n<7;n++){const i=2+3*n;if(![v[i],v[i+1],v[i+2]].every(Number.isFinite)||Math.abs(v[i]-v[i+1]-v[i+2])>.5)throw Error('上櫃法人買賣超加總未通過檢查')}
  if(Math.abs(v[4]+v[7]-v[10])>.5||Math.abs(v[16]+v[19]-v[22])>.5||Math.abs(v[10]+v[13]+v[22]-v[23])>.5)throw Error('上櫃法人分類加總未通過檢查');foreign=v[4];trust=v[13];hedge=v[19];
 }
if([foreign,trust,hedge].some(v=>v==null))throw Error(market+' 法人欄位缺少外資、投信或避險；停止訊號');Object.assign(c,{foreign,trust,hedge,institutionalAvailable:true})}else{const bal=[];f.forEach((x,i)=>{if(/今日餘額|本日餘額/.test(x))bal.push(i)});const mi=f.findIndex(x=>/^(資餘額|融資餘額|融資今日餘額|融資本日餘額)$/.test(x)),si=f.findIndex(x=>/^(券餘額|融券餘額|融券今日餘額|融券本日餘額)$/.test(x));const midx=mi>=0?mi:bal[0],sidx=si>=0?si:bal[1];if(!Number.isInteger(midx)||!Number.isInteger(sidx)||midx===sidx)throw Error(market+' 融資券餘額欄位未驗證');const margin=number(a[midx]),short=number(a[sidx]);if(margin==null||short==null)throw Error('融資券缺值');Object.assign(c,{margin,short,marginAvailable:true})}count++}
 if(count<10)throw Error(market+' '+kind+' 研究池覆蓋異常')}
 return {chips,sources:rawSources.map(({market,kind,url})=>({market,kind,url,date}))};}
function completeChips1494(c,date){return c&&c.date===date&&c.institutionalAvailable&&c.marginAvailable&&[c.foreign,c.trust,c.hedge,c.margin,c.short,c.volume].every(Number.isFinite)}
function validate1494Day(st,day){if(day.rows.some(r=>r.date&&r.date!==day.date))throw Error('價量來源日期混用');const rows=new Map(day.rows.map(r=>[r.code,r]));if(rows.size!==day.rows.length)throw Error('價量代號重複');const suspended=new Set((day.suspensions||[]).map(s=>s.code));const missing=st.codes.filter(k=>!suspended.has(k)&&!rows.has(k));if(missing.length)throw Error('233檔日線缺漏：'+missing.join(','));for(const code of st.codes){if(suspended.has(code)&&!rows.has(code))continue;const r=rows.get(code),c=day.chips?.[code];if(!completeChips1494(c,day.date))throw Error('法人或融資券未完整：'+code);if(!(r.volume>=0&&r.value>=0))throw Error('成交量金額不合法：'+code);if(r.volume>0&&!(r.open>0&&r.low>0&&r.high>=r.low&&r.open>=r.low-.001&&r.open<=r.high+.001&&r.close>=r.low-.001&&r.close<=r.high+.001))throw Error('OHLC不合法：'+code);const prev=st.stocks[code].p;if(r.close>0&&prev>0&&Math.abs(r.close/prev-1)>.25)throw Error('公司行動或異常跳價待核實：'+code)}for(const k of st.marketCodes)if(!suspended.has(k)&&!rows.has(k)&&st.stocks[k]?.c.at(-1)>0)throw Error('200檔市場代理資料缺漏：'+k)}
async function doSync1494(env,{through=cutoff(),maxDays=3}={}){if(through>cutoff())throw Error('當日19:00前不使用未完成資料');let {st,etag}=await load1494(env);if(!env.BUCKET)throw Error('永久儲存未連線');const report=[];
 if(!st.backupDone){const legacy=await env.BUCKET.get('r290/state-v2.json');if(legacy)await env.BUCKET.put('r1494-a/migration-backup/legacy_R290_state.json',await legacy.text(),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});st.backupDone=true}
 st.planHistory??={};st.planHistory[st.date]=await freeze1494(env,st);let cursor=st.lastChecked||st.date;for(let n=0;n<Math.min(7,Math.max(1,maxDays));n++){const date=nextDate(cursor);if(date>through)break;if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())){cursor=date;st.lastChecked=date;continue}
 try{const cached=await env.BUCKET.get('r290/daily/'+date+'.json');let day;if(cached)day=await cached.json();else day=await multiSourceDay1494(date,env,st);if(day.closed){cursor=date;st.lastChecked=date;report.push({date,status:'closed'});continue}day=structuredClone(day);const stored=await env.BUCKET.get('r1494-a/chips/'+date+'.json');let source;if(stored)source=await stored.json();else if(SUPPLEMENT1494[date]){const x=SUPPLEMENT1494[date];for(const r of day.rows){if(x[r.code]&&r.close>0&&Math.abs(x[r.code].close-r.close)>.00051)throw Error('使用者籌碼檔與官方收盤不一致：'+r.code)}source={chips:x,sources:[{kind:'user_research_dataset',date,name:'FinMind_FuturesEligibleStocks_ALL_daily_research_20260101_20261031.zip'}]}}else source=await officialChips1494(date,day.rows,env,st);day.chips={...source.chips};day.chipSources=source.sources;
 const excluded=new Set((day.suspensions||[]).map(x=>x.code));
 const chipGaps=st.codes.filter(code=>!excluded.has(code)&&!completeChips1494(day.chips[code],date));
 if(chipGaps.length+(day.suspensions||[]).filter(x=>x.type==='unconfirmed gap').length>2)throw Error('籌碼缺漏超過可隔離上限：'+chipGaps.slice(0,8).join(','));
 const diagnosed=await Promise.all(chipGaps.map(code=>diagnoseMissing1494(date,code,st.stocks[code]?.market,env,'法人或融資券')));
 day.suspensions=[...(day.suspensions||[]),...diagnosed];
 for(const {code} of day.suspensions){excluded.add(code);delete day.chips[code]}
 day.benchmarkCloses=Object.fromEntries(day.rows.filter(row=>excluded.has(row.code)&&row.close>0).map(row=>[row.code,row.close]));
 day.rows=day.rows.filter(row=>!excluded.has(row.code));
 validate1494Day(st,day);
 if(HOOKS.context)await env.BUCKET.put('fc23/context/'+st.date+'.json',JSON.stringify(HOOKS.context(st)));const inputVersion=await hash1494(JSON.stringify(day)),candidate=structuredClone(st);const result=advance1494(candidate,day);ingest1494(candidate,day);if(HOOKS.ingest)HOOKS.ingest(candidate,day);candidate.excludedCodes=day.suspensions.map(x=>x.code);result.snapshot.dataGaps=day.suspensions;candidate.newSnapshots.push(result.snapshot);candidate.newOrders.push(...result.events);candidate.lastChecked=date;candidate.lastUpdatedAt=new Date().toISOString();candidate.dataVersion=inputVersion;candidate.revision++;candidate.lastError=null;candidate.lastSources=[...day.sources,...day.chipSources];await env.BUCKET.put('r1494-a/daily/'+date+'.json',JSON.stringify(day),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(source),{httpMetadata:{contentType:'application/json'}});candidate.planHistory[candidate.date]=await freeze1494(env,candidate);etag=await save1494(env,candidate,etag);st=candidate;cursor=date;report.push({date,status:'updated',rows:233,nav:result.snapshot.nav,events:result.events.length});
 }catch(e){st.lastError={date,message:sourceError(e),at:new Date().toISOString()};report.push({date,status:'blocked',message:st.lastError.message});break}}
 st.lastAttemptAt=new Date().toISOString();etag=await save1494(env,st,etag);return {model_version:MODEL1494,to:st.date,checkedThrough:st.lastChecked,report,lastError:st.lastError,more:st.lastChecked<through,revision:st.revision};}
async function sync1494(env,options){if(running1494)return running1494;
 running1494=(async()=>{if(!env.BUCKET)throw Error('永久儲存未連線');const key='r1494-a/sync-lease.json',obj=await env.BUCKET.get(key),old=obj?await obj.json():null;if(old?.expires>Date.now())return {status:'running',...(await status1494(env))};const lease=await env.BUCKET.put(key,JSON.stringify({expires:Date.now()+120000}),{onlyIf:obj?{etagMatches:obj.etag}:{etagDoesNotMatch:'*'}});if(!lease)return {status:'running'};
 try{return await doSync1494(env,options)}finally{await env.BUCKET.put(key,JSON.stringify({expires:0}),{onlyIf:{etagMatches:lease.etag}})}})().finally(()=>running1494=null);return running1494}

async function status1494(env){const {st}=await load1494(env),leaseObj=env.BUCKET?await env.BUCKET.get('r1494-a/sync-lease.json'):null,lease=leaseObj?await leaseObj.json():null;const isRunning=!!running1494||lease?.expires>Date.now();return {model_version:MODEL1494,ledger:'R1494_A_paper',data_as_of:st.date,signal_as_of:st.date,price_updated_at:st.lastUpdatedAt||null,lastAttemptAt:st.lastAttemptAt||null,checkedThrough:st.lastChecked,latestExpected:cutoff(),sync_status:isRunning?'running':st.lastError?'blocked':st.lastChecked>=cutoff()?'current':'pending',trade_status:'paper_only_broker_unconfirmed',lastError:st.lastError?{...st.lastError,message:sourceError(st.lastError.message)}:null,universe_count:st.codes.length,universe_sha256:st.universe_sha256,revision:st.revision,actualBrokerConnected:false,sources:st.lastSources||[]}}
async function snapshot1494(env){const {st}=await load1494(env),planObj=env.BUCKET?await env.BUCKET.get('r1494-a/plans-cap5/'+st.date+'.json'):null,plan=planObj?await planObj.json():plan1494(st),status=await status1494(env),ready=status.sync_status==='current';const planHistory={...HISTORY1494.planHistory,...st.planHistory};for(const s of st.newSnapshots)if(!planHistory[s.date]&&env.BUCKET){const obj=await env.BUCKET.get('r1494-a/plans-cap5/'+s.date+'.json')||await env.BUCKET.get('r1494-a/plans/'+s.date+'.json');if(obj)planHistory[s.date]=await obj.json()}return {...HISTORY1494,planHistory,snapshots:[...HISTORY1494.snapshots,...st.newSnapshots],dates:[...HISTORY1494.dates,...st.newSnapshots.map(s=>s.date)],orders:[...HISTORY1494.orders,...st.newOrders],status,executionRevision:EXECUTION_REV1494,historyExecutionRevision:'original-open-execution-v1',plan:{...plan,readiness:ready?'ready':'blocked',blockedReason:ready?null:(st.lastError?sourceError(st.lastError.message):null)||'先補足連續完整日線與籌碼；舊日期價位僅供回放'},names:{...HISTORY1494.names,...st.names},broker:{connected:false,holdings:null,trade_status:'unconfirmed'},assumptions:HISTORY1494.assumptions}}


async function importChips1494(env,input){const {date}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date>cutoff())throw Error('籌碼匯入日期不合法');const {st}=await load1494(env);if(date<=st.date)return {alreadyApplied:true,to:st.date};let expected=nextSession1494(st.lastChecked||st.date);if(date!==expected)throw Error('必須先補 '+expected);const stored=await env.BUCKET.get('r290/daily/'+date+'.json')||await env.BUCKET.get('r1494-a/daily/'+date+'.json');if(!stored)throw Error('請先匯入該日官方日線');const day=await stored.json();if(day.closed)throw Error('休市日沒有籌碼訊號');const ds=date.replaceAll('-',''),sl=encodeURIComponent(date.replaceAll('-','/'));const sources=[{market:'twse',kind:'inst',raw:input.twseInstitutional,url:'https://www.twse.com.tw/fund/T86?response=json&date='+ds+'&selectType=ALLBUT0999'},{market:'tpex',kind:'inst',raw:input.tpexInstitutional,url:'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date='+sl+'&type=Daily&sect=EW&response=json'},{market:'twse',kind:'margin',raw:input.twseMargin,url:'https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date='+ds+'&selectType=ALL'},{market:'tpex',kind:'margin',raw:input.tpexMargin,url:'https://www.tpex.org.tw/www/zh-tw/margin/balance?date='+sl+'&response=json'}];if(sources.some(s=>!s.raw||typeof s.raw!=='object'))throw Error('四份官方原始籌碼JSON必須完整提供');const parsed=parseChips1494(date,day.rows,sources);day.chips=parsed.chips;validate1494Day(st,day);await env.BUCKET.put('r1494-a/chips-raw/'+date+'.json',JSON.stringify(input),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(parsed),{httpMetadata:{contentType:'application/json'}});return sync1494(env,{through:date,maxDays:7})}

// One complete official session, for cloud-task/executor fallback when Worker egress fails.
async function importSession1494(env,input){
 const {date}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date>cutoff())throw Error('只可匯入已完成交易日');const {st}=await load1494(env);if(date<=st.date)return {alreadyApplied:true,to:st.date,revision:st.revision};if(date!==nextSession1494(st.lastChecked||st.date))throw Error('不得跳過尚未完成日期');
 const a=parseOfficial(input.twse,'twse',date),b=parseOfficial(input.tpex,'tpex',date);if(a.closed||b.closed){if(a.closed!==b.closed)throw Error('上市上櫃休市判定不同');const legacy=await importOfficial(env,input);return {...await sync1494(env,{through:date,maxDays:7}),legacy}}
 const rows=[...a.rows,...b.rows],sourceInputs=[['twse','inst','twseInstitutional'],['tpex','inst','tpexInstitutional'],['twse','margin','twseMargin'],['tpex','margin','tpexMargin']].map(([market,kind,key])=>({market,kind,raw:input[key],url:'official-executor-import:'+key}));if(sourceInputs.some(s=>!s.raw))throw Error('必須包含四份完整官方籌碼JSON');const chips=parseChips1494(date,rows,sourceInputs);validate1494Day(st,{date,rows,chips:chips.chips});
 const cached=await env.BUCKET.get('r290/daily/'+date+'.json');if(cached){const previous=await cached.json(),by=new Map(rows.map(r=>[r.code,r]));for(const r of previous.rows){const s=by.get(r.code);if(!s||['open','high','low','close','volume','value'].some(k=>r[k]!==s[k]))throw Error('與已保存的官方日線不一致：'+r.code)}}
 await env.BUCKET.put('r1494-a/chips-raw/'+date+'.json',JSON.stringify(input),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(chips),{httpMetadata:{contentType:'application/json'}});const legacy=await importOfficial(env,input);return {...await sync1494(env,{through:date,maxDays:7}),legacy};
}


const finite=v=>{if(v==null||String(v).trim()==='')return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:null};
function dateOf(v){const s=String(v??'').trim();if(/^\d{7}$/.test(s))return (Number(s.slice(0,3))+1911)+'-'+s.slice(3,5)+'-'+s.slice(5);if(/^\d{8}$/.test(s))return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);const a=s.split(/[\/-]/);if(a.length===3)return (a[0].length===3?Number(a[0])+1911:a[0])+'-'+a[1].padStart(2,'0')+'-'+a[2].padStart(2,'0');return null}
function normalize(r,type){const code=String(r.Code??r.SecuritiesCompanyCode??r.SecuritiesCode??r.StockCode??'').trim(),date=dateOf(r.Date??r.TradeDate),close=finite(r.ClosingPrice??r.Close);return {code,name:String(r.Name??r.CompanyName??r.SecuritiesName??''),date,open:finite(r.OpeningPrice??r.Open),high:finite(r.HighestPrice??r.High),low:finite(r.LowestPrice??r.Low),close,volume:finite(r.TradeVolume??r.TradingShares??r.TradingVolume),value:finite(r.TradeValue??r.TransactionAmount??r.TradingAmount),source:type==='twse'?'TWSE':'TPEx'}}

// Company announcement published 2026-10-27. Only these dates are exempt.
function confirmedSuspensions1494(date) {
 return date>='2026-11-05'&&date<='2026-11-13'
  ? [{code:'3714',type:'confirmed suspension',url:'https://m.moneydj.com/f1a.aspx?a=80E8B6EA-1B62-4870-93F1-6CCE1D660ED1'}]
  : [];
}
const usablePrice1494 = row => row && Number.isFinite(row.value) && row.value >= 0 &&
 Number.isFinite(row.volume) && row.volume >= 0 &&
 (row.volume === 0 || [row.open, row.high, row.low, row.close].every(v => Number.isFinite(v) && v > 0) &&
 row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close));

async function yahooPrice1494(date, code, market, host) {
 const symbol = code + (market === 'tpex' ? '.TWO' : '.TW');
 const start = Date.parse(date + 'T00:00:00+08:00') / 1000;
 const params = new URLSearchParams({period1:start,period2:start+86400,interval:'1d'});
 const url = 'https://' + host + '/v8/finance/chart/' + symbol + '?' + params;
 const response = await fetch(url, {signal:AbortSignal.timeout(9000),headers:{Accept:'application/json'}});
 if (!response.ok) throw Error('HTTP '+response.status);
 const result = (await response.json()).chart?.result?.[0];
 if (result?.meta?.symbol !== symbol || result.meta.exchangeTimezoneName !== 'Asia/Taipei') throw Error('代號或市場不符');
 const i = result.timestamp?.findIndex(t => Number.isFinite(t) && new Date(t*1000+28800000).toISOString().slice(0,10) === date);
 if (i == null || i < 0) throw Error('沒有指定日期日線');
 const q = result.indicators?.quote?.[0];
 return Object.fromEntries(['open','high','low','close','volume'].map(k => [k,q?.[k]?.[i]]));
}

async function repairYahoo1494(date, row, market) {
 if (!row || !['twse','tpex'].includes(market) || !(row.volume>0) || !Number.isFinite(row.value)) return null;
 for (const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
  try {
   const price = await yahooPrice1494(date,row.code,market,host);
   if (price.volume !== row.volume) continue;
   const repaired = {...row,...price,market,date,priceSource:'Yahoo Finance'};
   if (usablePrice1494(repaired)) return repaired;
  } catch {}
 }
 return null;
}

async function diagnoseMissing1494(date, code, market, env, field) {
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 const start=new Date(Date.parse(date+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);
 const headers=env.FINMIND_TOKEN?{Authorization:'Bearer '+env.FINMIND_TOKEN}:{};
 const params=new URLSearchParams({dataset:'TaiwanStockSuspended',data_id:code,start_date:start,end_date:date});
 try {
  const r=await fetch(endpoint+'?'+params,{headers,signal:AbortSignal.timeout(6000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const result=await r.json();
  if(result.status!==200||!Array.isArray(result.data))throw Error('API '+result.status);
  const event=result.data.find(x=>x.stock_id===code&&dateOf(x.date)<=date&&dateOf(x.resumption_date)>date);
  if(event)return {code,field,type:'confirmed suspension',reason:'FinMind 暫停交易公告',url:endpoint+'?dataset=TaiwanStockSuspended'};
 } catch(e) {
  return {code,field,type:'unconfirmed gap',reason:field+'缺漏；停牌公告查詢失敗（'+sourceError(e)+'）'};
 }
 return {code,field,type:'unconfirmed gap',reason:field+'缺漏；未查到符合日期的停牌公告'};
}
async function multiSourceDay1494(date, env, st) {
 const markets = ['twse','tpex'];
 const results = await Promise.allSettled(markets.map(type => officialMarket(date,type)));
 const official = results.filter(r => r.status === 'fulfilled').map(r => r.value);
 const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
 const suspensions = confirmedSuspensions1494(date);
 const suspended = new Set(suspensions.map(s=>s.code));
 const required = [...new Set([...st.codes,...st.marketCodes.filter(k=>st.stocks[k]?.c.at(-1)>0)])].filter(k=>!suspended.has(k));
 const rows = new Map();
 const sources = [];
 for (const feed of official) {
  for (const row of feed.rows) {
   if (rows.has(row.code)) throw Error('上市上櫃代號重複：'+row.code);
   rows.set(row.code,{...row,date});
  }
  sources.push({type:feed.type,url:feed.url,rows:feed.rows.length});
 }
 if (official.length === 2 && official.every(feed=>feed.closed)) return {date,closed:true,rows:[],sources};
 const needsBackup = official.length !== 2 || official.some(feed=>feed.closed) || required.some(k=>!usablePrice1494(rows.get(k)));
 if (needsBackup) {
  if (env.FINMIND_TOKEN) {
   try {
    const feed = await finmindDay(date,env.FINMIND_TOKEN);
    if (new Set(feed.rows.map(r=>r.code)).size !== feed.rows.length) throw Error('日線代號重複');
    for (const row of feed.rows) {
     const prior = rows.get(row.code);
     if (!usablePrice1494(prior)) rows.set(row.code,{...row,date,market:prior?.market??st.stocks[row.code]?.market??null,name:prior?.name??st.names[row.code]??row.code});
    }
    sources.push(...feed.sources);
   } catch (e) { errors.push('FinMind：'+sourceError(e)); }
  } else errors.push('FinMind 全市場備援缺少 Actions Secret FINMIND_TOKEN');
 }
 const candidates = required.filter(k=>!usablePrice1494(rows.get(k))&&rows.get(k)?.volume>0&&Number.isFinite(rows.get(k)?.value));
 let repaired = 0;
 for (let i=0;i<candidates.length;i+=6) {
  const group = await Promise.all(candidates.slice(i,i+6).map(k=>repairYahoo1494(date,rows.get(k),rows.get(k)?.market??st.stocks[k]?.market)));
  for (const row of group) if (row) { rows.set(row.code,row); repaired++; }
 }
 if (repaired) sources.push({type:'Yahoo Finance',rows:repaired});
 const missing = required.filter(k=>!usablePrice1494(rows.get(k)));
 if (missing.length > 2 || ((official.length !== 2 || official.some(feed=>feed.closed)) && !sources.some(s=>s.type==='FinMind'))) {
  throw Error([...errors,'日線缺漏 '+missing.length+' 檔（'+missing.slice(0,8).join(',')+'）；Yahoo 須有同日實際成交金額才能補 OHLC'].join('；'));
 }
 const gaps=await Promise.all(missing.map(code=>diagnoseMissing1494(date,code,st.stocks[code]?.market,env,'日線')));
 const exclusions=[...suspensions.map(s=>({...s,reason:'現金減資停止買賣'})),...gaps];
 for(const {code} of exclusions)rows.delete(code);
 return {date,closed:false,rows:[...rows.values()],sources:[...sources,...exclusions],suspensions:exclusions};
}



export {features,context1494,ingest1494,sync1494,load1494,officialDay,officialChips1494,cutoff,nextDate,nextSession1494};
