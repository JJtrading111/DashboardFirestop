import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../server.mjs';
import {buildCallReport,reportRows} from '../public/model.mjs';

const origin='https://company-delete.example.test',password='Company-delete-test-password-2026!';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
const results=state=>reportRows(state).sort((a,b)=>a.companyId.localeCompare(b.companyId)||a.sellerId.localeCompare(b.sellerId));

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-company-delete-'));
 const options={dataDir,publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:'company-owner@example.test',adminName:'Bedrijfsbeheer',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false};
 let app=createApp(options);
 t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('bouwberichten-company-delete-'));await rm(target,{recursive:true,force:true});});
 function client(){
  const browser={cookie:'',csrf:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,requestOrigin=origin}={})=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:route,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin:requestOrigin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrf&&{'x-csrf-token':browser.csrf}}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);let data;try{data=JSON.parse(res.bytes.toString());}catch{data=null;}
   if(res.headers['set-cookie'])browser.cookie=res.headers['set-cookie'].split(';')[0];if(res.status===200&&data?.csrfToken)browser.csrf=data.csrfToken;if(res.status===200&&data?.user)browser.user=data.user;
   return{status:res.status,data,bytes:res.bytes};
  };
  browser.action=(type,payload={},companyId='c-noord',options={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...options});
  browser.state=async(companyId='')=>ok(await browser.request('/api/state'+(companyId?'?companyId='+encodeURIComponent(companyId):''))).state;
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:options.adminEmail,password}}));
 async function addUser(name,companyId='c-noord',role='verkoper'){
  const invitation=ok(await owner.action('invitation.create',{name,email:randomUUID()+'@example.test',companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}}));return browser;
 }
 const createCompany=async(name='Leeg testbedrijf')=>ok(await owner.action('company.create',{name})).result.company;
 const createLead=async()=>ok(await owner.action('lead.create',{title:'Te behouden bedrijfshistorie',organization:'Aannemer Historie',city:'Utrecht',source:'bouw',contact:'Broncontact',phone:'030-2222222',email:'bron@example.test',description:'Centrale lead met bedrijfsgebonden resultaten.'})).result.lead;
 // Only this temporary test database is edited, to represent legacy inactive accounts.
 function editState(update){const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{const state=JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);update(state);db.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(state));}finally{db.close();}}
 return{owner,addUser,createCompany,createLead,editState,async restart(){await app.close();app=createApp(options);}};
}

test('removing an empty company preserves original workspaces, calls and conversion results and survives restart',async t=>{
 const f=await fixture(t),company=await f.createCompany('Historisch bouwbedrijf'),lead=await f.createLead(),seller=await f.addUser('Verkoper met historie',company.id);
 ok(await seller.action('call.record',{leadId:lead.id},company.id));
 ok(await seller.action('workspace.save',{leadId:lead.id,changes:{status:'offerte',commitment:true,calculation:true},note:{id:'note-'+randomUUID(),text:'Deze notitie blijft bewaard.'}},company.id));
 ok(await f.owner.action('user.update',{userId:seller.user.id,companyId:'c-noord',role:'verkoper'}));
 const invitation=ok(await f.owner.action('invitation.create',{name:'Nog uit te nodigen',email:'pending-company@example.test',companyId:company.id,role:'verkoper'})).result;
 const before=await f.owner.state(),beforeCalls=buildCallReport(before),beforeResults=results(before);
 const response=ok(await f.owner.action('company.delete',{companyId:company.id,confirmed:true},company.id)),after=response.state;
 assert.deepEqual(response.result,{deleted:true,companyId:company.id,revokedInvitations:1});assert.equal(response.companyId,'c-noord');
 assert.equal(after.companies.some(item=>item.id===company.id),false);assert.equal(after.archivedCompanies.length,1);
 const archived=after.archivedCompanies[0];assert.equal(archived.name,company.name);assert.equal(archived.deletedById,'u-admin');assert.ok(Number.isFinite(Date.parse(archived.deletedAt)));
 assert.deepEqual(after.workspaces,before.workspaces);assert.deepEqual(after.callLog,before.callLog);assert.deepEqual(after.leads,before.leads);
 assert.deepEqual(buildCallReport(after),beforeCalls);assert.deepEqual(results(after),beforeResults);
 assert.equal(buildCallReport(after,{companyId:company.id}).totals.calls,1);assert.equal(reportRows(after,{companyId:company.id})[0].commitments,1);
 assert.equal(after.invitations.find(item=>item.id===invitation.invitation.id).status,'revoked');assert.equal(after.invitations.find(item=>item.id===invitation.invitation.id).companyName,company.name);
 assert.deepEqual(after.feed.slice(1),before.feed);assert.match(after.feed[0].text,/Bedrijf verwijderd: Historisch bouwbedrijf/);
 await f.restart();const restored=await f.owner.state();assert.deepEqual(restored,after);assert.deepEqual(results(restored),beforeResults);assert.deepEqual(buildCallReport(restored),beforeCalls);
 const reused=await f.createCompany(company.name);assert.notEqual(reused.id,company.id);
});

test('company removal requires the chief, confirmation and current zero membership including inactive accounts',async t=>{
 const f=await fixture(t),empty=await f.createCompany(),manager=await f.addUser('Bedrijfsbeheerder','c-noord','bedrijfsbeheerder'),seller=await f.addUser('Verkoper');
 for(const browser of [manager,seller])assert.equal((await browser.action('company.delete',{companyId:empty.id,confirmed:true})).status,403);
 for(const payload of [{companyId:empty.id},{companyId:empty.id,confirmed:false}])assert.equal((await f.owner.action('company.delete',payload)).status,400);
 for(const options of [{csrf:false},{requestOrigin:'https://foreign.example.test'}])assert.equal((await f.owner.action('company.delete',{companyId:empty.id,confirmed:true},'c-noord',options)).status,403);
 assert.equal((await f.owner.action('company.delete',{companyId:'c-noord',confirmed:true})).status,409);
 const pending=ok(await f.owner.action('invitation.create',{name:'Later toegetreden',email:'late-company@example.test',companyId:empty.id,role:'verkoper'})).result;
 const user=await f.addUser('Inactieve gebruiker',empty.id);f.editState(state=>{state.users.find(item=>item.id===user.user.id).status='inactief';});
 const before=await f.owner.state();const denied=await f.owner.action('company.delete',{companyId:empty.id,confirmed:true});assert.equal(denied.status,409);assert.match(denied.data.error,/nog gebruikers/);assert.deepEqual(await f.owner.state(),before);
 assert.equal((await f.owner.request('/api/invitations/preview',{method:'POST',body:{token:pending.token}})).status,200,'Rejected removal must not revoke pending invitations');
});

test('archived companies cannot be opened, changed, re-invited or exposed to another company',async t=>{
 const f=await fixture(t),company=await f.createCompany('Afgesloten bedrijf'),manager=await f.addUser('Bedrijfsbeheerder','c-noord','bedrijfsbeheerder');
 const invitation=ok(await f.owner.action('invitation.create',{name:'Afgesloten uitnodiging',email:'closed-company@example.test',companyId:company.id,role:'verkoper'})).result;
 ok(await f.owner.action('company.delete',{companyId:company.id,confirmed:true}));
 assert.equal((await f.owner.request('/api/state?companyId='+company.id)).status,404);
 assert.equal((await f.owner.request('/api/company-logos/'+company.id)).status,404);
 assert.equal((await f.owner.action('company.update',{companyId:company.id,name:'Heropend'})).status,404);
 assert.equal((await f.owner.action('workspace.update',{leadId:'any',field:'status',value:'nieuw'},company.id)).status,404);
 assert.equal((await f.owner.action('invitation.create',{name:'Nieuw',email:'new-company@example.test',companyId:company.id,role:'verkoper'})).status,404);
 assert.equal((await f.owner.action('invitation.rotate',{invitationId:invitation.invitation.id})).status,404);
 assert.equal((await f.owner.request('/api/invitations/preview',{method:'POST',body:{token:invitation.token}})).status,410);
 assert.equal((await f.owner.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name:'Nieuw',password}})).status,410);
 const scoped=await manager.state('c-noord');assert.equal(Object.hasOwn(scoped,'archivedCompanies'),false);assert.equal(JSON.stringify(scoped).includes('Afgesloten bedrijf'),false,'The archived company metadata and its private audit must remain chief-only');
});

test('the last empty company can be removed and a chief without a company can create the next one',async t=>{
 const f=await fixture(t);ok(await f.owner.action('user.update',{userId:'u-admin',companyId:null,role:'hoofdbeheerder'}));
 const response=ok(await f.owner.action('company.delete',{companyId:'c-noord',confirmed:true}));assert.equal(response.companyId,null);assert.deepEqual(response.state.companies,[]);assert.equal(response.state.archivedCompanies.length,1);
 assert.deepEqual((await f.owner.state()).companies,[]);assert.equal((await f.owner.request('/api/session')).data.authenticated,true);await f.restart();const empty=await f.owner.state();assert.deepEqual(empty.companies,[]);assert.equal(empty.users.find(user=>user.id==='u-admin').companyId,null);
 ok(await f.owner.action('settings.update',{cooldownHours:24},''));
 const created=ok(await f.owner.action('company.create',{name:'Nieuwe werkplek'},''));assert.equal(created.state.companies.length,1);assert.equal(created.companyId,created.result.company.id);assert.equal(created.state.archivedCompanies[0].id,'c-noord');
});
