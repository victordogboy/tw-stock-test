import fs from 'node:fs';
const base='https://tw-stock-api.victordogboy.workers.dev/api/c26/a56';
const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience','https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed');
const issuance=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(20000)});
if(!issuance.ok)throw Error('Protected workflow identity unavailable');
const token=(await issuance.json()).value,action=process.argv[2];
let body;
if(action==='finish')body=JSON.stringify({request_id:fs.readFileSync('.c26-private/a56-request-id.txt','utf8'),outcome:process.env.A56_OUTCOME});
const r=await fetch(base+'/'+action,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(20000)});
if(!r.ok)throw Error('A56 queue '+action+' HTTP '+r.status);
const s=await r.json();
if(action==='begin'){fs.mkdirSync('.c26-private',{recursive:true});fs.writeFileSync('.c26-private/a56-request-id.txt',s.request_id);}
console.log('A56_REFRESH_PHASE',s.state);
