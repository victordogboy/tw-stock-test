/* Observations never create an account fill. Only the audited ledger can. */
const finite=Number.isFinite,positive=x=>finite(x)&&x>0;
function minuteEvidence(c,feed,route){
 if(feed?.status!=='available')return {state:'unknown',reason:'分鐘行情暫不可用，不能判定先後順序'};
 const bars=new Map(feed.bars.map(b=>[b.minute,b]));let down=false,reclaimed=false,seenArm=false,seenReclaim=false;
 for(const b of feed.bars){
  if(b.minute>=210||!b.complete||!positive(b.open))continue;
  const priorDown=down;
  if(positive(b.low)&&b.low<=c.c_arm)down=seenArm=true;
  if(route==='C_intraday'&&priorDown&&b.high>=c.c_floor)reclaimed=seenReclaim=true;
  if(route==='B_reclaim'&&b.high>=c.b_floor)reclaimed=seenReclaim=true;
  const next=bars.get(b.minute+1),lo=route==='C_intraday'?c.c_floor:c.b_floor,hi=route==='C_intraday'?c.c_cap:c.b_cap;
  const recent=[];for(let k=Math.max(0,b.minute-2);k<=b.minute;k++)recent.push(bars.get(k)?.volume_shares||0);
  recent.sort((a,b)=>a-b);const mid=Math.floor(recent.length/2),volumeLowerBound=recent.length%2?recent[mid]:(recent[mid-1]+recent[mid])/2;
  const capacity=Math.floor((route==='C_intraday'?.05:.025)*volumeLowerBound);
  if(reclaimed&&capacity>0&&next&&positive(next.open)&&next.open>=lo&&next.open<=hi){
   return {state:'price_match',time:next.start,price:next.open,reason:'完成分K符合原路徑，下一分鐘開盤價位於買價區間；現金、名額及成交量仍待帳本核對'};
  }
 }
 const holes=feed.missing_price_bars>0||feed.bars.some((b,i)=>i?b.minute!==feed.bars[i-1].minute+1:b.minute!==0);
 return {state:holes?'unknown':'waiting',reason:(seenReclaim?'已見收復，尚未觀察到下一分鐘開盤落在買價區間':route==='C_intraday'?(seenArm?'已達急跌價，尚未觀察到後續完成分K收復':'截至行情時間尚未觀察到先跌至啟動價'):'截至行情時間尚未觀察到收復價')+(holes?'；分K有缺漏，無法排除缺漏期間曾觸發':'')};
}
export function assessExecution({plan,snapshot,quotes=[],orders=[],ready=true}){
 if(!plan)return [];
 const byCode=new Map(quotes.map(q=>[q.code,q])),held=new Set((snapshot?.holdings||[]).map(h=>h.code)),rows=[];
 function evaluate(code,route,fn){
  const q=byCode.get(code),recorded=orders.find(o=>o.date===plan.trade_date&&o.code===code&&o.filled&&(o.route===route||o.orderType===route||(route==='SELL_OPEN'&&o.side==='SELL')));
  let result;
  if(recorded)result={state:'model_filled',time:recorded.executionTime,price:recorded.price,reason:'已驗證模型帳本紀錄；券商實際成交未確認'};
  else if(!ready)result={state:'unknown',reason:'盤前計畫尚未驗證'};
  else if(q?.status!=='available'||q.trade_date!==plan.trade_date)result={state:'unknown',reason:'尚無交易日 '+plan.trade_date+' 的有效行情'};
  else result={...fn(q)};
  if((route==='B_reclaim'||route==='C_intraday')&&q?.minutes?.source_time)result.source_time=q.minutes.source_time;
  rows.push({code,route,source_time:q?.source_time,...result,broker_status:'unconfirmed'});
 }
 for(const a of plan.actions||[]){
  if(a.orderType==='A_OPEN_LIMIT')evaluate(a.code,'A_open',q=>q.open<=a.level?{state:'price_match',time:plan.trade_date+'T09:00:00+08:00',price:q.open,reason:'開盤價符合上限 '+a.level+'；數量及可成交狀態待核對'}:{state:'not_filled',reason:'開盤 '+q.open+' 高於上限 '+a.level+'；A 只在開盤判定，盤中回落不補買'});
  else if(a.side==='SELL')evaluate(a.code,'SELL_OPEN',q=>({state:'unknown',price:q.open,reason:'盤前開盤賣單；須核對鎖跌停與成交數量，不能僅由 OHL 判成賣出'}));
  else if(a.side==='BUY')evaluate(a.code,a.orderType||'BUY',()=>({state:'unknown',reason:'核心買單須依原引擎核對突破、開盤跳空及資金配置'}));
 }
 const slots=Number.isInteger(plan.opening_slots)?plan.opening_slots:0;
 (plan.candidates||[]).forEach((c,i)=>{
  for(const route of ['B_reclaim','C_intraday']){
   if(route==='B_reclaim'&&!positive(c.b_floor))continue;
   evaluate(c.code,route,q=>{
    if(i>=slots||slots<=0||held.has(c.code))return {state:'blocked',reason:held.has(c.code)?'原帳本已持有同檔，不重複新增':i>=slots?'不在原引擎本盤前 '+slots+' 個候選名額內':'本盤無可用反轉名額'};
    if(q.minutes?.date!==plan.trade_date)return {state:'unknown',reason:'缺少該交易日的分鐘資料'};
    return minuteEvidence(c,q.minutes,route);
   });
  }
 });
 // One code may match B and C; these are alternative observations, not two fills.
 const first=new Map();for(const r of rows.filter(r=>r.state==='price_match').sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)))if(!first.has(r.code))first.set(r.code,r);
 for(const r of rows)if(r.state==='price_match'&&first.get(r.code)!==r)r.reason+='；同檔較早已有 '+first.get(r.code).route+' 價格符合，不重複計入成交';
 return rows;
}
export const executionLabels={model_filled:'模型已成交',price_match:'價格符合・成交待核對',not_filled:'未成交',waiting:'尚未觸發',unknown:'資料不足・成交未確認',blocked:'未開放委託'};
export const routeLabels={A_open:'A 開盤',B_reclaim:'B 跨日收復',C_intraday:'C 盤中反轉',SELL_OPEN:'開盤賣出'};
