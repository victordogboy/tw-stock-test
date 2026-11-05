import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const worker = new URL('../worker/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const state = new URL('../.state/', import.meta.url);
const read = name => readFile(new URL(name, worker), 'utf8');

const sources = await Promise.all([
  ['SEED1494', 'r1494-seed.json'],
  ['HISTORY1494', 'r1494-history.json'],
  ['SUPPLEMENT1494', 'r1494-supplement.json'],
].map(async ([name, file]) => `const ${name} = ${gunzipSync(await readFile(new URL(file + '.gz', worker))).toString('utf8')};\n`));
const modules = await Promise.all([
  'accounting.js', 'engine.js', 'updater.js', 'r1494-engine.js',
  'r1494-updater.js', 'normalize.js', 'market-fallback.js',
].map(read));
await writeFile(new URL('index.js', worker), [...sources, ...modules].join('\n'));

const bucket = {
  async get(key) {
    try {
      const contents = await readFile(new URL(key, state), 'utf8');
      return {
        etag: createHash('sha256').update(contents).digest('hex'),
        text: async () => contents,
        json: async () => JSON.parse(contents),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  },
  async put(key, contents, { onlyIf } = {}) {
    const old = await this.get(key);
    if (old && onlyIf?.etagDoesNotMatch === '*') return null;
    if (onlyIf?.etagMatches && old?.etag !== onlyIf.etagMatches) return null;
    const path = join('.state', key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path + '.tmp', contents);
    await rename(path + '.tmp', path);
    return this.get(key);
  },
};
const { sync1494, snapshot1494 } = await import(new URL('index.js', worker));
const env = { BUCKET: bucket, FINMIND_TOKEN: process.env.FINMIND_TOKEN };
if (process.argv.includes('--sync')) {
  const result = await sync1494(env, { maxDays: 7 });
  console.log(JSON.stringify(result));
}
const snapshot = await snapshot1494(env);
await mkdir(output, { recursive: true });

await writeFile(new URL('snapshot.json.gz', output), gzipSync(JSON.stringify(snapshot)));
