import fs from 'node:fs';
const worker='r1494a/worker/';
let out='// Existing verified R1494 data collection and technical indicators; isolated FC23 storage.\nlet SEED1494,HISTORY1494={},SUPPLEMENT1494={},HOOKS={};\nexport function initShared(seed,supplement={},hooks={}){SEED1494=seed;SUPPLEMENT1494=supplement;HOOKS=hooks}\n';
for(const p of ['accounting.js','engine.js','updater.js','r1494-engine.js','r1494-updater.js','normalize.js','market-fallback.js'])out+=fs.readFileSync(worker+p,'utf8').replace(/export\s*\{[^}]*\};?/g,'')+'\n';
out=out.replace('const inputVersion=await hash1494(JSON.stringify(day)),candidate=structuredClone(st);',`if(HOOKS.context)await env.BUCKET.put('fc23/context/'+st.date+'.json',JSON.stringify(HOOKS.context(st)));const inputVersion=await hash1494(JSON.stringify(day)),candidate=structuredClone(st);`).replace('ingest1494(candidate,day);','ingest1494(candidate,day);if(HOOKS.ingest)HOOKS.ingest(candidate,day);');
out+='\nexport {features,context1494,ingest1494,sync1494,load1494,officialDay,officialChips1494,cutoff,nextDate,nextSession1494};\n';
fs.writeFileSync('src/fc23/shared.mjs',out);
