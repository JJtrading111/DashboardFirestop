import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://source-logbook.example.test',password='Source-logbook-test-password-2026!';
const workerToken='l'.repeat(43),sourcePassword='Only-a-fake-source-password!';
const sourceName='Bron <img src=x onerror="window.logbookInjected=1">';
const filterUrl='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';

test('the administrative source logbook works through the real API in Chrome', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run the logbook DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:'logbook-owner@example.test',adminName:'Testbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:Buffer.alloc(32,24).toString('base64url'),scraperWorkerToken:workerToken});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email:'logbook-owner@example.test',password}});assert.equal(login.status,200);
  const ownerCookie=login.headers['set-cookie'].split(';')[0],ownerHeaders={cookie:ownerCookie,'x-csrf-token':login.json().csrfToken};
  const action=async(type,payload)=>{const r=await dispatch('/api/action',{method:'POST',headers:ownerHeaders,body:{type,companyId:'c-noord',payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();};
  const worker=async(route,body={})=>{const r=await dispatch('/api/scraper/'+route,{method:'POST',headers:{authorization:'Bearer '+workerToken},body});assert.equal(r.status,200,r.bytes.toString());return r.json();};
  await action('source.update',{id:'bouw',name:sourceName,provider:'bouwberichten',filterUrl});
  await action('source.scraper.configure',{id:'bouw',username:'fake-source@example.test',password:sourcePassword});
  await action('source.scraper.schedule',{id:'bouw',enabled:false,time:'08:35'});
  const failedJob=(await worker('claim')).job;assert.equal(failedJob.mode,'test');
  await worker('jobs/'+failedJob.id+'/progress',{leaseToken:failedJob.leaseToken,processed:0,total:10});
  await worker('jobs/'+failedJob.id+'/batch',{leaseToken:failedJob.leaseToken,batch:0,items:[
   {externalId:'logbook-partial-1',title:'Gedeeltelijk opgehaald project 1'},
   {externalId:'logbook-partial-2',title:'Gedeeltelijk opgehaald project 2'}
  ]});
  await worker('jobs/'+failedJob.id+'/fail',{leaseToken:failedJob.leaseToken,code:'source_error',message:sourcePassword,
   diagnostic:{stage:'listing',reason:'total_changed',expectedTotal:10,observedTotal:11}});
  const snapshot=async()=>{const r=await dispatch('/api/state?companyId=c-noord',{headers:ownerHeaders});assert.equal(r.status,200);return r.json().state;};
  const partial=(await snapshot()).leads[0];await action('note.add',{leadId:partial.id,text:'Bewaarde opvolging bij gedeeltelijke import'});
  await action('workspace.update',{leadId:partial.id,field:'priority',value:'high'});
  const second=(await action('source.create',{name:'Tweede selectie',provider:'bouwberichten',filterUrl})).result.source;
  await action('source.scraper.configure',{id:second.id,username:'fake-second-source@example.test',password:sourcePassword});
  async function addLogin(role){const email='logbook-'+role+'@example.test';
   const invitation=(await action('invitation.create',{name:'Testgebruiker',email,companyId:'c-noord',role})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Testgebruiker',password}});assert.equal(activated.status,200);
   return{email,cookie:activated.headers['set-cookie'].split(';')[0]};
  }
  const cookie=role==='hoofdbeheerder'?ownerCookie:(await addLogin(role)).cookie;
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  const actions=[],requests=[],errors=[];let nextWrite=null,nextRead=null;
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.setInterval=()=>0;});
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   requests.push(url.pathname+url.search);const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   const retry=url.pathname==='/api/action'&&payload?.type==='source.scraper.retry';if(retry)actions.push(payload);
   const read=url.pathname==='/api/source-logbook',gate=retry?nextWrite:read?nextRead:null;if(gate){if(retry)nextWrite=null;else nextRead=null;}
   const response=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Opnieuw proberen is tijdelijk niet mogelijk'}))}:
    gate?.mode==='expired'?{status:401,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'De vorige sessie is verlopen'}))}:
    await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});gate?.finished();
  });
  const logbook=async()=>{const r=await dispatch('/api/source-logbook?status=all&limit=100',{headers:ownerHeaders});assert.equal(r.status,200);return r.json();};
  return{page,failedJob,second,partial,snapshot,logbook,dispatch,cookie,actions,requests,errors,addLogin,
   async open(){await page.goto(origin+'/#logbook');await page.locator('#main h1').waitFor({state:'visible'});},
   entry:job=>page.locator('.logbook-entry[data-logbook-job="'+job+'"]'),
   holdLogbook(mode='hold'){return this.gate(mode,true);},
   gate(mode='hold',read=false){let start,release,finished,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Logbook request did not reach the real backend')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finished=resolve);t.after(()=>{clearTimeout(timer);release();});
    const gate={mode,started:start,released,finished};if(read)nextRead=gate;else nextWrite=gate;return{started,release,done};}};
 }
 async function opened(t,options){const f=await fixture(t,options);await f.open();await f.entry(f.failedJob.id).waitFor({state:'visible'});return f;}
 const retryButton=f=>f.entry(f.failedJob.id).locator('[data-action="retry-source-import"]');
 async function showAll(f){await f.page.locator('[data-logbook-filter="status"]').selectOption('all');await f.entry(f.secondJobId??(await f.logbook()).entries.find(entry=>entry.sourceId===f.second.id).id).waitFor({state:'visible'});}
 function historic(entry){return Object.fromEntries(['id','sourceId','mode','status','queuedAt','startedAt','finishedAt','processed','total','counts','error'].map(key=>[key,entry[key]]));}

 await t.test('only the owner sees the administration entry and safe human-readable failed import details',async t=>{
  const f=await opened(t),entries=(await f.logbook()).entries,failed=entries.find(entry=>entry.id===f.failedJob.id),row=f.entry(failed.id);
  assert.equal(await f.page.locator('.nav-group [data-route="logbook"]').count(),1);
  assert.equal(await f.page.locator('#main h1').textContent(),'Logboek');
  assert.equal(failed.status,'failed');assert.equal(failed.processed,2);assert.equal(failed.total,10);assert.equal(failed.counts.created,2);
  assert.equal(failed.error.reason,'total_changed');assert.ok(failed.error.message&&failed.error.advice);
  const text=await row.innerText();assert.ok(text.includes(sourceName));assert.ok(text.includes(failed.error.message));assert.ok(text.includes(failed.error.advice));
  assert.match(text,/2\s*(?:van|\/)\s*10/);
  assert.equal(await row.locator('img').count(),0);assert.equal(await f.page.evaluate(()=>window.logbookInjected),undefined);
  const visible=await f.page.locator('body').innerText();assert.equal(visible.includes(sourcePassword),false);assert.equal(visible.includes(workerToken),false);
  assert.equal((await f.dispatch('/api/source-logbook')).status,401);
  await showAll(f);assert.equal(await f.page.locator('.logbook-entry').count(),2);
  await f.page.locator('[data-logbook-filter="source"]').selectOption(f.second.id);
  await f.page.waitForFunction(()=>document.querySelectorAll('.logbook-entry').length===1);
  assert.ok((await f.page.locator('.logbook-entry').innerText()).includes('Tweede selectie'));
  await f.page.locator('[data-logbook-filter="status"]').selectOption('failed');
  await f.page.waitForFunction(()=>document.querySelectorAll('.logbook-entry').length===0);
  await f.page.locator('[data-logbook-filter="source"]').selectOption('bouw');await row.waitFor({state:'visible'});
  assert.ok(f.requests.some(path=>{if(!path.startsWith('/api/source-logbook?'))return false;const query=new URL(path,origin).searchParams;return query.get('sourceId')==='bouw'&&query.get('status')==='failed';}));
  assert.deepEqual(f.errors,[]);
 });
 await t.test('a retry disables duplicate clicks and retains the original failure, partial leads, notes and daily settings',async t=>{
  const f=await opened(t),before=await f.snapshot(),failedBefore=(await f.logbook()).entries.find(entry=>entry.id===f.failedJob.id),gate=f.gate();
  await retryButton(f).click();await gate.started;assert.equal(await retryButton(f).isDisabled(),true);
  await retryButton(f).evaluate(button=>{button.click();button.click();});assert.equal(f.actions.length,1);
  const pending=(await f.logbook()).entries,queued=pending.find(entry=>entry.retryOf===f.failedJob.id);assert.ok(queued);assert.equal(queued.status,'queued');
  gate.release();await f.entry(queued.id).waitFor({state:'visible'});await f.entry(f.failedJob.id).waitFor({state:'visible'});
  assert.equal(await f.page.locator('[data-logbook-filter="status"]').inputValue(),'all');
  const after=await f.snapshot(),failedAfter=(await f.logbook()).entries.find(entry=>entry.id===f.failedJob.id);
  assert.deepEqual(historic(failedAfter),historic(failedBefore));assert.deepEqual(after.leads,before.leads);
  assert.deepEqual(after.workspaces['c-noord'][f.partial.id],before.workspaces['c-noord'][f.partial.id]);
  const clock=state=>{const s=state.sources.find(source=>source.id==='bouw').scraper;return{s:s.scheduleEnabled,time:s.scheduleTime,next:s.nextRunAt};};assert.deepEqual(clock(after),clock(before));
  assert.equal(f.actions.length,1);assert.equal(f.actions[0].payload.id,'bouw');assert.equal(f.actions[0].payload.jobId,f.failedJob.id);assert.deepEqual(f.errors,[]);
 });
 await t.test('an unsuccessful retry keeps the error visible and can be submitted again safely',async t=>{
  const f=await opened(t),before=await f.logbook(),gate=f.gate('reject');await retryButton(f).click();await gate.started;
  assert.equal(await retryButton(f).isDisabled(),true);gate.release();
  await f.page.locator('[data-logbook-page-error]').waitFor({state:'visible'});
  assert.match(await f.page.locator('[data-logbook-page-error]').innerText(),/Opnieuw proberen is tijdelijk niet mogelijk/);
  await f.page.waitForFunction(()=>!document.querySelector('[data-action="retry-source-import"]')?.disabled);
  assert.equal((await f.logbook()).total,before.total);assert.equal(await f.entry(f.failedJob.id).isVisible(),true);
  await retryButton(f).click();await f.page.waitForFunction(()=>document.querySelectorAll('.logbook-entry').length>=3);
  const queued=(await f.logbook()).entries.find(entry=>entry.retryOf===f.failedJob.id);assert.ok(queued);await f.entry(queued.id).waitFor({state:'visible'});
  assert.equal(f.actions.length,2);assert.deepEqual(f.errors,[]);
 });
 await t.test('late filter responses cannot replace a newer selection or disturb typing after leaving the logbook',async t=>{
  const f=await opened(t),old=f.holdLogbook();
  await f.page.locator('[data-logbook-filter="status"]').selectOption('all');await old.started;
  await f.page.locator('[data-logbook-filter="status"]').selectOption('queued');
  const queued=(await f.logbook()).entries.find(entry=>entry.sourceId===f.second.id);await f.entry(queued.id).waitFor({state:'visible'});
  old.release();await old.done;await f.page.waitForTimeout(50);
  assert.equal(await f.page.locator('[data-logbook-filter="status"]').inputValue(),'queued');
  assert.equal(await f.page.locator('.logbook-entry').count(),1);assert.equal(await f.entry(f.failedJob.id).count(),0);
  const late=f.holdLogbook();await f.page.locator('[data-action="refresh-source-logbook"]').click();await late.started;
  await f.page.locator('.nav-group [data-route="leads"]').click();const search=f.page.locator('#lead-search');await search.fill('Gedeeltelijk');
  await search.evaluate(input=>{window.__logbookSearch=input;input.focus();input.setSelectionRange(3,7,'forward');});
  late.release();await late.done;await f.page.waitForTimeout(240);
  const current=await search.evaluate(input=>({same:input===window.__logbookSearch,value:input.value,focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd}));
  assert.deepEqual(current,{same:true,value:'Gedeeltelijk',focused:true,start:3,end:7});assert.deepEqual(f.errors,[]);
 });
 await t.test('a pending logbook response preserves an open source popup and its unfinished login fields',async t=>{
  const f=await opened(t),late=f.holdLogbook();await f.page.locator('[data-action="refresh-source-logbook"]').click();await late.started;
  await f.entry(f.failedJob.id).locator('[data-action="source-scraper"]').click();await f.page.locator('#source-scraper-form').waitFor({state:'visible'});
  await f.page.locator('#scraper-username').fill('unsubmitted@example.test');await f.page.locator('#scraper-password').fill('Unsubmitted-test-only-password');
  await f.page.locator('#scraper-password').evaluate(input=>{input.focus();input.setSelectionRange(4,12,'forward');const form=input.closest('form'),modal=form.closest('.modal'),body=modal.querySelector('.modal-body');body.scrollTop=177;window.__logbookDraft={input,form,modal,scroll:body.scrollTop};});
  late.release();await late.done;await f.page.waitForTimeout(80);
  const current=await f.page.locator('#scraper-password').evaluate(input=>({same:input===window.__logbookDraft.input,form:input.closest('form')===window.__logbookDraft.form,
   modal:input.closest('.modal')===window.__logbookDraft.modal,value:input.value,username:document.querySelector('#scraper-username').value,focused:document.activeElement===input,
   start:input.selectionStart,end:input.selectionEnd,scroll:input.closest('.modal').querySelector('.modal-body').scrollTop,expectedScroll:window.__logbookDraft.scroll}));
  assert.deepEqual(current,{same:true,form:true,modal:true,value:'Unsubmitted-test-only-password',username:'unsubmitted@example.test',focused:true,start:4,end:12,scroll:current.expectedScroll,expectedScroll:current.expectedScroll});
  assert.deepEqual(f.errors,[]);
 });
 for(const expired of [false,true])await t.test('an old administrative '+(expired?'401':'200')+' response cannot affect a replacement seller session',async t=>{
  const f=await opened(t),seller=await f.addLogin('verkoper'),late=f.holdLogbook(expired?'expired':'hold');
  await f.page.locator('[data-action="refresh-source-logbook"]').click();await late.started;
  await f.page.locator('[data-action="account"]').first().click();await f.page.locator('.modal [data-action="logout"]').click();
  await f.page.locator('#login-form').waitFor({state:'visible'});
  await f.page.locator('#login-form input[name="email"]').fill(seller.email);await f.page.locator('#auth-password').fill(password);
  await f.page.locator('#login-form button[type="submit"]').click();await f.page.locator('.profile-button').waitFor({state:'visible'});
  late.release();await late.done;await f.page.waitForTimeout(80);
  assert.equal(await f.page.locator('.nav-group [data-route="logbook"]').count(),0);assert.equal(await f.page.locator('.logbook-entry').count(),0);
  assert.equal(await f.page.locator('#login-form').count(),0,'An older response must not sign out the replacement session');
  assert.equal(await f.page.locator('.profile-button').innerText().then(value=>value.includes('verkoper')),true);assert.deepEqual(f.errors,[]);
 });
 await t.test('an acknowledged administrative retry cannot install owner state after session expiry and seller login',async t=>{
  const f=await opened(t),seller=await f.addLogin('verkoper'),write=f.gate();
  await retryButton(f).click();await write.started;assert.equal(f.actions.length,1);
  const expired=f.holdLogbook('expired');await f.page.locator('[data-logbook-filter="status"]').selectOption('all');await expired.started;expired.release();await expired.done;
  await f.page.locator('#login-form').waitFor({state:'visible'});
  await f.page.locator('#login-form input[name="email"]').fill(seller.email);await f.page.locator('#auth-password').fill(password);
  await f.page.locator('#login-form button[type="submit"]').click();await f.page.locator('.profile-button').waitFor({state:'visible'});
  write.release();await write.done;await f.page.waitForTimeout(100);
  assert.equal(await f.page.locator('.profile-button').innerText().then(value=>value.includes('verkoper')),true);
  assert.equal(await f.page.locator('.nav-group [data-route="logbook"]').count(),0);assert.equal(await f.page.locator('.logbook-entry').count(),0);
  assert.equal(await f.page.locator('#login-form').count(),0);assert.equal(f.actions.length,1);assert.deepEqual(f.errors,[]);
 });
 for(const role of ['bedrijfsbeheerder','verkoper'])await t.test(role+' cannot see the menu or obtain source logs through the API',async t=>{
  const f=await fixture(t,{role});await f.open();
  assert.equal(await f.page.locator('.nav-group [data-route="logbook"]').count(),0);
  assert.equal(await f.page.locator('.logbook-entry').count(),0);
  assert.equal((await f.dispatch('/api/source-logbook',{headers:{cookie:f.cookie}})).status,403);
  assert.equal((await f.page.locator('#main').innerText()).includes(sourcePassword),false);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': logbook cards and retry actions fit the viewport',async t=>{
  const f=await opened(t,{mobile});await showAll(f);
  const viewport=f.page.viewportSize();
  for(const entry of await f.page.locator('.logbook-entry').all()){
   const box=await entry.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=viewport.width+1,'Logbook cards must not overflow horizontally');
  }
  const button=retryButton(f),box=await button.boundingBox();assert.ok(box&&box.height>=44&&box.x>=0&&box.x+box.width<=viewport.width+1);
  if(process.env.SOURCE_LOGBOOK_SCREENSHOTS==='1'){
   await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/logbook-preview-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:false});
  }
  assert.deepEqual(f.errors,[]);
 });
});
