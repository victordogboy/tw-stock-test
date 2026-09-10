/* Formal V4.4 Follow-through engine extracted from the confirmed baseline.
   Browser scanner calls combineScores() and entryEngine(); old UI initialization is isolated. */
try {

'use strict';

const API='https://api.finmindtrade.com/api/v4/data';
let STATE={info:[],prices:[],margin:[],inst:[],daytrade:[],stock:null,auditIndex:0,lastAnalysis:null};
const $=id=>document.getElementById(id);
const num=x=>Number(String(x??0).replace(/,/g,''))||0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const fmt=(x,d=1)=>Number.isFinite(x)?Number(x).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=(x,d=1)=>Number.isFinite(x)?`${x>=0?'+':''}${x.toFixed(d)}%`:'—';
const tick=p=>p<10?.01:p<50?.05:p<100?.1:p<500?.5:p<1000?1:5;
const roundTick=p=>{const t=tick(p);return Math.round(p/t)*t};
const dateISO=d=>d.toISOString().slice(0,10);
const today=()=>{const d=new Date();return dateISO(new Date(d.getFullYear(),d.getMonth(),d.getDate()))};
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return dateISO(d)};
const sum=a=>a.reduce((x,y)=>x+y,0);
const avg=a=>a.length?sum(a)/a.length:NaN;
const last=a=>a[a.length-1];
const uniq=a=>[...new Set(a)];
const signClass=x=>x>0?'green':x<0?'red':'yellow';

function setBanner(msg,type='ok'){
  const b=$('banner'); b.className=`banner ${type}`; b.innerHTML=msg; b.style.display='block';
}
function clearBanner(){ $('banner').style.display='none'; }
function setLoading(on,msg='讀取資料中'){
  $('analyzeBtn').disabled=on;
  $('analyzeBtn').innerHTML=on?`<span class="loading"></span>${msg}`:'分析';
}
function scoreGrade(s){
  if(s>=90)return ['S','green']; if(s>=85)return ['A+','green']; if(s>=80)return ['A','green'];
  if(s>=70)return ['B','yellow']; if(s>=60)return ['C','yellow']; return ['D','red'];
}
function positionPct(s){
  if(s>=90)return '25–30%'; if(s>=80)return '15–20%'; if(s>=70)return '10%'; return '0%';
}
async function api(dataset,data_id='',start_date='',end_date=''){
  const u=new URL(API);
  u.searchParams.set('dataset',dataset);
  if(data_id)u.searchParams.set('data_id',data_id);
  if(start_date)u.searchParams.set('start_date',start_date);
  if(end_date)u.searchParams.set('end_date',end_date);
  const token=$('tokenInput').value.trim();
  if(token)u.searchParams.set('token',token);
  const r=await fetch(u.toString(),{method:'GET'});
  if(!r.ok) throw new Error(`${dataset} HTTP ${r.status}`);
  const j=await r.json();
  if(j.status!==200 && j.status!==undefined) throw new Error(j.msg||`${dataset} API status ${j.status}`);
  return Array.isArray(j.data)?j.data:[];
}
async function loadStockInfo(){
  const cached=localStorage.getItem('twq_stockinfo_v2');
  const cacheDay=localStorage.getItem('twq_stockinfo_day');
  if(cached && cacheDay===today()){ try{STATE.info=JSON.parse(cached); if(STATE.info.length)return;}catch(e){} }
  STATE.info=await api('TaiwanStockInfo');
  try{localStorage.setItem('twq_stockinfo_v2',JSON.stringify(STATE.info));localStorage.setItem('twq_stockinfo_day',today())}catch(e){}
}
function resolveStock(q){
  q=q.trim();
  if(!q)return null;
  const exact=STATE.info.find(x=>String(x.stock_id)===q || String(x.stock_name)===q);
  if(exact)return exact;
  const incl=STATE.info.filter(x=>String(x.stock_name||'').includes(q));
  if(incl.length===1)return incl[0];
  if(/^\d{4,6}[A-Za-z]?$/.test(q))return {stock_id:q,stock_name:q,type:'unknown',industry_category:''};
  return incl[0]||null;
}
function normalizePrices(rows){
  return rows.map(r=>({date:r.date,open:num(r.open),high:num(r.max),low:num(r.min),close:num(r.close),volume:num(r.Trading_Volume),money:num(r.Trading_money)}))
    .filter(r=>r.close>0).sort((a,b)=>a.date.localeCompare(b.date));
}
function ma(rows,n,i=rows.length-1){
  if(i<n-1)return NaN;
  return avg(rows.slice(i-n+1,i+1).map(x=>x.close));
}
function smaSeries(rows,n){
  return rows.map((_,i)=>ma(rows,n,i));
}
function ema(values,n){
  const k=2/(n+1); let out=[],e=values[0];
  values.forEach((v,i)=>{e=i===0?v:v*k+e*(1-k);out.push(e)}); return out;
}
function calcRSI(rows,n=14){
  if(rows.length<n+1)return NaN; let g=0,l=0;
  for(let i=rows.length-n;i<rows.length;i++){let d=rows[i].close-rows[i-1].close;if(d>0)g+=d;else l-=d}
  if(l===0)return 100; const rs=(g/n)/(l/n); return 100-100/(1+rs);
}
function calcMACD(rows){
  if(rows.length<35)return {macd:NaN,signal:NaN,hist:NaN,prevHist:NaN};
  const c=rows.map(x=>x.close),e12=ema(c,12),e26=ema(c,26),m=c.map((_,i)=>e12[i]-e26[i]),sig=ema(m,9);
  return {macd:last(m),signal:last(sig),hist:last(m)-last(sig),prevHist:m[m.length-2]-sig[sig.length-2]};
}
function calcKD(rows,n=9){
  if(rows.length<n+2)return {k:NaN,d:NaN,pk:NaN,pd:NaN};
  let k=50,d=50,pk=50,pd=50;
  for(let i=n-1;i<rows.length;i++){
    pk=k;pd=d; const w=rows.slice(i-n+1,i+1),hh=Math.max(...w.map(x=>x.high)),ll=Math.min(...w.map(x=>x.low));
    const rsv=hh===ll?50:(rows[i].close-ll)/(hh-ll)*100; k=(2/3)*k+(1/3)*rsv; d=(2/3)*d+(1/3)*k;
  } return {k,d,pk,pd};
}
function calcBoll(rows,n=20){
  if(rows.length<n)return {mid:NaN,upper:NaN,lower:NaN};
  const a=rows.slice(-n).map(x=>x.close),m=avg(a),sd=Math.sqrt(avg(a.map(x=>(x-m)**2)));
  return {mid:m,upper:m+2*sd,lower:m-2*sd};
}
function atr(rows,n=14){
  if(rows.length<n+1)return NaN; let tr=[];
  for(let i=rows.length-n;i<rows.length;i++) tr.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));
  return avg(tr);
}
function percentile(arr,val){
  const a=arr.filter(Number.isFinite); if(a.length<2)return NaN;
  return a.filter(x=>x<=val).length/a.length*100;
}
function latestAtOrBefore(rows,date){const a=rows.filter(x=>x.date<=date);return a.length?last(a):null}
function cut(rows,date){return rows.filter(x=>x.date<=date)}
function instNetRow(r){
  const keys=['Foreign_Investor','Foreign_Dealer_Self','Investment_Trust','Dealer','Dealer_self','Dealer_Hedging'];
  return sum(keys.map(k=>num(r[k+'_buy'])-num(r[k+'_sell'])));
}
function instDetail(r){
  if(!r)return {foreign:NaN,trust:NaN,dealer:NaN,total:NaN};
  const foreign=num(r.Foreign_Investor_buy)-num(r.Foreign_Investor_sell)+num(r.Foreign_Dealer_Self_buy)-num(r.Foreign_Dealer_Self_sell);
  const trust=num(r.Investment_Trust_buy)-num(r.Investment_Trust_sell);
  const dealer=(num(r.Dealer_buy)-num(r.Dealer_sell))+(num(r.Dealer_self_buy)-num(r.Dealer_self_sell))+(num(r.Dealer_Hedging_buy)-num(r.Dealer_Hedging_sell));
  return {foreign,trust,dealer,total:foreign+trust+dealer};
}
function recentSwingLow(rows,look=35){
  const a=rows.slice(-look); let lows=[];
  for(let i=2;i<a.length-2;i++) if(a[i].low<=a[i-1].low&&a[i].low<=a[i-2].low&&a[i].low<=a[i+1].low&&a[i].low<=a[i+2].low) lows.push(a[i]);
  return lows.length?last(lows):a.reduce((m,x)=>x.low<m.low?x:m,a[0]);
}
function higherLow(rows){
  const a=rows.slice(-60),l=[];
  for(let i=2;i<a.length-2;i++)if(a[i].low<=a[i-1].low&&a[i].low<=a[i-2].low&&a[i].low<=a[i+1].low&&a[i].low<=a[i+2].low)l.push(a[i]);
  if(l.length<2)return {ok:false,a:null,b:null};
  const x=l[l.length-2],y=l[l.length-1];return {ok:y.low>x.low,a:x,b:y};
}
function recentGap(rows){
  const a=rows.slice(-25); let g=null;
  for(let i=1;i<a.length;i++)if(a[i].low>a[i-1].high)g={date:a[i].date,lower:a[i-1].high,upper:a[i].low};
  return g;
}
function supportBelow(price,cands){
  const x=cands.filter(v=>Number.isFinite(v)&&v>0&&v<price).sort((a,b)=>b-a);
  return x.length?x[0]:price*0.96;
}
function computeTargets(rows,entry){
  const prev=rows.slice(-90,-1),cur=last(rows),visibleHigh=prev.length?Math.max(...prev.map(x=>x.high)):cur.high;
  const box=rows.slice(-30),boxHigh=Math.max(...box.map(x=>x.high)),boxLow=Math.min(...box.map(x=>x.low)),range=Math.max(boxHigh-boxLow,atr(rows)*4||entry*.08);
  if(cur.close>=visibleHigh*0.995){
    return {t1:roundTick(entry+range*.618),t2:roundTick(entry+range*1.618),mode:'可視區間新高：箱體 0.618 / 1.618 延伸'};
  }
  let t1=visibleHigh>entry?visibleHigh:entry+range*.618;
  return {t1:roundTick(t1),t2:roundTick(Math.max(t1+range*.618,entry+range*1.2)),mode:'左側可視前高 + 延伸'};
}
function riskRR(entry,stop,t1,t2){
  const risk=(entry-stop)/entry*100,den=entry-stop;
  return {risk,rr1:den>0?(t1-entry)/den:NaN,rr2:den>0?(t2-entry)/den:NaN};
}
function evaluate(rows,margin,inst,daytrade,entryMode='market'){
  const cur=last(rows),close=cur.close,ma5=ma(rows,5),ma10=ma(rows,10),ma20=ma(rows,20),ma60=ma(rows,60);
  const hl=higherLow(rows),swing=recentSwingLow(rows),gap=recentGap(rows);
  const prevHigh=Math.max(...rows.slice(-61,-1).map(x=>x.high));
  const breakoutSupport=close>prevHigh ? prevHigh : NaN;
  let candidates=uniq([ma5,ma10,ma20,breakoutSupport,gap?.lower].filter(Number.isFinite).map(roundTick)).filter(x=>x<close*1.002&&x>close*.82);
  if(!candidates.length)candidates=[roundTick(ma10||close*.97)];
  const baseStopFor=(entry)=>roundTick(supportBelow(entry,[ma20,ma10,hl.b?.low,swing?.low,breakoutSupport]) - tick(entry));
  let best=null;
  for(const e0 of candidates){
    const e=roundTick(e0),stop=baseStopFor(e),tg=computeTargets(rows,e),rr=riskRR(e,stop,tg.t1,tg.t2);
    let s=100-Math.max(0,rr.risk-4)*5 + Math.min(8,Math.max(-8,(rr.rr2-3)*4));
    if(rr.risk<=4)s+=5;if(rr.rr1>=1.5)s+=4;if(rr.rr2>=3)s+=6;
    if(!best||s>best.rank)best={entry:e,stop,...tg,...rr,rank:s};
  }
  const marketEntry=close;
  const marketStop=baseStopFor(marketEntry),marketT=computeTargets(rows,marketEntry),marketRR=riskRR(marketEntry,marketStop,marketT.t1,marketT.t2);
  const entry=entryMode==='optimal'?best.entry:marketEntry;
  const stop=entryMode==='optimal'?best.stop:marketStop;
  const tg=entryMode==='optimal'?best:({...marketT,...marketRR});
  const bias=(entry-ma20)/ma20*100;
  const vol5=avg(rows.slice(-6,-1).map(x=>x.volume)),volRatio=vol5?cur.volume/vol5:NaN;
  const rsi=calcRSI(rows),macd=calcMACD(rows),kd=calcKD(rows),boll=calcBoll(rows);
  const day=latestAtOrBefore(daytrade,cur.date),dayRatio=day&&cur.volume?num(day.Volume)/cur.volume*100:NaN;
  const m=latestAtOrBefore(margin,cur.date);
  const mVals=margin.slice(-90).map(x=>num(x.MarginPurchaseTodayBalance)).filter(x=>x>0);
  const marginPct=m?percentile(mVals,num(m.MarginPurchaseTodayBalance)):NaN;
  const marginChg=m&&num(m.MarginPurchaseYesterdayBalance)?(num(m.MarginPurchaseTodayBalance)-num(m.MarginPurchaseYesterdayBalance))/num(m.MarginPurchaseYesterdayBalance)*100:NaN;
  const ir=latestAtOrBefore(inst,cur.date),id=instDetail(ir),instConc=cur.volume?id.total/cur.volume*100:NaN;
  let cum=0,incs=inst.slice(-90).map(x=>cum+=instNetRow(x)),instPct=incs.length?percentile(incs,last(incs)):NaN;
  const body=Math.abs(cur.close-cur.open),range=Math.max(cur.high-cur.low,tick(cur.close)),upper=cur.high-Math.max(cur.open,cur.close),longUpper=upper/range>.45;
  const black=cur.close<cur.open,swallow=rows.length>1&&black&&cur.open>rows[rows.length-2].close&&cur.close<rows[rows.length-2].open;
  const hardBroken=cur.close<Math.min(ma10,ma20) || (hl.b&&cur.close<hl.b.low*.995);
  const prior5=rows.slice(-6,-1),priorVol=avg(prior5.map(x=>x.volume));
  const dry=volRatio<.65,attack=volRatio>=1.5&&cur.close>cur.open;
  const scoreItems=[];
  const add=(name,max,score,text,state='ok',available=true)=>scoreItems.push({name,max,score:available?clamp(score,0,max):null,text,state,available});

  let f1=0;if(close>ma20)f1+=3;if(ma5>ma10&&ma10>ma20)f1+=3;if(ma20>ma60)f1+=2;
  const ded20=rows.length>20?rows[rows.length-20].close:NaN;if(close>ded20)f1+=2;if(ma20>ma(rows.slice(0,-1),20))f1+=2;
  add('1. 均線幾何 / 扣抵',12,f1,`MA5 ${fmt(ma5)} / MA10 ${fmt(ma10)} / MA20 ${fmt(ma20)}；20MA 扣抵 ${fmt(ded20)}，${close>ded20?'扣低翻揚有利':'扣高壓力偏大'}`,f1>=8?'ok':f1>=5?'warn':'bad');

  let f2=2;if(hl.ok)f2+=3;if(close>prevHigh)f2+=2;if(cur.close>cur.open)f2+=1;if(longUpper||swallow)f2-=4;
  add('2. K線 / HL / 真偽突破',9,f2,`${hl.ok?'形成 Higher Low':'HL 尚未明確'}；${close>prevHigh?'突破可視前高':'未突破 60T 前高'}${longUpper?'；長上影風險':''}${swallow?'；黑K吞噬':''}`,f2>=6?'ok':f2>=3?'warn':'bad');

  let f3=3;if(attack)f3+=4;if(dry&&close>=ma10*.98)f3+=3;if(cur.volume<300000)f3-=5;
  add('3. 成交量 / 量價',9,f3,`今日量 ${(cur.volume/1000).toFixed(0)} 張；對 5T 均量 ${volRatio.toFixed(2)}x；${attack?'攻擊放量':dry?'量縮沉澱':'量能一般'}`,f3>=6?'ok':f3>=3?'warn':'bad');

  let f4=2;if(gap&&close>gap.lower)f4+=3;if(gap&&close<gap.lower)f4=0;if(close>ma5)f4+=1;
  add('4. 跳空缺口 / 貼身防守',6,f4,gap?`最近多方缺口 ${gap.date}，下緣 ${fmt(gap.lower)}；${close>gap.lower?'尚守住':'已跌破'}`:`近 25T 未偵測到明顯多方缺口；以 MA5/平台防守`,f4>=4?'ok':f4>=2?'warn':'bad');

  const f5Avail=!!ir;let f5=0;if(f5Avail){if(instConc>15)f5=8;else if(instConc>5)f5=6;else if(instConc>0)f5=4;else if(instConc<-10&&black)f5=0;else f5=2}
  add('5. 主力集中度代理',8,f5,f5Avail?`三大法人淨買賣 / 成交量 = ${pct(instConc)}。注意：這是法人集中代理，不是券商分點主力集中度。`:'法人資料未取得',f5>=5?'ok':f5>=3?'warn':'bad',f5Avail);

  const f6Avail=Number.isFinite(dayRatio);let f6=f6Avail?(dayRatio>50?1:dayRatio>35?3:5):0;
  add('6. 當沖率',5,f6,f6Avail?`當沖成交量占總量約 ${fmt(dayRatio,1)}%；${dayRatio>50?'籌碼穩定性偏低':'未觸發 >50% 警戒'}`:'當沖資料尚未更新/未提供',f6>=4?'ok':f6>=2?'warn':'bad',f6Avail);

  const f7Avail=!!m&&!!ir;let f7=0;if(f7Avail){f7+=(marginPct<30?5:marginPct<60?3:1);f7+=(instPct>70?5:instPct>40?3:1)}
  add('7. 融資 / 法人黃線百分位',10,f7,f7Avail?`融資餘額 ${num(m.MarginPurchaseTodayBalance).toLocaleString()} 張，90T 百分位 ${fmt(marginPct,0)}%；法人累積淨額 90T 百分位 ${fmt(instPct,0)}%`:'融資或法人序列不足',f7>=7?'ok':f7>=4?'warn':'bad',f7Avail);

  const f8Avail=!!ir;let f8=0;if(f8Avail){if(id.foreign>0)f8+=3;if(id.trust>0)f8+=3;if(id.dealer>0)f8+=2}
  add('8. 三大法人分類動向',8,f8,f8Avail?`外資 ${fmt(id.foreign/1000,0)} 張｜投信 ${fmt(id.trust/1000,0)} 張｜自營商 ${fmt(id.dealer/1000,0)} 張`:'法人資料未取得',f8>=5?'ok':f8>=3?'warn':'bad',f8Avail);

  add('9. 大戶持股 vs 散戶持股',5,0,'免費資料未取得「千張大戶持股比例 / 散戶股東人數」；本維度保留但不計分，不用法人/融資冒充真實股權分散。','warn',false);

  let f10=0;if(rsi>45&&rsi<72)f10+=2;if(macd.hist>0)f10+=2;if(macd.hist>macd.prevHist)f10+=1;if(kd.k>kd.d&&kd.k<85)f10+=1;if(close<boll.upper*1.01)f10+=1;
  add('10. KD / MACD / RSI / 布林',7,f10,`RSI14 ${fmt(rsi,1)}｜MACD Hist ${fmt(macd.hist,2)}｜KD ${fmt(kd.k,0)}/${fmt(kd.d,0)}｜布林上軌 ${fmt(boll.upper)}`,f10>=5?'ok':f10>=3?'warn':'bad');

  const risk=tg.risk;let f11=risk<=4?8:risk<=7?5:1;
  add('11. 防守深度 Risk%',8,f11,`進場 ${fmt(entry)} → 結構停損 ${fmt(stop)}，Risk ${fmt(risk,2)}%`,f11>=7?'ok':f11>=4?'warn':'bad');

  let f12=0;if(tg.rr1>=1.5)f12+=3;if(tg.rr2>=3)f12+=5;
  add('12. Target 1 / 2 與 R:R',8,f12,`T1 ${fmt(tg.t1)} = ${fmt(tg.rr1,2)}R｜T2 ${fmt(tg.t2)} = ${fmt(tg.rr2,2)}R；${tg.mode}`,f12>=6?'ok':f12>=3?'warn':'bad');

  let f13=5;if(hardBroken)f13=0;
  add('13. 防禦出場 / SOP',5,f13,hardBroken?'價格已摜破關鍵結構，買訊作廢。':`第一道以 MA5/缺口/突破平台減碼；第二道 ${fmt(stop)} 硬停損；隔日低開摜破前低或 MA5 作廢`,hardBroken?'bad':'ok');

  const availableMax=sum(scoreItems.filter(x=>x.available).map(x=>x.max));
  const got=sum(scoreItems.filter(x=>x.available).map(x=>x.score));
  let raw=availableMax?got/availableMax*100:0;
  if(bias>25)raw=Math.min(raw,58); else if(bias>15)raw=Math.min(raw,69);
  if(longUpper&&volRatio>1.5)raw=Math.min(raw,45);
  if(hardBroken)raw=0;
  const confidence=availableMax;
  return {
    score:Math.round(raw),items:scoreItems,availableMax,confidence,ma5,ma10,ma20,ma60,bias,volRatio,rsi,macd,kd,boll,hl,gap,
    entry,stop,t1:tg.t1,t2:tg.t2,risk:tg.risk,rr1:tg.rr1,rr2:tg.rr2,best,marketRR,marginPct,marginChg,instPct,instConc,id,dayRatio,
    hardBroken,longUpper,attack,dry,breakoutSupport,swing,prevHigh
  };
}

function localLows(rows,look=80){
  const a=rows.slice(-look),out=[];
  for(let i=2;i<a.length-2;i++){
    if(a[i].low<=a[i-1].low&&a[i].low<=a[i-2].low&&a[i].low<=a[i+1].low&&a[i].low<=a[i+2].low){
      out.push({idx:rows.length-a.length+i,row:a[i]});
    }
  }
  return out;
}
function rsiAt(rows,idx,n=14){
  if(idx<n)return NaN;
  return calcRSI(rows.slice(0,idx+1),n);
}
function macdAt(rows,idx){
  if(idx<35)return {hist:NaN};
  return calcMACD(rows.slice(0,idx+1));
}
function bottomReversalEngine(rows,margin,inst,daytrade){
  const cur=last(rows), close=cur.close;
  const ma5v=ma(rows,5),ma10v=ma(rows,10),ma20v=ma(rows,20),ma60v=ma(rows,60);
  const rsi=calcRSI(rows),kd=calcKD(rows),macd=calcMACD(rows),boll=calcBoll(rows);
  const vol5=avg(rows.slice(-6,-1).map(x=>x.volume)),volRatio=vol5?cur.volume/vol5:NaN;
  const lows=localLows(rows,90),L2=lows.length?last(lows):null,L1=lows.length>1?lows[lows.length-2]:null;
  const low20=Math.min(...rows.slice(-20).map(x=>x.low)),low60=Math.min(...rows.slice(-60).map(x=>x.low));
  const high60=Math.max(...rows.slice(-60).map(x=>x.high));
  const drawdown=(close-high60)/high60*100;
  const bias20=(close-ma20v)/ma20v*100;
  const nearLow=(close-low60)/low60*100;
  const prev=rows[rows.length-2];
  const lowerWick=Math.min(cur.open,cur.close)-cur.low,range=Math.max(cur.high-cur.low,tick(close));
  const longLower=lowerWick/range>=0.35;
  const bullish=cur.close>cur.open;
  const reclaim5=cur.close>ma5v && prev.close<=ma(rows,5,rows.length-2);
  const reclaim10=cur.close>ma10v && prev.close<=ma(rows,10,rows.length-2);
  const panicVol=cur.volume>vol5*1.8 && cur.close>cur.low+(range*.55);
  const attack=volRatio>=1.35&&bullish;
  const dry=volRatio<=.70;
  const kdCross=kd.k>kd.d&&kd.pk<=kd.pd;
  const macdImprove=macd.hist>macd.prevHist;
  const rsiRecover=rsi>=30&&rsi<=58;

  // Price/momentum bullish divergence: second price low <= first, while RSI/MACD improves.
  let divergence=false,divText='未形成可確認底背離';
  if(L1&&L2&&L2.idx>L1.idx+3){
    const r1=rsiAt(rows,L1.idx),r2=rsiAt(rows,L2.idx);
    const h1=macdAt(rows,L1.idx).hist,h2=macdAt(rows,L2.idx).hist;
    const priceLower=L2.row.low<=L1.row.low*1.015;
    divergence=priceLower && ((Number.isFinite(r1)&&Number.isFinite(r2)&&r2>r1+2) || (Number.isFinite(h1)&&Number.isFinite(h2)&&h2>h1));
    divText=`低點 ${fmt(L1.row.low)} → ${fmt(L2.row.low)}；RSI ${fmt(r1,1)} → ${fmt(r2,1)}${divergence?'，出現動能底背離':'，背離不足'}`;
  }

  // Margin cleansing: compare latest to ~20 observations ago.
  const mm=margin.filter(x=>x.date<=cur.date),mNow=mm.length?num(last(mm).MarginPurchaseTodayBalance):NaN;
  const mOld=mm.length>15?num(mm[Math.max(0,mm.length-20)].MarginPurchaseTodayBalance):NaN;
  const mClean=Number.isFinite(mNow)&&Number.isFinite(mOld)&&mOld>0?(mNow-mOld)/mOld*100:NaN;
  const ii=inst.filter(x=>x.date<=cur.date),inst5=sum(ii.slice(-5).map(instNetRow)),instPrev5=sum(ii.slice(-10,-5).map(instNetRow));
  const instTurning=ii.length>=5 && (inst5>0 || inst5>instPrev5);

  // 6 independent factor groups = 100 points.
  let over=0;
  if(drawdown<=-15)over+=7; else if(drawdown<=-8)over+=4;
  if(bias20<=-10)over+=5; else if(bias20<=-5)over+=3;
  if(rsi<35)over+=5; else if(rsi<42)over+=3;
  if(close<=boll.lower*1.03)over+=3;
  over=clamp(over,0,20);

  let stopStruct=0;
  if(nearLow<=8)stopStruct+=4;
  if(longLower)stopStruct+=4;
  if(L1&&L2&&L2.row.low>=L1.row.low*.985)stopStruct+=6;
  if(reclaim5)stopStruct+=3;
  if(reclaim10)stopStruct+=3;
  stopStruct=clamp(stopStruct,0,20);

  let volume=0;
  if(panicVol)volume+=7;
  if(dry&&close>=low20*1.02)volume+=5;
  if(attack)volume+=8;
  else if(volRatio>=1.05&&bullish)volume+=4;
  volume=clamp(volume,0,20);

  let momentum=0;
  if(kdCross)momentum+=4;
  if(rsiRecover)momentum+=3;
  if(macdImprove)momentum+=3;
  if(divergence)momentum+=5;
  momentum=clamp(momentum,0,15);

  let chip=0,chipAvail=0;
  if(Number.isFinite(mClean)){chipAvail+=8;if(mClean<=-10)chip+=8;else if(mClean<=-4)chip+=5;else if(mClean<2)chip+=3}
  if(ii.length>=5){chipAvail+=7;if(instTurning)chip+=7;else if(inst5>instPrev5)chip+=4}
  // Missing chip data is neutral via normalization within this factor, capped at 15.
  chip = chipAvail ? chip/chipAvail*15 : 7.5;

  // Bottom stop: most recent structural low, with one tick buffer.
  const structLow=L2?.row.low || low20;
  const stop=roundTick(structLow-tick(structLow));
  const risk=(close-stop)/close*100;
  const resistance=Math.max(ma20v,ma60v,Math.max(...rows.slice(-30,-1).map(x=>x.high)));
  const reward=Math.max(0,resistance-close);
  const rr=(close-stop)>0?reward/(close-stop):0;
  let riskPts=0;
  if(risk>0&&risk<=4)riskPts+=5;else if(risk<=6.5)riskPts+=3;
  if(rr>=3)riskPts+=5;else if(rr>=1.8)riskPts+=3;else if(rr>=1.2)riskPts+=1;
  riskPts=clamp(riskPts,0,10);

  const factors=[
    ['超跌程度',over,20,`60T 高點回撤 ${pct(drawdown)}｜20MA Bias ${pct(bias20)}｜RSI ${fmt(rsi,1)}`],
    ['止跌結構',stopStruct,20,`${longLower?'長下影｜':''}${reclaim5?'站回MA5｜':''}${reclaim10?'站回MA10｜':''}${L1&&L2?`雙低 ${fmt(L1.row.low)} / ${fmt(L2.row.low)}`:'低點結構不足'}`],
    ['量價轉折',volume,20,`量比 ${fmt(volRatio,2)}x｜${panicVol?'恐慌換手':''}${dry?'量縮':''}${attack?'反攻放量':''}`],
    ['動能轉折',momentum,15,`KD ${fmt(kd.k,0)}/${fmt(kd.d,0)}｜MACD Hist ${fmt(macd.hist,2)}｜${divText}`],
    ['籌碼清洗',chip,15,`近20筆融資 ${Number.isFinite(mClean)?pct(mClean):'N/A'}｜近5日法人 ${fmt(inst5/1000,0)} 張`],
    ['底部風報比',riskPts,10,`前低停損 ${fmt(stop)}｜Risk ${fmt(risk,2)}%｜第一壓力 ${fmt(resistance)}｜R:R ${fmt(rr,2)}`]
  ];
  let score=Math.round(sum(factors.map(x=>x[1])));
  // Avoid calling a mature uptrend a "bottom" merely because momentum is strong.
  if(bias20>8 && nearLow>15) score=Math.min(score,64);
  // Falling knife veto: new 60d low + weak close + no divergence/reclaim.
  const fallingKnife=cur.low<=low60 && cur.close<cur.open && !divergence && !reclaim5;
  if(fallingKnife)score=Math.min(score,35);

  let stage='底部雷達',cls='yellow',position='0%';
  const rightFoot=L1&&L2&&L2.row.low>=L1.row.low*.985;
  const trigger=(reclaim10||attack) && (divergence||rightFoot||longLower);
  if(fallingKnife){stage='下跌刀口';cls='red';position='0%'}
  else if(score>=82 && trigger && risk<=6.5){stage='底部反轉買進';cls='green';position='15–20%'}
  else if(score>=70 && (rightFoot||divergence) && risk<=6.5){stage='底部試單';cls='green';position='5–10%'}
  else if(score>=58 && (longLower||reclaim5||macdImprove)){stage='止跌觀察';cls='yellow';position='0–5%'}
  else if(over>=10){stage='超跌雷達';cls='yellow';position='0%'}
  else {stage='非底部型態';cls='yellow';position='0%'}

  return {score,stage,cls,position,factors,stop,risk,rr,resistance,divergence,rightFoot,reclaim5,reclaim10,attack,fallingKnife,mClean,inst5,drawdown,bias20};
}


function ignitionEngine(rows,margin,inst){
  const cur=last(rows), prev=rows[rows.length-2], close=cur.close;
  const m5=ma(rows,5),m10=ma(rows,10),m20=ma(rows,20),m60=ma(rows,60);
  const pm5=ma(rows,5,rows.length-2),pm10=ma(rows,10,rows.length-2);
  const ret=(n)=>rows.length>n?(close/rows[rows.length-1-n].close-1)*100:NaN;
  const r3=ret(3),r5=ret(5),r10=ret(10);
  const prev10High=Math.max(...rows.slice(-11,-1).map(x=>x.high));
  const prev20High=Math.max(...rows.slice(-21,-1).map(x=>x.high));
  const break10=close>prev10High*.995, break20=close>prev20High*.995;
  const vol5=avg(rows.slice(-6,-1).map(x=>x.volume)), vr=vol5?cur.volume/vol5:NaN;
  const loc=(cur.close-cur.low)/Math.max(cur.high-cur.low,tick(close));
  const dayRet=(cur.close/prev.close-1)*100;
  const strongDays=rows.slice(-5).reduce((n,r,idx,a)=>{
    if(idx===0){
      const gi=rows.length-5;
      const p=rows[gi-1];
      return n+(p && (r.close/p.close-1)*100>=4 ? 1:0);
    }
    return n+((r.close/a[idx-1].close-1)*100>=4?1:0);
  },0);

  // Latest impulse candle in last 6 sessions.
  let impulse=null;
  for(let k=Math.max(1,rows.length-6);k<rows.length;k++){
    const p=rows[k-1],r=rows[k],dr=(r.close/p.close-1)*100;
    const priorVol=avg(rows.slice(Math.max(0,k-5),k).map(x=>x.volume));
    const rv=priorVol?r.volume/priorVol:1;
    if(dr>=4.5 && r.close>=r.open && rv>=1.0) impulse={idx:k,row:r,dr,rv};
  }
  const supportCandidates=[m5,m10,impulse?.row.low,prev10High].filter(Number.isFinite).filter(x=>x<close);
  const support=supportCandidates.length?Math.max(...supportCandidates):close*.93;
  const stop=roundTick(support-tick(support));
  const risk=(close-stop)/close*100;

  const ii=inst.filter(x=>x.date<=cur.date);
  const inst5=sum(ii.slice(-5).map(instNetRow)), instPrev=sum(ii.slice(-10,-5).map(instNetRow));
  const instImprove=ii.length>=5 && (inst5>0 || inst5>instPrev);

  const mm=margin.filter(x=>x.date<=cur.date);
  let mchg=NaN;
  if(mm.length>=6){
    const now=num(last(mm).MarginPurchaseTodayBalance),old=num(mm[mm.length-6].MarginPurchaseTodayBalance);
    if(old>0)mchg=(now-old)/old*100;
  }

  let momentum=0;
  if(r3>=8)momentum+=10; else if(r3>=5)momentum+=6;
  if(r5>=12)momentum+=8; else if(r5>=7)momentum+=5;
  if(r10>=18)momentum+=5; else if(r10>=10)momentum+=3;
  if(strongDays>=2)momentum+=2;
  momentum=clamp(momentum,0,25);

  let structure=0;
  if(close>m5)structure+=5;
  if(close>m10)structure+=5;
  if(break10)structure+=6;
  if(break20)structure+=5;
  if(loc>=.70)structure+=4;
  structure=clamp(structure,0,25);

  let volume=0;
  if(vr>=1.5)volume+=10; else if(vr>=1.15)volume+=7; else if(vr>=.9)volume+=4;
  if(dayRet>=4&&cur.close>cur.open)volume+=6;
  if(strongDays>=2)volume+=4;
  volume=clamp(volume,0,20);

  let maTurn=0;
  if(m5>pm5)maTurn+=6;
  if(m10>pm10)maTurn+=4;
  if(m5>m10)maTurn+=3;
  if(close>m20)maTurn+=2;
  // No MA20 > MA60 requirement here on purpose.
  maTurn=clamp(maTurn,0,15);

  let chip=0,chipAvail=0;
  if(ii.length>=5){chipAvail+=6;if(instImprove)chip+=6;else if(inst5>instPrev)chip+=3}
  if(Number.isFinite(mchg)){chipAvail+=4;if(mchg<=3)chip+=4;else if(mchg<=8)chip+=2}
  chip=chipAvail?chip/chipAvail*10:5;

  let riskPts=0;
  if(risk>0&&risk<=5)riskPts=5;
  else if(risk<=7.5)riskPts=4;
  else if(risk<=9)riskPts=2;
  riskPts=clamp(riskPts,0,5);

  const factors=[
    ['3/5/10日動能',momentum,25,`3日 ${pct(r3)}｜5日 ${pct(r5)}｜10日 ${pct(r10)}｜近5日強勢日 ${strongDays}`],
    ['價格發動結構',structure,25,`${break10?'突破10T高｜':''}${break20?'突破20T高｜':''}收盤位置 ${fmt(loc*100,0)}%｜MA5 ${fmt(m5)} / MA10 ${fmt(m10)}`],
    ['攻擊量價',volume,20,`今日 ${pct(dayRet)}｜量比 ${fmt(vr,2)}x｜${cur.close>cur.open?'紅K':'黑K'}`],
    ['短均線轉折',maTurn,15,`MA5 ${m5>pm5?'↑':'↓'}｜MA10 ${m10>pm10?'↑':'↓'}｜${close>m20?'已站回MA20':'MA20仍在上方，不直接否決'}`],
    ['籌碼確認',chip,10,`5日法人 ${fmt(inst5/1000,0)} 張｜5筆融資 ${Number.isFinite(mchg)?pct(mchg):'N/A'}`],
    ['發動停損風險',riskPts,5,`動能防守 ${fmt(stop)}｜Risk ${fmt(risk,2)}%`]
  ];
  let score=Math.round(sum(factors.map(x=>x[1])));

  // Avoid one-day dead-cat bounce: require the short-term tape to actually improve.
  const recentLow=Math.min(...rows.slice(-4).map(x=>x.low));
  const oldLow=Math.min(...rows.slice(-10,-4).map(x=>x.low));
  const noNewLow=recentLow>=oldLow*.97 || close>m5;
  const trigger=(break10 || r3>=8 || (strongDays>=2&&r5>=8)) && close>m5 && loc>=.55 && noNewLow;

  let stage='未發動',cls='yellow',position='0%';
  if(score>=74 && trigger && risk<=9){
    stage='反轉發動買進';cls='green';position='10–15%';
  }else if(score>=62 && trigger && risk<=10){
    stage='動能試單';cls='green';position='5–10%';
  }else if(score>=55 && (r3>=5||break10)){
    stage='發動觀察';cls='yellow';position='0–5%';
  }
  return {score,stage,cls,position,factors,stop,risk,r3,r5,r10,break10,break20,vr,strongDays,trigger,inst5,mchg};
}

function classifySetup(rows,a,o){
  const cur=last(rows), prev=rows[rows.length-2];
  const vol5=avg(rows.slice(-6,-1).map(x=>x.volume));
  const volRatio=vol5?cur.volume/vol5:NaN;
  const priorHigh=Math.max(...rows.slice(-41,-1).map(x=>x.high));
  const breakout = cur.close > priorHigh*0.995 && cur.close >= cur.open && volRatio >= 1.15;
  const nearMA10 = Math.abs(cur.close-a.ma10)/cur.close <= 0.025;
  const nearMA20 = Math.abs(cur.close-a.ma20)/cur.close <= 0.035;
  const pullback = cur.close >= a.ma20*0.985 && (nearMA10 || nearMA20) && cur.close >= cur.open*0.985;
  const bullishMA = a.ma5>a.ma10 && a.ma10>a.ma20 && a.ma20>=a.ma60*0.995;
  const structureOK = !a.hardBroken && cur.close >= a.ma20*0.985;
  const overheat = a.bias>18;
  const severeRR = a.rr2<1.5;
  const riskTooHigh = a.risk>8.5;

  // Hard veto only for real structural invalidation / extreme risk.
  if(a.hardBroken || riskTooHigh || severeRR){
    return {state:'NO TRADE',cls:'red',reason:'結構破壞、風險距離過大或中期報酬空間不足'};
  }

  // Breakout setup: allow lower T1 RR if T2 and structure support the move.
  if(breakout && bullishMA && a.score>=72 && a.rr2>=2.2 && a.risk<=6.5 && !overheat){
    return {state:'突破買進',cls:'green',reason:'突破左側前高、量能放大、均線多頭且風險可控'};
  }

  // Pullback setup: reward low-risk entries near rising short/medium MAs.
  if(pullback && bullishMA && o.score>=80 && o.risk<=5.5 && o.rr2>=2.5){
    return {state:'回測買進',cls:'green',reason:'回測 MA10/20 或平台附近，結構未破且風報比改善'};
  }

  // Small probe position when structure is constructive but trigger is incomplete.
  if(structureOK && bullishMA && a.score>=68 && a.risk<=6.5 && a.rr2>=2.0 && a.bias<=15){
    return {state:'試單',cls:'yellow',reason:'結構偏多但突破/回測觸發尚未完整，可小倉位試單'};
  }

  // Constructive but current price is not ideal.
  if(structureOK && o.score>=75){
    return {state:'等待回測',cls:'yellow',reason:'股票結構尚可，但現價安全邊際不足，等候較佳掛單區'};
  }

  return {state:'觀望',cls:'yellow',reason:'尚未出現足夠強的突破或回測訊號'};
}

function combineScores(rows,m,i,d){
  const market=evaluate(rows,m,i,d,'market');
  const optimal=evaluate(rows,m,i,d,'optimal');
  const bottom=bottomReversalEngine(rows,m,i,d);
  const ignition=ignitionEngine(rows,m,i);
  // V1.9.1 Setup only measures structure quality.
  let quality=Math.round(market.score*0.65+optimal.score*0.35);
  quality=clamp(quality,0,100);
  const setup=classifySetup(rows,market,optimal);
  const noTrade=setup.state==='NO TRADE'
    && !['底部反轉買進','底部試單'].includes(bottom.stage)
    && !['反轉發動買進','動能試單'].includes(ignition.stage);
  return {market,optimal,bottom,ignition,quality,noTrade,setup};
}

/* ===== V4.4 Entry Engine =====
   目的：把「股票品質 / 持有品質」與「現在這個價位是否值得進場」分離。
   僅使用審計日及其左側資料，維持 Strict No-Lookahead｜V4 Entry / Hold 分離。
*/
function entryEngine(rows,R){
  const a=R.market,b=R.bottom,ig=R.ignition,cur=last(rows),prev=rows[rows.length-2]||cur;
  const close=cur.close, pclose=prev.close||close;
  const pm5=ma(rows,5,rows.length-2),pm10=ma(rows,10,rows.length-2),pm20=ma(rows,20,rows.length-2);
  const vr=avg(rows.slice(-6,-1).map(x=>x.volume))?cur.volume/avg(rows.slice(-6,-1).map(x=>x.volume)):1;
  const ret1=(close/pclose-1)*100;
  const ret3=rows.length>3?(close/rows[rows.length-4].close-1)*100:0;
  const ret5=rows.length>5?(close/rows[rows.length-6].close-1)*100:0;
  const d5=(close-a.ma5)/close*100, d10=(close-a.ma10)/close*100;
  const atrv=atr(rows), atrPct=atrv/close*100;
  const range=Math.max(cur.high-cur.low,tick(close)), body=Math.abs(cur.close-cur.open);
  const closeLoc=(cur.close-cur.low)/range, bodyPct=body/range;
  const bullish=cur.close>cur.open, hl=higherLow(rows).ok;
  const reclaim5=close>a.ma5&&pclose<=pm5, reclaim10=close>a.ma10&&pclose<=pm10;
  const ma5turn=a.ma5>pm5, ma10turn=a.ma10>pm10, ma20turn=a.ma20>pm20;
  const prev10High=Math.max(...rows.slice(-11,-1).map(x=>x.high));
  const prev20High=Math.max(...rows.slice(-21,-1).map(x=>x.high));
  const break10=close>prev10High, breakout=close>prev20High;
  const limitLike=ret1>=8.5;
  const impulseDay=bullish&&closeLoc>=.65&&((ret1>=5&&vr>=1.05)||(ret1>=3.5&&vr>=1.35));
  const shock=limitLike&&bullish&&closeLoc>=.65;

  // 事件新鮮度：過去5日強K數量。第一根與第三根不能同樣評價。
  let strongDays=0;
  for(let k=Math.max(1,rows.length-5);k<rows.length;k++){
    const r=rows[k],p=rows[k-1],dr=(r.close/p.close-1)*100;
    if(dr>=4.5&&r.close>=r.open)strongDays++;
  }
  const freshEvent=impulseDay&&strongDays<=2;

  // Opportunity = 「這裡是否可能開始一段行情」，不等於現在價格安全。
  let opportunity=0;
  opportunity+=Math.min(22,ig.score*.22);
  opportunity+=Math.min(14,b.score*.14);
  if(shock)opportunity+=28; else if(ret1>=6)opportunity+=21; else if(ret1>=4)opportunity+=14;
  if(vr>=1.8)opportunity+=12; else if(vr>=1.3)opportunity+=9; else if(vr>=1.05)opportunity+=5;
  if(breakout)opportunity+=12; else if(break10)opportunity+=7;
  if(closeLoc>=.75)opportunity+=5;
  if(ma5turn)opportunity+=4;
  if(reclaim5||reclaim10)opportunity+=5;
  if(ret3>=8&&ret3<=18)opportunity+=5;
  if(freshEvent)opportunity+=5;
  if(a.hardBroken&&!shock)opportunity-=25;
  opportunity=clamp(Math.round(opportunity),0,100);

  // Entry Quality = 「今天這個價位下單是否划算」。
  let entryQuality=0;
  if(a.risk<=3)entryQuality+=20; else if(a.risk<=4.5)entryQuality+=16; else if(a.risk<=6.5)entryQuality+=11; else if(a.risk<=8)entryQuality+=5;
  if(a.rr1>=1.5)entryQuality+=8; else if(a.rr1>=1.1)entryQuality+=4;
  if(a.rr2>=3)entryQuality+=12; else if(a.rr2>=2)entryQuality+=8; else if(a.rr2>=1.5)entryQuality+=4;
  if(Math.abs(d5)<=3)entryQuality+=9; else if(Math.abs(d5)<=5)entryQuality+=6; else if(Math.abs(d5)<=7)entryQuality+=2;
  if(Math.abs(d10)<=5)entryQuality+=6;
  if(hl)entryQuality+=6;
  if(reclaim5||reclaim10)entryQuality+=7;
  if(ma5turn)entryQuality+=5;
  if(ma10turn)entryQuality+=3;
  if(vr>=.8&&vr<=1.6)entryQuality+=5;
  if(atrPct<=4.5)entryQuality+=4; else if(atrPct<=6.5)entryQuality+=2;
  entryQuality+=Math.min(10,Math.max(b.score,ig.score)*.10);

  // 強事件可以證明「值得注意」，但只給 Entry 一小段確認分，不直接送到90。
  if(impulseDay)entryQuality+=8;
  if(breakout)entryQuality+=5;

  const chaseReasons=[]; let chase=0;
  if(ret5>=22){chase+=10;chaseReasons.push('5日累積漲幅過大')}
  else if(ret3>=18){chase+=7;chaseReasons.push('3日累積漲幅過大')}
  if(d5>=8){chase+=8;chaseReasons.push('距MA5過遠')}
  else if(d5>=6){chase+=4;chaseReasons.push('距MA5偏遠')}
  if(a.bias>15){chase+=7;chaseReasons.push('20MA乖離>15%')}
  if(strongDays>=3){chase+=6;chaseReasons.push('5日內多次強K，已非第一發動')}
  if(closeLoc<.45&&ret1>3){chase+=5;chaseReasons.push('強漲但收盤位置弱')}
  // 第一根真正的 shock 只豁免「當日突然乖離」，不豁免前面已經連漲。
  if(shock&&freshEvent&&ret3<18)chase=Math.max(0,chase-5);

  entryQuality=clamp(Math.round(entryQuality-chase),0,100);

  // Confirmation：要到高品質進場，不能只靠一根K。
  let confirmation=0;
  if(ma5turn)confirmation+=18;
  if(ma10turn)confirmation+=14;
  if(ma20turn)confirmation+=8;
  if(break10)confirmation+=15;
  if(breakout)confirmation+=12;
  if(hl)confirmation+=12;
  if(reclaim10)confirmation+=10; else if(reclaim5)confirmation+=6;
  if(vr>=1.05&&vr<=2.2)confirmation+=6;
  if(closeLoc>=.65)confirmation+=5;
  confirmation=clamp(Math.round(confirmation),0,100);

  // ===== V4.4 Signal Persistence / Follow-through =====
  // 只往左找最近 8 個交易日的「事件K」，絕不讀取審計日右側資料。
  // 目的：第一根強K只取得試單資格；若後續守住事件低點、均線轉強、量縮回檔，
  //       Entry 應逐日升級，而不是每天失憶重新評分。
  let persistence=0, eventAge=null, eventLow=null, eventClose=null, eventHigh=null, eventVol=null;
  const lookback=Math.min(8,rows.length-1);
  for(let age=0;age<=lookback;age++){
    const k=rows.length-1-age;
    if(k<1)break;
    const r=rows[k],p=rows[k-1];
    const dr=(r.close/p.close-1)*100;
    const base=rows.slice(Math.max(0,k-5),k);
    const av=avg(base.map(z=>z.volume))||r.volume;
    const rg=Math.max(r.high-r.low,tick(r.close));
    const loc=(r.close-r.low)/rg;
    const event=(r.close>=r.open && loc>=.62 &&
                ((dr>=5 && r.volume/av>=1.0) || (dr>=3.5 && r.volume/av>=1.35) || dr>=8.5));
    if(event){eventAge=age;eventLow=r.low;eventClose=r.close;eventHigh=r.high;eventVol=r.volume;break;}
  }

  const followReasons=[];
  if(eventAge!==null){
    persistence+=12; followReasons.push(`事件K ${eventAge}日內`);
    const after=rows.slice(rows.length-1-eventAge);
    const minAfter=Math.min(...after.map(z=>z.low));
    const maxClose=Math.max(...after.map(z=>z.close));
    const eventHeld=minAfter>=eventLow*0.985;
    if(eventHeld){persistence+=18;followReasons.push('守住事件K低點')}
    else {persistence-=18;followReasons.push('事件K低點失守')}

    if(close>=eventClose){persistence+=10;followReasons.push('守事件K收盤')}
    else if(close>=eventLow+(eventClose-eventLow)*.5){persistence+=5;followReasons.push('守事件K半身')}

    if(maxClose>eventHigh){persistence+=10;followReasons.push('事件後再創高')}
    if(ma5turn){persistence+=12;followReasons.push('MA5續轉上')}
    if(ma10turn){persistence+=10;followReasons.push('MA10轉上')}
    if(close>a.ma5){persistence+=7;followReasons.push('站穩MA5')}
    if(close>a.ma10){persistence+=5;followReasons.push('站穩MA10')}
    if(hl){persistence+=8;followReasons.push('HL成立')}

    // 事件後正常整理：量縮而價格仍守住事件結構，視為正向確認。
    if(eventAge>=1 && cur.volume<=eventVol*.85 && close>=eventLow){
      persistence+=8; followReasons.push('事件後量縮守穩');
    }
    // 2~6 日內完成確認最有價值；太久則事件影響自然衰減。
    if(eventAge>=2&&eventAge<=6)persistence+=5;
    if(eventAge>=7)persistence-=5;
  }
  persistence=clamp(Math.round(persistence),0,100);

  // Follow-through 不直接把追高價變成好價格；它主要解除「確認不足」問題。
  // 最多提供 18 分升級，仍受 Entry Quality / risk / chase 限制。
  let followBoost=0;
  if(persistence>=75)followBoost=18;
  else if(persistence>=60)followBoost=14;
  else if(persistence>=45)followBoost=9;
  else if(persistence>=30)followBoost=5;

  // Entry Score：只看價格/風險/延續確認；不讀 Setup / Opportunity / Hold。
  // V1.9.1 — Entry is independent from Setup / Opportunity / Hold.
  let score=Math.round(entryQuality*.82+persistence*.18);
  score=clamp(score,0,100);
  const effectiveConfirmation=Math.max(confirmation,Math.round(persistence*.88));

  const triggers=[];
  if(shock)triggers.push('第一強勢事件');
  else if(impulseDay)triggers.push('價格動能脈衝');
  if(breakout)triggers.push('突破20T高');
  else if(break10)triggers.push('突破10T高');
  if(reclaim10)triggers.push('收復MA10'); else if(reclaim5)triggers.push('收復MA5');
  if(hl)triggers.push('HL');
  if(persistence>=45)triggers.push('訊號延續確認');
  if(!triggers.length)score=Math.min(score,58);

  let phase='等待',state='觀望',position='0%';
  if(shock&&freshEvent)phase='事件發動';
  else if(opportunity>=75&&confirmation<50)phase='機會高／確認中';
  else if(opportunity>=70&&entryQuality>=60)phase='早期甜蜜點';
  else if(persistence>=60&&entryQuality>=52)phase='延續確認／可加碼';
  else if(confirmation>=60)phase='確認進場';
  else if(opportunity>=55)phase='預埋觀察';

  if(triggers.length&&!a.hardBroken){
    if(score>=86&&entryQuality>=72){state='高品質進場';position='20–30%'}
    else if(score>=74&&entryQuality>=62){state=persistence>=60?'延續確認加碼':'標準進場';position='10–20%'}
    else if(score>=62){state=shock?'事件型試單':(persistence>=45?'確認試單':'試單');position='5–10%'}
    else if(score>=54){state='預埋觀察';position='0–5%'}
  } else if(shock&&score>=62){
    state='事件型試單';position='5–10%';
  }

  // V1.9.1 Hold is independent: existing-position survivability only.
  let hold=0;
  if(!a.hardBroken) hold+=25;
  if(close>=a.ma20) hold+=18;
  if(close>=a.ma10) hold+=12;
  if(close>=a.ma5) hold+=8;
  if(ma20turn) hold+=10;
  if(ma10turn) hold+=8;
  if(ma5turn) hold+=6;
  if(hl) hold+=8;
  if(a.risk<=7) hold+=5;
  if(a.bias>22) hold-=10;
  if(a.hardBroken) hold-=30;
  hold=clamp(Math.round(hold),0,100);

  return {
    score,state,position,phase,hold,triggers,
    opportunity,entryQuality,confirmation,effectiveConfirmation,persistence,eventAge,followBoost,followReasons,chasePenalty:chase,chaseReasons,
    route: opportunity>=entryQuality+8?'事件/機會型':'結構/價格型',
    // UI compatibility
    structure:entryQuality,impulse:opportunity,location:entryQuality,rr:0,triggerScore:confirmation,
    setupPart:0,momentum:opportunity,earlyBonus:0,earlyReasons:[]
  };
}
function maProjection(rows,n,scenario){
  const cur=ma(rows,n),ded=rows.length>=n?rows[rows.length-n].close:NaN;
  const next=cur+(scenario-ded)/n;
  return {cur,ded,next,delta:next-cur};
}
function runway(rows,n,scenario,maxDays=10){
  if(rows.length<n)return 0; let count=0;
  for(let k=0;k<maxDays;k++){
    const idx=rows.length-n+k;
    if(idx>=rows.length)break;
    if(scenario>rows[idx].close)count++;else break;
  }return count;
}
function calcReduction(a){
  const x=[a.ma5,a.gap?.lower,a.breakoutSupport].filter(Number.isFinite).filter(v=>v<a.entry).sort((x,y)=>y-x);
  return roundTick(x[0]||a.ma5||a.entry*.97);
}
function render(){
  const endIdx=STATE.auditIndex,all=STATE.prices,rows=all.slice(0,endIdx+1),date=last(rows).date;
  const m=cut(STATE.margin,date),i=cut(STATE.inst,date),d=cut(STATE.daytrade,date);
  if(rows.length<65){setBanner('這個審計日之前的歷史資料不足 60 個交易日，請把游標往右移。','warn');return}
  clearBanner();
  const R=combineScores(rows,m,i,d);const E=entryEngine(rows,R);R.entry=E;STATE.lastAnalysis=R;
  const a=R.market,o=R.optimal,cur=last(rows),grade=scoreGrade(a.score),qg=scoreGrade(R.quality),og=scoreGrade(o.score),eg=scoreGrade(E.score),hg=scoreGrade(E.hold);
  let status=R.setup.state;
  let statusCls=R.setup.cls;
  if(['反轉發動買進','動能試單'].includes(R.ignition.stage) && !['突破買進','回測買進'].includes(status)){
    status=R.ignition.stage; statusCls=R.ignition.cls;
  }
  if((R.bottom.stage==='底部反轉買進'||R.bottom.stage==='底部試單') && !['突破買進','回測買進','反轉發動買進'].includes(status)){
    status=R.bottom.stage; statusCls=R.bottom.cls;
  }
  $('summary').innerHTML=`
    <div class="card"><div class="label">股票 / 審計日</div><div class="big">${STATE.stock.stock_id} ${STATE.stock.stock_name}</div><div class="sub">${date}｜收盤 ${fmt(cur.close)}｜${STATE.stock.type||'—'}</div></div>
    <div class="card"><div class="label">Setup｜型態品質</div><div class="big ${qg[1]}">${R.quality}</div><div class="sub">底部 ${R.bottom.score}｜發動 ${R.ignition.score}｜趨勢 ${a.score}</div></div>
    <div class="card"><div class="label">Opportunity｜行情機會</div><div class="big ${scoreGrade(E.opportunity)[1]}">${E.opportunity}</div><div class="sub">事件/發動潛力｜單日確認 ${E.confirmation}｜延續 ${E.persistence}</div></div>
    <div class="card"><div class="label">Entry｜現在能不能買</div><div class="big ${eg[1]}">${E.score}</div><div class="sub">${E.phase}｜${E.state}｜價格品質 ${E.entryQuality}｜${E.position}</div></div>
    <div class="card"><div class="label">Hold｜已持有是否續抱</div><div class="big ${hg[1]}">${E.hold}</div><div class="sub">Entry 與 Hold 分開，不因強趨勢自動追價</div></div>`;
  $('auditPill').textContent=`審計日：${date}`;
  $('marketPill').textContent=`市場：${STATE.stock.type||'unknown'}`;
  $('sliderDate').textContent=date;

  const b=R.bottom;
  const bg=scoreGrade(b.score);
  $('bottomEngine').innerHTML=`
    <div class="engineTop"><div><div class="label">底部反轉引擎</div><div class="stage ${b.cls}">${b.stage}</div><div class="tiny">建議部位 ${b.position}｜底部停損 ${fmt(b.stop)}</div></div><div class="engineScore ${bg[1]}">${b.score}</div></div>
    <div class="meter"><div style="width:${b.score}%"></div></div>
    <div class="factorRows">${b.factors.map(x=>`<div class="factorRow"><span>${x[0]}<br><span class="tiny">${x[3]}</span></span><b>${fmt(x[1],0)}/${x[2]}</b></div>`).join('')}</div>`;
  const ig=R.ignition,igg=scoreGrade(ig.score);
  $('ignitionEngine').innerHTML=`
    <div class="engineTop"><div><div class="label">反轉發動引擎</div><div class="stage ${ig.cls}">${ig.stage}</div><div class="tiny">建議部位 ${ig.position}｜發動停損 ${fmt(ig.stop)}</div></div><div class="engineScore ${igg[1]}">${ig.score}</div></div>
    <div class="meter"><div style="width:${ig.score}%"></div></div>
    <div class="factorRows">${ig.factors.map(x=>`<div class="factorRow"><span>${x[0]}<br><span class="tiny">${x[3]}</span></span><b>${fmt(x[1],0)}/${x[2]}</b></div>`).join('')}</div>`;

  $('trendEngine').innerHTML=`
    <div class="engineTop"><div><div class="label">趨勢引擎</div><div class="stage ${R.setup.cls}">${R.setup.state}</div><div class="tiny">${R.setup.reason}</div></div><div class="engineScore ${grade[1]}">${a.score}</div></div>
    <div class="meter"><div style="width:${a.score}%"></div></div>
    <div class="factorRows">
      <div class="factorRow"><span>均線 / 扣抵</span><b>${a.items[0].score}/${a.items[0].max}</b></div>
      <div class="factorRow"><span>K線 / HL / 突破</span><b>${a.items[1].score}/${a.items[1].max}</b></div>
      <div class="factorRow"><span>量價</span><b>${a.items[2].score}/${a.items[2].max}</b></div>
      <div class="factorRow"><span>Risk / R:R</span><b>${a.items[10].score+a.items[11].score}/${a.items[10].max+a.items[11].max}</b></div>
    </div>`;
  const life=['超跌雷達','止跌觀察','底部試單','底部反轉買進','趨勢加碼','主升持有','過熱減碼','結構出場'];
  let active=b.stage==='超跌雷達'?0:b.stage==='止跌觀察'?1:b.stage==='底部試單'?2:b.stage==='底部反轉買進'?3:
    ['反轉發動買進','動能試單'].includes(ig.stage)?4:
    R.setup.state==='突破買進'||R.setup.state==='回測買進'?4:a.score>=82&&!R.noTrade?5:a.bias>15?6:R.noTrade?7:-1;
  $('lifecycle').innerHTML=life.map((x,idx)=>`<span class="life ${idx===active?'active':''}">${idx+1}. ${x}</span>`).join('');
  $('dualDecision').innerHTML=`<b>三引擎結論：</b>底部 ${b.score}（${b.stage}）｜反轉發動 ${ig.score}（${ig.stage}）｜趨勢 ${a.score}（${R.setup.state}）。`+
    (ig.stage==='反轉發動買進'?` <b class="green">動能已發動：</b>即使 MA20/60 尚未翻多，只要短線突破、量價與風險條件成立，可採 ${ig.position} 建倉。`:
     ig.stage==='動能試單'?` 反轉速度開始加快，可 ${ig.position} 試單，等後續突破/均線接棒再加碼。`:
     b.stage==='底部反轉買進'?` 底部觸發已成立，可採 ${b.position} 分批策略。`:
     b.stage==='底部試單'?` 已出現底部早期訊號，只允許 ${b.position} 試單。`:
     R.setup.state==='突破買進'||R.setup.state==='回測買進'?` 趨勢引擎已接棒。`:
     ` 尚未形成可執行的底部、發動或趨勢訊號。`);

  const reduce=calcReduction(a);
  const buyLow=roundTick(Math.min(o.entry,a.ma20)),buyHigh=roundTick(Math.max(o.entry,a.ma10));
  $('mainTable').innerHTML=`<tr>
    <td><b>${STATE.stock.stock_id} ${STATE.stock.stock_name}</b><br>${date}</td>
    <td><b class="green">${fmt(o.entry)}</b></td>
    <td>${o.score} / 100（${positionPct(o.score)}）</td>
    <td>${fmt(buyLow)} ～ ${fmt(buyHigh)}<br><span class="tiny">需重新檢查 Risk / R:R</span></td>
    <td><b class="${eg[1]}">Entry ${E.score} / 100</b><br>Opportunity ${E.opportunity}｜價格品質 ${E.entryQuality}<br>確認度 ${E.confirmation}｜${E.state} ${E.position}<br>現價 ${fmt(cur.close)}｜Risk ${fmt(a.risk,2)}%</td>
    <td>${fmt(reduce)}<br>5MA / 缺口 / 突破平台</td>
    <td>${fmt(a.stop)}<br>20MA / 10MA / HL 結構</td>
    <td>T1 ${fmt(a.t1)} = ${fmt(a.rr1,2)}R<br>T2 ${fmt(a.t2)} = ${fmt(a.rr2,2)}R<br>融資 Pctl ${fmt(a.marginPct,0)}% / 法人 Pctl ${fmt(a.instPct,0)}%</td>
  </tr>`;

  const levels=[
    ['現價',cur.close,a.score>=80?'green':'yellow'],['最高分買點',o.entry,'green'],['MA10',a.ma10,'blue'],['MA20',a.ma20,'purple'],
    ['第1減碼',reduce,'yellow'],['硬停損',a.stop,'red'],['Target 1',a.t1,'green'],['Target 2',a.t2,'green']
  ];
  $('prices').innerHTML=levels.map(x=>`<div class="price"><div class="label">${x[0]}</div><strong class="${x[2]}">${fmt(x[1])}</strong></div>`).join('');
  $('targetNote').textContent=a.items.find(x=>x.name.startsWith('12.'))?.text||'';

  $('audit').innerHTML=`
    <div class="factor"><b class="${eg[1]}">V4.4 Opportunity × Entry<span class="pts">${E.score}/100</span></b>
      <span><b>${E.state}</b>｜${E.phase}｜${E.route}｜建議 ${E.position}<br>
      Opportunity ${E.opportunity}/100｜Entry Quality ${E.entryQuality}/100｜Confirmation ${E.confirmation}/100｜Persistence ${E.persistence}/100｜Chase -${E.chasePenalty}<br>
      ${E.eventAge!==null?`最近事件K：${E.eventAge} 個交易日前｜Follow-through +${E.followBoost}｜${E.followReasons.join('、')}<br>`:'最近8日無有效事件K<br>'}
      Trigger：${E.triggers.length?E.triggers.join('、'):'尚無'}
      ${E.chaseReasons.length?`<br>追價限制：${E.chaseReasons.join('、')}`:''}
      ${E.penalties.length?`<br>風控限制：${E.penalties.join('、')}`:''}</span></div>`+
    a.items.map(x=>{
    const cls=!x.available?'warn':x.state;
    return `<div class="factor"><b class="${cls}">${x.name}<span class="pts">${x.available?`${x.score}/${x.max}`:'N/A'}</span></b><span>${x.text}</span></div>`;
  }).join('');

  const invalid=[];
  if(a.bias>15)invalid.push(`20MA 正乖離 ${fmt(a.bias,1)}% > 15%`);
  if(a.risk>7)invalid.push(`Risk ${fmt(a.risk,1)}% > 7%`);
  if(a.rr1<1.5)invalid.push(`T1 R:R ${fmt(a.rr1,2)} < 1.5`);
  if(a.rr2<3)invalid.push(`T2 R:R ${fmt(a.rr2,2)} < 3`);
  if(a.hardBroken)invalid.push('已破壞關鍵均線/HL 結構');
  const stateAction = status==='反轉發動買進'
    ? `V 型/急速反轉發動成立，可建立 ${R.ignition.position}；不等待 MA20/60 完全翻多。以 ${fmt(R.ignition.stop)} 為發動失效點，後續趨勢引擎接棒再加碼。`
    : status==='動能試單'
    ? `短線動能已啟動但確認度尚未滿足，可 ${R.ignition.position} 試單；跌破 ${fmt(R.ignition.stop)} 即取消反轉假設。`
    : status==='底部反轉買進'
    ? `底部反轉觸發成立，可先建立 ${R.bottom.position}；以底部結構低點 ${fmt(R.bottom.stop)} 為主要失效點，後續站穩 MA10/突破平台再考慮加碼。`
    : status==='底部試單'
    ? `底部右腳/背離開始形成，只做 ${R.bottom.position} 試單；若再破 ${fmt(R.bottom.stop)}，底部假設立即失效。`
    : status==='突破買進'
    ? `可依突破策略分批建立部位，優先確認隔日是否守住突破平台 ${fmt(a.prevHigh)}。`
    : status==='回測買進'
    ? `可依回測策略在 ${fmt(buyLow)}～${fmt(buyHigh)} 區間分批承接，跌破結構停損立即退出。`
    : status==='試單'
    ? `僅適合小倉位試單，等待量價或回測確認後再加碼。`
    : status==='等待回測'
    ? `現價不追，等待回到 ${fmt(buyLow)}～${fmt(buyHigh)} 後重新計分。`
    : status==='NO TRADE'
    ? `禁止新倉，直到重新站回關鍵均線/平台且 Risk、R:R 回復。`
    : `維持觀望，等底部或趨勢觸發形成。`;

  $('guide').innerHTML=`<p><b>V4.4 現價進場：</b><span class="${eg[1]}">${E.phase}｜${E.state}｜Entry ${E.score}</span>，建議 ${E.position}。${E.triggers.length?`觸發：${E.triggers.join('、')}。`:'目前沒有有效 Trigger，因此即使 Setup 不差也不下單。'}${E.penalties.length?` 限制：${E.penalties.join('、')}。`:''}</p>
    <p><b>Entry / Hold 分離：</b>Hold ${E.hold} 分。高 Hold 代表已持有者可續抱，不代表空手者應追價；Entry 才是「今天這個價格」的下單分數。</p>
    <p><b>V4.4 機會/進場＋延續確認：</b>Opportunity 回答「這裡是否可能開始一段行情」；Entry Quality 回答「今天這個價格是否值得下單」；Confirmation 是當日確認；Persistence 追蹤最近8個交易日事件K是否守低、守收盤、再創高、MA5/10轉上、HL與量縮整理。第一根強K先取得試單資格，後續確認才逐步升級倉位；任何歷史游標都只讀當日及左側資料。</p>
    
    <p><b>結構判定：</b><span class="${statusCls}">${status}</span>。${status.startsWith('底部')?`底部模型 ${R.bottom.score} 分；趨勢尚未完全確認並不會自動否決底部策略。`:status.includes('發動')||status==='動能試單'?`反轉發動模型 ${R.ignition.score} 分；V 型反轉不要求 MA20/60 先翻多。`:R.setup.reason}${invalid.length&&!status.startsWith('底部')?` 目前限制：${invalid.join('、')}。`:''}</p>
    <p><b>空手者：</b>${stateAction}</p>
    <p><b>持股者：</b>只要收盤維持在第一防守 ${fmt(reduce)} 上方，可採移動停利；跌破先減半。收盤實體摜破 ${fmt(a.stop)}，視為結構失敗，全數退出。</p>
    <p><b>最高分掛單：</b>${fmt(o.entry)}，情境評分 ${o.score} / 100；這是「最有利風報比的候選價」，不是保證一定會回測到。</p>
    <p><b>隔日買訊作廢：</b>若隔日跳空開低後續走低，並跌破審計日低點 ${fmt(cur.low)} 或 MA5 ${fmt(a.ma5)}，本次買訊作廢；不得沿用原分數追價。</p>
    <p><b>部位：</b>${status==='試單'?'建議約 5–10% 試單。':`依最佳進場分數建議 ${positionPct(o.score)}。`} 單筆停損金額仍應限制在總資金約 1%～2%。</p>`;
  $('confidenceBar').style.width=`${a.confidence}%`;
  $('confidenceText').textContent=`可計分權重 ${a.availableMax}/100。缺失維度不硬塞假數據，總分以「已取得資料權重」正規化。`;

  renderChipKpis(m,i,d,cur,a);
  renderMATable(rows,o.entry,a);
  drawPriceChart(rows);
  drawChipChart(m,i,date);
}
function renderChipKpis(m,i,d,cur,a){
  const mr=latestAtOrBefore(m,cur.date),ir=latestAtOrBefore(i,cur.date),dr=latestAtOrBefore(d,cur.date),id=instDetail(ir);
  $('chipKpis').innerHTML=`
    <div class="mini"><span class="label">散戶代理｜融資餘額</span><strong>${mr?num(mr.MarginPurchaseTodayBalance).toLocaleString():'—'} 張</strong><span class="${signClass(a.marginChg)}">${Number.isFinite(a.marginChg)?pct(a.marginChg,2):'—'}</span></div>
    <div class="mini"><span class="label">大戶代理｜法人淨額</span><strong class="${signClass(id.total)}">${Number.isFinite(id.total)?fmt(id.total/1000,0):'—'} 張</strong><span class="tiny">當日三大法人合計</span></div>
    <div class="mini"><span class="label">主力集中代理</span><strong class="${signClass(a.instConc)}">${Number.isFinite(a.instConc)?pct(a.instConc,2):'—'}</strong><span class="tiny">法人淨額 / 總成交量</span></div>
    <div class="mini"><span class="label">當沖率</span><strong class="${a.dayRatio>50?'red':'green'}">${Number.isFinite(a.dayRatio)?fmt(a.dayRatio,1)+'%':'—'}</strong><span class="tiny">${dr?'資料日 '+dr.date:'資料未取得'}</span></div>`;
}
function renderMATable(rows,opt,a){
  const ns=[5,10,20,60],out=[];
  for(const n of ns){
    const p1=maProjection(rows,n,last(rows).close),p2=maProjection(rows,n,opt);
    const judge=p1.delta>0&&p2.delta>0?'兩情境皆翻揚':p1.delta>0?'現價翻揚、回測轉弱':p2.delta>0?'回測仍可翻揚':'扣高蓋頂風險';
    out.push(`<tr><td>MA${n}</td><td>${fmt(p1.cur)}</td><td>${fmt(p1.ded)}</td><td class="${signClass(p1.delta)}">${fmt(p1.next)} (${pct(p1.delta/p1.cur*100,2)})</td><td class="${signClass(p2.delta)}">${fmt(p2.next)} (${pct(p2.delta/p2.cur*100,2)})</td><td>${judge}</td></tr>`);
  }
  $('maTable').innerHTML=out.join('');
  const rw=runway(rows,20,opt,10);
  $('runwayText').textContent=`20MA 扣抵安全期近似：若價格維持在最佳買點 ${fmt(opt)} 附近，接下來約 ${rw} 個交易日的已知扣抵序列仍低於該情境價。此推演只使用審計日前已存在的歷史收盤價。`;
}
function drawPriceChart(rows){
  const c=$('chart'),ctx=c.getContext('2d'),dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
  c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const view=rows.slice(-100),n=view.length;if(!n)return;
  const left=54,right=18,top=18,volH=95,bottom=24,priceBottom=h-volH-bottom-12;
  const pMin=Math.min(...view.map(x=>x.low)),pMax=Math.max(...view.map(x=>x.high)),pad=(pMax-pMin)*.06||1,lo=pMin-pad,hi=pMax+pad;
  const y=p=>top+(hi-p)/(hi-lo)*(priceBottom-top),x=i=>left+(i+.5)*(w-left-right)/n;
  ctx.strokeStyle='#21314b';ctx.lineWidth=1;ctx.font='11px system-ui';ctx.fillStyle='#8292ad';
  for(let k=0;k<5;k++){const yy=top+k*(priceBottom-top)/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();ctx.fillText(fmt(hi-(hi-lo)*k/4,1),4,yy+4)}
  const maxV=Math.max(...view.map(x=>x.volume));
  view.forEach((r,i)=>{
    const xx=x(i),cw=Math.max(2,(w-left-right)/n*.62),up=r.close>=r.open,col=up?'#35d6a0':'#ff6d7b';
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(xx,y(r.high));ctx.lineTo(xx,y(r.low));ctx.stroke();
    const yy1=y(r.open),yy2=y(r.close);ctx.fillRect(xx-cw/2,Math.min(yy1,yy2),cw,Math.max(1,Math.abs(yy1-yy2)));
    const vh=maxV?r.volume/maxV*volH:0;ctx.globalAlpha=.55;ctx.fillRect(xx-cw/2,h-bottom-vh,cw,vh);ctx.globalAlpha=1;
  });
  const mas=[[5,'#f4c95d'],[10,'#67a5ff'],[20,'#bd8cff'],[60,'#35d6a0']];
  mas.forEach(([n,col])=>{
    ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.beginPath();let started=false;
    view.forEach((_,i)=>{const gi=rows.length-view.length+i,m=ma(rows,n,gi);if(!Number.isFinite(m))return;const xx=x(i),yy=y(m);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)});
    ctx.stroke();
  });
  ctx.fillStyle='#92a2bf';ctx.font='11px system-ui';ctx.fillText(view[0].date,left,h-5);ctx.fillText(last(view).date,w-right-72,h-5);
}
function drawChipChart(m,i,date){
  const c=$('chipChart'),ctx=c.getContext('2d'),dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const dates=uniq([...m.map(x=>x.date),...i.map(x=>x.date)]).filter(x=>x<=date).slice(-90);if(!dates.length){ctx.fillStyle='#92a2bf';ctx.fillText('籌碼資料未取得',15,25);return}
  let cum=0,instMap={};i.filter(x=>x.date<=date).forEach(r=>{cum+=instNetRow(r);instMap[r.date]=cum});
  const marMap={};m.filter(x=>x.date<=date).forEach(r=>marMap[r.date]=num(r.MarginPurchaseTodayBalance));
  const mar=dates.map(d=>marMap[d]??NaN),ins=dates.map(d=>instMap[d]??NaN);
  function scaleSeries(a){const v=a.filter(Number.isFinite),mn=Math.min(...v),mx=Math.max(...v);return a.map(x=>Number.isFinite(x)?(x-mn)/(mx-mn||1):NaN)}
  const sm=scaleSeries(mar),si=scaleSeries(ins),left=20,right=15,top=20,bottom=25;
  ctx.strokeStyle='#21314b';for(let k=0;k<4;k++){let yy=top+k*(h-top-bottom)/3;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke()}
  function draw(a,col){ctx.strokeStyle=col;ctx.lineWidth=2;ctx.beginPath();let s=false;a.forEach((v,idx)=>{if(!Number.isFinite(v))return;let xx=left+idx*(w-left-right)/(a.length-1||1),yy=h-bottom-v*(h-top-bottom);if(!s){ctx.moveTo(xx,yy);s=true}else ctx.lineTo(xx,yy)});ctx.stroke()}
  draw(si,'#35d6a0');draw(sm,'#f4c95d');
  ctx.fillStyle='#35d6a0';ctx.font='11px system-ui';ctx.fillText('法人累積淨額（大戶代理）',15,13);
  ctx.fillStyle='#f4c95d';ctx.fillText('融資餘額（散戶代理）',180,13);
  ctx.fillStyle='#8292ad';ctx.fillText(dates[0],15,h-5);ctx.fillText(last(dates),w-85,h-5);
}

function scanSignal(R){
  const ig=R.ignition,b=R.bottom,a=R.market,s=R.setup;
  if(ig.stage==='反轉發動買進')return ['反轉發動買進','green',ig.position,ig.stop,ig.risk];
  if(b.stage==='底部反轉買進')return ['底部反轉買進','green',b.position,b.stop,b.risk];
  if(s.state==='突破買進')return ['突破買進','green',positionPct(a.score),a.stop,a.risk];
  if(s.state==='回測買進')return ['回測買進','green',positionPct(R.optimal.score),R.optimal.stop,R.optimal.risk];
  if(ig.stage==='動能試單')return ['動能試單','yellow',ig.position,ig.stop,ig.risk];
  if(b.stage==='底部試單')return ['底部試單','yellow',b.position,b.stop,b.risk];
  if(s.state==='試單')return ['趨勢試單','yellow','5–10%',a.stop,a.risk];
  return [s.state,s.cls,'0%',a.stop,a.risk];
}
function opportunityScore(R,rows){
  if(rows&&rows.length){
    const E=entryEngine(rows,R);
    return Math.round(E.opportunity*.60 + E.score*.40);
  }
  let q=Math.max(R.ignition.score,R.bottom.score,R.market.score*.92,
    R.ignition.score*.45+R.market.score*.35+R.bottom.score*.20);
  const s=scanSignal(R)[0];
  if(['反轉發動買進','底部反轉買進','突破買進','回測買進'].includes(s))q+=8;
  else if(['動能試單','底部試單','趨勢試單'].includes(s))q+=3;
  return clamp(Math.round(q),0,100);
}
function phase1Score(x){
  const c=num(x.close),ch=num(x.change_rate),vr=num(x.volume_ratio),amt=num(x.total_amount),v=num(x.total_volume);
  if(!(c>0))return -999;
  if(!((amt>=2e7)||(v>=300)))return -999;
  let s=0;
  if(Number.isFinite(ch)){s+=clamp(ch*2.2,-8,18);if(ch>=3)s+=8;if(ch>=6)s+=7}
  if(Number.isFinite(vr)){if(vr>=1.2)s+=8;if(vr>=1.8)s+=7}
  if(amt>0)s+=Math.min(15,Math.max(0,Math.log10(amt)-6));
  return s;
}
async function allSnapshot(token){
  const h=token?{'Authorization':'Bearer '+token}:{};
  const r=await fetch('https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot?data_id=',{headers:h});
  if(!r.ok)throw new Error('全市場快照 HTTP '+r.status);
  const j=await r.json(); if(!Array.isArray(j.data))throw new Error(j.msg||'全市場快照失敗'); return j.data;
}
async function scanMarket(){
  const btn=$('scanBtn'),token=$('tokenInput').value.trim(); if(btn)btn.disabled=true;
  $('scanStatus').textContent='讀取全市場'; $('scanProgress').style.width='2%';
  try{
    if(!STATE.info?.length)await loadStockInfo();
    const mp=new Map(STATE.info.map(x=>[String(x.stock_id),x]));
    const ss=await allSnapshot(token);
    const universe=ss.filter(x=>/^\d{4}$/.test(String(x.stock_id||''))).filter(x=>{
      const inf=mp.get(String(x.stock_id)),z=String(inf?.type||'')+' '+String(inf?.stock_name||'');
      return !/(ETF|ETN|受益證券|指數)/i.test(z);
    });
    $('scanUniverse').textContent=universe.length+' 檔';
    const cand=universe.map(x=>({x,s:phase1Score(x)})).filter(z=>z.s>-900).sort((a,b)=>b.s-a.s).slice(0,45).map(z=>z.x);
    $('scanCandidates').textContent=cand.length+' 檔'; $('scanStatus').textContent='三引擎深度評分';
    const ed=new Date(),sd=new Date(ed);sd.setDate(sd.getDate()-220);
    const start=sd.toISOString().slice(0,10),end=ed.toISOString().slice(0,10),res=[];
    for(let n=0;n<cand.length;n++){
      const id=String(cand[n].stock_id);
      try{
        const [p,m,i]=await Promise.all([
          api('TaiwanStockPrice',id,start,end),
          api('TaiwanStockMarginPurchaseShortSale',id,start,end).catch(()=>[]),
          api('TaiwanStockInstitutionalInvestorsBuySellWide',id,start,end).catch(()=>[])
        ]);
        if(p.length>=65){
          const rows=normalizePrices(p),R=combineScores(rows,m,i,[]),sig=scanSignal(R),score=opportunityScore(R),cur=last(rows),inf=mp.get(id)||{};
          const act=['反轉發動買進','底部反轉買進','突破買進','回測買進','動能試單','底部試單','趨勢試單'].includes(sig[0]);
          res.push({id,name:inf.stock_name||'',score,sig,cur:cur.close,entry:act?cur.close:R.optimal.entry,R});
        }
      }catch(e){console.warn(id,e)}
      $('scanDone').textContent=(n+1)+' / '+cand.length; $('scanProgress').style.width=(5+95*(n+1)/Math.max(1,cand.length))+'%';
      const top=res.sort((a,b)=>b.score-a.score).slice(0,20);
      $('scanTable').innerHTML=top.map((z,k)=>`<tr><td>${k+1}</td><td><b>${z.id} ${z.name}</b></td><td><b class="${scoreGrade(z.score)[1]}">${z.score}</b></td><td class="${z.sig[1]}"><b>${z.sig[0]}</b><br><span class="tiny">${z.sig[2]}</span></td><td>${fmt(z.cur)}</td><td>${fmt(z.entry)}</td><td>${fmt(z.sig[3])}</td><td>${fmt(z.sig[4],2)}%</td><td>${z.R.ignition.score}</td><td>${z.R.bottom.score}</td><td>${z.R.market.score}</td><td><button class="secondary" onclick="openScanStock('${z.id}')">開啟</button></td></tr>`).join('');
    }
    $('scanStatus').textContent='完成 TOP 20'; $('scanProgress').style.width='100%';
  }catch(e){$('scanStatus').textContent='失敗';$('scanTable').innerHTML=`<tr><td colspan="12" class="red">${escapeHtml(e.message||String(e))}</td></tr>`}
  finally{if(btn)btn.disabled=false}
}
async function openScanStock(id){$('stockInput').value=id;await analyze();window.scrollTo({top:0,behavior:'smooth'})}

async function analyze(){
  const q=$('stockInput').value.trim(); if(!q){setBanner('請輸入股票代號或中文名稱。','warn');return}
  setLoading(true,'連線中');clearBanner();
  try{
    if(!STATE.info.length)await loadStockInfo();
    const stock=resolveStock(q);
    if(!stock)throw new Error(`找不到「${q}」對應的台股。可改輸入 4 位股票代號。`);
    STATE.stock=stock;$('stockInput').value=`${stock.stock_id} ${stock.stock_name}`;
    const start=daysAgo(300),end=today(),id=stock.stock_id;
    setLoading(true,'抓取行情');
    const results=await Promise.allSettled([
      api('TaiwanStockPrice',id,start,end),
      api('TaiwanStockMarginPurchaseShortSale',id,start,end),
      api('TaiwanStockInstitutionalInvestorsBuySellWide',id,start,end),
      api('TaiwanStockDayTrading',id,start,end)
    ]);
    if(results[0].status!=='fulfilled')throw new Error(`股價資料失敗：${results[0].reason?.message||'unknown'}`);
    STATE.prices=normalizePrices(results[0].value);
    STATE.margin=results[1].status==='fulfilled'?results[1].value.sort((a,b)=>a.date.localeCompare(b.date)):[];
    STATE.inst=results[2].status==='fulfilled'?results[2].value.sort((a,b)=>a.date.localeCompare(b.date)):[];
    STATE.daytrade=results[3].status==='fulfilled'?results[3].value.sort((a,b)=>a.date.localeCompare(b.date)):[];
    if(STATE.prices.length<65)throw new Error(`只取得 ${STATE.prices.length} 個交易日，無法可靠計算 MA60。`);
    STATE.auditIndex=STATE.prices.length-1;
    $('auditSlider').min=Math.min(64,STATE.prices.length-1);$('auditSlider').max=STATE.prices.length-1;$('auditSlider').value=STATE.auditIndex;
    const failed=[];
    if(!STATE.margin.length)failed.push('融資'); if(!STATE.inst.length)failed.push('三大法人'); if(!STATE.daytrade.length)failed.push('當沖');
    const pDate=last(STATE.prices).date,mDate=STATE.margin.length?last(STATE.margin).date:'—',iDate=STATE.inst.length?last(STATE.inst).date:'—',dDate=STATE.daytrade.length?last(STATE.daytrade).date:'—';
    setBanner(`已載入 ${id} ${stock.stock_name}。資料最新日：股價 ${pDate}｜融資 ${mDate}｜法人 ${iDate}｜當沖 ${dDate}${failed.length?`；未取得：${failed.join('、')}`:''}`,'ok');
    render();
  }catch(e){
    setBanner(`讀取失敗：${e.message}<br><span class="tiny">若瀏覽器顯示 Failed to fetch，可能是 file:// 跨來源限制或資料 API 暫時無法連線。你仍可把這個 HTML 用 Chrome/Edge 開啟重試；Token 不是必填。</span>`,'err');
  }finally{setLoading(false)}
}
$('analyzeBtn').addEventListener('click',analyze);
if($('scanBtn')) $('scanBtn').addEventListener('click',scanMarket);
if($('latestBtn')) $('latestBtn').addEventListener('click',()=>{if(!STATE.prices.length)return;STATE.auditIndex=STATE.prices.length-1;$('auditSlider').value=STATE.auditIndex;render()});
if($('auditSlider')) $('auditSlider').addEventListener('input',e=>{if(!STATE.prices.length)return;STATE.auditIndex=Number(e.target.value);render()});
$('stockInput').addEventListener('keydown',e=>{if(e.key==='Enter')analyze()});
$('tokenInput').value=localStorage.getItem('twq_finmind_token')||'';
$('tokenInput').addEventListener('change',()=>localStorage.setItem('twq_finmind_token',$('tokenInput').value.trim()));
window.addEventListener('resize',()=>{if(STATE.prices.length)render()});
setBanner('Live 版已就緒。輸入股票代號或中文名稱開始；首次中文搜尋會先下載股票清單。FinMind Token 選填。','ok');

} catch (e) {
  console.warn("V4.4 legacy UI init skipped in scanner:", e);
}
