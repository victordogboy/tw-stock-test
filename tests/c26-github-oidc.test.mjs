import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifyC26GitHubOIDC,C26_GH_AUDIENCE} from '../src/c26/github-oidc.mjs';
import {c26PrivateFeedRoute,C26PrivateStore} from '../src/c26/private-feed.mjs';

const repo='victordogboy/tw-stock-test', id='1363009462';
const wf=repo+'/.github/workflows/c26-forward-eod.yml@refs/heads/main';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='c26-test-rsa-key';
const jwk={...publicKey.export({format:'jwk'}),kid,kty:'RSA',alg:'RS256',use:'sig'};
const mockedJwks=async(url)=>{
 assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
 return {ok:true,json:async()=>({keys:[jwk]})};
};
const now=Math.floor(Date.now()/1000);
const claims={
 iss:'https://token.actions.githubusercontent.com',
 aud:C26_GH_AUDIENCE,repository:repo,repository_id:id,repository_owner:'victordogboy',
 ref:'refs/heads/main',sub:'repo:'+repo+':ref:refs/heads/main',workflow_ref:wf,
 event_name:'push',iat:now-5,exp:now+240
};
function jwt(patch={},signingKey=privateKey){
 const header=Buffer.from(JSON.stringify({alg:'RS256',kid,typ:'JWT'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url');
 const data=header+'.'+payload;
 return data+'.'+sign('sha256',Buffer.from(data),signingKey).toString('base64url');
}
test('C26 GH OIDC verifies real RS256 signature and exact designated workflow',async()=>{
 assert.equal(await verifyC26GitHubOIDC(jwt(),{fetchFn:mockedJwks,now}),true);
 for(const patch of [
  {aud:'wrong'}, {iss:'https://evil.invalid'}, {repository:'attacker/repo'},
  {repository_id:'123'}, {repository_owner:'attacker'}, {ref:'refs/heads/feature'},
  {sub:'repo:'+repo+':pull_request'}, {workflow_ref:repo+'/.github/workflows/evil.yml@refs/heads/main'},
  {event_name:'pull_request'}, {exp:now-100}, {iat:now+200},
  {exp:now+1000}
 ]){
  assert.equal(await verifyC26GitHubOIDC(jwt(patch),{fetchFn:mockedJwks,now}),false,JSON.stringify(patch));
 }
 const badKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 assert.equal(await verifyC26GitHubOIDC(jwt({},badKey),{fetchFn:mockedJwks,now}),false);
 assert.equal(await verifyC26GitHubOIDC('not-a-jwt',{fetchFn:mockedJwks,now}),false);
});
test('C26 private feed accepts verified GitHub OIDC without Cloudflare FINMIND_TOKEN',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=mockedJwks;
 try{
  const map=new Map();
  const storage={get:async k=>Array.isArray(k)?new Map(k.map(x=>[x,map.get(x)])):map.get(k),
   put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k),
   transaction:async fn=>fn(storage)};
  const env={SCAN_JOBS:{idFromName:n=>n,get:()=>new C26PrivateStore({storage})}};
  const url='https://worker.example/api/c26/private-feed';
  const body=new Uint8Array(gzipSync(JSON.stringify({
   lock_id:'C26-EVENT-CORR-LOCK-20261112',
   pool_sha256:'2bbeada91a53d219a1f6815f84ac567db8182affca586537c199290d73c8c7fe',
   source:'FinMind private Actions secret',
   days:{
    '2026-10-27':{source_state:'available',price_valid:1,price:[{stock_id:'1101'}],institutional:[],source_errors:[]},
    '2026-10-28':{source_state:'available',price_valid:1,price:[{stock_id:'1101'}],institutional:[],source_errors:[]}
   }
  })));
  const bearer=jwt();
  const request=(method='GET',data)=>new Request(url,{method,headers:{authorization:'Bearer '+bearer},body:data});
  assert.equal((await c26PrivateFeedRoute(new Request(url,{method:'POST',body}),env)).status,503);
  const saved=await c26PrivateFeedRoute(request('POST',body),env);
  assert.equal(saved.status,201);
  const out=await saved.json();
  assert.equal(out.stored,true);
  assert.equal(out.raw_public,false);
  assert.ok(!JSON.stringify(out).includes(bearer));
  const restored=await c26PrivateFeedRoute(request(),env);
  assert.equal(restored.status,200);
  assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),body);
  const check=await c26PrivateFeedRoute(new Request(url+'/status',{headers:{authorization:'Bearer '+bearer}}),env);
  assert.equal(check.status,200);
  assert.equal((await check.json()).model_ready,false);
  assert.equal((await c26PrivateFeedRoute(new Request(url,{headers:{authorization:'Bearer '+jwt({repository:'other/repo'})}}),env)).status,401);
 }finally{globalThis.fetch=oldFetch}
});
