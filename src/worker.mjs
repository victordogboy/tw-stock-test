import worker from './index.js';
import {createScanJobClass,scanRoute} from './scan-job.mjs';
export const ScanJob=createScanJobClass((request,env)=>worker.fetch(request,env));
export default {
 fetch(request,env,ctx){
  if(new URL(request.url).pathname.startsWith('/api/scan/'))return scanRoute(request,env);
  return worker.fetch(request,env,ctx);
 }
};
