/** Restore the private data-only numpy bundle with GitHub workflow identity. */
import fs from 'node:fs';
import crypto from 'node:crypto';
const audience='https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed';
const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'');
url.searchParams.set('audience',audience);
let issuance;
for(let attempt=0;attempt<5;attempt++){
 try{
  issuance=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(20000)});
  if(issuance.status!==429&&issuance.status<500)break;
  if(attempt===4)break;
  await issuance.body?.cancel();
 }catch(error){if(attempt===4)throw error}
 await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
}
if(!issuance.ok)throw Error('C26 runtime OIDC issuance failed HTTP '+issuance.status);
const token=(await issuance.json()).value;
if(typeof token!=='string')throw Error('C26 runtime OIDC credential missing');
const manifest=JSON.parse(fs.readFileSync('public/r1494a/c26/data/portable-runtime-manifest.json','utf8'));
const response=await fetch(audience+'/runtime',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(60000),cache:'no-store'});
if(!response.ok)throw Error('Private C26 runtime unavailable HTTP '+response.status);
const bytes=Buffer.from(await response.arrayBuffer());
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
if(bytes.length!==manifest.bytes||sha!==manifest.sha256)throw Error('Private C26 runtime checksum mismatch');
fs.mkdirSync('.c26-private',{recursive:true,mode:0o700});
fs.writeFileSync('.c26-private/c26-runtime.npz',bytes,{mode:0o600});
console.log('C26_PRIVATE_RUNTIME_RESTORED',JSON.stringify({sha256:sha,bytes:bytes.length,raw_public:false}));
