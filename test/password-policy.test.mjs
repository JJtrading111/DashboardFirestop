import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp} from '../server.mjs';

const origin='https://password-policy.example.test';
const ownerEmail='password-policy-owner@example.test',ownerPassword='Password-policy-owner-2026!';

async function fixture(t){
 const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
  adminEmail:ownerEmail,adminName:'Testbeheerder',adminPassword:ownerPassword,bootstrapToken:'',demoCleanupId:'',seedDemoData:false});
 t.after(()=>app.close());
 function client(){
  const browser={cookie:'',csrfToken:''};
  browser.request=async(path,{method='GET',body}={})=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...browser.csrfToken&&{'x-csrf-token':browser.csrfToken}}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);
   const data=JSON.parse(res.bytes.toString()),cookie=res.headers['set-cookie'];
   if(cookie)browser.cookie=cookie.split(';')[0];if(res.status===200&&data.csrfToken)browser.csrfToken=data.csrfToken;
   return{status:res.status,data};
  };
  browser.login=(email,password)=>browser.request('/api/auth/login',{method:'POST',body:{email,password}});
  browser.activate=(token,password)=>browser.request('/api/auth/activate',{method:'POST',body:{token,name:'Testgebruiker',password}});
  return browser;
 }
 const owner=client();assert.equal((await owner.login(ownerEmail,ownerPassword)).status,200);
 async function invite(suffix){
  const email='password-policy-'+suffix+'@example.test';
  const response=await owner.request('/api/action',{method:'POST',body:{type:'invitation.create',companyId:'c-noord',payload:{name:'Testgebruiker',email,companyId:'c-noord',role:'verkoper'}}});
  assert.equal(response.status,200);return{email,token:response.data.result.token};
 }
 return{client,invite};
}

test('invalid activation password lengths return the exact conditions without consuming the invitation',async t=>{
 const {client,invite}=await fixture(t),invitation=await invite('invalid'),browser=client();
 for(const password of ['s'.repeat(11),'l'.repeat(257),null,123456789012]){
  const response=await browser.activate(invitation.token,password);
  assert.equal(response.status,400);assert.match(response.data.error,/minimaal 12 en maximaal 256 tekens/);
  if(typeof password==='string')assert.equal(JSON.stringify(response.data).includes(password),false,'Rejected passwords must not be reflected');
  assert.equal((await browser.request('/api/invitations/preview',{method:'POST',body:{token:invitation.token}})).status,200);
  assert.equal((await browser.request('/api/session')).data.authenticated,false);
 }
 assert.equal((await browser.activate(invitation.token,'a'.repeat(12))).status,200,'The same invitation is still usable after invalid attempts');
 assert.equal((await client().request('/api/invitations/preview',{method:'POST',body:{token:invitation.token}})).status,410);
});

for(const length of [12,256])test(`an invited user can activate and sign in with exactly ${length} characters without additional composition rules`,async t=>{
 const {client,invite}=await fixture(t),invitation=await invite(String(length)),password='a'.repeat(length),browser=client();
 const activated=await browser.activate(invitation.token,password);
 assert.equal(activated.status,200);assert.equal(activated.data.authenticated,true);assert.equal(activated.data.user.role,'verkoper');
 assert.equal(activated.data.user.companyId,'c-noord');assert.equal(JSON.stringify(activated.data).includes(password),false);
 const login=await client().login(invitation.email,password);assert.equal(login.status,200);assert.equal(login.data.authenticated,true);
 assert.equal((await client().login(invitation.email,password+'x')).status,401,'A longer or otherwise changed password cannot sign in');
});
