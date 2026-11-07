// Background R2 multipart ZIP64 archive of independent year/priorities ZIPs.
// Progress is checkpointed after each source package. No extra FinMind calls.
const encoder=new TextEncoder(),CHUNK=8*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc(data){let n=0xffffffff;for(const b of data)n=(crcTable[(n^b)&255]^(n>>>8))>>>0;return(n^0xffffffff)>>>0}
const block=(len,cb)=>{const b=new Uint8Array(len);cb(new DataView(b.buffer));return b};
const u16=(d,o,n)=>d.setUint16(o,n,true),u32=(d,o,n)=>d.setUint32(o,n>>>0,true),u64=(d,o,n)=>d.setBigUint64(o,BigInt(n),true);
const cat=(...items)=>{const b=new Uint8Array(items.reduce((x,v)=>x+v.length,0));let at=0;for(const x of items){b.set(x,at);at+=x.length}return b};
const extra64=(nums)=>cat(block(4,d=>{u16(d,0,1);u16(d,2,nums.length*8)}),block(8*nums.length,d=>nums.forEach((v,i)=>u64(d,i*8,v))));
export function localHeader(name,size,checksum){
 const file=encoder.encode(name),ex=extra64([size,size]);
 if(file.length>65535)throw Error("ZIP filename too long");
 return cat(block(30,d=>{u32(d,0,0x04034b50);u16(d,4,45);u16(d,6,0x0800);u32(d,14,checksum);
 u32(d,18,0xffffffff);u32(d,22,0xffffffff);u16(d,26,file.length);u16(d,28,ex.length)}),file,ex)
}
export function centralHeader(e){
 const file=encoder.encode(e.name),ex=extra64([e.size,e.size,e.offset]);
 return cat(block(46,d=>{u32(d,0,0x02014b50);u16(d,4,45);u16(d,6,45);u16(d,8,0x0800);
  u32(d,16,e.crc);u32(d,20,0xffffffff);u32(d,24,0xffffffff);
  u16(d,28,file.length);u16(d,30,ex.length);u32(d,42,0xffffffff)}),file,ex)
}
export function zip64End(count,dirSize,dirStart,endOffset){
 return cat(block(56,d=>{u32(d,0,0x06064b50);u64(d,4,44n);u16(d,12,45);u16(d,14,45);
 u64(d,24,count);u64(d,32,count);u64(d,40,dirSize);u64(d,48,dirStart)}),
 block(20,d=>{u32(d,0,0x07064b50);u64(d,8,endOffset);u32(d,16,1)}),
 block(22,d=>{u32(d,0,0x06054b50);u16(d,8,0xffff);u16(d,10,0xffff);
 u32(d,12,0xffffffff);u32(d,16,0xffffffff)}))
}
export function archivePlan(job,packSize=20){
 const files=[];
 for(let year=Number(job.start.slice(0,4));year<=Number(job.end.slice(0,4));year++)
  for(const priority of job.stages)
   for(let part=1;part<=Math.ceil(job.codes.length/packSize);part++)
    files.push({year,priority,part,name:"yearly/"+year+"/batch_"+priority+"/part_"+String(part).padStart(3,"0")+".zip"});
 return files
}
export function archivePublic(a,env){
 return {enabled:!!env?.RESEARCH_ARCHIVES,phase:a?.phase||"not_started",
  done:a?.phase==="ready"&&!!env?.RESEARCH_ARCHIVES,progress:a?.cursor||0,total:a?.total||0,
  files:a?.entries?.length||0,bytesUploaded:a?.bytesUploaded||0,archiveBytes:a?.size||0,
  error:a?.error||null,validation:a?.validation||null,
  note:env?.RESEARCH_ARCHIVES?
   "R2 fixed ZIP contains independent yearly ZIP subpackages; verify outer and inner CRC after download.":
   "Cloudflare R2 RESEARCH_ARCHIVES binding is not configured; fixed archive remains disabled."}
}
export async function startArchive(ctx,env,job){
 if(!env.RESEARCH_ARCHIVES)return {status:"needs_r2"};
 if(job.phase!=="done")return {status:"waiting_for_data"};
 const old=await ctx.storage.get("rp:archive");
 if(old&&["ready","building"].includes(old.phase))return {status:"existing",archive:archivePublic(old,env)};
 const plan=archivePlan(job);
 if(!plan.length)return {status:"empty"};
 const key="research/"+job.id+"/"+job.start+"_"+job.end+"_"+job.stages.join("-")+"_ALL.zip";
 const upload=await env.RESEARCH_ARCHIVES.createMultipartUpload(key,{httpMetadata:{contentType:"application/zip"}});
 const state={phase:"building",key,uploadId:upload.uploadId,cursor:0,total:plan.length+2,parts:[],
  nextPart:1,offset:"0",pendingKey:null,entries:[],bytesUploaded:0,error:null,retries:0,created:Date.now()};
 await ctx.storage.put("rp:archive",state);await ctx.storage.setAlarm(Date.now()+250);
 return {status:"started",archive:archivePublic(state,env)}
}
function manifest(job){
 return {format:"TW-research-nested-ZIP64-v1",start:job.start,end:job.end,stages:job.stages,
  scope:job.scope,stockCount:job.codes.length,sourceStatus:job.phase,
  actualLatest:job.observedLatest||null,datasetStats:job.stats||{},recentErrors:(job.errors||[]).slice(-100),
  sourceCompletenessCertified:false,pointInTimeCertified:false,generatedAt:new Date().toISOString(),
  structure:"yearly/YYYY/batch_N/part_NNN.zip; inner ZIP holds raw CSV.gz and its own missing-data manifest",
  verification:"R2 byte size and EOCD footer checked; full CRC of downloaded archive must be independently tested"}
}
async function pendingBytes(bucket,state){
 if(!state.pendingKey)return new Uint8Array(0);
 const x=await bucket.get(state.pendingKey);
 if(!x?.body)throw Error("staged bytes missing: do not publish incomplete archive");
 return new Uint8Array(await x.arrayBuffer())
}
async function append(ctx,bucket,state,name,data){
 const before=await pendingBytes(bucket,state);
 const local=localHeader(name,BigInt(data.length),crc(data));
 const merged=cat(before,local,data);
 const upload=bucket.resumeMultipartUpload(state.key,state.uploadId);
 let at=0,nextPart=state.nextPart,parts=[...state.parts];
 while(merged.length-at>=CHUNK){
  parts.push(await upload.uploadPart(nextPart++,merged.slice(at,at+CHUNK)));
  at+=CHUNK
 }
 const tail=merged.slice(at),pendingKey="archive-stage/"+state.uploadId+"/"+(state.cursor+1)+".bin";
 await bucket.put(pendingKey,tail);
 const updated={...state,cursor:state.cursor+1,parts,nextPart,pendingKey,
  offset:String(BigInt(state.offset)+BigInt(local.length+data.length)),
  entries:[...state.entries,{name,size:String(data.length),crc:crc(data),offset:state.offset}],
  bytesUploaded:state.bytesUploaded+at,retries:0,error:null};
 await ctx.storage.put("rp:archive",updated);
 if(state.pendingKey)await bucket.delete(state.pendingKey).catch(()=>{});
 await ctx.storage.setAlarm(Date.now()+250);
 return updated
}
async function complete(ctx,bucket,state){
 const dir=cat(...state.entries.map(centralHeader)),start=BigInt(state.offset);
 const end=zip64End(state.entries.length,BigInt(dir.length),start,start+BigInt(dir.length));
 const all=cat(await pendingBytes(bucket,state),dir,end);
 const upload=bucket.resumeMultipartUpload(state.key,state.uploadId);
 let at=0,nextPart=state.nextPart,parts=[...state.parts];
 while(all.length-at>CHUNK){parts.push(await upload.uploadPart(nextPart++,all.slice(at,at+CHUNK)));at+=CHUNK}
 if(all.length>at)parts.push(await upload.uploadPart(nextPart++,all.slice(at)));
 const size=Number(start)+dir.length+end.length;
 if(!Number.isSafeInteger(size))throw Error("ZIP length exceeds safe-integer range");
 await upload.complete(parts);
 const head=await bucket.head(state.key);
 if(!head||head.size!==size)throw Error("R2 stored ZIP size mismatch");
 const footer=await bucket.get(state.key,{range:{suffix:22}});
 const last=new Uint8Array(await footer.arrayBuffer());
 if(last.length!==22||new DataView(last.buffer,last.byteOffset,22).getUint32(0,true)!==0x06054b50)
  throw Error("R2 ZIP central directory end missing");
 const done={...state,phase:"ready",cursor:state.total,size,parts,nextPart,completed:Date.now(),
  validation:{sizeMatches:true,zipEOCDPresent:true,fullCRCReadback:false,pointInTimeCertified:false},error:null};
 await ctx.storage.put("rp:archive",done);
 if(state.pendingKey)await bucket.delete(state.pendingKey).catch(()=>{});
 return done
}
export async function archiveAlarm(ctx,env,job,fetchPartial){
 if(!env.RESEARCH_ARCHIVES)return;
 const storage=ctx.storage;
 const state=await storage.get("rp:archive");
 if(!state||state.phase!=="building")return;
 try{
  const bucket=env.RESEARCH_ARCHIVES,plan=archivePlan(job);
  if(state.cursor===0)
   await append(ctx,bucket,state,"manifest.json",encoder.encode(JSON.stringify(manifest(job),null,2)+"\n"));
  else if(state.cursor===1)
   await append(ctx,bucket,state,"README.txt",encoder.encode(
    "台股飆股研究原始資料備份。外層 ZIP 含每年／各批次／股票分包 ZIP。逐一解壓內層 ZIP 後取得原始 CSV.gz 和缺漏清單。請核對 ZIP CRC、原始資料筆數及實際公告時點，勿使用未來資訊。 \n"));
  else if(state.cursor<plan.length+2){
   const target=plan[state.cursor-2];
   const r=await fetchPartial(target);
   if(!r.ok)throw Error("Source research ZIP not accessible: "+target.name+" HTTP "+r.status);
   const raw=new Uint8Array(await r.arrayBuffer());
   if(!raw.length||raw.length>75*1024*1024)throw Error("Source pack empty or exceeds 75MiB; use smaller per-pack download: "+target.name);
   await append(ctx,bucket,state,target.name,raw)
  }else await complete(ctx,bucket,state);
 }catch(e){
  const latest=(await storage.get("rp:archive"))||state,retries=(latest.retries||0)+1;
  const changed={...latest,retries,phase:retries>=5?"error":"building",error:String(e?.message||e)};
  await storage.put("rp:archive",changed);
  if(retries<5)await storage.setAlarm(Date.now()+Math.min(300000,10000*(2**retries)))
 }
}
export async function archiveResponse(env,state,req){
 if(!env.RESEARCH_ARCHIVES)return new Response("R2 bucket not configured",{status:503});
 if(!state||state.phase!=="ready")return new Response("Archive is not ready",{status:409});
 const head=await env.RESEARCH_ARCHIVES.head(state.key);
 if(!head||head.size!==state.size)return new Response("Archive not found or wrong size",{status:503});
 const range=req.headers.get("range")||"";
 if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
  return new Response(null,{status:416,headers:{"content-range":"bytes */"+head.size}});
 const obj=await env.RESEARCH_ARCHIVES.get(state.key,range?{range:req.headers}:{});
 if(!obj?.body)return new Response("Archive unavailable",{status:503});
 const headers=new Headers({"content-type":"application/zip","cache-control":"private,no-store",
  "accept-ranges":"bytes","x-content-type-options":"nosniff",
  "content-disposition":'attachment; filename="TW_Momentum_Research_ALL.zip"'});
 if(head.httpEtag)headers.set("etag",head.httpEtag);
 if(range&&obj.range){
  const r=obj.range,from="offset" in r?r.offset:Math.max(0,obj.size-r.suffix);
  const length="length" in r?r.length:obj.size-from;
  headers.set("content-range","bytes "+from+"-"+(from+length-1)+"/"+obj.size);
  headers.set("content-length",String(length));
  return new Response(obj.body,{status:206,headers})
 }
 headers.set("content-length",String(head.size));
 return new Response(obj.body,{status:200,headers})
}
