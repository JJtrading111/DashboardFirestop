import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {effectiveLeadContact,hasLeadContact,contactFingerprint,partyContact} from '../public/selected-contact.mjs';

const origin='https://selected-contact.example.test',password='Selected-contact-test-password!';
const parties=[
 {name:'Stichting Wooncompas',role:'Woningbouwcorporatie',phone:'0180-494949',email:'contact@wooncompas.example.test',website:'https://wooncompas.example.test/'},
 {name:'Voorbeeld Architect',role:'Architect',phone:'010-2012360',email:'architect@example.test',website:'https://architect.example.test/'}
];
const ok=r=>{assert.equal(r.status,200,r.bytes?.toString());return r.json();};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-selected-contact-'));
 const options={dataDir,publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:'selected-owner@example.test',adminName:'Contactbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false,scraperEncryptionKey:'',scraperWorkerToken:''};
 let app=createApp(options);
 t.after(async()=>{await app.close();assert.equal(path.dirname(path.resolve(dataDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('bouwberichten-selected-contact-'));await rm(dataDir,{recursive:true,force:true});});
 async function dispatch(route,{method='GET',headers={},body}={}){
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:route,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin,'content-type':'application/json',...headers}});
  const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
  await app.handler(req,res);return{status:res.status,headers:res.headers,bytes:res.bytes,json:()=>JSON.parse(res.bytes.toString())};
 }
 function client(){
  const browser={cookie:'',csrfToken:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,requestOrigin=origin}={})=>{
   const r=await dispatch(route,{method,body,headers:{origin:requestOrigin,...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrfToken&&{'x-csrf-token':browser.csrfToken}}});
   const cookie=r.headers['set-cookie'];if(cookie)browser.cookie=cookie.split(';')[0];
   if(r.status===200){const data=r.json();if(data.csrfToken)browser.csrfToken=data.csrfToken;if(data.user)browser.user=data.user;}return r;
  };
  browser.action=(type,payload,cid='c-noord',options={})=>browser.request('/api/action',{method:'POST',body:{type,companyId:cid,payload},...options});
  browser.state=async(cid='c-noord')=>ok(await browser.request('/api/state?companyId='+encodeURIComponent(cid))).state;
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:'selected-owner@example.test',password}}));
 const token=ok(await owner.action('source.import.rotate',{id:'bouw'})).result.importToken;
 async function importItems(items,runId='selected-'+Math.random()){
  return ok(await dispatch('/api/import/sources/bouw/leads',{method:'POST',headers:{authorization:'Bearer '+token},body:{runId,items}}));
 }
 const emptyItem={externalId:'selected-empty',title:'Lead zonder hoofdcontact',organization:'',contact:'',phone:'',email:'',projectDetails:{primaryRole:'',primaryWebsite:'',parties}};
 const existingItem={...emptyItem,externalId:'selected-existing',title:'Lead met hoofdcontact',organization:'Oorspronkelijke aannemer',contact:'Bronpersoon',phone:'030-2222222',email:'bron@example.test',projectDetails:{...emptyItem.projectDetails,primaryRole:'Hoofdaannemer',primaryWebsite:'https://bron.example.test/'}};
 const placeholderItem={...emptyItem,externalId:'selected-placeholder',title:'Lead met alleen placeholders',organization:'Organisatie nog niet bekend',contact:'Contactpersoon nog niet bekend'};
 await importItems([emptyItem,existingItem,placeholderItem]);
 const initial=await owner.state(),find=id=>initial.leads.find(lead=>lead.importExternalId===id);
 const leads={empty:find('selected-empty'),existing:find('selected-existing'),placeholder:find('selected-placeholder')};
 async function payload(browser,leadId,cid='c-noord',index=0,confirmed=false){
  const s=await browser.state(cid),lead=s.leads.find(item=>item.id===leadId),workspace=s.workspaces[cid]?.[leadId];
  return{leadId,partyIndex:index,partyFingerprint:contactFingerprint(partyContact(lead,index)),expectedContact:contactFingerprint(effectiveLeadContact(lead,workspace)),confirmed};
 }
 async function addUser(name,cid='c-noord',role='verkoper'){
  const invitation=ok(await owner.action('invitation.create',{name,email:name.toLowerCase().replace(/\s+/g,'-')+'@example.test',companyId:cid,role})).result;
  const user=client();ok(await user.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}}));return user;
 }
 return{owner,client,dispatch,leads,emptyItem,existingItem,importItems,payload,addUser,
  async addCompany(){return ok(await owner.action('company.create',{name:'Tweede contactbedrijf'})).result.company;},
  async restart(){await app.close();app=createApp(options);}};
}

test('an empty green contact can select a current party without confirmation and keeps other lead follow-up intact',async t=>{
 const env=await fixture(t),lead=env.leads.empty,seller=await env.addUser('Jan Verkoper');
 ok(await seller.action('workspace.save',{leadId:lead.id,changes:{contactName:'Eigen contact',contactEmail:'eigen@example.test',contactPhone:'06-12345678',priority:'high',commitment:true}}));
 ok(await seller.action('note.add',{leadId:lead.id,text:'Bestaande gespreksnotitie'}));
 const before=await seller.state(),oldWorkspace=before.workspaces['c-noord'][lead.id];
 assert.equal(hasLeadContact(effectiveLeadContact(lead,oldWorkspace)),false);
 const result=ok(await seller.action('workspace.contact.select',await env.payload(seller,lead.id))).result;
 assert.equal(result.changed,true);assert.equal(result.selectedContact.name,parties[0].name);assert.equal(result.selectedContact.selectedById,seller.user.id);assert.equal(result.selectedContact.selectedByName,'Jan Verkoper');assert.ok(Number.isFinite(Date.parse(result.selectedContact.selectedAt)));
 const after=await seller.state(),workspace=after.workspaces['c-noord'][lead.id];
 assert.deepEqual(effectiveLeadContact(lead,workspace),partyContact(lead,0));
 for(const key of Object.keys(oldWorkspace))assert.deepEqual(workspace[key],oldWorkspace[key],key);
 assert.deepEqual(after.leads,before.leads,'The shared central lead and parties remain unchanged');
 assert.equal(after.feed.length,before.feed.length+1);assert.equal(after.feed[0].companyId,'c-noord');assert.equal(after.feed[0].authorName,'Jan Verkoper');
 const repeat=ok(await seller.action('workspace.contact.select',await env.payload(seller,lead.id))).result;
 assert.equal(repeat.changed,false);assert.deepEqual(await seller.state(),after,'Choosing the same selected contact does not rewrite history');
});

test('replacing a real existing green contact requires explicit confirmation but placeholder text does not',async t=>{
 const env=await fixture(t),lead=env.leads.existing,before=await env.owner.state(),unconfirmed=await env.payload(env.owner,lead.id);
 assert.equal(hasLeadContact(effectiveLeadContact(lead)),true);
 const denied=await env.owner.action('workspace.contact.select',unconfirmed);assert.equal(denied.status,409);assert.match(denied.json().error,/Bevestig/);assert.deepEqual(await env.owner.state(),before);
 const selected=ok(await env.owner.action('workspace.contact.select',{...unconfirmed,confirmed:true}));assert.equal(selected.result.selectedContact.name,parties[0].name);
 const current=await env.owner.state(),other=await env.payload(env.owner,lead.id,'c-noord',1);
 assert.equal((await env.owner.action('workspace.contact.select',other)).status,409);assert.deepEqual(await env.owner.state(),current);
 ok(await env.owner.action('workspace.contact.select',{...other,confirmed:true}));assert.equal((await env.owner.state()).workspaces['c-noord'][lead.id].selectedContact.name,parties[1].name);
 const placeholder=env.leads.placeholder;assert.equal(hasLeadContact(effectiveLeadContact(placeholder)),false);
 ok(await env.owner.action('workspace.contact.select',await env.payload(env.owner,placeholder.id)));
});

test('every company chooses independently and foreign users or missing CSRF cannot change a selection',async t=>{
 const env=await fixture(t),company=await env.addCompany(),lead=env.leads.empty,seller=await env.addUser('Jan Noord'),manager=await env.addUser('Bas Zuid',company.id,'bedrijfsbeheerder');
 ok(await seller.action('workspace.contact.select',await env.payload(seller,lead.id)));
 let south=await manager.state(company.id);assert.equal(south.workspaces[company.id]?.[lead.id]?.selectedContact,undefined);
 assert.equal(JSON.stringify(south).includes('Jan Noord'),false);
 ok(await manager.action('workspace.contact.select',await env.payload(manager,lead.id,company.id,1),company.id));
 assert.equal((await seller.state()).workspaces['c-noord'][lead.id].selectedContact.name,parties[0].name);
 assert.equal((await manager.state(company.id)).workspaces[company.id][lead.id].selectedContact.name,parties[1].name);
 const north=await env.owner.state(),foreign=await env.payload(env.owner,lead.id,company.id,0,true);
 assert.equal((await seller.action('workspace.contact.select',foreign,company.id)).status,403);
 assert.equal((await manager.action('workspace.contact.select',await env.payload(env.owner,lead.id,'c-noord',1,true),'c-noord')).status,403);
 assert.equal((await seller.action('workspace.contact.select',await env.payload(seller,lead.id,'c-noord',1,true),'c-noord',{csrf:false})).status,403);
 assert.equal((await seller.action('workspace.contact.select',await env.payload(seller,lead.id,'c-noord',1,true),'c-noord',{requestOrigin:'https://onbetrouwbaar.example.test'})).status,403);
 assert.deepEqual(await env.owner.state(),north);
});

test('a stale party or green contact fingerprint cannot overwrite newer source or colleague changes',async t=>{
 const env=await fixture(t),lead=env.leads.empty,old=await env.payload(env.owner,lead.id);
 await env.importItems([{...env.emptyItem,projectDetails:{...env.emptyItem.projectDetails,parties:[{...parties[0],phone:'0180-111111'},parties[1]]}}]);
 let before=await env.owner.state();assert.equal((await env.owner.action('workspace.contact.select',old)).status,409);assert.deepEqual(await env.owner.state(),before);
 const current=await env.payload(env.owner,lead.id);ok(await env.owner.action('workspace.contact.select',current));
 const staleOther={...current,partyIndex:1,partyFingerprint:contactFingerprint(partyContact(lead,1)),confirmed:true};before=await env.owner.state();
 assert.equal((await env.owner.action('workspace.contact.select',staleOther)).status,409);assert.deepEqual(await env.owner.state(),before);
 const first=await env.payload(env.owner,lead.id,'c-noord',0,true);ok(await env.owner.action('workspace.contact.select',await env.payload(env.owner,lead.id,'c-noord',1,true)));before=await env.owner.state();
 assert.equal((await env.owner.action('workspace.contact.select',first)).status,409);assert.deepEqual(await env.owner.state(),before);
});

test('selected contacts survive source changes and restart while arbitrary contact data cannot be injected',async t=>{
 const env=await fixture(t),lead=env.leads.empty;
 ok(await env.owner.action('workspace.contact.select',await env.payload(env.owner,lead.id)));
 const initial=await env.owner.state(),selected=initial.workspaces['c-noord'][lead.id].selectedContact;
 await env.importItems([{...env.emptyItem,organization:'Nieuwe bronorganisatie',phone:'030-1111111',projectDetails:{...env.emptyItem.projectDetails,parties:[parties[1]]}}]);
 let after=await env.owner.state();assert.deepEqual(after.workspaces['c-noord'][lead.id].selectedContact,selected);assert.equal(effectiveLeadContact(after.leads.find(item=>item.id===lead.id),after.workspaces['c-noord'][lead.id]).phone,parties[0].phone);
 await env.restart();after=await env.owner.state();assert.deepEqual(after.workspaces['c-noord'][lead.id].selectedContact,selected);
 const valid=await env.payload(env.owner,lead.id,'c-noord',0,true),before=await env.owner.state();
 for(const payload of [{...valid,partyIndex:-1},{...valid,partyIndex:1.5},{...valid,partyIndex:999},{...valid,confirmed:'true'},{...valid,expectedContact:null},{...valid,partyFingerprint:[]},{...valid,name:'Injected'},{...valid,selectedContact:{name:'Injected'}},{...valid,expectedContact:'x'.repeat(4097)}]){
  const response=await env.owner.action('workspace.contact.select',payload);assert.equal(response.status,400);assert.deepEqual(await env.owner.state(),before);
 }
 assert.equal((await env.owner.action('workspace.save',{leadId:lead.id,changes:{selectedContact:{name:'Injected'}}})).status,400);
});

test('selection helpers are deterministic, ignore metadata, and reject unsafe source data',()=>{
 const lead={organization:'Hoofdcontact',contact:'Persoon',phone:'030-2222222',email:'bron@example.test',projectDetails:{primaryRole:'Hoofdaannemer',primaryWebsite:'https://bron.example.test/',parties}};
 const chosen=partyContact(lead,0),frozen=structuredClone(lead);Object.freeze(lead);Object.freeze(lead.projectDetails);
 assert.equal(contactFingerprint(chosen),contactFingerprint({...chosen,selectedAt:'ignored',selectedByName:'ignored'}));
 assert.deepEqual(effectiveLeadContact(lead,{selectedContact:{...chosen,selectedAt:'ignored'},lastContactPerson:'Oude gesprekspersoon'}),chosen);
 assert.equal(effectiveLeadContact(lead,{lastContactPerson:'Gesproken persoon'}).contact,'Gesproken persoon');
 assert.equal(hasLeadContact({role:'Hoofdaannemer',name:'Organisatie nog niet bekend',contact:'Contactpersoon nog niet bekend'}),false);
 assert.equal(hasLeadContact({email:'info@example.test'}),true);assert.deepEqual(lead,frozen);
 for(const entry of [{...parties[0],name:''},{...parties[0],website:'javascript:alert(1)'},{...parties[0],website:'https://user:secret@example.test/'},{...parties[0],phone:'tel:03012345'},{...parties[0],name:'x'.repeat(121)},{...parties[0],name:'Naam\nAnders'}])assert.equal(partyContact({projectDetails:{parties:[entry]}},0),null);
 assert.equal(partyContact(lead,1.5),null);assert.equal(partyContact(lead,99),null);
});
