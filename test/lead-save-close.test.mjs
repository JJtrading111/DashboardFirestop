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
const origin='https://lead-save-close.example.test',email='save-close@example.test',password='Save-close-test-password-2026!';
const noteText='Onverstuurde gespreksnotitie: offerte telefonisch besproken.';

test('save and close persists the complete lead draft and restores its overview in a real browser', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run the save-and-close DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{route='calls',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:email,adminName:'Testbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});
  t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{
    url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.body=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);
   return{status:res.status,headers:res.headers,bytes:res.body,json:()=>JSON.parse(res.body.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
  const token=login.json().csrfToken,cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':token};
  const action=async(type,payload)=>{const result=await dispatch('/api/action',{method:'POST',headers,body:{type,companyId:'c-noord',payload}});assert.equal(result.status,200,result.bytes.toString());return result.json();};
  const invitation=(await action('invitation.create',{name:'Testverkoper',email:'seller-save-close@example.test',companyId:'c-noord',role:'verkoper'})).result;
  const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Testverkoper',password}});assert.equal(activated.status,200);
  const sellerId=activated.json().user.id;
  const importKey=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+importKey},body:{runId:'save-close-fixture',items:Array.from({length:40},(_,index)=>({
   externalId:String(232240+index),title:'Testproject '+String(index+1).padStart(3,'0'),organization:'Testaannemer',city:'Utrecht',
   phone:'030-2222222',contact:'Testcontact',email:'contact@example.test',description:'Projectgegevens voor de browsertest. '.repeat(65),
   sourceUrl:'https://portal.bouwberichten.nl/projecten/'+(232240+index),projectDetails:{scheduleStart:'2026-06-15',scheduleEnd:'2027-06-15'}
  }))}});assert.equal(imported.status,200);
  const snapshot=async()=>{const result=await dispatch('/api/state?companyId=c-noord',{headers});assert.equal(result.status,200);return result.json().state;};
  const initial=await snapshot(),lead=initial.leads[18],anchor=initial.leads[24];
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});
  t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  const actions=[],errors=[];let nextWrite=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.setInterval=()=>0;});
  await page.route('**/*',async intercepted=>{
   const url=new URL(intercepted.request().url());if(url.origin!==origin)return intercepted.abort();
   const request=intercepted.request(),bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   const write=url.pathname==='/api/action';if(write)actions.push(payload);
   const gate=write?nextWrite:null;if(gate)nextWrite=null;
   const response=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Bewaren tijdelijk niet mogelijk'}))}:
    await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}
   if(gate?.mode==='lost-ack')return intercepted.fulfill({status:503,json:{error:'Bevestiging van opslaan ontbreekt'}});
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#'+route);await page.locator('#lead-search').waitFor({state:'visible'});
  await page.locator('#lead-search').fill('Testproject');await page.waitForTimeout(240);
  await page.locator('[data-field="source"]').selectOption('bouw');
  if(route!=='kanban')for(const [field,value]of Object.entries({constructionFrom:'2026-01-01',constructionTo:'2026-12-31',deliveryFrom:'2027-01-01',deliveryTo:'2027-12-31'}))await page.locator('[data-field="'+field+'"]').fill(value);
  assert.equal(await page.locator('#main .lead-title').count(),40);
  const target=page.locator('#main [data-action="open-lead"][data-id="'+lead.id+'"]').first();
  await target.evaluate(node=>node.scrollIntoView({block:'center'}));
  if(mobile)await target.focus();
  const before=await overview(page,anchor.id);
  if(mobile)await page.keyboard.press('Enter');else await target.click();
  await page.locator('.detail-drawer').waitFor({state:'visible'});
  return{page,lead,anchor,sellerId,snapshot,actions,errors,before,
   gate(mode='hold'){let start,release,timer;
    const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('The save request did not reach the backend within five seconds')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve);t.after(()=>{clearTimeout(timer);release();});
    nextWrite={mode,started:start,released};return{started,release};}};
 }
 async function overview(page,anchorId){return page.evaluate(anchorId=>{
  const fields=Object.fromEntries([...document.querySelectorAll('#main [data-field]')].map(input=>[input.dataset.field,input.type==='checkbox'?input.checked:input.value]));
  const anchor=document.querySelector('#main [data-action="open-lead"][data-id="'+anchorId+'"]');
  return{hash:location.hash,fields,x:scrollX,y:scrollY,anchorY:anchor?.getBoundingClientRect().top,
   leadOrder:[...new Set([...document.querySelectorAll('#main [data-action="open-lead"][data-id]')].map(node=>node.dataset.id))],
   listScroll:[...document.querySelectorAll('#main .table-wrap,#main .kanban')].map(node=>({left:node.scrollLeft,top:node.scrollTop}))};
 },anchorId);}
 async function assertReturned(f){
  await f.page.locator('.detail-drawer').waitFor({state:'hidden'});
  await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const after=await overview(f.page,f.anchor.id);
  assert.equal(after.hash,f.before.hash);assert.deepEqual(after.fields,f.before.fields);
  assert.ok(Math.abs(after.x-f.before.x)<=1);assert.ok(Math.abs(after.y-f.before.y)<=1,'Overview scroll position must be restored');
  // New flags can change the edited row's height and a new status/priority can
  // move that lead; the order of every other result must remain unchanged.
  assert.deepEqual(after.leadOrder.filter(id=>id!==f.lead.id),f.before.leadOrder.filter(id=>id!==f.lead.id));
  assert.deepEqual(after.listScroll,f.before.listScroll);assert.deepEqual(f.errors,[]);
 }
 async function fillDraft(f){
  const popup=f.page.locator('.detail-drawer');await popup.locator('#note-form textarea[name="text"]').fill(noteText);
  await popup.locator('[data-work="status"]').selectOption('opvolgen');
  await popup.locator('[data-work="priority"]').selectOption('high');
  await popup.locator('[data-work="ownerId"]').selectOption(f.sellerId);
  await popup.locator('[data-work="commitment"]').check();await popup.locator('[data-work="calculation"]').check();
  assert.equal(await popup.locator('#note-form textarea[name="text"]').inputValue(),noteText,'Field edits must preserve the unsubmitted note');
 }
 async function assertSaved(f){
  const state=await f.snapshot(),workspace=state.workspaces['c-noord'][f.lead.id];
  for(const [field,value]of Object.entries({status:'opvolgen',priority:'high',ownerId:f.sellerId,commitment:true,calculation:true}))assert.equal(workspace[field],value,field);
  assert.equal(workspace.notes.filter(note=>note.text===noteText).length,1,'The unsent note must be stored exactly once');
 }
 for(const route of ['calls','leads','kanban'])await t.test(route+': save waits for success, double click stores one note, then restores the exact overview',async t=>{
  const f=await fixture(t,{route});await fillDraft(f);
  const popup=f.page.locator('.detail-drawer'),button=popup.locator('[data-action="save-close-lead"]');
  assert.equal((await button.textContent()).trim(),'Opslaan en sluiten');
  const gate=f.gate();
  await button.evaluate(button=>{button.click();button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await gate.started;
  assert.equal(await popup.isVisible(),true,'Popup must wait for the server acknowledgement');
  assert.equal(await button.isDisabled(),true);await f.page.keyboard.press('Escape');assert.equal(await popup.isVisible(),true);
  assert.equal(f.actions.filter(action=>action.type==='workspace.save').length,1);
  await assertSaved(f);gate.release();await assertReturned(f);await assertSaved(f);
 });
 await t.test('rejected save keeps all draft fields and the note available for retry',async t=>{
  const f=await fixture(t);await fillDraft(f);const gate=f.gate('reject');
  await f.page.locator('[data-action="save-close-lead"]').click();await gate.started;gate.release();
  await f.page.getByText('Bewaren tijdelijk niet mogelijk',{exact:true}).waitFor({state:'visible'});
  const popup=f.page.locator('.detail-drawer');assert.equal(await popup.isVisible(),true);
  for(const [field,value]of Object.entries({status:'opvolgen',priority:'high',ownerId:f.sellerId}))assert.equal(await popup.locator('[data-work="'+field+'"]').inputValue(),value);
  assert.equal(await popup.locator('[data-work="commitment"]').isChecked(),true);assert.equal(await popup.locator('[data-work="calculation"]').isChecked(),true);
  assert.equal(await popup.locator('#note-form textarea[name="text"]').inputValue(),noteText);
  assert.equal((await f.snapshot()).workspaces['c-noord'][f.lead.id]?.notes?.length??0,0);
  await popup.locator('[data-action="save-close-lead"]').click();await assertReturned(f);await assertSaved(f);
 });
 await t.test('retry after a lost save acknowledgement uses the same note ID and never duplicates its committed note',async t=>{
  const f=await fixture(t);await fillDraft(f);const gate=f.gate('lost-ack');
  await f.page.locator('[data-action="save-close-lead"]').click();await gate.started;await assertSaved(f);gate.release();
  await f.page.getByText('Bevestiging van opslaan ontbreekt',{exact:true}).waitFor({state:'visible'});
  assert.equal(await f.page.locator('#note-form textarea[name="text"]').inputValue(),noteText);
  await f.page.locator('[data-action="save-close-lead"]').click();await assertReturned(f);await assertSaved(f);
  const saves=f.actions.filter(action=>action.type==='workspace.save');assert.equal(saves.length,2);assert.equal(saves[0].payload.note.id,saves[1].payload.note.id);
 });
 await t.test('Notitie toevoegen saves all draft fields without closing and a later footer save cannot duplicate the note',async t=>{
  const f=await fixture(t);await fillDraft(f);
  await f.page.locator('#note-form button[type="submit"]').click();
  await f.page.waitForFunction(()=>document.querySelector('#note-form textarea[name="text"]')?.value===''&&!document.querySelector('[data-action="save-close-lead"]')?.disabled);
  assert.equal(await f.page.locator('.detail-drawer').isVisible(),true);await assertSaved(f);
  await f.page.locator('[data-action="save-close-lead"]').click();await assertReturned(f);await assertSaved(f);
 });
 await t.test('opening and cancelling a callback dialog preserves the unsaved note and every staged follow-up field',async t=>{
  const f=await fixture(t);await fillDraft(f);
  await f.page.locator('.detail-drawer').getByRole('button',{name:'Terugbellen plannen',exact:true}).click();
  await f.page.locator('#callback-form').waitFor({state:'visible'});
  await f.page.locator('.modal').getByRole('button',{name:'Annuleren',exact:true}).click();
  const popup=f.page.locator('.detail-drawer');await popup.waitFor({state:'visible'});
  assert.equal(await popup.locator('#note-form textarea[name="text"]').inputValue(),noteText);
  for(const [field,value]of Object.entries({status:'opvolgen',priority:'high',ownerId:f.sellerId}))assert.equal(await popup.locator('[data-work="'+field+'"]').inputValue(),value);
  assert.equal(await popup.locator('[data-work="commitment"]').isChecked(),true);assert.equal(await popup.locator('[data-work="calculation"]').isChecked(),true);
  await popup.locator('[data-action="save-close-lead"]').click();await assertReturned(f);await assertSaved(f);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': the save button remains visible at the lower-right while the popup body scrolls',async t=>{
  const f=await fixture(t,{mobile}),popup=f.page.locator('.detail-drawer'),button=popup.locator('[data-action="save-close-lead"]');
  assert.ok(await popup.locator('.detail-body').evaluate(body=>body.scrollHeight>body.clientHeight),'Fixture must exercise a genuinely scrollable popup body');
  for(const scroll of [0,99999]){
   await popup.locator('.detail-body').evaluate((body,scroll)=>body.scrollTop=scroll,scroll);
   const outer=await popup.boundingBox(),box=await button.boundingBox(),viewport=f.page.viewportSize();
   const geometry=await popup.evaluate(root=>({header:root.querySelector('.detail-header').getBoundingClientRect().toJSON(),body:root.querySelector('.detail-body').getBoundingClientRect().toJSON(),footer:root.querySelector('.workbook-footer').getBoundingClientRect().toJSON(),innerWidth,innerHeight,visualViewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop}}));
   assert.ok(box&&outer);assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'Save button must stay inside the viewport: '+JSON.stringify({outer,box,viewport,geometry}));
   assert.ok(Math.abs(outer.x+outer.width-box.x-box.width)<=36,'Save button must align to the popup right edge');
   assert.ok(Math.abs(outer.y+outer.height-box.y-box.height)<=36,'Save button must align to the popup bottom edge');
  }
  if(process.env.LEAD_SAVE_CLOSE_SCREENSHOTS==='1'){
   await mkdir(new URL('../work/',import.meta.url),{recursive:true});
   await f.page.screenshot({path:fileURLToPath(new URL('../work/save-close-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:false});
  }
  await button.click();await assertReturned(f);
 });
});
