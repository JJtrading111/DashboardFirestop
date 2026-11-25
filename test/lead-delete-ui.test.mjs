import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
import {buildCallReport,reportRows} from '../public/model.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(value=>value&&existsSync(value));
const origin='https://lead-delete-ui.example.test',email='delete-owner@example.test',password='Lead-delete-ui-password-2026!';

test('global lead deletion is confirmed, preserves reporting and restores the overview in Chrome',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium for lead deletion browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false,route='leads'}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:email,adminName:'Hoofdbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':login.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',actorHeaders=headers){const r=await dispatch('/api/action',{method:'POST',headers:actorHeaders,body:{type,companyId,payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();}
  const snapshot=async(companyId='c-noord',actorHeaders=headers)=>{const r=await dispatch('/api/state?companyId='+companyId,{headers:actorHeaders});assert.equal(r.status,200);return r.json().state;};
  const second=(await action('company.create',{name:'Tweede Bedrijf'})).result.company;
  let current={cookie,headers};if(role!=='hoofdbeheerder'){
   const invitation=(await action('invitation.create',{name:role,email:role+'@example.test',companyId:'c-noord',role})).result;
   const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:role,password}});assert.equal(activated.status,200);
   current={cookie:activated.headers['set-cookie'].split(';')[0],headers:{cookie:activated.headers['set-cookie'].split(';')[0],'x-csrf-token':activated.json().csrfToken}};
  }
  const key=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  async function importItems(runId,items){const r=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+key},body:{runId,items}});assert.equal(r.status,200,r.bytes.toString());return r.json();}
  await importItems('initial',Array.from({length:40},(_,i)=>({externalId:String(232241+i),title:'Testproject '+String(i+1).padStart(3,'0'),organization:'Testaannemer',city:'Utrecht',phone:'030-2222222',contact:'Testcontact',email:'test@example.test',description:'Projectgegevens voor deze browsertest. '.repeat(45),sourceUrl:'https://portal.bouwberichten.nl/projecten/'+(232241+i)})));
  const initial=await snapshot(),lead=initial.leads[18];
  await action('settings.update',{cooldownHours:0});
  await action('call.record',{leadId:lead.id});
  await action('workspace.save',{leadId:lead.id,changes:{ownerId:'u-admin',commitment:true,calculation:true},note:{id:'note-11111111-1111-4111-8111-111111111111',text:'Historische notitie Noord.'}});
  await action('call.record',{leadId:lead.id},second.id);
  await action('workspace.save',{leadId:lead.id,changes:{commitment:true},note:{id:'note-22222222-2222-4222-8222-222222222222',text:'Historische notitie tweede bedrijf.'}},second.id);
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>context.close());
  await context.addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await context.addInitScript(()=>{window.__leadTimers=[];window.setInterval=(callback,ms,...args)=>{window.__leadTimers.push({callback:()=>callback(...args),ms});return window.__leadTimers.length;};});
  const page=await context.newPage(),errors=[],actions=[];let failNext=false,gate=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null,isDelete=payload?.type==='lead.delete';if(url.pathname==='/api/action')actions.push(payload);
   const hold=isDelete?gate:null;if(isDelete)gate=null;
   const response=isDelete&&failNext?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Verwijderen tijdelijk niet mogelijk'}))}:await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(isDelete)failNext=false;if(hold){hold.started();await hold.releasePromise;}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#'+route);await page.locator('#lead-search').waitFor({state:'visible'});
  await page.locator('#lead-search').fill('Testproject');await page.locator('[data-field="source"]').selectOption('bouw');
  const opener=page.locator('#main [data-action="open-lead"][data-id="'+lead.id+'"]').first();await opener.evaluate(node=>node.scrollIntoView({block:'center'}));
  const before=await page.evaluate(()=>({y:scrollY,hash:location.hash,query:document.querySelector('#lead-search').value,source:document.querySelector('[data-field="source"]').value}));
  if(mobile){await opener.focus();await page.keyboard.press('Enter');}else await opener.click();await page.locator('.workbook-drawer').waitFor({state:'visible'});
  return{page,lead,second,errors,actions,before,action,snapshot,dispatch,headers,importItems,
   rejectNext(){failNext=true;},holdDelete(){let started,release;const start=new Promise(resolve=>started=resolve),releasePromise=new Promise(resolve=>release=resolve);gate={started,releasePromise};t.after(()=>release());return{started:start,release};}};
 }
 const button=f=>f.page.locator('[data-action="delete-lead"]'),confirm=f=>f.page.locator('[data-action="confirm-delete-lead"]');
 async function openConfirm(f){await button(f).click();await f.page.locator('[data-lead-delete-confirm]').waitFor({state:'visible'});}

 await t.test('cancel and Escape preserve every draft field and the popup position',async t=>{
  const f=await fixture(t);await f.page.locator('[data-work="priority"]').selectOption('high');await f.page.locator('#note-form textarea').fill('Mijn onopgeslagen concept.');
  await f.page.locator('.detail-body').evaluate(node=>node.scrollTop=180);const before=await f.page.locator('.detail-body').evaluate(node=>node.scrollTop);
  await openConfirm(f);assert.match(await f.page.locator('[data-lead-delete-confirm]').innerText(),/alle bedrijven/);assert.match(await f.page.locator('.lead-delete-draft-warning').innerText(),/niet opgeslagen/);
  await f.page.getByRole('button',{name:'Annuleren',exact:true}).click();assert.equal(await f.page.locator('#note-form textarea').inputValue(),'Mijn onopgeslagen concept.');assert.equal(await f.page.locator('[data-work="priority"]').inputValue(),'high');assert.equal(await f.page.locator('.detail-body').evaluate(node=>node.scrollTop),before);
  await openConfirm(f);await f.page.keyboard.press('Escape');await f.page.locator('.workbook-drawer').waitFor({state:'visible'});assert.equal(f.actions.filter(action=>action.type==='lead.delete').length,0);assert.deepEqual(f.errors,[]);
 });
 await t.test('confirmation deletes globally, retains exact reports and restores route filters and scroll',async t=>{
  const f=await fixture(t),before=await f.snapshot(),calls=buildCallReport(before),results=reportRows(before);
  await f.page.locator('#note-form textarea').fill('Dit concept mag niet worden opgeslagen.');await openConfirm(f);await f.page.locator('[data-lead-delete-reason]').fill('Geen werkzaamheden voor onze groep.');await confirm(f).click();await f.page.locator('.workbook-drawer,.modal').waitFor({state:'hidden'});
  const after=await f.snapshot();assert.equal(after.leads.some(lead=>lead.id===f.lead.id),false);assert.equal((await f.snapshot(f.second.id)).leads.some(lead=>lead.id===f.lead.id),false);assert.deepEqual(buildCallReport(after),calls);assert.deepEqual(reportRows(after),results);assert.deepEqual(after.workspaces,before.workspaces);assert.equal(f.actions.some(action=>action.type==='workspace.save'),false);
  assert.deepEqual(await f.page.evaluate(()=>({y:scrollY,hash:location.hash,query:document.querySelector('#lead-search').value,source:document.querySelector('[data-field="source"]').value})),f.before);
  const result=await f.importItems('after-delete',[{externalId:f.lead.importExternalId,title:'Gewijzigd project'}]);assert.equal(result.counts.excluded,1);assert.equal((await f.snapshot()).leads.some(lead=>lead.id===f.lead.id),false);
  await f.page.reload();await f.page.locator('#lead-search').waitFor({state:'visible'});await f.page.locator('[data-route="sources"]').first().click();assert.match(await f.page.locator('#main').innerText(),/1 uitgesloten na verwijderen/);assert.deepEqual(f.errors,[]);
 });
 await t.test('failed deletion keeps the reason and draft available for retry',async t=>{
  const f=await fixture(t);await f.page.locator('#note-form textarea').fill('Concept blijft staan.');await openConfirm(f);await f.page.locator('[data-lead-delete-reason]').fill('Geen passend werk');f.rejectNext();await confirm(f).click();await f.page.locator('[data-lead-delete-error]').waitFor({state:'visible'});
  assert.match(await f.page.locator('[data-lead-delete-error]').innerText(),/tijdelijk niet mogelijk/);assert.equal(await confirm(f).isEnabled(),true);assert.equal(await f.page.locator('[data-lead-delete-reason]').inputValue(),'Geen passend werk');await f.page.getByRole('button',{name:'Annuleren',exact:true}).click();assert.equal(await f.page.locator('#note-form textarea').inputValue(),'Concept blijft staan.');assert.equal((await f.snapshot()).leads.some(lead=>lead.id===f.lead.id),true);assert.deepEqual(f.errors,[]);
 });
 await t.test('busy confirmation cannot be dismissed or submitted twice',async t=>{
  const f=await fixture(t);await openConfirm(f);const gate=f.holdDelete();await confirm(f).click();await gate.started;assert.equal(await confirm(f).isDisabled(),true);await f.page.keyboard.press('Escape');assert.equal(await f.page.locator('[data-lead-delete-confirm]').count(),1);gate.release();await f.page.locator('.modal,.workbook-drawer').waitFor({state:'hidden'});assert.equal(f.actions.filter(action=>action.type==='lead.delete').length,1);assert.deepEqual(f.errors,[]);
 });
 for(const role of ['bedrijfsbeheerder','verkoper'])await t.test(role+' does not see the global deletion action',async t=>{const f=await fixture(t,{role});assert.equal(await button(f).count(),0);assert.equal(await f.page.locator('[data-action="save-close-lead"]').isVisible(),true);assert.deepEqual(f.errors,[]);});
 await t.test('background removal closes another user popup and historical feed links stay unavailable',async t=>{
  const f=await fixture(t,{role:'verkoper'});await f.page.locator('#note-form textarea').fill('Open concept bij collega.');await f.action('lead.delete',{leadId:f.lead.id,confirmed:true});
  await f.page.evaluate(async()=>{for(const timer of window.__leadTimers.filter(timer=>timer.ms===30000))await timer.callback();});await f.page.locator('.workbook-drawer').waitFor({state:'hidden'});assert.equal(await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').count(),0);
  await f.page.locator('[data-route="feed"]').first().click();assert.equal(await f.page.locator('#main [data-action="open-lead"][data-id="'+f.lead.id+'"]').count(),0);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': footer controls and confirmation fit the viewport',async t=>{
  const f=await fixture(t,{mobile}),buttons=f.page.locator('.workbook-footer>.button');assert.equal(await buttons.count(),2);
  const geometry=await buttons.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};}));
  for(const box of geometry){assert.ok(box.x>=0&&box.right<=(mobile?390:1440));assert.ok(box.scrollWidth<=box.clientWidth+1);}
  assert.ok(geometry[0].right<=geometry[1].x||geometry[0].bottom<=geometry[1].y);
  await mkdir(fileURLToPath(new URL('../work/',import.meta.url)),{recursive:true});await f.page.waitForTimeout(350);await f.page.screenshot({path:fileURLToPath(new URL('../work/lead-delete-footer-'+(mobile?'mobile':'desktop')+'.png',import.meta.url))});
  await openConfirm(f);const bounds=await f.page.locator('[data-lead-delete-confirm]').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0);assert.ok(bounds.x+bounds.width<=(mobile?390:1440));assert.ok(bounds.y+bounds.height<=(mobile?844:1000));
  await f.page.waitForTimeout(350);await f.page.screenshot({path:fileURLToPath(new URL('../work/lead-delete-'+(mobile?'mobile':'desktop')+'.png',import.meta.url))});
  if(mobile){await f.page.locator('[data-lead-delete-confirm] .modal-body').evaluate(node=>node.scrollTop=node.scrollHeight);const reason=f.page.locator('[data-lead-delete-reason]');await reason.click();await reason.fill('Geen werkzaamheden.');const field=await reason.boundingBox(),footer=await f.page.locator('[data-lead-delete-confirm] .modal-footer').boundingBox();assert.ok(field.y+field.height<=footer.y+1,JSON.stringify({field,footer}));assert.equal(await reason.inputValue(),'Geen werkzaamheden.');}
  assert.deepEqual(f.errors,[]);
 });
});
