import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';

const EMAIL='workspace-owner@example.test';
const PASSWORD='Workspace-save-test-password-2026!';
const note=text=>({id:'note-'+randomUUID(),text});
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};

async function fixture(t){
 const app=createApp({dataDir:':memory:',publicOrigin:'',publicOriginAliases:'',secureCookies:false,
  adminEmail:EMAIL,adminName:'Werkplekbeheerder',adminPassword:PASSWORD,bootstrapToken:'',demoCleanupId:'',seedDemoData:false});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}`;
 function client(){
  const browser={cookie:'',csrfToken:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,origin=base}={})=>{
   const headers={Origin:origin};if(browser.cookie)headers.Cookie=browser.cookie;
   if(body!==undefined)headers['Content-Type']='application/json';
   if(csrf&&browser.csrfToken)headers['X-CSRF-Token']=browser.csrfToken;
   const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
   const data=await response.json();const cookie=response.headers.get('set-cookie');if(cookie)browser.cookie=cookie.split(';')[0];
   if(response.ok&&data.csrfToken)browser.csrfToken=data.csrfToken;if(response.ok&&data.user)browser.user=data.user;
   return{status:response.status,data};
  };
  browser.action=(type,payload={},companyId='c-noord',options={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...options});
  browser.state=async(companyId='c-noord')=>ok(await browser.request('/api/state?companyId='+encodeURIComponent(companyId))).state;
  browser.save=(leadId,changes={},draftNote,companyId='c-noord',options={})=>browser.action('workspace.save',{leadId,changes,...draftNote===undefined?{}:{note:draftNote}},companyId,options);
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:EMAIL,password:PASSWORD}}));
 const createLead=async(companyId='c-noord')=>ok(await owner.action('lead.create',{
  title:'Project voor opslaan en sluiten',organization:'Voorbeeldaannemer',city:'Utrecht',source:'bouw',
  contact:'Voorbeeldcontact',phone:'030-2222222',email:'contact@example.test',description:'Project voor opslagcontrole'
 },companyId)).result.lead;
 async function addUser(name,companyId='c-noord',role='verkoper'){
  const invitation=ok(await owner.action('invitation.create',{name,email:randomUUID()+'@example.test',companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password:PASSWORD}}));return browser;
 }
 const createCompany=async()=>ok(await owner.action('company.create',{name:'Ander bedrijf '+randomUUID()})).result.company;
 return{owner,client,createLead,addUser,createCompany};
}

test('workspace.save stores all follow-up fields and the draft note together with its real author',async t=>{
 const {owner,createLead,addUser}=await fixture(t),lead=await createLead(),seller=await addUser('Verkoper Noord');
 const draft=note('  Planning en offerte besproken.  '),before=await owner.state();
 const result=ok(await owner.save(lead.id,{status:'opvolgen',priority:'high',ownerId:seller.user.id,commitment:true,calculation:true},draft));
 const w=result.state.workspaces['c-noord'][lead.id];
 assert.equal(w.status,'opvolgen');assert.equal(w.priority,'high');assert.equal(w.ownerId,seller.user.id);
 assert.equal(w.commitment,true);assert.equal(w.calculation,true);assert.ok(Number.isFinite(Date.parse(w.commitmentAt)));assert.equal(w.calculationAt,w.commitmentAt);
 assert.deepEqual(w.notes,[{id:draft.id,text:draft.text.trim(),authorId:owner.user.id,authorName:'Werkplekbeheerder',createdAt:w.commitmentAt}]);
 assert.deepEqual(result.result,{saved:true,noteAdded:true});assert.equal(result.state.feed.length,before.feed.length+1);
});

test('invalid fields or draft notes reject the whole HTTP save without partial fields, notes or feed entries',async t=>{
 const {owner,createLead,createCompany,addUser}=await fixture(t),lead=await createLead(),foreign=await createCompany(),outsider=await addUser('Andere verkoper',foreign.id);
 const draft=note('Deze notitie mag bij een fout niet gedeeltelijk worden opgeslagen.'),before=await owner.state();
 const invalid=[
  {changes:{status:'onbekend',priority:'high'},note:draft},
  {changes:{status:'opvolgen',priority:'urgent'},note:draft},
  {changes:{status:'opvolgen',ownerId:outsider.user.id},note:draft},
  {changes:{status:'opvolgen',ownerId:false},note:draft},
  {changes:{status:'opvolgen',commitment:'true'},note:draft},
  {changes:{status:'opvolgen',calculation:null},note:draft},
  {changes:{status:'opvolgen',notes:[]},note:draft},
  {changes:{status:'opvolgen'},note:{...draft,id:'not-a-note-uuid'}},
  {changes:{status:'opvolgen'},note:{...draft,text:'   '}},
  {changes:{status:'opvolgen'},note:{...draft,text:'x'.repeat(4001)}},
  {changes:{status:'opvolgen'},note:{...draft,authorId:outsider.user.id}},
  {changes:{status:'opvolgen'},note:null},
  {changes:[],note:draft},{changes:null,note:draft},{note:draft},
  {changes:JSON.parse('{"status":"opvolgen","__proto__":{"polluted":true}}'),note:draft}
 ];
 for(const payload of invalid){
  const response=await owner.action('workspace.save',{leadId:lead.id,...payload});
  assert.equal(response.status,400,JSON.stringify(payload));assert.deepEqual(await owner.state(),before);
 }
 assert.equal((await owner.save('lead-'+randomUUID(),{},draft)).status,404);assert.deepEqual(await owner.state(),before);
});

test('retrying a stable note UUID is idempotent and conflicting content or authors cannot overwrite it',async t=>{
 const {owner,createLead,addUser}=await fixture(t),lead=await createLead(),seller=await addUser('Collega');
 const draft=note('Eenmalig opgeslagen gespreksnotitie.');
 ok(await owner.save(lead.id,{ownerId:null,commitment:true},draft));
 const first=await owner.state(),original=first.workspaces['c-noord'][lead.id];
 await new Promise(resolve=>setTimeout(resolve,10));
 const repeated=ok(await owner.save(lead.id,{ownerId:null,commitment:true},draft));
 assert.deepEqual(repeated.result,{saved:true,noteAdded:false});assert.deepEqual(repeated.state,first);
 // A retry must not apply note.add's owner assignment a second time.
 ok(await owner.save(lead.id,{},draft));assert.deepEqual(await owner.state(),first);
 assert.equal(original.ownerId,null);assert.equal(original.notes.length,1);
 for(const [browser,conflicting]of [[owner,{...draft,text:'Andere inhoud'}],[seller,draft]]){
  assert.equal((await browser.save(lead.id,{status:'opvolgen'},conflicting)).status,409);
  assert.deepEqual(await owner.state(),first);
 }
});

test('seller and company manager saves remain isolated and require their session CSRF and same origin',async t=>{
 const {owner,createLead,createCompany,addUser}=await fixture(t),foreign=await createCompany(),lead=await createLead();
 const seller=await addUser('Verkoper eigen bedrijf'),manager=await addUser('Bedrijfsbeheerder ander bedrijf',foreign.id,'bedrijfsbeheerder');
 const ownNote=note('Alleen zichtbaar in het eerste bedrijf.'),foreignNote=note('Alleen zichtbaar in het tweede bedrijf.');
 const own=ok(await seller.save(lead.id,{status:'contact',ownerId:seller.user.id},ownNote));
 const other=ok(await manager.save(lead.id,{status:'offerte',ownerId:manager.user.id},foreignNote,foreign.id));
 assert.equal(own.state.workspaces['c-noord'][lead.id].notes[0].authorId,seller.user.id);
 assert.equal(other.state.workspaces[foreign.id][lead.id].notes[0].authorId,manager.user.id);
 assert.equal(JSON.stringify(own.state).includes(foreignNote.text),false);assert.equal(JSON.stringify(other.state).includes(ownNote.text),false);
 const first=await owner.state(),second=await owner.state(foreign.id);
 for(const [browser,companyId]of [[seller,foreign.id],[manager,'c-noord']])assert.equal((await browser.save(lead.id,{priority:'high'},note('Verboden'),companyId)).status,403);
 assert.equal((await seller.save(lead.id,{priority:'high'},undefined,'c-noord',{csrf:false})).status,403);
 assert.equal((await seller.save(lead.id,{priority:'high'},undefined,'c-noord',{origin:'https://untrusted.example.test'})).status,403);
 assert.deepEqual(await owner.state(),first);assert.deepEqual(await owner.state(foreign.id),second);
 const north=first.workspaces['c-noord'][lead.id],south=second.workspaces[foreign.id][lead.id];
 assert.equal(north.status,'contact');assert.equal(south.status,'offerte');assert.equal(north.notes.length,1);assert.equal(south.notes.length,1);
});

test('unchanged historic owners are preserved, changed owners are validated, and explicit unassignment beats note auto-assignment',async t=>{
 const {owner,createLead,createCompany,addUser}=await fixture(t),lead=await createLead(),seller=await addUser('Voormalige verkoper'),foreign=await createCompany();
 ok(await owner.save(lead.id,{ownerId:seller.user.id}));
 ok(await owner.action('user.update',{userId:seller.user.id,companyId:foreign.id,role:'verkoper'}));
 const historic=ok(await owner.save(lead.id,{ownerId:seller.user.id,priority:'high'},note('Historische toewijzing behouden.'))).state.workspaces['c-noord'][lead.id];
 assert.equal(historic.ownerId,seller.user.id);
 ok(await owner.save(lead.id,{ownerId:null},note('Expliciet niet toegewezen.')));
 assert.equal((await owner.state()).workspaces['c-noord'][lead.id].ownerId,null);
 assert.equal((await owner.save(lead.id,{ownerId:seller.user.id})).status,400);
 const automatic=note('Zonder een expliciete verkoperskeuze.');ok(await owner.save(lead.id,{},automatic));
 assert.equal((await owner.state()).workspaces['c-noord'][lead.id].ownerId,owner.user.id);
 ok(await owner.save(lead.id,{ownerId:null}));ok(await owner.save(lead.id,{},automatic));
 assert.equal((await owner.state()).workspaces['c-noord'][lead.id].ownerId,null,'A duplicate note must not reassign an unassigned lead');
 // A chief working in another company must not assign that company to themselves.
 ok(await owner.save(lead.id,{},note('Hoofdbeheerder buiten het eigen bedrijf.'),foreign.id));
 assert.equal((await owner.state(foreign.id)).workspaces[foreign.id][lead.id].ownerId,null);
});

test('unchanged conversion checks keep their original dates and no-op saves produce no new feed entries',async t=>{
 const {owner,createLead}=await fixture(t),lead=await createLead();
 ok(await owner.save(lead.id,{commitment:true,calculation:true}));
 const initial=(await owner.state()).workspaces['c-noord'][lead.id];
 await new Promise(resolve=>setTimeout(resolve,10));
 const updated=ok(await owner.save(lead.id,{priority:'high',commitment:true,calculation:true})).state;
 const w=updated.workspaces['c-noord'][lead.id];assert.equal(w.commitmentAt,initial.commitmentAt);assert.equal(w.calculationAt,initial.calculationAt);
 ok(await owner.save(lead.id,{priority:'high',commitment:true,calculation:true}));assert.deepEqual(await owner.state(),updated);
 const toggled=ok(await owner.save(lead.id,{commitment:false,calculation:true})).state.workspaces['c-noord'][lead.id];
 assert.equal(toggled.commitmentAt,null);assert.equal(toggled.calculationAt,initial.calculationAt);
});
