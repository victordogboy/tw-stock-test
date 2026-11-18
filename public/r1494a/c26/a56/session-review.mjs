/* A closed plan is still reviewable; review never authorizes a new order. */
const date=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'));
export function sessionReview(D,I,currentPlan,now=Date.now()){
 if(I!==D.dates.length-1)return null;
 const local=new Date(now+28800000).toISOString(),today=local.slice(0,10);
 // These plans come only from the SHA-verified continuation asset.
 const plans=[...(D.a56?.reviewPlans||[]),...(D.a56?.ready&&currentPlan?[currentPlan]:[])].filter(p=>
  p&&date(p.signal_as_of)&&date(p.trade_date)&&p.signal_as_of<p.trade_date&&
  Array.isArray(p.actions)&&Array.isArray(p.candidates)&&
  D.snapshots.some(s=>s.date===p.signal_as_of));
 const past=plans.filter(p=>p.trade_date<=today).sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
 const plan=past.at(-1)||plans.filter(p=>p.trade_date>today).sort((a,b)=>a.trade_date.localeCompare(b.trade_date))[0];
 if(!plan)return {plan:currentPlan,snapshot:D.snapshots[I],ready:false,day:currentPlan?.trade_date||null,mode:'等待已驗證計畫',reviewOnly:true};
 const closed=plan.trade_date<today||(plan.trade_date===today&&local.slice(11,16)>='13:30');
 return {plan,snapshot:D.snapshots.find(s=>s.date===plan.signal_as_of),ready:true,day:plan.trade_date,
  mode:closed?'收盤檢視':plan.trade_date>today?'盤前待開盤':'盤中追蹤',reviewOnly:closed};
}
