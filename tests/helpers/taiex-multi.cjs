function multiFixture(){
 const rows=[];
 for(let i=0;i<300;i++){
  const date=new Date(Date.UTC(2025,6,1+i)).toISOString().slice(0,10),wave=i%40<=20?i%40:40-i%40,c=20000+wave*20+i;
  for(const contract of ['202508','202509','202510','202511','202512','202601','202602','202603','202604','202605']){
   if(contract<date.slice(0,7).replace('-',''))continue;
   rows.push({date,contract,open:c-5,close:c,high:c+30,low:c-30,volume:10000+i,openInterest:1000});
  }
 }
 return rows;
}
const apiFixture=rows=>rows.map(b=>({...b,futures_id:'TX',contract_date:b.contract,trading_session:'position',max:b.high,min:b.low,open_interest:b.openInterest}));
module.exports={multiFixture,apiFixture};
