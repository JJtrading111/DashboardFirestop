import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdminOverview} from '../public/admin-overview.mjs';

const NOW=Date.parse('2026-11-25T12:00:00.000Z');
const base=()=>({
 companies:[{id:'a',name:'Alpha',columns:[{id:'fresh',name:'Te beoordelen'},{id:'working',name:'In gesprek'},{id:'done',name:'Opgeleverd'}]},
  {id:'b',name:'Beta',columns:[{id:'new',name:'Nieuw'},{id:'offer',name:'Aanbieding'}]},
  {id:'empty',name:'Zonder opvolging',columns:[{id:'new',name:'Nieuw'}]}],
 users:[{id:'seller',name:'Nieuwe naam',companyId:'b',status:'actief'},{id:'invited',name:'Uitgenodigd',companyId:'a',status:'uitgenodigd'},
  {id:'chief',name:'Hoofdbeheerder',companyId:null,status:'actief'}],
 leads:[{id:'one',title:'Gedeeld project',source:'bouw',sourceIds:['bouw','filter']},{id:'two',title:'Tweede project'},{id:'three',title:'Catalogusproject'}],
 workspaces:{a:{},b:{},empty:{}},feed:[],callLog:[]
});
const workspace=(extra={})=>({status:'fresh',priority:'medium',ownerId:null,commitment:false,calculation:false,notes:[],calls:[],callbacks:[],...extra});
const row=(data,id)=>data.companies.find(company=>company.id===id);

test('a company-selected contact remains real follow-up even after its transient newsfeed entry is gone',()=>{
 const state=base();state.workspaces.a.one=workspace({selectedContact:{name:'Gekozen aannemer',selectedAt:'2026-11-24T09:30:00Z',selectedByName:'Verkoper'}});
 const before=structuredClone(state),data=buildAdminOverview(state,{now:NOW});
 assert.equal(row(data,'a').workedLeads,1);assert.equal(row(data,'b').workedLeads,0);assert.equal(row(data,'a').lastActivityAt,'2026-11-24T09:30:00.000Z');assert.deepEqual(state,before);
});

test('company totals distinguish shared central inventory from actual company work and never materialize empty workspaces',()=>{
 const state=base();
 state.workspaces.a.one=workspace({status:'working',ownerId:'seller',commitment:true,commitmentAt:'2026-11-20T10:00:00Z'});
 state.workspaces.a.three=workspace(); // Created by viewing the central catalogue, not work.
 state.workspaces.b.one=workspace({status:'offer',calculation:true,calculationAt:'2026-11-25T10:00:00Z'});
 state.workspaces.empty.three=workspace({status:'new'});
 const before=structuredClone(state),data=buildAdminOverview(state,{now:NOW});
 assert.deepEqual(state,before);assert.equal(data.totals.centralLeads,3);assert.equal(data.totals.companyCount,3);
 assert.equal(data.totals.workedLeads,2);assert.equal(data.totals.activeUsers,1);
 assert.equal(data.totals.commitments,1);assert.equal(data.totals.calculations,1);
 assert.equal(row(data,'a').activeUsers,0,'Transferred staff do not erase old work or count as current staff');
 assert.equal(row(data,'b').activeUsers,1);assert.equal(row(data,'empty').workedLeads,0);
 assert.deepEqual(row(data,'a').columns,[{id:'fresh',name:'Te beoordelen',count:0},{id:'working',name:'In gesprek',count:1},{id:'done',name:'Opgeleverd',count:0}]);
 assert.deepEqual(row(data,'b').columns,[{id:'new',name:'Nieuw',count:0},{id:'offer',name:'Aanbieding',count:1}]);
 assert.equal(row(data,'empty').lastActivityAt,null);
 assert.equal(row(data,'a').lastActivityAt,'2026-11-20T10:00:00.000Z');
});

test('historical calls and notes retain their original company and actor snapshots while matching feed duplicates disappear',()=>{
 const state=base(),at='2026-11-25T10:00:00.000Z';
 state.workspaces.a.one=workspace({calls:[{id:'call1',at,userId:'seller',userName:'Oorspronkelijke naam',outcome:'reached',person:'Jan',detail:'Offerte besproken'}],
  notes:[{id:'note1',createdAt:at,authorId:'seller',authorName:'Oorspronkelijke naam',text:'De bestaande gespreksnotitie'}]});
 state.callLog=[{id:'call1',at,userId:'seller',userName:'Oorspronkelijke naam',companyId:'a',leadId:'one'},
  {id:'historical-only',at:'2026-11-24T10:00:00Z',userId:'removed',userName:'Voormalige collega',companyId:'b',leadId:'two'}];
 state.feed=[{id:'callfeed',companyId:'a',leadId:'one',type:'call',at:'2026-11-25T10:00:00.007Z',authorName:'Oorspronkelijke naam',text:'Oorspronkelijke naam heeft een belmoment geregistreerd.'},
  {id:'notefeed',companyId:'a',leadId:'one',type:'update',at,authorName:'Oorspronkelijke naam',text:'Gespreksnotitie toegevoegd: Gedeeld project'},
  {id:'new',companyId:null,leadId:'one',type:'new',at,authorName:'Bouwberichten',text:'Nieuwe centrale lead'},
  {id:'new',companyId:null,leadId:'one',type:'new',at,authorName:'Bouwberichten',text:'Nieuwe centrale lead'}];
 const data=buildAdminOverview(state,{now:NOW,period:'all'});
 assert.equal(data.totals.totalCalls,2);assert.equal(data.totals.notesCount,1);assert.equal(data.activity.filter(item=>item.type==='call').length,2);
 assert.equal(data.activity.filter(item=>item.type==='note').length,1);assert.equal(data.activity.filter(item=>item.type==='source').length,1);
 const call=data.activity.find(item=>item.type==='call'&&item.companyId==='a');assert.equal(call.actorName,'Oorspronkelijke naam');assert.equal(call.authorName,call.actorName);assert.equal(call.companyName,'Alpha');assert.match(call.detail,/Jan.*Offerte/);
 assert.equal(data.activity.find(item=>item.type==='call'&&item.companyId==='b').actorName,'Voormalige collega');
 assert.equal(row(data,'a').callsToday,1);assert.equal(row(data,'b').totalCalls,1);assert.equal(row(data,'b').workedLeads,1);
});

test('current attention uses unfinished callback due dates without inventing callback creation or completion events',()=>{
 const state=base();
 state.workspaces.a.one=workspace({priority:'high',callbacks:[
  {id:'older',dueAt:'2026-11-23T10:00:00Z',assigneeId:'removed',creatorName:'Maker toen'},
  {id:'newer',dueAt:'2026-11-25T11:00:00Z',assigneeId:'seller',creatorName:'Maker vandaag'},
  {id:'future',dueAt:'2026-12-01T10:00:00Z',assigneeId:'seller'},
  {id:'done',dueAt:'2026-11-20T10:00:00Z',done:true},
  {id:'bad-date',dueAt:'ongeldig'}]});
 state.feed=[{id:'complete',companyId:'a',leadId:'one',type:'followup',at:'2026-11-25T09:00:00Z',authorName:'Afhandelaar',text:'Terugbelafspraak afgehandeld: Gedeeld project'}];
 const data=buildAdminOverview(state,{now:NOW,period:'today'});
 assert.equal(row(data,'a').openCallbacks,3);assert.equal(row(data,'a').overdueCallbacks,2);assert.equal(row(data,'a').highPriorityUnassigned,1);
 assert.equal(data.attentionTotal,3);assert.deepEqual(data.attention.map(item=>item.type),['overdue','overdue','unassigned']);
 assert.equal(data.attention[0].creatorName,'Maker toen');assert.equal(data.attention[0].assigneeName,'Voormalige medewerker');assert.equal(data.attention[1].assigneeName,'Nieuwe naam');
 assert.equal(data.activityTotal,1);assert.equal(data.activity[0].type,'followup');assert.equal(data.activity[0].at,'2026-11-25T09:00:00.000Z');
 assert.equal(row(data,'a').lastActivityAt,'2026-11-25T09:00:00.000Z','An overdue/future appointment is not evidence of activity at that due time');
});

test('historical period and company/type filters do not change the global current company totals',()=>{
 const state=base();
 state.workspaces.a.one=workspace({contactName:'Bestaand contact',notes:[{id:'old',text:'Oude notitie',authorName:'Collega',createdAt:'2025-01-01T10:00:00Z'}]});
 state.workspaces.b.two=workspace({status:'new',commitment:true,commitmentAt:'2026-11-25T09:00:00Z',calculation:true,calculationAt:'2026-11-25T09:05:00Z'});
 state.feed=[{id:'central',companyId:null,at:'2026-11-25T10:00:00Z',text:'Bron bijgewerkt',authorName:'Beheerder'},
  {id:'status',companyId:'a',leadId:'one',at:'2026-11-24T10:00:00Z',text:'Opvolging bijgewerkt',authorName:'Collega'}];
 const global=buildAdminOverview(state,{now:NOW,period:'all'}),filtered=buildAdminOverview(state,{now:NOW,period:'today',companyId:'a',activityType:'note'});
 assert.deepEqual(filtered.totals,global.totals);assert.deepEqual(filtered.companies,global.companies);assert.equal(filtered.activityTotal,0);
 assert.equal(buildAdminOverview(state,{now:NOW,period:'all',companyId:'a',activityType:'note'}).activity[0].detail,'Oude notitie');
 const results=buildAdminOverview(state,{now:NOW,period:'today',companyId:'b',activityType:'result'});assert.equal(results.activityTotal,2);assert.ok(results.activity.every(item=>item.actorName===''));
 assert.equal(buildAdminOverview(state,{now:NOW,period:'all',companyId:'a'}).activity.some(item=>item.companyId===null),false);
 assert.equal(buildAdminOverview(state,{now:NOW,companyId:'missing'}).attentionTotal,0);
});

test('Amsterdam days and calendar periods remain correct at midnight and both daylight-saving transitions',()=>{
 for(const [now,inside,outside]of [
  ['2026-11-25T00:30:00Z',['2026-11-24T23:15:00Z'],'2026-11-24T22:59:00Z'],
  ['2026-03-29T21:30:00Z',['2026-03-28T23:30:00Z','2026-03-29T01:30:00Z'],'2026-03-28T22:59:00Z'],
  ['2026-10-25T21:30:00Z',['2026-10-25T00:30:00Z','2026-10-25T01:30:00Z'],'2026-10-24T21:59:00Z']
 ]){
  const state=base();state.workspaces.a.one=workspace({calls:[...inside.map((at,index)=>({id:'inside'+index,at,userName:'Collega'})),{id:'outside',at:outside,userName:'Collega'}]});
  const data=buildAdminOverview(state,{now:Date.parse(now),period:'today'});assert.equal(data.totals.callsToday,inside.length,now);assert.equal(data.activityTotal,inside.length,now);
 }
 const state=base();state.feed=[{id:'first',companyId:'a',at:'2026-11-18T23:00:00Z',text:'Eerste dag'},
  {id:'too-old',companyId:'a',at:'2026-11-18T22:59:00Z',text:'Ouder dan zeven kalenderdagen'}];
 assert.equal(buildAdminOverview(state,{now:NOW,period:'7d'}).activityTotal,1);
});

test('pagination is deterministic and bounded while invalid/future activity never becomes invented history',()=>{
 const state=base();state.workspaces.a.one=workspace({calculation:false,calculationAt:'2026-11-25T10:00:00Z'});
 state.feed=Array.from({length:505},(_,index)=>({id:String(index).padStart(3,'0'),companyId:'a',at:'2026-11-25T10:00:00Z',text:'Wijziging '+index,authorName:'Beheerder'}));
 state.feed.push({id:'invalid',companyId:'a',at:'morgen',text:'Geen geldige datum'},{id:'future',companyId:'a',at:'2099-01-01T10:00:00Z',text:'Nog niet gebeurd'});
 const data=buildAdminOverview(state,{now:NOW,limit:10});assert.equal(data.activity.length,10);assert.equal(data.activityTotal,505);assert.equal(data.activityLimited,true);assert.equal(data.hasMoreActivity,true);
 assert.deepEqual(data.activity,buildAdminOverview(state,{now:NOW,limit:10}).activity);assert.equal(buildAdminOverview(state,{now:NOW,limit:1000}).activity.length,500);
 assert.equal(data.totals.calculations,0);assert.equal(data.activity.some(item=>item.type==='result'),false);
 assert.equal(buildAdminOverview({}, {now:NOW}).totals.centralLeads,0);
});

test('retained action-only history and unusual old status remain visible without mutating frozen state',()=>{
 const state=base();state.workspaces.a.one=workspace({status:'removed-status'});state.workspaces.a.two=workspace();
 state.feed=[{id:'touch',companyId:'a',leadId:'two',at:'2026-11-25T11:00:00Z',text:'Opvolging bijgewerkt',authorName:'Collega'}];
 const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};freeze(state);
 const data=buildAdminOverview(state,{now:NOW});assert.equal(row(data,'a').workedLeads,2);assert.equal(row(data,'a').columns.find(column=>column.id==='__unknown').count,1);assert.equal(row(data,'a').columns[0].count,1);
});
