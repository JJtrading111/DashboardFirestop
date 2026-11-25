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
const origin='https://admin-focus.example.test',password='Admin-overview-test-password-2026!';
const texts={north:'Noord: planning met Noor besproken.',south:'Zuid: calculatie met Bas besproken.',shared:'Noord: gedeeld project besproken.',old:'Historische notitie van dertig dagen geleden.'};

test('the chief start page prioritizes follow-up, company and employee calls, notes and status history', {skip:!chromium||!executablePath?'Install scraper dependencies and Chromium to run company overview browser checks':false},async t=>{
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
  const local=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const today=local.year+'-'+local.month+'-'+local.day,weekday=new Date(today+'T12:00:00Z').getUTCDay(),weekExtra=((weekday+6)%7)>0?2:0;
  if(weekExtra){const before=Date.now;try{const earlier=Date.parse(today+'T12:00:00Z')-86400000;Date.now=()=>earlier;for(let index=0;index<weekExtra;index++)await action('call.record',{leadId:northLead.id},'c-noord',noor.headers);}finally{Date.now=before;}}
  const zero=await member('Daan Zonder Calls','zero@example.test','c-noord');
  const broken=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'focus-invalid-source',items:[{externalId:'invalid'}]}});assert.equal(broken.status,400);
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
  return{page,south,empty,northLead,southLead,sharedLead,noor,bas,zero,weekExtra,action,snapshot,dispatch,current,errors,requests,
   card:id=>page.locator('.admin-company-card[data-company-id="'+id+'"]'),
   async global(){await page.goto(origin+'/#all-companies');await page.locator('#main').waitFor({state:'visible'});},
   holdRead(){let start,release,finished,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Background overview refresh did not start')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finished=resolve);t.after(()=>{clearTimeout(timer);release();});nextRead={started:start,released,finished};return{started,release,done};}};
 }
 const filter=(f,name)=>f.page.locator('[data-admin-filter="'+name+'"]');
 const activities=f=>f.page.locator('[data-admin-activity]');
 async function select(f,name,value){await filter(f,name).selectOption(value);}
 async function showCompanyCards(f){const details=f.page.locator('.admin-company-details');if(await details.count())await details.evaluate(node=>{node.open=true;});}


 const staff=(f,id)=>f.page.locator('[data-admin-staff][data-user-id="'+id+'"]');
 const companyCalls=(f,id)=>f.page.locator('[data-admin-company-calls][data-company-id="'+id+'"]');
 const number=async(locator,selector)=>Number((await locator.locator(selector).innerText()).trim());
 async function assertCounts(f,extra=0){
  assert.equal(await number(companyCalls(f,'c-noord'),'[data-admin-company-call-count]'),1+extra);
  assert.equal(await number(companyCalls(f,f.south.id),'[data-admin-company-call-count]'),1);
  assert.equal(await number(companyCalls(f,f.empty.id),'[data-admin-company-call-count]'),0);
  assert.equal(await number(staff(f,f.noor.user.id),'[data-admin-staff-count]'),1+extra);
  assert.equal(await number(staff(f,f.bas.user.id),'[data-admin-staff-count]'),1);
  assert.equal(await number(staff(f,f.zero.user.id),'[data-admin-staff-count]'),0);
 }
 await t.test('attention is the first business section and includes actual follow-up and source failures',async t=>{
  const f=await fixture(t);await f.page.locator('[data-admin-attention-section]').waitFor({state:'visible'});
  const section=f.page.locator('[data-admin-attention-section]'),text=await section.innerText();
  assert.match(text,/Noor moet terugbellen/);assert.match(text,/Bas moet terugbellen/);assert.match(text,/Bouwberichten/i);
  assert.equal(await section.locator('[data-admin-attention]').count(),3);
  assert.equal(await f.page.evaluate(()=>{const attention=document.querySelector('[data-admin-attention-section]'),summary=document.querySelector('.admin-overview-summary'),activity=document.querySelector('.admin-activity-list');return !!(attention.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(attention.compareDocumentPosition(activity)&Node.DOCUMENT_POSITION_FOLLOWING);}),true);
  assert.deepEqual(f.errors,[]);
 });
 await t.test('the start page shows real calls by company and employee, including zero activity',async t=>{
  const f=await fixture(t);await f.page.locator('[data-admin-calls-period]').waitFor({state:'visible'});
  assert.equal(await f.page.locator('[data-admin-calls-period]').inputValue(),'today');await assertCounts(f);
  assert.match(await f.page.locator('[data-admin-stat="callsToday"]').innerText(),/\b2\b/);
  assert.match(await f.page.locator('[data-admin-stat="callsThisWeek"]').innerText(),new RegExp('\\b'+(2+f.weekExtra)+'\\b'));
  await f.page.locator('[data-admin-calls-period]').selectOption('week');await assertCounts(f,f.weekExtra);
  assert.equal(await filter(f,'type').inputValue(),'notes-status');assert.deepEqual(f.errors,[]);
 });
 await t.test('the default history shows notes and genuine before/after status changes with their maker',async t=>{
  const f=await fixture(t);await activities(f).first().waitFor({state:'visible'});
  assert.equal(await filter(f,'type').inputValue(),'notes-status');assert.equal(await filter(f,'period').inputValue(),'7d');
  const all=(await activities(f).allTextContents()).join(' ');assert.ok(all.includes(texts.north));assert.ok(all.includes(texts.south));
  assert.match(all,/Nieuw.*Opvolgen/);assert.match(all,/Nieuw.*Offerte/);assert.match(all,/Noor Noord/);assert.match(all,/Bas Zuid/);
  assert.equal(all.includes('Kanban-kolommen bijgewerkt'),false);assert.equal(all.includes('Nieuwe centrale lead'),false);assert.equal(all.includes('Belmoment geregistreerd'),false);
  // Renaming the current column does not rewrite the actual status-change snapshot.
  assert.equal(all.includes('Nieuw → Calculatiegesprek'),false);assert.deepEqual(f.errors,[]);
 });
 await t.test('history company filters do not hide all-company attention or call counts',async t=>{
  const f=await fixture(t);await select(f,'company',f.south.id);
  const visible=(await activities(f).allTextContents()).join(' ');assert.ok(visible.includes(texts.south));assert.equal(visible.includes(texts.north),false);
  assert.ok((await f.page.locator('[data-admin-attention-section]').innerText()).includes('Noor moet terugbellen'));await assertCounts(f);
  const item=activities(f).filter({hasText:texts.south}).first();await item.locator('[data-action="admin-open-lead"]').click();
  await f.page.locator('.workbook-drawer').waitFor({state:'visible'});assert.match(await f.page.locator('#workbook-followup').innerText(),/Zuid Vastgoed/);
  await f.page.locator('[data-action="close-drawer"]').last().click();assert.equal(await filter(f,'company').inputValue(),f.south.id);assert.deepEqual(f.errors,[]);
 });
 await t.test('a periodic refresh adds a colleague note and updates call numbers without losing overview choices',async t=>{
  const f=await fixture(t);await f.page.locator('[data-admin-calls-period]').selectOption('week');const text='Nieuwe notitie voor de dagelijkse beheerstartpagina.';
  await f.action('note.add',{leadId:f.southLead.id,text},f.south.id,f.bas.headers);await f.action('call.record',{leadId:f.southLead.id},f.south.id,f.bas.headers);
  await f.page.locator('#main h1').click();await f.page.evaluate(()=>window.__overviewTimers.find(timer=>timer.ms===30000).callback());
  await activities(f).filter({hasText:text}).waitFor({state:'visible'});assert.equal(await f.page.locator('[data-admin-calls-period]').inputValue(),'week');
  assert.equal(await number(companyCalls(f,f.south.id),'[data-admin-company-call-count]'),2);assert.equal(await number(staff(f,f.bas.user.id),'[data-admin-staff-count]'),2);
  assert.equal(await filter(f,'type').inputValue(),'notes-status');assert.deepEqual(f.errors,[]);
 });
 for(const role of ['verkoper','bedrijfsbeheerder'])await t.test(role+' remains limited to the own-company dashboard',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('[data-admin-attention-section],[data-admin-staff],[data-admin-company-calls]').count(),0);
  await f.global();assert.equal(await f.page.locator('[data-admin-attention-section],[data-admin-staff],[data-admin-activity]').count(),0);
  assert.equal((await f.page.locator('#main').innerText()).includes(texts.north),false);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': attention, employee counts and history fit the page in priority order',async t=>{
  const f=await fixture(t,{mobile}),viewport=f.page.viewportSize();await f.page.locator('[data-admin-attention-section]').waitFor({state:'visible'});
  const attention=await f.page.locator('[data-admin-attention-section]').boundingBox(),calls=await f.page.locator('[data-admin-calls-period]').boundingBox();assert.ok(attention&&calls&&attention.y<calls.y);
  for(const element of await f.page.locator('[data-admin-attention-section],[data-admin-staff],[data-admin-company-calls],[data-admin-filter],[data-admin-activity]').all()){
   const box=await element.boundingBox();assert.ok(box&&box.width>0&&box.x>=-1&&box.x+box.width<=viewport.width+1,'Focused overview must fit the viewport');
  }
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(process.env.ADMIN_FOCUS_SCREENSHOTS==='1'){await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/admin-focus-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});}
  assert.deepEqual(f.errors,[]);
 });
});
