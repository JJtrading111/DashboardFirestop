import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';

const origin='https://status-history.example.test',password='Status-history-test-password-2026!';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};
const note=text=>({id:'note-'+randomUUID(),text});
const statuses=(state,companyId,leadId)=>state.feed.filter(item=>item.type==='status'&&item.companyId===companyId&&item.leadId===leadId);

async function fixture(t){
 const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
  adminEmail:'status-owner@example.test',adminName:'Statusbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false});
 t.after(()=>app.close());
 function client(){
  const browser={cookie:'',csrf:'',user:null};
  browser.request=async(path,{method='GET',body,csrf=true,requestOrigin=origin}={})=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin:requestOrigin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrf&&{'x-csrf-token':browser.csrf}}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);const data=JSON.parse(res.bytes.toString()),cookie=res.headers['set-cookie'];
   if(cookie)browser.cookie=cookie.split(';')[0];if(res.status===200&&data.csrfToken)browser.csrf=data.csrfToken;if(res.status===200&&data.user)browser.user=data.user;
   return{status:res.status,data};
  };
  browser.action=(type,payload={},companyId='c-noord',options={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...options});
  browser.state=async(companyId='c-noord')=>ok(await browser.request('/api/state?companyId='+encodeURIComponent(companyId))).state;
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:'status-owner@example.test',password}}));
 const lead=ok(await owner.action('lead.create',{title:'Project met statusgeschiedenis',organization:'Centrale aannemer',city:'Utrecht',source:'bouw',contact:'Broncontact',phone:'030-2222222',email:'bron@example.test',description:'Een gedeelde lead met afzonderlijke bedrijfsopvolging.'})).result.lead;
 const south=ok(await owner.action('company.create',{name:'Statusbedrijf Zuid'})).result.company;
 async function addUser(name,companyId='c-noord',role='verkoper'){
  const invitation=ok(await owner.action('invitation.create',{name,email:randomUUID()+'@example.test',companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}}));return browser;
 }
 return{owner,lead,south,addUser};
}

test('direct status moves record real old/new names, maker and company while a repeated status is a no-op',async t=>{
 const {owner,lead,addUser}=await fixture(t),seller=await addUser('Jan Noord');
 const saved=ok(await seller.action('workspace.update',{leadId:lead.id,field:'status',value:'contact'})).state;
 const event=statuses(saved,'c-noord',lead.id)[0];
 assert.deepEqual(event.statusChange,{fromId:'nieuw',fromName:'Nieuw',toId:'contact',toName:'In contact'});
 assert.equal(event.authorId,seller.user.id);assert.equal(event.authorName,'Jan Noord');assert.ok(Number.isFinite(Date.parse(event.at)));
 assert.equal(event.companyId,'c-noord');assert.equal(event.leadId,lead.id);assert.match(event.text,/Nieuw → In contact/);
 assert.equal(saved.workspaces['c-noord'][lead.id].status,'contact');
 assert.deepEqual(ok(await seller.action('workspace.update',{leadId:lead.id,field:'status',value:'contact'})).state,saved);
 ok(await owner.action('workspace.update',{leadId:lead.id,field:'priority',value:'high'}));
 const generic=(await owner.state()).feed[0];assert.equal(generic.type,'update');assert.equal(Object.hasOwn(generic,'statusChange'),false,'Generic updates must not acquire invented status transitions');
});

test('an atomic note and status save keeps both events and idempotent retries do not duplicate either',async t=>{
 const {owner,lead,addUser}=await fixture(t),seller=await addUser('Petra Noord'),draft=note('Offerte met aannemer besproken.');
 const payload={leadId:lead.id,changes:{status:'offerte',priority:'high',commitment:true},note:draft};
 const before=await owner.state(),saved=ok(await seller.action('workspace.save',payload)).state,w=saved.workspaces['c-noord'][lead.id];
 assert.equal(saved.feed.length,before.feed.length+2);assert.equal(w.status,'offerte');assert.equal(w.notes.length,1);assert.equal(w.notes[0].text,draft.text);
 const event=statuses(saved,'c-noord',lead.id)[0],noteEvent=saved.feed.find(item=>item.leadId===lead.id&&item.text.startsWith('Gespreksnotitie toegevoegd:'));
 assert.deepEqual(event.statusChange,{fromId:'nieuw',fromName:'Nieuw',toId:'offerte',toName:'Offerte'});assert.equal(event.authorId,seller.user.id);assert.equal(event.authorName,'Petra Noord');
 assert.equal(event.at,noteEvent.at);assert.equal(event.at,w.notes[0].createdAt);assert.equal(event.at,w.commitmentAt);
 assert.deepEqual(ok(await seller.action('workspace.save',payload)).state,saved);
 const changedAgain=ok(await seller.action('workspace.save',{leadId:lead.id,changes:{status:'afgerond'}})).state;
 assert.equal(changedAgain.feed.length,saved.feed.length+1);assert.deepEqual(statuses(changedAgain,'c-noord',lead.id)[0].statusChange,{fromId:'offerte',fromName:'Offerte',toId:'afgerond',toName:'Afgerond'});
});

test('invalid status or note input rolls back the complete status history, note, flags and fields',async t=>{
 const {owner,lead}=await fixture(t),draft=note('Deze notitie blijft eenmalig.');
 ok(await owner.action('workspace.save',{leadId:lead.id,changes:{status:'contact'},note:draft}));
 const before=await owner.state();
 for(const payload of [
  {leadId:lead.id,changes:{status:'onbekend',priority:'high'},note:note('Niet opslaan')},
  {leadId:lead.id,changes:{status:'offerte',calculation:true},note:{...draft,text:'Conflicterende inhoud'}},
  {leadId:lead.id,changes:{status:'offerte',calculation:'true'},note:note('Niet opslaan')},
  {leadId:lead.id,changes:{status:'offerte'},note:{id:'verkeerd',text:'Niet opslaan'}}
 ]){
  const response=await owner.action('workspace.save',payload);assert.ok([400,409].includes(response.status));assert.deepEqual(await owner.state(),before);
 }
 assert.equal((await owner.action('workspace.update',{leadId:lead.id,field:'status',value:'onbekend'})).status,400);assert.deepEqual(await owner.state(),before);
});

test('status snapshots survive column rename and user transfer while other companies remain private',async t=>{
 const {owner,lead,south,addUser}=await fixture(t),seller=await addUser('Verkoper Noord'),manager=await addUser('Beheerder Zuid',south.id,'bedrijfsbeheerder');
 ok(await seller.action('workspace.update',{leadId:lead.id,field:'status',value:'opvolgen'}));
 ok(await manager.action('workspace.save',{leadId:lead.id,changes:{status:'offerte'}},south.id));
 const before=await owner.state(),northEvent=statuses(before,'c-noord',lead.id)[0],southEvent=statuses(before,south.id,lead.id)[0];
 const columns=before.companies.find(company=>company.id==='c-noord').columns.map(column=>({...column,name:column.id==='opvolgen'?'Later terugbellen':column.name}));
 ok(await owner.action('columns.update',{columns}));ok(await owner.action('user.update',{userId:seller.user.id,companyId:south.id,role:'verkoper'}));
 const after=await owner.state();assert.deepEqual(statuses(after,'c-noord',lead.id)[0],northEvent);assert.deepEqual(statuses(after,south.id,lead.id)[0],southEvent);
 assert.equal(northEvent.statusChange.toName,'Opvolgen');assert.equal(northEvent.authorName,'Verkoper Noord');
 const own=await manager.state(south.id);assert.equal(own.feed.some(event=>event.type==='status'&&event.companyId==='c-noord'),false);
 assert.equal(own.feed.some(event=>event.type==='status'&&event.authorName==='Verkoper Noord'),false);
 assert.equal((await seller.action('workspace.update',{leadId:lead.id,field:'status',value:'afgerond'})).status,401,'Moving a user revokes the old session');
 assert.equal((await manager.action('workspace.save',{leadId:lead.id,changes:{status:'afgerond'}},'c-noord')).status,403);
 for(const options of [{csrf:false},{requestOrigin:'https://foreign.example.test'}])assert.equal((await manager.action('workspace.update',{leadId:lead.id,field:'status',value:'afgerond'},south.id,options)).status,403);
 assert.deepEqual(await owner.state(),after);
});
