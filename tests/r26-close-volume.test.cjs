const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/index.js','utf8').replace(/export default\s*\{/,'globalThis.worker = {');
function api(hour,dailyAvailable=true){
 const calls=[],RealDate=Date;
 const FixedDate=class extends RealDate{constructor(...args){super(...(args.length?args:[`2026-09-30T${hour}:00:00+08:00`]))}static now(){return new RealDate(`2026-09-30T${hour}:00:00+08:00`).getTime()}};
 const ctx=vm.createContext({URL,URLSearchParams,Request,Response,Headers,AbortSignal,TextDecoder,Intl,Date:FixedDate,console,setTimeout,clearTimeout,caches:{default:{match:async()=>null,put:async()=>{}}},fetch:async url=>{
  const u=String(url);calls.push(u);
  if(u.includes('mis.twse'))return new Response(JSON.stringify({msgArray:[]}));
  if(u.includes('interval=1d')&&!dailyAvailable)return new Response('{}',{status:429});
  const daily=u.includes('interval=1d');
  return new Response(JSON.stringify({chart:{result:[{timestamp:[new RealDate('2026-09-30T09:30:00+08:00').getTime()/1000],indicators:{quote:[{open:[100],high:[101],low:[99],close:[100],volume:[daily?9000000:1000000]}]},meta:{chartPreviousClose:99}}]}}));
 }});vm.runInContext(source,ctx);return {worker:ctx.worker,calls};
}
test('after close replaces minute sum with same-date actual daily volume',async()=>{
 const a=api('14'),r=await a.worker.fetch(new Request('https://test/api/intraday?code=2330&market=twse'),{}),j=await r.json();
 assert.equal(r.status,200);assert.equal(j.bar.volume,9000000);assert.equal(j.volume_basis,'completed-daily');assert.equal(j.session_open,false);
 assert.equal(a.calls.filter(u=>u.includes('interval=1d')).length,1);
});
test('intraday quote stays cumulative for client projection, without extra daily fetch',async()=>{
 const a=api('10'),r=await a.worker.fetch(new Request('https://test/api/intraday?code=2330&market=twse'),{}),j=await r.json();
 assert.equal(j.bar.volume,1000000);assert.equal(j.session_open,true);assert.equal(a.calls.length,1);
});
test('missing completed volume never returns minute sum as closing volume',async()=>{
 const a=api('14',false),r=await a.worker.fetch(new Request('https://test/api/intraday?code=2330&market=twse'),{});
 assert.equal(r.status,503);assert.match((await r.json()).error,/完整成交量尚未取得/);
});
