import {verifyC26GitHubOIDC} from './github-oidc.mjs';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export class A56RefreshState{
 constructor(ctx){this.storage=ctx.storage;}
 async fetch(request){
  const path=new URL(request.url).pathname,now=Date.now();
  let s=await this.storage.get('a56:refresh')||{state:'idle',request_id:null};
  if(path.endsWith('/status')&&request.method==='GET')return json(s);
  if(path.endsWith('/request')&&request.method==='POST'){
   if(['queued','running'].includes(s.state)||s.finished_at&&now-Date.parse(s.finished_at)<120000)return json(s);
   s={state:'queued',request_id:crypto.randomUUID(),requested_at:new Date(now).toISOString(),phase:'已排程，等待原引擎更新日K、因子、帳本與盤前計畫'};
  }else if(path.endsWith('/begin')&&request.method==='POST'){
   s={...s,state:'running',request_id:s.request_id||crypto.randomUUID(),started_at:new Date(now).toISOString(),phase:'原引擎正在補齊資料並逐日重播 A56 合併帳本'};
  }else if(path.endsWith('/finish')&&request.method==='POST'){
   const b=await request.json();
   if(b.request_id!==s.request_id)return json({error:'Request generation changed'},409);
   const success=b.outcome==='success';
   s={...s,state:success?'completed':'failed',finished_at:new Date(now).toISOString(),
      phase:success?'原引擎驗收完成；等待已發布資料部署後自動重新載入':'最新重播未通過；保留先前已驗證帳本與資料日期'};
  }else return json({error:'Not found'},404);
  await this.storage.put('a56:refresh',s);return json(s);
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
