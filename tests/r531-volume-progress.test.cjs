const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('public/pe-scanner.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
test('completed TWSE volume is usable before slow TPEx finishes',async()=>{
 const fields=new Map();const node=id=>{if(!fields.has(id))fields.set(id,{textContent:'',style:{},value:({strategy:'A',market:'all',minprice:'30',maxprice:'0',minvol:'1000',maxpe:'35'})[id]||'',checked:true});return fields.get(id);};
 const stock={code:'2330',market:'twse',close:100,models:{A:{status:'ok',pe:10,eps:10}},hasFutures:true};
 const ctx=vm.createContext({document:{getElementById:node},fetch:async()=>({ok:true,json:async()=>({ok:true,rows:[stock],counts:{models:{A:1,C:0}},sources:{futures:true},date:new Date().toISOString()})}),Date,Intl,AbortSignal,setInterval,clearInterval});
 vm.runInContext(script.slice(0,script.indexOf("['minprice','maxprice'")),ctx);
 vm.runInContext(`globalThis.frames=[];render=()=>frames.push({count:full.filter(eligible).length,busy:scanBusy});
 buildVolumes=market=>market==='twse'?Promise.resolve({market,avg:new Map([['2330',2000]]),dates:['1','2','3','4','5'],fails:[]}):new Promise(resolve=>globalThis.finishOTC=()=>resolve({market,avg:new Map(),dates:[],fails:[]}));
 fallbackVolume=async()=>{};globalThis.running=scan();`,ctx);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(ctx.frames.some(x=>x.busy&&x.count===1),'TWSE results should appear while OTC pending');
 assert.equal(node('scan').disabled,true);ctx.finishOTC();await ctx.running;
 assert.equal(node('scan').disabled,false);assert.equal(ctx.frames.at(-1).busy,false);
});
