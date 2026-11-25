import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {createApp} from '../server.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',chromium?.executablePath()
].find(value=>value&&existsSync(value));
const origin='https://logout-ui.example.test',password='Logout-browser-test-password-2026!';

test('logout ends the browser session and returns a user to the home page', {skip:!chromium||!executablePath?'Install scraper dependencies and Chromium to run logout browser checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{remember=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:'logout-owner@example.test',adminName:'Logoutbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const owner=await dispatch('/api/auth/login',{method:'POST',body:{email:'logout-owner@example.test',password}});assert.equal(owner.status,200);
  const ownerHeaders={cookie:owner.headers['set-cookie'].split(';')[0],'x-csrf-token':owner.json().csrfToken};
  const action=async(type,payload)=>{const r=await dispatch('/api/action',{method:'POST',headers:ownerHeaders,body:{type,companyId:'c-noord',payload}});assert.equal(r.status,200,r.bytes.toString());return r.json();};
  const invitation=(await action('invitation.create',{name:'Logoutverkoper',email:'logout-seller@example.test',companyId:'c-noord',role:'verkoper'})).result;
  const activated=await dispatch('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Logoutverkoper',password}});assert.equal(activated.status,200);
  const login=remember?await dispatch('/api/auth/login',{method:'POST',body:{email:'logout-seller@example.test',password,rememberMe:true}}):activated;assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],sellerHeaders={cookie,'x-csrf-token':login.json().csrfToken};
  const lead=(await action('lead.create',{title:'Privéproject voor logout',source:'bouw',organization:'Logoutorganisatie',city:'Utrecht',phone:'030-2222222',contact:'Privécontact',email:'contact@example.test',description:'Privéproject voor het controleren van uitloggen.'})).result.lead;
  await action('note.add',{leadId:lead.id,text:'Privénotitie die na uitloggen niet zichtbaar mag zijn.'});
  await action('callback.add',{leadId:lead.id,assigneeId:login.json().user.id,dueAt:new Date(Date.now()+3600000).toISOString(),description:'Opvolging voor logout'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});t.after(()=>page.close());
  await page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax',...remember?{expires:Math.floor(Date.now()/1000)+30*86400}:{}}]);
  await page.addInitScript(()=>{window.__logoutIntervals=[];window.setInterval=(callback,ms,...args)=>{window.__logoutIntervals.push({callback:()=>callback(...args),ms});return window.__logoutIntervals.length;};});
  const requests=[],errors=[];let nextLogout=null,nextAction=null,nextRead=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   requests.push({path:url.pathname,method:request.method(),type:payload?.type});
   const isLogout=url.pathname==='/api/auth/logout',isAction=url.pathname==='/api/action',isRead=url.pathname==='/api/state';
   const gate=isLogout?nextLogout:isAction?nextAction:isRead?nextRead:null;
   if(gate){if(isLogout)nextLogout=null;else if(isAction)nextAction=null;else nextRead=null;}
   if(gate?.mode==='network'){gate.started();await gate.released;await intercepted.abort('failed');gate.finished();return;}
   const response=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Uitloggen is tijdelijk niet mogelijk. Probeer het opnieuw.'}))}:
    await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}
   try{await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});}catch(error){if(!request.failure())throw error;}finally{gate?.finished();}
  });
  await page.goto(origin+'/#callbacks');await page.locator('.profile-button').waitFor({state:'visible'});
  return{page,lead,cookie,sellerHeaders,ownerHeaders,dispatch,requests,errors,
   async account(){await page.locator('.profile-button[data-action="account"]').click();await page.locator('.modal [data-action="logout"]').waitFor({state:'visible'});},
   async session(){const r=await dispatch('/api/session',{headers:sellerHeaders});assert.equal(r.status,200);return r.json();},
   hold(kind='logout',mode='hold'){let start,release,finished,timer;
    const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error(kind+' request did not arrive')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finished=resolve);t.after(()=>{clearTimeout(timer);release();});
    const gate={mode,started:start,released,finished};if(kind==='logout')nextLogout=gate;else if(kind==='action')nextAction=gate;else nextRead=gate;
    return{started,release,done};}
  };
 }
 const logoutButton=f=>f.page.locator('.modal [data-action="logout"]');
 async function home(f){await f.page.waitForURL(url=>url.origin===origin&&url.pathname==='/'&&!url.search&&!url.hash);await f.page.locator('#login-form').waitFor({state:'visible'});assert.equal(await f.page.locator('.app-shell,.modal,.workbook-drawer').count(),0);}

 for(const remember of [false,true])await t.test((remember?'remembered':'ordinary')+' user logs out, clears the cookie and arrives at the home page',async t=>{
  const f=await fixture(t,{remember});assert.equal((await f.session()).authenticated,true);
  await f.account();await logoutButton(f).click();await home(f);
  assert.equal((await f.session()).authenticated,false);assert.equal((await f.dispatch('/api/state',{headers:f.sellerHeaders})).status,401);
  assert.equal((await f.dispatch('/api/session',{headers:f.ownerHeaders})).json().authenticated,true,'The other account session stays active');
  assert.equal((await f.page.context().cookies(origin)).some(cookie=>cookie.name==='bouw_session'),false);
  assert.equal(f.requests.filter(r=>r.path==='/api/auth/logout').length,1);assert.deepEqual(f.errors,[]);
 });
 await t.test('a pending logout disables duplicate clicks until the server confirms it',async t=>{
  const f=await fixture(t);await f.account();const gate=f.hold();await logoutButton(f).click();await gate.started;
  assert.equal(await logoutButton(f).isDisabled(),true);await logoutButton(f).evaluate(button=>{button.click();button.click();});
  assert.equal(f.requests.filter(r=>r.path==='/api/auth/logout').length,1);assert.equal(new URL(f.page.url()).hash,'#callbacks');
  gate.release();await home(f);assert.deepEqual(f.errors,[]);
 });
 await t.test('an already expired session can still be logged out to the home page',async t=>{
  const f=await fixture(t);await f.account();const ended=await f.dispatch('/api/auth/logout',{method:'POST',headers:f.sellerHeaders,body:{}});assert.equal(ended.status,200);
  await logoutButton(f).click();await home(f);assert.equal((await f.session()).authenticated,false);assert.deepEqual(f.errors,[]);
 });
 await t.test('logout refreshes the current cookie session when another tab has replaced its CSRF token',async t=>{
  const f=await fixture(t);await f.account();
  const replacement=await f.dispatch('/api/auth/login',{method:'POST',body:{email:'logout-owner@example.test',password,rememberMe:true}});assert.equal(replacement.status,200);
  const cookie=replacement.headers['set-cookie'].split(';')[0];
  await f.page.context().addCookies([{name:'bouw_session',value:cookie.slice('bouw_session='.length),url:origin+'/',httpOnly:true,sameSite:'Lax'}]);
  await logoutButton(f).click();await home(f);
  const ended=await f.dispatch('/api/session',{headers:{cookie}});assert.equal(ended.json().authenticated,false);
  assert.equal((await f.session()).authenticated,true,'The superseded independent seller session is not revoked as though it were the current cookie');
  assert.equal((await f.page.context().cookies(origin)).some(cookie=>cookie.name==='bouw_session'),false);assert.deepEqual(f.errors,[]);
 });
 for(const mode of ['reject','network'])await t.test('a '+mode+' failure keeps logout retryable without pretending the server session ended',async t=>{
  const f=await fixture(t);await f.account();const gate=f.hold('logout',mode);await logoutButton(f).click();await gate.started;gate.release();await gate.done;
  const error=f.page.locator('[data-logout-error]');await error.waitFor({state:'visible'});
  assert.equal((await f.session()).authenticated,true);assert.equal(await f.page.locator('#login-form').count(),0);assert.equal(new URL(f.page.url()).hash,'#callbacks');
  assert.equal(await logoutButton(f).isEnabled(),true);await logoutButton(f).click();await home(f);assert.equal((await f.session()).authenticated,false);assert.deepEqual(f.errors,[]);
 });
 await t.test('a delayed mutation acknowledgement cannot hold up logout or restore the former user',async t=>{
  const f=await fixture(t),write=f.hold('action');await f.page.locator('[data-action="complete-callback"]').first().click();await write.started;
  await f.account();await logoutButton(f).click();await home(f);
  assert.equal((await f.session()).authenticated,false);write.release();await write.done;
  await f.page.waitForTimeout(75);assert.equal(await f.page.locator('.app-shell,.modal').count(),0);assert.equal(await f.page.locator('#login-form').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('a late background refresh cannot restore private content after logout',async t=>{
  const f=await fixture(t),read=f.hold('read');await f.page.evaluate(()=>{window.__logoutIntervals.find(timer=>timer.ms===30000).callback();});await read.started;
  await f.account();await logoutButton(f).click();await home(f);read.release();await read.done;
  await f.page.waitForTimeout(75);assert.equal(await f.page.locator('.app-shell,.modal').count(),0);assert.equal(await f.page.locator('#login-form').count(),1);assert.deepEqual(f.errors,[]);
 });
 await t.test('returning with browser back cannot recover private content from the ended session',async t=>{
  const f=await fixture(t);await f.page.locator('[data-route="leads"]').first().click();await f.page.waitForURL('**/#leads');await f.page.locator('#lead-search').waitFor({state:'visible'});
  await f.account();await logoutButton(f).click();await home(f);await f.page.goBack();await f.page.locator('#login-form').waitFor({state:'visible'});
  assert.equal(await f.page.locator('.app-shell,.modal,.workbook-drawer').count(),0);assert.equal((await f.page.locator('body').innerText()).includes('Privéproject voor logout'),false);assert.deepEqual(f.errors,[]);
 });
});
