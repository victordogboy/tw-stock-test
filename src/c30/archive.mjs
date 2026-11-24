// C30 private, durable cloud archive. No FinMind dependency.
// Cloudflare secret C30_ARCHIVE_SECRET MUST be configured before use.
// Dedicated SQLite-backed Durable Object: keeps history separate from trading engines.
const JSONH={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const CHUNK=256*1024,FILE_LIMIT=700*1024*1024,VAULT_LIMIT=850*1024*1024;
const msg=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:JSONH});
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const keyOk=(req,env)=>{const secret=String(env.C30_ARCHIVE_SECRET||''),given=req.headers.get('x-c30-archive-key')||'';if(secret.length<16||secret.length>256||!given||given.length!==secret.length)return false;let diff=0;for(let i=0;i<secret.length;i++)diff|=secret.charCodeAt(i)^given.charCodeAt(i);return diff===0};
const limitedJson=async(req,max=2e6)=>{if(Number(req.headers.get('content-length')||0)>max)throw Error('BODY_TOO_LARGE');const b=await req.text();if(b.length>max)throw Error('BODY_TOO_LARGE');return JSON.parse(b)};
const okRow=x=>x&&iso(x.date)&&/^\d{2}:\d{2}:\d{2}$/.test(x.minute||'')&&x.minute>='09:00:00'&&x.minute<='14:30:00'&&['open','high','low','close','volume_shares'].every(v=>typeof x[v]==='number'&&Number.isFinite(x[v])&&x[v]>=0)&&x.open>0&&x.low>0&&x.high>0&&x.close>0&&x.low<=Math.min(x.open,x.close)&&x.high>=Math.max(x.open,x.close);
export async function c30ArchiveRoute(request,env){if(!env.C30_ARCHIVE){return msg({ok:false,code:'BINDING_MISSING',error:'C30 雲端資料庫尚未部署'},503)}if(!env.C30_ARCHIVE_SECRET||String(env.C30_ARCHIVE_SECRET).length<16)return msg({ok:false,code:'SECRET_NOT_CONFIGURED',error:'請先在 Cloudflare Worker Secrets 新增 C30_ARCHIVE_SECRET（16 字元以上）'},503);
if(!keyOk(request,env))return msg({ok:false,code:'UNAUTHORIZED',error:'C30 雲端封存金鑰不正確'},401);
const url=new URL(request.url),origin=request.headers.get('origin');if(origin&&origin!==url.origin)return msg({ok:false,code:'BAD_ORIGIN'},403);
const stub=env.C30_ARCHIVE.get(env.C30_ARCHIVE.idFromName('c30-main-v1'));return stub.fetch(request)}
export class C30Archive{
 constructor(ctx,env){this.ctx=ctx;this.env=env}
 async fetch(req){if(!keyOk(req,this.env))return msg({ok:false,code:'UNAUTHORIZED'},401);const u=new URL(req.url),path=u.pathname,m=req.method,s=this.ctx.storage;
 try{
 if(path==='/api/c30/archive/status'&&m==='GET'){
   const a=await s.list({prefix:'day:'}),f=await s.list({prefix:'file:'});
   const days=[...a].map(([k,v])=>({date:k.slice(4),stocks:Object.keys(v.codes||{}).length,bars:Object.values(v.codes||{}).reduce((z,x)=>z+(x.bars||0),0),updated_at:v.updated_at})).sort((x,y)=>y.date.localeCompare(x.date));
   const files=[...f.values()].map(v=>({id:v.id,name:v.name,size:v.size,sha256:v.sha256||null,parts:v.parts,state:v.state,updated_at:v.updated_at,created_at:v.created_at})).sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at)));
   const committedBytes=files.filter(v=>v.state==='complete').reduce((z,v)=>z+v.size,0);
   return msg({ok:true,storage:'C30 SQLite Durable Object',days,files,committed_bytes:committedBytes,limit_bytes:VAULT_LIMIT,minute_data_source:'cloud',note:'原始 ZIP 為原檔封存；不等於已轉成策略引擎輸入'});
 }
 if(path==='/api/c30/archive/bars'&&m==='POST'){
   const q=await limitedJson(req,3e6),code=String(q.code||''),market=q.market,provider=q.provider;
   if(!/^\d{4}$/.test(code)||!['TWSE','TPEx'].includes(market)||!['Fugle Free API','Yahoo chart fallback'].includes(provider)||!Array.isArray(q.bars)||q.bars.length>10000)return msg({ok:false,error:'BAR_INPUT_INVALID'},400);
   const groups=new Map();let rejects=0;
   for(const r of q.bars){if(!okRow(r)||r.stock_id!==code){rejects++;continue}const list=groups.get(r.date)||new Map();list.set(r.minute,[r.minute,r.open,r.high,r.low,r.close,r.volume_shares]);groups.set(r.date,list)}
   if(groups.size>40||!groups.size)return msg({ok:false,error:'BAR_DAYS_INVALID',rejects},400);
   let saved=0,skip=0;for(const [date,rows] of groups){const k='bar:'+date+':'+code;const existing=await s.get(k);if(existing?.provider==='Fugle Free API'&&provider!=='Fugle Free API'){skip++;continue}
     const obj={date,code,market,provider,updated_at:new Date().toISOString(),rows:[...rows.values()].sort((a,b)=>a[0].localeCompare(b[0]))};
     const dk='day:'+date,di=await s.get(dk)||{codes:{},updated_at:''};di.codes[code]={bars:obj.rows.length,provider};di.updated_at=obj.updated_at;
     await s.put({[k]:obj,[dk]:di});saved++;
   }
   return msg({ok:true,code,saved_days:saved,skipped_days:skip,invalid_bars:rejects,cloud_saved:true});
 }
 if(path==='/api/c30/archive/day'&&m==='GET'){
   const date=u.searchParams.get('date');if(!iso(date))return msg({ok:false,error:'DATE_REQUIRED'},400);
   const all=await s.list({prefix:'bar:'+date+':'});
   return msg({ok:true,date,stocks:all.size,items:[...all.values()]});
 }
 if(path==='/api/c30/archive/file/start'&&m==='POST'){
   const q=await limitedJson(req,2000),name=String(q.name||'').replace(/[\\/\x00-\x1f]/g,'_').slice(0,170),size=Number(q.size),sha=String(q.sha256||'').toLowerCase();
   if(!name||!/\.(zip|csv|gz|json|parquet|npz)$/i.test(name)||!Number.isSafeInteger(size)||size<=0||size>FILE_LIMIT||!(/^[0-9a-f]{64}$/.test(sha)))return msg({ok:false,error:'FILE_NAME_SIZE_OR_HASH_INVALID'},400);
   const all=await s.list({prefix:'file:'});let total=0;
   for(const f of all.values()){if(f.state==='complete')total+=f.size;if(f.size===size&&f.sha256===sha&&f.state==='complete')return msg({ok:true,already_saved:true,id:f.id,uploaded_parts:f.parts,parts:f.parts,filename:f.name});if(f.size===size&&f.sha256===sha&&f.state==='uploading')return msg({ok:true,resume:true,id:f.id,uploaded_parts:(await s.list({prefix:'chunk:'+f.id+':'})).size,parts:f.parts,filename:f.name})}
   if(total+size>VAULT_LIMIT)return msg({ok:false,code:'QUOTA_LIMIT',error:'雲端已達安全容量上限；請改用 Cloudflare R2 保存更大型歷史資料',committed:total,requested:size,limit:VAULT_LIMIT},413);
   const id=crypto.randomUUID().replaceAll('-',''),ts=new Date().toISOString(),meta={id,name,size,sha256:sha,parts:Math.ceil(size/CHUNK),state:'uploading',created_at:ts,updated_at:ts};
   await s.put('file:'+id,meta);return msg({ok:true,id,parts:meta.parts,uploaded_parts:0,filename:name});
 }
 if(path==='/api/c30/archive/file/progress'&&m==='GET'){
   const id=u.searchParams.get('id')||'';if(!/^[a-f0-9]{32}$/.test(id))return msg({ok:false,error:'BAD_ID'},400);
   const meta=await s.get('file:'+id);if(!meta)return msg({ok:false,error:'NOT_FOUND'},404);
   const chunks=await s.list({prefix:'chunk:'+id+':'}),indices=[...chunks.keys()].map(k=>Number(k.split(':').at(-1))).filter(Number.isInteger);return msg({ok:true,meta,uploaded_indices:indices});
 }
 if(path==='/api/c30/archive/file/chunk'&&m==='PUT'){
   const id=u.searchParams.get('id')||'',index=Number(u.searchParams.get('index'));
   if(!/^[a-f0-9]{32}$/.test(id)||!Number.isSafeInteger(index)||index<0)return msg({ok:false,error:'BAD_CHUNK'},400);
   const meta=await s.get('file:'+id);if(!meta||meta.state!=='uploading'||index>=meta.parts)return msg({ok:false,error:'UPLOAD_NOT_OPEN'},409);
   const bytes=new Uint8Array(await req.arrayBuffer()),expected=index===meta.parts-1?meta.size-index*CHUNK:CHUNK;
   if(bytes.length!==expected)return msg({ok:false,error:'BAD_CHUNK_SIZE',expected,received:bytes.length},400);
   const claimed=req.headers.get('x-c30-chunk-sha256');
   if(!/^[0-9a-f]{64}$/.test(claimed||''))return msg({ok:false,error:'CHUNK_HASH_REQUIRED'},400);
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(digest!==claimed)return msg({ok:false,error:'CHUNK_CHECKSUM_FAILED'},422);
   await s.put('chunk:'+id+':'+index,bytes);return msg({ok:true,id,index,saved:true});
 }
 if(path==='/api/c30/archive/file/finish'&&m==='POST'){
   const q=await limitedJson(req,1000),id=String(q.id||'');
   if(!/^[a-f0-9]{32}$/.test(id))return msg({ok:false,error:'BAD_ID'},400);
   const meta=await s.get('file:'+id);if(!meta)return msg({ok:false,error:'NOT_FOUND'},404);
   if(meta.state==='complete')return msg({ok:true,id,already_finished:true});
   const chunks=await s.list({prefix:'chunk:'+id+':'});if(chunks.size!==meta.parts)return msg({ok:false,error:'INCOMPLETE_PARTS',have:chunks.size,expected:meta.parts},409);
   let size=0;for(let i=0;i<meta.parts;i++){const p=chunks.get('chunk:'+id+':'+i);if(!(p instanceof Uint8Array))return msg({ok:false,error:'CHUNK_CORRUPT',index:i},409);size+=p.byteLength}
   if(size!==meta.size)return msg({ok:false,error:'FILE_SIZE_MISMATCH',size,expected:meta.size},409);
   meta.state='complete';meta.updated_at=new Date().toISOString();await s.put('file:'+id,meta);return msg({ok:true,id,complete:true,filename:meta.name,bytes:size,sha256_client:meta.sha256});
 }
 if(path==='/api/c30/archive/file/download'&&m==='GET'){
   const id=u.searchParams.get('id')||'';if(!/^[a-f0-9]{32}$/.test(id))return msg({ok:false,error:'BAD_ID'},400);
   const meta=await s.get('file:'+id);if(meta?.state!=='complete')return msg({ok:false,error:'NOT_READY'},404);
   let i=0;const stream=new ReadableStream({async pull(controller){if(i>=meta.parts){controller.close();return}const bytes=await s.get('chunk:'+id+':'+i++);if(!(bytes instanceof Uint8Array)){controller.error(Error('Archive chunk missing'));return}controller.enqueue(bytes)}});const safeName=meta.name.replace(/["\\\r\n]/g,'_');
   return new Response(stream,{headers:{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+safeName+'"','cache-control':'no-store','x-c30-sha256-client':meta.sha256}});
 }
 return msg({ok:false,error:'UNKNOWN_ARCHIVE_ROUTE'},404)
 }catch(e){return msg({ok:false,code:'ARCHIVE_ERROR',error:String(e?.message||e).slice(0,300)},500)}
 }
}
export const C30_ARCHIVE_CHUNK_SIZE=CHUNK;
