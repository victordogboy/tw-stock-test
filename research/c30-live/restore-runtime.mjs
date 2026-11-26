import {createHash} from 'node:crypto';
import {createWriteStream, readFileSync, renameSync, rmSync} from 'node:fs';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const target = process.argv[2];
const manifest = JSON.parse(readFileSync('public/r1494a/c30/runtime-manifest.json'));
const audience = 'https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed';
const issuer = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
issuer.searchParams.set('audience', audience);
const identityResponse = await fetch(issuer, {headers: {
 authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
}, signal: AbortSignal.timeout(25000)});
if (!identityResponse.ok) throw new Error('GitHub workflow identity unavailable');
const {value} = await identityResponse.json();
const response = await fetch(new URL('/api/c30/runtime', audience), {
 headers: {authorization: 'Bearer ' + value},
 signal: AbortSignal.timeout(180000)
});
if (!response.ok) throw new Error('Private C30 runtime unavailable HTTP ' + response.status);
const hash = createHash('sha256');
let size = 0;
const staged = target + '.tmp';
try {
 await pipeline(Readable.fromWeb(response.body), new Transform({
  transform(chunk, _, callback) {
   size += chunk.length;
   if (size > manifest.bytes) return callback(new Error('C30 runtime exceeds manifest size'));
   hash.update(chunk);
   callback(null,chunk);
  }
 }), createWriteStream(staged, {mode:0o600}));
 if (size !== manifest.bytes || hash.digest('hex') !== manifest.sha256) throw new Error('C30 runtime integrity failure');
 renameSync(staged,target);
 console.log('C30 private runtime verified:',size,'bytes');
} finally {
 rmSync(staged,{force:true});
}
