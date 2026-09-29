// Deterministic upstream fixture used only by local end-to-end tests.
import {createScanJobClass,scanRoute} from '../../src/scan-job.mjs';
const rows=Array.from({length:220},(_,i)=>{const c=30+i*.05+Math.sin(i/4);return {date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000}});
rows.at(-1).volume=8000000;
async function api(req){
 const u=new URL(req.url);let j;
 if(u.pathname==='/api/intraday')j={ok:true,quote_valid:true,bar:{...rows.at(-1),last_time:'13:30:00'}};
 else if(u.pathname==='/api/history/auto')j={ok:true,data:rows};
 else if(u.pathname==='/api/market/universe')j={data:['1111','2222','2368','3333','4444','5555','6666'].map(code=>({code,name:code==='2368'?'金像電':'測試股票',market:'twse'}))};
 else if(u.pathname==='/api/futures/stock-list')j={codes:['2368'],source:'fixture'};
 else if(u.pathname==='/api/chips/hybrid')j={ok:true,margin:[],inst:[],daytrade:[],completeness:0};
 else j={ok:true,data:[],configured:false};
 return Response.json(j);
}
export const ScanJob=createScanJobClass(api);
export default {fetch:(req,env)=>new URL(req.url).pathname.startsWith('/api/scan/')?scanRoute(req,env):api(req)};
