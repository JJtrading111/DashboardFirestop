import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../server.mjs';
import {reportRows,buildCallReport} from '../public/model.mjs';

const origin='https://cooldown-visibility.example.test',password='Visibility-test-password-2026!';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/64kAAAAASUVORK5CYII=';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-cooldown-visible-'));
 const options={dataDir,publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:'visibility-owner@example.test',adminName:'Hoofdbeheerder',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false};
 let app=createApp(options);
 t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('bouwberichten-cooldown-visible-'));await rm(target,{recursive:true,force:true});});
 function client(){
  const browser={cookie:'',csrf:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,requestOrigin=origin,headers={}}={})=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:route,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin:requestOrigin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrf&&{'x-csrf-token':browser.csrf},...headers}});
   const res={headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=String(value);},writeHead(status,headers={}){this.status=status;this.headersSent=true;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);},end(value){this.bytes=value===undefined?Buffer.alloc(0):Buffer.from(value);}};
   await app.handler(req,res);let data;try{data=JSON.parse(res.bytes.toString());}catch{data=null;}
   if(res.headers['set-cookie'])browser.cookie=res.headers['set-cookie'].split(';')[0];if(res.status===200&&data?.csrfToken)browser.csrf=data.csrfToken;if(res.status===200&&data?.user)browser.user=data.user;
   return{status:res.status,data,bytes:res.bytes,headers:res.headers};
  };
  browser.action=(type,payload={},companyId=browser.user?.companyId||'c-noord',extra={})=>browser.request('/api/action',{method:'POST',body:{type,companyId,payload},...extra});
  browser.state=async(companyId='')=>ok(await browser.request('/api/state'+(companyId?'?companyId='+encodeURIComponent(companyId):''))).state;
  return browser;
 }
 const owner=client();ok(await owner.request('/api/auth/login',{method:'POST',body:{email:options.adminEmail,password}}));
 const b=ok(await owner.action('company.create',{name:'Tweede firma'})).result.company,c=ok(await owner.action('company.create',{name:'Derde firma'})).result.company;
 async function member(name,companyId='c-noord',role='verkoper'){
  const email=randomUUID()+'@example.test',invitation=ok(await owner.action('invitation.create',{name,email,companyId,role})).result;
  const browser=client();ok(await browser.request('/api/auth/activate',{method:'POST',body:{token:invitation.token,name,password}}));browser.email=email;return browser;
 }
 const createLead=async()=>ok(await owner.action('lead.create',{title:'Afgeschermd project in wachttijd',organization:'Besloten projectorganisatie',city:'Utrecht',source:'bouw',contact:'Projectcontact',phone:'030-2222222',email:'bron@example.test',description:'Projectdetails mogen niet in een andere firma verschijnen.'})).result.lead;
 function sql(fn){const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{return fn(db);}finally{db.close();}}
 const stored=()=>sql(db=>JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json));
 const editState=update=>sql(db=>{const state=JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);update(state);db.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(state));});
 async function importSource(name='Importbron'){
  const source=ok(await owner.action('source.create',{name,provider:'bouwberichten'})).result.source,key=ok(await owner.action('source.import.rotate',{id:source.id})).result.importToken;
  return{...source,async send(runId,items){return owner.request('/api/import/sources/'+source.id+'/leads',{method:'POST',body:{runId,items},headers:{authorization:'Bearer '+key}});}};
 }
 return{owner,b,c,member,createLead,stored,editState,importSource,async restart(){await app.close();app=createApp(options);}};
}

test('foreign cooldown projects disappear for sellers and company managers while the caller firm and chief retain them',async t=>{
 const f=await fixture(t),lead=await f.createLead(),sellerA=await f.member('Collega van beller'),sellerB=await f.member('Andere verkoper',f.b.id),managerB=await f.member('Andere beheerder',f.b.id,'bedrijfsbeheerder'),sellerC=await f.member('Derde verkoper',f.c.id);
 assert.equal((await sellerB.state()).leads.some(item=>item.id===lead.id),true);
 ok(await f.owner.action('call.record',{leadId:lead.id}));const persisted=f.stored();
 for(const browser of [sellerB,managerB,sellerC]){
  const state=await browser.state();assert.equal(state.leads.some(item=>item.id===lead.id),false);
  assert.equal(state.feed.some(item=>item.leadId===lead.id),false);assert.equal(state.callLog.some(item=>item.leadId===lead.id),false);
  assert.equal(state.reportLeads?.some(item=>item.id===lead.id)||false,false);assert.equal(Object.hasOwn(state.workspaces[browser.user.companyId],lead.id),false);
  assert.equal(JSON.stringify(state).includes(lead.title),false);assert.equal(JSON.stringify(state).includes(lead.organization),false);
  if(browser===managerB){const response=ok(await browser.action('columns.update',{columns:state.companies[0].columns}));assert.equal(response.state.leads.some(item=>item.id===lead.id),false);}
 }
 assert.equal((await sellerA.state()).leads.some(item=>item.id===lead.id),true);assert.equal((await f.owner.state(f.b.id)).leads.some(item=>item.id===lead.id),true);
 // The manager's legitimate column audit is the only persisted change above.
 const after=f.stored();assert.deepEqual(after.leads,persisted.leads);assert.deepEqual(after.workspaces,persisted.workspaces);assert.deepEqual(after.callLog,persisted.callLog);
});

test('only the personally assigned due callback bypasses invisibility and completing it hides the lead again',async t=>{
 const f=await fixture(t),lead=await f.createLead(),bob=await f.member('Terugbeller',f.b.id),colleague=await f.member('Collega',f.b.id),manager=await f.member('Beheerder',f.b.id,'bedrijfsbeheerder');
 ok(await f.owner.action('call.record',{leadId:lead.id}));
 const callback=ok(await f.owner.action('callback.add',{leadId:lead.id,assigneeId:bob.user.id,dueAt:new Date(Date.now()+60000).toISOString()},f.b.id)).result.callback;
 assert.equal((await bob.state()).leads.some(item=>item.id===lead.id),false);
 ok(await f.owner.action('callback.update',{leadId:lead.id,callbackId:callback.id,assigneeId:bob.user.id,dueAt:new Date(Date.now()-1000).toISOString()},f.b.id));
 assert.equal((await bob.state()).leads.some(item=>item.id===lead.id),true);
 for(const browser of [colleague,manager])assert.equal((await browser.state()).leads.some(item=>item.id===lead.id),false);
 const completed=ok(await bob.action('callback.complete',{leadId:lead.id,callbackId:callback.id}));assert.equal(completed.state.leads.some(item=>item.id===lead.id),false);
 assert.equal((await bob.action('note.add',{leadId:lead.id,text:'Verouderd scherm'})).status,404);
 ok(await f.owner.action('callback.add',{leadId:lead.id,assigneeId:bob.user.id,dueAt:new Date(Date.now()-1000).toISOString()},f.b.id));
 ok(await bob.action('call.record',{leadId:lead.id}));
 assert.equal((await colleague.state()).leads.some(item=>item.id===lead.id),true,'The most recent calling company now owns the wait window');
 const sellerA=await f.member('Verkoper eerste firma');assert.equal((await sellerA.state()).leads.some(item=>item.id===lead.id),false);
});

test('visibility returns after expiry or a zero wait setting without deleting or archiving the shared project',async t=>{
 const f=await fixture(t),lead=await f.createLead(),seller=await f.member('Wachtende verkoper',f.b.id);
 ok(await f.owner.action('call.record',{leadId:lead.id}));assert.equal((await seller.state()).leads.some(item=>item.id===lead.id),false);
 f.editState(state=>{state.callLog.find(call=>call.leadId===lead.id).at=new Date(Date.now()-49*3600000).toISOString();});
 assert.equal((await seller.state()).leads.some(item=>item.id===lead.id),true);
 f.editState(state=>{state.callLog.find(call=>call.leadId===lead.id).at=new Date().toISOString();});assert.equal((await seller.state()).leads.some(item=>item.id===lead.id),false);
 ok(await f.owner.action('settings.update',{cooldownHours:0}));assert.equal((await seller.state()).leads.some(item=>item.id===lead.id),true);
 assert.equal(f.stored().leads.some(item=>item.id===lead.id),true);assert.equal(f.stored().archivedLeads?.some(item=>item.id===lead.id)||false,false);
});

test('hidden projects reject stale write actions and image URLs without exposing or changing the project',async t=>{
 const f=await fixture(t),source=await f.importSource(),seller=await f.member('Wachtende verkoper',f.b.id);
 ok(await source.send('image-project',[{externalId:'232259',title:'Afgeschermde projectimpressie',projectImage:image}]));const lead=(await f.owner.state()).leads[0],url=lead.projectImageUrl;
 assert.equal((await seller.request(url)).status,200);ok(await f.owner.action('call.record',{leadId:lead.id}));const before=f.stored();
 for(const [type,payload]of [
  ['workspace.update',{field:'status',value:'offerte'}],['workspace.save',{changes:{commitment:true},note:{id:'note-'+randomUUID(),text:'Niet schrijven'}}],
  ['workspace.contact.select',{partyIndex:0,confirmed:true}],['note.add',{text:'Niet schrijven'}],['call.record',{}],
  ['callback.add',{assigneeId:seller.user.id,dueAt:new Date().toISOString()}],['callback.update',{callbackId:'old'}],['callback.complete',{callbackId:'old'}]
 ]){assert.equal((await seller.action(type,{leadId:lead.id,...payload})).status,404,type);assert.deepEqual(f.stored(),before,type+' must be atomic');}
 assert.equal((await seller.request(url)).status,404);assert.equal((await seller.request(url,{method:'HEAD'})).status,404);assert.equal((await f.owner.request(url)).status,200);
 assert.equal((await seller.action('note.add',{leadId:lead.id,text:'Bad CSRF'},f.b.id,{csrf:false})).status,403);
 assert.equal((await seller.action('note.add',{leadId:lead.id,text:'Bad origin'},f.b.id,{requestOrigin:'https://foreign.example.test'})).status,403);
 assert.deepEqual(f.stored(),before);
});

test('hidden own-company history keeps exact conversion and call reports through minimal snapshots and survives restart',async t=>{
 const f=await fixture(t),lead=await f.createLead(),seller=await f.member('Verkoper met historie',f.b.id);
 ok(await f.owner.action('settings.update',{cooldownHours:0}));
 ok(await seller.action('call.record',{leadId:lead.id,outcome:'reached',person:'Privépersoon',detail:'Privétoelichting'}));
 ok(await seller.action('workspace.save',{leadId:lead.id,changes:{status:'offerte',ownerId:seller.user.id,commitment:true,calculation:true,contactName:'Eigen geheime persoon',contactEmail:'eigen@example.test',contactPhone:'06 1234 5678'},note:{id:'note-'+randomUUID(),text:'Mijn verborgen gespreksnotitie'}}));
 const before=await seller.state(),beforeCalls=buildCallReport(before),beforeRows=reportRows(before);
 ok(await f.owner.action('call.record',{leadId:lead.id}));ok(await f.owner.action('settings.update',{cooldownHours:48}));
 const persisted=f.stored(),state=await seller.state(),summary=state.workspaces[f.b.id][lead.id];
 assert.equal(state.leads.length,0);assert.equal(state.reportLeads.length,1);assert.deepEqual(Object.keys(state.reportLeads[0]).sort(),['createdAt','id','source']);
 assert.equal(JSON.stringify(state).includes(lead.title),false);assert.equal(JSON.stringify(state).includes('Eigen geheime persoon'),false);assert.equal(JSON.stringify(state).includes('Mijn verborgen gespreksnotitie'),false);assert.equal(JSON.stringify(state).includes('Privépersoon'),false);
 assert.deepEqual(summary.notes,[]);assert.deepEqual(summary.callbacks,[]);assert.equal(summary.ownerId,seller.user.id);assert.equal(summary.commitment,true);assert.equal(Object.hasOwn(summary,'status'),false);assert.equal(Object.hasOwn(summary,'contactName'),false);
 assert.deepEqual(buildCallReport(state),beforeCalls);assert.deepEqual(reportRows(state),beforeRows);assert.equal(state.callLog.every(call=>call.companyId===f.b.id),true);
 assert.deepEqual(f.stored(),persisted);assert.equal(persisted.workspaces[f.b.id][lead.id].notes[0].text,'Mijn verborgen gespreksnotitie');
 await f.restart();const restarted=await seller.state();assert.deepEqual(reportRows(restarted),beforeRows);assert.deepEqual(buildCallReport(restarted),beforeCalls);assert.equal(restarted.leads.length,0);
});

test('overlapping and newly configured import filters cannot resurface a project during another company wait',async t=>{
 const f=await fixture(t),first=await f.importSource('Eerste selectie'),second=await f.importSource('Andere selectie'),seller=await f.member('Wachtende verkoper',f.b.id);
 ok(await first.send('initial',[{externalId:'232259',title:'Eén centraal project'}]));const lead=(await f.owner.state()).leads[0];ok(await f.owner.action('call.record',{leadId:lead.id}));
 ok(await second.send('overlap',[{externalId:'232259',title:'Bijgewerkt centraal project'}]));assert.equal((await seller.state()).leads.length,0);
 const third=await f.importSource('Nieuwe selectie');ok(await third.send('new-filter',[{externalId:'232259',title:'Bijgewerkt centraal project'}]));
 const full=await f.owner.state();assert.equal(full.leads.length,1);assert.equal(full.leads[0].id,lead.id);assert.equal(full.leads[0].sourceIds.length,3);assert.equal((await seller.state()).leads.length,0);
});

test('legacy own call-log history remains countable without exposing a hidden imported project or creating a workspace',async t=>{
 const f=await fixture(t),source=await f.importSource(),seller=await f.member('Historische beller',f.b.id);
 ok(await source.send('legacy-project',[{externalId:'232259',title:'Verborgen geïmporteerd historisch project'}]));const lead=(await f.owner.state()).leads[0];
 ok(await f.owner.action('settings.update',{cooldownHours:0}));
 ok(await seller.action('call.record',{leadId:lead.id,outcome:'reached',person:'Historische contactnaam',detail:'Vertrouwelijke historie'}));
 ok(await seller.action('call.record',{leadId:lead.id,outcome:'voicemail'}));
 // Some older persisted histories contain only callLog; scoping must not invent a workspace.
 f.editState(state=>{delete state.workspaces[f.b.id][lead.id];});
 ok(await f.owner.action('call.record',{leadId:lead.id}));ok(await f.owner.action('settings.update',{cooldownHours:48}));
 const persisted=f.stored(),state=await seller.state(),expected=buildCallReport(await f.owner.state(),{companyId:f.b.id});
 assert.equal(state.leads.length,0);assert.equal(Object.hasOwn(state.workspaces[f.b.id],lead.id),false);
 assert.deepEqual(state.reportLeads,[{id:lead.id,source:lead.source,sourceIds:lead.sourceIds,createdAt:lead.createdAt}]);
 assert.equal(state.callLog.length,2);assert.equal(state.callLog.every(call=>call.companyId===f.b.id),true);
 assert.equal(JSON.stringify(state).includes(lead.title),false);assert.equal(JSON.stringify(state).includes('Historische contactnaam'),false);assert.equal(JSON.stringify(state).includes('Vertrouwelijke historie'),false);
 assert.equal(buildCallReport(state).totals.calls,2);assert.deepEqual(buildCallReport(state).totals,expected.totals);assert.deepEqual(f.stored(),persisted);
});

test('a role change revokes an old chief session and the replacement company account receives the visibility scope',async t=>{
 const f=await fixture(t),lead=await f.createLead(),chief=await f.member('Overkoepelend account',f.b.id,'hoofdbeheerder');
 ok(await f.owner.action('call.record',{leadId:lead.id}));assert.equal((await chief.state()).leads.some(item=>item.id===lead.id),true);
 ok(await f.owner.action('user.update',{userId:chief.user.id,companyId:f.b.id,role:'verkoper'}));assert.equal((await chief.request('/api/state')).status,401);
 ok(await chief.request('/api/auth/login',{method:'POST',body:{email:chief.email,password}}));assert.equal((await chief.state()).leads.some(item=>item.id===lead.id),false);
});
