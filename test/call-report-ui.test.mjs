import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://call-report.example.test',password='Call-report-browser-test-2026!';
const day=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

test('the chief phone activity report counts actual calls by user and calendar period', {skip:!chromium||!executablePath?'Install scraper dependencies and Chromium to run call report browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{role='hoofdbeheerder',mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:'call-report-owner@example.test',adminName:'Belrapportbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email:'call-report-owner@example.test',password}});assert.equal(login.status,200);
  const ownerCookie=login.headers['set-cookie'].split(';')[0],ownerHeaders={cookie:ownerCookie,'x-csrf-token':login.json().csrfToken};
  async function action(type,payload={},companyId='c-noord',headers=ownerHeaders){const r=await dispatch('/api/action',{method:'POST',headers,body:{type,companyId,payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();}
  await action('company.update',{companyId:'c-noord',name:'Noord Belteam'});
  const south=(await action('company.create',{name:'Zuid Belteam'})).result.company;
  async function member(name,email,companyId,memberRole='verkoper'){
   const invitation=(await action('invitation.create',{name,email,companyId,role:memberRole})).result;
   const r=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}});assert.equal(r.status,200);
   return{user:r.json().user,cookie:r.headers['set-cookie'].split(';')[0],headers:{cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrfToken}};
  }
  const noor=await member('Noor Noord','call-noor@example.test','c-noord'),daan=await member('Daan Noord','call-daan@example.test','c-noord'),bas=await member('Bas Zuid','call-bas@example.test',south.id);
  const token=(await action('source.import.rotate',{id:'bouw'})).result.importToken;
  const imported=await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+token},body:{runId:'call-report-fixture',items:[
   {externalId:'call-report-north',title:'Belproject Noord',organization:'Aannemer Noord',city:'Utrecht'},
   {externalId:'call-report-south',title:'Belproject Zuid',organization:'Aannemer Zuid',city:'Breda'}
  ]}});assert.equal(imported.status,200);
  const read=await dispatch('/api/state?companyId=c-noord',{headers:ownerHeaders});assert.equal(read.status,200);const initial=read.json().state;
  const northLead=initial.leads.find(l=>l.importExternalId==='call-report-north'),southLead=initial.leads.find(l=>l.importExternalId==='call-report-south');
  const actualNow=Date.now,now=actualNow();
  async function calls(member,lead,companyId,ages){
   for(const age of ages)try{const at=now-age*86400000;Date.now=()=>at;await action('call.record',{leadId:lead.id,outcome:'unanswered'},companyId,member.headers);}finally{Date.now=actualNow;}
  }
  await calls(noor,northLead,'c-noord',[40,2,0,0]);await calls(daan,northLead,'c-noord',[10,0]);await calls(bas,southLead,south.id,[2,2,1,0]);
  await action('user.update',{userId:daan.user.id,companyId:south.id,role:'verkoper'});
  let current={user:login.json().user,cookie:ownerCookie,headers:ownerHeaders};if(role==='verkoper')current=noor;if(role==='bedrijfsbeheerder')current=await member('Manager Zuid','call-manager@example.test',south.id,'bedrijfsbeheerder');
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,acceptDownloads:true});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:current.cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await page.addInitScript(()=>{window.__callReportTimers=[];window.setInterval=(callback,ms,...args)=>{window.__callReportTimers.push({callback:()=>callback(...args),ms});return window.__callReportTimers.length;};});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const response=await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes:request.postDataBuffer()});
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#reports');await page.locator('.app-shell').waitFor({state:'visible'});
  return{page,noor,daan,bas,south,northLead,southLead,current,dispatch,action,errors,now};
 }
 const filter=(f,name)=>f.page.locator('[data-call-report-filter="'+name+'"]');
 const row=(f,id)=>f.page.locator('tr[data-call-report-seller="'+id+'"]');
 const total=async(f,id)=>Number((await row(f,id).locator('[data-call-report-total]').innerText()).trim());
 async function select(f,name,value){await filter(f,name).selectOption(value);}
 async function date(f,name,value){await filter(f,name).fill(value);await filter(f,name).dispatchEvent('change');}
 const stat=async(f,name)=>Number((await f.page.locator('[data-call-report-stat="'+name+'"] .stat-value').innerText()).trim());

 await t.test('default phone activity counts repeated calls once each and does not double count the two stored call copies',async t=>{
  const f=await fixture(t);await f.page.locator('.call-report-page').waitFor({state:'visible'});
  assert.equal(await stat(f,'calls'),9);assert.equal(await stat(f,'users'),3);assert.equal(await stat(f,'companies'),2);
  assert.equal(await total(f,f.noor.user.id),3);assert.equal(await total(f,f.daan.user.id),2);assert.equal(await total(f,f.bas.user.id),4);assert.equal(await total(f,'u-admin'),0);
  const today=day(f.now),noorToday=row(f,f.noor.user.id).locator('[data-call-report-count="'+today+'"]');assert.equal(Number(await noorToday.innerText()),2);
  assert.equal(await f.page.locator('[data-call-report-period]').count(),30);assert.deepEqual(f.errors,[]);
 });
 await t.test('day, week and month grouping retain the actual total and both date endpoints are inclusive',async t=>{
  const f=await fixture(t);for(const group of ['week','month','day']){await select(f,'groupBy',group);assert.equal(await stat(f,'calls'),9);assert.equal(await total(f,f.noor.user.id),3);}
  const today=day(f.now);await date(f,'from',today);await date(f,'to',today);assert.equal(await stat(f,'calls'),4);
  assert.equal(await total(f,f.noor.user.id),2);assert.equal(await total(f,f.daan.user.id),1);assert.equal(await total(f,f.bas.user.id),1);
  await date(f,'from',day(f.now-50*86400000));assert.equal(await stat(f,'calls'),10);assert.equal(await total(f,f.noor.user.id),4);assert.deepEqual(f.errors,[]);
 });
 await t.test('company and user filters retain historical calls in the company where they happened',async t=>{
  const f=await fixture(t);await select(f,'company','c-noord');assert.equal(await stat(f,'calls'),5);assert.equal(await stat(f,'companies'),1);
  assert.equal(await total(f,f.daan.user.id),2);await select(f,'seller',f.daan.user.id);assert.equal(await stat(f,'calls'),2);assert.equal(await stat(f,'users'),1);
  await select(f,'company',f.south.id);assert.equal(await filter(f,'seller').inputValue(),'all');assert.equal(await stat(f,'calls'),4);assert.equal(await total(f,f.bas.user.id),4);assert.equal(await total(f,f.daan.user.id),0);assert.deepEqual(f.errors,[]);
 });
 await t.test('the exported CSV contains the same user, periods and actual call counts as the table',async t=>{
  const f=await fixture(t);await select(f,'groupBy','month');const promised=f.page.waitForEvent('download');await f.page.locator('[data-action="export-call-report"]').click();const download=await promised;
  assert.match(download.suggestedFilename(),/\.csv$/);const text=(await readFile(await download.path(),'utf8')).replace(/^\uFEFF/,'');
  const csv=text.trim().split(/\r?\n/).map(line=>line.split(';').map(cell=>cell.replace(/^"|"$/g,'').replace(/""/g,'"')));
  assert.equal(csv[0][0],'Gebruiker');assert.equal(csv[0][1],'Bedrijven');assert.equal(csv[0].at(-1),'Totaal');
  for(const [name,expected]of [['Noor Noord',3],['Daan Noord',2],['Bas Zuid',4],['Belrapportbeheerder',0]]){const item=csv.find(cells=>cells[0]===name);assert.ok(item,name);assert.equal(Number(item.at(-1)),expected);assert.equal(item.slice(2,-1).reduce((sum,n)=>sum+Number(n),0),expected);}
  assert.deepEqual(f.errors,[]);
 });
 await t.test('conversion reporting remains available as a separate tab',async t=>{
  const f=await fixture(t);await f.page.locator('[data-action="report-view"][data-value="conversion"]').click();await f.page.locator('[data-field="reportCompany"]').waitFor({state:'visible'});
  assert.equal(await f.page.locator('.call-report-page').count(),0);await f.page.locator('[data-action="report-view"][data-value="calls"]').click();await f.page.locator('.call-report-page').waitFor({state:'visible'});assert.equal(await stat(f,'calls'),9);assert.deepEqual(f.errors,[]);
 });
 for(const role of ['verkoper','bedrijfsbeheerder'])await t.test(role+' cannot obtain all-company phone activity or switch to its tab',async t=>{
  const f=await fixture(t,{role});assert.equal(await f.page.locator('.call-report-page,[data-action="report-view"][data-value="calls"]').count(),0);
  await f.page.evaluate(()=>{const button=document.createElement('button');button.dataset.action='report-view';button.dataset.value='calls';document.body.append(button);button.click();button.remove();});
  assert.equal(await f.page.locator('.call-report-page,.call-report-table').count(),0);
  const other=role==='verkoper'?f.south.id:'c-noord',response=await f.dispatch('/api/state?companyId='+encodeURIComponent(other),{headers:f.current.headers});assert.equal(response.status,403);assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': long period tables scroll inside their panel and filters fit the page',async t=>{
  const f=await fixture(t,{mobile}),viewport=f.page.viewportSize();await f.page.locator('.call-report-page').waitFor({state:'visible'});
  for(const element of await f.page.locator('[data-call-report-filter],.call-report-page .table-wrap').all()){const box=await element.boundingBox();assert.ok(box&&box.width>0&&box.x>=-1&&box.x+box.width<=viewport.width+1,'Call report controls must fit the viewport');}
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const wrap=f.page.locator('.call-report-page .table-wrap');assert.equal(await wrap.evaluate(el=>el.scrollWidth>el.clientWidth),true);
  await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth-el.clientWidth;});
  const last=row(f,f.noor.user.id).locator('[data-call-report-total]'),today=row(f,f.noor.user.id).locator('[data-call-report-count="'+day(f.now)+'"]');
  const firstBox=await row(f,f.noor.user.id).locator('td').first().boundingBox(),todayBox=await today.boundingBox(),totalBox=await last.boundingBox();
  assert.ok(firstBox&&todayBox&&totalBox&&todayBox.x>=firstBox.x+firstBox.width-1&&todayBox.x+todayBox.width<=totalBox.x+1,'Scrolling must expose the latest period between the fixed user and total columns');
  if(process.env.CALL_REPORT_SCREENSHOTS==='1'){await mkdir(new URL('../work/',import.meta.url),{recursive:true});await f.page.screenshot({path:fileURLToPath(new URL('../work/call-report-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});}
  assert.deepEqual(f.errors,[]);
 });
});
