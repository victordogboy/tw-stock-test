import {remainingTasks,batchJobs,minuteJobs} from '../../public/r1494a/c30/free-sync.mjs';
import {c30FreeSourceRoute} from './free-source.mjs';

const stateKey='c30-background-job';
const ttl=6*60*60*1000;
const terminal=state=>!['queued','running','waiting'].includes(state);
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const bytes=new TextEncoder();
const keyName='system:c30:background-encryption:v1';
async function encryptionKey(env){
 const stub=env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName(keyName));
 const response=await stub.fetch(new Request('https://cache.internal/c30-background-internal/key',{method:'POST'}));
 if(!response.ok)throw Error('背景任務加密金鑰無法讀取');
 return crypto.subtle.importKey('raw',await response.arrayBuffer(),'AES-GCM',false,['encrypt','decrypt']);
}
function publicJob(job){
 if(!job)return null;
 const {credential,queue,dates,...status}=job;
 return {...status,pending:queue.length-job.cursor};
}
export async function c30BackgroundRoute(request,env){
 const url=new URL(request.url);
 if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin)return json({error:'來源不符'},403);
 const operation=url.pathname.split('/').at(-1);
 if(!['capability','status','start','stop'].includes(operation))return json({error:'找不到背景任務操作'},404);
 if(operation==='capability'&&request.method==='GET')return json({configured:!!env.SCAN_JOBS});
 const token=request.headers.get('authorization')?.match(/^Bearer (\S{30,4096})$/)?.[1];
 if(!token)return json({error:'請先儲存 FinMind Token'},401);
 if(!env.SCAN_JOBS)return json({error:'Cloudflare 尚未設定背景任務加密金鑰'},503);
 const digest=await crypto.subtle.digest('SHA-256',bytes.encode(token));
 const id=env.SCAN_JOBS.idFromName('private:c30:background:'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''));
 return env.SCAN_JOBS.get(id).fetch(new Request('https://cache.internal/c30-background-internal/'+operation,request));
}
export class C30Background {
 constructor(ctx,env){this.storage=ctx.storage;this.env=env}
 async source(token,job,path,body){
  const r=await c30FreeSourceRoute(new Request('https://jobs.internal/api/c30/free/'+path,{
   method:body?'POST':'GET',
   headers:{authorization:'Bearer '+token,'x-c30-source-tier':job.tier,'x-c30-free-interval-ms':String(job.interval)},
   ...(body?{body:JSON.stringify(body)}:{})
  }),this.env);
  const result=await r.json();
  if(!r.ok||result.ok===false)throw Object.assign(new Error(result.error||'HTTP '+r.status),{status:r.status,retry:result.retry_after_ms,code:result.code});
  return result;
 }
 async fetch(request){
  const path=new URL(request.url).pathname.split('/').at(-1);
  if(path==='key'&&request.method==='POST'){
   const key=await this.storage.transaction(async tx=>{
    const saved=await tx.get('c30-background-aes-key');
    if(saved)return saved;
    const generated=crypto.getRandomValues(new Uint8Array(32));
    await tx.put('c30-background-aes-key',generated);
    return generated;
   });
   return new Response(key,{headers:{'cache-control':'no-store'}});
  }
  if(path==='status'&&request.method==='GET')return json({job:publicJob(await this.storage.get(stateKey))});
  if(request.method!=='POST'||!['start','stop'].includes(path))return json({error:'找不到背景任務操作'},404);
  if(path==='stop'){
   return this.storage.transaction(async tx=>{
    const job=await tx.get(stateKey);
    if(job&&!terminal(job.state)){job.state='cancelled';delete job.credential;await tx.put(stateKey,job);await tx.deleteAlarm()}
    return json({job:publicJob(job)});
   });
  }
  const previous=await this.storage.get(stateKey);
  if(previous&&!terminal(previous.state))return json({job:publicJob(previous)});
  const {tier,interval}=await request.json();
  const token=request.headers.get('authorization').slice(7);
  const job={id:crypto.randomUUID(),state:'queued',tier:tier==='sponsor'?'sponsor':'free',interval:Math.min(30000,Math.max(tier==='sponsor'?50:1000,Number(interval)||1000)),expires:Date.now()+ttl,queue:[],cursor:0,phase:'bulk',done:0,errorCount:0,errors:[],dates:[]};
  try{job.dates=(await this.source(token,job,'calendar',{})).dates}
  catch(error){return json({error:error.message},error.status||502)}
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(this.env),bytes.encode(token));
  job.credential={iv,ciphertext};
  return this.storage.transaction(async tx=>{
   const existing=await tx.get(stateKey);
   if(existing&&!terminal(existing.state))return json({job:publicJob(existing)});
   await tx.put(stateKey,job);
   await tx.setAlarm(Date.now()+100);
   return json({job:publicJob(job)},202);
  });
 }
 async alarm(){
  const job=await this.storage.get(stateKey);
  if(!job)return false;
  if(terminal(job.state))return true;
  await this.storage.setAlarm(Math.min(job.expires,Date.now()+120000));
  let delay=0;
  try{
   if(Date.now()>=job.expires){job.state='expired';return true}
   const {iv,ciphertext}=job.credential;
   const token=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKey(this.env),ciphertext));
   job.state='running';
   if(job.phase==='end'&&job.queue.slice(job.cursor).some(({path,task})=>path==='chip'&&task.from>task.to)){
    job.phase='individual';
    job.queue=[];
    job.cursor=0;
   }
   if(job.cursor===job.queue.length){
    const dates=job.dates;
    const status=await this.source(token,job,'status');
    const days=dates.map(date=>({...status.days.find(day=>day.date===date),date})).reverse();
    const assets=await this.env.ASSETS.fetch(new Request('https://assets.internal/c30/pool.json'));
    const codes=(await assets.json()).stocks.map(stock=>stock.code);
    if(codes.length!==233)throw Error('233 檔股票池驗證失敗');
    job.cursor=0;
    if(job.phase==='bulk'){
     job.queue=job.tier==='sponsor'?batchJobs(days).map(task=>({path:'sponsor-batch',task})):[];
     job.phase='individual';
    }else if(job.phase==='individual'){
     job.queue=[...(job.tier==='sponsor'?minuteJobs(days,codes,true).map(task=>({path:'sponsor-minute',task})):[]),...remainingTasks(days.map(day=>({date:day.date,stored:day})),codes).map(task=>({path:'chip',task}))];
     job.phase='end';
    }else{job.queue=[];job.state=job.errors.length?'partial':'completed'}
    return true;
   }
   const started=Date.now();
   while(job.cursor<job.queue.length&&Date.now()-started<12000){
    const current=await this.storage.get(stateKey);
    if(current?.id!==job.id||terminal(current.state))return true;
    if(Date.now()>=job.expires){job.state='expired';return true}
    const {path,task}=job.queue[job.cursor];
    job.current=[task.date||(task.from===task.to?task.from:task.from+'～'+task.to),task.code,task.dataset||'分 K'].filter(Boolean).join(' ');
    try{await this.source(token,job,path,task);job.done++}
    catch(error){
     if([402,429].includes(error.status)){
      job.state='waiting';
      delay=Math.max(100,error.retry||([402].includes(error.status)||error.code==='UPSTREAM_QUOTA'?300000:1000));
      break;
     }
     job.errorCount=(job.errorCount??job.errors.length)+1;
     job.errors.push(job.current+'｜'+error.message);
     job.errors=job.errors.slice(-12);
     if([401,403].includes(error.status)){job.state='failed';break}
    }
    job.cursor++;
    delay=job.interval;
    if(delay>1500||job.cursor===job.queue.length)break;
    await new Promise(resolve=>setTimeout(resolve,delay));
   }
  }catch(error){job.state='failed';job.errorCount=(job.errorCount??job.errors.length)+1;job.errors.push(error.message)}
  finally{
   await this.storage.transaction(async tx=>{
    const current=await tx.get(stateKey);
    if(current?.id!==job.id||terminal(current.state))return;
    if(terminal(job.state)){delete job.credential;await tx.deleteAlarm()}
    else await tx.setAlarm(Math.max(Date.now()+50,Math.min(job.expires,Date.now()+delay)));
    await tx.put(stateKey,job);
   });
  }
  return true;
 }
}
