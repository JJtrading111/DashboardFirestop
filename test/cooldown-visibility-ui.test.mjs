import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createApp} from '../server.mjs';
import {buildCallReport,reportRows} from '../public/model.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(value=>value&&existsSync(value));
const origin='https://cooldown-visibility-ui.example.test',email='visibility-owner@example.test',password='Visibility-browser-password-2026!';
const hiddenTitle='Verborgen Bouwproject Zandhaven',visibleTitle='Beschikbaar Bouwproject Havenzicht',externalId='880001';
const nativeNow=Date.now.bind(Date);

test('foreign cooldown projects disappear from company worklists while personal callbacks and report history remain correct',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium for visibility browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{actor='b',called=true,callback='none'}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:email,adminName:'Overkoepelende beheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  let offset=0,dispatchQueue=Promise.resolve();
  function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const task=dispatchQueue.then(async()=>{
    const originalNow=Date.now;Date.now=()=>nativeNow()+offset;
    try{
     const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
     const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
     await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
    }finally{Date.now=originalNow;}
   });dispatchQueue=task.catch(()=>{});return task;
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const owner={user:login.json().user,cookie:login.headers['set-cookie'].split(';')[0]};owner.headers={cookie:owner.cookie,'x-csrf-token':login.json().csrfToken};
  const ok=response=>{assert.equal(response.status,200,response.bytes.toString());return response.json();};
  const action=async(type,payload={},companyId='c-noord',member=owner)=>ok(await dispatch('/api/action',{method:'POST',headers:member.headers,body:{type,companyId,payload}}));
  const snapshot=async(member=owner,companyId=member.user.companyId||'c-noord')=>ok(await dispatch('/api/state?companyId='+encodeURIComponent(companyId),{headers:member.headers})).state;
  const companyB=(await action('company.create',{name:'Firma B'})).result.company,companyC=(await action('company.create',{name:'Firma C'})).result.company;
  async function member(name,address,companyId,role='verkoper'){
   const invitation=(await action('invitation.create',{name,email:address,companyId,role})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}});assert.equal(activated.status,200);
   const record={user:activated.json().user,cookie:activated.headers['set-cookie'].split(';')[0]};record.headers={cookie:record.cookie,'x-csrf-token':activated.json().csrfToken};return record;
  }
  const a=await member('Verkoper A','a@example.test','c-noord'),aColleague=await member('Collega A','a-colleague@example.test','c-noord');
  const b=await member('Verkoper B','b@example.test',companyB.id),manager=await member('Beheerder B','manager-b@example.test',companyB.id,'bedrijfsbeheerder'),c=await member('Verkoper C','c@example.test',companyC.id);
  const people={owner,a,aColleague,b,manager,c},current=people[actor];
  const key=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  ok(await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'visibility-projects',items:[{externalId,title:hiddenTitle,organization:'Verborgen aannemer',city:'Utrecht',contact:'Broncontact',phone:'030-2222222',email:'hidden@example.test',description:'Vertrouwelijke projectdetails Zandhaven.'},{externalId:'880002',title:visibleTitle,organization:'Zichtbare aannemer',city:'Amersfoort',phone:'033-1111111'}]}}));
  const initial=await snapshot(),lead=initial.leads.find(item=>item.importExternalId===externalId),visible=initial.leads.find(item=>item.importExternalId==='880002');
  await action('settings.update',{cooldownHours:0});offset=-2*3600000;await action('call.record',{leadId:lead.id},companyB.id,b);offset=0;
  await action('workspace.save',{leadId:lead.id,changes:{ownerId:b.user.id,commitment:true,calculation:true},note:{id:'note-11111111-1111-4111-8111-111111111111',text:'Historische notitie van Firma B.'}},companyB.id,b);
  if(callback!=='none')await action('callback.add',{leadId:lead.id,assigneeId:callback==='colleague'?manager.user.id:b.user.id,dueAt:new Date(nativeNow()+(callback==='future'?600000:-60000)).toISOString(),description:'Eigen terugbelafspraak'},companyB.id,b);
  await action('settings.update',{cooldownHours:1});const before=await snapshot(b);
  const callA=async()=>action('call.record',{leadId:lead.id},'c-noord',a);if(called)await callA();
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});t.after(()=>context.close());
  await context.addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await context.addInitScript(()=>{const actualNow=Date.now.bind(Date);window.__visibilityOffset=0;Date.now=()=>actualNow()+window.__visibilityOffset;window.__visibilityTimers=[];window.setInterval=(callback,ms,...args)=>{window.__visibilityTimers.push({callback:()=>callback(...args),ms});return window.__visibilityTimers.length;};});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  async function navigate(route){await page.goto(origin+'/#'+route);await page.locator('#main h1').waitFor({state:'visible'});}
  async function tick(){await page.evaluate(async()=>{for(const timer of window.__visibilityTimers.filter(timer=>timer.ms===30000))await timer.callback();});}
  await navigate('leads');
  return{page,context,current,people,companyB,companyC,lead,visible,before,errors,action,snapshot,dispatch,callA,navigate,tick,
   async advance(milliseconds){offset+=milliseconds;await page.evaluate(value=>window.__visibilityOffset=value,offset);await tick();}};
 }
 const hasLead=f=>f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').count();

 for(const actor of ['b','manager'])await t.test(actor+': hidden leads cannot be found in worklists, search, feed, callbacks or exports',async t=>{
  const f=await fixture(t,{actor});const scoped=await f.snapshot(f.current);
  assert.equal(scoped.leads.some(lead=>lead.id===f.lead.id),false);assert.equal(await hasLead(f),0);
  for(const route of ['leads','kanban','calls','dashboard','callbacks','feed']){
   await f.navigate(route);const text=await f.page.locator('#main').innerText();assert.equal(text.includes(hiddenTitle),false,route);assert.equal(text.includes(externalId),false,route);
   assert.equal(await f.page.locator('[data-action="open-lead"][data-id="'+f.lead.id+'"]').count(),0,route);
  }
  await f.navigate('leads');await f.page.locator('#lead-search').fill(externalId);
  await f.page.waitForFunction(()=>document.querySelector('[data-lead-search-count]')?.textContent.trim().startsWith('0 '));assert.equal(await hasLead(f),0);
  await f.page.locator('#lead-search').fill('');await f.page.waitForFunction(()=>document.querySelector('[data-lead-search-count]')?.textContent.trim().startsWith('1 '));
  const downloaded=f.page.waitForEvent('download');await f.page.locator('[data-action="export"]').click();const download=await downloaded,stream=await download.createReadStream();let csv='';for await(const bytes of stream)csv+=bytes.toString();
  assert.equal(csv.includes(hiddenTitle),false);assert.equal(csv.includes(externalId),false);assert.ok(csv.includes(visibleTitle));assert.deepEqual(f.errors,[]);
 });

 await t.test('the calling firm and its colleagues retain the lead, while a third company cannot see it',async t=>{
  for(const actor of ['a','aColleague','c']){const f=await fixture(t,{actor}),visible=actor!=='c';assert.equal(await hasLead(f)>0,visible,actor);assert.equal((await f.snapshot(f.current)).leads.some(lead=>lead.id===f.lead.id),visible);assert.deepEqual(f.errors,[]);}
 });

 await t.test('only a personally assigned callback whose time has arrived reveals a blocked project',async t=>{
  for(const [actor,callback,expected]of [['b','own',true],['b','colleague',false],['manager','own',false],['b','future',false]]){
   const f=await fixture(t,{actor,callback});assert.equal(await hasLead(f)>0,expected,actor+' '+callback);assert.deepEqual(f.errors,[]);
  }
 });

 await t.test('completing the personal callback closes the newly locked lead and clears its overlay and keyboard focus trap',async t=>{
  const f=await fixture(t,{callback:'own'});await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').first().click();await f.page.locator('.workbook-drawer').waitFor({state:'visible'});
  assert.equal(await f.page.locator('body.overlay-open').count(),1);await f.page.locator('.workbook-drawer [data-action="complete-callback"]').click();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});
  assert.equal(await f.page.locator('.detail-overlay,.modal').count(),0);assert.equal(await f.page.locator('body.overlay-open').count(),0);assert.equal((await f.page.locator('#overlay-root').innerHTML()).trim(),'');assert.equal(await hasLead(f),0);
  await f.page.keyboard.press('Tab');await f.page.keyboard.press('Shift+Tab');const state=await f.snapshot(f.current);assert.equal(state.leads.some(lead=>lead.id===f.lead.id),false);assert.ok(state.workspaces[f.companyB.id][f.lead.id].callbacks.every(callback=>callback.done));assert.deepEqual(f.errors,[]);
 });

 await t.test('a future personal callback reveals the project on the next refresh when its due time arrives',async t=>{
  const f=await fixture(t,{callback:'future'});assert.equal(await hasLead(f),0);await f.advance(11*60000);
  await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').first().waitFor({state:'visible'});assert.equal((await f.snapshot(f.current)).leads.some(lead=>lead.id===f.lead.id),true);assert.deepEqual(f.errors,[]);
 });

 await t.test('expiry and changing the global wait to zero make the project visible again without reimport',async t=>{
  const expired=await fixture(t);assert.equal(await hasLead(expired),0);await expired.advance(61*60000);assert.ok(await hasLead(expired)>0);assert.deepEqual(expired.errors,[]);
  const zero=await fixture(t);assert.equal(await hasLead(zero),0);await zero.action('settings.update',{cooldownHours:0});await zero.tick();assert.ok(await hasLead(zero)>0);assert.deepEqual(zero.errors,[]);
 });

 await t.test('an already open project closes after another company calls it without saving the stale draft or claiming deletion',async t=>{
  const f=await fixture(t,{called:false});await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').first().click();await f.page.locator('.workbook-drawer').waitFor({state:'visible'});
  await f.page.locator('#note-form textarea').fill('Dit concept mag niet worden opgeslagen.');await f.callA();await f.tick();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});
  const toast=await f.page.locator('#toast-root').innerText();assert.match(toast,/wachttijd|tijdelijk niet beschikbaar/i);assert.doesNotMatch(toast,/voor alle bedrijven verwijderd/i);assert.equal(await hasLead(f),0);
  const raw=await f.snapshot(f.people.owner);assert.equal(raw.workspaces[f.companyB.id][f.lead.id].notes.some(note=>note.text==='Dit concept mag niet worden opgeslagen.'),false);assert.deepEqual(f.errors,[]);
 });

 await t.test('own historical calls and conversion/source cohorts retain exact report values while the active project is hidden',async t=>{
  const f=await fixture(t),after=await f.snapshot(f.current);assert.equal(after.leads.some(lead=>lead.id===f.lead.id),false);
  assert.deepEqual(buildCallReport(after),buildCallReport(f.before));assert.deepEqual(reportRows(after),reportRows(f.before));
  assert.deepEqual(reportRows(after,{companyId:f.companyB.id,source:'bouw'}),reportRows(f.before,{companyId:f.companyB.id,source:'bouw'}));
  await f.navigate('reports');assert.equal((await f.page.locator('#main').innerText()).includes(hiddenTitle),false);assert.deepEqual(f.errors,[]);
 });

 await t.test('chief oversight remains complete while company worklists follow the selected firm visibility',async t=>{
  const f=await fixture(t,{actor:'owner'}),all=await f.snapshot(f.people.owner);assert.ok(all.leads.some(lead=>lead.id===f.lead.id));
  await f.navigate('dashboard');assert.equal(await f.page.locator('.controlekamer').count(),1);assert.ok((await f.page.locator('#main').innerText()).includes(hiddenTitle));
  for(const route of ['leads','kanban','calls']){await f.navigate(route);await f.page.locator('#company-switch').selectOption(f.companyB.id);await f.page.waitForFunction(id=>!document.querySelector('#main [data-action="open-lead"][data-id="'+id+'"]'),f.lead.id);assert.equal(await hasLead(f),0,route);assert.equal((await f.page.locator('#main').innerText()).includes(hiddenTitle),false,route);}
  assert.deepEqual(f.errors,[]);
 });

 await t.test('the chief can open the seller overview from the management menu and switch the company context without losing global oversight',async t=>{
  const f=await fixture(t,{actor:'owner'}),menu=f.page.locator('.sidebar [data-route="seller-overview"]');
  assert.equal(await menu.count(),1);await menu.click();await f.page.waitForURL('**/#seller-overview');assert.equal(await f.page.locator('#main h1').innerText(),'Elke kans in beeld.');
  assert.ok(await hasLead(f)>0,'The calling company keeps its project in the seller layout');assert.equal(await f.page.locator('.controlekamer').count(),0);
  await f.page.locator('#company-switch').selectOption(f.companyB.id);await f.page.waitForFunction(id=>!document.querySelector('#main [data-action="open-lead"][data-id="'+id+'"]'),f.lead.id);
  assert.equal((await f.page.locator('#main').innerText()).includes(hiddenTitle),false);assert.equal(await f.page.locator('#main h1').innerText(),'Elke kans in beeld.');
  await f.page.locator('#company-switch').selectOption('c-noord');await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').first().waitFor({state:'visible'});
  assert.equal((await f.snapshot(f.people.owner)).users.find(user=>user.id===f.people.owner.user.id).role,'hoofdbeheerder');
  await f.page.locator('.sidebar button[data-route="dashboard"]').click();await f.page.locator('.controlekamer').waitFor({state:'visible'});assert.equal(await f.page.locator('#main h1').innerText(),'Alles in één oogopslag');assert.deepEqual(f.errors,[]);
 });

 await t.test('sellers and company managers cannot see or directly open the chief seller-overview route',async t=>{
  for(const actor of ['b','manager']){
   const f=await fixture(t,{actor});assert.equal(await f.page.locator('.sidebar [data-route="seller-overview"]').count(),0);
   await f.navigate('seller-overview');const text=await f.page.locator('#main').innerText();assert.match(text,/hoofdbeheerder|geen toegang/i);assert.equal(text.includes('Elke kans in beeld.'),false);assert.equal(text.includes(hiddenTitle),false);assert.equal(await f.page.locator('.controlekamer').count(),0);assert.deepEqual(f.errors,[]);
  }
 });

 await t.test('actual global deletion still has its distinct message after the visibility refresh logic changed',async t=>{
  const f=await fixture(t,{called:false});await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').first().click();await f.page.locator('.workbook-drawer').waitFor({state:'visible'});
  await f.action('lead.delete',{leadId:f.lead.id,confirmed:true});await f.tick();await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});assert.match(await f.page.locator('#toast-root').innerText(),/voor alle bedrijven verwijderd/i);assert.deepEqual(f.errors,[]);
 });
});
