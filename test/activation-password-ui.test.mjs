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
const origin='https://activation-password.example.test';
const ownerEmail='activation-owner@example.test',ownerPassword='Activation-owner-test-password!';
const chosenPassword='abcdefghijkl';

test('invited users receive accurate password requirements and inline feedback without losing their form', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run activation DOM checks':false},async t=>{
 const browser=await chromium.launch({headless:true,executablePath});t.after(()=>browser.close());
 async function fixture(t,{mobile=false}={}){
  const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
   adminEmail:ownerEmail,adminName:'Uitnodigingsbeheerder',adminPassword:ownerPassword,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,
   scraperEncryptionKey:'',scraperWorkerToken:''});t.after(()=>app.close());
  async function dispatch(path,{method='GET',headers={},body,bytes}={}){
   const req=Object.assign(Readable.from(bytes?[bytes]:body?[Buffer.from(JSON.stringify(body))]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
  }
  const login=await dispatch('/api/auth/login',{method:'POST',body:{email:ownerEmail,password:ownerPassword}});assert.equal(login.status,200);
  const headers={cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrfToken};
  const invitation=await dispatch('/api/action',{method:'POST',headers,body:{type:'invitation.create',companyId:'c-noord',payload:{name:'Nieuwe collega',email:'nieuwe-collega@example.test',companyId:'c-noord',role:'verkoper'}}});
  assert.equal(invitation.status,200);const token=invitation.json().result.token;
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile});t.after(()=>page.close());
  const requests=[],errors=[];let nextActivation=null;
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.setInterval=()=>0;});
  await page.route('**/*',async intercepted=>{
   const request=intercepted.request(),url=new URL(request.url());if(url.origin!==origin)return intercepted.abort();
   const bytes=request.postDataBuffer(),payload=bytes?JSON.parse(bytes.toString()):null;
   const activate=url.pathname==='/api/auth/activate'&&request.method()==='POST';if(activate)requests.push(payload);
   const gate=activate?nextActivation:null;if(gate)nextActivation=null;
   const response=gate?.mode==='reject'?{status:503,headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({error:'Activeren is tijdelijk niet mogelijk. Probeer het opnieuw.'}))}:
    await dispatch(url.pathname+url.search,{method:request.method(),headers:await request.allHeaders(),bytes});
   if(gate){gate.started();await gate.released;}
   await intercepted.fulfill({status:response.status,headers:response.headers,body:response.bytes});
  });
  await page.goto(origin+'/#activate='+encodeURIComponent(token));await page.locator('#activation-form').waitFor({state:'visible'});
  return{page,token,dispatch,requests,errors,
   gate(mode='hold'){let start,release,timer;const started=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Activation request did not reach the backend')),5000);start=()=>{clearTimeout(timer);resolve();};});
    const released=new Promise(resolve=>release=resolve);t.after(()=>{clearTimeout(timer);release();});nextActivation={mode,started:start,released};return{started,release};}};
 }
 const password=f=>f.page.locator('#auth-password'),confirm=f=>f.page.locator('#auth-passwordConfirm');
 const rule=(f,name)=>f.page.locator('[data-password-rule="'+name+'"]');
 const alert=f=>f.page.locator('[data-activation-password-error]');
 const submit=f=>f.page.locator('#activation-form [type="submit"]');
 async function fill(f,value=chosenPassword,repeated=value){await password(f).fill(value);await confirm(f).fill(repeated);}
 async function state(f,name,value){assert.equal(await rule(f,name).getAttribute('data-state'),value);}

 await t.test('the invitation explains only the actual length and confirmation requirements below the fields',async t=>{
  const f=await fixture(t),requirements=f.page.locator('#activation-password-requirements');
  await requirements.waitFor({state:'visible'});const text=await requirements.innerText();assert.match(text,/12/);assert.match(text,/256/);assert.match(text,/gelijk|overeen|zelfde/i);
  assert.doesNotMatch(text,/hoofdletter|cijfer verplicht|speciaal teken verplicht/i);
  assert.equal(await password(f).getAttribute('maxlength'),'256');assert.equal(await confirm(f).getAttribute('maxlength'),'256');
  const box=await requirements.boundingBox(),inputBox=await confirm(f).boundingBox();assert.ok(box&&inputBox&&box.y>=inputBox.y+inputBox.height);
  for(const input of [password(f),confirm(f)])assert.ok((await input.getAttribute('aria-describedby')||'').includes('activation-password-requirements'));
  await state(f,'length','pending');await state(f,'match','pending');assert.equal(await alert(f).isVisible(),false);assert.deepEqual(f.errors,[]);
 });
 await t.test('short passwords and mismatched confirmations are explained inline and never sent to activation',async t=>{
  const f=await fixture(t);await password(f).pressSequentially('kort',{delay:15});await state(f,'length','invalid');
  assert.equal(await password(f).getAttribute('aria-invalid'),'true');
  await submit(f).click();assert.equal(f.requests.length,0);await alert(f).waitFor({state:'visible'});assert.match(await alert(f).innerText(),/12/);
  assert.equal(await password(f).inputValue(),'kort');assert.equal(await f.page.locator('#activation-form [name="name"]').inputValue(),'Nieuwe collega');
  await fill(f,chosenPassword,'anderwachtwoord');await state(f,'length','valid');await state(f,'match','invalid');
  await submit(f).click();assert.equal(f.requests.length,0);assert.match(await alert(f).innerText(),/overeen|gelijk|zelfde/i);
  assert.equal(await password(f).inputValue(),chosenPassword);assert.equal(await confirm(f).inputValue(),'anderwachtwoord');
  await confirm(f).fill(chosenPassword);await state(f,'match','valid');assert.notEqual(await confirm(f).getAttribute('aria-invalid'),'true');
  await password(f).fill('mnopqrstuvwx');await state(f,'length','valid');await state(f,'match','invalid');assert.deepEqual(f.errors,[]);
 });
 await t.test('empty confirmation and empty name are rejected before any activation request',async t=>{
  const f=await fixture(t);await password(f).fill(chosenPassword);await submit(f).click();
  assert.equal(f.requests.length,0);assert.equal(await alert(f).isVisible(),true);assert.match(await alert(f).innerText(),/herhaal|bevestig|overeen|gelijk/i);
  await confirm(f).fill(chosenPassword);await f.page.locator('#activation-form [name="name"]').fill('');await submit(f).click();
  assert.equal(f.requests.length,0);assert.match(await alert(f).innerText(),/naam/i);assert.equal(await password(f).inputValue(),chosenPassword);assert.deepEqual(f.errors,[]);
 });
 await t.test('paste and autofill events update both rules and an oversized programmatic value remains invalid',async t=>{
  const f=await fixture(t);await password(f).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},chosenPassword);
  await confirm(f).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));},chosenPassword);
  await state(f,'length','valid');await state(f,'match','valid');
  await password(f).evaluate(input=>{input.value='a'.repeat(257);input.dispatchEvent(new Event('input',{bubbles:true}));});
  await state(f,'length','invalid');await submit(f).click();assert.equal(f.requests.length,0);assert.match(await alert(f).innerText(),/256/);assert.deepEqual(f.errors,[]);
 });
 await t.test('oversized clipboard pastes keep their complete value for correction in both password fields',async t=>{
  const f=await fixture(t);await fill(f);
  for(const name of ['password','passwordConfirm']){
   const input=name==='password'?password(f):confirm(f),pasted=(name==='password'?'x':'z').repeat(257);
   const expected=name==='password'?chosenPassword.slice(0,2)+pasted+chosenPassword.slice(5):pasted;
   const prevented=await input.evaluate((element,{name,pasted})=>{
    element.focus();element.setSelectionRange(name==='password'?2:0,name==='password'?5:element.value.length);
    const clipboardData=new DataTransfer();clipboardData.setData('text',pasted);
    return !element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
   },{name,pasted});
   assert.equal(prevented,true,'The complete oversized paste must replace native silent truncation');
   assert.equal(await input.inputValue(),expected);assert.equal(await input.getAttribute('type'),'password');
   assert.equal(await input.getAttribute('aria-invalid'),'true');assert.equal(await alert(f).isVisible(),true);
   assert.match(await alert(f).innerText(),/256/);if(name==='passwordConfirm')assert.match(await alert(f).innerText(),/herhaalde/i);
   await submit(f).click();assert.equal(f.requests.length,0);assert.equal(await input.inputValue(),expected);
   await fill(f);await state(f,'length','valid');await state(f,'match','valid');assert.equal(await alert(f).isVisible(),false);
  }
  assert.deepEqual(f.errors,[]);
 });
 await t.test('showing either password preserves values, selection and accurate feedback',async t=>{
  const f=await fixture(t);await fill(f);await password(f).focus();await password(f).evaluate(input=>input.setSelectionRange(2,7));
  await f.page.locator('[data-action="toggle-password"][aria-controls="auth-password"]').click();
  assert.equal(await password(f).getAttribute('type'),'text');assert.equal(await password(f).inputValue(),chosenPassword);await state(f,'length','valid');await state(f,'match','valid');
  await f.page.locator('[data-action="toggle-password"][aria-controls="auth-passwordConfirm"]').click();assert.equal(await confirm(f).getAttribute('type'),'text');
  assert.equal(await confirm(f).inputValue(),chosenPassword);await state(f,'match','valid');
  const storage=await f.page.evaluate(()=>JSON.stringify({...localStorage}));assert.equal(storage.includes(chosenPassword),false);assert.deepEqual(f.errors,[]);
 });
 await t.test('a server rejection preserves the complete input DOM and permits a successful retry',async t=>{
  const f=await fixture(t);await fill(f);await f.page.locator('#activation-form [name="name"]').fill('Gewijzigde collega');
  await f.page.evaluate(()=>{window.originalActivationForm=document.querySelector('#activation-form');window.originalPassword=document.querySelector('#auth-password');});
  const gate=f.gate('reject');await submit(f).click();await gate.started;assert.equal(await submit(f).isDisabled(),true);gate.release();
  await alert(f).waitFor({state:'visible'});assert.match(await alert(f).innerText(),/tijdelijk/);
  assert.equal(await f.page.evaluate(()=>window.originalActivationForm===document.querySelector('#activation-form')&&window.originalPassword===document.querySelector('#auth-password')),true);
  assert.equal(await password(f).inputValue(),chosenPassword);assert.equal(await confirm(f).inputValue(),chosenPassword);assert.equal(await f.page.locator('#activation-form [name="name"]').inputValue(),'Gewijzigde collega');
  assert.equal(await submit(f).isDisabled(),false);await submit(f).click();await f.page.locator('.app-shell').waitFor({state:'visible'});assert.equal(f.requests.length,2);assert.deepEqual(f.errors,[]);
 });
 await t.test('a valid lowercase twelve-character password activates once, even when submitted again while awaiting acknowledgement',async t=>{
  const f=await fixture(t);await fill(f);const gate=f.gate();await submit(f).click();await gate.started;
  await f.page.locator('#activation-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});assert.equal(f.requests.length,1);
  gate.release();await f.page.locator('.app-shell').waitFor({state:'visible'});
  const reused=await f.dispatch('/api/invitations/preview',{method:'POST',body:{token:f.token}});assert.equal(reused.status,410);
  assert.equal(f.requests[0].password,chosenPassword);assert.deepEqual(f.errors,[]);
 });
 await t.test('ordinary login accepts the existing maximum and does not show account-creation rules',async t=>{
  const f=await fixture(t);await f.page.goto(origin+'/login');await f.page.locator('#login-form').waitFor({state:'visible'});
  assert.equal(await f.page.locator('#activation-password-requirements').count(),0);assert.equal(await f.page.locator('[data-password-rule]').count(),0);
  assert.equal(await password(f).getAttribute('maxlength'),'256');assert.deepEqual(f.errors,[]);
 });
 for(const mobile of [false,true])await t.test((mobile?'mobile':'desktop')+': conditions and feedback fit the activation form',async t=>{
  const f=await fixture(t,{mobile});await fill(f,'kort','ander');await submit(f).click();
  const viewport=f.page.viewportSize();for(const selector of ['#activation-password-requirements','[data-activation-password-error]','#auth-password','#auth-passwordConfirm']){
   const box=await f.page.locator(selector).boundingBox();assert.ok(box&&box.width>0&&box.x>=0&&box.x+box.width<=viewport.width+1,'Activation controls must fit horizontally');
  }
  if(process.env.ACTIVATION_PASSWORD_SCREENSHOTS==='1'){
   await password(f).fill('');await confirm(f).fill('');await mkdir(new URL('../work/',import.meta.url),{recursive:true});
   await f.page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
   await f.page.screenshot({path:fileURLToPath(new URL('../work/activation-password-'+(mobile?'mobile':'desktop')+'.png',import.meta.url)),fullPage:true});
  }
  assert.deepEqual(f.errors,[]);
 });
});
