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

const origin='https://lead-delete.example.test',password='Lead-delete-test-password-2026!';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/64kAAAAASUVORK5CYII=';
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response.data));return response.data;};

async function fixture(t){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'bouwberichten-lead-delete-'));
 const options={dataDir,publicOrigin:origin,publicOriginAliases:'',secureCookies:false,adminEmail:'lead-owner@example.test',adminName:'Hoofdbeheerder Test',adminPassword:password,bootstrapToken:'',demoCleanupId:'',seedDemoData:false};
 let app=createApp(options);
 t.after(async()=>{await app.close();const target=path.resolve(dataDir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('bouwberichten-lead-delete-'));await rm(target,{recursive:true,force:true});});
 function client(){
  const browser={cookie:'',csrf:'',user:null};
  browser.request=async(route,{method='GET',body,csrf=true,requestOrigin=origin,headers={}}={})=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   const req=Object.assign(Readable.from(bytes?[bytes]:[]),{url:route,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:new URL(origin).host,origin:requestOrigin,'content-type':'application/json',...browser.cookie&&{cookie:browser.cookie},...csrf&&browser.csrf&&{'x-csrf-token':browser.csrf},...headers}});
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
 async function source(name,provider='bouwberichten'){
  const created=ok(await owner.action('source.create',{name,provider})).result.source;
  const rotate=()=>owner.action('source.import.rotate',{id:created.id});let key=ok(await rotate()).result.importToken;
  return {...created,async import(runId,items){return owner.request('/api/import/sources/'+created.id+'/leads',{method:'POST',body:{runId,items},headers:{authorization:'Bearer '+key}});},async rotate(){key=ok(await rotate()).result.importToken;}};
 }
 function dbRead(fn){const db=new DatabaseSync(path.join(dataDir,'dashboard.sqlite'));try{return fn(db);}finally{db.close();}}
 function snapshot(){return dbRead(db=>({state:JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json),exclusions:db.prepare('SELECT * FROM lead_import_exclusions ORDER BY provider,scope_id,external_id').all(),mappings:db.prepare('SELECT * FROM source_items ORDER BY source_id,external_id').all(),providers:db.prepare('SELECT * FROM provider_items ORDER BY provider,external_id').all(),images:db.prepare('SELECT lead_id,version FROM lead_images ORDER BY lead_id').all()}));}
 const createLead=async(title='Handmatige centrale lead')=>ok(await owner.action('lead.create',{title,organization:'Testaannemer',city:'Utrecht',source:'bouw',contact:'Broncontact',phone:'030-2222222',email:'bron@example.test',description:'Alleen synthetische testgegevens.'})).result.lead;
 return{owner,client,addUser,source,snapshot,createLead,async restart(){await app.close();app=createApp(options);},editState(update){dbRead(db=>{const state=JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);update(state);db.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(state));});}};
}

test('global lead deletion preserves every company call, note and result while active mutations and images become unavailable',async t=>{
 const f=await fixture(t),s=await f.source('Gegunde projecten');ok(await s.import('initial',[{externalId:'232259',title:'Appartementen voor historie',projectImage:image}]));
 const lead=(await f.owner.state()).leads[0],company=ok(await f.owner.action('company.create',{name:'Tweede bedrijf'})).result.company;
 const seller=await f.addUser('Tweede verkoper',company.id),untouched=ok(await f.owner.action('company.create',{name:'Zonder historie'})).result.company,other=await f.addUser('Andere verkoper',untouched.id);
 ok(await f.owner.action('settings.update',{cooldownHours:0}));ok(await f.owner.action('call.record',{leadId:lead.id,outcome:'reached',person:'Broncontact'}));
 ok(await f.owner.action('workspace.save',{leadId:lead.id,changes:{status:'offerte',commitment:true,calculation:true},note:{id:'note-'+randomUUID(),text:'Bedrijfsnotitie blijft behouden.'}}));
 ok(await seller.action('call.record',{leadId:lead.id},company.id));ok(await seller.action('workspace.save',{leadId:lead.id,changes:{commitment:true},note:{id:'note-'+randomUUID(),text:'Andere bedrijfsnotitie.'}},company.id));
 ok(await f.owner.action('callback.add',{leadId:lead.id,assigneeId:'u-admin',dueAt:new Date(Date.now()-60000).toISOString()}));
 const before=await f.owner.state(),calls=buildCallReport(before),reports=reportRows(before);
 const response=ok(await f.owner.action('lead.delete',{leadId:lead.id,confirmed:true,reason:'Voor de groep geen werkzaamheden'})),after=response.state;
 assert.deepEqual(response.result,{deleted:true,alreadyDeleted:false,leadId:lead.id,exclusions:1});assert.deepEqual(after.leads,[]);
 assert.deepEqual(after.workspaces,before.workspaces);assert.deepEqual(after.callLog,before.callLog);assert.deepEqual(after.feed.slice(1),before.feed);
 assert.deepEqual(buildCallReport(after),calls);assert.deepEqual(reportRows(after),reports);
 const archive=after.archivedLeads[0];for(const [key,value]of Object.entries(lead))assert.deepEqual(archive[key],value);
 assert.equal(archive.deletedById,'u-admin');assert.equal(archive.deletedByName,'Hoofdbeheerder Test');assert.equal(archive.deletionReason,'Voor de groep geen werkzaamheden');assert.ok(Number.isFinite(Date.parse(archive.deletedAt)));
 assert.equal((await f.owner.request(lead.projectImageUrl)).status,404);
 for(const [type,payload]of [['workspace.update',{field:'status',value:'nieuw'}],['workspace.save',{changes:{commitment:false}}],['note.add',{text:'Verouderd scherm'}],['call.record',{}],['callback.add',{assigneeId:'u-admin',dueAt:new Date().toISOString()}]])assert.equal((await f.owner.action(type,{leadId:lead.id,...payload})).status,404,type);
 const own=await seller.state(company.id);assert.deepEqual(own.leads,[]);assert.deepEqual(Object.keys(own.archivedLeads[0]).sort(),['createdAt','id','source','sourceIds']);assert.equal(reportRows(own)[0].commitments,1);assert.equal(JSON.stringify(own.archivedLeads).includes('Voor de groep'),false);assert.equal((await other.state(untouched.id)).archivedLeads,undefined);
});

test('Bouwberichten exclusions survive restart and block existing, overlapping and newly added filter sources without import errors',async t=>{
 const f=await fixture(t),a=await f.source('Filter A'),b=await f.source('Filter B'),item={externalId:'232259',title:'Te verwijderen project',projectImage:image};
 const first=ok(await a.import('first',[item]));ok(await b.import('overlap',[item]));const lead=(await f.owner.state()).leads[0];ok(await f.owner.action('lead.delete',{leadId:lead.id,confirmed:true}));
 const before=f.snapshot();assert.equal(before.exclusions.length,1);assert.equal(before.exclusions[0].provider,'bouwberichten');assert.equal(before.exclusions[0].scope_id,'');
 for(const [source,run]of [[a,'again-a'],[b,'again-b']])assert.deepEqual(ok(await source.import(run,[item])).counts,{created:0,updated:0,unchanged:0,excluded:1});
 const c=await f.source('Nieuw filter');assert.deepEqual(ok(await c.import('new-filter',[item])).counts,{created:0,updated:0,unchanged:0,excluded:1});
 await a.rotate();assert.deepEqual(ok(await a.import('new-key',[item])).counts,{created:0,updated:0,unchanged:0,excluded:1});
 assert.deepEqual(f.snapshot().mappings,before.mappings);assert.deepEqual(f.snapshot().providers,before.providers);assert.deepEqual(f.snapshot().images,before.images);
 assert.deepEqual(ok(await a.import('first',[item])),first,'An old run is a receipt and cannot recreate the deleted lead');
 await f.restart();assert.deepEqual((await f.owner.state()).leads,[]);assert.deepEqual(ok(await b.import('after-restart',[item])).counts,{created:0,updated:0,unchanged:0,excluded:1});
 const mixed=ok(await c.import('mixed',[item,{externalId:'different',title:'Wel geschikte lead'}]));assert.deepEqual(mixed.counts,{created:1,updated:0,unchanged:0,excluded:1});
 const state=await f.owner.state();assert.equal(state.leads.length,1);assert.equal(state.leads[0].importExternalId,'different');assert.equal(state.sources.find(source=>source.id===c.id).lastImportError,null);assert.equal(state.archivedLeads.length,1);
 assert.deepEqual(ok(await c.import('mixed',[item,{externalId:'different',title:'Wel geschikte lead'}])),mixed);
});

test('generic project identities remain source-specific and cannot block unrelated providers with the same external ID',async t=>{
 const f=await fixture(t),a=await f.source('Hotels A','generic'),b=await f.source('Hotels B','generic'),item={externalId:'same-id',title:'Hotelproject'};
 ok(await a.import('first',[item]));ok(await b.import('first',[item]));const lead=(await f.owner.state()).leads.find(item=>item.source===a.id);ok(await f.owner.action('lead.delete',{leadId:lead.id,confirmed:true}));
 assert.deepEqual(ok(await a.import('next',[item])).counts,{created:0,updated:0,unchanged:0,excluded:1});assert.deepEqual(ok(await b.import('next',[{...item,title:'Hotel bijgewerkt'}])).counts,{created:0,updated:1,unchanged:0});
 const bouw=await f.source('Bouwberichten apart');assert.deepEqual(ok(await bouw.import('first',[item])).counts,{created:1,updated:0,unchanged:0});assert.equal((await f.owner.state()).leads.length,2);
});

test('deletion requires current chief privileges and confirmation, is atomic on invalid input, and retries do not duplicate audit or exclusions',async t=>{
 const f=await fixture(t),source=await f.source('Beschermde bron');ok(await source.import('first',[{externalId:'protected',title:'Beschermde lead'}]));const lead=(await f.owner.state()).leads[0],seller=await f.addUser('Verkoper'),manager=await f.addUser('Bedrijfsbeheerder','c-noord','bedrijfsbeheerder');
 const payload={leadId:lead.id,confirmed:true},before=f.snapshot();
 for(const browser of [seller,manager])assert.equal((await browser.action('lead.delete',payload)).status,403);
 for(const value of [undefined,false,'true'])assert.equal((await f.owner.action('lead.delete',{leadId:lead.id,confirmed:value})).status,400);
 for(const reason of [42,'x'.repeat(1001)])assert.equal((await f.owner.action('lead.delete',{...payload,reason})).status,400);
 for(const options of [{csrf:false},{requestOrigin:'https://foreign.example.test'}])assert.equal((await f.owner.action('lead.delete',payload,'c-noord',options)).status,403);
 assert.deepEqual(f.snapshot(),before);
 f.editState(state=>{state.users.find(user=>user.id==='u-admin').role='verkoper';});assert.equal((await f.owner.action('lead.delete',payload)).status,403);f.editState(state=>{state.users.find(user=>user.id==='u-admin').role='hoofdbeheerder';});
 const removed=ok(await f.owner.action('lead.delete',payload)),after=f.snapshot();assert.equal(removed.result.alreadyDeleted,false);
 const replay=ok(await f.owner.action('lead.delete',{...payload,reason:'Andere reden'}));assert.equal(replay.result.alreadyDeleted,true);assert.deepEqual(f.snapshot(),after);
 assert.equal((await f.owner.action('lead.delete',{leadId:'unknown',confirmed:true})).status,404);assert.deepEqual(f.snapshot(),after);
});

test('a chief can remove a manual lead with no import identity, including when no active company remains',async t=>{
 const f=await fixture(t),lead=await f.createLead(),other=await f.createLead('Andere centrale lead');ok(await f.owner.action('user.update',{userId:'u-admin',companyId:null,role:'hoofdbeheerder'}));ok(await f.owner.action('company.delete',{companyId:'c-noord',confirmed:true}));
 const response=ok(await f.owner.action('lead.delete',{leadId:lead.id,confirmed:true},''));assert.equal(response.companyId,null);assert.equal(response.result.exclusions,0);assert.deepEqual(response.state.leads.map(item=>item.id),[other.id]);
 await f.restart();const state=await f.owner.state();assert.deepEqual(state.leads.map(item=>item.id),[other.id]);assert.equal(state.archivedLeads[0].id,lead.id);
});
