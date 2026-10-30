import {ValuationCache,valuationStub} from './valuation-cache.mjs';
import {stockFuturesRoute,StockFuturesBatch,StockFuturesData} from './stock-futures-download.mjs';
import {txDownloadRoute,TxDownloadJob} from './tx-download.mjs';
import {etfVixDailyRoute} from './etf-vix-daily.mjs';
import {etfDividendRoute} from './etf-dividends-0050.mjs';
import worker from './index.js';
import {forwardPeRoute} from './forward-pe.mjs';
import {createScanJobClass,scanRoute} from './scan-job.mjs';
import {taiexFuturesRoute} from './taiex-futures.mjs';
import {taiexVixRoute} from './taiex-vix.mjs';
import {r26MarketRoute} from './r26-market.mjs';
import {r26BridgeRoute} from './r26-bridge.mjs';
import {r26LiveQuoteRoute} from './r26-live-quote.mjs';
export {TxDownloadJob,StockFuturesBatch,StockFuturesData};
const BaseScanJob=createScanJobClass((request,env)=>worker.fetch(request,env));
// Existing namespace, isolated named object: no new namespace migration for preview uploads.
export class ScanJob extends BaseScanJob {
 constructor(ctx,env){super(ctx,env);this.valuation=new ValuationCache(ctx,env);}
 fetch(request){
  if(new URL(request.url).pathname.startsWith('/valuation/'))return this.valuation.fetch(request);
  return super.fetch(request);
 }
}
export default {
 scheduled(event,env,ctx){ctx.waitUntil(valuationStub(env).fetch(new Request('https://valuation.internal/valuation/refresh')));},
 fetch(request,env,ctx){
  if(new URL(request.url).pathname==='/api/pe-screener/snapshot'){
   if(request.method!=='GET')return new Response('Method not allowed',{status:405});
   return valuationStub(env).fetch(new Request('https://valuation.internal/valuation/snapshot'));
  }
  if(['/api/r26/intraday','/api/r26/official-zip'].includes(new URL(request.url).pathname))return r26MarketRoute(request,env);
  if(new URL(request.url).pathname==='/api/r26/live-quote')return r26LiveQuoteRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/r26/'))return r26BridgeRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/stock-futures/'))return stockFuturesRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/stock-kbar/'))return stockFuturesRoute(request,env,'stocks');
  if(new URL(request.url).pathname.startsWith('/api/stock-daily/'))return stockFuturesRoute(request,env,'daily');
  if(new URL(request.url).pathname.startsWith('/api/market-daily/')){
   return Promise.resolve().then(()=>stockFuturesRoute(request,env,'market-daily')).catch(e=>
    new Response(JSON.stringify({ok:false,code:"MARKET_DAILY_WORKER_ERROR",
      error:"全市場日K API 執行錯誤，既有雲端資料未因本次查詢被清除",
      reason:String(e?.name||"Error"),version:"r55-status-guard"}),{
      status:503,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
    })
   );
  }
  if(new URL(request.url).pathname.startsWith('/api/stock-daily-chip/'))return stockFuturesRoute(request,env,'daily-chip');
  if(new URL(request.url).pathname.startsWith('/api/stock-daily-research/'))return stockFuturesRoute(request,env,'daily-research');
  if(new URL(request.url).pathname.startsWith('/api/tx-download/'))return txDownloadRoute(request,env);
  if(new URL(request.url).pathname==='/api/etf-vix-daily')return etfVixDailyRoute(request,env);
  if(new URL(request.url).pathname==='/api/etf-dividends-0050')return etfDividendRoute(request);
  if(new URL(request.url).pathname.startsWith('/api/pe-screener/'))return forwardPeRoute(request,env,(r)=>worker.fetch(r,env,ctx));
  if(new URL(request.url).pathname==='/api/futures/taiex/vix')return taiexVixRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/futures/taiex/'))return taiexFuturesRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/scan/'))return scanRoute(request,env);
  return worker.fetch(request,env,ctx);
 }
};
