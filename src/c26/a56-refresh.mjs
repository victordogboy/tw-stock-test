import {verifyC26GitHubOIDC} from './github-oidc.mjs';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export function refreshView(state,now=Date.now()){
 const since=state.state==='running'?state.started_at:state.requested_at;
 const age=Number.isFinite(Date.parse(since))?Math.max(0,Math.floor((now-Date.parse(since))/1000)):0;
 const delayed=state.state==='queued'&&age>=600||state.state==='running'&&age>=2400;
 return {...state,wait_seconds:age,delayed,
  ...(delayed?{phase:state.state==='queued'?'更新等候超過10分鐘，背景排程尚未接手；將於下次來源檢查重試':'原引擎執行超過40分鐘，等待背景重試；保留上次已驗證帳本'}:{})};
}
export class A56RefreshState{
 constructor(ctx){this.storage=ctx.storage;}
 async fetch(request){
  const path=new URL(request.url).pathname,now=Date.now();
  let s=await this.storage.get('a56:refresh')||{state:'idle',request_id:null};
  if(path.endsWith('/status')&&request.method==='GET')return json(refreshView(s,now));
  if(path.endsWith('/request')&&request.method==='POST'){
   if(['queued','running'].includes(s.state)||s.finished_at&&now-Date.parse(s.finished_at)<120000)return json(refreshView(s,now));
   s={state:'queued',request_id:crypto.randomUUID(),requested_at:new Date(now).toISOString(),phase:'已排程，等待原引擎更新日K、因子、帳本與盤前計畫'};
  }else if(path.endsWith('/begin')&&request.method==='POST'){
   let b={};try{b=await request.json()}catch{}
   const run_id=/^\d+$/.test(String(b.run_id||''))?String(b.run_id):null;
   s={...s,run_id,workflow_url:run_id?'https://github.com/victordogboy/tw-stock-test/actions/runs/'+run_id:null,finished_at:null,state:'running',request_id:s.request_id||crypto.randomUUID(),started_at:new Date(now).toISOString(),phase:'原引擎正在補齊資料並逐日重播 A56 合併帳本'};
  }else if(path.endsWith('/finish')&&request.method==='POST'){
   const b=await request.json();
   if(b.request_id!==s.request_id)return json({error:'Request generation changed'},409);
   const success=b.outcome==='success';
   s={...s,state:success?'completed':'failed',finished_at:new Date(now).toISOString(),
      model_as_of:/^20\d{2}-\d{2}-\d{2}$/.test(b.model_as_of||'')?b.model_as_of:null,
      phase:success?'原引擎驗收及資料發布完成；等待部署後自動重新載入':'資料重播或發布未通過；保留先前已驗證帳本，等待下次重試'};
  }else return json({error:'Not found'},404);
  await this.storage.put('a56:refresh',s);return json(refreshView(s,now));
 }
}
export function a56RefreshStub(env){return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('system:a56:refresh:v1'));}
export async function a56RefreshRoute(request,env){
 const path=new URL(request.url).pathname;
 const action=path.split('/').at(-1);
 const expected=action==='refresh-status'?'GET':'POST';
 if(request.method!==expected)return json({error:expected+' required'},405);
 if(['begin','finish'].includes(action)){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!await verifyC26GitHubOIDC(token))return json({error:'Protected original-engine workflow identity required'},403);
 }
 if(!['refresh','refresh-status','begin','finish'].includes(action))return json({error:'Not found'},404);
 const internal=action==='refresh'?'request':action==='refresh-status'?'status':action;
 try{return await a56RefreshStub(env).fetch(new Request('https://a56.internal/a56-internal/'+internal,request));}
 catch{return json({state:'unavailable',phase:'更新佇列暫時無法連線；既有帳本保留'},503);}
}

