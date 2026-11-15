import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
const base=new URL('../public/r1494a/c26/a56/',import.meta.url);
const summary=JSON.parse(fs.readFileSync(new URL('summary.json',base)));
const days=[2021,2022,2023,2024,2025,2026].flatMap(y=>JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(new URL(`${y}.json.gz.b64`,base),'utf8'),'base64'))));
const ix=days.findIndex(x=>x.date==='2026-11-05');
const elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,{value:id==='phase'?'pre':id==='clock'?'12:30':'',innerHTML:'',textContent:'',hidden:false,disabled:false});return elements.get(id)}};
globalThis.fetch=async p=>{const f=fs.readFileSync(new URL(p,base));return new Response(f)};
await import('../public/r1494a/c26/a56/app.mjs');const $=id=>document.getElementById(id);
test('all historical data validate and default is preopen only',()=>{
 assert.equal($('error').textContent,'');assert.equal($('date').disabled,false);assert.equal($('date').value,1418);assert.ok($('day').innerHTML.includes('開盤預定單'));assert.ok(!$('day').innerHTML.includes('反轉模擬成交'));
});
test('intraday state consumes only bars completed at the selected time',()=>{
 $('date').value=ix;$('phase').value='intra';$('clock').value='09:00';$('phase').onchange();
 assert.ok($('day').innerHTML.includes('等待第一根完整分 K'));assert.ok(!$('day').innerHTML.includes('C 已確認收復'));
 $('clock').value='09:01';$('clock').oninput();assert.ok(!$('day').innerHTML.includes('等待第一根完整分 K'));
 $('clock').value='10:45';$('clock').oninput();assert.ok(!$('day').innerHTML.includes('<td>10:46</td>'));
 $('clock').value='10:46';$('clock').oninput();assert.ok($('day').innerHTML.includes('<td>10:46</td>'));
});
test('close shows completed trades while returning to preopen removes them',()=>{
 $('phase').value='close';$('phase').onchange();assert.equal($('trades').hidden,false);assert.ok($('day').innerHTML.includes('盤後帳戶權益'));
 $('phase').value='pre';$('phase').onchange();assert.equal($('trades').hidden,true);assert.ok(!$('day').innerHTML.includes('盤後帳戶權益'));assert.ok(!$('day').innerHTML.includes('<td>10:46</td>'));
});
test('missing per-symbol minute history cannot be displayed as a confirmed signal',()=>{
 assert.equal(summary.status,'historical_replay_only');
 const html=fs.readFileSync(new URL('index.html',base),'utf8');assert.ok(html.includes('本頁為歷史紙上重播'));assert.ok(html.includes('不是今天的買賣計畫'));
});

test('expiry day explains why new entries are blocked',()=>{
 $('date').value=days.findIndex(x=>x.date==='2026-11-12');$('phase').value='pre';$('phase').onchange();assert.ok($('day').innerHTML.includes('今天安排反轉部位出場，不開新單'));
});
