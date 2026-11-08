import fs from 'node:fs';import zlib from 'node:zlib';
import {Fc23Service} from '../src/fc23/service.mjs';import {load1494} from '../src/fc23/shared.mjs';
const map=new Map();
const storage={async get(k){return Array.isArray(k)?new Map(k.filter(x=>map.has(x)).map(x=>[x,map.get(x)])):map.get(k)},async put(k,v){if(typeof k==='object')for(const [a,b]of Object.entries(k))map.set(a,b);else map.set(k,v)},async delete(k){for(const x of Array.isArray(k)?k:[k])map.delete(x)},async transaction(fn){return fn(storage)}};
const ctx={storage,waitUntil(){}},env={FINMIND_TOKEN:process.env.FINMIND_TOKEN,ASSETS:{async fetch(req){try{return new Response(fs.readFileSync('public'+new URL(req.url).pathname))}catch{return new Response('Not found',{status:404})}}}};
const service=new Fc23Service(ctx,env);await service.run();
const delta=await service.delta(),account=await service.state(),{st:shared}=await load1494(await service.setup());
console.log(JSON.stringify({date:delta.data_as_of,status:delta.sync_status,snapshots:delta.snapshots.length,orders:delta.orders.length,error:delta.lastError,progress:await storage.get('fc23-progress')}));
// Never publish an incomplete paper account as if it were the current plan.
const verified=delta.sync_status==='current'&&account.date===shared.date&&delta.data_as_of===account.date;
const report={generated_at:new Date().toISOString(),verified,fc23_date:account.date,market_date:shared.date,checked_through:shared.lastChecked||null,sync_status:delta.sync_status,last_error:delta.lastError||shared.lastError||null,snapshot_count:delta.snapshots.length,order_count:delta.orders.length};
fs.writeFileSync('public/r1494a/fc23/refresh-report.json',JSON.stringify(report,null,2)+'\n');
if(verified)fs.writeFileSync('public/r1494a/fc23/live-bootstrap.b64',zlib.gzipSync(JSON.stringify({shared,account,delta})).toString('base64'));
else process.exitCode=1;
