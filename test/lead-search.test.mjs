import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createDemoState} from '../public/model.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://lead-search.example.test';
const files=Object.fromEntries(await Promise.all(['index.html','app.mjs','model.mjs','styles.css','bouwberichten-filters.mjs'].map(async name=>['/'+name,await readFile(new URL('../public/'+name,import.meta.url),'utf8')])));
const targetTitle='Appartementen Parkzicht',otherTitle='Renovatie Dorpshuis',fallbackTitle='Schoolgebouw Waterkant';
function stateFixture(){
 const state=createDemoState(),date='2026-11-24T12:00:00.000Z';
 state.leads=[
  {id:'lead-00000000-0000-4000-8000-000000000001',title:targetTitle,organization:'Bouwgroep Noord',city:'Utrecht',source:'bouw',imported:true,importExternalId:'232259',sourceUrl:'https://portal.bouwberichten.nl/projecten/232259'},
  {id:'lead-00000000-0000-4000-8000-000000000002',title:otherTitle,organization:'Dorpsbouw',city:'Gouda',source:'bouw',imported:true,importExternalId:'987654',sourceUrl:'https://portal.bouwberichten.nl/projecten/987654?reference=232259'},
  {id:'lead-00000000-0000-4000-8000-000000000003',title:fallbackTitle,organization:'Schoolbouw',city:'Leiden',source:'bouw',imported:true,sourceUrl:'https://portal.bouwberichten.nl/projecten/565432'},
  {id:'lead-00000000-0000-4000-8000-000000000004',title:'Hotel Zomerhof',organization:'Hotelbouw',city:'Delft',source:'bouw',imported:true,importExternalId:'url:232259',sourceUrl:'https://outside.example/projecten/232259'}
 ].map(lead=>({...lead,tags:[],phone:'030-2222222',contact:'Testcontact',email:'test@example.test',description:'Uitsluitend testgegevens',createdAt:date,updatedAt:date}));
 state.workspaces={};state.callLog=[];state.feed=[];state.invitations=[];
 return state;
}

test('lead search preserves native typing, selection and filtering in a real browser', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run the search DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,route){
  const page=await browser.newPage();t.after(()=>page.close());
  const state=stateFixture(),owner=state.users.find(user=>user.id==='u-admin'),errors=[];
  let nextHeld=null,stateRequests=0;
  page.on('pageerror',error=>errors.push(error.message));
  // Capture the actual production interval callbacks so polling races can be
  // exercised immediately while the input's real debounce timers keep running.
  await page.addInitScript(()=>{
   window.__leadSearchIntervals=[];
   window.setInterval=(callback,ms,...args)=>{window.__leadSearchIntervals.push({callback:()=>callback(...args),ms});return window.__leadSearchIntervals.length;};
  });
  await page.route('**/*',async intercepted=>{
   const url=new URL(intercepted.request().url());
   if(url.origin!==origin)return intercepted.abort();
   if(url.pathname==='/api/session')return intercepted.fulfill({json:{authenticated:true,user:owner,csrfToken:'test-only-csrf'}});
   if(url.pathname==='/api/state'){
    stateRequests++;
    const response={state:structuredClone(state),userId:owner.id,companyId:owner.companyId};
    if(nextHeld){const held=nextHeld;nextHeld=null;held.started();await held.released;}
    return intercepted.fulfill({json:response});
   }
   const path=url.pathname==='/'?'/index.html':url.pathname,body=files[path];
   if(body===undefined)return intercepted.fulfill({status:404,body:'Not found'});
   const contentType=path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html';
   return intercepted.fulfill({status:200,contentType,body});
  });
  await page.goto(origin+'/#'+route);
  const input=page.locator('#lead-search');await input.waitFor({state:'visible'});
  assert.equal(await page.locator('#main .lead-title').count(),4);
  await page.evaluate(()=>{window.__leadSearchOriginal=document.querySelector('#lead-search');});
  return{page,input,errors,get stateRequests(){return stateRequests;},
   holdNextState(){let start,release;const started=new Promise(resolve=>start=resolve),released=new Promise(resolve=>release=resolve);nextHeld={started:start,released};return{started,release};}};
 }
 async function assertPreserved(page,value,selection){
  const actual=await page.evaluate(()=>{const input=document.querySelector('#lead-search');return{
   value:input?.value,focused:document.activeElement===input,sameNode:input===window.__leadSearchOriginal,
   start:input?.selectionStart,end:input?.selectionEnd,direction:input?.selectionDirection};});
  assert.equal(actual.value,value);assert.equal(actual.focused,true,'The search input must remain focused');
  assert.equal(actual.sameNode,true,'Filtering must preserve the native search input rather than replace it');
  if(selection)assert.deepEqual([actual.start,actual.end,actual.direction],selection);
 }
 async function settle(page){await page.waitForTimeout(260);}
 for(const route of ['calls','leads','kanban'])await t.test(route+': continuous slow and fast typing, paste and mid-query selection',async t=>{
  const {page,input,errors}=await fixture(t,route);
  await input.focus();
  await page.keyboard.type('Park',{delay:260});await settle(page);
  await assertPreserved(page,'Park');
  assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[targetTitle]);
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Bouwgroep Noord',{delay:5});await settle(page);
  await assertPreserved(page,'Bouwgroep Noord');
  assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[targetTitle]);
  await page.keyboard.press('ControlOrMeta+A');
  // insertText exercises native multi-character input as produced by paste/IME,
  // without reading or modifying the user's system clipboard.
  await page.keyboard.insertText('232259');await settle(page);
  await assertPreserved(page,'232259');
  assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[targetTitle],'Bouwberichten ID must match even though the number is absent from all display text');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('565432');await settle(page);
  await assertPreserved(page,'565432');
  assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[fallbackTitle],'Official source URL path supplies an ID when the import ID is absent');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('232259');await settle(page);
  await page.evaluate(()=>document.querySelector('#lead-search').setSelectionRange(2,5,'backward'));
  await input.dispatchEvent('change');await settle(page);
  await assertPreserved(page,'232259',[2,5,'backward']);
  await page.keyboard.insertText('99');await settle(page);
  await assertPreserved(page,'23999');
  await page.evaluate(()=>document.querySelector('#lead-search').setSelectionRange(2,4,'forward'));
  await input.dispatchEvent('change');await settle(page);
  await assertPreserved(page,'23999',[2,4,'forward']);
  assert.deepEqual(errors,[]);
 });
 await t.test('a polling response started before typing preserves the live query, focus and selection',async t=>{
  const f=await fixture(t,'calls'),{page,input}=f;
  const held=f.holdNextState();
  await page.evaluate(()=>{const interval=window.__leadSearchIntervals.find(interval=>interval.ms===30000);window.__leadSearchPendingPoll=interval.callback();});
  await held.started;
  await input.focus();await page.keyboard.insertText('232');
  await page.evaluate(()=>document.querySelector('#lead-search').setSelectionRange(1,2,'backward'));
  held.release();await page.evaluate(()=>window.__leadSearchPendingPoll);await settle(page);
  await assertPreserved(page,'232',[1,2,'backward']);
  await page.keyboard.press('End');await page.keyboard.insertText('259');await settle(page);
  await assertPreserved(page,'232259');
  assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[targetTitle]);
  await page.evaluate(()=>window.__leadSearchIntervals.find(interval=>interval.ms===30000).callback());
  await assertPreserved(page,'232259');assert.ok(f.stateRequests>=3);
  assert.deepEqual(f.errors,[]);
 });
 await t.test('IME composition commits once and clearing search restores all leads without replacing the input',async t=>{
  const {page,input,errors}=await fixture(t,'leads');await input.focus();
  await page.evaluate(()=>{const input=document.querySelector('#lead-search');
   input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));input.value='232259';
   input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'232259',inputType:'insertCompositionText',isComposing:true}));});
  await settle(page);await assertPreserved(page,'232259');
  assert.equal(await page.locator('#main .lead-title').count(),4,'An unfinished composition must not filter or replace its native input');
  await input.dispatchEvent('compositionend',{data:'232259'});await settle(page);
  await assertPreserved(page,'232259');assert.deepEqual(await page.locator('#main .lead-title').allTextContents(),[targetTitle]);
  await input.fill('');await settle(page);await assertPreserved(page,'');
  assert.equal(await page.locator('#main .lead-title').count(),4);assert.deepEqual(errors,[]);
 });
 await t.test('reset and route navigation before the debounce expires cannot restore a discarded draft or steal focus',async t=>{
  const {page,input,errors}=await fixture(t,'calls');await input.focus();await page.keyboard.insertText('232259');
  await page.getByRole('button',{name:'Wis filters',exact:true}).click();await settle(page);
  assert.equal(await input.inputValue(),'');assert.equal(await page.locator('#main .lead-title').count(),4);
  assert.equal(await input.evaluate(input=>document.activeElement===input),false);
  await input.focus();await page.keyboard.insertText('232259');
  await page.locator('.nav-item[data-route="leads"]').click();
  await page.getByRole('button',{name:'Wis filters',exact:true}).click();await settle(page);
  assert.equal(await input.inputValue(),'');assert.equal(await page.locator('#main .lead-title').count(),4);
  assert.equal(await input.evaluate(input=>document.activeElement===input),false);assert.deepEqual(errors,[]);
 });
});
