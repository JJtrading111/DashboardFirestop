import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://admin-overview.example.test',password='Admin-overview-test-password-2026!';
const texts={north:'Noord: planning met Noor besproken.',south:'Zuid: calculatie met Bas besproken.',shared:'Noord: gedeeld project besproken.',old:'Historische notitie van dertig dagen geleden.'};

test('the chief overview shows all company work and history through the real API in Chrome', {skip:!chromium||!executablePath?'Install scraper dependencies and Chromium to run company overview browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:'overview-owner@example.test',adminName:'Hoofdbeheerder Overzicht',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const owner=await dispatch('/api/auth/login',{method:'POST',body:{email:'overview-owner@example.test',password}});assert.equal(owner.status,200);
  const ownerCookie=owner.headers['set-cookie'].split(';')[0],ownerHeaders={cookie:ownerCookie,'x-csrf-token':owner.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',headers=ownerHeaders){const r=await dispatch('/api/action',{method:'POST',headers,body:{type,companyId,payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();}
  await action('company.update',{companyId:'c-noord',name:'Noord Projectbouw'});
  const south=(await action('company.create',{name:'Zuid Vastgoed'})).result.company,empty=(await action('company.create',{name:'Leeg bedrijf'})).result.company;
  async function member(name,email,companyId,memberRole='verkoper'){
   const invitation=(await action('invitation.create',{name,email,companyId,role:memberRole})).result;
   const r=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}});assert.equal(r.status,200);
   return{user:r.json().user,cookie:r.headers['set-cookie'].split(';')[0],headers:{cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrfToken}};
  }
  const noor=await member('Noor Noord','noor@example.test','c-noord'),bas=await member('Bas Zuid','bas@example.test',south.id);
  const key=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'admin-overview-fixture',items:[
   {externalId:'overview-north',title:'Renovatie Noord',organization:'Aannemer Noord',city:'Utrecht'},
   {externalId:'overview-south',title:'Renovatie Zuid',organization:'Aannemer Zuid',city:'Breda'},
   {externalId:'overview-shared',title:'Gezamenlijk project',organization:'Gezamenlijke aannemer',city:'Rotterdam'}
  ]}});assert.equal(imported.status,200,imported.bytes.toString());
  const snapshot=async(companyId='c-noord',headers=ownerHeaders)=>{const r=await dispatch('/api/state?companyId='+encodeURIComponent(companyId),{headers});assert.equal(r.status,200);return r.json().state;};
  const initial=await snapshot(),northLead=initial.leads.find(l=>l.importExternalId==='overview-north'),southLead=initial.leads.find(l=>l.importExternalId==='overview-south'),sharedLead=initial.leads.find(l=>l.importExternalId==='overview-shared');
  await action('call.record',{leadId:northLead.id,outcome:'reached',person:'Projectleider Noord'},'c-noord',noor.headers);
  await action('workspace.save',{leadId:northLead.id,changes:{status:'opvolgen',priority:'high',commitment:true,calculation:true},note:{id:'note-'+randomUUID(),text:texts.north}},'c-noord',noor.headers);
  await action('workspace.save',{leadId:sharedLead.id,changes:{priority:'high',ownerId:null},note:{id:'note-'+randomUUID(),text:texts.shared}},'c-noord',noor.headers);
  const actualNow=Date.now;
  try{const then=actualNow()-30*86400000;Date.now=()=>then;await action('note.add',{leadId:northLead.id,text:texts.old},'c-noord',noor.headers);}finally{Date.now=actualNow;}
  await action('callback.add',{leadId:northLead.id,assigneeId:noor.user.id,dueAt:new Date(Date.now()-3600000).toISOString(),description:'Noor moet terugbellen'},'c-noord',noor.headers);
  await action('call.record',{leadId:southLead.id,outcome:'unanswered'},south.id,bas.headers);
  await action('workspace.save',{leadId:southLead.id,changes:{status:'offerte',commitment:true},note:{id:'note-'+randomUUID(),text:texts.south}},south.id,bas.headers);
  await action('workspace.save',{leadId:sharedLead.id,changes:{status:'contact',ownerId:bas.user.id,calculation:true,contactName:'Privécontact van Zuid'}},south.id,bas.headers);
  await action('callback.add',{leadId:southLead.id,assigneeId:bas.user.id,dueAt:new Date(Date.now()+86400000).toISOString(),description:'Morgen terugbellen bij Zuid'},south.id,bas.headers);
  await action('callback.add',{leadId:sharedLead.id,assigneeId:bas.user.id,dueAt:new Date(Date.now()-1800000).toISOString(),description:'Bas moet terugbellen'},south.id,bas.headers);
  const finished=(await action('callback.add',{leadId:southLead.id,assigneeId:bas.user.id,dueAt:new Date(Date.now()+2*86400000).toISOString(),description:'Afspraak wordt afgehandeld'},south.id,bas.headers)).result.callback;
  await action('callback.complete',{leadId:southLead.id,callbackId:finished.id},south.id,bas.headers);
  const southColumns=(await snapshot(south.id)).companies.find(c=>c.id===south.id).columns.map(c=>({...c,name:c.id==='offerte'?'Calculatiegesprek':c.name}));
  await action('columns.update',{columns:southColumns},south.id);
  let current={user:owner.json().user,cookie:ownerCookie,headers:ownerHeaders};
  if(role==='verkoper')current=bas;
  if(role==='bedrijfsbeheerder')current=await member('Beheerder Zuid','manager-zuid@example.test',south.id,'bedrijfsbeheerder');
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await page.addInitScript(()=>{window.__overviewTimers=[];window.setInterval=(callback,ms,...args)=>{window.__overviewTimers.push({callback:()=>callback(...args),ms});return window.__overviewTimers.length;};});
  const errors=[],requests=[];let nextRead=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   requests.push({path:url.pathname,method:request.method()});const read=url.pathname==='/api/state',gate=read?nextRead:null;if(gate)nextRead=null;
   const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});
   if(gate){gate.started();await gate.released;}
   try{await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});}catch(error){if(!request.failure())throw error;}finally{gate?.finished();}
  });
  await page.goto(origin+'/#dashboard');await page.locator('.app-shell').waitFor({state:'visible'});
  return{page,south,empty,northLead,southLead,sharedLead,noor,bas,action,snapshot,dispatch,current,errors,requests,
   card:id=>page.locator('.admin-company-card[data-company-id="'+id+'"]'),
   async global(){await page.goto(origin+'/#all-companies');await page.locator('#main').waitFor({state:'visible'});},
   holdRead(){let start,release,finished,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Background overview refresh did not start')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finished=resolve);t.after(()=>{clearTimeout(timer);release();});nextRead={started:start,released,finished};return{started,release,done};}};
 }
 const filter=(f,name)=>f.page.locator('[data-admin-filter="'+name+'"]');
 const activities=f=>f.page.locator('[data-admin-activity]');
 async function select(f,name,value){await filter(f,name).selectOption(value);}

 await t.test('a chief starts with all companies, correct central totals and actual named work',async t=>{
  const f=await fixture(t);await f.page.locator('.admin-overview').waitFor({state:'visible'});
  assert.equal(await f.page.locator('.admin-company-card').count(),3);
  for(const [name,value]of Object.entries({centralLeads:3,callsToday:2,overdueCallbacks:2,commitments:2}))assert.match(await f.page.locator('[data-admin-stat="'+name+'"]').innerText(),new RegExp('\\b'+value+'\\b'),name);
  assert.ok((await f.card('c-noord').innerText()).includes('Noord Projectbouw'));
  assert.ok((await f.card(f.south.id).innerText()).includes('Calculatiegesprek'));
  assert.ok((await f.card(f.empty.id).innerText()).includes('Leeg bedrijf'));
  const text=await f.page.locator('#main').innerText();assert.ok(text.includes('Noor Noord'));assert.ok(text.includes('Bas Zuid'));
  assert.ok(text.includes('Noor moet terugbellen'));assert.ok(text.includes('Bas moet terugbellen'));
  assert.equal(await f.page.locator('[data-route="all-companies"]').count()>0,true);assert.deepEqual(f.errors,[]);
 });
 await t.test('company, period and activity filters reveal saved history without mixing company notes',async t=>{
  const f=await fixture(t);await select(f,'type','note');
  await f.page.waitForFunction(()=>document.querySelectorAll('[data-admin-activity]').length===3);
  let text=await activities(f).allTextContents();assert.ok(text.join(' ').includes(texts.north));assert.ok(text.join(' ').includes(texts.south));assert.equal(text.join(' ').includes(texts.old),false);
  await select(f,'period','all');await f.page.getByText(texts.old,{exact:false}).first().waitFor({state:'visible'});
  await select(f,'company',f.south.id);
  await f.page.waitForFunction(id=>[...document.querySelectorAll('[data-admin-activity]')].every(row=>row.dataset.companyId===id),f.south.id);
  text=await activities(f).allTextContents();assert.ok(text.join(' ').includes(texts.south));assert.equal(text.join(' ').includes(texts.north),false);assert.equal(text.join(' ').includes(texts.old),false);
  await select(f,'company','all');await select(f,'type','call');assert.equal(await activities(f).count(),2);assert.deepEqual(f.errors,[]);
 });
 await t.test('lead drill-down opens the matching company workspace and returns to the same overview filters',async t=>{
  const f=await fixture(t);await select(f,'period','all');await select(f,'type','note');await select(f,'company',f.south.id);
  const note=activities(f).filter({hasText:texts.south}).first();await note.locator('[data-action="admin-open-lead"]').click();
  await f.page.locator('.workbook-drawer').waitFor({state:'visible'});assert.match(await f.page.locator('#workbook-followup').innerText(),/Zuid Vastgoed/);
  assert.ok((await f.page.locator('.workbook-drawer').innerText()).includes(texts.south));assert.equal((await f.page.locator('.workbook-drawer').innerText()).includes(texts.north),false);
  await f.page.locator('[data-action="close-drawer"]').last().click();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});
  assert.equal(await filter(f,'company').inputValue(),f.south.id);assert.equal(await filter(f,'period').inputValue(),'all');assert.equal(await filter(f,'type').inputValue(),'note');assert.deepEqual(f.errors,[]);
 });
 await t.test('opening a company and returning preserves the global overview and its selection',async t=>{
  const f=await fixture(t);await f.global();await select(f,'period','all');await select(f,'type','note');
  await f.card(f.south.id).locator('[data-action="admin-open-company"]').first().click();await f.page.waitForURL('**/#kanban');
  assert.equal(await f.page.locator('#company-switch').inputValue(),f.south.id);await f.page.locator('[data-action="admin-return-overview"]').click();await f.page.waitForURL('**/#all-companies');
  assert.equal(await filter(f,'period').inputValue(),'all');assert.equal(await filter(f,'type').inputValue(),'note');assert.equal(await f.page.locator('.admin-company-card').count(),3);assert.deepEqual(f.errors,[]);
 });
 await t.test('a late periodic refresh updates the view without losing the selected company, period or focused filter',async t=>{
  const f=await fixture(t);await select(f,'type','note');await select(f,'company',f.south.id);await select(f,'period','all');
  const gate=f.holdRead();await f.page.evaluate(()=>{window.__overviewTimers.find(timer=>timer.ms===30000).callback();});await gate.started;
  await filter(f,'type').focus();gate.release();await gate.done;await f.page.waitForTimeout(50);
  assert.equal(await filter(f,'type').inputValue(),'note');assert.equal(await filter(f,'company').inputValue(),f.south.id);assert.equal(await filter(f,'period').inputValue(),'all');
  assert.equal(await filter(f,'type').evaluate(input=>document.activeElement===input),true);assert.deepEqual(f.errors,[]);
 });
 await t.test('the periodic refresh adds a colleague activity from another company without reloading the page',async t=>{
  const f=await fixture(t);await select(f,'type','note');const text='Nieuwe opvolging van Bas verschijnt in het gezamenlijke overzicht.';
  await f.action('note.add',{leadId:f.southLead.id,text},f.south.id,f.bas.headers);
  await f.page.locator('#main h1').click();await f.page.evaluate(()=>{window.__overviewTimers.find(timer=>timer.ms===30000).callback();});
  await activities(f).filter({hasText:text}).waitFor({state:'visible'});assert.equal(await filter(f,'type').inputValue(),'note');assert.equal(new URL(f.page.url()).hash,'#dashboard');assert.deepEqual(f.errors,[]);
 });
 for(const role of ['verkoper','bedrijfsbeheerder'])await t.test(role+' retains the own-company overview and cannot open global work history',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('.admin-overview,[data-route="all-companies"]').count(),0);await f.global();
  assert.equal(await f.page.locator('.admin-company-card,[data-admin-activity]').count(),0);const visible=await f.page.locator('#main').innerText();assert.equal(visible.includes(texts.north),false);
  const response=await f.dispatch('/api/state?companyId=c-noord',{headers:f.current.headers});assert.equal(response.status,403);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': company cards, filters and history fit the viewport',async t=>{
  const f=await fixture(t,{mobile}),viewport=f.page.viewportSize();await f.page.locator('.admin-overview').waitFor({state:'visible'});
  for(const element of await f.page.locator('.admin-company-card,[data-admin-filter],[data-admin-activity],[data-admin-attention]').all()){
   const box=await element.boundingBox();assert.ok(box&&box.width>0&&box.x>=-1&&box.x+box.width<=viewport.width+1,'Overview content must fit horizontally');
  }
  if(mobile){const attention=await f.page.locator('.admin-attention-list').boundingBox(),history=await f.page.locator('.admin-activity-list').boundingBox();assert.ok(attention&&history&&attention.y<history.y,'Current follow-up attention should precede long history on mobile');}
  if(process.env.ADMIN_OVERVIEW_SCREENSHOTS==='1'){await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/admin-overview-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});}
  assert.deepEqual(f.errors,[]);
 });
});
