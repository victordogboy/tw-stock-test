const test=require('node:test'),assert=require('node:assert/strict');
const {page}=require('./helpers/detail-page.cjs');
test('public history does not send or erase saved tokens; selected token mode still sends credentials',async()=>{
 const p=page('futures.html');await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 p.ctx.TWFinMindTokens.write({tokens:['saved-token-one','saved-token-two'],active:0});
 p.nodes.get('txHistoryAuth').value='public';p.nodes.get('txYears').value='1';
 const seen=[];p.ctx.fetch=async(path,options)=>{if(path.includes('/history?'))seen.push({path,headers:options.headers});return Response.json({ok:true,data:[]});};
 const load=p.events.find(e=>e[0]==='txLoad'&&e[1]==='click')[2];await load();
 assert.match(seen[0].path,/auth=public/);assert.equal(seen[0].headers.Authorization,undefined);
 assert.equal(p.ctx.TWFinMindTokens.activeToken(),'saved-token-one');
 p.nodes.get('txHistoryAuth').value='token';await load();
 assert.match(seen.at(-1).path,/auth=token/);assert.equal(seen.at(-1).headers.Authorization,'Bearer saved-token-one');
});
