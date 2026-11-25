import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(value=>value&&existsSync(value));
const origin='https://company-management.example.test',email='company-owner@example.test',password='Company-management-password-2026!';

test('chief company management, deletion safeguards and persistent logo branding work in Chrome',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium to run company management checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:email,adminName:'Hoofdbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':login.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',actorHeaders=headers){const r=await dispatch('/api/action',{method:'POST',headers:actorHeaders,body:{type,companyId,payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();}
  await action('company.update',{companyId:'c-noord',name:'Noord Projectbouw'});
  const empty=(await action('company.create',{name:'Leeg Testbedrijf'})).result.company;
  async function member(name,memberEmail,companyId,memberRole='verkoper'){
   const invitation=(await action('invitation.create',{name,email:memberEmail,companyId,role:memberRole})).result;
   const r=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}});assert.equal(r.status,200);
   return{user:r.json().user,cookie:r.headers['set-cookie'].split(';')[0],headers:{cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrfToken}};
  }
  let current={user:login.json().user,cookie,headers};if(role!=='hoofdbeheerder')current=await member(role==='verkoper'?'Verkoper Noord':'Beheerder Noord',role+'@example.test','c-noord',role);
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>context.close());
  await context.addInitScript(()=>{window.__companyTimers=[];window.setInterval=(callback,ms,...args)=>{window.__companyTimers.push({callback:()=>callback(...args),ms});return window.__companyTimers.length;};});
  await context.addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();requests.push({path:url.pathname,method:request.method(),body:request.postData()});const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});});
  await page.goto(origin+'/#team');await page.locator('.company-grid').waitFor({state:'visible'});
  return{page,context,action,dispatch,member,current,empty,errors,requests,headers,card:id=>page.locator('[data-company-card="'+id+'"]')};
 }
 const remove=(f,id)=>f.card(id).locator('[data-action="delete-company"]');
 async function confirm(f,id){await remove(f,id).click();await f.page.locator('[data-action="confirm-delete-company"]').click();await f.card(id).waitFor({state:'detached'});}
 async function imageLoaded(page,selector){await page.locator(selector).waitFor({state:'attached'});await page.waitForFunction(selector=>{const image=document.querySelector(selector);return image?.complete&&image.naturalWidth>0;},selector);}

 await t.test('only companies without any assigned users can be removed and cancel makes no change',async t=>{
  const f=await fixture(t);assert.equal(await remove(f,'c-noord').isDisabled(),true);assert.equal(await remove(f,f.empty.id).isEnabled(),true);
  assert.match(await f.card('c-noord').innerText(),/alle gebruikers aan een ander bedrijf/);
  await remove(f,f.empty.id).click();assert.match(await f.page.locator('.modal').innerText(),/Leeg Testbedrijf/);assert.match(await f.page.locator('.modal').innerText(),/Eerdere telefoontjes, notities en resultaten blijven bewaard/);
  await f.page.locator('.modal [data-action="close-modal"]').filter({hasText:'Annuleren'}).click();assert.equal(await f.card(f.empty.id).count(),1);
  assert.equal(f.requests.some(request=>request.body?.includes('company.delete')),false);assert.deepEqual(f.errors,[]);
 });
 await t.test('confirmed deletion removes the active empty company, falls back safely and revokes its pending invitation',async t=>{
  const f=await fixture(t);const invitation=(await f.action('invitation.create',{name:'Later Activeren',email:'pending@example.test',companyId:f.empty.id,role:'verkoper'})).result;
  await f.card(f.empty.id).locator('[data-action="switch-company"]').click();await f.page.reload();await f.card(f.empty.id).waitFor({state:'visible'});
  await remove(f,f.empty.id).click();assert.match(await f.page.locator('.modal').innerText(),/1 openstaande uitnodigingslink wordt ingetrokken/);await f.page.locator('[data-action="confirm-delete-company"]').click();await f.card(f.empty.id).waitFor({state:'detached'});
  assert.equal(await f.page.locator('#company-switch').inputValue(),'c-noord');assert.equal(await f.page.locator('#company-switch option[value="'+f.empty.id+'"]').count(),0);
  const preview=await f.dispatch('/api/invitations/preview',{method:'POST',body:{token:invitation.token}});assert.notEqual(preview.status,200);
  await f.page.locator('[data-route="reports"]').first().click();assert.match(await f.page.locator('[data-call-report-filter="company"] option[value="'+f.empty.id+'"]').innerText(),/verwijderd/);
  await f.page.locator('[data-action="report-view"][data-value="conversion"]').click();assert.match(await f.page.locator('[data-field="reportCompany"] option[value="'+f.empty.id+'"]').innerText(),/verwijderd/);assert.deepEqual(f.errors,[]);
 });
 await t.test('a newly assigned user prevents deletion from an already open confirmation',async t=>{
  const f=await fixture(t);await remove(f,f.empty.id).click();await f.member('Nieuwe Collega','fresh@example.test',f.empty.id);
  await f.page.locator('[data-action="confirm-delete-company"]').click();await f.page.locator('.toast').filter({hasText:'Dit bedrijf heeft nog gebruikers'}).waitFor({state:'visible'});
  assert.equal(await f.card(f.empty.id).count(),1);assert.equal(await f.page.locator('[data-action="confirm-delete-company"]').isEnabled(),true);assert.deepEqual(f.errors,[]);
 });
 await t.test('a company removed by another chief recovers from saved preferences and an open company editor',async t=>{
  const f=await fixture(t);await f.card(f.empty.id).locator('[data-action="switch-company"]').click();await f.page.waitForFunction(id=>document.querySelector('#company-switch')?.value===id,f.empty.id);
  await f.card(f.empty.id).locator('[data-logo-shortcut]').click();await f.action('company.delete',{companyId:f.empty.id,confirmed:true});
  await f.page.evaluate(async()=>{await window.__companyTimers.find(timer=>timer.ms===30000).callback();});await f.page.locator('#company-edit-form').waitFor({state:'detached'});assert.equal(await f.page.locator('#company-switch').inputValue(),'c-noord');
  await f.page.evaluate(id=>localStorage.setItem('bouwberichten-live-preferences-v1',JSON.stringify({companyId:id})),f.empty.id);await f.page.reload();await f.page.locator('.company-grid').waitFor({state:'visible'});assert.equal(await f.page.locator('#login-form').count(),0);assert.equal(await f.page.locator('#company-switch').inputValue(),'c-noord');assert.deepEqual(f.errors,[]);
 });
 await t.test('a logo uploaded from the company card loads in the top-left brand after switching and signing in again',async t=>{
  const f=await fixture(t);await f.card('c-noord').locator('[data-logo-shortcut]').click();
  const png=await f.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=120;canvas.height=60;const context=canvas.getContext('2d');context.fillStyle='#086453';context.fillRect(0,0,120,60);context.fillStyle='#fff';context.font='bold 24px sans-serif';context.fillText('NOORD',10,40);return canvas.toDataURL('image/png').split(',')[1];});
  await f.page.locator('[data-company-logo]').setInputFiles({name:'noord-logo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await f.page.locator('#company-edit-form [type="submit"]').waitFor({state:'visible'});await f.page.waitForFunction(()=>!document.querySelector('#company-edit-form [type=submit]')?.disabled);
  await f.page.locator('#company-edit-form [type="submit"]').click();await f.page.locator('#company-edit-form').waitFor({state:'detached'});await imageLoaded(f.page,'.sidebar .dashboard-company-logo');
  const src=await f.page.locator('.sidebar .dashboard-company-logo').getAttribute('src');assert.match(src,/^\/api\/company-logos\/c-noord/);assert.match(await f.card('c-noord').locator('[data-logo-shortcut]').innerText(),/Logo wijzigen/);
  await f.card(f.empty.id).locator('[data-action="switch-company"]').click();await f.page.waitForFunction(()=>!document.querySelector('.sidebar .dashboard-company-logo'));assert.equal(await f.page.locator('.sidebar .dashboard-company-logo').count(),0);
  await f.card('c-noord').locator('[data-action="switch-company"]').click();await imageLoaded(f.page,'.sidebar .dashboard-company-logo');assert.equal(await f.page.locator('.sidebar .dashboard-company-logo').getAttribute('src'),src);
  await f.context.clearCookies();await f.page.reload();await f.page.locator('#login-form').waitFor({state:'visible'});await f.page.locator('#login-form [name="email"]').fill(email);await f.page.locator('#login-form [name="password"]').fill(password);await f.page.locator('#login-form [type="submit"]').click();await imageLoaded(f.page,'.sidebar .dashboard-company-logo');assert.equal(await f.page.locator('.sidebar .dashboard-company-logo').getAttribute('src'),src);
  await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/company-management-desktop.png',import.meta.url)),fullPage:true});assert.deepEqual(f.errors,[]);
 });
 for(const role of ['bedrijfsbeheerder','verkoper'])await t.test(role+' has no company removal action',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('[data-action="delete-company"]').count(),0);assert.equal(await f.page.locator('[data-logo-shortcut]').count(),role==='bedrijfsbeheerder'?1:0);assert.deepEqual(f.errors,[]);
 });
 await t.test('the chief can remove the last empty company and create a new company without a broken page',async t=>{
  const f=await fixture(t);await f.action('user.update',{userId:f.current.user.id,role:'hoofdbeheerder',companyId:null});await f.page.reload();await f.page.locator('[data-company-card]').first().waitFor({state:'visible'});
  const ids=await f.page.locator('[data-company-card]').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-company-card')));for(const id of ids)await confirm(f,id);
  await f.page.locator('.company-grid').filter({hasText:'Nog geen bedrijven'}).waitFor({state:'visible'});assert.match(await f.page.locator('.sidebar .brand').innerText(),/Hoofdbeheer/);
  await f.page.goto(origin+'/#dashboard');await f.page.locator('[data-admin-attention-section]').waitFor({state:'visible'});
  await f.page.goto(origin+'/#leads');assert.match(await f.page.locator('#main').innerText(),/Voeg een bedrijf toe/);
  await f.page.locator('[data-action="new-company"]').click();await f.page.locator('#company-form [name="name"]').fill('Nieuwe werkplek');await f.page.locator('#company-form [type="submit"]').click();await f.page.locator('#company-form').waitFor({state:'detached'});assert.equal(await f.page.locator('#company-switch option').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('mobile company controls and logo editor fit the viewport',async t=>{
  const f=await fixture(t,{mobile:true});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  async function controlsFit(){return f.page.locator('.company-card-actions').evaluateAll(groups=>groups.every(group=>{const area=group.getBoundingClientRect(),buttons=[...group.querySelectorAll('button')];return buttons.every(button=>{const box=button.getBoundingClientRect();return box.left>=area.left-1&&box.right<=area.right+1&&button.scrollWidth<=button.clientWidth+1;})&&buttons.every((a,index)=>buttons.slice(index+1).every(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.right<=y.left||x.left>=y.right||x.bottom<=y.top||x.top>=y.bottom;}));}));}assert.equal(await controlsFit(),true);
  await f.card('c-noord').locator('[data-logo-shortcut]').click();assert.equal(await f.page.evaluate(()=>{const modal=document.querySelector('.modal').getBoundingClientRect();return modal.left>=0&&modal.right<=innerWidth&&modal.top>=0&&modal.bottom<=innerHeight;}),true);
  const png=await f.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const context=canvas.getContext('2d');context.fillStyle='#086453';context.fillRect(0,0,80,40);return canvas.toDataURL('image/png').split(',')[1];});await f.page.locator('[data-company-logo]').setInputFiles({name:'mobile-logo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await f.page.waitForFunction(()=>!document.querySelector('#company-edit-form [type=submit]')?.disabled);await f.page.locator('#company-edit-form [type="submit"]').click();await f.page.locator('#company-edit-form').waitFor({state:'detached'});await imageLoaded(f.page,'.topbar>.mobile-company-logo');assert.equal(await f.page.locator('.topbar>.mobile-company-logo').isVisible(),true);assert.equal(await f.page.evaluate(()=>{const logo=document.querySelector('.topbar>.mobile-company-logo').getBoundingClientRect();return logo.x<100&&logo.y<70&&document.documentElement.scrollWidth<=innerWidth;}),true);
  assert.equal(await controlsFit(),true);for(const close of await f.page.locator('.toast-close').all())await close.click();await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/company-management-mobile.png',import.meta.url)),fullPage:true});assert.deepEqual(f.errors,[]);
 });
});
