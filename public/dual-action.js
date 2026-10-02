/* R24: independent entry/holding weights; observation-only institutional absorption. */
(function(root){
  'use strict';
  const key='twq_dual_action_r24',schema='dual-action-r26';
  const keys=['setup','opportunity','entry','hold'];
  const defaults={buy:{setup:0,opportunity:20,entry:25,hold:55},stay:{setup:20,opportunity:0,entry:0,hold:80}};
  const copy=x=>JSON.parse(JSON.stringify(x));
  const validWeight=w=>!!w&&keys.every(k=>Number.isFinite(w[k])&&w[k]>=0&&w[k]<=100)&&Math.abs(keys.reduce((n,k)=>n+w[k],0)-100)<1e-9;
  const valid=w=>!!w&&validWeight(w.buy)&&validWeight(w.stay);
  function read(){try{const w=JSON.parse(root.localStorage.getItem(key));return valid(w)?w:copy(defaults)}catch{return copy(defaults)}}
  function save(w){if(!valid(w))return false;try{root.localStorage.setItem(key,JSON.stringify(w));return true}catch{return false}}
  function score(s,w){if(!s||!validWeight(w)||!keys.every(k=>w[k]===0||Number.isFinite(s[k])))return null;return Math.round(keys.reduce((a,k)=>a+(w[k]?s[k]*w[k]/100:0),0))}
  // Use the same volume confirmation bands as Hold + volume. Never invent a
  // zero bonus when the previous completed session's volume is unavailable.
  function volumeBonus(r){
    const ratio=Number.isFinite(r?.holdVolumeRatio)?r.holdVolumeRatio:
      Number.isFinite(r?.volume)&&r.volume>=0&&Number.isFinite(r?.previousVolume)&&r.previousVolume>0?r.volume/r.previousVolume:null;
    return ratio===null?null:ratio>=2?10:ratio>=1.5?7:ratio>=1.2?4:ratio<0.6?-4:0;
  }
  function metrics(r,w=read()){
    const empty={buy:null,buyDelta:null,stay:null,stayDelta:null,stayDrop:null,buyScoreDelta:null,stayScoreDelta:null,volumeBonus:null};
    if(!valid(w)||r?.holdNeedsRefresh)return empty;
    const buy=score(r,w.buy),stay=score(r,w.stay),pb=score(r?.previousScores,w.buy),ps=score(r?.previousScores,w.stay);
    const trail=r?.actionTrail||[],values=trail.map(x=>score(Object.fromEntries(keys.map((k,i)=>[k,x[i]])),w.stay));
    const stayDrop=stay!==null&&values.length===5&&values.every(Number.isFinite)?Math.max(0,Math.max(...values)-stay):null;
    const bonus=volumeBonus(r),buyScoreDelta=buy!==null&&pb!==null?buy-pb:null,stayScoreDelta=stay!==null&&ps!==null?stay-ps:null;
    return {buy,stay,buyScoreDelta,stayScoreDelta,volumeBonus:bonus,
      buyDelta:buyScoreDelta!==null&&bonus!==null?buyScoreDelta+bonus:null,
      stayDelta:stayScoreDelta!==null&&bonus!==null?stayScoreDelta+bonus:null,stayDrop};
  }
  const selections={buyAction:'buy',buyActionDelta:'buyDelta',stayAction:'stay',stayActionDelta:'stayDelta',stayDrawdown:'stayDrop'};
  function rank(r,k,w){const v=metrics(r,w)[selections[k]];return k==='stayActionDelta'&&v!==null?-v:v}
  function history(rows,scoreAt){return rows.length>=70?Array.from({length:5},(_,i)=>{const a=rows.slice(0,rows.length-5+i),s=scoreAt(a);return keys.map(k=>s[k])}):[]}
  const number=v=>v===null||v===undefined||v===''?NaN:Number(String(v).replace(/,/g,''));
  function net(r,p){const b=number(r?.[p+'_buy']),s=number(r?.[p+'_sell']);return Number.isFinite(b)&&Number.isFinite(s)?b-s:null}
  function absorption(rows,inst=[]){
    const priceDate=rows.at(-1)?.date||null,projected=!!rows.at(-1)?.intradayProjected;
    const empty={state:'資料不足',detail:'需要連續5個交易日外資與投信買賣超及對應成交量',priceDate,chipDate:null,lag:null,projected,scored:false};
    if(rows.length<25)return empty;
    // Match actual trading dates; never count an absent observation as zero.
    const map=new Map();for(const r of inst){if(r.date<=priceDate&&(!projected||r.date<priceDate))map.set(r.date,r)}
    const index=rows.findLastIndex(r=>map.has(r.date));
    if(index<0)return empty;
    const chipDate=rows[index].date,lag=rows.length-1-index;
    const a=rows.slice(index-4,index+1),matched=a.map(r=>map.get(r.date));
    const out={...empty,chipDate,lag};
    if(index<24||a.length!==5||matched.some(r=>!r))return out;
    const foreign=matched.map(r=>net(r,'Foreign_Investor')),trust=matched.map(r=>net(r,'Investment_Trust'));
    if([...foreign,...trust].some(x=>x===null)||a.some(r=>!(number(r.volume)>0)))return out;
    const total=foreign.map((f,i)=>f+trust[i]),volume=a.reduce((s,r)=>s+number(r.volume),0),net5=total.reduce((a,b)=>a+b,0);
    const base=rows[index-5],before=rows.slice(index-24,index-4),support=Math.min(...before.map(r=>number(r.low))),ceiling=Math.max(...before.map(r=>number(r.high)));
    const endpoint=a.at(-1),ret=(endpoint.close/base.close-1)*100,ratio=net5/volume*100;
    let sellStreak=0;for(let i=4;i>=0&&total[i]<0;i--)sellStreak++;
    const meaningful=ratio<=-3&&sellStreak>=3;
    const lowerFailed=a.some(r=>r.low<support*.995),held=!lowerFailed&&Math.min(...a.map(r=>r.close))>=base.close*.985;
    const wickWarnings=a.filter((r,i)=>{const earlier=rows.slice(index-4+i-5,index-4+i),avg=earlier.reduce((s,x)=>s+x.volume,0)/earlier.length;return r.volume>=avg*1.5&&(r.high-Math.max(r.open,r.close))/Math.max(r.high-r.low,.01)>.45}).length;
    const declining=a.slice(1).every((r,i)=>r.low<a[i].low);
    let state='中性',detail='未形成連續實質賣壓；不推定承接';
    if(meaningful){
      if(lowerFailed){state='承接失敗';detail='連續賣超且跌破觀察前20日低點';}
      else if(wickWarnings>=2||declining||ret< -1.5){state='賣壓警戒';detail='連續賣超，伴隨反覆放量上影或價格走弱';}
      else if(held&&ret>=-1&&endpoint.close>ceiling){state='承接確認';detail='賣壓下守穩，且突破觀察前20日高點；仍不是未來上漲保證';}
      else if(held&&ret>=-1){state='承接觀察';detail='連續賣超但價格守穩；尚未確認突破';}
      else {state='賣壓警戒';detail='連續賣超，承接條件未完整';}
    }
    const latest=rows.at(-1),currentBroken=lag>0&&latest.low<support*.995;
    if(lag>0&&meaningful&&!currentBroken&&latest.close<endpoint.close*.985){state='賣壓警戒';detail='法人資料日曾守穩，但最新價格已轉弱';}
    if(currentBroken&&meaningful){state='承接失敗';detail='先前連續賣超後，最新價格已跌破觀察支撐';}
    if(lag>1){state='資料落後';detail='法人資料落後超過1個交易日，不判定目前承接狀態';}
    return {...out,state,detail,net5,ratio,return5:ret,sellStreak,support,foreign5:foreign.reduce((a,b)=>a+b,0),trust5:trust.reduce((a,b)=>a+b,0)};
  }
  const signed=v=>Number.isFinite(v)?(v>0?'+':'')+v:'—';
  function note(a){if(!a)return '待更新｜重新掃描或更新盤中行情';return `${a.state}｜法人截至 ${a.chipDate||'—'}${a.lag?'（落後 '+a.lag+' 個交易日）':''}｜${a.detail}。外資＋投信，排除自營商；尚未計入加減分。`}
  root.TWDualAction={key,schema,keys,defaults,valid,validWeight,read,save,score,volumeBonus,metrics,selections,rank,history,absorption,signed,note};
})(globalThis);
