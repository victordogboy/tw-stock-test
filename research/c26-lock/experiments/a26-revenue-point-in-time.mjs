import fs from 'node:fs';
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw Error('Missing configured secret');
const {codes,dates}={"codes":["1101","1102","1210","1216","1301","1303","1312","1314","1319","1326","1402","1440","1476","1477","1503","1504","1513","1536","1560","1565","1590","1605","1609","1717","1718","1722","1795","1802","1904","1905","1907","1909","2002","2006","2027","2049","2059","2105","2201","2231","2301","2303","2308","2312","2313","2317","2323","2324","2327","2328","2330","2331","2332","2337","2338","2340","2344","2345","2347","2352","2353","2354","2355","2356","2357","2360","2368","2371","2376","2377","2379","2382","2383","2385","2388","2392","2393","2401","2404","2408","2409","2412","2439","2441","2449","2454","2455","2457","2458","2474","2481","2485","2486","2489","2492","2498","2515","2520","2542","2548","2603","2605","2606","2609","2610","2615","2618","2633","2634","2801","2834","2880","2881","2882","2883","2884","2885","2886","2887","2890","2891","2892","2913","2915","3005","3006","3008","3017","3019","3034","3035","3036","3037","3042","3044","3045","3078","3081","3105","3152","3189","3211","3227","3231","3260","3264","3293","3324","3374","3376","3380","3406","3443","3481","3529","3532","3533","3552","3653","3661","3673","3680","3691","3702","3706","3711","3714","4123","4128","4162","4736","4743","4904","4919","4938","4958","5009","5269","5274","5347","5388","5425","5457","5483","5534","5871","5880","5904","6005","6116","6121","6139","6147","6153","6173","6176","6182","6188","6213","6239","6245","6257","6269","6271","6274","6278","6279","6282","6285","6414","6443","6488","6510","6547","6669","6770","8039","8044","8046","8069","8086","8112","8150","8163","8299","8358","8436","9904","9914","9938","9939","9945","9958"],"dates":["2021-05-07","2021-07-29","2021-09-30","2022-02-07","2022-03-09","2022-04-13","2022-05-13","2022-06-21","2022-07-29","2022-09-27","2022-12-22","2023-04-28","2023-08-15","2024-04-23","2024-07-23","2024-09-12","2025-01-14","2025-03-20","2025-04-23","2025-11-20","2026-03-05","2026-04-07","2026-05-21","2026-06-30","2026-07-31","2026-09-16"]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const round=x=>Number.isFinite(x)?Math.round(x*10000)/10000:null;
const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length? (a[(a.length-1)>>1]+a[a.length>>1])/2:NaN};
const fmt=x=>new Date(x).toISOString().slice(0,10);
const cutoff=(m,lag)=>fmt(Date.UTC(Math.floor(m/12),m%12+1,lag));
let pos=0;const output=new Array(codes.length);
async function one(code){
 const p=new URLSearchParams({dataset:'TaiwanStockMonthRevenue',data_id:code,start_date:'2018-01-01',end_date:'2026-10-31'});
 let data=null,err='unknown';
 for(let attempt=0;attempt<3;attempt++){
  try{let r=await fetch('https://api.finmindtrade.com/api/v4/data?'+p,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});
   if(!r.ok){err='HTTP_'+r.status;if(r.status===429||r.status>=500){await sleep(1000*(attempt+1));continue}break}
   const j=await r.json();if(j.status!==200||!Array.isArray(j.data)){err='API_'+j.status;break}data=j.data;break
  }catch(e){err='request_error';await sleep(800*(attempt+1))}
 }
 if(!data)return {code,error:err};
 const v=new Map();let duplicates=0,invalid=0,conflicts=0;
 for(const x of data){let y=Number(x.revenue_year),m=Number(x.revenue_month),r=Number(x.revenue),c=String(x.create_time||'').slice(0,10);
   if(String(x.stock_id)!==code||!Number.isInteger(y)||y<2017||y>2026||!Number.isInteger(m)||m<1||m>12||!Number.isFinite(r)||r<=0){invalid++;continue}
   const k=y*12+m-1, old=v.get(k);
   if(old){duplicates++;if(old.r!==r){conflicts++;v.set(k,{r:NaN,c:''})}continue}
   v.set(k,{r,c:/^\d{4}-\d\d-\d\d$/.test(c)&&c!=='2026-04-21'?c:''})
 }
 const raw=k=>v.get(k)?.r??NaN;
 const logratio=(a,b)=>a>0&&b>0?Math.log(a/b):NaN;
 const yoy=k=>logratio(raw(k),raw(k-12));
 const available=(k,date,lag)=>{const x=v.get(k);return x&&Number.isFinite(x.r)&&cutoff(k,lag)<date&&(!x.c||x.c<date)};
 const features=(date,lag)=>{
   const month=Math.max(...[...v.keys()].filter(k=>available(k,date,lag)));
   if(!Number.isFinite(month))return null;
   const deps=[month,month-1,month-2,month-12,month-13,month-14,...Array.from({length:6},(_,i)=>month-i-1),...Array.from({length:6},(_,i)=>month-i-13)];
   if(!deps.every(k=>available(k,date,lag)))return null;
   const prev=Array.from({length:6},(_,i)=>yoy(month-i-1));
   const three=(k)=>raw(k)+raw(k-1)+raw(k-2);
   return [month,round(yoy(month)),round(yoy(month)-median(prev)),round(logratio(three(month),three(month-12))),round(logratio(raw(month),raw(month-1))),v.get(month).c||null];
 };
 return {code,n:data.length,valid:v.size,duplicates,conflicts,invalid,dates:dates.map(d=>[features(d,20),features(d,40)])};
}
await Promise.all(Array.from({length:5},async()=>{while(pos<codes.length){const i=pos++;output[i]=await one(codes[i]);}}));
const base='research/c26-lock/experiments/';
for(let i=0;i<4;i++){const rows=output.slice(i*60,(i+1)*60);fs.writeFileSync(base+'A26_REVENUE_FEATURES_'+i+'.json',JSON.stringify({dates,rows}));}
console.log(JSON.stringify({requests:codes.length,success:output.filter(x=>!x.error).length,errors:output.filter(x=>x.error).map(x=>[x.code,x.error]),records:output.reduce((s,x)=>s+(x.n||0),0)}));
