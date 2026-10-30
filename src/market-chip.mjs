// Helpers for appending FinMind chip fundamentals to existing, already-stored
// daily OHLCV CSV. No re-fetch of TaiwanStockPrice is necessary.
export const PRICE_COLUMN_COUNT=12;
export const CHIP_DATASETS=Object.freeze([
  "TaiwanStockInstitutionalInvestorsBuySell",
  "TaiwanStockMarginPurchaseShortSale"
]);
export function parseCsvRecord(line){
 const result=[];let curr="",quoted=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(c==='"'){
   if(quoted&&line[i+1]==='"'){curr+='"';i++}
   else quoted=!quoted;
  }else if(c===","&&!quoted){result.push(curr);curr=""}
  else curr+=c
 }
 if(quoted)throw Error("CSV 引號尚未閉合");
 result.push(curr);
 return result;
}
export function priceRowsFromText(text,stock,year){
 const records=[],unique=new Set();
 for(const raw of String(text).split(/\r?\n/)){
  if(!raw)continue;
  const v=parseCsvRecord(raw);
  if(v.length!==PRICE_COLUMN_COUNT)throw Error("股價 CSV 欄位數異常："+stock+" "+year+" ("+v.length+")");
  const day=String(v[0]||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||
     !Number.isFinite(Date.parse(day+"T00:00:00Z"))||
     new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day)
   throw Error("股價日期格式異常："+stock+" "+day);
  if(day.slice(0,4)!==year||v[1]!==stock)throw Error("股價代號／年份不一致："+stock+" "+day);
  if(unique.has(day))throw Error("股價出現重複日期："+stock+" "+day);
  unique.add(day);
  records.push({date:day,values:v});
 }
 records.sort((a,b)=>a.date.localeCompare(b.date));
 return {records};
}
export function chipSnapshot(jointRaw,priceRowsCount){
 const count=jointRaw?.coverage||{};
 return {priceRows:priceRowsCount,institutionalRows:count.institutional||0,marginRows:count.margin||0,
  bothRows:count.both||0,missingInstitutional:count.missingInstitutional||0,
  missingMargin:count.missingMargin||0};
}
