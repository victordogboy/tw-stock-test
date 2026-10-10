/* R32: long-only, one position, daily mark-to-market, next-open execution. */
(function(root){
  'use strict';
  const keys=['setup','opportunity','entry','hold'];
  const finite=Number.isFinite;
  const defaults={buy:{setup:0,opportunity:20,entry:25,hold:55},stay:{setup:20,opportunity:0,entry:0,hold:80},enter:60,exit:45,capital:1000000,costBps:0,minTrades:5,goal:'balanced'};
  function validate(p){
    for(const group of ['buy','stay']){
      if(!p[group]||!keys.every(k=>finite(p[group][k])&&p[group][k]>=0&&p[group][k]<=100)||Math.abs(keys.reduce((s,k)=>s+p[group][k],0)-100)>1e-8)throw Error('進場與續抱權重必須各自合計100%');
    }
    for(const k of ['enter','exit'])if(!finite(p[k])||p[k]<0||p[k]>100)throw Error('分數門檻須為0～100');
    if(!finite(p.capital)||p.capital<=0)throw Error('每筆本金須大於0');
    if(!finite(p.costBps)||p.costBps<0||p.costBps>1000)throw Error('來回成本須為0～1000基點');
    if(!Number.isInteger(p.minTrades)||p.minTrades<1||p.minTrades>100)throw Error('最低交易筆數須為1～100');
    if(!['balanced','roi','winRate'].includes(p.goal))throw Error('未知的搜尋目標');
    return p;
  }
  function scores(rows,w){return rows.map(r=>r.scores&&keys.every(k=>!w[k]||finite(r.scores[k]))?Math.round(keys.reduce((s,k)=>s+(w[k]?r.scores[k]*w[k]/100:0),0)):null)}
  function executable(r){return r.volume>0&&r.high>r.low&&r.open>0}
  // Bps is an aggregate round-trip estimate, split evenly between the two sides.
  // Each new position uses min(current cash, original capital); no leverage or compounding above this cap.
  function simulate(rows,p,options={}){
    if(!options.checked)validate(p);
    const from=options.from??0,to=options.to??rows.length;
    const buy=options.buy||scores(rows,p.buy),stay=options.stay||scores(rows,p.stay);
    const detail=options.detail!==false,trades=[],curve=[],fee=p.costBps/20000;
    let cash=p.capital,pos=null,pending=null,peak=cash,mdd=0,wins=0,count=0,totalReturn=0,gains=0,losses=0,exposure=0,unfilled=0,forced=0;
    function sell(r,i,price,reason){
      const proceeds=pos.units*price*(1-fee),profit=proceeds-pos.spent,ret=profit/pos.spent*100;
      cash+=proceeds;count++;if(profit>0)wins++;gains+=Math.max(profit,0);losses+=Math.max(-profit,0);totalReturn+=ret;
      if(detail)trades.push({signalDate:pos.signalDate,entryDate:pos.date,exitSignalDate:pending?.date||null,exitDate:r.date,entry:pos.price,exit:price,profit,returnPct:ret,days:i-pos.index,reason});
      pos=null;pending=null;
    }
    for(let i=from;i<to;i++){
      const r=rows[i];
      if(pending){
        if(executable(r)){
          if(pending.side==='sell'&&pos)sell(r,i,r.open,'續抱分數≤門檻');
          else if(pending.side==='buy'&&!pos){
            const spent=Math.min(cash,p.capital);
            if(spent>0){pos={units:spent/(r.open*(1+fee)),spent,price:r.open,date:r.date,index:i,signalDate:pending.date};cash-=spent;}
            pending=null;
          }
        }else{unfilled++;if(pending.side==='buy')pending=null;}
      }
      if(pos)exposure++;
      // Include the still-open position in every day's account value.
      let equity=cash+(pos?pos.units*r.close:0);
      if(i===to-1&&pos){forced++;sell(r,i,r.close,'期末收盤估值結清');equity=cash;}
      peak=Math.max(peak,equity);mdd=Math.max(mdd,(peak-equity)/peak*100);
      if(detail)curve.push({date:r.date,equity});
      if(i<to-1){
        if(pos&&finite(stay[i])&&stay[i]<=p.exit&&!pending)pending={side:'sell',date:r.date};
        else if(!pos&&finite(buy[i])&&buy[i]>=p.enter)pending={side:'buy',date:r.date};
      }
    }
    const roi=(cash/p.capital-1)*100,days=to>from?(Date.parse(rows[to-1].date)-Date.parse(rows[from].date))/86400000:0;
    const cagr=days>=365?((cash/p.capital)**(365.25/days)-1)*100:null;
    const benchmark=to-from>1?(rows[to-1].close/rows[from+1].open-1)*100:null;
    return {roi,maxDrawdown:mdd,winRate:count?wins/count*100:null,trades:count,forced,wins,avgReturn:count?totalReturn/count:null,profitFactor:losses?gains/losses:gains?Infinity:null,returnDrawdown:mdd?roi/mdd:null,cagr,exposure:to>from?exposure/(to-from)*100:0,unfilled,benchmark,start:rows[from]?.date,end:rows[to-1]?.date,tradeLog:trades,curve};
  }
  function weightGrid(extra){
    const out=[];
    for(let a=0;a<=100;a+=25)for(let b=0;b<=100-a;b+=25)for(let c=0;c<=100-a-b;c+=25)out.push({setup:a,opportunity:b,entry:c,hold:100-a-b-c});
    const id=w=>keys.map(k=>w[k]).join(',');
    if(!out.some(w=>id(w)===id(extra)))out.push({...extra});
    return out;
  }
  function objective(m,goal){
    if(goal==='roi')return m.roi;
    if(goal==='winRate')return m.winRate??-Infinity;
    return m.roi/Math.max(m.maxDrawdown,1); // 1 percentage point floor avoids zero-DD singularities.
  }
  function compare(a,b,goal){return objective(b.result,goal)-objective(a.result,goal)||b.result.roi-a.result.roi||a.result.maxDrawdown-b.result.maxDrawdown||b.result.trades-a.result.trades}
  function prepare(data,scoreFn,progress=()=>{}){
    const prices=[...data.prices].sort((a,b)=>a.date.localeCompare(b.date));
    const seen=new Set();
    for(const r of prices){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||seen.has(r.date)||![r.open,r.high,r.low,r.close,r.volume].every(finite)||Math.min(r.open,r.low,r.close)<=0||r.volume<0||r.high<Math.max(r.open,r.close,r.low)||r.low>Math.min(r.open,r.close))throw Error('行情日期重複或OHLC／成交量無效');
      seen.add(r.date);
    }
    const kinds=['margin','inst','daytrade'],maps=Object.fromEntries(kinds.map(k=>[k,new Map((data.chips[k]||[]).map(r=>[r.date,r]))]));
    const validChip=(r,k)=>!!r&&(k==='margin'?['MarginPurchaseTodayBalance','MarginPurchaseYesterdayBalance']:k==='inst'?['Foreign_Investor_buy','Foreign_Investor_sell','Investment_Trust_buy','Investment_Trust_sell']:['Volume']).every(f=>finite(r[f])&&r[f]>=0);
    const rows=[];let missing=0,scored=0;
    for(let i=64;i<prices.length;i++){
      const r=prices[i];if(r.date<data.start||r.date>data.end)continue;
      const window=prices.slice(i-19,i+1),ready=kinds.every(k=>window.every(b=>validChip(maps[k].get(b.date),k)));
      let s=null;
      if(ready){
        const chips=Object.fromEntries(kinds.map(k=>[k,[...maps[k].values()].filter(x=>x.date<=r.date).sort((a,b)=>a.date.localeCompare(b.date))]));
        s=scoreFn(prices.slice(0,i+1),chips);
        if(!keys.every(k=>finite(s[k])))throw Error(r.date+' 評分引擎未產生有效分數');
        scored++;
      }else missing++;
      rows.push({...r,scores:s});
      if(i%50===0)progress({phase:'score',done:i,total:prices.length});
    }
    if(scored<2)throw Error('完整價格與籌碼不足：需至少65日K線及連續20交易日融資、法人、當沖；請載入較長歷史資料');
    // Discard leading coverage gaps, but keep internal gaps for account valuation.
    const first=rows.findIndex(r=>r.scores);return {rows:rows.slice(first),coverage:{scored,missing,priceDays:prices.length,requestedStart:data.start,requestedEnd:data.end}};
  }
  function optimize(rows,p,progress=()=>{}){
    validate(p);if(rows.length<60)throw Error('最佳化至少需要60個交易日；建議先載入1～5年歷史');
    const split=Math.floor(rows.length*.7),bw=weightGrid(p.buy),sw=weightGrid(p.stay);
    const entries=[...new Set([40,45,50,55,60,65,70,75,80,p.enter])].sort((a,b)=>a-b);
    const exits=[...new Set([20,25,30,35,40,45,50,55,60,p.exit])].sort((a,b)=>a-b);
    const bs=bw.map(w=>scores(rows,w)),ss=sw.map(w=>scores(rows,w)),total=bw.length*sw.length*entries.length*exits.length;
    let done=0,eligible=0,top=[];
    // Only the first 70% selects parameters. The remaining 30% is evaluated once after selection.
    for(let b=0;b<bw.length;b++)for(let s=0;s<sw.length;s++){
      for(const enter of entries)for(const exit of exits){
        const params={...p,buy:bw[b],stay:sw[s],enter,exit};
        const result=simulate(rows,params,{to:split,buy:bs[b],stay:ss[s],detail:false,checked:true});done++;
        if(result.trades>=p.minTrades){
          eligible++;const item={params,result};
          if(top.length<10||compare(item,top.at(-1),p.goal)<0){top.push(item);top.sort((a,b)=>compare(a,b,p.goal));top=top.slice(0,10);}
        }
      }
      if(done%1000<entries.length*exits.length)progress({phase:'search',done,total});
    }
    if(!top.length)throw Error('搜尋完成，但沒有組合達到最低交易筆數；請延長回測期間或調低最低筆數');
    const best=top[0].params;
    return {best,top,done,eligible,split,train:simulate(rows,best,{to:split}),test:simulate(rows,best,{from:split}),full:simulate(rows,best),search:{weightStep:25,entries,exits,buyWeights:bw.length,stayWeights:sw.length}};
  }
  const api={keys,defaults,validate,scores,simulate,weightGrid,objective,prepare,optimize};
  root.TWStockBacktest=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
