/** Confirm FinMind data_id supports TRUE historical ranges; no prices or token logged. */
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw Error('Secret missing');
const tests=[
 {stock_id:'3443',start_date:'2022-08-01',end_date:'2022-08-31'},
 {stock_id:'3443',start_date:'2026-09-01',end_date:'2026-09-30'},
 {stock_id:'2454',start_date:'2022-08-01',end_date:'2022-08-31'},
 {stock_id:'2454',start_date:'2026-09-01',end_date:'2026-09-30'}
];
for(const t of tests){
 const url='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanStockPrice',data_id:t.stock_id,start_date:t.start_date,end_date:t.end_date});
 const res=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(35000)});
 if(!res.ok)throw Error('FinMind status '+res.status+' for '+t.stock_id+' '+t.start_date);
 const data=await res.json();
 if(data.status!==200||!Array.isArray(data.data))throw Error('FinMind payload '+data.status);
 const dates=[...new Set(data.data.map(x=>x.date))].sort();
 if(dates.length<14||dates.at(0).slice(0,7)!==t.start_date.slice(0,7)||dates.at(-1).slice(0,7)!==t.end_date.slice(0,7))
  throw Error('Historical date_id range failed, count='+dates.length+' stock='+t.stock_id);
 console.log('C26_FINMIND_ID_RANGE_OK',JSON.stringify({code:t.stock_id,month:t.start_date.slice(0,7),days:dates.length}));
}
