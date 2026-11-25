import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBatches,sendImport} from '../scripts/import-leads.mjs';

const item=n=>({externalId:String(n),title:'Project '+n});
const url='https://dashboard.example.test/api/import/sources/bouw/leads',token='test-only-import-token-'.repeat(3);
test('import client prepares stable batches and performs a network-free dry run',async()=>{
 const input=Array.from({length:205},(_,i)=>item(i)),first=prepareBatches(input),second=prepareBatches(input);
 assert.deepEqual(first,second);assert.deepEqual(first.batches.map(b=>b.items.length),[100,100,5]);
 assert.equal(new Set(first.batches.map(b=>b.runId)).size,3);
 const result=await sendImport({input,dryRun:true,fetchImpl:()=>assert.fail('Dry run must not send data')});
 assert.deepEqual(result,{dryRun:true,total:205,batches:3,sent:0});
 assert.equal((await sendImport({input:[],fetchImpl:()=>assert.fail('Empty input must not send data')})).sent,0);
});
test('import client rejects duplicate identities, missing titles, unsafe links and oversized records before sending',()=>{
 for(const input of [[item(1),item(1)],[{externalId:'1'}],[{title:'Project'}],[{title:'Project',sourceUrl:'javascript:alert(1)'}],[{...item(1),description:'x'.repeat(1024*1024)}]])assert.throws(()=>prepareBatches(input));
 assert.throws(()=>prepareBatches([{title:'Project',sourceUrl:'https://example.test/1#first'},{title:'Project',sourceUrl:'https://example.test/1#second'}]));
 assert.doesNotThrow(()=>prepareBatches([{title:'Project',sourceUrl:'https://example.test/1'}]));
});
test('import client keeps retry bodies identical and uses a bearer header without cookies',async()=>{
 const requests=[];let attempts=0;
 const result=await sendImport({input:[item(1)],url,token,sleep:async()=>{},fetchImpl:async(target,options)=>{requests.push({target,options});return ++attempts===1?new Response('',{status:503}):Response.json({counts:{created:1,updated:0,unchanged:0}});}});
 assert.equal(result.counts.created,1);assert.equal(requests.length,2);assert.equal(requests[0].options.body,requests[1].options.body);
 assert.equal(requests[0].options.headers.Authorization,'Bearer '+token);assert.equal(requests[0].options.redirect,'error');assert.equal(requests[0].options.headers.Cookie,undefined);
 assert(!JSON.stringify(result).includes(token));
});
test('import client does not retry authorization failures or expose server errors and credentials',async()=>{
 let requests=0;
 await assert.rejects(()=>sendImport({input:[item(1)],url,token,fetchImpl:async()=>{requests++;return Response.json({error:token},{status:401});}}),error=>error.message.includes('401')&&!error.message.includes(token));
 assert.equal(requests,1);
 for(const bad of ['http://example.test/api/import/sources/bouw/leads','https://user:pass@example.test/api/import/sources/bouw/leads','https://example.test/api/action'])await assert.rejects(()=>sendImport({input:[item(1)],url:bad,token,fetchImpl:()=>assert.fail('Unsafe destination must not be called')}));
});

test('import client combines excluded totals across mixed batches without losing later ordinary counts',async()=>{
 const input=Array.from({length:205},(_,i)=>item(i)),counts=[{created:98,updated:0,unchanged:0,excluded:2},{created:100,updated:0,unchanged:0},{created:0,updated:0,unchanged:0,excluded:5}];let calls=0;
 const result=await sendImport({input,url,token,fetchImpl:async()=>Response.json({counts:counts[calls++]})});
 assert.equal(calls,3);assert.equal(result.sent,205);assert.deepEqual(result.counts,{created:198,updated:0,unchanged:0,excluded:7});
 for(const excluded of [-1,0.5,'2',null])await assert.rejects(()=>sendImport({input:[item(1)],url,token,fetchImpl:async()=>Response.json({counts:{created:0,updated:0,unchanged:0,excluded}})}),/geen geldige aantallen/);
});
