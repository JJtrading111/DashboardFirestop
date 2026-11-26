import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../public/model.mjs';

const source=(await readFile(new URL('../public/app.mjs',import.meta.url),'utf8')).replace(/^import .*\r?\n/,'').replace(/^initialize\(\);\r?$/m,'');
const fields=['title','scheduleStart','scheduleEnd','source','priority','status','owner','followup'];
function fixture(){
 const date='2026-11-20T12:00:00.000Z';
 const leads=[
  {id:'a',title:'Project 10',organization:'Zorgbouw',city:'Zwolle',source:'z',projectDetails:{scheduleStart:'2027-03-20',scheduleEnd:'2028-12-01'}},
  {id:'b',title:'Project 2',organization:'Alfabouw',city:'Almere',source:'a',projectDetails:{scheduleStart:'2027-01-10',scheduleEnd:'2028-01-01'}},
  {id:'c',title:'Project 2',organization:'Betabouw',city:'Breda',source:'z',sourceIds:['z','a'],projectDetails:{}},
  {id:'d',title:'École',organization:'Schoolbouw',city:'Delft',source:'a',projectDetails:{scheduleStart:'onbekend',scheduleEnd:'onbekend'}}
 ].map(lead=>({...lead,tags:[],createdAt:date,updatedAt:date}));
 const state={users:[{id:'seller',name:'Verkoper',role:'verkoper',status:'actief',companyId:'company'},{id:'anna',name:'Anna',role:'verkoper',status:'actief',companyId:'company'},{id:'zoe',name:'Zoë',role:'verkoper',status:'actief',companyId:'company'}],companies:[{id:'company',name:'Testbedrijf',columns:[{id:'new',name:'Start'},{id:'follow',name:'Bellen'},{id:'done',name:'Gereed'}]},{id:'other',name:'Ander bedrijf',columns:[{id:'done',name:'Afgehandeld'},{id:'new',name:'Binnengekomen'},{id:'follow',name:'Later'}]}],leads,sources:[{id:'z',name:'Zulu'},{id:'a',name:'Alpha'}],workspaces:{},settings:{cooldownHours:48},callLog:[],feed:[]};
 const values={a:{priority:'low',status:'done',ownerId:'zoe'},b:{priority:'high',status:'new',ownerId:'anna'},c:{priority:'medium',status:'follow',ownerId:null},d:{priority:'medium',status:'new',ownerId:'removed-user'}};
 for(const lead of leads)Object.assign(model.getWorkspace(state,'company',lead.id),values[lead.id]);
 const listeners=new Map(),focus=[];
 const context=vm.createContext({...model,URL,URLSearchParams,initialState:state,scrollX:0,scrollY:0,document:{querySelector:()=>null,addEventListener:(type,listener)=>listeners.set(type,listener),getElementById:id=>({focus:()=>focus.push(id)})},window:{addEventListener(){},scrollTo(){}},location:{hash:'#leads'},localStorage:{getItem:()=>null},setInterval:()=>0});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run("state=initialState;ui.companyId='company';ui.userId='seller';ui.route='leads';render=()=>{};");
 const order=(field,direction='asc')=>{context.sortField=field;context.sortDirection=direction;return run('ui.projectDateSort={field:sortField,direction:sortDirection};filteredLeads().map(lead=>lead.id).join(",")');};
 async function click(field,direction){
  const target={dataset:{action:'sort-project-date',id:field,value:direction},disabled:false,matches:()=>false,closest:selector=>selector==='[data-action],[data-route]'?target:null};
  await listeners.get('click')({target,preventDefault(){}});
 }
 return{state,context,run,order,click,focus};
}

test('project and source sorting uses Dutch natural order and all source labels',()=>{
 const f=fixture();
 assert.equal(f.order('title'),'d,b,c,a');
 assert.equal(f.order('title','desc'),'a,c,b,d');
 assert.equal(f.order('source'),'d,b,c,a');
 assert.equal(f.order('source','desc'),'a,c,d,b');
 f.state.sources.find(source=>source.id==='z').name='Aardewerk';
 assert.equal(f.order('source').split(',')[0],'a','renamed source labels are read from the current state');
});

test('priority and Kanban sorting follows business order and selected company columns',()=>{
 const f=fixture();
 assert.equal(f.order('priority'),'b,d,c,a');
 assert.equal(f.order('priority','desc'),'a,d,c,b');
 assert.equal(f.order('status'),'d,b,c,a');
 assert.equal(f.order('status','desc'),'a,c,d,b');
 f.state.companies[0].columns.reverse();
 assert.equal(f.order('status'),'a,c,d,b','renamed/reordered company Kanban columns define status order');
 f.state.companies[0].columns[0].name='Klaar voor overdracht';
 assert.equal(f.order('status'),'a,c,d,b');
});

test('seller sorting keeps unassigned and missing users last in both directions',()=>{
 const f=fixture();
 assert.equal(f.order('owner'),'b,a,d,c');
 assert.equal(f.order('owner','desc'),'a,b,d,c');
 f.state.users.find(user=>user.id==='zoe').name='Aafke';
 assert.equal(f.order('owner'),'a,b,d,c','updated employee names affect sorting immediately');
});

test('both project date columns sort chronologically and keep unknown values last',()=>{
 const f=fixture();
 f.state.leads.find(lead=>lead.id==='d').projectDetails={scheduleStart:'2027-02-30',scheduleEnd:'2027-13-01'};
 for(const field of ['scheduleStart','scheduleEnd']){
  assert.equal(f.order(field),'b,a,d,c',field+' ascending');
  assert.equal(f.order(field,'desc'),'a,b,d,c',field+' descending');
 }
 const original=f.state.leads.map(lead=>lead.id).join(',');
 f.order('scheduleStart');assert.equal(f.state.leads.map(lead=>lead.id).join(','),original,'sorting never changes the stored lead inventory');
});

test('equal column values have a deterministic project/id tie-breaker',()=>{
 const f=fixture();
 f.state.leads.reverse();
 for(const lead of f.state.leads){lead.title='Gelijk';lead.organization='Zelfde';lead.city='Utrecht';model.getWorkspace(f.state,'company',lead.id).priority='medium';}
 assert.equal(f.order('priority'),'a,b,c,d');
 assert.equal(f.order('priority','desc'),'a,b,c,d','ties do not jump when the chosen direction changes');
});

test('follow-up sorting puts a due personal callback before normally callable leads',()=>{
 const f=fixture();
 f.state.callLog.push({id:'call-c',leadId:'c',companyId:'other',at:new Date().toISOString(),userId:'foreign'});
 model.getWorkspace(f.state,'company','c').callbacks.push({id:'cb-c',assigneeId:'seller',dueAt:new Date(Date.now()-60000).toISOString(),done:false});
 assert.equal(f.order('followup'),'c,d,b,a');
 assert.equal(f.order('followup','desc'),'d,b,a,c');
 assert.equal(f.run("eligible(state.leads.find(lead=>lead.id==='c')).reason"),'callback');
});

test('the row sorter also orders a waiting state without exposing it through company lists',()=>{
 const f=fixture();
 for(const id of ['a','c'])f.state.callLog.push({id:'call-'+id,leadId:id,companyId:'other',at:new Date().toISOString(),userId:'foreign'});
 model.getWorkspace(f.state,'company','c').callbacks.push({id:'cb-c',assigneeId:'seller',dueAt:new Date(Date.now()-60000).toISOString(),done:false});
 assert.equal(f.run("sortLeadRows(state.leads,{field:'followup',direction:'asc'}).map(lead=>lead.id).join(',')"),'c,d,b,a');
 assert.equal(f.run("sortLeadRows(state.leads,{field:'followup',direction:'desc'}).map(lead=>lead.id).join(',')"),'a,d,b,c');
 assert.equal(f.order('followup').includes('a'),false,'normal company inventory still hides the foreign wait');
});

test('every data column has directional controls and an accessible selected sort state',()=>{
 const f=fixture();
 for(const field of fields){
  f.order(field,'desc');const html=f.run('leadTable(filteredLeads())');
  assert.ok(html.includes('id="sort-'+field+'-asc"'),field+' ascending button');
  assert.ok(html.includes('id="sort-'+field+'-desc"'),field+' descending button');
  assert.match(html,/aria-sort="descending"/);
  assert.ok(html.includes('data-id="'+field+'" data-value="desc" aria-pressed="true"'),field+' selected arrow');
 }
 assert.doesNotMatch(f.run('leadTable(filteredLeads(),true)'),/data-action="sort-project-date"/,'compact dashboard tables have no inactive sorting controls');
});

test('real sorting actions are idempotent and reject unknown fields or directions',async()=>{
 const f=fixture();
 for(const field of fields){
  await f.click(field,'asc');const first=f.run('filteredLeads().map(lead=>lead.id).join(",")');
  await f.click(field,'asc');assert.equal(f.run('filteredLeads().map(lead=>lead.id).join(",")'),first,field+' repeated ascending');
  assert.equal(f.run('ui.projectDateSort.field'),field);assert.equal(f.run('ui.projectDateSort.direction'),'asc');
  await f.click(field,'desc');await f.click(field,'desc');assert.equal(f.run('ui.projectDateSort.direction'),'desc');
 }
 const sort=f.run('JSON.stringify(ui.projectDateSort)');
 await f.click('__proto__','asc');await f.click('title','sideways');
 assert.equal(f.run('JSON.stringify(ui.projectDateSort)'),sort);
 assert.equal(f.focus.at(-1),'sort-followup-desc');
});

test('search, filters and export retain the selected table ordering, while Kanban keeps its own order',()=>{
 const f=fixture();f.order('title');
 assert.equal(f.run("ui.query='Project';filteredLeads().map(lead=>lead.id).join(',')"),'b,c,a');
 f.run("ui.priority='medium'");assert.equal(f.run("filteredLeads().map(lead=>lead.id).join(',')"),'c');
 f.run("ui.priority='all';ui.query='';csv=(_filename,rows)=>{globalThis.exported=rows;};exportLeads();");
 assert.equal(f.run('exported.slice(1).map(row=>row[0]).join(",")'),'École,Project 2,Project 2,Project 10');
 f.run("ui.route='calls'");assert.equal(f.run("filteredLeads().map(lead=>lead.id).join(',')"),'d,b,c,a');
 f.run("ui.route='kanban'");assert.equal(f.run("filteredLeads().map(lead=>lead.id).join(',')"),'b,d,c,a','Kanban retains its priority order rather than the table title sort');
 assert.equal(f.run('ui.projectDateSort.field'),'title');
});
