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
const origin='https://lead-contact.example.test',email='lead-contact-owner@example.test',password='Lead-contact-test-password-2026!';
const contact={contactName:'Jan de Vries',contactEmail:'jan.de.vries@example.test',contactPhone:'06 1234 5678'};

test('company contact details work with the shared lead draft in a real browser', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run contact DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{mobile=false,initialContact=null}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:email,adminName:'Contactbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':login.json().csrfToken};
  const action=async(type,payload={},companyId='c-noord')=>{const response=await dispatch('/api/action',{method:'POST',headers,body:{type,companyId,payload}});assert.equal(response.status,200,response.bytes.toString());return response.json();};
  const importToken=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+importToken},body:{runId:'contact-ui-fixture',items:[{
   externalId:'contact-ui-project',title:'Contactpersoon bij project',organization:'Testaannemer',city:'Utrecht',
   contact:'Broncontact',email:'algemeen@example.test',description:'Projectinformatie voor de contacttest. '.repeat(25)
  }]}});assert.equal(imported.status,200,imported.bytes.toString());
  const initial=await dispatch('/api/state?companyId=c-noord',{headers});assert.equal(initial.status,200);const lead=initial.json().state.leads[0];
  const other=(await action('company.create',{name:'Ander contactbedrijf'})).result.company;
  if(initialContact)await action('workspace.save',{leadId:lead.id,changes:initialContact});
  const snapshot=async(companyId='c-noord')=>{const response=await dispatch('/api/state?companyId='+encodeURIComponent(companyId),{headers});assert.equal(response.status,200);return response.json().state;};
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  const actions=[],errors=[];let nextWrite=null;
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.setInterval=()=>0;});
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   const save=url.pathname==='/api/action'&&payload?.type==='workspace.save';if(url.pathname==='/api/action')actions.push(payload);
   const gate=save?nextWrite:null;if(gate)nextWrite=null;
   const response=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Contactgegevens tijdelijk niet opgeslagen'}))}:
    await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  const open=async()=>{const button=page.locator('#main [data-action="open-lead"][data-id="'+lead.id+'"]').first();if(mobile){await button.focus();await page.keyboard.press('Enter');}else await button.click();await page.locator('.workbook-contact-person').waitFor({state:'visible'});};
  await page.goto(origin+'/#leads');await page.locator('#lead-search').waitFor({state:'visible'});await open();
  return{page,lead,other,action,snapshot,actions,errors,open,
   gate(mode='hold'){let start,release,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Contact save did not reach the backend')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve);t.after(()=>{clearTimeout(timer);release();});nextWrite={mode,started:start,released};return{started,release};}};
 }
 const field=(f,name)=>f.page.locator('.workbook-contact-person [data-work="'+name+'"]');
 async function fill(f,values=contact){for(const [name,value]of Object.entries(values))await field(f,name).fill(value);}
 async function saved(f){await f.page.locator('[data-action="save-close-lead"]').click();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});}
 async function assertValues(f,values=contact){for(const [name,value]of Object.entries(values))assert.equal(await field(f,name).inputValue(),value,name);}

 await t.test('a name can be saved with both optional fields empty and all details can be edited afterwards',async t=>{
  const f=await fixture(t);assert.equal(await field(f,'contactEmail').getAttribute('type'),'email');assert.equal(await field(f,'contactPhone').getAttribute('type'),'tel');
  await fill(f,{contactName:contact.contactName});await saved(f);await f.open();await assertValues(f,{contactName:contact.contactName,contactEmail:'',contactPhone:''});
  assert.equal(await f.page.locator('[data-contact-person-links] a').count(),0);
  await fill(f);await saved(f);await f.open();await assertValues(f);
  const w=(await f.snapshot()).workspaces['c-noord'][f.lead.id];for(const [name,value]of Object.entries(contact))assert.equal(w[name],value);
  assert.equal(await f.page.locator('[data-contact-person-links] a[href="mailto:'+contact.contactEmail+'"]').count(),1);
  assert.equal(await f.page.locator('[data-contact-person-links] a[href="tel:0612345678"][data-action="call-link"]').count(),1);
  assert.deepEqual(f.errors,[]);
 });
 await t.test('draft fields and an unsubmitted note survive a callback dialog and save together exactly once',async t=>{
  const f=await fixture(t);await fill(f);await f.page.locator('#note-form textarea[name="text"]').fill('Graag rechtstreeks Jan bellen.');
  await field(f,'contactName').focus();await field(f,'contactName').evaluate(input=>input.setSelectionRange(4,8));
  assert.equal(await field(f,'contactName').evaluate(input=>document.activeElement===input),true);
  await f.page.locator('.workbook-drawer').getByRole('button',{name:'Terugbellen plannen',exact:true}).click();
  await f.page.locator('#callback-form').waitFor({state:'visible'});await f.page.locator('.modal').getByRole('button',{name:'Annuleren',exact:true}).click();
  await assertValues(f);assert.equal(await f.page.locator('#note-form textarea[name="text"]').inputValue(),'Graag rechtstreeks Jan bellen.');
  const gate=f.gate();await f.page.locator('[data-action="save-close-lead"]').click();await gate.started;
  assert.equal(await f.page.locator('[data-action="save-close-lead"]').isDisabled(),true);
  await f.page.locator('[data-action="save-close-lead"]').evaluate(button=>button.click());assert.equal(f.actions.filter(a=>a.type==='workspace.save').length,1);
  gate.release();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});
  const w=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(w.notes.filter(n=>n.text==='Graag rechtstreeks Jan bellen.').length,1);
  for(const [name,value]of Object.entries(contact))assert.equal(w[name],value);assert.deepEqual(f.errors,[]);
 });
 await t.test('a rejected save keeps every contact draft available and a second attempt saves it',async t=>{
  const f=await fixture(t);await fill(f);await f.page.locator('#note-form textarea[name="text"]').fill('Contact voor terugkoppeling.');
  const gate=f.gate('reject');await f.page.locator('[data-action="save-close-lead"]').click();await gate.started;gate.release();
  await f.page.getByText('Contactgegevens tijdelijk niet opgeslagen',{exact:true}).waitFor({state:'visible'});await assertValues(f);
  assert.equal(await f.page.locator('#note-form textarea[name="text"]').inputValue(),'Contact voor terugkoppeling.');
  const before=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(before?.contactName||'','');assert.equal(before?.notes?.length||0,0);
  await saved(f);const after=(await f.snapshot()).workspaces['c-noord'][f.lead.id];assert.equal(after.contactName,contact.contactName);assert.equal(after.notes.length,1);assert.deepEqual(f.errors,[]);
 });
 await t.test('an edited contact does not offer stale saved links and incomplete details stay in the popup',async t=>{
  const f=await fixture(t,{initialContact:contact});await field(f,'contactPhone').fill('06 9876 5432');
  assert.equal(await f.page.locator('[data-contact-person-links] a').count(),0,'Links must not use the previous saved contact while a draft is being edited');
  assert.match(await f.page.locator('[data-contact-person-links]').innerText(),/opslaan/i);
  await field(f,'contactName').fill('');await f.page.locator('[data-action="save-close-lead"]').click();
  await f.page.locator('.workbook-save-error').waitFor({state:'visible'});assert.equal(await f.page.locator('.workbook-drawer').isVisible(),true);
  assert.equal(f.actions.filter(a=>a.type==='workspace.save').length,0);assert.equal(await field(f,'contactPhone').inputValue(),'06 9876 5432');
  assert.equal((await f.snapshot()).workspaces['c-noord'][f.lead.id].contactPhone,contact.contactPhone);
  await field(f,'contactName').fill(contact.contactName);await saved(f);await f.open();
  assert.equal(await f.page.locator('[data-contact-person-links] a[href="tel:0698765432"]').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('clearing the three fields removes only this company contact and the old links',async t=>{
  const f=await fixture(t,{initialContact:contact});await fill(f,{contactName:'',contactEmail:'',contactPhone:''});await saved(f);await f.open();
  await assertValues(f,{contactName:'',contactEmail:'',contactPhone:''});assert.equal(await f.page.locator('[data-contact-person-links] a').count(),0);
  const state=await f.snapshot();assert.equal(state.leads.find(l=>l.id===f.lead.id).contact,'Broncontact');assert.equal(state.leads.find(l=>l.id===f.lead.id).email,'algemeen@example.test');assert.deepEqual(f.errors,[]);
 });
 await t.test('a contact stays within the selected company and a different company has its own fields',async t=>{
  const f=await fixture(t,{initialContact:contact});await f.page.getByRole('button',{name:'Lead sluiten',exact:true}).click();
  await f.page.locator('#company-switch').selectOption(f.other.id);await f.page.waitForFunction(name=>document.querySelector('.page-footer')?.textContent.includes(name),f.other.name);await f.open();
  await assertValues(f,{contactName:'',contactEmail:'',contactPhone:''});assert.equal(await f.page.locator('[data-contact-person-links] a').count(),0);
  const own={contactName:'Andere contactpersoon',contactEmail:'',contactPhone:'020 555 0000'};await fill(f,own);await saved(f);
  const state=await f.snapshot();for(const [name,value]of Object.entries(contact))assert.equal(state.workspaces['c-noord'][f.lead.id][name],value);
  for(const [name,value]of Object.entries(own))assert.equal(state.workspaces[f.other.id][f.lead.id][name],value);assert.deepEqual(f.errors,[]);
 });
 await t.test('a saved direct phone respects the cross-company wait even when the central lead has no phone',async t=>{
  const f=await fixture(t,{initialContact:contact});assert.equal(await f.page.locator('[data-contact-person-links] a[href^="tel:"]').count(),1);
  await f.action('call.record',{leadId:f.lead.id},f.other.id);await f.page.goto(origin+'/#all-companies');await f.page.locator('[data-admin-filter="type"]').selectOption('all');await f.page.locator('[data-action="admin-open-lead"][data-id="'+f.lead.id+'"][data-company-id="c-noord"]').first().click();await f.page.locator('.workbook-contact-person').waitFor({state:'visible'});
  assert.equal(await f.page.locator('[data-contact-person-links] a[href^="tel:"]').count(),0);
  assert.equal(await f.page.locator('[data-contact-person-links] a[href^="mailto:"]').count(),1);await assertValues(f);assert.deepEqual(f.errors,[]);
 });
 await t.test('saved international phone notation and e-mail tags produce safe direct links',async t=>{
  const values={...contact,contactEmail:'jan+project@example.test',contactPhone:'+31 (0)6 1234 5678'},f=await fixture(t,{initialContact:values});
  await assertValues(f,values);
  assert.equal(await f.page.locator('[data-contact-person-links] a[href="tel:+31612345678"]').count(),1);
  assert.equal(await f.page.locator('[data-contact-person-links] a[href="mailto:jan%2Bproject@example.test"]').count(),1);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': a long valid contact e-mail wraps within its follow-up column',async t=>{
  const longEmail='j'.repeat(60)+'@'+'a'.repeat(60)+'.example.test',f=await fixture(t,{mobile,initialContact:{...contact,contactEmail:longEmail}});
  const link=f.page.locator('[data-contact-person-links] a[href^="mailto:"]'),box=await link.boundingBox(),group=await f.page.locator('.workbook-contact-person').boundingBox();
  assert.equal(await link.innerText(),longEmail);assert.ok(box&&group&&box.x>=group.x&&box.x+box.width<=group.x+group.width+1,'Email action must fit its contact group');
  const content=await f.page.locator('[data-contact-person-links]').evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));assert.ok(content.scroll<=content.width+1,'Email text must wrap rather than overflow');assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': contact controls fit the popup and the save button remains reachable',async t=>{
  const f=await fixture(t,{mobile,initialContact:contact}),popup=f.page.locator('.workbook-drawer'),viewport=f.page.viewportSize();
  for(const name of Object.keys(contact)){const box=await field(f,name).boundingBox();assert.ok(box&&box.width>0&&box.x>=0&&box.x+box.width<=viewport.width+1,'Contact input must fit viewport');}
  const save=await f.page.locator('[data-action="save-close-lead"]').boundingBox();assert.ok(save&&save.height>=44&&save.y>=0&&save.y+save.height<=viewport.height+1);
  await popup.locator('.detail-body').evaluate(body=>body.scrollTop=body.scrollHeight);
  if(process.env.LEAD_CONTACT_SCREENSHOTS==='1'){await f.page.locator('.workbook-contact-person').evaluate(node=>node.scrollIntoView({block:'center'}));await f.page.locator('[data-action="save-close-lead"]').focus();await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/lead-contact-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:false});}
  await saved(f);assert.deepEqual(f.errors,[]);
 });
});
