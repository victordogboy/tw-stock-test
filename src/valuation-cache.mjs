// Durable shared fundamentals snapshot. Prices are supplied by the scanner, not cached here.
import {forwardPeRoute} from './forward-pe.mjs';
import worker from './index.js';
export class ValuationCache {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=null;}
 async refresh(){
  if(this.pending)return this.pending;
  this.pending=(async()=>{
   const response=await forwardPeRoute(new Request('https://valuation.internal/api/pe-screener/data?refresh=1'),this.env,(r)=>worker.fetch(r,this.env));
   const j=await response.json();
   if(!response.ok||!j.ok||!Array.isArray(j.rows)||!j.rows.length)throw Error('估值來源更新失敗');
   const rows=j.rows.map(r=>({code:r.code,models:{A:r.models?.A},latestRevenueMonth:r.latestRevenueMonth,financeQuarter:r.financeQuarter,financeIssueDate:r.financeIssueDate}));
   const saved={ok:true,rows,checkedAt:Date.now(),sourceSnapshotAt:j.date,sourceErrors:j.errors||[]};
   await this.ctx.storage.put('snapshot',saved);return saved;
  })().finally(()=>{this.pending=null;});return this.pending;
 }
 async fetch(request){
  const force=new URL(request.url).pathname==='/refresh';
  const saved=await this.ctx.storage.get('snapshot');
  if(force||!saved){
   try{return Response.json(await this.refresh());}
   catch{return saved?Response.json({...saved,stale:true,refreshError:true}):Response.json({ok:false,error:'估值資料暫時無法取得'}, {status:503});}
  }
  const age=Date.now()-saved.checkedAt;
  // Scheduled refresh is primary; recover missed schedules without blocking readers.
  if(age>6*3600000)this.ctx.waitUntil(this.refresh().catch(()=>{}));
  return Response.json({...saved,stale:age>24*3600000},{headers:{'cache-control':'no-store'}});
 }
}
export function valuationStub(env){return env.VALUATION_CACHE.get(env.VALUATION_CACHE.idFromName('shared-fundamentals'));}
