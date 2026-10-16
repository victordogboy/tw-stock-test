const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('SAR phone controls, redraw, persistence, audit date and no extra data requests',async()=>{
  const prices=require('./helpers/detail-page.cjs').fixture();let requests=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://test');
    if(url.pathname.startsWith('/api/')){
      requests++;let payload={ok:true,data:[],configured:false};
      if(url.pathname==='/api/market/universe')payload.data=[{code:'2330',name:'台積電',market:'twse'}];
      if(url.pathname==='/api/history/auto')payload={ok:true,data:prices,source:'fixture'};
      if(url.pathname==='/api/chips/hybrid')payload={ok:true,margin:[],inst:[],daytrade:[],source:'fixture'};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));return;
    }
    try{
      const file=path.join(__dirname,'../public',url.pathname==='/detail'?'detail.html':url.pathname);
      res.writeHead(200,{'content-type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(file));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/detail');
    await page.fill('#stockInput','2330');await page.click('#analyzeBtn');
    await page.waitForFunction(()=>document.getElementById('sarStatusPill').textContent.includes('目前 AF'));
    const original=await page.locator('#chart').evaluate(c=>c.toDataURL()),baseline=requests;
    await page.fill('#sarAcceleration','0.07');await page.locator('#sarAcceleration').blur();
    assert.notEqual(await page.locator('#chart').evaluate(c=>c.toDataURL()),original);
    await page.fill('#sarMax','0.01');await page.locator('#sarMax').blur();assert.match(await page.locator('#sarError').innerText(),/上限不可/);
    assert.equal(await page.evaluate(()=>sarSettings.max),.2);
    await page.fill('#sarMax','0.3');await page.locator('#sarMax').blur();
    await page.uncheck('#sarEnabled');assert.match(await page.locator('#sarStatusPill').innerText(),/關閉/);
    await page.check('#sarEnabled');assert.equal(requests,baseline);
    await page.locator('#auditSlider').evaluate(el=>{el.value='120';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.match(await page.locator('#sarStatusPill').innerText(),new RegExp(prices[120].date));
    for(const width of [393,320,1280]){
      await page.setViewportSize({width,height:852});
      assert.equal(await page.locator('.toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
      for(const id of ['sarAcceleration','sarStep','sarMax','sarReset'])assert.equal(await page.locator('#'+id).evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true);
    }
    await page.setViewportSize({width:393,height:852});
    await page.locator('.chartwrap').screenshot({path:'/tmp/r35-sar-mobile.png'});
    await page.reload();assert.equal(await page.inputValue('#sarAcceleration'),'0.07');assert.equal(await page.inputValue('#sarMax'),'0.3');
    await page.click('#sarReset');assert.equal(await page.inputValue('#sarAcceleration'),'0.05');assert.equal(await page.inputValue('#sarMax'),'0.2');
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
