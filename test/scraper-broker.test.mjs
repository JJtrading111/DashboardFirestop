import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {reportRows} from '../public/model.mjs';

const EMAIL = 'filters-owner@example.test', PASSWORD = 'Filters-test-password-2026!';
const FILTER_A = 'https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BlastPublishedAt%5D%5Bstart%5D=2025-12-31T23%3A00%3A00.000Z&projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const FILTER_B = FILTER_A.replace('2025-12-31', '2024-12-31');
const filterUrl = pairs => 'https://portal.bouwberichten.nl/projecten#' + new URLSearchParams(pairs).toString();

async function fixture(extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bouwberichten-scraper-test-'));
  const options = {dataDir, adminEmail: EMAIL, adminName: 'Filterbeheerder', adminPassword: PASSWORD, bootstrapToken: '', demoCleanupId: '', seedDemoData: false, publicOrigin: '', secureCookies: false, scraperEncryptionKey: Buffer.alloc(32,7).toString('base64url'), scraperWorkerToken: 'w'.repeat(43), ...extra};
  let app, base;
  async function start() {app = createApp(options);app.server.listen(0, '127.0.0.1');await once(app.server, 'listening');base = `http://127.0.0.1:${app.server.address().port}`;}
  await start();
  async function request(route, {method = 'GET', body, headers = {}} = {}) {
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + route, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();let data;try {data = JSON.parse(text);} catch {data = null;}
    return {status: res.status, ok: res.ok, data, text, headers: res.headers};
  }
  function client() {
    const browser = {cookie: '', csrfToken: '', user: null};
    browser.request = async (route, {method = 'GET', body, csrf = true} = {}) => {
      const headers = {Origin: base};if (browser.cookie) headers.Cookie = browser.cookie;if (csrf && browser.csrfToken) headers['X-CSRF-Token'] = browser.csrfToken;
      const res = await request(route, {method, body, headers});const cookie = res.headers.get('set-cookie');if (cookie) browser.cookie = cookie.split(';')[0];
      if (res.ok && res.data?.csrfToken) browser.csrfToken = res.data.csrfToken;if (res.ok && res.data?.user) browser.user = res.data.user;return res;
    };
    browser.login = () => browser.request('/api/auth/login', {method: 'POST', body: {email: EMAIL, password: PASSWORD}});
    browser.activate = (token, name) => browser.request('/api/auth/activate', {method: 'POST', body: {token, name, password: PASSWORD}});
    browser.action = (type, payload = {}, companyId = 'c-noord', extra = {}) => browser.request('/api/action', {method: 'POST', body: {type, companyId, payload}, ...extra});
    browser.state = (companyId = 'c-noord') => browser.request(`/api/state?companyId=${encodeURIComponent(companyId)}`);
    return browser;
  }
  return {client, dataDir, request,
    machine(sourceId, token, runId, items) {return request(`/api/import/sources/${encodeURIComponent(sourceId)}/leads`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: {runId, items}});},
    async restart() {await app.close();await start();},
    async close() {await app.close();assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('bouwberichten-scraper-test-'));await rm(dataDir, {recursive: true, force: true});}
  };
}
function ok(r){assert.ok(r.ok,`${r.status} ${r.data?.error||''}`);return r.data;}
const LOGIN={username:'bron@example.test',password:'Private-source-password-not-in-state!'};
const worker=(env,route,body={},token='w'.repeat(43))=>env.request('/api/scraper/'+route,{method:'POST',headers:{Authorization:'Bearer '+token},body});
async function configure(env){const owner=env.client();ok(await owner.login());ok(await owner.action('source.update',{id:'bouw',filterUrl:FILTER_A}));ok(await owner.action('source.scraper.configure',{id:'bouw',...LOGIN}));return owner;}
const state=async owner=>ok(await owner.state()).state;
const jobItem=n=>({externalId:'test-source-'+n,title:'Project '+n,city:'Utrecht'});

test('source login stays encrypted, chief-only and separate from browser/import credentials',async t=>{
 const env=await fixture();t.after(()=>env.close());const owner=await configure(env);
 const snapshot=await state(owner),summary=snapshot.sources.find(s=>s.id==='bouw').scraper;
 assert.equal(summary.configured,true);assert.equal(summary.status,'queued');assert.equal(summary.lastTestPassed,false);assert.equal(summary.username,LOGIN.username);
 assert(!JSON.stringify(snapshot).includes(LOGIN.password));assert(!JSON.stringify(snapshot).includes('w'.repeat(43)));
 const db=new DatabaseSync(path.join(env.dataDir,'dashboard.sqlite'));const vault=db.prepare('SELECT * FROM scraper_sources').get();const appState=db.prepare('SELECT json FROM app_state').get().json;db.close();
 assert(vault.encrypted_login.length>40);assert(!vault.encrypted_login.includes(LOGIN.password));assert(!appState.includes(LOGIN.password));assert(!appState.includes('encrypted_login'));
 assert.equal((await worker(env,'claim',{},'x'.repeat(43))).status,401);
 assert.equal((await owner.request('/api/scraper/claim',{method:'POST',body:{}})).status,401,'An owner cookie does not grant worker access');
 assert.equal((await owner.action('source.scraper.test',{id:'bouw'},'c-noord',{csrf:false})).status,403);
 const invite=ok(await owner.action('invitation.create',{name:'Verkoper',email:'scraper-seller@example.test',companyId:'c-noord',role:'verkoper'})).result;
 const seller=env.client();ok(await seller.activate(invite.token,'Verkoper'));assert.equal((await seller.action('source.scraper.configure',{id:'bouw',...LOGIN})).status,403);
 const sellerState=await state(seller);assert.equal(sellerState.sources.find(s=>s.id==='bouw').scraper,undefined);assert(!JSON.stringify(sellerState).includes(LOGIN.username));
 const job=ok(await worker(env,'claim')).job;assert.equal(job.username,LOGIN.username);assert.equal(job.password,LOGIN.password);assert.equal(job.limit,5);assert.equal(job.mode,'test');assert.equal(job.sourceId,'bouw');
 assert.equal(ok(await worker(env,'claim')).job,null,'One queued job is leased only once');
 assert.equal((await worker(env,`jobs/${job.id}/progress`,{leaseToken:'wrong',processed:0,total:5})).status,409);
 assert.equal((await state(owner)).sources.find(s=>s.id==='bouw').scraper.workerOnline,true);
 await env.restart();assert.equal((await state(owner)).sources.find(s=>s.id==='bouw').scraper.configured,true);assert(!JSON.stringify(await state(owner)).includes(LOGIN.password));
});

test('a five-project proof imports idempotently, gates full/daily runs and survives restart',async t=>{
 const env=await fixture();t.after(()=>env.close());const owner=await configure(env);
 assert.equal((await owner.action('source.scraper.run',{id:'bouw'})).status,409);
 assert.equal((await owner.action('source.scraper.schedule',{id:'bouw',enabled:true})).status,409);
 const job=ok(await worker(env,'claim')).job,items=Array.from({length:5},(_,n)=>jobItem(n));
 ok(await worker(env,`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:1094}));
 assert.equal((await worker(env,`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:5})).status,409);
 const batch={leaseToken:job.leaseToken,batch:0,items};const first=ok(await worker(env,`jobs/${job.id}/batch`,batch));assert.equal(first.counts.created,5);
 assert.deepEqual(ok(await worker(env,`jobs/${job.id}/batch`,batch)),first);
 assert.equal((await worker(env,`jobs/${job.id}/batch`,{...batch,items:[jobItem(66)]})).status,409);
 assert.equal((await worker(env,`jobs/${job.id}/batch`,{...batch,batch:1,items:[jobItem(77)]})).status,400);
 assert.equal((await worker(env,`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:4,total:1094})).status,400);
 assert.equal((await worker(env,`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:5,total:5})).status,400,'Reported completion must retain the original source total');
 ok(await worker(env,`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:5,total:1094}));
 ok(await worker(env,`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:5,total:1094}));
 let snapshot=await state(owner);assert.equal(snapshot.leads.length,5);assert.equal(snapshot.leads[0].demo,false);let cfg=snapshot.sources.find(s=>s.id==='bouw').scraper;assert.equal(cfg.lastTestPassed,true);assert.equal(cfg.status,'test_passed');assert.equal(cfg.lastProcessed,5);assert.equal(cfg.lastTotal,1094);assert.equal(cfg.lastCounts.created,5);
 ok(await owner.action('source.scraper.schedule',{id:'bouw',enabled:true}));cfg=(await state(owner)).sources.find(s=>s.id==='bouw').scraper;assert.equal(cfg.scheduleEnabled,true);assert(Date.parse(cfg.nextRunAt)>Date.now()+23*3600000);
 ok(await owner.action('source.scraper.run',{id:'bouw'}));const full=ok(await worker(env,'claim')).job;assert.equal(full.mode,'full');assert.equal(full.limit,5000);
 assert.equal((await worker(env,`jobs/${full.id}/progress`,{leaseToken:full.leaseToken,processed:0,total:5001})).status,409,'A capped selection cannot be reported as a complete full import');
 ok(await worker(env,`jobs/${full.id}/fail`,{leaseToken:full.leaseToken,code:'login_required',message:LOGIN.password}));
 cfg=(await state(owner)).sources.find(s=>s.id==='bouw').scraper;assert.equal(cfg.status,'login_required');assert.equal(cfg.scheduleEnabled,false);assert(!cfg.lastError.includes(LOGIN.password));assert.equal(cfg.lastTestPassed,false);
 await env.restart();assert.equal((await state(owner)).leads.length,5);assert.equal((await state(owner)).sources.find(s=>s.id==='bouw').scraper.status,'login_required');
});

test('filter changes, import pause and disconnect cancel leases without deleting imported follow-up',async t=>{
 const env=await fixture();t.after(()=>env.close());const owner=await configure(env);let job=ok(await worker(env,'claim')).job;
 ok(await worker(env,`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items:[jobItem(1)]}));const lead=(await state(owner)).leads[0];ok(await owner.action('note.add',{leadId:lead.id,text:'Bestaande opvolging'}));
 ok(await owner.action('source.update',{id:'bouw',filterUrl:FILTER_B}));assert.equal((await worker(env,`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:1,items:[jobItem(2)]})).status,409);
 assert.equal((await state(owner)).sources.find(s=>s.id==='bouw').scraper.lastTestPassed,false);
 ok(await owner.action('source.scraper.test',{id:'bouw'}));job=ok(await worker(env,'claim')).job;ok(await owner.action('source.import.toggle',{id:'bouw',enabled:false}));assert.equal((await worker(env,`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:1,total:1})).status,409);
 ok(await owner.action('source.scraper.configure',{id:'bouw',...LOGIN}));job=ok(await worker(env,'claim')).job;ok(await owner.action('source.scraper.disconnect',{id:'bouw'}));
 assert.equal((await worker(env,`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items:[jobItem(2)]})).status,409);
 let snapshot=await state(owner);assert.equal(snapshot.leads.length,1);assert.equal(snapshot.workspaces['c-noord'][lead.id].notes.length,1);assert.equal(snapshot.sources.find(s=>s.id==='bouw').scraper.configured,false);
 const db=new DatabaseSync(path.join(env.dataDir,'dashboard.sqlite'));assert.equal(db.prepare('SELECT encrypted_login FROM scraper_sources WHERE source_id=?').get('bouw').encrypted_login,'');db.close();
});

test('missing worker secrets fail closed and never accept a browser or guessed worker key',async t=>{
 const env=await fixture({scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>env.close());const owner=env.client();ok(await owner.login());
 ok(await owner.action('source.update',{id:'bouw',filterUrl:FILTER_A}));assert.equal((await owner.action('source.scraper.configure',{id:'bouw',...LOGIN})).status,503);
 assert.equal((await worker(env,'claim')).status,503);assert.equal((await state(owner)).sources.find(s=>s.id==='bouw').scraper.available,false);
});

test('an expired job preserves partial counts, stops its schedule and requires a new proof',async t=>{
 const env=await fixture();t.after(()=>env.close());const owner=await configure(env);const proof=ok(await worker(env,'claim')).job;
 ok(await worker(env,`jobs/${proof.id}/progress`,{leaseToken:proof.leaseToken,processed:0,total:1}));ok(await worker(env,`jobs/${proof.id}/batch`,{leaseToken:proof.leaseToken,batch:0,items:[jobItem(1)]}));ok(await worker(env,`jobs/${proof.id}/finish`,{leaseToken:proof.leaseToken,processed:1,total:1}));
 ok(await owner.action('source.scraper.schedule',{id:'bouw',enabled:true}));ok(await owner.action('source.scraper.run',{id:'bouw'}));const full=ok(await worker(env,'claim')).job;
 ok(await worker(env,`jobs/${full.id}/progress`,{leaseToken:full.leaseToken,processed:0,total:20}));ok(await worker(env,`jobs/${full.id}/batch`,{leaseToken:full.leaseToken,batch:0,items:[jobItem(2)]}));
 assert.equal((await worker(env,`jobs/${full.id}/finish`,{leaseToken:full.leaseToken,processed:1,total:1})).status,400);
 const db=new DatabaseSync(path.join(env.dataDir,'dashboard.sqlite'));db.prepare('UPDATE scraper_jobs SET lease_until=? WHERE id=?').run(Date.now()-1,full.id);db.close();assert.equal(ok(await worker(env,'claim')).job,null);
 const snapshot=await state(owner),cfg=snapshot.sources.find(s=>s.id==='bouw').scraper;assert.equal(cfg.status,'error');assert.equal(cfg.lastTestPassed,false);assert.equal(cfg.scheduleEnabled,false);assert.equal(cfg.lastProcessed,1);assert.equal(cfg.lastTotal,20);assert.equal(cfg.lastCounts.created,1);assert.equal(snapshot.leads.length,2);
 assert.equal((await owner.action('source.scraper.run',{id:'bouw'})).status,409);assert.equal((await owner.action('source.scraper.schedule',{id:'bouw',enabled:true})).status,409);
});
