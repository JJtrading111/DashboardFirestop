import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';

const origin='https://logout-session.example.test';
const ownerEmail='logout-owner@example.test',password='Logout-session-test-password!';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-logout-session-'));
 const app=createApp({dataDir,publicOrigin:origin,publicOriginAliases:'',secureCookies:true,
  adminEmail:ownerEmail,adminName:'Testbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false});
 t.after(async()=>{await app.close();const resolved=path.resolve(dataDir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('bouwberichten-logout-session-'));await rm(resolved,{recursive:true,force:true});});
 async function request(route,{method='GET',body,headers={}}={}){
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:route,method,socket:{remoteAddress:'127.0.0.1'},
   headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
  const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
   writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
   end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
  await app.handler(req,res);return{status:res.status,data:JSON.parse(res.bytes.toString()),headers:res.headers};
 }
 function client(){
  const browser={cookie:'',csrfToken:''};
  browser.request=async(route,{csrf=true,headers={},...options}={})=>{
   const response=await request(route,{...options,headers:{...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrfToken&&{'x-csrf-token':browser.csrfToken},...headers}});
   if(response.headers['set-cookie'])browser.cookie=response.headers['set-cookie'].split(';')[0];
   if(response.status===200&&response.data.csrfToken)browser.csrfToken=response.data.csrfToken;
   return response;
  };
  browser.login=(rememberMe=false)=>browser.request('/api/auth/login',{method:'POST',body:{email:ownerEmail,password,rememberMe}});
  browser.logout=(options={})=>browser.request('/api/auth/logout',{method:'POST',body:{},...options});
  browser.action=(type,payload)=>browser.request('/api/action',{method:'POST',body:{type,companyId:'c-noord',payload}});
  return browser;
 }
 const sql=fn=>{const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{return fn(db);}finally{db.close();}};
 return{client,request,sql};
}

function assertCleared(response){
 ok(response);assert.deepEqual(response.data,{authenticated:false});
 assert.match(response.headers['set-cookie'],/^bouw_session=;/);
 for(const part of ['Path=/','HttpOnly','SameSite=Lax','Max-Age=0','Secure'])assert.ok(response.headers['set-cookie'].includes(part));
}

for(const rememberMe of [false,true])test(`${rememberMe?'remembered':'ordinary'} logout revokes only the current session and prevents cookie replay`,async t=>{
 const {client,request,sql}=await fixture(t),owner=client(),sameUserDevice=client();
 const login=await owner.login(rememberMe);ok(login);assert.equal(/Max-Age=2592000/.test(login.headers['set-cookie']),rememberMe);
 ok(await sameUserDevice.login());
 const invitation=ok(await owner.action('invitation.create',{name:'Andere gebruiker',email:'logout-seller@example.test',companyId:'c-noord',role:'verkoper'})).result;
 const seller=client();ok(await seller.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Andere gebruiker',password}}));
 const originalCookie=owner.cookie,originalCsrf=owner.csrfToken,beforeState=sql(db=>db.prepare('SELECT json FROM app_state WHERE id=1').get().json),beforeSessions=sql(db=>db.prepare('SELECT count(*) AS count FROM sessions').get().count);
 assertCleared(await owner.logout());
 assert.equal(sql(db=>db.prepare('SELECT count(*) AS count FROM sessions').get().count),beforeSessions-1);
 assert.equal(sql(db=>db.prepare('SELECT csrf FROM sessions WHERE csrf=?').get(originalCsrf)),undefined);
 assert.equal(sql(db=>db.prepare('SELECT json FROM app_state WHERE id=1').get().json),beforeState);
 assert.equal(ok(await owner.request('/api/session')).authenticated,false);
 assert.equal((await owner.request('/api/state?companyId=c-noord')).status,401);
 const oldHeaders={cookie:originalCookie,'x-csrf-token':originalCsrf};
 assert.equal(ok(await request('/api/session',{headers:oldHeaders})).authenticated,false);
 assert.equal((await request('/api/state?companyId=c-noord',{headers:oldHeaders})).status,401);
 assert.equal((await request('/api/action',{method:'POST',headers:oldHeaders,body:{type:'settings.update',companyId:'c-noord',payload:{cooldownHours:0}}})).status,401);
 assertCleared(await request('/api/auth/logout',{method:'POST',headers:{cookie:originalCookie},body:{}}));
 assertCleared(await owner.logout({csrf:false}));
 assert.equal(ok(await sameUserDevice.request('/api/session')).authenticated,true,'Another device session remains signed in');
 assert.equal(ok(await seller.request('/api/session')).authenticated,true,'Another user remains signed in');
});

test('expired, missing, malformed and already revoked cookies can finish logout without a CSRF token',async t=>{
 const {client,request,sql}=await fixture(t),browser=client();ok(await browser.login(true));
 const originalCookie=browser.cookie;
 sql(db=>db.prepare('UPDATE sessions SET expires_at=? WHERE csrf=?').run(Date.now()-1000,browser.csrfToken));
 assert.equal(ok(await browser.request('/api/session')).authenticated,false);
 assertCleared(await browser.logout({csrf:false}));
 for(const cookie of ['',originalCookie,'bouw_session=not-valid','bouw_session='+'x'.repeat(43)]){
  assertCleared(await request('/api/auth/logout',{method:'POST',headers:cookie?{cookie}:{},body:{}}));
 }
 assert.equal((await request('/api/state?companyId=c-noord',{headers:{cookie:originalCookie}})).status,401);
});

test('active-session CSRF and origin protections remain mandatory and rejected logout leaves the session intact',async t=>{
 const {client,request}=await fixture(t),browser=client();ok(await browser.login(true));
 const originalCookie=browser.cookie;
 for(const options of [{csrf:false},{headers:{'x-csrf-token':'wrong'}},{headers:{origin:'https://other.example.test'}}]){
  const response=await browser.logout(options);assert.equal(response.status,403);assert.equal(response.headers['set-cookie'],undefined);
  assert.equal(ok(await browser.request('/api/session')).authenticated,true);
 }
 const crossSiteWithoutOrigin=await browser.logout({headers:{origin:undefined,'sec-fetch-site':'cross-site'}});
 assert.equal(crossSiteWithoutOrigin.status,403);assert.equal(ok(await browser.request('/api/session')).authenticated,true);
 for(const headers of [{origin:'https://other.example.test'},{origin:undefined,'sec-fetch-site':'cross-site'}]){
  const response=await request('/api/auth/logout',{method:'POST',headers,body:{}});assert.equal(response.status,403);assert.equal(response.headers['set-cookie'],undefined);
 }
 assert.equal((await request('/api/auth/logout',{headers:{cookie:originalCookie}})).status,405,'A GET cannot log out a user');
 assert.equal(ok(await browser.request('/api/session')).authenticated,true);
 assertCleared(await browser.logout());
});
