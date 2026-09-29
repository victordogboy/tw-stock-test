const {test}=require('node:test'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare'),{build}=require('esbuild');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('real Durable Object alarms complete after mobile tab closes; reopened page restores job and watchlist', {timeout:90000},async()=>{
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
  await page.evaluate(()=>localStorage.setItem('twq_watchlist_v16','["2368"]'));
  await page.selectOption('#scanType','holdVolumeDelta');await page.fill('#maxStocks','4');await page.fill('#finTopN','3');
  await page.click('#scanBtn');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('伺服器已接收'));
  const key=await page.evaluate(()=>localStorage.getItem('twq_background_scan_key_r23'));
  // No page, polling, or network client drives these alarms.
  await page.close();await pause(8000);
  const check=await mf.dispatchFetch('http://127.0.0.1:'+server.address().port+'/api/scan/job',{headers:{'x-scan-key':key}});
  const job=(await check.json()).job;assert.equal(job.phase,'completed');assert.equal(job.scanned,7);assert.equal(job.results.length,3);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('背景掃描完成'));
  assert.equal(await page.locator('#rows tr').count(),3);
  assert.equal(await page.evaluate(()=>localStorage.getItem('twq_watchlist_v16')),'["2368"]');
  assert.equal(await page.locator('#scanBtn').isEnabled(),true);
  assert.equal(await page.locator('#scanType').inputValue(),'holdVolumeDelta');
  assert.equal(await page.locator('#rankTabs button.active').getAttribute('data-rank'),'holdVolumeDelta');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/workspace/scratch/989fcec3388e/r23-mobile.png',fullPage:true});
 }finally{await browser?.close();await new Promise(r=>server.close(r));await mf.dispose()}
});
