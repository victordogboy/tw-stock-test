const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Minimal DOM harness validates page wiring and text, not browser layout.
const root=require('node:path').join(__dirname,'..','..','public')+'/';
function page(name){
  const html=fs.readFileSync(root+name,'utf8'),nodes=new Map(),storage=new Map(),events=[];
  const parse=s=>{for(const m of s.matchAll(/id="([^"]+)"[^>]*>/g)){if(!nodes.has(m[1]))nodes.set(m[1],node(m[1]));const v=m[0].match(/value="([^"]*)"/);if(v)nodes.get(m[1]).value=v[1]}};
  function node(id){return {get parentElement(){return node('parent')},get parentNode(){return node('parent')},querySelector(s){if(s.startsWith('[data-')){this._queries??={};return this._queries[s]??=node(s)}return nodes.get(s.replace('#',''))||null},querySelectorAll(s){if(s!=='input')return [];return this._inputs||[]},prepend(){},replaceChildren(){this.children=[]},append(...items){this.children??=[];this.children.push(...items)},after(){},insertBefore(){},appendChild(){},remove(){},id,_value:'',get value(){return this._value},set value(v){this._value=String(v)},style:{},dataset:{},textContent:'',disabled:false,clientWidth:800,clientHeight:450,offsetWidth:800,offsetHeight:450,classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){events.push([id,name,fn])},getBoundingClientRect(){return {width:800,height:450}},getContext(){return new Proxy({measureText:()=>({width:50}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||(()=>{})})},set innerHTML(s){this._html=s;parse(s);this._inputs=[...s.matchAll(/<input[^>]*data-group="([^"]+)"[^>]*data-key="([^"]+)"[^>]*value="([^"]+)"/g)].map(m=>{const n=node('input');n.dataset={group:m[1],key:m[2]};n.value=m[3];return n})},get innerHTML(){return this._html||''}}}
  parse(html);
  if(nodes.has('rankTable')){const header=node('header');header.children=[];Object.assign(nodes.get('rankTable'),{tHead:{rows:[header]},rows:[]})}
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
  const ctx=vm.createContext({console:{log:console.log,warn(){}},URL,URLSearchParams,AbortSignal,AbortController,clearTimeout,Intl,Date,Math,JSON,Promise,Request,Response,Headers,Map,Set,location:{href:'http://test/'+name,origin:'http://test/'},document:{getElementById:k=>nodes.get(k)||null,querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',createElement:()=>node('')},localStorage,sessionStorage:localStorage,setTimeout(){},setInterval(){},requestAnimationFrame:fn=>fn(),devicePixelRatio:1,addEventListener(){},fetch:async()=>new Response(JSON.stringify({ok:true,configured:false,data:[],futures:[]})),navigator:{},getComputedStyle:()=>({getPropertyValue:()=>''})});
  ctx.window=ctx;
  for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    const src=m[1].match(/src="([^"?]+)[^"]*"/);
    vm.runInContext(src?fs.readFileSync(root+src[1].slice(1),'utf8'):m[2],ctx,{filename:src?src[1]:name});
  }
  return {ctx,nodes,storage,events};
}
function fixture(){const rows=[];for(let i=0;rows.length<200;i++){const d=new Date(Date.UTC(2025,0,1+i));if([0,6].includes(d.getUTCDay()))continue;const c=30+rows.length*.08+Math.sin(rows.length/4);rows.push({date:d.toISOString().slice(0,10),open:c-.2,high:c+.5,low:c-.5,close:c,volume:4000000})}return rows}

module.exports={page,fixture};
