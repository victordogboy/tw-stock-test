import test from 'node:test';
import assert from 'node:assert/strict';
import {readToken,saveToken,clearToken,cleanToken} from '../public/r1494a/c26/device-token.mjs';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
test('C26 token survives reload only in the same browser store and can be cleared',()=>{
 const thisBrowser=storage(),anotherBrowser=storage(),token='example-test-only-credential-1234567890';
 assert.equal(readToken(thisBrowser),'');saveToken(token,thisBrowser);
 assert.equal(readToken(thisBrowser),token);assert.equal(readToken(anotherBrowser),'');
 clearToken(thisBrowser);assert.equal(readToken(thisBrowser),'');
});
test('Copy/paste normalization accepts escaped underscores without accepting whitespace',()=>{
 assert.equal(cleanToken('  token\\_part  '),'token_part');
 assert.throws(()=>saveToken('invalid token with spaces that is long',storage()));
});
