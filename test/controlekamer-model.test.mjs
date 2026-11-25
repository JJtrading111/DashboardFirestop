import test from 'node:test';
import assert from 'node:assert/strict';
import {buildControlekamer} from '../public/controlekamer-model.mjs';
import {buildCallReport} from '../public/call-report.mjs';

const NOW=Date.parse('2026-11-25T12:30:00.000Z');
const columns=()=>[{id:'nieuw',name:'Nieuw'},{id:'contact',name:'In contact'},{id:'opvolgen',name:'Opvolgen'}];
const workspace=extra=>({status:'nieuw',priority:'medium',ownerId:null,notes:[],calls:[],callbacks:[],...extra});
const note=(id,createdAt,authorId,text)=>({id,createdAt,authorId,authorName:'Naam bij '+authorId,text});
const move=(id,companyId,leadId,at)=>({id,companyId,leadId,at,type:'status',authorId:'u1',authorName:'Naam bij status',text:'Bestaande tekst',statusChange:{fromId:'nieuw',fromName:'Nieuw toen',toId:'opvolgen',toName:'Opvolgen toen'}});
function fixture(){
 const state={
  companies:[{id:'a',name:'Flamestop',color:'#000000',columns:columns()},{id:'b',name:'Flameguard',columns:columns()},{id:'c',name:'Flameseal',columns:columns()}],
  users:[{id:'u1',name:'Eerste gebruiker',companyId:'a',status:'actief'},{id:'u2',name:'Zonder belmoment',companyId:'a',status:'actief'},{id:'u3',name:'Derde gebruiker',companyId:'b',status:'actief'},{id:'u4',name:'Vierde gebruiker',companyId:'c',status:'actief'},
   {id:'chief',name:'Hoofdbeheerder',companyId:null,status:'actief'},{id:'old',name:'Inactieve gebruiker',companyId:'a',status:'inactief'},{id:'invite',name:'Uitgenodigde gebruiker',companyId:'c',status:'uitgenodigd'}],
  leads:[{id:'one',title:'Renovatie Noord'},{id:'two',title:'Woningen Zuid'},{id:'three',title:'Hotel West'},{id:'four',title:'VvE Oost'}],
  archivedLeads:[{id:'archived',title:'Verwijderd project',deletedAt:'2026-11-25T12:00:00Z'}],
  archivedCompanies:[{id:'archived-company',name:'Verwijderd bedrijf',columns:columns()}],
  callLog:[{id:'call1',companyId:'a',leadId:'one',userId:'u1',userName:'Naam bij bellen',at:'2026-11-25T09:00:00Z'},
   {id:'call2',companyId:'a',leadId:'one',userId:'u1',userName:'Naam bij bellen',at:'2026-11-25T10:00:00Z'},
   {id:'call3',companyId:'a',leadId:'archived',userId:'old',userName:'Oud teamlid toen',at:'2026-11-25T11:00:00Z'},
   {id:'call4',companyId:'b',leadId:'three',userId:'u3',userName:'Derde gebruiker',at:'2026-11-25T10:00:00Z'},
   {id:'old-company-call',companyId:'archived-company',leadId:'one',userId:'u1',at:'2026-11-25T10:00:00Z'}],
  workspaces:{a:{one:workspace({status:'opvolgen',ownerId:'u1',notes:[note('n1','2026-11-25T09:05:00Z','u1','Info per e-mail, morgen tb.')],callbacks:[{id:'due',dueAt:'2026-11-25T08:00:00Z',done:false}],calls:[{id:'call1',at:'2026-11-25T09:00:00Z',userId:'u1'},{id:'call2',at:'2026-11-25T10:00:00Z',userId:'u1'}]}),
    two:workspace({priority:'high',notes:[note('n2','2026-11-25T10:00:00Z','u2','Alles al geregeld.')]}),
    archived:workspace({priority:'high',notes:[note('n3','2026-11-25T11:00:00Z','old','Mail gestuurd.')],calls:[{id:'call3',userId:'old',at:'2026-11-25T11:00:00Z'}],callbacks:[{id:'archived-due',dueAt:'2026-11-25T08:00:00Z'}]})},
   b:{three:workspace({status:'contact',ownerId:'u3',notes:[note('n4','2026-11-25T10:30:00Z','u3','Morgen tb')],callbacks:[{id:'future',dueAt:'2026-12-01T10:00:00Z'}]})},
   c:{four:workspace({notes:[note('n5','2026-11-25T12:00:00Z','u4','Terugbellen na lunch')],callbacks:[{id:'done',dueAt:'2026-11-25T09:00:00Z',done:true}]})}},
  feed:[move('s1','a','one','2026-11-25T09:00:00Z'),move('s2','b','three','2026-11-25T10:30:00Z'),move('s3','a','archived','2026-11-25T11:00:00Z')],
  sources:[{id:'bouw',name:'Gegund',lastImportError:'Brontotaal gewijzigd.'},{id:'second',name:'Uitvoering',scraper:{status:'active'}},{id:'deleted-source',name:'Oude bron',deleted:true,lastImportError:'Niet tonen'}]
 };
 state.feed.push({...state.feed[0]}, {id:'generic',companyId:'a',leadId:'one',type:'update',at:'2026-11-25T11:00:00Z',text:'Kanban-status gewijzigd: oude algemene wijziging'},
  move('future-status','a','one','2026-11-25T14:00:00Z'),move('old-status','a','one','2026-11-24T10:00:00Z'));
 return state;
}
const count=(data,key)=>data.signals.find(signal=>signal.key===key).count;

test('control room derives exact real daily calls, notes and status and never mutates its state',()=>{
 const state=fixture(),before=structuredClone(state),data=buildControlekamer(state,{now:NOW});
 assert.deepEqual(data.kpis,{calls:4,notes:5,status:3,activeCallers:2,teamSize:4});assert.equal(data.today,'2026-11-25');assert.equal(data.currentHour,13);
 assert.deepEqual(data.companies.map(company=>[company.name,company.color,company.callsToday]),[['Flamestop','#E8590C',3],['Flameguard','#7C3AED',1],['Flameseal','#0F9F8F',0]]);
 assert.equal(data.kpis.calls,buildCallReport({...state,archivedCompanies:[]},{now:NOW,from:data.today,to:data.today}).totals.calls);
 assert.equal(data.team.filter(member=>member.eligible).length,4);assert.equal(data.team.find(member=>member.id==='old').eligible,false);assert.equal(data.team.find(member=>member.id==='old').callsToday,1);
 assert.equal(data.team.some(member=>member.id==='chief'),false);assert.equal(data.team.some(member=>member.id==='invite'),false);assert.equal(data.team.reduce((sum,member)=>sum+member.callsToday,0),4);
 assert.deepEqual(data.typeCounts,{all:8,note:5,status:3});assert.deepEqual(state,before);
});

test('every data component follows the company scope while central source messages appear only under all companies',()=>{
 const state=fixture(),a=buildControlekamer(state,{now:NOW,companyId:'a'}),c=buildControlekamer(state,{now:NOW,companyId:'c'});
 assert.deepEqual(a.kpis,{calls:3,notes:3,status:2,activeCallers:1,teamSize:2});assert.equal(a.selectedCompanies.length,1);assert.equal(a.companies.length,3);
 assert.deepEqual(a.typeCounts,{all:5,note:3,status:2});assert.equal(a.events.every(event=>event.companyId==='a'),true);assert.equal(a.hours.reduce((sum,hour)=>sum+hour.count,0),5);
 assert.equal(a.health.find(health=>health.key==='sources').visible,false);assert.equal(a.health.find(health=>health.key==='sources').status,'neutral');assert.equal(a.health.find(health=>health.key==='sources').count,null);assert.deepEqual(a.sourceErrors,[]);assert.equal(a.actions.some(action=>action.kind==='logbook'),false);
 assert.equal(a.actions.every(action=>action.companyId==='a'),true);assert.equal(a.pipeline.total,4);assert.equal(a.pipeline.newCount,3);assert.equal(a.pipeline.newWarning,false);
 assert.equal(c.kpis.calls,0);assert.equal(c.kpis.notes,1);assert.equal(c.pipeline.total,4);assert.equal(c.pipeline.newWarning,true);assert.equal(c.pipeline.newPercent,100);assert.match(c.pipeline.warning,/100%.*Nieuw/);
 assert.equal(c.health.find(health=>health.key==='followup').count,0);assert.equal(c.health.find(health=>health.key==='team').status,'warn');
 const all=buildControlekamer(state,{now:NOW});assert.equal(all.health.find(health=>health.key==='sources').count,1);assert.deepEqual(all.sourceErrors,[{id:'bouw',name:'Gegund',message:'Brontotaal gewijzigd.'}]);
});

test('canonical call semantics match the existing report across legacy duplicates, unknown leads and transferred users',()=>{
 const state=fixture();state.users.find(user=>user.id==='u1').companyId='b';
 state.workspaces.a.one.calls.push({at:'2026-11-25T09:00:00Z',userId:'u1'},{id:'workspace-only',at:'2026-11-25T11:30:00Z',userId:'u2',userName:'Tweede toen'});
 state.callLog.push({id:'call1',companyId:'b',leadId:'three',at:'2026-11-25T11:00:00Z',userId:'u3'},
  {id:'unknown-lead',companyId:'a',leadId:'not-in-state',at:'2026-11-25T12:00:00Z',userId:'former',userName:'Voormalig'});
 for(const companyId of ['all','a','b','c']){
  const data=buildControlekamer(state,{now:NOW,companyId}),report=buildCallReport({...state,archivedCompanies:[]},{now:NOW,companyId,from:data.today,to:data.today});
  assert.equal(data.kpis.calls,report.totals.calls);assert.equal(data.team.reduce((sum,member)=>sum+member.callsToday,0),report.totals.calls);
 }
 const a=buildControlekamer(state,{now:NOW,companyId:'a'});assert.equal(a.kpis.teamSize,1);assert.equal(a.kpis.activeCallers,1);assert.equal(a.team.find(member=>member.id==='u1').eligible,false);assert.equal(a.team.find(member=>member.id==='u1').callsToday,2);
 const b=buildControlekamer(state,{now:NOW,companyId:'b'});assert.equal(b.kpis.teamSize,2);assert.equal(b.team.find(member=>member.id==='u1').callsToday,0);assert.equal(b.kpis.activeCallers,1);
});

test('actions derive real appointments, owners, textual prompts, zero callers and default columns without reopening archived leads',()=>{
 const data=buildControlekamer(fixture(),{now:NOW}),health=data.health.find(item=>item.key==='followup');
 assert.equal(health.overdue,1);assert.equal(health.unassigned,1);assert.equal(health.count,2);assert.equal(health.status,'warn');
 assert.equal(data.actions.filter(action=>action.kind==='logbook').length,1);assert.equal(data.actions.find(action=>action.kind==='callbacks').companyId,'a');
 const priority=data.actions.find(action=>action.kind==='lead');assert.equal(priority.leadId,'two');assert.equal(priority.count,1);
 const prompt=data.actions.find(action=>action.kind==='callback');assert.equal(prompt.leadId,'four');assert.equal(prompt.companyId,'c');assert.equal(prompt.count,1);assert.match(prompt.title,/terugbelsignaal/);
 assert.equal(data.actions.find(action=>action.kind==='report').count,2);assert.equal(data.actions.filter(action=>action.kind==='kanban').length,3);
 assert.equal(data.actions.find(action=>action.kind==='kanban'&&action.companyId==='a').columnId,'nieuw');assert.equal(data.actions.find(action=>action.kind==='kanban'&&action.companyId==='a').count,3);
 assert.equal(data.actions.some(action=>action.leadId==='archived'),false);
});

test('signals count matching notes once and do not treat text as confirmed mail, appointments or completed work',()=>{
 const data=buildControlekamer(fixture(),{now:NOW});assert.equal(count(data,'mail'),2);assert.equal(count(data,'callback'),3);assert.equal(count(data,'done'),1);
 assert.match(data.signals.find(signal=>signal.key==='done').text,/beoordeel/);assert.equal(data.actions.filter(action=>action.kind==='callback').reduce((sum,action)=>sum+action.count,0),1,'Existing appointments and archived leads suppress planning prompts but preserve textual counts');
 const state=fixture();state.workspaces.c.four.notes=[note('boundary','2026-11-25T12:00:00Z','u4','YouTube bevat letters, zonder terugbelverzoek.')];assert.equal(count(buildControlekamer(state,{now:NOW,companyId:'c'}),'callback'),0);
 state.workspaces.c.four.notes=[note('boundary','2026-11-25T12:00:00Z','u4','Twee maal tb en terug bellen.')];
 const scoped=buildControlekamer(state,{now:NOW,companyId:'c'});assert.equal(count(scoped,'callback'),1,'Each matching note counts once rather than each word occurrence');
 state.workspaces.c.four.notes=[note('mail-address','2026-11-25T12:00:00Z','u4','Het e-mailadres is doorgegeven.')];assert.equal(count(buildControlekamer(state,{now:NOW,companyId:'c'}),'mail'),1,'Dutch mail compounds remain literal textual signals');
});

test('timeline retains immutable author and column snapshots and all counts remain independent of the visible limit',()=>{
 const state=fixture(),data=buildControlekamer(state,{now:NOW,type:'note',limit:2});assert.equal(data.timeline.items.length,2);assert.equal(data.timeline.total,5);assert.equal(data.timeline.hasMore,true);assert.equal(data.events.length,8);
 const archived=data.events.find(event=>event.type==='note'&&event.archivedLead);assert.equal(archived.leadId,null);assert.equal(archived.archivedLeadId,'archived');assert.equal(archived.actorName,'Naam bij old');assert.equal(archived.leadTitle,'Verwijderd project');
 const status=data.events.find(event=>event.id==='status:s1');assert.equal(status.actorName,'Naam bij status');assert.equal(status.text,'Nieuw toen → Opvolgen toen');assert.deepEqual(status.statusChange,{fromId:'nieuw',fromName:'Nieuw toen',toId:'opvolgen',toName:'Opvolgen toen'});
 state.feed.find(event=>event.id==='s1').statusChange.fromName='Later gewijzigd';assert.equal(status.statusChange.fromName,'Nieuw toen');
 const many=fixture();many.workspaces={a:{one:workspace({notes:Array.from({length:601},(_,index)=>note('many'+index,'2026-11-25T09:00:00Z','u1','Notitie '+index))})}};many.feed=[];
 const limited=buildControlekamer(many,{now:NOW,companyId:'a',limit:8}),all=buildControlekamer(many,{now:NOW,companyId:'a',limit:Number.MAX_SAFE_INTEGER});
 assert.equal(limited.kpis.notes,601);assert.equal(limited.events.length,601);assert.equal(limited.timeline.items.length,8);assert.equal(all.timeline.items.length,601);assert.equal(all.timeline.hasMore,false);
});

test('hourly activity counts only today notes and real status records from 08 through 17 in Dutch time',()=>{
 const data=buildControlekamer(fixture(),{now:NOW});assert.equal(data.hours.length,10);assert.deepEqual(data.hours.map(hour=>hour.hour),[8,9,10,11,12,13,14,15,16,17]);
 assert.equal(data.hours.find(hour=>hour.hour===10).count,2);assert.equal(data.hours.find(hour=>hour.hour===11).count,3);assert.equal(data.hours.find(hour=>hour.hour===12).count,2);assert.equal(data.hours.find(hour=>hour.hour===13).count,1);assert.equal(data.hours.find(hour=>hour.hour===13).current,true);
 assert.equal(data.hours.filter(hour=>hour.future).every(hour=>hour.hour>13&&hour.count===0),true);assert.equal(data.hours.reduce((sum,hour)=>sum+hour.count,0),8);
});

test('pipeline uses every active company-lead combination, respects renamed columns and never invents a Nieuw warning',()=>{
 const state=fixture(),before=structuredClone(state),data=buildControlekamer(state,{now:NOW});assert.equal(data.pipeline.total,12);assert.equal(data.pipeline.newCount,10);assert.equal(data.pipeline.newWarning,false);assert.match(data.pipeline.description,/dezelfde centrale lead/);assert.deepEqual(state,before);
 state.companies[2].columns[0].name='Nog beoordelen';const renamed=buildControlekamer(state,{now:NOW,companyId:'c'});assert.equal(renamed.pipeline.total,4);assert.equal(renamed.pipeline.columns[0].name,'Nog beoordelen');assert.equal(renamed.pipeline.newCount,0);assert.equal(renamed.pipeline.warning,null);assert.match(renamed.actions.find(action=>action.kind==='kanban').title,/Nog beoordelen/);
 state.workspaces.c.four.status='removed-column';const unknown=buildControlekamer(state,{now:NOW,companyId:'c'});assert.equal(unknown.pipeline.total,4);assert.equal(unknown.pipeline.columns.find(column=>column.name==='Onbekende status').count,1);
});

test('Dutch local days and hours remain correct around midnight and daylight saving transitions',()=>{
 for(const [now,at,day,hour]of [['2026-03-29T01:30:00Z','2026-03-28T23:30:00Z','2026-03-29',3],['2026-10-25T01:30:00Z','2026-10-24T22:30:00Z','2026-10-25',2],['2026-06-01T22:30:00Z','2026-06-01T22:15:00Z','2026-06-02',0]]){
  const state=fixture();state.callLog=[];state.feed=[];state.workspaces={a:{one:workspace({notes:[note('edge',at,'u1','Notitie rond daggrens')]})}};
  const data=buildControlekamer(state,{now,companyId:'a'});assert.equal(data.today,day);assert.equal(data.currentHour,hour);assert.equal(data.kpis.notes,1);assert.equal(data.events.length,1);
 }
});

test('empty and incomplete inventories show real zero or neutral states without fabricated companies or people',()=>{
 const state={companies:[],users:[{id:'chief',name:'Beheerder',status:'actief',companyId:null}],leads:[],workspaces:{},callLog:[],feed:[],sources:[]},before=structuredClone(state),data=buildControlekamer(state,{now:NOW,companyId:'gone'});
 assert.equal(data.companyId,'all');assert.deepEqual(data.companies,[]);assert.deepEqual(data.kpis,{calls:0,notes:0,status:0,activeCallers:0,teamSize:0});assert.equal(data.pipeline.total,0);assert.equal(data.pipeline.warning,null);assert.equal(data.health.find(item=>item.key==='team').status,'neutral');assert.equal(data.actions.length,0);assert.deepEqual(state,before);
});
