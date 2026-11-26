import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createDemoState,getWorkspace} from '../public/model.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()].find(value=>value&&existsSync(value));
const origin='https://lead-sorting.example.test';
const files=Object.fromEntries(await Promise.all(['index.html','app.mjs','model.mjs','admin-overview.mjs','controlekamer.mjs','controlekamer-model.mjs','call-report.mjs','selected-contact.mjs','styles.css','bouwberichten-filters.mjs'].map(async name=>['/'+name,await readFile(new URL('../public/'+name,import.meta.url),'utf8')])));
const fields=['title','scheduleStart','scheduleEnd','source','priority','status','owner','followup'];
function stateFixture(){
 const state=createDemoState(),date='2026-11-20T12:00:00.000Z';
 state.leads=[
  {id:'sort-a',title:'Project 10',organization:'Betabouw',city:'Breda',source:'vve',projectDetails:{scheduleStart:'2027-03-20',scheduleEnd:'2028-12-01'}},
  {id:'sort-b',title:'Project 2',organization:'Alfabouw',city:'Almere',source:'bouw',projectDetails:{scheduleStart:'2027-01-10',scheduleEnd:'2028-01-01'}},
  {id:'sort-c',title:'Project 30',organization:'Zorgbouw',city:'Zwolle',source:'hotels',projectDetails:{}}
 ].map(lead=>({...lead,tags:[],phone:'030-2222222',contact:'Testcontact',email:'test@example.test',description:'Uitsluitend testgegevens',createdAt:date,updatedAt:date}));
 state.workspaces={};state.callLog=[];state.feed=[];state.invitations=[];
 for(const lead of state.leads)getWorkspace(state,'c-noord',lead.id);
 Object.assign(getWorkspace(state,'c-noord','sort-a'),{priority:'low',ownerId:'u-thomas',status:state.companies[0].columns.at(-1).id});
 Object.assign(getWorkspace(state,'c-noord','sort-b'),{priority:'high',ownerId:'u-sanne'});
 return state;
}

test('lead table arrows keep their selected ordering through repeat clicks, typing, refresh and export',{skip:!chromium||!executablePath?'Install scraper dependencies and Chromium for lead sorting browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,route){
  const page=await browser.newPage({viewport:{width:1600,height:1000}});t.after(()=>page.close());
  const state=stateFixture(),user=state.users.find(user=>user.id==='u-sanne'),errors=[];let requests=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__sortingIntervals=[];window.setInterval=(callback,ms,...args)=>{window.__sortingIntervals.push({callback:()=>callback(...args),ms});return window.__sortingIntervals.length;};});
  await page.route('**/*',async intercepted=>{
   const url=new URL(intercepted.request().url());if(url.origin!==origin)return intercepted.abort();
   if(url.pathname==='/api/session')return intercepted.fulfill({json:{authenticated:true,user,csrfToken:'sorting-fixture-only'}});
   if(url.pathname==='/api/state'){requests++;return intercepted.fulfill({json:{state:structuredClone(state),userId:user.id,companyId:user.companyId}});}
   const path=url.pathname==='/'?'/index.html':url.pathname,body=files[path];
   if(body===undefined)return intercepted.fulfill({status:404,body:'Not found'});
   return intercepted.fulfill({status:200,contentType:path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body});
  });
  await page.goto(origin+'/#'+route);await page.locator('#lead-search').waitFor({state:'visible'});
  return{page,state,errors,get requests(){return requests;}};
 }
 const titles=page=>page.locator('#main tbody .lead-title').allTextContents();
 for(const route of ['leads','calls'])await t.test(route+': every data column has working ascending and descending arrows',async t=>{
  const {page,errors}=await fixture(t,route);
  for(const field of fields){
   for(const direction of ['asc','desc']){
    const button=page.locator('#sort-'+field+'-'+direction);await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'true',field+' '+direction);
    assert.equal(await button.locator('xpath=ancestor::th').getAttribute('aria-sort'),direction==='asc'?'ascending':'descending');
    const previous=await titles(page);await button.click();assert.deepEqual(await titles(page),previous,field+' repeat '+direction);
    assert.equal(await button.getAttribute('aria-pressed'),'true');
   }
  }
  await page.locator('#sort-scheduleStart-asc').click();assert.deepEqual(await titles(page),['Project 2','Project 10','Project 30']);
  await page.locator('#sort-scheduleStart-desc').click();assert.deepEqual(await titles(page),['Project 10','Project 2','Project 30']);
  await page.setViewportSize({width:1100,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1100,'the table scrolls inside the page rather than widening the whole document');
  await page.locator('#sort-followup-asc').scrollIntoViewIfNeeded();
  const position=await page.evaluate(()=>{const table=document.querySelector('[data-lead-search-results] .table-wrap');return{left:table.scrollLeft,x:scrollX,y:scrollY};});
  assert.ok(position.left>0,'the final sortable column can be reached in a horizontally scrolled table');
  await page.locator('#sort-followup-asc').click();
  assert.deepEqual(await page.evaluate(()=>{const table=document.querySelector('[data-lead-search-results] .table-wrap');return{left:table.scrollLeft,x:scrollX,y:scrollY};}),position,'sorting preserves the visible table and page position');
  assert.deepEqual(errors,[]);
 });
 await t.test('phone layout keeps the whole document within the screen while all sort controls remain reachable',async t=>{
  const {page,errors}=await fixture(t,'leads');await page.setViewportSize({width:390,height:900});
  for(const field of fields){
   const button=page.locator('#sort-'+field+'-asc');await button.click();
   assert.equal(await button.getAttribute('aria-pressed'),'true',field+' remains reachable on a phone');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390,'the hidden action header must stay inside the scroll container');
  }
  assert.deepEqual(errors,[]);
 });
 await t.test('typing and a server refresh preserve the chosen ordering and export uses that order',async t=>{
  const f=await fixture(t,'leads'),{page,state}=f;
  await page.locator('#sort-title-asc').click();assert.deepEqual(await titles(page),['Project 2','Project 10','Project 30']);
  const search=page.locator('#lead-search');await search.fill('Project');await page.waitForTimeout(260);
  assert.equal(await search.evaluate(input=>document.activeElement===input),true);assert.equal(await page.locator('#sort-title-asc').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await titles(page),['Project 2','Project 10','Project 30']);
  await page.locator('#sort-title-desc').click();
  state.leads.find(lead=>lead.id==='sort-a').title='Project 100';
  await page.evaluate(async()=>{for(const interval of window.__sortingIntervals.filter(interval=>interval.ms===30000))await interval.callback();});
  await page.waitForFunction(()=>document.querySelector('#main tbody .lead-title')?.textContent==='Project 100');
  assert.ok(f.requests>=2);assert.deepEqual(await titles(page),['Project 100','Project 30','Project 2']);
  assert.equal(await page.locator('#sort-title-desc').getAttribute('aria-pressed'),'true');
  const downloading=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await downloading,stream=await download.createReadStream();let csv='';for await(const bytes of stream)csv+=bytes.toString();
  assert.ok(csv.indexOf('Project 100')<csv.indexOf('Project 30'));assert.ok(csv.indexOf('Project 30')<csv.indexOf('Project 2'));
  assert.deepEqual(f.errors,[]);
 });
});
