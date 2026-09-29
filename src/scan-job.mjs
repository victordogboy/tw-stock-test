import {createScanRuntime} from './scan-runtime.mjs';
const ACTIVE=new Set(['initializing','scanning','formalizing','chips','live']);
const rankRow=r=>({code:r.code,setup:r.setup,opportunity:r.opportunity,entry:r.entry,hold:r.hold,holdVolumeDelta:r.holdVolumeDelta,previousScores:r.previousScores?Object.fromEntries(['entry','setup','opportunity','hold'].map(k=>[k,r.previousScores[k]])):null});
const TTL=24*3600*1000, MAX_RUN=4*3600*1000;
export const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export function validateOptions(raw={}){
 const selection=raw.selection||'entry';
 if(!['setup','opportunity','entry','hold','action','holdDelta','holdVolumeDelta','actionDelta'].includes(selection))throw Error('掃描依據不正確');
 const bounded=(key,def,min,max)=>{const n=raw[key]===undefined?def:Number(raw[key]);if(!Number.isFinite(n)||n<min||n>max)throw Error('掃描設定不正確：'+key);return n};
 const weights=raw.weights||{entry:40,setup:30,opportunity:30,hold:0};
 if(!['entry','setup','opportunity','hold'].every(k=>Number.isFinite(weights[k])&&weights[k]>=0&&weights[k]<=100)||Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-100)>1e-9)throw Error('四項權重總和必須為 100%');
 return {selection,weights,minClose:bounded('minClose',10,0,100000),maxClose:bounded('maxClose',300,0,100000),minLots:bounded('minLots',3000,0,10000000),maxStocks:Math.floor(bounded('maxStocks',200,1,500)),finTopN:Math.floor(bounded('finTopN',100,1,100)),concurrency:Math.floor(bounded('concurrency',6,1,8))};
}
// Opaque browser capability in a header. No credentials in URLs, logs, or public cache.
export async function scanRoute(request,env){
 const url=new URL(request.url),key=request.headers.get('x-scan-key')||'';
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({ok:false,error:'來源不符'},403);
 if(!/^[a-f0-9]{64}$/.test(key))return reply({ok:false,error:'缺少有效的掃描識別碼'},401);
 if(!env.SCAN_JOBS)return reply({ok:false,error:'背景掃描尚未部署：請連同 wrangler.jsonc 更新'},503);
 if(!['GET','POST','DELETE'].includes(request.method))return reply({ok:false,error:'Method not allowed'},405);
 if(url.pathname!=='/api/scan/job')return reply({ok:false,error:'Not found'},404);
 return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName(key)).fetch(request);
}
export function createScanJobClass(api){return class ScanJob {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async readRow(code){return this.ctx.storage.get('row:'+code)}
 async snapshot(s){
  if(!s)return {ok:true,job:null};
  const rows=await Promise.all((s.ranked||[]).map(x=>this.readRow(x.code)));
  return {ok:true,job:{id:s.id,phase:s.phase,active:ACTIVE.has(s.phase),createdAt:s.createdAt,updatedAt:s.updatedAt,expiresAt:s.expiresAt,
   options:s.options,targetDate:s.targetDate,targetSource:s.targetSource,done:s.cursor||0,total:s.phase==='scanning'?s.total:(s.work||[]).length,
   scanned:s.scanned||0,universe:s.total||0,qualified:s.qualified||0,skipped:s.skipped||0,errors:s.errors||[],message:s.message||'',futures:s.futures,
   results:rows.filter(Boolean).map(r=>{const {_hist,...visible}=r;return visible})}};
 }
 async fetch(request){
  const storage=this.ctx.storage;
  if(request.method==='GET'){
   const s=await storage.get('job');
   if(s&&Date.now()>s.expiresAt)return reply({ok:true,job:null});
   return reply(await this.snapshot(s));
  }
  // Serialize start/stop against each other; alarms commit using a status/id check.
  return this.ctx.blockConcurrencyWhile(async()=>{
   const old=await storage.get('job');
   if(request.method==='DELETE'){
    if(old&&ACTIVE.has(old.phase)){
     old.phase='stopped';old.message='已停止背景掃描';old.updatedAt=Date.now();
     await storage.put('job',old);await storage.delete('token');await storage.setAlarm(old.expiresAt);
    }
    return reply(await this.snapshot(old));
   }
   const body=await request.text();
   if(body.length>8192)return reply({ok:false,error:'設定過大'},413);
   let input,options;
   try{input=JSON.parse(body);options=validateOptions(input.options);if(!/^[a-f0-9-]{20,64}$/.test(input.id||''))throw Error('工作識別碼不正確')}catch(e){return reply({ok:false,error:e.message},400)}
   if(old&&(ACTIVE.has(old.phase)||old.id===input.id))return reply(await this.snapshot(old));
   const token=request.headers.get('x-finmind-token')||'';
   if(token.length>4096||/[\r\n]/.test(token))return reply({ok:false,error:'Token 格式不正確'},400);
   await storage.deleteAll();
   const s={id:input.id,phase:'initializing',options,origin:new URL(request.url).origin,createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+TTL,ranked:[],errors:[],cursor:0,retries:0,message:'伺服器已接收，正在準備掃描'};
   await storage.put({job:s,token});await storage.setAlarm(Date.now()+50);
   return reply(await this.snapshot(s),202);
  });
 }
 async json(path,s){
  const token=await this.ctx.storage.get('token');
  const url=new URL(path,s.origin),headers=new Headers();
  if(token)headers.set('X-FinMind-Token',token);
  const response=await api(new Request(url,{headers}),this.env);
  if(!response.ok)throw Error('資料來源 HTTP '+response.status);
  const j=await response.json();if(j.ok===false)throw Error('資料來源回報失敗');return j;
 }
 async commit(s,rows=[],remove=[]){
  return this.ctx.storage.transaction(async tx=>{
   const current=await tx.get('job');
   if(!current||current.id!==s.id||!ACTIVE.has(current.phase))return false;
   for(const row of rows)await tx.put('row:'+row.code,row);
   for(const code of remove)await tx.delete('row:'+code);
   s.updatedAt=Date.now();await tx.put('job',s);
   if(!ACTIVE.has(s.phase))await tx.delete('token');
   await tx.setAlarm(ACTIVE.has(s.phase)?Date.now()+100:s.expiresAt);
   return true;
  });
 }
 async initialize(s){
  let date='',source='';
  try{const q=await this.json('/api/intraday?code=2330&market=twse',s);if(q.quote_valid!==false){date=q.bar?.date||'';source=q.source||'盤中行情'}}catch{}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
   const end=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),start=new Date(Date.now()-45*864e5).toISOString().slice(0,10);
   const h=await this.json('/api/history/auto?'+new URLSearchParams({code:'2330',market:'twse',start_date:start,end_date:end,fresh:'1'}),s);
   date=h.data?.at(-1)?.date||'';source=h.source||'日K備援';
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('無法確認市場資料日');
  const [u,f]=await Promise.all([this.json('/api/market/universe',s),this.json('/api/futures/stock-list',s)]);
  if(!u.data?.length||!f.codes?.length)throw Error('股票或期貨名單取得失敗');
  const futures=new Set(f.codes.map(String)),map=new Map();
  for(const r of u.data){const code=String(r.code||'').trim();if(!/^[0-9A-Za-z]{4,6}$/.test(code))continue;
   if(!map.has(code)||r.market==='twse')map.set(code,{code,name:r.name||r.stock_name||code,market:r.market||'twse',hasFutures:futures.has(code)})}
  const universe=[...map.values()];if(!universe.length||universe.length>10000)throw Error('市場名單數量異常');
  // Immutable chunks avoid the per-value size limit. An interrupted initialization is repeatable.
  for(let i=0;i<universe.length;i+=100)await this.ctx.storage.put('universe:'+Math.floor(i/100),universe.slice(i,i+100));
  Object.assign(s,{targetDate:date,targetSource:source,total:universe.length,futures:{source:f.source,count:f.codes.length,degraded:f.degraded,verified_at:f.verified_at},phase:'scanning',cursor:0,scanned:0,qualified:0,skipped:0,message:'背景掃描全市場'});
 }
 async alarm(){
  let s=await this.ctx.storage.get('job');if(!s)return;
  if(Date.now()>=s.expiresAt){await this.ctx.storage.deleteAll();return}
  if(!ACTIVE.has(s.phase)){await this.ctx.storage.setAlarm(s.expiresAt);return}
  // Watchdog survives isolate termination. Progress and the next alarm commit atomically.
  await this.ctx.storage.setAlarm(Date.now()+120000);
  if(Date.now()-s.createdAt>MAX_RUN){s.phase='failed';s.message='掃描超過 4 小時，已停止；請重新掃描';await this.commit(s);return}
  try{
   if(s.phase==='initializing'){await this.initialize(s);s.retries=0;await this.commit(s);return}
   const runtime=createScanRuntime(s,path=>this.json(path,s));
   const rows=[],remove=[];
   // A small batch bounds CPU/subrequests; expensive chip requests run one stock per alarm.
   const batch=s.phase==='scanning'?Math.min(4,s.options.concurrency):1;
   if(s.phase==='scanning'){
    const items=[];
    for(let i=s.cursor;i<Math.min(s.cursor+batch,s.total);i++){
     const chunk=await this.ctx.storage.get('universe:'+Math.floor(i/100));items.push(chunk[i%100]);
    }
    const scanned=await Promise.all(items.map(item=>createScanRuntime(s,path=>this.json(path,s)).scan(item)));
    for(const {row,error} of scanned){
     s.cursor++;
     s.scanned++;
     if(error){s.skipped++;s.errors.push(error)}
     if(row){
      const ranked=runtime.selectCandidates([row]);
      if(ranked.length){s.qualified++;const before=s.ranked;s.ranked=runtime.selectCandidates([...s.ranked,row],s.options.maxStocks).map(rankRow);
       if(s.ranked.some(x=>x.code===row.code))rows.push(row);
       remove.push(...before.filter(x=>!s.ranked.some(y=>y.code===x.code)).map(x=>x.code));
      }
     }
    }
    s.message=`背景掃描 ${s.scanned}/${s.total}｜符合 ${s.qualified}｜略過 ${s.skipped}`;
    if(s.cursor>=s.total){s.phase='formalizing';s.work=s.ranked.map(x=>x.code);s.cursor=0;s.message='正式日K重評'}
   }else{
    const code=s.work[s.cursor];
    if(code){
     const row=await this.readRow(code);if(!row)throw Error('掃描紀錄缺失');
     try{
      if(s.phase==='formalizing')await runtime.formalizeListedOne(row);
      if(s.phase==='chips')await runtime.finmindRecheckOne(row);
      if(s.phase==='live')await runtime.liveCurrentRecheckOne(row);
     }catch(e){
      const field=s.phase==='chips'?'chipError':s.phase==='live'?'liveError':'formalPriceError';row[field]=String(e.message||e).slice(0,500);s.errors.push(code+': '+row[field]);
     }
     rows.push(row);s.ranked=s.ranked.map(r=>r.code===code?rankRow(row):r);s.cursor++;
    }
    s.message=({formalizing:'正式日K重評',chips:'籌碼重評',live:'盤中行情重算'})[s.phase]+` ${s.cursor}/${s.work.length}`;
    if(s.cursor>=s.work.length){
     s.ranked=runtime.selectCandidates(s.ranked);
     if(s.phase==='formalizing'){
      const old=s.ranked;s.ranked=s.ranked.slice(0,s.options.finTopN);remove.push(...old.slice(s.options.finTopN).map(r=>r.code));s.phase='chips';
     }else if(s.phase==='chips')s.phase='live';
     else{s.phase='completed';s.message=`R23 背景掃描完成｜全市場 ${s.total} 檔｜榜單 ${s.ranked.length} 檔${s.errors.length?'｜部分資料失敗或條件略過，請查看下方明細':''}`;}
     s.work=s.ranked.map(r=>r.code);s.cursor=0;
    }
   }
   s.errors=s.errors.slice(-30);s.retries=0;await this.commit(s,rows,remove);
  }catch(e){
   // Retry from the last committed cursor; never skip uncommitted rows after a crash.
   s=await this.ctx.storage.get('job');if(!s||!ACTIVE.has(s.phase))return;
   s.retries=(s.retries||0)+1;s.message='背景掃描暫時失敗，正在重試（'+s.retries+'/5）';
   // Upstream error text may contain credentials; store only a generic orchestration error.
   if(s.retries>=5){s.phase='failed';s.message='背景掃描失敗，已保留部分結果；請重新掃描'}
   const saved=await this.commit(s);
   if(saved&&ACTIVE.has(s.phase))await this.ctx.storage.setAlarm(Date.now()+Math.min(60000,2000*2**s.retries));
  }
 }
};}
