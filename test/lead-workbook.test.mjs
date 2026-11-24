import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createApp} from '../server.mjs';
import {enrichLeadWithPresentation,mapProjectToLead} from '../scraper/bouwberichten-api.mjs';
import * as model from '../public/model.mjs';

const email='workbook-admin@example.test';
const password='Long-workbook-test-password!';
const origin='http://workbook.example.test';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/64kAAAAASUVORK5CYII=';
const project={id:312345,name:'Voorbeeldwoningen',description:'Bouw van 20 woningen.',address:{street:'Voorbeeldstraat',city:'Utrecht'},
 startedAt:'2027-01-09T23:00:00Z',deliveredAt:'2027-12-12',surface:2350,buildingLayers:{min:2,max:4},estimatedAmountValue:2500000,
 involvements:[{organisationId:10,role:'Architect'},{organisationId:11,role:'Hoofdaannemer'}]};
const organisations=[{id:10,name:'Voorbeeldarchitect',phoneNumber:'030-1111111'},{id:11,name:'Voorbeeldaannemer',phoneNumber:'030-2222222',website:'www.example.test',email:'aannemer@example.test'}];
const item=()=>mapProjectToLead(project,{organisations,preferredRoles:['Hoofdaannemer'],includeDetails:true});

async function setup(t){
 const workerToken=randomBytes(32).toString('base64url');
 const app=createApp({dataDir:':memory:',adminEmail:email,adminPassword:password,publicOrigin:origin,secureCookies:false,
  scraperEncryptionKey:randomBytes(32).toString('base64url'),scraperWorkerToken:workerToken});
 t.after(()=>app.close());
 async function request(url,{body,headers={},method=body?'POST':'GET'}={}){
  // Dispatch through the server's HTTP handler with the real auth and database.
  const req=Object.assign(Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]),{url,method,socket:{remoteAddress:'127.0.0.1'},
   headers:{origin,host:'workbook.example.test','content-type':'application/json',...headers}});
  const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,extra={}){this.status=status;this.headersSent=true;for(const [k,v]of Object.entries(extra))this.setHeader(k,v);},end(value){this.body=value;}};
  await app.handler(req,res);
  const data=res.headers['content-type']?.includes('json')?JSON.parse(res.body):res.body;
  return {status:res.status,data,headers:res.headers};
 }
 const login=await request('/api/auth/login',{body:{email,password}});assert.equal(login.status,200);
 const headers={cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.data.csrfToken};
 const action=(type,payload,companyId='c-noord')=>request('/api/action',{body:{type,payload,companyId},headers});
 const snapshot=()=>request('/api/state',{headers}).then(response=>response.data.state);
 const worker=(route,body={})=>request('/api/scraper/'+route,{body,headers:{authorization:'Bearer '+workerToken}});
 return{request,headers,action,snapshot,worker};
}

test('the scraper selects the explicit main contractor and separates other organisations',()=>{
 const lead=item();
 assert.equal(lead.organization,'Voorbeeldaannemer');assert.equal(lead.phone,'030-2222222');
 assert.equal(lead.projectDetails.primaryRole,'Hoofdaannemer');assert.equal(lead.projectDetails.primaryWebsite,'https://www.example.test/');
 assert.equal(lead.projectDetails.scheduleStart,'2027-01-10');assert.equal(lead.projectDetails.scope,'20 woningen');
 assert.deepEqual(lead.projectDetails.parties.map(party=>party.name),['Voorbeeldarchitect']);
 const ambiguous=mapProjectToLead({...project,involvements:[...project.involvements,{organisationId:12,role:'Hoofdaannemer'}]},
  {organisations,preferredRoles:['Hoofdaannemer'],includeDetails:true});
 assert.equal(ambiguous.phone,undefined);
 const fromPage=mapProjectToLead({...project,involvements:[]},{includeDetails:true});
 enrichLeadWithPresentation(fromPage,{info:{Plan:'Voorbeeldplan'},mainContractor:{name:'Voorbeeldaannemer',phone:'030-2222222'},projectImage:photo});
 assert.equal(fromPage.projectDetails.primaryRole,'Hoofdaannemer');assert.equal(fromPage.projectDetails.plan,'Voorbeeldplan');
 assert.equal(fromPage.phone,'030-2222222');assert.equal(fromPage.projectImage,photo);
});

test('an existing imported lead receives project details and a private image without replacing follow-up',async t=>{
 const {action,request,headers,snapshot}=await setup(t);
 const key=await action('source.import.rotate',{id:'bouw'});assert.equal(key.status,200);
 const ingest=(runId,entry)=>request('/api/import/sources/bouw/leads',{body:{runId,items:[entry]},headers:{authorization:'Bearer '+key.data.result.importToken}});
 const {externalId,title}=item(),old={externalId,title,sourceUpdatedAt:'2026-11-20T00:00:00Z'};
 assert.equal((await ingest('initial',old)).status,200);
 const lead=(await snapshot()).leads[0];
 assert.equal((await action('note.add',{leadId:lead.id,text:'Bewaar deze notitie'})).status,200);
 const fresh={...old,...item(),projectImage:photo,sourceUpdatedAt:'2026-11-24T00:00:00Z'};
 assert.deepEqual((await ingest('enrich',fresh)).data.counts,{created:0,updated:1,unchanged:0});
 assert.deepEqual((await ingest('repeat',fresh)).data.counts,{created:0,updated:0,unchanged:1});
 const imageBeforeMiss=(await snapshot()).leads[0].projectImageUrl,withoutImage={...fresh};delete withoutImage.projectImage;
 assert.deepEqual((await ingest('photo-temporarily-missing',withoutImage)).data.counts,{created:0,updated:0,unchanged:1});
 assert.equal((await snapshot()).leads[0].projectImageUrl,imageBeforeMiss,'A missed photo capture keeps the previously stored project photograph');
 assert.deepEqual((await ingest('stale',{...fresh,sourceUpdatedAt:old.sourceUpdatedAt,projectDetails:{...fresh.projectDetails,scope:'Verouderd'}})).data.counts,{created:0,updated:0,unchanged:1});
 const state=await snapshot(),enriched=state.leads[0];
 assert.equal(enriched.id,lead.id);assert.equal(enriched.projectDetails.scope,'20 woningen');
 assert.equal(state.workspaces['c-noord'][lead.id].notes[0].text,'Bewaar deze notitie');
 assert.equal(enriched.projectImage,undefined);assert.match(enriched.projectImageUrl,/^\/api\/lead-images\//);
 assert.equal((await request(enriched.projectImageUrl)).status,401);
 const image=await request(enriched.projectImageUrl,{headers});assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/png');
 assert.equal(Buffer.from(image.data).toString('base64'),photo.split(',')[1]);
 assert.equal((await ingest('invalid',{...fresh,projectImage:'data:image/svg+xml;base64,AAAA'})).status,400);
});

test('call outcome, next action and existing callback completion are stored through the live actions',async t=>{
 const {action,snapshot}=await setup(t);
 const create=await action('lead.create',{title:'Opvolgproject',organization:'Voorbeeld',city:'Utrecht',source:'bouw',phone:'030-2222222',contact:'Testcontact',email:'contact@example.test',description:'Voorbeeldproject'});
 assert.equal(create.status,200);
 const lead=(await snapshot()).leads[0],leadId=lead.id;
 const initial=await action('call.record',{leadId});assert.equal(initial.status,200);
 assert.equal((await action('call.record',{leadId,callId:initial.data.result.callId,outcome:'reached',person:'Testpersoon',detail:'Planning opgevraagd'})).status,200);
 assert.equal((await action('call.record',{leadId,callId:initial.data.result.callId,outcome:'unanswered'})).status,409);
 const callback=await action('callback.add',{leadId,assigneeId:'u-admin',dueAt:new Date(Date.now()+86400000).toISOString(),description:'Planning navragen'});
 assert.equal(callback.status,200);const callbackId=callback.data.result.callback.id;
 assert.equal((await action('callback.update',{leadId,callbackId,assigneeId:'u-admin',dueAt:new Date(Date.now()+2*86400000).toISOString(),description:'Tekening navragen'})).status,200);
 assert.equal((await action('callback.complete',{leadId,callbackId})).status,200);
 const state=await snapshot(),workspace=state.workspaces['c-noord'][leadId];
 assert.equal(workspace.lastContactPerson,'Testpersoon');assert.equal(workspace.calls.length,1);assert.equal(workspace.calls[0].outcome,'reached');
 assert.equal(state.callLog[0].detail,undefined,'conversation details never enter the cross-company call log');
 assert.equal(workspace.callbacks[0].description,'Tekening navragen');assert.equal(workspace.callbacks[0].done,true);
});

test('the upgraded worker refreshes a previously completed test selection once',async t=>{
 const {action,worker,snapshot}=await setup(t);
 const filterUrl='https://portal.bouwberichten.nl/projecten#'+new URLSearchParams([['projects[filters][constructionPhase][]','Gegund']]);
 assert.equal((await action('source.update',{id:'bouw',provider:'bouwberichten',filterUrl})).status,200);
 assert.equal((await action('source.scraper.configure',{id:'bouw',username:'test@example.test',password:'fixture-password'})).status,200);
 const old=(await worker('claim')).data.job;assert.equal(old.mode,'test');
 async function finish(job,lead){
  const route=`jobs/${job.id}/`,leaseToken=job.leaseToken;
  assert.equal((await worker(route+'progress',{leaseToken,processed:0,total:1})).status,200);
  assert.equal((await worker(route+'batch',{leaseToken,batch:0,items:[lead]})).status,200);
  assert.equal((await worker(route+'finish',{leaseToken,processed:1,total:1})).status,200);
 }
 await finish(old,{externalId:'312345',title:'Voorbeeldwoningen'});
 assert.equal((await worker('claim')).data.job,null);
 const upgrade=(await worker('claim',{leadWorkbook:true})).data.job;assert.equal(upgrade.mode,'test');
 await finish(upgrade,item());
 assert.equal((await worker('claim',{leadWorkbook:true})).data.job,null);
 assert.equal((await snapshot()).leads[0].phone,'030-2222222');
});

test('shared lead opening renders the workbook and both flags directly below the note action',async()=>{
 const source=(await readFile(new URL('../public/app.mjs',import.meta.url),'utf8')).replace(/^import .*\r?\n/,'').replace(/^initialize\(\);\r?$/m,'');
 const lead={...item(),id:'lead-workbook',source:'bouw',tags:[]};
 const seller={id:'seller',name:'Verkoper',companyId:'company',role:'verkoper',status:'actief'};
 const initialState={users:[seller],companies:[{id:'company',name:'Bedrijf',columns:[{id:'nieuw',name:'Nieuw'}]}],leads:[lead],workspaces:{},settings:{},callLog:[],sources:[{id:'bouw',name:'Bouwberichten'}]};
 const context=vm.createContext({...model,URL,URLSearchParams,initialState,document:{addEventListener(){}},window:{addEventListener(){}},
  location:{hash:'#kanban'},localStorage:{getItem:()=>null},setInterval:()=>0});
 vm.runInContext(source,context);
 const html=vm.runInContext("state=initialState;ui.drawer='lead-workbook';ui.companyId='company';ui.userId='seller';drawerHTML();",context);
 assert.match(html,/workbook-columns/);assert.match(html,/Hoofdaannemer[\s\S]*Voorbeeldaannemer[\s\S]*tel:0302222222/);
 assert.match(html,/Notitie toevoegen<\/button><\/form>\s*<div class="workbook-checks">[\s\S]*Toezegging ontvangen[\s\S]*Klaar voor calculatie/);
 const withDate={...lead,projectDetails:{...lead.projectDetails,scheduleStart:'2027-01-10',scheduleEnd:'2027-12-12'}};
 const later={...withDate,id:'lead-later',projectDetails:{scheduleStart:'2027-02-15',scheduleEnd:'2028-01-15'}};
 const unknown={...lead,id:'lead-undated',projectDetails:null};
 context.dateLeads=[withDate,later,unknown];
 vm.runInContext("state.leads=dateLeads;ui.route='leads';ui.constructionFrom='2027-01-10';ui.constructionTo='2027-01-10';",context);
 for(const route of ['leads','calls']){
  context.route=route;
  const results=vm.runInContext("ui.route=route;filteredLeads().map(record=>record.id).join(',');",context);
  assert.equal(results,'lead-workbook','both overviews include the endpoints and exclude unknown dates while filtering');
  assert.equal(vm.runInContext("ui.deliveryFrom='2028-01-15';filteredLeads().length",context),0,'both date filters must match');
  assert.equal(vm.runInContext("ui.deliveryFrom='';ui.deliveryTo='2027-12-12';filteredLeads().length",context),1);
  vm.runInContext("ui.deliveryTo='';",context);
 }
 const table=vm.runInContext('leadTable(state.leads)',context);
 for(const label of ['Start bouw','Oplevering']){
  assert.ok(table.includes(`aria-label="${label} sorteren van vroeg naar laat"`));
  assert.ok(table.includes(`aria-label="${label} sorteren van laat naar vroeg"`));
 }
 assert.match(table,/<time datetime="2027-01-10">10 jan 2027<\/time>/);
 assert.match(table,/<time datetime="2027-12-12">12 dec 2027<\/time>/);
 assert.match(table,/<span class="muted">Onbekend<\/span>/);
 const filters=vm.runInContext('projectDateFilters()',context);
 assert.match(filters,/<legend>Oplevering<\/legend>[\s\S]*data-field="deliveryFrom"[\s\S]*data-field="deliveryTo"/);
 vm.runInContext("ui.deliveryFrom='2028-01-15';",context);
 assert.equal(vm.runInContext("resetFilters();filteredLeads().length",context),3);
 for(const field of ['scheduleStart','scheduleEnd']){
  context.dateField=field;
  const order=direction=>{context.direction=direction;return vm.runInContext("ui.projectDateSort={field:dateField,direction};filteredLeads().map(record=>record.id).join(',');",context);};
  assert.equal(order('asc'),'lead-workbook,lead-later,lead-undated');
  assert.equal(order('desc'),'lead-later,lead-workbook,lead-undated');
  assert.match(vm.runInContext("projectDateHeader(dateField,projectDateColumns[dateField])",context),/aria-sort="descending"/);
 }
 const exported=vm.runInContext('let exported;csv=(_filename,rows)=>{exported=rows;};exportLeads();exported;',context);
 assert.equal(exported[0][4],'Oplevering');assert.equal(exported[1][4],'2028-01-15');
});
