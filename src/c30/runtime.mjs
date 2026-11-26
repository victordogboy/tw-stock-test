import {verifyC26GitHubOIDC} from '../c26/github-oidc.mjs';

const base = '/api/c30/runtime';
const encode = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const reply = (body, status = 200) => Response.json(body, {status, headers: {'cache-control': 'no-store'}});
const sha = /^[0-9a-f]{64}$/;

async function readManifest(env) {
 const response = await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/c30/runtime-manifest.json'));
 if (!response.ok) return null;
 const m = await response.json();
 if (m.anchor !== '2026-11-20' || !sha.test(m.sha256) || !sha.test(m.upload_key_sha256)
     || m.chunk_size !== 1024 * 1024 || !Number.isSafeInteger(m.bytes) || m.bytes <= 0
     || m.bytes > 300 * 1024 * 1024 || !Array.isArray(m.chunks)
     || m.chunks.length !== Math.ceil(m.bytes / m.chunk_size)
     || !m.chunks.every(x => sha.test(x)) || !Number.isFinite(Date.parse(m.upload_expires_at))) return null;
 return m;
}

export async function c30RuntimeRoute(request, env) {
 const url = new URL(request.url);
 const origin = request.headers.get('origin');
 if (origin && origin !== url.origin) return reply({error: 'Origin rejected'}, 403);
 const manifest = await readManifest(env);
 if (!manifest || !env.SCAN_JOBS) return reply({error: 'Runtime manifest unavailable'}, 503);
 const stub = env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('system:c30:frozen-runtime:' + manifest.sha256));
 const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
 if (request.method === 'GET' && url.pathname === base) {
  if (!await verifyC26GitHubOIDC(token)) return reply({error: 'Protected workflow required'}, 401);
  return stub.fetch('https://internal/c30-runtime-internal/download', {
   headers: {'x-runtime-manifest': JSON.stringify(manifest)}
  });
 }
 if (request.method !== 'PUT' || url.pathname !== base + '/chunk') return reply({error: 'Unsupported route'}, 405);
 if (Date.now() > Date.parse(manifest.upload_expires_at) || !sha.test(token)
     || await digest(encode.encode(token)) !== manifest.upload_key_sha256) return reply({error: 'Provisioning credential rejected'}, 401);
 const raw = url.searchParams.get('index');
 const index = Number(raw);
 if (!/^(0|[1-9][0-9]*)$/.test(raw || '') || !Number.isSafeInteger(index)
     || index >= manifest.chunks.length) return reply({error: 'Invalid chunk index'}, 400);
 const bytes = await request.arrayBuffer();
 const expected = Math.min(manifest.chunk_size, manifest.bytes - index * manifest.chunk_size);
 if (bytes.byteLength !== expected || await digest(bytes) !== manifest.chunks[index]) return reply({error: 'Chunk checksum mismatch'}, 422);
 return stub.fetch('https://internal/c30-runtime-internal/store?index=' + index, {
  method: 'PUT', headers: {'x-runtime-manifest': JSON.stringify(manifest)}, body: bytes
 });
}

export class C30RuntimeStore {
 constructor(ctx) { this.storage = ctx.storage; }

 async fetch(request) {
  const url = new URL(request.url);
  const manifest = JSON.parse(request.headers.get('x-runtime-manifest'));
  if (url.pathname === '/c30-runtime-internal/store' && request.method === 'PUT') {
   const index = Number(url.searchParams.get('index'));
   const bytes = new Uint8Array(await request.arrayBuffer());
   const count = await this.storage.transaction(async tx => {
    const key = 'chunk:' + index;
    const stored = await tx.get('count') || 0;
    if (await tx.get('saved:' + index)) return stored;
    await tx.put({[key]: bytes, ['saved:' + index]: true, count: stored + 1});
    return stored + 1;
   });
   return reply({received: count, expected: manifest.chunks.length, complete: count === manifest.chunks.length});
  }
  if (url.pathname !== '/c30-runtime-internal/download' || request.method !== 'GET') return reply({error: 'Not found'}, 404);
  if (await this.storage.get('count') !== manifest.chunks.length) return reply({error: 'Private C30 runtime still missing'}, 404);
  const storage = this.storage;
  let index = 0;
  const body = new ReadableStream({
   async pull(controller) {
    if (index === manifest.chunks.length) return controller.close();
    const chunk = await storage.get('chunk:' + index++, {noCache: true});
    if (!(chunk instanceof Uint8Array)) return controller.error(new Error('C30 runtime part missing'));
    controller.enqueue(chunk);
   }
  });
  return new Response(body, {headers: {'content-type': 'application/gzip', 'cache-control': 'no-store',
   'content-length': String(manifest.bytes), 'x-runtime-sha256': manifest.sha256}});
 }
}
