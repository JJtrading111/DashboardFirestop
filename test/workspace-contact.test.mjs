import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';

const EMAIL='contact-owner@example.test',PASSWORD='Workspace-contact-password-2026!';
const note=text=>({id:'note-'+randomUUID(),text});
const contactOf=w=>Object.fromEntries(['contactName','contactEmail','contactPhone'].map(key=>[key,w[key]??'']));
const contact={contactName:'Jan de Vries',contactEmail:'jan@example.test',contactPhone:'+31 (0)6 1234 5678'};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-workspace-contact-'));
 const options={dataDir,publicOrigin:'',publicOriginAliases:'',secureCookies:false,adminEmail:EMAIL,adminName:'Contactbeheerder',adminPassword:PASSWORD,bootstrapToken:'',demoCleanupId:'',seedDemoData:false};
 let app,base;
 async function start(){app=createApp(options);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base=`http://127.0.0.1:${app.server.address().port}`;}
 await start();
 t.after(async()=>{await app.close();assert.equal(path.dirname(path.resolve(dataDir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('bouwberichten-workspace-contact-'));await rm(dataDir,{recursive:true,force:true});});
 async function request(route,{method='GET',body,headers={}}={}){
  const outgoing={...headers};if(body!==undefined)outgoing['Content-Type']='application/json';
  const r=await fetch(base+route,{method,headers:outgoing,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  return{status:r.status,data:await r.json(),headers:r.headers};
 }
 function client(){
  const browser={cookie:'',csrfToken:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,origin=base}={})=>{
   const headers={Origin:origin,...browser.cookie&&{Cookie:browser.cookie},...csrf&&browser.csrfToken&&{'X-CSRF-Token':browser.csrfToken}};
   const r=await request(route,{method,body,headers}),cookie=r.headers.get('set-cookie');if(cookie)browser.cookie=cookie.split(';')[0];
   if(r.status===200&&r.data.csrfToken)browser.csrfToken=r.data.csrfToken;if(r.status===200&&r.data.user)browser.user=r.data.user;return r;
  };
  browser.login=()=>browser.request('/api/auth/login',{method:'POST',body:{email:EMAIL,password:PASSWORD}});
  browser.action=(type,payload={},companyId='c-noord',options={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...options});
  browser.save=(leadId,changes={},draftNote,companyId='c-noord',options={})=>browser.action('workspace.save',{leadId,changes,...draftNote===undefined?{}:{note:draftNote}},companyId,options);
  browser.state=async(companyId='c-noord')=>ok(await browser.request('/api/state?companyId='+encodeURIComponent(companyId))).state;
  return browser;
 }
 const owner=client();ok(await owner.login());
 const createLead=async()=>ok(await owner.action('lead.create',{title:'Project met eigen contactpersoon',organization:'Bronorganisatie',city:'Utrecht',source:'bouw',contact:'Contact bij bron',phone:'030-2222222',email:'source@example.test',description:'Bestaande brongegevens blijven behouden.'})).result.lead;
 async function addUser(name,companyId='c-noord',role='verkoper'){
  const invitation=ok(await owner.action('invitation.create',{name,email:randomUUID()+'@example.test',companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password:PASSWORD}}));return browser;
 }
 return{owner,client,createLead,addUser,request,
  async restart(edit){await app.close();if(edit){const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{edit(db);}finally{db.close();}}await start();},
  machine(sourceId,token,body){return request('/api/import/sources/'+encodeURIComponent(sourceId)+'/leads',{method:'POST',body,headers:{Authorization:'Bearer '+token}});}};
}

test('a company contact can have a name only or optional direct details and is saved atomically with the lead draft',async t=>{
 const {owner,createLead}=await fixture(t),lead=await createLead();
 const fresh=(await owner.state()).workspaces['c-noord'][lead.id];assert.deepEqual(contactOf(fresh),{contactName:'',contactEmail:'',contactPhone:''});
 let saved=ok(await owner.save(lead.id,{contactName:'  Jan de Vries  '}));
 assert.deepEqual(contactOf(saved.state.workspaces['c-noord'][lead.id]),{contactName:'Jan de Vries',contactEmail:'',contactPhone:''});
 const draft=note('Contactpersoon en vervolgafspraak besproken.');
 saved=ok(await owner.save(lead.id,{status:'opvolgen',priority:'high',commitment:true,contactEmail:' JAN@EXAMPLE.TEST ',contactPhone:' +31 (0)6 1234 5678 '},draft));
 const w=saved.state.workspaces['c-noord'][lead.id];assert.deepEqual(contactOf(w),contact);assert.equal(w.status,'opvolgen');assert.equal(w.priority,'high');assert.equal(w.commitment,true);assert.equal(w.notes.length,1);assert.equal(w.notes[0].authorId,owner.user.id);
 const source=saved.state.leads.find(value=>value.id===lead.id);assert.equal(source.contact,'Contact bij bron');assert.equal(source.phone,'030-2222222');assert.equal(source.email,'source@example.test');assert.equal(w.lastContactPerson,undefined);
 assert.deepEqual(ok(await owner.save(lead.id,{status:'opvolgen',priority:'high',commitment:true,...contact},draft)).state,saved.state,'Retry does not duplicate notes or rewrite conversion times/feed');
});

test('partial contact edits preserve other details and all three fields can be cleared together',async t=>{
 const {owner,createLead}=await fixture(t),lead=await createLead();ok(await owner.save(lead.id,contact));
 let saved=ok(await owner.save(lead.id,{contactName:'Anja de Vries'}));assert.deepEqual(contactOf(saved.state.workspaces['c-noord'][lead.id]),{...contact,contactName:'Anja de Vries'});
 saved=ok(await owner.save(lead.id,{contactEmail:''}));assert.deepEqual(contactOf(saved.state.workspaces['c-noord'][lead.id]),{...contact,contactName:'Anja de Vries',contactEmail:''});
 saved=ok(await owner.save(lead.id,{contactName:'',contactEmail:'',contactPhone:''}));assert.deepEqual(contactOf(saved.state.workspaces['c-noord'][lead.id]),{contactName:'',contactEmail:'',contactPhone:''});
 const unchanged=await owner.state();ok(await owner.save(lead.id,{contactName:'',contactEmail:'',contactPhone:''}));assert.deepEqual(await owner.state(),unchanged);
});

test('invalid contact details reject the complete save without partial notes, fields or feed entries',async t=>{
 const {owner,createLead}=await fixture(t),lead=await createLead();ok(await owner.save(lead.id,contact));const before=await owner.state(),draft=note('Deze notitie mag niet gedeeltelijk worden opgeslagen.');
 const invalid=[
  {contactName:''},{contactName:' '.repeat(4)},
  {contactName:'x'.repeat(121)},{contactName:'Jan\nBcc: ander@example.test'},
  {contactName:null},{contactEmail:null},{contactPhone:12345},
  {contactEmail:'geen-adres'},{contactEmail:'jan@example.test?subject=ongewenst'},{contactEmail:'jan@example.test\r\nBcc: ander@example.test'},
  {contactEmail:'<jan@example.test>'},{contactEmail:'Jan <jan@example.test>'},{contactEmail:'x'.repeat(255)},
  {contactPhone:'javascript:alert(1)'},{contactPhone:'06-12345678 ext 123'},
  {contactPhone:'06+12345678'},{contactPhone:'---'},{contactPhone:'12345'},{contactPhone:'1'.repeat(16)},
  {contactPhone:'06\n12345678'},{contactPhone:'06'+' '.repeat(61)+'12345678'},
  {contactEmail:{}},{contactName:['Jan']}
 ];
 for(const values of invalid){
  const result=await owner.save(lead.id,{status:'opvolgen',priority:'high',...values},draft);assert.equal(result.status,400,JSON.stringify(values));assert.deepEqual(await owner.state(),before);
 }
 assert.equal((await owner.action('workspace.update',{leadId:lead.id,field:'contactEmail',value:'other@example.test'})).status,400,'Single-field update cannot bypass aggregate contact validation');
 assert.deepEqual(await owner.state(),before);
});

test('company contacts are private to the lead workspace and sellers/managers cannot read or change another company contact',async t=>{
 const {owner,createLead,addUser}=await fixture(t),lead=await createLead(),foreign=ok(await owner.action('company.create',{name:'Tweede contactbedrijf'})).result.company;
 const seller=await addUser('Verkoper eigen bedrijf'),manager=await addUser('Beheerder ander bedrijf',foreign.id,'bedrijfsbeheerder');
 const other={contactName:'Nora Jansen',contactEmail:'nora@other.example.test',contactPhone:'020-7777777'};
 const north=ok(await seller.save(lead.id,contact)),south=ok(await manager.save(lead.id,other,undefined,foreign.id));
 assert.deepEqual(contactOf(north.state.workspaces['c-noord'][lead.id]),contact);assert.deepEqual(contactOf(south.state.workspaces[foreign.id][lead.id]),other);
 assert.equal(JSON.stringify(north.state).includes(other.contactEmail),false);assert.equal(JSON.stringify(south.state).includes(contact.contactEmail),false);
 const before=await owner.state();assert.equal((await seller.save(lead.id,other,undefined,foreign.id)).status,403);assert.equal((await manager.save(lead.id,contact,undefined,'c-noord')).status,403);
 assert.equal((await seller.save(lead.id,{contactName:'Zonder token'},undefined,'c-noord',{csrf:false})).status,403);
 assert.equal((await seller.save(lead.id,{contactName:'Verkeerde website'},undefined,'c-noord',{origin:'https://untrusted.example.test'})).status,403);
 assert.deepEqual(await owner.state(),before);assert.deepEqual(contactOf((await owner.state(foreign.id)).workspaces[foreign.id][lead.id]),other);
});

test('a source refresh and server restart preserve private contact details and existing lead follow-up',async t=>{
 const env=await fixture(t),{owner}=env,source=ok(await owner.action('source.create',{name:'Contact importbron'})).result.source;
 const key=ok(await owner.action('source.import.rotate',{id:source.id})).result.importToken;
 ok(await env.machine(source.id,key,{runId:'contact-initial',items:[{externalId:'contact-123',title:'Geïmporteerd contactproject',contact:'Broncontact',email:'bron@example.test',phone:'030-3333333'}]}));
 const lead=(await owner.state()).leads.find(value=>value.source===source.id),draft=note('Eigen contact en opvolging blijven behouden.');
 ok(await owner.save(lead.id,{status:'offerte',...contact},draft));const before=(await owner.state()).workspaces['c-noord'][lead.id];
 ok(await env.machine(source.id,key,{runId:'contact-refresh',items:[{externalId:'contact-123',title:'Bijgewerkte projecttitel',contact:'Nieuwe broncontactpersoon',email:'new-source@example.test',phone:'030-4444444'}]}));
 let state=await owner.state();assert.deepEqual(state.workspaces['c-noord'][lead.id],before);assert.equal(state.leads.find(value=>value.id===lead.id).contact,'Nieuwe broncontactpersoon');
 await env.restart();state=await owner.state();assert.deepEqual(state.workspaces['c-noord'][lead.id],before);assert.deepEqual(contactOf(state.workspaces['c-noord'][lead.id]),contact);
});

test('legacy workspaces with no contact fields stay unchanged until a contact is actually saved',async t=>{
 const env=await fixture(t),lead=await env.createLead();
 await env.restart(db=>{const row=db.prepare('SELECT json FROM app_state WHERE id=1').get(),state=JSON.parse(row.json),w=state.workspaces['c-noord'][lead.id];for(const key of ['contactName','contactEmail','contactPhone'])delete w[key];db.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(state));});
 const before=await env.owner.state(),w=before.workspaces['c-noord'][lead.id];assert.deepEqual(contactOf(w),{contactName:'',contactEmail:'',contactPhone:''});assert.equal(Object.hasOwn(w,'contactName'),false);
 ok(await env.owner.save(lead.id,{}));assert.deepEqual(await env.owner.state(),before);
 ok(await env.owner.save(lead.id,{contactName:'Nieuwe contactpersoon'}));const saved=(await env.owner.state()).workspaces['c-noord'][lead.id];assert.deepEqual(contactOf(saved),{contactName:'Nieuwe contactpersoon',contactEmail:'',contactPhone:''});
});
