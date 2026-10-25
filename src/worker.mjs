import {stockFuturesRoute,StockFuturesBatch,StockFuturesData} from './stock-futures-download.mjs';
import {txDownloadRoute,TxDownloadJob} from './tx-download.mjs';
import worker from './index.js';
import {forwardPeRoute} from './forward-pe.mjs';
import {createScanJobClass,scanRoute} from './scan-job.mjs';
import {taiexFuturesRoute} from './taiex-futures.mjs';
import {taiexVixRoute} from './taiex-vix.mjs';
export {TxDownloadJob,StockFuturesBatch,StockFuturesData};
export const ScanJob=createScanJobClass((request,env)=>worker.fetch(request,env));
export default {
 fetch(request,env,ctx){
  if(new URL(request.url).pathname.startsWith('/api/stock-futures/'))return stockFuturesRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/stock-kbar/'))return stockFuturesRoute(request,env,'stocks');
  if(new URL(request.url).pathname.startsWith('/api/tx-download/'))return txDownloadRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/pe-screener/'))return forwardPeRoute(request,env,(r)=>worker.fetch(r,env,ctx));
  if(new URL(request.url).pathname==='/api/futures/taiex/vix')return taiexVixRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/futures/taiex/'))return taiexFuturesRoute(request,env);
  if(new URL(request.url).pathname.startsWith('/api/scan/'))return scanRoute(request,env);
  return worker.fetch(request,env,ctx);
 }
};
