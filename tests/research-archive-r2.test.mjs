import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {archivePlan,archivePublic,startArchive,archiveAlarm,archiveResponse,localHeader} from "../src/research-archive-r2.mjs";
import {streamZip64} from "../src/stock-archive.mjs";

function memoryR2(){
 const objects=new Map(),staging=new Map(),uploads=new Map(),counters={chunks:0};
 let nextId=0;
 const bytes=x=>x instanceof Uint8Array?x:new Uint8Array(x);
 const fakeBody=x=>({body:new Response(x).body,arrayBuffer:async()=>x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength),
  size:x.length,range:null});
 const bucket={
  async put(key,data){const b=bytes(data);objects.set(key,b);return {size:b.length}},
  async delete(key){objects.delete(key)},
  async head(key){const data=objects.get(key);return data?{size:data.length,httpEtag:'"test-etag"'}:null},
  async get(key,opt={}){
   const data=objects.get(key);if(!data)return null;
   if(opt.range?.suffix!==undefined){const n=opt.range.suffix;return fakeBody(data.slice(-n))}
   if(opt.range instanceof Headers){
    const raw=opt.range.get("range")||"";const m=raw.match(/^bytes=(\d+)-(\d+)$/);
    if(m){
     const start=+m[1],end=Math.min(+m[2],data.length-1);
     const res=fakeBody(data.slice(start,end+1));res.range={offset:start,length:end-start+1};res.size=data.length;return res
    }
   }
   return fakeBody(data)
  },
  async createMultipartUpload(key){
   const uploadId="mpu-"+(++nextId);uploads.set(uploadId,{key,parts:new Map()});
   return {uploadId,key}
  },
  resumeMultipartUpload(key,uploadId){
   const upload=uploads.get(uploadId);
   if(!upload||upload.key!==key)throw Error("unknown multipart");
   return {uploadPart:async(no,data)=>{const b=bytes(data);upload.parts.set(no,b);counters.chunks++;return {partNumber:no,etag:"part-"+no}},
    complete:async(parts)=>{
     assert.deepEqual(parts.map(x=>x.partNumber),[...upload.parts.keys()].sort((a,b)=>a-b));
     const buffers=parts.map(p=>upload.parts.get(p.partNumber));
     const size=buffers.reduce((n,b)=>n+b.length,0),whole=new Uint8Array(size);
     let at=0;for(const b of buffers){whole.set(b,at);at+=b.length}
     objects.set(key,whole);return {size}
    },
    abort:async()=>uploads.delete(uploadId)}
  }
 };
 return {bucket,objects,uploads,counters}
}
function dummyJob(){
 return {id:"test-job-cc00",start:"2026-11-06",end:"2026-11-06",stages:[1],
  scope:"futures",codes:[{code:"2330"}],phase:"done",rows:3,stats:{TaiwanStockPrice:{rows:2}},
  observedLatest:"2026-11-06",errors:[]}
}
function storage(){const map=new Map();let alarms=0;return {
 map,async get(k){return map.get(k)},async put(k,v){map.set(k,v)},
 async setAlarm(){alarms++},get alarms(){return alarms}
}}
test("archive plan contains every year/prioritiy/stock subpack once",()=>{
 const job={...dummyJob(),start:"2024-01-01",stages:[1,2,3],codes:Array.from({length:43},(_,i)=>({code:String(i)}))};
 const plan=archivePlan(job,20);
 assert.equal(plan.length,3*3*3);
 assert.equal(new Set(plan.map(x=>x.name)).size,plan.length);
 assert.ok(plan.some(x=>x.name==="yearly/2026/batch_3/part_003.zip"));
});
test("no R2 binding never fakes a completed archive or schedules background",async()=>{
 const store=storage(),ctx={storage:store};
 assert.deepEqual(await startArchive(ctx,{},dummyJob()),{status:"needs_r2"});
 assert.equal(store.alarms,0);
 assert.equal(archivePublic(null,{}).done,false);
 const res=await archiveResponse({},null,new Request("https://a/"));
 assert.equal(res.status,503)
});
test("background R2 multipart archive is a real ZIP64 with valid inner ZIP, then HTTP Range 206 works",async()=>{
 const f=memoryR2(),store=storage(),ctx={storage:store},env={RESEARCH_ARCHIVES:f.bucket},job=dummyJob();
 const zipped=Buffer.from(await new Response(streamZip64([{name:"01_stock_price/TaiwanStockPrice/2330_2026.csv.gz",
  open:async()=>new Response(new Uint8Array([31,139,8,0]))}])).arrayBuffer());
 const result=await startArchive(ctx,env,job);assert.equal(result.status,"started");
 let calls=0;
 for(let i=0;i<5;i++)await archiveAlarm(ctx,env,job,async p=>{
  calls++;assert.equal(p.year,2026);assert.equal(p.priority,1);assert.equal(p.part,1);
  return new Response(zipped)
 });
 assert.equal(calls,1);
 const state=await store.get("rp:archive");
 assert.equal(state.phase,"ready");assert.equal(state.cursor,4);assert.equal(state.entries.length,3);
 assert.ok(state.validation.zipEOCDPresent);assert.equal(state.validation.fullCRCReadback,false);
 assert.equal(state.size,f.objects.get(state.key).length);
 const binary=f.objects.get(state.key);
 const py=String.raw`
import io,sys,json,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert z.namelist()==["manifest.json","README.txt","yearly/2026/batch_1/part_001.zip"]
m=json.loads(z.read("manifest.json"))
assert m["sourceCompletenessCertified"] is False
inner=zipfile.ZipFile(io.BytesIO(z.read("yearly/2026/batch_1/part_001.zip")))
assert inner.testzip() is None
assert "TaiwanStockPrice" in inner.namelist()[0]
print("ok")
`;
 const x=spawnSync("python3",["-c",py],{input:binary,encoding:"utf8"});
 assert.equal(x.status,0,x.stderr);assert.match(x.stdout,/ok/);
 const full=await archiveResponse(env,state,new Request("https://example.test/download"));
 assert.equal(full.status,200);assert.equal(+full.headers.get("content-length"),state.size);
 const range=await archiveResponse(env,state,new Request("https://example.test/download",
  {headers:{range:"bytes=0-99"}}));
 assert.equal(range.status,206);assert.equal(range.headers.get("content-range"),"bytes 0-99/"+state.size);
 assert.equal((await range.arrayBuffer()).byteLength,100);
 const no=await archiveResponse(env,state,new Request("https://example.test/download",
  {headers:{range:"bytes=invalid"}}));
 assert.equal(no.status,416)
});
test("large 9MiB source triggers uniform 8MiB multipart and checkpointed upload",async()=>{
 const f=memoryR2(),store=storage(),ctx={storage:store},env={RESEARCH_ARCHIVES:f.bucket},job=dummyJob();
 assert.equal((await startArchive(ctx,env,job)).status,"started");
 const payload=new Uint8Array(9*1024*1024);payload.fill(36);
 for(let i=0;i<4;i++)await archiveAlarm(ctx,env,job,async()=>new Response(payload));
 const done=await store.get("rp:archive");
 assert.equal(done.phase,"ready");
 assert.ok(done.parts.length>=2);
 assert.equal(f.uploads.get(done.uploadId).parts.get(1).length,8*1024*1024);
 assert.equal(f.objects.get(done.key).length,done.size);
});
test("research frontend clearly distinguishes bound R2 vs disabled, and never enables button early",()=>{
 const page=readFileSync(new URL("../public/research-pack-download.html",import.meta.url),"utf8");
 assert.match(page,/id="archiveDownload"/);
 assert.match(page,/id="archiveEnabled"/);
 assert.match(page,/id="archiveBar"/);
 const js=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.doesNotThrow(()=>new Function(js));
 assert.match(js,/a\?\.phase==="building"/);
 assert.match(js,/\/api\/research-pack\/archive-download/);
});
