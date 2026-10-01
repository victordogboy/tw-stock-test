const {test}=require('node:test'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
for(const scenario of ['normal','quota-existing-key','quota-new-key','quota-empty-result','quota-no-persistent-storage','dual-buy','dual-exit'])test('mobile background resume: '+scenario, {timeout:90000},async()=>{
 const bundle=await build({entryPoints:['tests/fixtures/background-worker.mjs'],bundle:true,format:'esm',platform:'browser',write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-10',durableObjects:{SCAN_JOBS:{className:'ScanJob',useSQLite:true}}}));
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method))init.body=Buffer.concat(chunks);
    const r=await mf.dispatchFetch('http://127.0.0.1:'+server.address().port+req.url,init);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
   }
   const filename=path.join('public',req.url.split('?')[0]==='/scanner'?'scanner.html':req.url.split('?')[0]);
   res.writeHead(200,{'content-type':filename.endsWith('.js')?'application/javascript':'text/html'});res.end(fs.readFileSync(filename));
  }catch(e){res.writeHead(500);res.end(e.message)}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.SCAN_TEST_CHROME?{executablePath:process.env.SCAN_TEST_CHROME}:{}),args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,deviceScaleFactor:1});
  let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:'+server.address().port+'/scanner';await page.goto(url);
  await page.evaluate(()=>{
   localStorage.setItem('twq_watchlist_v16','["2368"]');
   localStorage.setItem('twq_finmind_tokens_v2',JSON.stringify({tokens:['test-token-one','test-token-two'],active:1}));
  });
  const selection=scenario==='dual-buy'?'buyActionDelta':scenario==='dual-exit'?'stayDrawdown':'holdVolumeDelta';
  await page.selectOption('#scanType',selection);await page.fill('#maxStocks','4');await page.fill('#finTopN','3');
  if(scenario==='quota-empty-result')await page.fill('#minLots','999999');
  if(scenario.startsWith('quota')){
   await page.evaluate(scenario=>{
    if(scenario==='quota-existing-key')localStorage.setItem('twq_background_scan_key_r23','a'.repeat(64));
    for(const storage of [localStorage,sessionStorage]){
     for(const size of [100000,10000,1000,100,10,1]){
      for(let i=0;i<100;i++){try{storage.setItem('fixture-cache-'+size+'-'+i,'x'.repeat(size))}catch{break}}
     }
    }
    if(scenario==='quota-no-persistent-storage')Object.defineProperty(window,'indexedDB',{value:undefined});
    let threw=false;try{localStorage.setItem('twq_background_scan_pending_r23','12345678-1234-4321-1234-123456789012')}catch{threw=true}
    if(!threw)throw Error('Quota fixture did not reproduce the reported pending-record failure');
   },scenario);
  }
  let submittedKey=null;page.on('request',req=>{if(req.method()==='POST'&&req.url().includes('/api/scan/job'))submittedKey=req.headers()['x-scan-key']});
  if(scenario.startsWith('dual')){
   await page.fill('#dualScanControls input[data-group="buy"][data-key="hold"]','65');
   await page.fill('#dualScanControls input[data-group="buy"][data-key="entry"]','15');
   if(scenario==='dual-exit'){await page.fill('#dualScanControls input[data-group="stay"][data-key="hold"]','100');await page.fill('#dualScanControls input[data-group="stay"][data-key="setup"]','0')}
  }
  await page.click('#scanBtn');
  if(scenario==='quota-no-persistent-storage'){
   await page.waitForFunction(()=>document.getElementById('status').textContent.includes('尚未送出掃描'));
   assert.equal(submittedKey,null);assert.equal(await page.locator('#scanBtn').isEnabled(),true);
   assert.equal(await page.evaluate(()=>localStorage.getItem('twq_watchlist_v16')),'["2368"]');
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('twq_finmind_tokens_v2'))),{tokens:['test-token-one','test-token-two'],active:1});
   assert.deepEqual(errors,[]);return;
  }
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('伺服器已接收'));
  const key=submittedKey;assert.match(key,/^[a-f0-9]{64}$/);
  if(scenario==='quota-existing-key')assert.equal(key,'a'.repeat(64));
  if(scenario==='quota-new-key')assert.equal(await page.evaluate(()=>localStorage.getItem('twq_background_scan_key_r23')),null);
  // No page, polling, or network client drives these alarms.
  await page.close();await pause(8000);
  const check=await mf.dispatchFetch('http://127.0.0.1:'+server.address().port+'/api/scan/job',{headers:{'x-scan-key':key}});
  const job=(await check.json()).job;assert.equal(job.phase,'completed');assert.equal(job.scanned,7);assert.equal(job.results.length,scenario==='quota-empty-result'?0:3);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('背景掃描完成'));
  assert.equal(await page.locator('#rows tr').count(),scenario==='quota-empty-result'?0:3);
  assert.equal(await page.evaluate(()=>localStorage.getItem('twq_watchlist_v16')),'["2368"]');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('twq_finmind_tokens_v2'))),{tokens:['test-token-one','test-token-two'],active:1});
  assert.equal(await page.locator('#scanBtn').isEnabled(),true);
  assert.equal(await page.locator('#scanType').inputValue(),selection);
  assert.equal(await page.locator('#rankTabs button.active').getAttribute('data-rank'),selection);
  assert.deepEqual(errors,[]);
  if(scenario.startsWith('dual')){
   assert.equal(job.options.dualWeights.buy.hold,65);
   assert.ok(job.results.every(r=>r.actionTrail.length===5&&r.absorption.state==='資料不足'));
   assert.equal(await page.locator('#dualScanControls input[data-group="buy"][data-key="hold"]').inputValue(),'65');
   const shown=await page.evaluate(()=>results.map(r=>TWDualAction.metrics(r,dualWeights)));
   assert.ok(shown.every(r=>Number.isFinite(r.buyDelta)&&Number.isFinite(r.stayDrop)));
   // Verify both new page panels are visible on a real mobile layout, with same model outputs.
   await page.locator('#dualScanControls').screenshot({path:'/workspace/scratch/5fec3565cb8d/r24-scan-controls.png'});
   const row=job.results[0],detail=await context.newPage();detail.on('pageerror',e=>errors.push(e.message));
   await detail.goto('http://127.0.0.1:'+server.address().port+'/detail.html');
   const fixtureRows=await (await mf.dispatchFetch('http://test/api/history/auto')).json();
   await detail.evaluate(data=>{STATE.prices=data;STATE.auditIndex=data.length-1;STATE.stock={stock_id:'1111',stock_name:'測試股票'};render()},fixtureRows.data);
   const metrics=await detail.evaluate(()=>TWDualAction.metrics(dualAuditRow,dualDetailWeights));
   assert.deepEqual(metrics,shown[0]);
   assert.match(await detail.locator('#dualAuditPanel').innerText(),/資料不足/);
   await detail.locator('#dualAuditPanel').screenshot({path:'/workspace/scratch/5fec3565cb8d/r24-detail-panel.png'});
   assert.deepEqual(errors,[]);await detail.close();
  }

 }finally{await browser?.close();await new Promise(r=>server.close(r));await mf.dispose()}
});
