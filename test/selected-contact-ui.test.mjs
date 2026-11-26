import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(path=>path&&existsSync(path));
const origin='https://selected-contact-ui.example.test',password='Selected-contact-ui-password-2026!';
const parties=[{name:'Woonstichting Zuid',role:'Opdrachtgever',phone:'0180-494949',email:'contact+project@example.test',website:'https://woonstichting.example.test/'},{name:'Architect Tweede',role:'Architect',phone:'010-2012360',email:'architect@example.test',website:'https://architect.example.test/'}];

test('a company can select another involved party as the lead contact through the real UI and backend',{skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run selected contact DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{empty=false,same=false,role='hoofdbeheerder',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:'selected-ui-owner@example.test',adminName:'Testbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const[key,value]of Object.entries(headers))this.setHeader(key,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const logged=await dispatch('/api/auth/login',{method:'POST',body:{email:'selected-ui-owner@example.test',password}});assert.equal(logged.status,200);
  const ownerCookie=logged.headers['set-cookie'].split(';')[0],ownerHeaders={cookie:ownerCookie,'x-csrf-token':logged.json().csrfToken};
  const action=async(type,payload={},companyId='c-noord')=>{const r=await dispatch('/api/action',{method:'POST',headers:ownerHeaders,body:{type,companyId,payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();};
  const importToken=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  const item={externalId:'selected-ui-project',title:'Contact kiezen bij project',organization:empty?'':'Oorspronkelijke aannemer',contact:empty?'':'Oorspronkelijke persoon',phone:empty?'':'030-2222222',email:empty?'':'bron@example.test',description:'Projectinformatie om de scrollpositie te bewaren. '.repeat(30),projectDetails:{primaryRole:empty?'':'Hoofdaannemer',primaryWebsite:empty?'':'https://bron.example.test/',parties}};
  if(same){Object.assign(item,{organization:parties[0].name,contact:'',phone:parties[0].phone,email:parties[0].email});Object.assign(item.projectDetails,{primaryRole:parties[0].role,primaryWebsite:parties[0].website});}
  async function imported(next,runId){const r=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+importToken},body:{runId,items:[next]}});assert.equal(r.status,200,r.bytes.toString());}
  await imported(item,'selected-ui-initial');
  const snapshot=async(companyId='c-noord')=>{const r=await dispatch('/api/state?companyId='+encodeURIComponent(companyId),{headers:ownerHeaders});assert.equal(r.status,200);return r.json().state;};
  const lead=(await snapshot()).leads[0],other=(await action('company.create',{name:'Ander selectiebedrijf'})).result.company;
  let cookie=ownerCookie;
  if(role!=='hoofdbeheerder'){
   const invite=(await action('invitation.create',{name:'Contactgebruiker',email:'selected-'+role+'@example.test',companyId:'c-noord',role})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invite.token,name:'Contactgebruiker',password}});assert.equal(activated.status,200);cookie=activated.headers['set-cookie'].split(';')[0];
  }
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  const requests=[],errors=[];let nextSelection=null;
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.setInterval=()=>0;});
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   const selection=url.pathname==='/api/action'&&payload?.type==='workspace.contact.select';if(selection)requests.push(payload);
   const gate=selection?nextSelection:null;if(gate)nextSelection=null;
   const r=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Contact tijdelijk niet opgeslagen. Probeer het opnieuw.'}))}:await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}await intercepted.fulfill({status:r.status,headers:r.headers,body:r.bytes});
  });
  const open=async()=>{const button=page.locator('#main [data-action="open-lead"][data-id="'+lead.id+'"]').first();await button.focus();await page.keyboard.press('Enter');await page.locator('.workbook-drawer').waitFor({state:'visible'});await page.locator('[data-lead-parties]').evaluate(details=>details.open=true);};
  await page.goto(origin+'/#leads');await page.locator('#lead-search').waitFor({state:'visible'});await open();
  return{page,lead,other,item,action,snapshot,imported,open,requests,errors,
   gate(mode='hold'){let start,release,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Selected contact request did not arrive')),5000);start=()=>{clearTimeout(timer);resolve();};}),released=new Promise(resolve=>release=resolve);t.after(()=>{clearTimeout(timer);release();});nextSelection={mode,started:start,released};return{started,release};}};
 }
 const green=f=>f.page.locator('[data-selected-contact-card]');
 const choose=(f,index=0)=>f.page.locator('[data-action="select-party-contact"][data-party-index="'+index+'"]');
 const confirm=f=>f.page.locator('.modal [data-action="confirm-select-party-contact"]');
 const selected=async(f,index=0)=>{await f.page.waitForFunction(name=>document.querySelector('[data-selected-contact-card] .workbook-org')?.textContent===name,parties[index].name);};
 async function capture(f,name){if(process.env.SELECTED_CONTACT_SCREENSHOTS!=='1')return;await f.page.locator('.modal').evaluate(async modal=>{await Promise.all(modal.getAnimations().map(animation=>animation.finished.catch(()=>{})));});await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/selected-contact-'+name+'.png',import.meta.url)),fullPage:false});}

 for(const role of ['verkoper','bedrijfsbeheerder'])await t.test(role+' can select directly when the green contact is empty',async t=>{
  const f=await fixture(t,{empty:true,role});await choose(f).click();await selected(f);
  assert.equal(await f.page.locator('.modal').count(),0);assert.equal(f.requests.length,1);assert.equal(f.requests[0].payload.confirmed,false);
  const w=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(w.selectedContact.name,parties[0].name);assert.equal(w.selectedContact.selectedByName,'Contactgebruiker');
  assert.equal(await green(f).locator('a[href="mailto:contact%2Bproject@example.test"]').count(),1);assert.equal(await green(f).locator('a[href="tel:0180494949"]').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('replacing an existing contact requires confirmation and cancelling makes no request',async t=>{
  const f=await fixture(t),before=await f.snapshot();await choose(f).click();await confirm(f).waitFor({state:'visible'});
  await capture(f,'desktop');
  assert.equal(f.requests.length,0);assert.match(await f.page.locator('.modal').innerText(),/Oorspronkelijke aannemer/);assert.match(await f.page.locator('.modal').innerText(),/Woonstichting Zuid/);
  await f.page.locator('.modal [data-action="close-modal"]').last().click();assert.equal(f.requests.length,0);assert.match(await green(f).innerText(),/Oorspronkelijke aannemer/);assert.deepEqual(await f.snapshot(),before);assert.equal(await f.page.locator('[data-lead-parties]').evaluate(details=>details.open),true);assert.deepEqual(f.errors,[]);
 });
 await t.test('a party matching the current source contact can still be pinned as this company’s saved contact',async t=>{
  const f=await fixture(t,{same:true});assert.equal(await choose(f).isEnabled(),true);await choose(f).click();await confirm(f).waitFor({state:'visible'});assert.equal(f.requests.length,0);assert.match(await f.page.locator('.modal').innerText(),/vaste contact/);
  await confirm(f).click();await f.page.locator('.modal').waitFor({state:'hidden'});assert.equal(f.requests.length,1);assert.equal(f.requests[0].payload.confirmed,true);assert.equal((await f.snapshot()).workspaces['c-noord'][f.lead.id].selectedContact.name,parties[0].name);assert.equal(await choose(f).isDisabled(),true);
  await f.imported({...f.item,organization:'Later gewijzigde bronorganisatie',phone:'030-7777777'},'selected-ui-same-pinned');await f.page.reload();await f.page.locator('#lead-search').waitFor({state:'visible'});await f.open();await selected(f);assert.equal(await green(f).locator('a[href="tel:0180494949"]').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('confirmed selection preserves an unsaved private contact, note, open parties and popup position',async t=>{
  const f=await fixture(t);await f.page.locator('[data-work="contactName"]').fill('Eigen persoon');await f.page.locator('[data-work="contactEmail"]').fill('eigen@example.test');await f.page.locator('#note-form textarea').fill('Onopgeslagen gespreksnotitie');
  await f.page.locator('.detail-body').evaluate(body=>body.scrollTop=150);await choose(f).evaluate(button=>{window.partySelectionScroll=button.closest('.detail-body').scrollTop;button.click();});const gate=f.gate();await confirm(f).click();await gate.started;
  assert.equal(await confirm(f).isDisabled(),true);await confirm(f).evaluate(button=>button.click());assert.equal(f.requests.length,1);gate.release();await selected(f);
  assert.equal(await f.page.locator('[data-work="contactName"]').inputValue(),'Eigen persoon');assert.equal(await f.page.locator('[data-work="contactEmail"]').inputValue(),'eigen@example.test');assert.equal(await f.page.locator('#note-form textarea').inputValue(),'Onopgeslagen gespreksnotitie');assert.equal(await f.page.locator('[data-lead-parties]').evaluate(details=>details.open),true);
  assert.ok(await f.page.evaluate(()=>Math.abs(document.querySelector('.detail-body').scrollTop-window.partySelectionScroll)<=2),'The lead popup returns to the same body scroll position');
  const w=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(w.contactName??'','');assert.equal(w.notes.length,0);assert.equal(w.selectedContact.name,parties[0].name);
  assert.equal((await green(f).innerText()).includes('Oorspronkelijke persoon'),false,'A selected organization cannot inherit a different organization’s historic person');
  await f.page.locator('[data-action="save-close-lead"]').click();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});await f.open();await selected(f);
  const saved=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(saved.notes.filter(note=>note.text==='Onopgeslagen gespreksnotitie').length,1);assert.equal(saved.contactName,'Eigen persoon');assert.deepEqual(f.errors,[]);
 });
 await t.test('a failed selection retains the old contact and confirmation can be retried',async t=>{
  const f=await fixture(t);await choose(f).click();const gate=f.gate('reject');await confirm(f).click();await gate.started;gate.release();
  await f.page.locator('[data-selected-contact-error]').waitFor({state:'visible'});assert.match(await f.page.locator('[data-selected-contact-error]').innerText(),/tijdelijk/);assert.equal((await f.snapshot()).workspaces['c-noord'][f.lead.id]?.selectedContact,undefined);
  await confirm(f).click();await selected(f);assert.equal(f.requests.length,2);assert.deepEqual(f.errors,[]);
 });
 await t.test('selection remains private to one company and persists across a source refresh',async t=>{
  const f=await fixture(t);await choose(f).click();await confirm(f).click();await selected(f);await f.page.locator('.workbook-drawer [data-action="close-drawer"]').click();
  await f.page.locator('[data-field="company"]').selectOption(f.other.id);await f.page.waitForFunction(id=>document.querySelector('.page-footer')?.textContent.includes(id),'Ander selectiebedrijf');await f.open();assert.match(await green(f).innerText(),/Oorspronkelijke aannemer/);
  await f.page.locator('.workbook-drawer [data-action="close-drawer"]').click();await f.page.locator('[data-field="company"]').selectOption('c-noord');await f.page.waitForFunction(()=>document.querySelector('.page-footer')?.textContent.includes('Mijn bedrijf'));
  await f.imported({...f.item,organization:'Bijgewerkte bronorganisatie',projectDetails:{...f.item.projectDetails,parties:[{...parties[0],name:'Nieuwe bronnaam'},parties[1]]}},'selected-ui-refresh');await f.page.reload();await f.page.locator('#lead-search').waitFor({state:'visible'});await f.open();await selected(f);assert.equal((await f.snapshot(f.other.id)).workspaces[f.other.id]?.[f.lead.id]?.selectedContact,undefined);assert.deepEqual(f.errors,[]);
 });
 await t.test('a stale party snapshot is rejected instead of silently selecting a changed source party',async t=>{
  const f=await fixture(t);await choose(f).click();await f.imported({...f.item,projectDetails:{...f.item.projectDetails,parties:[{...parties[0],name:'Gewijzigde partij'},parties[1]]}},'selected-ui-race');await confirm(f).click();
  await f.page.locator('[data-selected-contact-error]').waitFor({state:'visible'});assert.equal((await f.snapshot()).workspaces['c-noord'][f.lead.id]?.selectedContact,undefined);assert.deepEqual(f.errors,[]);
 });
 await t.test('selected green phone remains subject to the central lead cooldown',async t=>{
  const f=await fixture(t);await choose(f).click();await confirm(f).click();await selected(f);await f.action('call.record',{leadId:f.lead.id},f.other.id);await f.page.goto(origin+'/#all-companies');await f.page.locator('[data-admin-filter="type"]').selectOption('all');await f.page.locator('[data-action="admin-open-lead"][data-id="'+f.lead.id+'"][data-company-id="c-noord"]').first().click();await f.page.locator('.workbook-drawer').waitFor({state:'visible'});
  assert.equal(await green(f).locator('a[href^="tel:"]').count(),0);assert.match(await green(f).innerText(),/Tijdelijk niet belbaar/);assert.equal(await green(f).locator('a[href^="mailto:"]').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('the party picker and confirmation remain usable on a small mobile screen',async t=>{
  const f=await fixture(t,{mobile:true});await choose(f).click();const dialog=f.page.locator('.modal');await confirm(f).waitFor({state:'visible'});const box=await dialog.boundingBox(),viewport=f.page.viewportSize();
  await capture(f,'mobile');
  const geometry=await f.page.evaluate(()=>{const modal=document.querySelector('.modal'),style=getComputedStyle(modal);return{innerWidth,innerHeight,scrollX,scrollY,left:style.left,top:style.top,transform:style.transform,bodyWidth:document.body.getBoundingClientRect().width,visual:visualViewport?{left:visualViewport.offsetLeft,top:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height,pageLeft:visualViewport.pageLeft,pageTop:visualViewport.pageTop}:null};});
  assert.ok(box&&box.x>=0&&box.x+box.width<=viewport.width+1,JSON.stringify({box,viewport,geometry}));await confirm(f).click();await selected(f);assert.equal(await f.page.locator('[data-lead-parties]').evaluate(details=>details.open),true);assert.deepEqual(f.errors,[]);
 });
});
