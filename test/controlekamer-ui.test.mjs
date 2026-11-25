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
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(value=>value&&existsSync(value));
const origin='https://controlekamer-ui.example.test',email='controlekamer-owner@example.test',password='Controlekamer-ui-password-2026!';
const noteA='Receptioniste wil de informatie per mail. Morgen tb.';
const noteB='Alles is al geregeld, pand opgeleverd.';
const noteD='Vanmiddag terugbellen; graag een e-mail met informatie.';
const localDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

test('the Controlekamer uses live authorized records, consistent company scopes and one refresh coordinator in Chrome',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium for Controlekamer browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false,empty=false,extraNotes=0,reducedMotion='reduce'}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:email,adminName:'Hoofdbeheer Controlekamer',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':login.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',actorHeaders=headers){const response=await dispatch('/api/action',{method:'POST',headers:actorHeaders,body:{type,companyId,payload}});assert.equal(response.status,200,response.bytes.toString());return response.json();}
  async function snapshot(companyId='',actorHeaders=headers){const response=await dispatch('/api/state'+(companyId?'?companyId='+encodeURIComponent(companyId):''),{headers:actorHeaders});assert.equal(response.status,200,response.bytes.toString());return response.json().state;}
  async function member(name,address,companyId,memberRole='verkoper'){
   const invitation=(await action('invitation.create',{name,email:address,companyId,role:memberRole})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}});assert.equal(activated.status,200);
   const memberCookie=activated.headers['set-cookie'].split(';')[0];return{user:activated.json().user,cookie:memberCookie,headers:{cookie:memberCookie,'x-csrf-token':activated.json().csrfToken}};
  }
  let guard,seal,remond,jacco,maria,jan,alpha,beta,gamma,newLead,archived,current={user:login.json().user,cookie,headers};
  if(!empty){
   await action('company.update',{companyId:'c-noord',name:'Flamestop'});guard=(await action('company.create',{name:'Flameguard'})).result.company;seal=(await action('company.create',{name:'Flameseal'})).result.company;
   await action('user.update',{userId:'u-admin',role:'hoofdbeheerder',companyId:null});
   remond=await member('Remond Stop','remond@example.test','c-noord');maria=await member('Maria Zonder Belmoment','maria@example.test','c-noord');jacco=await member('Jacco Guard','jacco@example.test',guard.id);jan=await member('Jan Seal','jan@example.test',seal.id);
   await action('settings.update',{cooldownHours:0});const key=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
   const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'controlekamer-fixture',items:[['ck-alpha','Project Alpha'],['ck-beta','Project Beta'],['ck-gamma','Project Gamma'],['ck-new','Nieuw Project'],['ck-archive','Historisch Archiefproject']].map(([externalId,title])=>({externalId,title,city:'Utrecht',organization:'Testaannemer'}))}});assert.equal(imported.status,200);
   const state=await snapshot();[alpha,beta,gamma,newLead,archived]=['ck-alpha','ck-beta','ck-gamma','ck-new','ck-archive'].map(id=>state.leads.find(lead=>lead.importExternalId===id));
   await action('call.record',{leadId:alpha.id,outcome:'reached'},'c-noord',remond.headers);await action('call.record',{leadId:alpha.id,outcome:'unanswered'},'c-noord',remond.headers);
   await action('workspace.save',{leadId:alpha.id,changes:{status:'opvolgen'},note:{id:'note-'+randomUUID(),text:noteA}},'c-noord',remond.headers);
   await action('call.record',{leadId:beta.id,outcome:'reached'},guard.id,jacco.headers);await action('workspace.save',{leadId:beta.id,changes:{status:'offerte'},note:{id:'note-'+randomUUID(),text:noteB}},guard.id,jacco.headers);
   await action('note.add',{leadId:newLead.id,text:noteD});await action('workspace.update',{leadId:gamma.id,field:'priority',value:'high'});
   await action('callback.add',{leadId:beta.id,assigneeId:remond.user.id,dueAt:new Date(Date.now()-3600000).toISOString(),description:'Verlopen controlekamerafspraak'});
   await action('call.record',{leadId:archived.id},'c-noord',remond.headers);await action('workspace.save',{leadId:archived.id,changes:{status:'offerte'},note:{id:'note-'+randomUUID(),text:'Historische notitie blijft in rapportages.'}},'c-noord',remond.headers);await action('lead.delete',{leadId:archived.id,confirmed:true,reason:'Geen werkzaamheden'});
   const realNow=Date.now;try{Date.now=()=>realNow()-86400000;await action('note.add',{leadId:alpha.id,text:'Gisteren tb en mail; hoort niet bij vandaag.'},'c-noord',remond.headers);}finally{Date.now=realNow;}
   for(let index=0;index<extraNotes;index++)await action('note.add',{leadId:beta.id,text:'Extra actuele notitie '+index},guard.id,jacco.headers);
   const bad=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'controlekamer-invalid',items:[{externalId:'invalid'}]}});assert.equal(bad.status,400);
   if(role==='verkoper')current=remond;
   if(role==='bedrijfsbeheerder')current=await member('Beheerder Stop','manager@example.test','c-noord','bedrijfsbeheerder');
  }
  const clock=Date.now()+300000,context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,reducedMotion});t.after(()=>context.close());
  await context.addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await context.addInitScript(value=>{window.__ckClock=value;Date.now=()=>window.__ckClock;window.__ckTimers=[];window.setInterval=(callback,ms,...args)=>{const timer={id:90000+window.__ckTimers.length,callback:()=>callback(...args),ms,active:true};window.__ckTimers.push(timer);return timer.id;};window.clearInterval=id=>{const timer=window.__ckTimers.find(item=>item.id===id);if(timer)timer.active=false;};},clock);
  const page=await context.newPage(),errors=[],requests=[];let failRead=false,nextRead=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();requests.push({path:url.pathname,method:request.method()});
   const read=url.pathname==='/api/state',hold=read?nextRead:null;if(hold)nextRead=null;
   const response=read&&failRead?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Verversen tijdelijk niet mogelijk'}))}:await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});
   if(read)failRead=false;if(hold){hold.started();await hold.released;}
   try{await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});}catch(error){if(!request.failure()&&!page.isClosed())throw error;}finally{hold?.finished();}
  });
  await page.goto(origin+'/#dashboard');await page.locator('#main h1').waitFor({state:'visible'});
  return{page,context,errors,requests,current,guard,seal,remond,jacco,maria,jan,alpha,beta,gamma,newLead,archived,clock,action,snapshot,dispatch,
   failNextRead(){failRead=true;},
   reads(){return requests.filter(request=>request.path==='/api/state').length;},
   async tick(delta=1000,interval=1000){await page.evaluate(async({delta,interval})=>{window.__ckClock+=delta;for(const timer of window.__ckTimers.filter(timer=>timer.active&&timer.ms===interval))await timer.callback();},{delta,interval});},
   holdRead(){let start,release,finish;const started=new Promise(resolve=>start=resolve),released=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finish=resolve);nextRead={started:start,released,finished:finish};t.after(()=>release());return{started,release,done};}
  };
 }
 const section=(f,key)=>f.page.locator('[data-ck-section="'+key+'"]');
 const chip=(f,id)=>f.page.locator('[data-action="ck-company"][data-company-id="'+id+'"]');
 const kpi=(f,key)=>f.page.locator('[data-ck-kpi="'+key+'"]');
 async function number(locator){return Number(await locator.locator('[data-ck-number]').first().getAttribute('data-value'));}
 async function totals(f,expected){for(const[key,value]of Object.entries(expected))assert.equal(await number(kpi(f,key)),value,key);}
 async function selectCompany(f,id){await chip(f,id).click();assert.equal(await chip(f,id).getAttribute('aria-pressed'),'true');}
 async function back(f){const button=f.page.getByRole('button',{name:'Terug naar Controlekamer',exact:true});await button.click();await f.page.locator('.controlekamer').waitFor({state:'visible'});}

 await t.test('all sections use actual today records, deduplicate calls and keep archived history out of active work',async t=>{
  const f=await fixture(t);assert.equal(await f.page.locator('#main h1').innerText(),'Alles in één oogopslag');
  for(const key of ['health','actions','kpis','companies','team','signals','hours','pipeline','timeline'])assert.equal(await section(f,key).count(),1,key);
  await totals(f,{calls:4,notes:4,status:3,active:2});assert.match(await kpi(f,'active').innerText(),/2\s*(?:\/|van)\s*4/);
  assert.equal(await f.page.locator('[data-action="ck-company"]').count(),4);assert.match(await chip(f,'c-noord').innerText(),/3/);assert.match(await chip(f,f.guard.id).innerText(),/1/);
  const team=await section(f,'team').innerText();for(const name of ['Remond Stop','Maria Zonder Belmoment','Jacco Guard','Jan Seal'])assert.ok(team.includes(name),name);assert.match(team,/Nog geen belmoment/);
  assert.equal(await f.page.locator('[data-ck-event-id]').count(),7);assert.equal(await f.page.locator('[data-ck-event-id]').filter({hasText:'Gisteren'}).count(),0);
  for(const[key,value]of [['mail',2],['callback',2],['done',1]])assert.equal(Number(await section(f,'signals').locator('[data-ck-number="signal-'+key+'"]').getAttribute('data-value')),value,key);
  const pipeline=await section(f,'pipeline').locator('[data-ck-number]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.value)));assert.deepEqual(pipeline,[10,0,1,1,0]);assert.equal(await section(f,'pipeline').locator('.ck-pipeline-warning').count(),0);
  assert.equal(await section(f,'actions').locator('[data-lead-id="'+f.archived.id+'"]').count(),0);assert.match(await section(f,'health').innerText(),/2.*4/s);assert.match(await section(f,'pipeline').innerText(),/Nieuw/);
  assert.equal(await f.page.locator('[data-ck-hour]').count(),10);assert.deepEqual(await f.page.locator('[data-ck-hour]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.ckHour))),[8,9,10,11,12,13,14,15,16,17]);
  const state=await f.snapshot(),today=localDay(f.clock),events=[...Object.values(state.workspaces).flatMap(workspace=>Object.values(workspace).flatMap(work=>work.notes.map(note=>note.createdAt))),...state.feed.filter(event=>event.type==='status').map(event=>event.at)].filter(at=>Date.parse(at)<=f.clock&&localDay(at)===today),currentHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date(f.clock)));
  for(const hour of await f.page.locator('[data-ck-hour]').all()){const index=Number(await hour.getAttribute('data-ck-hour')),expected=events.filter(at=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date(at)))===index).length;assert.equal(Number(await hour.getAttribute('data-count')),expected);assert.equal(await hour.getAttribute('data-current'),String(index===currentHour));assert.equal(await hour.getAttribute('data-future'),String(index>currentHour));if(index>currentHour)assert.match(await hour.locator('.ck-hour-bar').evaluate(node=>getComputedStyle(node).backgroundImage),/gradient/);}
  assert.deepEqual(f.errors,[]);
 });

 await t.test('company chips filter every business section and shared source errors appear only for all companies',async t=>{
  const f=await fixture(t);assert.ok(await section(f,'actions').locator('[data-kind="logbook"]').count());
  await selectCompany(f,'c-noord');await totals(f,{calls:3,notes:3,status:2,active:1});assert.match(await kpi(f,'active').innerText(),/1\s*(?:\/|van)\s*2/);
  assert.equal(await section(f,'actions').locator('[data-kind="logbook"]').count(),0);assert.equal(await f.page.locator('[data-ck-health="sources"] strong').innerText(),'—');assert.equal((await section(f,'team').innerText()).includes('Jacco Guard'),false);assert.equal((await section(f,'companies').innerText()).includes('Flameguard'),false);
  for(const event of await f.page.locator('[data-ck-event-id]').all())assert.equal((await event.innerText()).includes('Flameguard'),false);
  await selectCompany(f,f.seal.id);await totals(f,{calls:0,notes:0,status:0,active:0});assert.match(await section(f,'team').innerText(),/Jan Seal/);assert.match(await section(f,'companies').innerText(),/vandaag nog niet gebeld/i);assert.match(await section(f,'pipeline').locator('.ck-pipeline-warning').innerText(),/100%/);assert.equal(await f.page.locator('[data-ck-event-id]').count(),0);for(const signal of await section(f,'signals').locator('[data-ck-number]').all())assert.equal(await signal.getAttribute('data-value'),'0');
  await selectCompany(f,'all');await totals(f,{calls:4,notes:4,status:3,active:2});assert.ok(await section(f,'actions').locator('[data-kind="logbook"]').count());assert.deepEqual(f.errors,[]);
 });

 await t.test('timeline chips show true type counts, more reveals saved events and note text stays literal',async t=>{
  const f=await fixture(t,{extraNotes:12});await totals(f,{calls:4,notes:16,status:3});assert.equal(await f.page.locator('[data-ck-event-id]').count(),8);
  await f.page.locator('[data-action="ck-type"][data-type="status"]').click();assert.equal(await f.page.locator('[data-ck-event-id]').count(),3);assert.equal(await f.page.locator('[data-ck-event-type="note"]').count(),0);await totals(f,{notes:16,status:3});
  await f.page.locator('[data-action="ck-type"][data-type="all"]').click();await f.page.locator('[data-action="ck-more"]').click();assert.equal(await f.page.locator('[data-ck-event-id]').count(),19);
  const text='Nieuwe notitie <img src=x onerror="window.ckXss=1">';await f.action('note.add',{leadId:f.alpha.id,text},'c-noord',f.remond.headers);await f.page.locator('[data-action="ck-refresh"]').click();await f.page.locator('[data-ck-event-id]').filter({hasText:text}).waitFor({state:'visible'});
  assert.equal(await f.page.evaluate(()=>window.ckXss),undefined);assert.equal(await section(f,'timeline').locator('img,script').count(),0);assert.deepEqual(f.errors,[]);
 });

 await t.test('action buttons open the actual logbook, call report, lead planning and filtered company Kanban',async t=>{
  const f=await fixture(t);await section(f,'actions').locator('[data-kind="logbook"]').first().click();await f.page.waitForURL('**/#logbook');await back(f);
  const report=section(f,'actions').locator('[data-kind="report"]').first(),companyId=await report.getAttribute('data-company-id'),userId=await report.getAttribute('data-user-id');await report.click();await f.page.waitForURL('**/#reports');assert.equal(await f.page.locator('.call-report-page').count(),1);
  if(companyId)assert.equal(await f.page.locator('[data-call-report-filter="company"]').inputValue(),companyId);if(userId)assert.equal(await f.page.locator('[data-call-report-filter="seller"]').inputValue(),userId);await back(f);
  const callback=section(f,'actions').locator('[data-kind="callback"]').first(),leadId=await callback.getAttribute('data-lead-id');await callback.click();await f.page.locator('#callback-form').waitFor({state:'visible'});assert.equal(await f.page.locator('#callback-form [name="leadId"]').inputValue(),leadId);
  await f.page.locator('#callback-form [name="description"]').fill('Mijn ingevoerde afspraak blijft staan');await f.tick(30000);assert.equal(await f.page.locator('#callback-form [name="description"]').inputValue(),'Mijn ingevoerde afspraak blijft staan');await f.page.keyboard.press('Escape');await f.page.locator('[data-action="close-drawer"]').last().click();
  const kanban=section(f,'actions').locator('[data-kind="kanban"]').first(),columnId=await kanban.getAttribute('data-column-id');await kanban.click();await f.page.waitForURL('**/#kanban');if(columnId)assert.equal(await f.page.locator('[data-field="status"]').inputValue(),columnId);await back(f);assert.deepEqual(f.errors,[]);
 });

 await t.test('the countdown and manual refresh share one request schedule and failures are never reported as a successful live update',async t=>{
  const f=await fixture(t),before=f.reads();await f.tick(5000);assert.match(await f.page.locator('[data-ck-seconds]').innerText(),/25/);assert.equal(f.reads(),before);
  await f.tick(25000);await f.page.waitForFunction(()=>document.querySelector('[data-ck-seconds]')?.textContent.trim()==='30');assert.equal(f.reads(),before+1);
  await f.tick(0,30000);assert.equal(f.reads(),before+1,'The legacy interval must not issue a duplicate Controlekamer request');
  const hold=f.holdRead();await f.page.locator('[data-action="ck-refresh"]').click();await hold.started;assert.equal(await f.page.locator('[data-action="ck-refresh"]').isDisabled(),true);hold.release();await hold.done;await f.page.waitForFunction(()=>!document.querySelector('[data-action="ck-refresh"]')?.disabled);assert.equal(f.reads(),before+2);assert.match(await f.page.locator('[data-ck-updated]').innerText(),/Bijgewerkt/);
  f.failNextRead();await f.page.locator('[data-action="ck-refresh"]').click();await f.page.waitForFunction(()=>!document.querySelector('[data-action="ck-refresh"]')?.disabled);assert.match(await f.page.locator('[data-ck-refresh-error]').innerText(),/Verversen tijdelijk niet mogelijk|verbinding|mislukt/i);
  assert.equal(await f.page.locator('[data-ck-updated]').isVisible(),false);await f.page.locator('[data-action="ck-refresh"]').click();await f.page.waitForFunction(()=>!document.querySelector('[data-action="ck-refresh"]')?.disabled);assert.deepEqual(f.errors,[]);
 });

 await t.test('empty data has honest zero states and nonchief users retain their existing own-company dashboard',async t=>{
  const empty=await fixture(t,{empty:true});await totals(empty,{calls:0,notes:0,status:0,active:0});assert.match(await section(empty,'timeline').innerText(),/geen activiteit|nog geen/i);assert.equal((await empty.page.locator('#main').innerText()).includes('NaN'),false);assert.equal(await empty.page.locator('[data-action="ck-company"]').count(),2);assert.deepEqual(empty.errors,[]);
  await empty.action('user.update',{userId:'u-admin',role:'hoofdbeheerder',companyId:null});await empty.action('company.delete',{companyId:'c-noord',confirmed:true});await empty.page.reload();await empty.page.locator('.controlekamer').waitFor({state:'visible'});await totals(empty,{calls:0,notes:0,status:0,active:0});assert.match(await kpi(empty,'active').innerText(),/0\s*\/\s*0/);assert.equal(await empty.page.locator('[data-action="ck-company"]').count(),1);assert.equal((await empty.snapshot()).companies.length,0);assert.deepEqual(empty.errors,[]);
  for(const role of ['verkoper','bedrijfsbeheerder']){const f=await fixture(t,{role});assert.equal(await f.page.locator('.controlekamer').count(),0);assert.match(await f.page.locator('#main h1').innerText(),/Elke kans/);await f.page.goto(origin+'/#all-companies');assert.equal(await f.page.locator('.controlekamer,[data-admin-activity]').count(),0);assert.deepEqual(f.errors,[]);}
 });

 await t.test('a transferred employee report keeps the same historical company scope as its displayed count',async t=>{
  const f=await fixture(t);await f.action('user.update',{userId:f.remond.user.id,role:'verkoper',companyId:f.guard.id});await f.page.reload();await f.page.locator('.controlekamer').waitFor({state:'visible'});
  const row=section(f,'team').locator('[data-ck-user="'+f.remond.user.id+'"]');assert.equal(await number(row),3);const report=row.locator('[data-action="ck-action"][data-kind="report"]');assert.equal(await report.getAttribute('data-company-id'),'all');await report.click();await f.page.waitForURL('**/#reports');assert.equal(await f.page.locator('[data-call-report-filter="company"]').inputValue(),'all');assert.equal(await f.page.locator('[data-call-report-filter="seller"]').inputValue(),f.remond.user.id);assert.equal(Number(await f.page.locator('[data-call-report-stat="calls"] .stat-value').innerText()),3);await back(f);
  await selectCompany(f,'c-noord');await totals(f,{calls:3,active:0});assert.match(await kpi(f,'active').innerText(),/0\s*\/\s*1/);const historical=section(f,'team').locator('[data-ck-user="'+f.remond.user.id+'"]');assert.equal(await number(historical),3);assert.match(await historical.innerText(),/Buiten huidig team/);const scoped=historical.locator('[data-action="ck-action"][data-kind="report"]');assert.equal(await scoped.getAttribute('data-company-id'),'c-noord');await scoped.click();await f.page.waitForURL('**/#reports');assert.equal(await f.page.locator('[data-call-report-filter="company"]').inputValue(),'c-noord');assert.equal(Number(await f.page.locator('[data-call-report-stat="calls"] .stat-value').innerText()),3);assert.deepEqual(f.errors,[]);
 });

 await t.test('leaving the Controlekamer and logging out prevents late refreshes from restoring private UI',async t=>{
  const f=await fixture(t),hold=f.holdRead();await f.page.locator('[data-action="ck-refresh"]').click();await hold.started;await f.page.locator('.profile-button[data-action="account"]').click();await f.page.getByRole('button',{name:'Uitloggen',exact:true}).click();await f.page.locator('#login-form').waitFor({state:'visible'});hold.release();await hold.done;
  assert.equal(await f.page.locator('.controlekamer,.app-shell').count(),0);assert.equal(await f.page.evaluate(()=>document.body.classList.contains('ck-dashboard')),false);assert.deepEqual(f.errors,[]);
 });

 await t.test('normal motion counts from the displayed value after filtering and highlights only a newly saved timeline item',async t=>{
  const f=await fixture(t,{reducedMotion:'no-preference'}),calls=kpi(f,'calls').locator('[data-ck-number]').first();await f.page.waitForFunction(()=>document.querySelector('[data-ck-kpi="calls"] [data-ck-number]')?.textContent.trim()==='4');
  const immediately=await f.page.evaluate(()=>{document.querySelector('[data-action="ck-company"][data-company-id="c-noord"]').click();const number=document.querySelector('[data-ck-kpi="calls"] [data-ck-number]');return{value:number.textContent,target:number.dataset.value};});assert.equal(immediately.value,'4');assert.equal(immediately.target,'3');await f.page.waitForFunction(()=>document.querySelector('[data-ck-kpi="calls"] [data-ck-number]')?.textContent.trim()==='3');
  const text='Nieuwe actuele notitie voor animatie';await f.action('note.add',{leadId:f.alpha.id,text},'c-noord',f.remond.headers);await f.page.locator('[data-action="ck-refresh"]').click();const fresh=f.page.locator('[data-ck-event-id]').filter({hasText:text});await fresh.waitFor({state:'visible'});assert.equal(await fresh.evaluate(node=>node.classList.contains('ck-fresh')),true);assert.notEqual(await fresh.evaluate(node=>getComputedStyle(node).animationName),'none');assert.equal(await f.page.locator('[data-ck-event-id].ck-fresh').count(),1);assert.deepEqual(f.errors,[]);
 });

 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': cards and navigation fit the viewport and reduced motion disables all decorative movement',async t=>{
  const f=await fixture(t,{mobile});await mkdir(fileURLToPath(new URL('../work/',import.meta.url)),{recursive:true});
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  for(const card of await f.page.locator('[data-ck-section]').all()){const box=await card.boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=f.page.viewportSize().width+1,JSON.stringify(box));}
  assert.equal(await f.page.evaluate(()=>[...document.querySelectorAll('.controlekamer,.controlekamer *')].every(node=>{const style=getComputedStyle(node);return style.animationName==='none'&&style.transitionDuration.split(',').every(value=>Number.parseFloat(value)===0);})),true);
  assert.equal(await section(f,'actions').locator('.ck-actions').evaluate(node=>node.scrollHeight<=node.clientHeight+1),true,'Every action remains visible rather than being clipped inside a hidden inner list');
  if(mobile){const sidebar=await f.page.locator('.sidebar').boundingBox(),main=await f.page.locator('#main').boundingBox();assert.ok(sidebar&&main&&sidebar.x>=0&&sidebar.width>=f.page.viewportSize().width-2&&main.y>=sidebar.y+sidebar.height-1,'Mobile navigation and cards stack vertically');}
  while(await f.page.locator('[data-action="dismiss-callback"]').count())await f.page.locator('[data-action="dismiss-callback"]').first().click();
  await f.page.screenshot({path:fileURLToPath(new URL('../work/controlekamer-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});assert.deepEqual(f.errors,[]);
 });
});
