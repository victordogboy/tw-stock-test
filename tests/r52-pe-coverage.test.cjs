const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const repo=path.resolve(__dirname,'..');
function readSource(name){return fs.readFileSync(path.join(repo,name),'utf8');}
function makeRouter({misAvailable=false}={}){
 const src=readSource('src/forward-pe.mjs').replace('export async function forwardPeRoute','async function forwardPeRoute');
 const financeCsv='公司代號,公司名稱,年度,季別,基本每股盈餘（元）,營業收入\n3264,欣銓,115,2,5,1000\n3105,穩懋,115,2,6,1200\n3260,威剛,115,2,10,1300\n';
 const monthlyCsv='公司代號,公司名稱,資料年月,營業收入-當月營收,營業收入-上月營收,累計營業收入-當月累計營收\n3264,欣銓,11509,200,200,1500\n3105,穩懋,11509,230,220,1600\n3260,威剛,11509,240,240,1700\n';
 const today=Math.floor(Date.now()/86400000);
 const quote={chart:{result:[{timestamp:[6,5,4,3,2].map(i=>(today-i)*86400+36000),
  indicators:{quote:[{volume:[300000,400000,500000,300000,500000],close:[210,214,218,225,230]}]}}]}};
 const ctx=vm.createContext({Request,Response,URL,AbortSignal,TextDecoder,Date,
  caches:{default:{match:async()=>null,put:async()=>{}}},
  fetch:async uri=>{
   const u=String(uri);
   if(misAvailable&&u.includes('mis.twse.com.tw')){
    const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()).replaceAll('-','');
    return Response.json({msgArray:[
     {c:'3264',n:'欣銓',ex:'otc',z:'230.5',v:'2500',d:date},
     {c:'3105',n:'穩懋',ex:'otc',z:'440',v:'3000',d:date}
    ]});
   }
   if(u.includes('query1.finance.yahoo.com')&&u.includes('3264.TWO'))return Response.json(quote);
   if(u.includes('t187ap05_O.csv'))return new Response(monthlyCsv);
   if(u.includes('t187ap06_O_ci.csv'))return new Response(financeCsv);
   if(u.includes('t187ap06_O_'))return new Response('公司代號,公司名稱,年度,季別\n');
   if(u.includes('t187ap05_L'))return Response.json([{
    '公司代號':'2330','公司名稱':'台積電','資料年月':'11509',
    '營業收入-當月營收':'16000','營業收入-上月營收':'16000',
    '累計營業收入-當月累計營收':'155000'}]);
   if(u.includes('t187ap06_L_ci'))return Response.json([{
    '公司代號':'2330','公司名稱':'台積電','年度':'115','季別':'2',
    '基本每股盈餘（元）':'20','營業收入':'100000'}]);
   if(u.includes('t187ap06_L_'))return Response.json([]);
   throw Error('Unexpected upstream '+u);
  }
 });
 vm.runInContext(src+'; globalThis.forwardPeRoute=forwardPeRoute;',ctx);
 const internal=async request=>{
  const pathname=new URL(request.url).pathname;
  if(pathname==='/api/twse/all')return Response.json({ok:true,data:[{
   code:'2330',name:'台積電',market:'twse',close:1600,volume_shares:10000000}]});
  if(pathname==='/api/tpex/all')return Response.json({ok:false,error:'TPEx quote feed blocked'},{status:502});
  if(pathname==='/api/futures/stock-list')return Response.json({codes:['3264','3260'],degraded:false});
  if(pathname==='/api/market/universe')return Response.json({ok:true,data:[
   {code:'3264',name:'欣銓',market:'tpex'},{code:'3105',name:'穩懋',market:'tpex'},
   {code:'3260',name:'威剛',market:'tpex'}]});
  throw Error('Unexpected internal route '+pathname);
 };
 return (query)=>ctx.forwardPeRoute(new Request('https://test.example/api/pe-screener/'+query),{},internal);
}
test('when all OTC quotes fail, stock directory preserves three OTC stocks and correctly labels missing price',async()=>{
 const run=makeRouter();
 const res=await run('data');
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.version,'R52');
 assert.equal(data.coverage.otcQuotes,0);
 assert.equal(data.coverage.otcUniverse,3);
 assert.equal(data.coverage.missingQuotes,3);
 for(const code of ['3264','3105','3260']){
  const row=data.rows.find(r=>r.code===code);
  assert.ok(row,code+' should remain in stock universe');
  assert.equal(row.close,null);
  assert.equal(row.models.A.status,'ok');
  assert.equal(row.models.A.pe,null,'No real price: do not fabricate PE');
 }
});
test('R52 recovers OTC quotes in one validated TWSE MIS batch when TPEx bulk feed is blocked',async()=>{
 const run=makeRouter({misAvailable:true});
 const data=await (await run('data')).json();
 assert.equal(data.coverage.otcQuotes,0);
 assert.equal(data.coverage.misRecoveredQuotes,2);
 assert.equal(data.coverage.missingQuotes,1);
 const row=data.rows.find(x=>x.code==='3264');
 assert.equal(row.close,230.5);
 assert.equal(row.volumeTodayLots,2500);
 assert.match(row.priceSource,/MIS/);
 assert.ok(row.models.A.pe>0);
 assert.match(row.quoteReportedDate,/^20\d\d-\d\d-\d\d$/);
});
test('unfiltered Chinese-name stock search repairs missing quote using labeled daily prices',async()=>{
 const run=makeRouter();
 const res=await run('stock?query='+encodeURIComponent('欣銓'));
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.stock.code,'3264');
 assert.equal(data.stock.close,230);
 assert.match(data.stock.priceSource,/Yahoo/);
 assert.equal(data.stock.models.A.pe,23);
 assert.match(data.stock.models.B.status,/4～8/);
 assert.equal(data.volume5.ok,true);
});
test('stock futures exempt both price bounds but not volume',()=>{
 const html=readSource('public/pe-scanner.html');
 const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new vm.Script(js);
 const fields={strategy:{value:'A'},market:{value:'all'},minprice:{value:'30'},
  maxprice:{value:'300'},minvol:{value:'1000'},maxpe:{value:'35'},
  future:{checked:true},strict:{checked:true}};
 const head=js.slice(js.indexOf('function chosen(r)'),js.indexOf('function render(){'));
 const eligible=new Function('$',
  "const num=(id,fallback)=>{const v=Number($(id).value);return Number.isFinite(v)&&v>=0?v:fallback;};"+
  head+";return eligible;")(id=>fields[id]);
 const stock=(price,futures,vol=3000)=>({code:'3260',name:'威剛',close:price,market:'tpex',
  hasFutures:futures,avg5Lots:vol,models:{A:{status:'ok',eps:30,pe:price/30}}});
 assert.equal(eligible(stock(500,true)),true,'futures should bypass MAX price');
 assert.equal(eligible(stock(500,false)),false);
 assert.equal(eligible(stock(10,true)),true,'futures should bypass MIN price');
 assert.equal(eligible(stock(10,false)),false);
 assert.equal(eligible(stock(500,true,500)),false,'volume must still apply');
 fields.future.checked=false;
 assert.equal(eligible(stock(500,true)),false);
});
