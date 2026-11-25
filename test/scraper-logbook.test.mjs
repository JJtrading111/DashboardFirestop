import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';

const EMAIL='logbook-owner@example.test',PASSWORD='Logbook-test-password-2026!';
const LOGIN={username:'private-login@example.test',password:'Synthetic-private-source-password!'},WORKER='w'.repeat(43);
const FILTER='https://portal.bouwberichten.nl/projecten#'+new URLSearchParams([['projects[filters][constructionPhase][]','Gegund']]);
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
const item=n=>({externalId:'logbook-project-'+n,title:'Project '+n,city:'Utrecht'});

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-logbook-test-'));let app,base;
 const options={dataDir,adminEmail:EMAIL,adminName:'Logboekbeheerder',adminPassword:PASSWORD,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,publicOrigin:'',publicOriginAliases:'',secureCookies:false,scraperEncryptionKey:Buffer.alloc(32,23).toString('base64url'),scraperWorkerToken:WORKER};
 const start=async()=>{app=createApp(options);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base=`http://127.0.0.1:${app.server.address().port}`;};
 await start();
 t.after(async()=>{if(app)await app.close();const resolved=path.resolve(dataDir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('bouwberichten-logbook-test-'));await rm(resolved,{recursive:true,force:true});});
 const sql=fn=>{const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{return fn(db);}finally{db.close();}};
 async function request(route,{method='GET',body,headers={}}={}){
  const response=await fetch(base+route,{method,headers:{...body===undefined?{}:{'Content-Type':'application/json'},...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  return{status:response.status,data:await response.json(),headers:response.headers};
 }
 function client(){
  const browser={cookie:'',csrfToken:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true}={})=>{
   const response=await request(route,{method,body,headers:{Origin:base,...browser.cookie?{Cookie:browser.cookie}:{},...csrf&&browser.csrfToken?{'X-CSRF-Token':browser.csrfToken}:{}}});
   const cookie=response.headers.get('set-cookie');if(cookie)browser.cookie=cookie.split(';')[0];if(response.status===200&&response.data.csrfToken)browser.csrfToken=response.data.csrfToken;if(response.status===200&&response.data.user)browser.user=response.data.user;return response;
  };
  browser.action=(type,payload={},companyId='c-noord',extra={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...extra});
  browser.log=(query='')=>browser.request('/api/source-logbook'+query);
  browser.state=async()=>ok(await browser.request('/api/state?companyId=c-noord')).state;
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:EMAIL,password:PASSWORD}}));
 const worker=(route,body={})=>request('/api/scraper/'+route,{method:'POST',body,headers:{Authorization:'Bearer '+WORKER}});
 async function finish(job,items=[item('proof')]){
  ok(await worker(`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:items.length}));
  ok(await worker(`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items}));
  ok(await worker(`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:items.length,total:items.length}));
 }
 async function configure(id='bouw',{proof=true}={}){
  ok(await owner.action('source.update',{id,filterUrl:FILTER}));ok(await owner.action('source.scraper.configure',{id,...LOGIN}));
  if(proof){const job=ok(await worker('claim')).job;assert.equal(job.sourceId,id);await finish(job,[item('proof-'+id)]);}
 }
 const claim=async()=>ok(await worker('claim')).job;
 const full=async(id='bouw')=>{ok(await owner.action('source.scraper.run',{id}));return claim();};
 const fail=async(job,code='source_error',diagnostic)=>ok(await worker(`jobs/${job.id}/fail`,{leaseToken:job.leaseToken,code,...diagnostic===undefined?{}:{diagnostic}}));
 const retry=(job,id=job.sourceId,extra={})=>owner.action('source.scraper.retry',{id,jobId:job.id},'c-noord',extra);
 const addUser=async role=>{const browser=client(),invite=ok(await owner.action('invitation.create',{name:role,email:randomUUID()+'@example.test',companyId:'c-noord',role})).result;ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invite.token,name:role,password:PASSWORD}}));return browser;};
 const addSource=async()=>ok(await owner.action('source.create',{name:'Tweede Bouwfilter',provider:'bouwberichten',filterUrl:FILTER})).result.source;
 const restart=async modify=>{await app.close();app=null;if(modify)sql(modify);await start();};
 return{owner,client,request,worker,configure,claim,full,finish,fail,retry,addUser,addSource,sql,restart};
}

test('logbook reads and manual retries are chief-only and worker authentication cannot read the admin logbook',async t=>{
 const env=await fixture(t);await env.configure();const job=await env.full();await env.fail(job);
 assert.equal((await env.request('/api/source-logbook')).status,401);
 assert.equal((await env.request('/api/source-logbook',{headers:{Authorization:'Bearer '+WORKER}})).status,401);
 for(const role of ['verkoper','bedrijfsbeheerder']){
  const browser=await env.addUser(role);assert.equal((await browser.log()).status,403);
  assert.equal((await browser.action('source.scraper.retry',{id:'bouw',jobId:job.id})).status,403);
 }
 assert.equal((await env.retry(job,'bouw',{csrf:false})).status,403);
 assert.equal((await env.owner.request('/api/scraper/logbook')).status,405,'The worker namespace remains machine-only POST');
 assert.equal(ok(await env.owner.log('?status=failed')).entries[0].id,job.id);
});

test('per-job failure details are safe, retain partial counts, and an idempotent full retry preserves leads and follow-up',async t=>{
 const env=await fixture(t);await env.configure();ok(await env.owner.action('source.scraper.schedule',{id:'bouw',enabled:true,time:'06:00'}));
 const job=await env.full(),items=Array.from({length:20},(_,n)=>item(n));
 ok(await env.worker(`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:1352}));
 ok(await env.worker(`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items}));
 const beforeFail=await env.owner.state(),lead=beforeFail.leads.find(value=>value.importExternalId===items[0].externalId);
 ok(await env.owner.action('note.add',{leadId:lead.id,text:'Mijn bestaande opvolging blijft behouden.'}));
 const rawMarker='RAW_PRIVATE_ERROR_https://private.example?password=DO_NOT_RETURN';
 await env.fail(job,'source_error',{stage:'listing',reason:'total_changed',processed:20,expectedTotal:1352,observedTotal:1353,status:409,
  message:rawMarker,url:rawMarker,password:LOGIN.password,username:LOGIN.username,leaseToken:job.leaseToken,stack:rawMarker});
 let log=ok(await env.owner.log('?status=all')),entry=log.entries.find(value=>value.id===job.id);
 assert.equal(entry.status,'failed');assert.equal(entry.mode,'full');assert.equal(entry.processed,20);assert.equal(entry.total,1352);assert.deepEqual(entry.counts,{created:20,updated:0,unchanged:0});
 assert.equal(entry.error.code,'source_error');assert.equal(entry.error.reason,'total_changed');assert.match(entry.error.message,/aantal projecten/i);assert(entry.error.advice);assert.equal(entry.canRetry,true);
 assert.deepEqual(entry.error.diagnostic,{stage:'listing',reason:'total_changed',status:409,processed:20,expectedTotal:1352,observedTotal:1353});
 const serialized=JSON.stringify(log);for(const secret of [rawMarker,LOGIN.password,LOGIN.username,WORKER,job.leaseToken,FILTER,'source_fingerprint','encrypted_login','lease_hash'])assert.equal(serialized.includes(secret),false,secret);
 const stored=env.sql(db=>db.prepare('SELECT error_details_json FROM scraper_jobs WHERE id=?').get(job.id).error_details_json);assert.equal(stored.includes(rawMarker),false);
 const before=await env.owner.state(),first=ok(await env.retry(job)),feedCount=first.state.feed.length,second=ok(await env.retry(job));
 assert.equal(first.result.alreadyQueued,false);assert.equal(second.result.alreadyQueued,true);assert.equal(first.result.retryJobId,second.result.retryJobId);assert.equal(second.state.feed.length,feedCount);
 assert.deepEqual(first.state.leads,before.leads);assert.deepEqual(first.state.workspaces,before.workspaces);
 const cfg=first.state.sources.find(value=>value.id==='bouw').scraper;assert.equal(cfg.scheduleEnabled,false);assert.equal(cfg.nextRunAt,null);assert.equal(cfg.lastTestPassed,false);
 log=ok(await env.owner.log('?status=all'));entry=log.entries.find(value=>value.id===job.id);const child=log.entries.find(value=>value.id===first.result.retryJobId);
 assert.equal(entry.canRetry,false);assert.equal(entry.retryJobId,child.id);assert.equal(child.retryOf,job.id);assert.equal(child.status,'queued');
 const retried=await env.claim();assert.equal(retried.mode,'full');assert.equal(retried.id,child.id);await env.finish(retried,items);
 const finished=ok(await env.owner.log('?status=finished')).entries.find(value=>value.id===child.id);assert.equal(finished.error,null);assert.deepEqual(finished.counts,{created:0,updated:0,unchanged:20});
 assert.equal((await env.owner.state()).workspaces['c-noord'][lead.id].notes[0].text,'Mijn bestaande opvolging blijft behouden.');
 await env.restart();assert.equal(ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===job.id).error.reason,'total_changed');
});

test('a failed retry has its own retry button while repeating the original button never queues another job',async t=>{
 const env=await fixture(t);await env.configure();const original=await env.full();await env.fail(original,'scrape_error',{stage:'detail',reason:'network_error'});
 const first=ok(await env.retry(original)).result.retryJobId,child=await env.claim();assert.equal(child.id,first);await env.fail(child,'scrape_error',{stage:'detail',reason:'request_timeout'});
 const log=ok(await env.owner.log('?status=failed'));assert.equal(log.entries.find(value=>value.id===original.id).canRetry,false);assert.equal(log.entries.find(value=>value.id===child.id).canRetry,true);
 assert.equal(ok(await env.retry(original)).result.retryJobId,first);
 const next=ok(await env.retry(child)).result.retryJobId;assert.notEqual(next,first);
 assert.equal(env.sql(db=>db.prepare('SELECT COUNT(*) AS n FROM scraper_jobs WHERE retry_of=?').get(original.id).n),1);
});

test('unknown failure codes and malformed diagnostic fields never become stored or public error text',async t=>{
 const env=await fixture(t);await env.configure();const job=await env.full(),marker='PRIVATE_MALFORMED_DIAGNOSTIC_VALUE';
 await env.fail(job,marker,{stage:marker,reason:marker,status:999,processed:-1,expectedTotal:'1352',observedTotal:10000001,authStage:marker,authReason:marker,message:marker});
 const entry=ok(await env.owner.log('?status=failed')).entries[0];
 assert.equal(entry.error.code,'scrape_error');assert.deepEqual(entry.error.diagnostic,{stage:'unknown',reason:'unexpected_error'});
 assert.equal(JSON.stringify(entry).includes(marker),false);
 const stored=env.sql(db=>db.prepare('SELECT error_code,error_details_json FROM scraper_jobs WHERE id=?').get(job.id));assert.equal(JSON.stringify(stored).includes(marker),false);
});

test('logbook turns an expired running lease into an actionable failure without a worker poll',async t=>{
 const env=await fixture(t);await env.configure();const job=await env.full();
 ok(await env.worker(`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:1352}));
 ok(await env.worker(`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items:[item('partial')]}));
 env.sql(db=>db.prepare('UPDATE scraper_jobs SET lease_until=? WHERE id=?').run(Date.now()-1,job.id));
 const entry=ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===job.id);
 assert.equal(entry.error.code,'lease_expired');assert.match(entry.error.message,/geen voortgang/i);assert.equal(entry.processed,1);assert.equal(entry.total,1352);assert.equal(entry.counts.created,1);assert.equal(entry.canRetry,true);
 assert.equal((await env.worker(`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:1,total:1352})).status,409);
 assert.equal(ok(await env.retry(job)).result.alreadyQueued,false);
});

test('login failures, source invalidation, active jobs and mismatched source IDs block unsafe retries',async t=>{
 const env=await fixture(t);await env.configure();const login=await env.full();await env.fail(login,'login_required',{stage:'login',reason:'login_required',authStage:'password_submitted',authReason:'interactive_verification'});
 let entry=ok(await env.owner.log('?status=failed')).entries[0];assert.equal(entry.canRetry,false);assert.match(entry.retryBlockedReason,/Verbind/);assert.equal((await env.retry(login)).status,409);
 await env.configure();const failed=await env.full();await env.fail(failed);
 const other=await env.addSource();assert.equal((await env.retry(failed,other.id)).status,404);
 ok(await env.owner.action('source.scraper.test',{id:'bouw'}));entry=ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===failed.id);assert.equal(entry.canRetry,false);assert.match(entry.retryBlockedReason,/al een opdracht/);assert.equal((await env.retry(failed)).status,409);
 await env.finish(await env.claim());
 ok(await env.owner.action('source.import.toggle',{id:'bouw',enabled:false}));ok(await env.owner.action('source.import.toggle',{id:'bouw',enabled:true}));
 entry=ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===failed.id);assert.equal(entry.canRetry,false);assert.match(entry.retryBlockedReason,/gewijzigd/);assert.equal((await env.retry(failed)).status,409);
 ok(await env.owner.action('source.scraper.test',{id:'bouw'}));await env.finish(await env.claim());
 const changed=await env.full();await env.fail(changed);const changedFilter=FILTER.replace('Gegund','Initiatief');
 ok(await env.owner.action('source.update',{id:'bouw',filterUrl:changedFilter}));ok(await env.owner.action('source.update',{id:'bouw',filterUrl:FILTER}));
 assert.equal(ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===changed.id).canRetry,false);assert.equal((await env.retry(changed)).status,409);
 ok(await env.owner.action('source.delete',{id:'bouw'}));assert.equal(ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===changed.id).canRetry,false);
});

test('legacy migration allows the latest unchanged full failure with split legacy timestamps and keeps its unknown cause honest',async t=>{
 const env=await fixture(t);await env.configure('bouw',{proof:false});const older=await env.claim();await env.fail(older);
 ok(await env.owner.action('source.scraper.test',{id:'bouw'}));await env.finish(await env.claim());const latest=await env.full();await env.fail(latest);
 const original=env.sql(db=>({...db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(latest.id)}));
 await env.restart(db=>{
  db.exec('DROP INDEX scraper_jobs_retry_once');for(const column of ['error_code','error_details_json','source_fingerprint','retry_of'])db.exec('ALTER TABLE scraper_jobs DROP COLUMN '+column);
  db.exec('ALTER TABLE scraper_sources DROP COLUMN configuration_version');
  db.prepare("UPDATE scraper_sources SET last_finished_at=? WHERE source_id='bouw'").run(original.finished_at+7);
 });
 const entries=ok(await env.owner.log('?status=failed')).entries,old=entries.find(value=>value.id===older.id),recent=entries.find(value=>value.id===latest.id);
 assert.equal(old.canRetry,false);assert.equal(recent.canRetry,true);assert.equal(recent.mode,'full');assert.equal(recent.error.code,'legacy_unknown');assert.match(recent.error.message,/niet vastgelegd/);
 assert.equal(recent.finishedAt,new Date(original.finished_at).toISOString());assert.equal(recent.processed,original.processed);
 const retried=ok(await env.retry(latest)).result.retryJobId;assert.equal((await env.claim()).id,retried);
});

test('legacy retry proof rejects missing, backwards or unrelated source failure timestamps',async t=>{
 const env=await fixture(t);await env.configure();const job=await env.full();await env.fail(job);
 const finished=env.sql(db=>db.prepare('SELECT finished_at FROM scraper_jobs WHERE id=?').get(job.id).finished_at);
 for(const [jobTime,sourceTime]of [[null,null],[finished,finished-1],[finished,finished+1001]]){
  await env.restart(db=>{
   db.prepare('UPDATE scraper_jobs SET source_fingerprint=NULL,error_code=NULL,error_details_json=NULL,finished_at=? WHERE id=?').run(jobTime,job.id);
   db.prepare("UPDATE scraper_sources SET last_finished_at=? WHERE source_id='bouw'").run(sourceTime);
  });
  const entry=ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===job.id);
  assert.equal(entry.canRetry,false);assert.equal((await env.retry(job)).status,409);
 }
});

test('the latest legacy failure is blocked when source settings had already invalidated its proof',async t=>{
 const env=await fixture(t);await env.configure();const job=await env.full();await env.fail(job);ok(await env.owner.action('source.update',{id:'bouw',filterUrl:FILTER.replace('Gegund','Initiatief')}));
 await env.restart(db=>db.prepare('UPDATE scraper_jobs SET source_fingerprint=NULL,error_code=NULL,error_details_json=NULL WHERE id=?').run(job.id));
 const entry=ok(await env.owner.log('?status=failed')).entries.find(value=>value.id===job.id);assert.equal(entry.canRetry,false);assert.equal(entry.error.code,'legacy_unknown');assert.equal((await env.retry(job)).status,409);
});

test('all job states are bounded and paginated without exposing source connection data',async t=>{
 const env=await fixture(t);await env.configure('bouw',{proof:false});const queued=ok(await env.owner.log('?status=queued')).entries[0];assert.equal(queued.mode,'test');assert.equal(queued.error,null);
 const running=await env.claim();assert.equal(ok(await env.owner.log('?status=running')).entries[0].id,running.id);
 ok(await env.owner.action('source.scraper.disconnect',{id:'bouw'}));const cancelled=ok(await env.owner.log('?status=cancelled')).entries[0];assert.equal(cancelled.id,running.id);assert.equal(cancelled.canRetry,false);assert.equal(cancelled.error.code,'cancelled');
 env.sql(db=>{const insert=db.prepare("INSERT INTO scraper_jobs(id,source_id,mode,status,queued_at,finished_at) VALUES(?,'bouw','test','finished',?,?)");for(let n=0;n<105;n++)insert.run('scrape-'+randomUUID(),Date.now()+n,Date.now()+n);});
 const first=ok(await env.owner.log('?status=finished&limit=20&offset=0')),last=ok(await env.owner.log('?status=finished&limit=20&offset=90'));
 assert.equal(first.entries.length,20);assert.equal(first.total,100);assert.equal(first.hasMore,true);assert.equal(last.entries.length,10);assert.equal(last.hasMore,false);
 assert.equal(first.entries.some(a=>last.entries.some(b=>a.id===b.id)),false);
 assert.equal(ok(await env.owner.log('?status=all&sourceId=not-a-source')).entries.length,0);
 for(const query of ['?limit=101','?offset=101','?offset=-1','?limit=1.5','?status=bad-value'])assert.equal((await env.owner.log(query)).status,400);
});
