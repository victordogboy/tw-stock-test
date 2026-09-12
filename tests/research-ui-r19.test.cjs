const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../public/research-r19-core.js');
class Element{constructor(value=''){this.value=value;this.textContent='';this.disabled=false;this.children=[];}append(x){this.children.push(x);}click(){}}
function harness(){
 const ids=['end','start','check','build','run','restore','backup','market','candidates','seed','minTrades','fee','tax','slippage','status','progress','cache','export','summary','metrics','weights','correlations','controls','shortlist','stop'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()])),records=new Map();let calls=0;
 const db={transaction(){const tx={objectStore(){return {get(k){const q={};queueMicrotask(()=>{q.result=records.get(k);q.onsuccess?.();});return q;},put(v,k){records.set(k,v);queueMicrotask(()=>tx.oncomplete?.());}}}};return tx;}};
 const context=vm.createContext({console,Date,JSON,Map,Set,Blob,URL,ResearchR19:C,AbortController,AbortSignal,setTimeout,clearTimeout,document:{getElementById:id=>elements[id],createElement:()=>new Element()},indexedDB:{open(){const q={};queueMicrotask(()=>{q.result=db;q.onsuccess?.();});return q;}},localStorage:{getItem(){return '';}},confirm(){return true;},fetch(){calls++;throw Error('Unexpected upstream call');},Worker:class{postMessage(input){queueMicrotask(()=>this.onmessage({data:{type:'done',report:{chosen:null,options:input.options,splits:{train:['2024-07-01','2025-01-01'],validation:['2025-01-02','2025-03-01'],test:['2025-03-02','2025-07-01']},coverage:{scoredObservations:100,selectedObservations:100},correlations:[],controls:[],candidates:[],baseline:{n:0}}}}));}terminate(){}}});
 vm.runInContext(fs.readFileSync('public/research-r19-ui.js','utf8'),context);
 Object.entries({start:'2024-07-01',end:'2025-07-01',market:'twse',seed:'123',minTrades:'20',candidates:'64',fee:'0.1425',tax:'0.3',slippage:'0.05'}).forEach(([id,v])=>elements[id].value=v);
 return {context,elements,records,get calls(){return calls;}};
}
test('cache-only UI flow completes and renders with zero network calls',async()=>{
 const h=harness(),o=vm.runInContext('options()',h.context),items=vm.runInContext('expected(options())',h.context);
 for(const {date,market} of items)h.records.set('market:'+market+':'+date,{ok:true,date,market,rows:Array.from({length:100},(_,i)=>({date,market,code:String(1000+i),volume:1000+i,open:100,high:101,low:99,close:100}))});
 for(let i=0;i<100;i++)h.records.set('chips:twse:'+String(1000+i),{coverage_start:o.warmupStart,coverage_end:o.end,completeness:100,chips:{margin:[],inst:[],daytrade:[]}});
 await vm.runInContext("gather('local')",h.context);assert.equal(h.calls,0);assert.match(h.elements.status.textContent,/研究完成/);assert.equal(h.elements.run.disabled,false);assert.equal(h.elements.export.disabled,false);assert.ok(h.records.has('last-report'));
});
test('missing local snapshots stops without fetching and unlocks UI',async()=>{
 const h=harness();await vm.runInContext("gather('local')",h.context);assert.equal(h.calls,0);assert.match(h.elements.status.textContent,/本機資料不足/);assert.equal(h.elements.run.disabled,false);assert.equal(h.records.has('last-report'),false);
});
