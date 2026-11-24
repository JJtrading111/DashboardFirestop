import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://scraper-schedule.example.test',email='schedule-owner@example.test',password='Schedule-browser-test-password-2026!';
const workerToken='schedule-ui-test-worker-key-'.repeat(2);
const filterUrl='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const timeSelector='[data-scraper-time]',saveSelector='[data-action="save-source-scraper-time"]',scheduleSelector='[data-scraper-schedule]';

test('source daily-fetch time works through the real browser and backend without disturbing an open login draft', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run the scheduling DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder'}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:email,adminName:'Testbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:Buffer.alloc(32,15).toString('base64url'),scraperWorkerToken:workerToken});
  t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{
    url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,values={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(values))this.setHeader(name,value);},
    end(value){this.body=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.body,json:()=>JSON.parse(res.body.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const adminHeaders={cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
  const action=async(type,payload)=>{const response=await dispatch('/api/action',{method:'POST',headers:adminHeaders,body:{type,companyId:'c-noord',payload}});assert.equal(response.status,200,response.bytes.toString());return response.json();};
  const worker=async(route,body={})=>{const response=await dispatch('/api/scraper/'+route,{method:'POST',headers:{authorization:'Bearer '+workerToken},body});assert.equal(response.status,200,response.bytes.toString());return response.json();};
  await action('source.update',{id:'bouw',filterUrl});
  const second=(await action('source.create',{name:'Bouwselectie B',provider:'bouwberichten',filterUrl})).result.source.id;
  for(const id of ['bouw',second]){
   await action('source.scraper.configure',{id,username:'synthetic-source@example.test',password:'Only-a-synthetic-source-password!'});
   const {job}=await worker('claim');assert.equal(job.sourceId,id);
   await worker(`jobs/${job.id}/progress`,{leaseToken:job.leaseToken,processed:0,total:1});
   await worker(`jobs/${job.id}/batch`,{leaseToken:job.leaseToken,batch:0,items:[{externalId:'proof-'+id,title:'Proefproject voor '+id}]});
   await worker(`jobs/${job.id}/finish`,{leaseToken:job.leaseToken,processed:1,total:1});
  }
  await action('source.scraper.schedule',{id:'bouw',enabled:false,time:'06:10'});
  await action('source.scraper.schedule',{id:second,enabled:false,time:'17:40'});
  let browserLogin=login;
  if(role!=='hoofdbeheerder'){
   const invitation=(await action('invitation.create',{name:'Testgebruiker',email:role+'@example.test',companyId:'c-noord',role})).result;
   browserLogin=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Testgebruiker',password}});assert.equal(browserLogin.status,200);
  }
  const cookie=browserLogin.headers['set-cookie'].split(';')[0],page=await browser.newPage({locale:'nl-NL'});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await page.addInitScript(()=>{window.__scheduleIntervals=[];window.setInterval=(callback,ms,...args)=>{window.__scheduleIntervals.push({ms,callback:()=>callback(...args)});return window.__scheduleIntervals.length;};});
  const actions=[],errors=[];let heldState=null,rejectSchedule=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   if(url.pathname==='/api/action')actions.push(payload);
   if(rejectSchedule&&payload?.type==='source.scraper.schedule'){rejectSchedule=false;return intercepted.fulfill({status:503,json:{error:'Tijdstip kon tijdelijk niet worden opgeslagen'}});}
   const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(url.pathname==='/api/state'&&heldState){const pending=heldState;heldState=null;pending.started();await pending.released;}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#sources');await page.locator('#main').waitFor({state:'visible'});
  const sourceSummary=async id=>{const response=await dispatch('/api/state?companyId=c-noord',{headers:adminHeaders});assert.equal(response.status,200);return response.json().state.sources.find(source=>source.id===id).scraper;};
  const open=async(id='bouw')=>{await page.locator('[data-action="source-scraper"][data-id="'+id+'"]').click();await page.locator('.modal[data-scraper-source-id="'+id+'"]').waitFor({state:'visible'});};
  const poll=ms=>page.evaluate(ms=>window.__scheduleIntervals.find(interval=>interval.ms===ms).callback(),ms);
  return{page,second,actions,errors,open,poll,action,sourceSummary,dispatch,
   get browserHeaders(){return{cookie,'x-csrf-token':browserLogin.json().csrfToken};},
   rejectNextSchedule(){rejectSchedule=true;},
   holdNextState(){let start,release,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Polling request did not arrive')),5000);start=()=>{clearTimeout(timer);resolve();};});const released=new Promise(resolve=>release=resolve);t.after(()=>{clearTimeout(timer);release();});heldState={started:start,released};return{started,release};}};
 }
 const scheduleActions=f=>f.actions.filter(action=>action.type==='source.scraper.schedule');
 async function saveTime(f){const received=f.page.waitForResponse(response=>response.url().endsWith('/api/action')&&response.request().postDataJSON()?.type==='source.scraper.schedule');await f.page.locator(saveSelector).click();const response=await received;await f.page.waitForFunction(()=>document.querySelector('.modal[data-scraper-source-id]')?.getAttribute('aria-busy')!=='true');return response;}
 async function close(f){await f.page.locator('.modal .modal-footer').getByRole('button',{name:'Sluiten',exact:true}).click();await f.page.locator('.modal').waitFor({state:'hidden'});}
 async function rememberNodes(f){await f.page.evaluate(()=>{window.__scheduleOriginal={modal:document.querySelector('.modal'),time:document.querySelector('[data-scraper-time]'),username:document.querySelector('#scraper-username'),password:document.querySelector('#scraper-password')};});}
 async function preserved(f,time,{focused='time'}={}){
  const actual=await f.page.evaluate(()=>{const previous=window.__scheduleOriginal,time=document.querySelector('[data-scraper-time]'),username=document.querySelector('#scraper-username'),password=document.querySelector('#scraper-password');return{
   sameModal:previous.modal===document.querySelector('.modal'),sameTime:previous.time===time,sameUser:previous.username===username,samePassword:previous.password===password,
   time:time.value,username:username.value,password:password.value,type:password.type,start:password.selectionStart,end:password.selectionEnd,direction:password.selectionDirection,
   focusedTime:document.activeElement===time,focusedPassword:document.activeElement===password};});
  for(const key of ['sameModal','sameTime','sameUser','samePassword'])assert.equal(actual[key],true,key+' must not be replaced');
  assert.equal(actual.time,time);assert.equal(actual.username,'edited-source@example.test');assert.equal(actual.password,'unsubmitted-synthetic-password');assert.equal(actual.type,'text');
  if(focused==='time')assert.equal(actual.focusedTime,true);if(focused==='password'){assert.equal(actual.focusedPassword,true);assert.deepEqual([actual.start,actual.end,actual.direction],[4,12,'backward']);}
 }
 await t.test('focused and dirty time plus login drafts survive delayed ten/thirty-second polling and persistent save errors',async t=>{
  const f=await fixture(t);await f.open();const {page}=f;await rememberNodes(f);
  assert.match(await page.locator('.modal').textContent(),/Tijdstip \(Nederlandse tijd\)/);
  assert.equal(await page.locator(timeSelector).evaluate(input=>!!(document.querySelector('[data-scraper-schedule]').compareDocumentPosition(input)&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  await page.locator('#scraper-username').fill('edited-source@example.test');await page.locator('#scraper-password').fill('unsubmitted-synthetic-password');
  await page.locator('[data-action="toggle-password"][aria-controls="scraper-password"]').click();
  await page.locator(timeSelector).focus();await f.action('source.scraper.schedule',{id:'bouw',enabled:false,time:'09:50'});await f.poll(10000);
  await preserved(f,'06:10');
  const held=f.holdNextState();await page.evaluate(()=>{window.__pendingSchedulePoll=window.__scheduleIntervals.find(interval=>interval.ms===10000).callback();});await held.started;
  await page.locator(timeSelector).fill('07:45');await page.locator(timeSelector).focus();held.release();await page.evaluate(()=>window.__pendingSchedulePoll);await preserved(f,'07:45');
  await f.action('source.scraper.schedule',{id:'bouw',enabled:false,time:'11:15'});await f.poll(10000);await preserved(f,'07:45');
  await page.locator('#scraper-password').focus();await page.locator('#scraper-password').evaluate(input=>input.setSelectionRange(4,12,'backward'));
  await f.poll(30000);await preserved(f,'07:45',{focused:'password'});
  f.rejectNextSchedule();assert.equal((await saveTime(f)).status(),503);
  await page.locator('[data-scraper-schedule-error]').waitFor({state:'visible'});
  await f.poll(10000);await f.poll(30000);await preserved(f,'07:45',{focused:null});
  assert.equal(await page.locator('[data-scraper-schedule-error]').textContent(),'Tijdstip kon tijdelijk niet worden opgeslagen');
  assert.equal((await saveTime(f)).status(),200);
  await preserved(f,'07:45',{focused:null});
  const saved=await f.sourceSummary('bouw');assert.equal(saved.scheduleTime,'07:45');assert.equal(saved.scheduleTimeZone,'Europe/Amsterdam');assert.equal(saved.scheduleEnabled,false);assert.equal(saved.nextRunAt,null);
  assert.equal(await page.locator(scheduleSelector).isChecked(),false);assert.equal(await page.locator('[data-scraper-schedule-error]').isVisible(),false);assert.deepEqual(f.errors,[]);
 });
 await t.test('enabling uses the unsaved time and each source reopens with its own persisted setting',async t=>{
  const f=await fixture(t);await f.open();await f.page.locator(timeSelector).fill('18:20');
  const enabled=f.page.waitForResponse(response=>response.url().endsWith('/api/action')&&response.request().postDataJSON()?.type==='source.scraper.schedule');
  await f.page.locator(scheduleSelector).check();assert.equal((await enabled).status(),200);
  await f.page.waitForFunction(()=>document.querySelector('.modal')?.getAttribute('aria-busy')!=='true');
  assert.deepEqual(scheduleActions(f).at(-1).payload,{id:'bouw',enabled:true,time:'18:20'});
  assert.equal((await f.sourceSummary('bouw')).scheduleTime,'18:20');assert.equal((await f.sourceSummary('bouw')).scheduleEnabled,true);
  await close(f);await f.open(f.second);assert.equal(await f.page.locator(timeSelector).inputValue(),'17:40');assert.equal(await f.page.locator(scheduleSelector).isChecked(),false);
  await f.page.locator(timeSelector).fill('05:55');await close(f);await f.open();assert.equal(await f.page.locator(timeSelector).inputValue(),'18:20');
  await close(f);await f.open(f.second);assert.equal(await f.page.locator(timeSelector).inputValue(),'17:40');assert.deepEqual(f.errors,[]);
 });
 await t.test('invalid times never send a save request and cannot prevent pausing a daily schedule',async t=>{
  const f=await fixture(t);await f.action('source.scraper.schedule',{id:'bouw',enabled:true,time:'06:10'});await f.poll(30000);await f.open();
  for(const value of ['', '25:99','7:30','09:07:30']){
   const before=scheduleActions(f).length;
   await f.page.locator(timeSelector).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new InputEvent('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
   await f.page.locator(saveSelector).evaluate(button=>button.click());await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(scheduleActions(f).length,before,'Invalid HH:mm must be rejected before sending');
  }
  const response=f.page.waitForResponse(response=>response.url().endsWith('/api/action')&&response.request().postDataJSON()?.type==='source.scraper.schedule');
  await f.page.locator(scheduleSelector).uncheck();assert.equal((await response).status(),200);
  assert.deepEqual(scheduleActions(f).at(-1).payload,{id:'bouw',enabled:false});
  assert.equal((await f.sourceSummary('bouw')).scheduleEnabled,false);assert.equal((await f.sourceSummary('bouw')).scheduleTime,'06:10');
  assert.equal(await f.page.locator(timeSelector).inputValue(),'09:07:30');assert.deepEqual(f.errors,[]);
 });
 for(const role of ['bedrijfsbeheerder','verkoper'])await t.test(role+' cannot access or alter a source daily-fetch time',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('[data-action="source-scraper"]').count(),0);assert.equal(await f.page.locator(timeSelector).count(),0);
  const denied=await f.dispatch('/api/action',{method:'POST',headers:f.browserHeaders,body:{type:'source.scraper.schedule',companyId:'c-noord',payload:{id:'bouw',enabled:true,time:'12:30'}}});
  assert.equal(denied.status,403);assert.equal((await f.sourceSummary('bouw')).scheduleTime,'06:10');assert.deepEqual(f.errors,[]);
 });
});
