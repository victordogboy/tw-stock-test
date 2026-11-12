/**
 * Authenticate private C26 FinMind source transfers from the repository's
 * precisely identified GitHub Actions workflow, with GitHub OIDC. The FinMind
 * market-data credential never leaves GitHub Actions or becomes a Worker secret.
 *
 * Fail closed: verify RS256 against GitHub's live JWKS, audience, issuer,
 * repository numeric identity, workflow location, branch, and token expiry.\n * The signed 'sub' can be customized by repository OIDC subject templates;\n * the other signed, exact claims are independently enforced.
 * Never log tokens, raw prices, or licensed vendor data.
 */
export const C26_GH_AUDIENCE='https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed';
const ISSUER='https://token.actions.githubusercontent.com';
const JWKS=ISSUER+'/.well-known/jwks';
const REPO='victordogboy/tw-stock-test';
const REPO_ID='1363009462';
const WF=REPO+'/.github/workflows/c26-forward-eod.yml@refs/heads/main';
const b64urlDecode=part=>{
 if(typeof part!=='string'||part.length>14000||!/^[a-zA-Z0-9_-]+$/.test(part))throw Error('malformed JWT');
 const binary=atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4));
 return Uint8Array.from(binary,ch=>ch.charCodeAt(0));
};
const parseJsonBytes=bytes=>JSON.parse(new TextDecoder().decode(bytes));

export async function verifyC26GitHubOIDC(token,{fetchFn=fetch,now=Math.floor(Date.now()/1000)}={}){
 try{
  if(typeof token!=='string'||token.length>14500)return false;
  const pieces=token.split('.');
  if(pieces.length!==3)return false;
  const [h,p,s]=pieces;
  const header=parseJsonBytes(b64urlDecode(h)),claims=parseJsonBytes(b64urlDecode(p));
  if(header.alg!=='RS256'||!header.kid||typeof header.kid!=='string')return false;
  if(claims.iss!==ISSUER||claims.aud!==C26_GH_AUDIENCE||
     claims.repository!==REPO||String(claims.repository_id)!==REPO_ID||
     claims.repository_owner!=='victordogboy'||claims.ref!=='refs/heads/main'||
     claims.workflow_ref!==WF||
     !['schedule','push','workflow_dispatch'].includes(claims.event_name))return false;
  if(!Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||
     claims.iat>now+60||claims.exp<=now-30||
     claims.exp-claims.iat<=0||claims.exp-claims.iat>600)return false;
  if(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now+60))return false;
  const response=await fetchFn(JWKS,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;
  const keys=await response.json();
  const jwk=keys?.keys?.find(x=>x.kid===header.kid&&x.kty==='RSA'&&
   x.alg==='RS256'&&x.use==='sig'&&x.n&&x.e);
  if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64urlDecode(s),new TextEncoder().encode(h+'.'+p));
 }catch{return false}
}
