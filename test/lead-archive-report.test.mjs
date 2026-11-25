import test from 'node:test';
import assert from 'node:assert/strict';
import {reportRows,buildCallReport,buildAdminOverview} from '../public/model.mjs';

const NOW=Date.parse('2026-11-25T18:00:00Z');
const at='2026-11-25T09:00:00.000Z';
const workspace=extra=>({status:'offer',priority:'high',ownerId:'seller',commitment:true,calculation:true,commitmentAt:at,calculationAt:at,
 calls:[{id:'call-one',at,userId:'seller',userName:'Naam tijdens gesprek',outcome:'reached',person:'Jan',detail:'Calculatie besproken'}],
 notes:[{id:'note-one',text:'Deze historische notitie blijft beschikbaar.',authorId:'seller',authorName:'Naam bij notitie',createdAt:at}],
 callbacks:[{id:'open-one',dueAt:'2026-11-24T09:00:00Z',assigneeId:'seller',creatorId:'seller',creatorName:'Maker toen',done:false}],...extra});
const base=()=>({
 companies:[{id:'a',name:'Bedrijf Alpha',columns:[{id:'new',name:'Nieuw'},{id:'offer',name:'Offerte'}]},
  {id:'b',name:'Bedrijf Beta',columns:[{id:'new',name:'Nieuw'},{id:'offer',name:'Offerte'}]}],
 users:[{id:'seller',name:'Nieuwe gebruikersnaam',companyId:'b',role:'verkoper',status:'actief'},
  {id:'chief',name:'Hoofdbeheerder',companyId:null,role:'hoofdbeheerder',status:'actief'}],
 leads:[{id:'one',title:'Eerste project',source:'bouw',sourceIds:['bouw','gegund'],createdAt:'2026-01-12T10:00:00Z'},
  {id:'two',title:'Tweede project',source:'hotels',createdAt:'2026-11-01T10:00:00Z'}],
 workspaces:{a:{one:workspace(),two:workspace({calls:[],notes:[],callbacks:[],commitment:false,calculation:false})},b:{one:workspace({calls:[{id:'call-two',at,userId:'seller',userName:'Naam bij Beta'}],notes:[],callbacks:[]})}},
 callLog:[{id:'call-one',leadId:'one',companyId:'a',userId:'seller',userName:'Naam tijdens gesprek',at},
  {id:'call-two',leadId:'one',companyId:'b',userId:'seller',userName:'Naam bij Beta',at}],
 feed:[{id:'note-feed',companyId:'a',leadId:'one',type:'update',authorName:'Naam bij notitie',at,text:'Gespreksnotitie toegevoegd: Eerste project'},
  {id:'call-feed',companyId:'a',leadId:'one',type:'call',authorName:'Naam tijdens gesprek',at,text:'Belmoment geregistreerd'},
  {id:'status-feed',companyId:'a',leadId:'one',type:'status',authorId:'seller',authorName:'Maker status toen',at,text:'Kanban-status gewijzigd: Nieuw → Offerte · Eerste project',statusChange:{fromId:'new',fromName:'Nieuw',toId:'offer',toName:'Offerte'}}]
});
function archive(state,id){const index=state.leads.findIndex(lead=>lead.id===id),[lead]=state.leads.splice(index,1);(state.archivedLeads??=[]).push({...lead,deletedAt:'2026-11-25T12:00:00Z',deletedById:'chief',deletedByName:'Hoofdbeheerder',deletionReason:'Geen werkzaamheden'});}
const ordered=rows=>rows.toSorted((a,b)=>JSON.stringify([a.companyId,a.sellerId,a.source,a.sourceIds]).localeCompare(JSON.stringify([b.companyId,b.sellerId,b.source,b.sourceIds])));

test('global lead removal preserves exact conversion figures for companies, transferred sellers, overlapping sources and acquisition dates',()=>{
 const before=base(),after=structuredClone(before);archive(after,'one');
 for(const options of [{},{companyId:'a'},{companyId:'b',sellerId:'seller'},{source:'bouw'},{source:'gegund'},{source:'hotels'},
  {from:'2026-01-01',to:'2026-02-01'},{from:'2026-11-01',to:'2026-11-30'},{companyId:'a',source:'gegund',sellerId:'seller',from:'2026-01-12',to:'2026-01-12'}]){
  assert.deepEqual(ordered(reportRows(after,options)),ordered(reportRows(before,options)),JSON.stringify(options));
 }
 const all=reportRows(after);assert.equal(all.reduce((sum,row)=>sum+row.total,0),3,'An overlapping source does not duplicate a project within a company');
 assert.equal(all.find(row=>row.companyId==='a'&&row.source==='bouw').sellerName,'Naam tijdens gesprek');
 const snapshot=structuredClone(after);reportRows(after);assert.deepEqual(after,snapshot);
});

test('conversion reports retain removed leads even with no active companies or leads, and active copies take precedence without duplicate counting',()=>{
 const state=base();archive(state,'one');archive(state,'two');state.archivedCompanies=state.companies;state.companies=[];
 const before=structuredClone(state),rows=reportRows(state);assert.equal(rows.reduce((sum,row)=>sum+row.total,0),3);assert.equal(rows.reduce((sum,row)=>sum+row.commitments,0),2);
 assert.equal(reportRows(state,{companyId:'a',source:'gegund'})[0].companyName,'Bedrijf Alpha');assert.deepEqual(state,before);
 const minimal={...state,archivedLeads:state.archivedLeads.map(({id,source,sourceIds,createdAt})=>({id,source,sourceIds,createdAt}))};
 assert.deepEqual(reportRows(minimal),rows,'A company-scoped minimal archived lead still provides complete report dimensions');
 state.leads=[{...state.archivedLeads[0],source:'active-source',sourceIds:['active-source']}];
 assert.equal(reportRows(state).reduce((sum,row)=>sum+row.total,0),3);assert.equal(reportRows(state,{source:'bouw'}).length,0);assert.equal(reportRows(state,{source:'active-source'}).length,2);
});

test('call reports remain unchanged for day, week, month and original companies after leads and companies are removed',()=>{
 const before=base(),after=structuredClone(before);archive(after,'one');archive(after,'two');after.archivedCompanies=[after.companies.pop()];
 for(const groupBy of ['day','week','month'])for(const filters of [{},{companyId:'a'},{companyId:'b',sellerId:'seller'},{from:'2026-11-25',to:'2026-11-25'}]){
  const options={now:NOW,groupBy,...filters};assert.deepEqual(buildCallReport(after,options),buildCallReport(before,options));
 }
});

test('the chief overview retains historical calls, results, notes and status snapshots but removes archived leads from active work and attention',()=>{
 const before=base();before.workspaces.b.one.ownerId=null;
 const previous=buildAdminOverview(before,{now:NOW,period:'all'}),after=structuredClone(before);archive(after,'one');
 const snapshot=structuredClone(after),data=buildAdminOverview(after,{now:NOW,period:'all'});
 assert.equal(data.totals.centralLeads,1);assert.equal(data.totals.totalCalls,previous.totals.totalCalls);assert.equal(data.totals.callsToday,previous.totals.callsToday);assert.equal(data.totals.callsThisWeek,previous.totals.callsThisWeek);
 assert.equal(data.totals.commitments,previous.totals.commitments);assert.equal(data.totals.calculations,previous.totals.calculations);assert.equal(data.totals.notesCount,previous.totals.notesCount);
 assert.equal(data.totals.openCallbacks,0);assert.equal(data.totals.overdueCallbacks,0);assert.equal(data.totals.highPriorityUnassigned,0);assert.equal(data.attentionTotal,0);
 assert.equal(data.companies.find(row=>row.id==='a').workedLeads,1);assert.equal(data.companies.find(row=>row.id==='b').workedLeads,0);
 assert.equal(data.companies.find(row=>row.id==='a').columns.reduce((sum,column)=>sum+column.count,0),1);assert.equal(data.companies.find(row=>row.id==='b').columns.reduce((sum,column)=>sum+column.count,0),0);
 const calls=data.activity.filter(item=>item.type==='call'),notes=data.activity.filter(item=>item.type==='note'),status=data.activity.find(item=>item.type==='status');
 assert.equal(calls.length,2);assert.equal(notes.length,1,'The matching feed event does not duplicate the archived workspace note');
 assert.equal(notes[0].detail,'Deze historische notitie blijft beschikbaar.');assert.equal(notes[0].actorName,'Naam bij notitie');assert.equal(status.actorName,'Maker status toen');assert.equal(status.statusChange.fromName,'Nieuw');assert.equal(status.statusChange.toName,'Offerte');
 for(const item of [...calls,...notes,status]){assert.equal(item.leadId,null,'Historical activity must not reopen a removed lead');assert.equal(item.archivedLead,true);assert.equal(item.archivedLeadId,'one');assert.equal(item.leadTitle,'Eerste project');}
 assert.equal(data.totals.callsToday,buildCallReport(after,{now:NOW,from:data.today,to:data.today}).totals.calls);assert.deepEqual(after,snapshot);
});

test('archived history keeps notes/status filter and company filters while all active inventory may be empty',()=>{
 const state=base();archive(state,'one');archive(state,'two');
 const data=buildAdminOverview(state,{now:NOW,period:'all',companyId:'a',activityType:'notes-status'});
 assert.equal(data.totals.centralLeads,0);assert.equal(data.totals.workedLeads,0);assert.equal(data.attentionTotal,0);assert.equal(data.activityTotal,2);
 assert.deepEqual(new Set(data.activity.map(item=>item.type)),new Set(['note','status']));assert.equal(data.totals.totalCalls,2);
 assert.equal(data.companies.every(row=>row.columns.every(column=>column.count===0)),true);
});
