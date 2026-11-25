import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';

const origin='https://admin-overview-access.example.test',password='Admin-overview-access-test-2026!';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};

async function fixture(t){
 const app=createApp({dataDir:':memory:',publicOrigin:origin,publicOriginAliases:'',secureCookies:false,
  adminEmail:'overview-owner@example.test',adminName:'Overzichtbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false});
 t.after(()=>app.close());
 function client(){
  const browser={cookie:'',csrf:'',user:null};
  browser.request=async(path,{method='GET',body}={})=>{
   const req=Object.assign(Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]),{url:path,method,socket:{remoteAddress:'127.0.0.1'},
    headers:{host:new URL(origin).host,origin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...browser.csrf&&{'x-csrf-token':browser.csrf}}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},
    writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const [name,value]of Object.entries(headers))this.setHeader(name,value);},
    end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);const data=JSON.parse(res.bytes.toString()),cookie=res.headers['set-cookie'];
   if(cookie)browser.cookie=cookie.split(';')[0];if(res.status===200&&data.csrfToken)browser.csrf=data.csrfToken;if(res.status===200&&data.user)browser.user=data.user;
   return{status:res.status,data};
  };
  browser.action=(type,payload={},companyId='c-noord')=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload}});
  browser.state=(companyId='c-noord')=>browser.request('/api/state?companyId='+encodeURIComponent(companyId));
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:'overview-owner@example.test',password}}));
 const south=ok(await owner.action('company.create',{name:'Testbedrijf Zuid'})).result.company;
 async function addUser(name,companyId,role){
  const invitation=ok(await owner.action('invitation.create',{name,email:randomUUID()+'@example.test',companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}}));return browser;
 }
 const seller=await addUser('Verkoper Noord','c-noord','verkoper'),manager=await addUser('Beheerder Zuid',south.id,'bedrijfsbeheerder');
 async function lead(title){return ok(await owner.action('lead.create',{title,organization:'Centrale organisatie',city:'Utrecht',source:'bouw',contact:'Contact bij bron',phone:'030-2222222',email:'bron@example.test',description:'Een gedeeld centraal project.'})).result.lead;}
 const shared=await lead('Gedeeld project'),second=await lead('Tweede centrale project');
 const northNote={id:'note-'+randomUUID(),text:'Privénotitie van Noord'},southNote={id:'note-'+randomUUID(),text:'Privénotitie van Zuid'};
 ok(await seller.action('workspace.save',{leadId:shared.id,changes:{status:'opvolgen',priority:'high',ownerId:seller.user.id,contactName:'Contact Noord',contactEmail:'noord-prive@example.test'},note:northNote}));
 ok(await manager.action('workspace.save',{leadId:shared.id,changes:{status:'offerte',ownerId:manager.user.id,contactName:'Contact Zuid',contactEmail:'zuid-prive@example.test',commitment:true,calculation:true},note:southNote},south.id));
 ok(await seller.action('call.record',{leadId:shared.id,outcome:'reached',person:'Gesproken persoon Noord',detail:'Privégesprek Noord'}));
 ok(await manager.action('call.record',{leadId:second.id,outcome:'voicemail',person:'Contact Zuid',detail:'Privégesprek Zuid'},south.id));
 const northCallback=ok(await seller.action('callback.add',{leadId:shared.id,assigneeId:seller.user.id,dueAt:new Date(Date.now()-3600000).toISOString(),description:'Opvolging Noord'})).result.callback;
 const southCallback=ok(await manager.action('callback.add',{leadId:shared.id,assigneeId:manager.user.id,dueAt:new Date(Date.now()+3600000).toISOString(),description:'Opvolging Zuid'},south.id)).result.callback;
 return{owner,seller,manager,client,addUser,south,shared,second,northNote,southNote,northCallback,southCallback};
}

test('a head administrator sees the real follow-up and activity of every company independently of the selected workspace',async t=>{
 const f=await fixture(t);
 for(const selected of ['c-noord',f.south.id]){
  const response=ok(await f.owner.state(selected)),state=response.state;
  assert.equal(response.companyId,selected);assert.ok(state.companies.some(company=>company.id==='c-noord'));assert.ok(state.companies.some(company=>company.id===f.south.id));
  const north=state.workspaces['c-noord'][f.shared.id],south=state.workspaces[f.south.id][f.shared.id];
  assert.equal(north.notes[0].text,f.northNote.text);assert.equal(south.notes[0].text,f.southNote.text);
  assert.equal(north.calls[0].userName,'Verkoper Noord');assert.equal(north.calls[0].detail,'Privégesprek Noord');
  assert.equal(state.workspaces[f.south.id][f.second.id].calls[0].userName,'Beheerder Zuid');
  assert.equal(north.callbacks[0].creatorName,'Verkoper Noord');assert.equal(south.callbacks[0].creatorName,'Beheerder Zuid');
  assert.equal(south.commitment,true);assert.equal(south.calculation,true);assert.equal(north.commitment,false);
  assert.ok(state.feed.some(event=>event.companyId==='c-noord'&&event.authorName==='Verkoper Noord'));
  assert.ok(state.feed.some(event=>event.companyId===f.south.id&&event.authorName==='Beheerder Zuid'));
  assert.equal(state.leads.filter(lead=>lead.id===f.shared.id).length,1,'A shared central project is not duplicated for each company');
 }
 const companyless=await f.addUser('Hoofdbeheerder zonder bedrijf',null,'hoofdbeheerder');
 assert.equal(companyless.user.companyId,null);assert.ok(ok(await companyless.state(f.south.id)).state.workspaces['c-noord'][f.shared.id].notes.length);
 assert.equal((await f.client().state()).status,401);
});

test('company managers and sellers cannot obtain another company’s private follow-up or impersonate the global administrator',async t=>{
 const f=await fixture(t);
 for(const [browser,companyId,foreignId,foreignText,foreignEmail]of [
  [f.seller,'c-noord',f.south.id,f.southNote.text,'zuid-prive@example.test'],
  [f.manager,f.south.id,'c-noord',f.northNote.text,'noord-prive@example.test']
 ]){
  const state=ok(await browser.state(companyId)).state,serialized=JSON.stringify(state);
  assert.deepEqual(state.companies.map(company=>company.id),[companyId]);assert.deepEqual(Object.keys(state.workspaces),[companyId]);
  assert.equal(serialized.includes(foreignText),false);assert.equal(serialized.includes(foreignEmail),false);
  assert.equal(state.feed.some(event=>event.companyId===foreignId),false);
  assert.equal(state.callLog.filter(call=>call.companyId===foreignId).every(call=>call.userId===null&&!call.person&&!call.detail&&!call.userName),true,'Cooldown metadata is intentionally anonymous');
  assert.equal((await browser.state(foreignId)).status,403);assert.equal((await browser.state('all')).status,403);
  assert.equal((await browser.request('/api/state?companyId='+encodeURIComponent(foreignId)+'&role=hoofdbeheerder')).status,403);
  assert.equal((await browser.action('workspace.save',{leadId:f.shared.id,changes:{priority:'low'}},foreignId)).status,403);
 }
});

test('moving a seller does not move their historical notes, calls or callbacks into the new company',async t=>{
 const f=await fixture(t),before=ok(await f.owner.state()).state;
 ok(await f.owner.action('user.update',{userId:f.seller.user.id,companyId:f.south.id,role:'verkoper'}));
 const after=ok(await f.owner.state(f.south.id)).state;
 assert.equal(after.users.find(user=>user.id===f.seller.user.id).companyId,f.south.id);
 assert.deepEqual(after.workspaces['c-noord'][f.shared.id],before.workspaces['c-noord'][f.shared.id]);
 assert.deepEqual(after.workspaces[f.south.id][f.shared.id],before.workspaces[f.south.id][f.shared.id]);
 assert.equal(after.callLog.find(call=>call.userId===f.seller.user.id).companyId,'c-noord');
 assert.equal(after.workspaces['c-noord'][f.shared.id].calls[0].userName,'Verkoper Noord');
 assert.equal(after.workspaces['c-noord'][f.shared.id].callbacks[0].creatorName,'Verkoper Noord');
 assert.equal((await f.seller.state()).status,401,'The moved account must authenticate again');
});
