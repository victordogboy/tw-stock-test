// Streaming ZIP64 archive over existing .csv.gz members. Compression method STORE:
// preserve original FinMind gzip bytes without inflating/recompressing or buffering files.
// ZIP64 is mandatory when six years of all-stock one-minute data exceed 4 GiB.
const encoder=new TextEncoder();
const table=Uint32Array.from({length:256},(_,i)=>{
 let c=i;for(let b=0;b<8;b++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0
});
const crc=(previous,bytes)=>{
 let value=previous^0xffffffff;
 for(const b of bytes)value=(table[(value^b)&255]^(value>>>8))>>>0;
 return (value^0xffffffff)>>>0
};
const v=(size,fn)=>{const b=new Uint8Array(size);fn(new DataView(b.buffer));return b};
const u16=(d,o,n)=>d.setUint16(o,n,true),u32=(d,o,n)=>d.setUint32(o,n>>>0,true),
 u64=(d,o,n)=>d.setBigUint64(o,BigInt(n),true);
const concat=(...items)=>{const b=new Uint8Array(items.reduce((a,x)=>a+x.length,0));let i=0;for(const x of items){b.set(x,i);i+=x.length}return b};
const ex64=(sizes)=>concat(v(4,d=>{u16(d,0,1);u16(d,2,sizes.length*8)}),v(sizes.length*8,d=>sizes.forEach((n,i)=>u64(d,i*8,n))));
const header=(name)=>{
 const nameBytes=encoder.encode(name),extra=ex64([0n,0n]);
 if(nameBytes.length>65535)throw Error("ZIP 名稱過長");
 const bytes=v(30,d=>{
  u32(d,0,0x04034b50);u16(d,4,45);u16(d,6,0x0808);u16(d,8,0);u16(d,10,0);u16(d,12,0);
  u32(d,14,0);u32(d,18,0xffffffff);u32(d,22,0xffffffff);
  u16(d,26,nameBytes.length);u16(d,28,extra.length)
 });
 return concat(bytes,nameBytes,extra)
};
const descriptor=(crc32,size)=>v(24,d=>{u32(d,0,0x08074b50);u32(d,4,crc32);u64(d,8,size);u64(d,16,size)});
const central=(item)=>{
 const name=encoder.encode(item.name),extra=ex64([item.size,item.size,item.offset]);
 const fixed=v(46,d=>{
  u32(d,0,0x02014b50);u16(d,4,45);u16(d,6,45);u16(d,8,0x0808);
  u16(d,10,0);u16(d,12,0);u16(d,14,0);u32(d,16,item.crc);
  u32(d,20,0xffffffff);u32(d,24,0xffffffff);
  u16(d,28,name.length);u16(d,30,extra.length);
  u16(d,32,0);u16(d,34,0);u16(d,36,0);u32(d,38,0);u32(d,42,0xffffffff)
 });
 return concat(fixed,name,extra)
};
const finish=(count,centralSize,centralOffset,zip64Offset)=>{
 const eocd64=v(56,d=>{
  u32(d,0,0x06064b50);u64(d,4,44n);u16(d,12,45);u16(d,14,45);
  u32(d,16,0);u32(d,20,0);u64(d,24,BigInt(count));u64(d,32,BigInt(count));
  u64(d,40,centralSize);u64(d,48,centralOffset)
 });
 const loc=v(20,d=>{u32(d,0,0x07064b50);u32(d,4,0);u64(d,8,zip64Offset);u32(d,16,1)});
 const end=v(22,d=>{
  u32(d,0,0x06054b50);u16(d,4,0);u16(d,6,0);
  u16(d,8,0xffff);u16(d,10,0xffff);u32(d,12,0xffffffff);u32(d,16,0xffffffff);u16(d,20,0)
 });
 return [eocd64,loc,end]
};
export function streamZip64(entries){
 if(!Array.isArray(entries)||entries.length===0||entries.length>1000)throw Error("ZIP 檔案數量異常");
 const names=new Set();
 for(const x of entries){
  if(typeof x?.name!=="string"||!x.name||x.name.includes("..")||x.name.startsWith("/")||names.has(x.name)||typeof x.open!=="function")
   throw Error("ZIP 檔名或讀取器無效");
  names.add(x.name)
 }
 async function* chunks(){
  const directory=[];let offset=0n;
  for(const item of entries){
   const at=offset,local=header(item.name);
   yield local;offset+=BigInt(local.length);
   const response=await item.open();
   if(!response?.ok||!response.body)throw Error("ZIP 封裝讀取失敗："+item.name+" HTTP "+response?.status);
   const reader=response.body.getReader();
   let size=0n,checksum=0;
   try{
    for(;;){
     const {value,done}=await reader.read();if(done)break;
     const b=value instanceof Uint8Array?value:new Uint8Array(value);
     if(!b.length)continue;
     size+=BigInt(b.length);checksum=crc(checksum,b);
     yield b;offset+=BigInt(b.length)
    }
   }finally{reader.releaseLock()}
   const dd=descriptor(checksum,size);yield dd;offset+=BigInt(dd.length);
   directory.push({name:item.name,offset:at,size,crc:checksum})
  }
  const centralStart=offset;
  for(const item of directory){const bytes=central(item);yield bytes;offset+=BigInt(bytes.length)}
  const ending=finish(directory.length,offset-centralStart,centralStart,offset);
  for(const bytes of ending)yield bytes
 }
 const gen=chunks();
 return new ReadableStream({
  async pull(controller){
   try{
    const next=await gen.next();
    if(next.done)controller.close();else controller.enqueue(next.value)
   }catch(e){controller.error(e)}
  },
  async cancel(){if(gen.return)await gen.return()}
 })
}
export function stockArchiveManifest({minute,companion,mode,startedAt}){
 return {format:"stock-minute-and-daily-research-v1",generatedAt:startedAt,
  from:minute.start,to:minute.end,
  stockCount:minute.codeCount,minuteRecords:minute.rows,
  dailyCompanion:companion?{mode:companion.mode,rows:companion.rows}:null,
  contents:mode==="stocks"?"one-minute CSV.gz files (year partitions) + optional daily research CSV.gz (year partitions)":"daily-price or daily-research CSV.gz (year partitions)",
  joinKeys:["stock_id","date"],
  warnings:[
   "Daily institutional, margin, foreign holding, lending, and futures information may only become public AFTER the session. Do not use same-day close or earlier intraday information as if it had been known.",
   "Only currently futures-eligible stocks are selected: survivorship bias. Futures history for current symbols does not prove formal listing history.",
   "Raw data unadjusted for stock splits and dividends. Securities-lending transactions are not securities-lending outstanding balances.",
   "ZIP64 archive stores original GZIP members without recompression; open the ZIP, then decompress each CSV.gz as required."
  ]}
}
