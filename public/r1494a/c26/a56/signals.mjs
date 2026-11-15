// A56 frozen signal primitives. Conditional paper observations only; never fills.
export const VERSION='A56-LOCK-20261116', BUY_COST=.0014275, LAST_FILL_MINUTE=210;
const finite=Number.isFinite;
export function tick(p,up=false){
 if(!finite(p)||p<=0)throw Error('invalid price');
 const step=p<10?.01:p<50?.05:p<100?.1:p<500?.5:p<1000?1:5;
 return Number(((up?Math.ceil((p-1e-8)/step):Math.floor((p+1e-8)/step))*step).toFixed(4));
}
export function marketWarning(closes){
 if(closes.length!==6||closes.some(x=>!finite(x)||x<=0))throw Error('six verified market closes required');
 const single=Math.min(...closes.slice(1).map((x,i)=>x/closes[i]-1)),cumulative=closes[5]/closes[0]-1;
 return [single<=-.06||closes[5]/closes[0]<=.90,single,cumulative];
}
export function candidate(code,prev,fiveAgo,sixtyBeforeDrop,base,history){
 if(!base||![prev,fiveAgo,sixtyBeforeDrop].every(x=>finite(x)&&x>0))return null;
 const loss5=1-prev/fiveAgo,strength60=fiveAgo/sixtyBeforeDrop-1;
 if(loss5<.03)return null;
 if(!history.length)throw Error('prior daily observations required');
 const y=history.at(-1);let rec=null,vol=null,bFloor=null,bCap=null,bDate=null;
 if(y.executable&&y.low>0&&y.low<=tick(y.ref_close*.925)){rec=y.close/y.low-1;vol=finite(y.volume_shares)?y.volume_shares:null;}
 for(let i=history.length-1;i>=0;i--){const d=history[i];if(!d.executable)continue;
  const reclaim=tick(d.ref_close*.94,true);
  if(d.low<=tick(d.ref_close*.925)&&d.close<reclaim&&!history.slice(i+1).some(x=>x.close>=reclaim)){
   bFloor=reclaim;bCap=tick(d.ref_close*.965);bDate=d.date;break;
  }
 }
 return {code:String(code),prev_close:prev,loss5,strength60,a_ready:rec!==null&&rec>=.01,a_volume:vol,a_recovery:rec,b_floor:bFloor,b_cap:bCap,b_reference_date:bDate,
  a_cap:tick(prev*1.03),c_arm:tick(prev*.925),c_floor:tick(prev*.94,true),c_cap:tick(prev*.965)};
}
export const rankCandidates=xs=>xs.filter(Boolean).sort((a,b)=>b.strength60-a.strength60).slice(0,4);
export function tranche(warning,target,coreNew,day,firstDay,used,pending,exited,heldCount,cash,nav,{opening,corePending=false}){
 if(!warning||target>=.40||coreNew||pending||exited||(opening&&corePending))return [0,0];
 if(!(finite(cash)&&finite(nav)&&nav>0&&cash>0))return [0,0];
 const h=(firstDay===null||firstDay<0)&&!used?4:firstDay!==null&&firstDay>=0&&day===firstDay+1?3:0;
 const slots=Math.max(0,Math.min(h,8-heldCount));if(!slots)return [0,0];
 const available=opening?Math.max(0,cash-target*nav):cash;
 return [slots,Math.min(.40*slots/h,available/nav/(1+BUY_COST))];
}
export function openingIntent(ranked,hold,blocked,budget,nav){
 if(hold<=0||budget<=0)return null;
 for(const c of ranked.slice(0,hold)){
  if(blocked.includes(c.code)||!c.a_ready)continue;
  if(!finite(c.a_volume)||c.a_volume<=0)throw Error('previous volume is not verified');
  const shares=Math.min(Math.floor(budget/hold*nav/c.a_cap),Math.floor(.001*c.a_volume));
  if(shares>0)return {code:c.code,route:'A_open',minute:0,min_price:0,max_price:c.a_cap,shares};
 }return null;
}
export function exitReason(warning,target,coreNew,firstDay,day,pending=false){
 if(firstDay===null||firstDay<0)return null;
 if(target>=.40||coreNew)return 'core_recovery';if(!warning)return 'warning_ended';
 if(day>=firstDay+5)return 'cycle_expiry';return pending?'pending_cycle':null;
}
export const matchOpen=(intent,price,executable)=>Boolean(intent&&executable&&finite(price)&&price>0&&intent.min_price<=price&&price<=intent.max_price);
export const exitOpen=(prev,price,executable)=>Boolean(executable&&finite(price)&&price>tick(prev*.90,true));
export class MinuteMonitor{
 constructor(c,budget,hold,nav){
  if(!Number.isInteger(hold)||hold<1||hold>4||!finite(budget)||budget<=0||!finite(nav)||nav<=0)throw Error('positive reconciled budget, slots and NAV required');
  this.c={...c};this.perSlot=budget/hold*nav;this.last=-1;this.down=false;this.cReclaimed=false;this.bReclaimed=false;this.volume=[];
 }
 completed(k,high,low,volumeShares){
  if(k!==this.last+1||!Number.isInteger(k)||k<0||k>=210)throw Error('completed minutes must be sequential and before 12:30');
  if(volumeShares<0)throw Error('negative volume');
  const noTrade=Number.isNaN(high)&&Number.isNaN(low)&&Number.isNaN(volumeShares);
  if(!noTrade&&(![high,low,volumeShares].every(finite)||low<=0||high<low||volumeShares<=0))throw Error('invalid completed bar');
  this.last=k;this.volume.push(finite(volumeShares)?volumeShares/1000:0);
  const c=this.c,priorDown=this.down,out=[];
  if(!this.down&&finite(low)&&low<=c.c_arm)this.down=true;
  if(priorDown&&finite(high)&&high>=c.c_floor)this.cReclaimed=true;
  if(c.b_floor!==null&&finite(high)&&high>=c.b_floor)this.bReclaimed=true;
  const v=this.volume.slice(-3).sort((a,b)=>a-b),mid=Math.floor(v.length/2),known=v.length%2?v[mid]:(v[mid-1]+v[mid])/2;
  for(const [ready,route,lo,hi,part] of [[this.cReclaimed,'C_intraday',c.c_floor,c.c_cap,.05],[this.bReclaimed,'B_reclaim',c.b_floor,c.b_cap,.025]]){
   if(!ready)continue;const shares=Math.min(Math.floor(this.perSlot/hi),Math.floor(part*known*1000));
   if(shares>0)out.push({code:c.code,route,minute:k+1,min_price:lo,max_price:hi,shares});
  }return out;
 }
}
const timestamp=value=>{
 if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!finite(Date.parse(value)))throw Error('timezone-aware timestamp required');
 return Date.parse(value);
};
// The reconciled account engine owns the selected candidates, budget and blocks.
// Every required symbol must be present; malformed batches never advance state.
export class VerifiedMinuteFeed{
 constructor({sessionDate,candidates,slots,budget,navTwd,maxDelaySeconds=90}){
  if(!Number.isInteger(slots)||slots<1||slots>4||!finite(budget)||budget<=0||!finite(navTwd)||navTwd<=0)throw Error('positive reconciled budget, slots and NAV required');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)||new Date(`${sessionDate}T00:00:00Z`).toISOString().slice(0,10)!==sessionDate)throw Error('invalid session date');
  if(!finite(maxDelaySeconds)||maxDelaySeconds<0)throw Error('invalid delay limit');
  this.open=Date.parse(`${sessionDate}T09:00:00+08:00`);this.day=sessionDate;this.delay=maxDelaySeconds*1000;this.last=-1;
  const chosen=candidates.slice(0,slots);if(new Set(chosen.map(c=>c.code)).size!==chosen.length)throw Error('duplicate candidate');
  this.monitors=new Map(chosen.map(c=>[c.code,new MinuteMonitor(c,budget,slots,navTwd)]));this.blocked=new Set();
 }
 accept(bars,now,blocked=[]){
  const nowMs=timestamp(now);
  if(new Date(nowMs+8*3600000).toISOString().slice(0,10)!==this.day)throw Error('wrong session');
  const k=this.last+1,start=this.open+k*60000,end=start+60000;
  if(k>=210)throw Error('entry window ended');
  for(const c of this.blocked)if(!blocked.includes(c))throw Error('blocked candidates cannot re-enter the same session');
  const required=[...this.monitors.keys()].filter(c=>!blocked.includes(c));
  if(!Array.isArray(bars)||bars.length!==required.length||new Set(bars.map(b=>b.code)).size!==bars.length||bars.some(b=>!required.includes(b.code)))throw Error('one verified bar per candidate required');
  if(nowMs<end||nowMs-end>this.delay)throw Error('incomplete or stale minute');
  const checked=bars.map(b=>{
   if(timestamp(b.start)!==start||timestamp(b.end)!==end)throw Error('duplicate, missing or out-of-order minute');
   if(b.volume_unit!=='shares')throw Error('volume must be shares');
   if(b.status==='CONFIRMED_NO_TRADE'){
    if(b.high!==null||b.low!==null||b.volume_shares!==0)throw Error('invalid no-trade bar');
    return [b.code,NaN,NaN,NaN];
   }
   if(b.status!=='TRADED'||![b.high,b.low,b.volume_shares].every(finite)||b.low<=0||b.high<b.low||b.volume_shares<=0)throw Error('unknown or invalid data');
   return [b.code,b.high,b.low,b.volume_shares];
  });
  const updated=new Map([...this.monitors].map(([c,m])=>[c,Object.assign(Object.create(MinuteMonitor.prototype),structuredClone(m))]));
  const observations=checked.sort(([a],[b])=>a.localeCompare(b)).flatMap(([code,...args])=>updated.get(code).completed(k,...args).map(intent=>({
   ...intent,signal_id:`${VERSION}:${this.day}:${code}:${intent.route}:${intent.minute}`,status:'PAPER_CONDITIONAL_INTENT',
   confirmed_through:new Date(end).toISOString(),execution_minute_start:new Date(end).toISOString()
  })));
  this.monitors=updated;this.blocked=new Set(blocked);this.last=k;return observations;
 }
}
