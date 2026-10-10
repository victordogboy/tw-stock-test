const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('mobile individual-stock backtest, persistence, history cache, optimizer and cancel',{timeout:90000},async()=>{
 const prices=require('./helpers/detail-page.cjs').fixture();
 const chips={margin:[],inst:[],daytrade:[]};
 for(const [i,b] of prices.entries()){
  chips.margin.push({date:b.date,MarginPurchaseTodayBalance:10000+i,MarginPurchaseYesterdayBalance:9999+i});
  chips.inst.push({date:b.date,Foreign_Investor_buy:150000+i,Foreign_Investor_sell:100000,Investment_Trust_buy:20000,Investment_Trust_sell:5000,Dealer_buy:10000,Dealer_sell:5000});
  chips.daytrade.push({date:b.date,Volume:1000000});
 }
 let researchRequests=0;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test');
  if(url.pathname.startsWith('/api/')){
   let payload={ok:true,data:[],configured:false};
   if(url.pathname==='/api/market/universe')payload.data=[{code:'2330',name:'台積電',market:'twse'},{code:'2454',name:'聯發科',market:'twse'}];
   if(url.pathname==='/api/history/auto')payload={ok:true,data:prices,source:'fixture'};
   if(url.pathname==='/api/chips/hybrid')payload={ok:true,...chips,source:'fixture'};
   if(url.pathname.includes('/research/')){
    researchRequests++;
    if(req.method==='GET'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'not cached'}));return;}
    payload={ok:true,data:url.pathname.endsWith('stock-history')?prices:chips[url.searchParams.get('kind')]};
   }
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));return;
  }
  try{const name=path.join(__dirname,'../public',url.pathname==='/detail'?'detail.html':url.pathname);res.writeHead(200,{'content-type':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(name));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.SCAN_TEST_CHROME?{executablePath:process.env.SCAN_TEST_CHROME}:{}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/detail');
  await page.evaluate(()=>{localStorage.setItem('twq_watchlist_v16','["2368"]');localStorage.setItem('twq_finmind_tokens_v2',JSON.stringify({tokens:['test-one','test-two'],active:1}));});
  await page.fill('#stockInput','2330');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('btStock').textContent.includes('2330'));
  await page.fill('#btEnter','40');await page.fill('#btExit','60');await page.fill('#btMinTrades','1');await page.click('#btRun');
  await page.waitForFunction(()=>document.getElementById('btStatus').textContent.includes('回測完成'));
  assert.ok(await page.locator('#btResults').innerText().then(s=>s.includes('最大回撤')));assert.equal(researchRequests,0);
  await page.click('#btOptimize');await page.waitForSelector('#btApply',{timeout:60000});
  assert.ok((await page.locator('#btResults').innerText()).includes('後30%：未參與搜尋'));assert.equal(researchRequests,0);
  await page.click('#btApply');const chosen=await page.inputValue('#btEnter');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('twq_stock_backtest_r32:twse:2330')));assert.equal(stored.enter,Number(chosen));
  assert.equal(await page.evaluate(()=>localStorage.getItem('twq_watchlist_v16')),'["2368"]');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('twq_finmind_tokens_v2'))),{tokens:['test-one','test-two'],active:1});
  // Check that the panel fits a phone; tables may scroll within their own box.
  assert.equal(await page.evaluate(()=>{const r=document.getElementById('stockBacktest').getBoundingClientRect();return r.right<=innerWidth&&r.left>=0;}),true);
  assert.equal(await page.evaluate(()=>{const e=document.getElementById('stockBacktest');return e.scrollWidth<=e.clientWidth;}),true);
  await page.locator('#stockBacktest').screenshot({path:process.env.R32_SCREENSHOT||'/tmp/r32-stock-backtest-mobile.png'});
  await page.click('#btOptimize');await page.click('#btCancel');assert.match(await page.locator('#btStatus').innerText(),/已停止/);assert.equal(await page.locator('#btRun').isEnabled(),true);
  await page.fill('#stockInput','2454');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('btStock').textContent.includes('2454'));assert.equal(await page.inputValue('#btEnter'),'60');
  await page.fill('#stockInput','2330');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('btStock').textContent.includes('2330'));assert.equal(await page.inputValue('#btEnter'),chosen);
  await page.reload();await page.fill('#stockInput','2330');await page.click('#analyzeBtn');await page.waitForFunction(()=>document.getElementById('btStock').textContent.includes('2330'));assert.equal(await page.inputValue('#btEnter'),chosen);
  await page.locator('#stockBacktest > details > summary').click();await page.click('#btLoad');await page.waitForFunction(()=>document.getElementById('btStatus').textContent.includes('歷史已載入'));assert.equal(researchRequests,8);
  await page.click('#btLoad');await page.waitForFunction(()=>document.getElementById('btStatus').textContent.includes('歷史已載入'));assert.equal(researchRequests,8);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
