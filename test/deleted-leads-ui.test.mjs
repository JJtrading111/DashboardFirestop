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
const origin='https://deleted-leads-ui.example.test',email='archive-owner@example.test',password='Deleted-leads-ui-password-2026!';
const maker='Beheerder bij verwijdering';
const longReason='Geen werkzaamheden voor de groep. '+('Historische toelichting met lange woorden en gegevens. '.repeat(10))+'\nTweede regel: <img src=x onerror="window.archiveXss=1">';

test('the chief can review deleted lead audit history in Chrome without reopening the work inventory',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium for archive browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false,empty=false,zeroCompanies=false,renameUser=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:email,adminName:maker,adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':login.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',actorHeaders=headers){const response=await dispatch('/api/action',{method:'POST',headers:actorHeaders,body:{type,companyId,payload}});assert.equal(response.status,200,response.bytes.toString());return response.json();}
  let current={cookie,headers};if(role!=='hoofdbeheerder'){
   const invitation=(await action('invitation.create',{name:role,email:role+'@example.test',companyId:'c-noord',role})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:role,password}});assert.equal(activated.status,200);
   current={cookie:activated.headers['set-cookie'].split(';')[0],headers:{cookie:activated.headers['set-cookie'].split(';')[0],'x-csrf-token':activated.json().csrfToken}};
  }
  const records=[];
  if(!empty){
   const key=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
   const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId:'audit-history',items:[{externalId:'236001',title:'Renovatie Noord — café',city:'Utrecht'},{externalId:'236002',title:'Appartementen Zuid',city:'Rotterdam'},{externalId:'236003',title:'VvE Parkzicht',city:'Amersfoort'}]}});assert.equal(imported.status,200);
   const state=(await dispatch('/api/state',{headers})).json().state;
   for(const [index,externalId]of ['236001','236002','236003'].entries()){
    const lead=state.leads.find(item=>item.importExternalId===externalId);
    if(role!=='hoofdbeheerder')await action('note.add',{leadId:lead.id,text:'Eigen bedrijfshistorie voor de rapportage.'},'c-noord',current.headers);
    const response=await action('lead.delete',{leadId:lead.id,confirmed:true,...index!==1?{reason:index===0?longReason:'Geen brandwerende werkzaamheden'}:{}});
    records.push(response.state.archivedLeads.find(item=>item.id===lead.id));
   }
  }
  if(zeroCompanies){await action('user.update',{userId:'u-admin',companyId:null,role:'hoofdbeheerder'});await action('company.delete',{companyId:'c-noord',confirmed:true});}
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>context.close());
  await context.addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await context.addInitScript(()=>{window.__archiveTimers=[];window.setInterval=(callback,ms,...args)=>{window.__archiveTimers.push({callback:()=>callback(...args),ms});return window.__archiveTimers.length;};});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});
   // Model a future account rename while the server's recorded audit snapshot stays unchanged.
   if(renameUser&&url.pathname==='/api/state'&&response.status===200){const payload=response.json();payload.state.users.find(user=>user.id==='u-admin').name='Huidige andere naam';response.bytes=Buffer.from(JSON.stringify(payload));}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#deleted-leads');await page.locator('#main h1').waitFor({state:'visible'});
  return{page,records,errors,action,async snapshot(){const result=await dispatch('/api/state',{headers:current.headers});assert.equal(result.status,200);return result.json().state;}};
 }
 const rows=f=>f.page.locator('[data-deleted-lead]');

 await t.test('the audit lists saved project identity, original maker, Amsterdam timestamp and complete literal reasons',async t=>{
  const f=await fixture(t,{renameUser:true});assert.equal(await rows(f).count(),3);
  assert.equal(await f.page.locator('[data-route="deleted-leads"]').first().isVisible(),true);
  const dates=[];
  for(const archived of f.records){
   const row=f.page.locator('[data-deleted-lead][data-lead-id="'+archived.id+'"]'),text=await row.innerText();
   assert.ok(text.includes(archived.title));assert.ok(text.includes(archived.importExternalId));assert.ok(text.includes(maker));assert.equal(text.includes('Huidige andere naam'),false);
   assert.ok(text.includes(archived.deletionReason||'Geen reden opgegeven'));
   const time=row.locator('time');assert.equal(await time.getAttribute('datetime'),archived.deletedAt);
   const expected=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(new Date(archived.deletedAt));assert.ok((await time.innerText()).includes(expected));
  }
  for(const datetime of await rows(f).locator('time').evaluateAll(nodes=>nodes.map(node=>node.dateTime)))dates.push(Date.parse(datetime));
  assert.deepEqual(dates,[...dates].sort((a,b)=>b-a));assert.equal(await f.page.evaluate(()=>window.archiveXss),undefined);assert.equal(await rows(f).locator('img,script').count(),0);
  assert.equal(await rows(f).locator('button,a').count(),0,'Archived entries remain read-only');assert.deepEqual(f.errors,[]);
 });

 await t.test('search accepts continuous typing and matches project ID, original maker and reason',async t=>{
  const f=await fixture(t),search=f.page.locator('#deleted-lead-search');await search.click();await search.pressSequentially('236001');assert.equal(await search.inputValue(),'236001');assert.equal(await search.evaluate(node=>node===document.activeElement),true);assert.equal(await rows(f).count(),1);
  assert.ok((await rows(f).innerText()).includes('Renovatie Noord'));
  for(const [query,count]of [['café',1],['Beheerder bij verwijdering',3],['brandwerende',1],['niets gevonden hier',0]]){await search.fill(query);assert.equal(await rows(f).count(),count);assert.equal(await search.evaluate(node=>node===document.activeElement),true);}
  await search.fill('');assert.equal(await rows(f).count(),3);assert.ok((await f.page.locator('[data-deleted-lead-count]').innerText()).includes('3'));assert.deepEqual(f.errors,[]);
 });

 for(const role of ['bedrijfsbeheerder','verkoper'])await t.test(role+' cannot open the audit route or receive private audit metadata',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('[data-route="deleted-leads"]').count(),0);assert.equal(await rows(f).count(),0);assert.equal(await f.page.locator('#deleted-lead-search').count(),0);
  const text=await f.page.locator('#main').innerText();assert.match(text,/hoofdbeheerder/i);assert.equal(text.includes(longReason),false);assert.equal(text.includes(maker),false);
  const state=await f.snapshot();assert.ok(state.archivedLeads.length>0);for(const record of state.archivedLeads)for(const key of ['deletedAt','deletedById','deletedByName','deletionReason','title'])assert.equal(Object.hasOwn(record,key),false);
  assert.deepEqual(f.errors,[]);
 });

 await t.test('the audit has a useful empty state and stays available with no active companies',async t=>{
  const empty=await fixture(t,{empty:true});assert.equal(await rows(empty).count(),0);assert.match(await empty.page.locator('#main').innerText(),/geen.*verwijder/i);assert.deepEqual(empty.errors,[]);
  const archived=await fixture(t,{zeroCompanies:true});assert.equal(await rows(archived).count(),3);assert.equal((await archived.snapshot()).companies.length,0);assert.deepEqual(archived.errors,[]);
 });

 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': long reasons stay readable and the archive fits the viewport',async t=>{
  const f=await fixture(t,{mobile});await mkdir(fileURLToPath(new URL('../work/',import.meta.url)),{recursive:true});await f.page.waitForTimeout(350);
  const geometry=await f.page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('[data-deleted-lead]')].map(node=>{const bounds=node.getBoundingClientRect();return{left:bounds.left,right:bounds.right,width:bounds.width};})}));
  assert.ok(geometry.documentWidth<=geometry.width+1,JSON.stringify(geometry));for(const box of geometry.rows)assert.ok(box.left>=0&&box.right<=geometry.width+1,JSON.stringify(box));
  assert.ok((await rows(f).allInnerTexts()).join('\n').includes(longReason));await f.page.screenshot({path:fileURLToPath(new URL('../work/deleted-leads-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});assert.deepEqual(f.errors,[]);
 });
});
