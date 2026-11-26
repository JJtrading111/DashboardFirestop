import test from 'node:test';
import assert from 'node:assert/strict';
import {isLeadVisibleToCompany,reportRows,callEligibility} from '../public/model.mjs';
import {buildCallReport} from '../public/call-report.mjs';

const HOUR=3600000,NOW=Date.parse('2026-11-26T10:00:00.000Z');
const workspace=extra=>({status:'nieuw',priority:'medium',ownerId:null,commitment:false,calculation:false,calls:[],notes:[],callbacks:[],...extra});
function fixture(){
 return {companies:[{id:'a',name:'Bedrijf A',columns:[{id:'nieuw',name:'Nieuw'}]},{id:'b',name:'Bedrijf B',columns:[{id:'nieuw',name:'Nieuw'}]}],
  users:[{id:'a1',name:'Verkoper A',companyId:'a',role:'verkoper',status:'actief'},{id:'a2',name:'Collega A',companyId:'a',role:'verkoper',status:'actief'},
   {id:'b1',name:'Verkoper B',companyId:'b',role:'verkoper',status:'actief'},{id:'b2',name:'Collega B',companyId:'b',role:'bedrijfsbeheerder',status:'actief'},
   {id:'chief',name:'Hoofdbeheerder',companyId:null,role:'hoofdbeheerder',status:'actief'}],
  leads:[{id:'lead',title:'Centraal project',source:'filter-a',sourceIds:['filter-a','filter-b'],createdAt:'2026-01-01T10:00:00.000Z'},
   {id:'other',title:'Ander project',source:'filter-a',createdAt:'2026-02-01T10:00:00.000Z'}],
  workspaces:{},callLog:[{id:'call-a',leadId:'lead',companyId:'a',userId:'a1',userName:'Verkoper A',at:new Date(NOW-HOUR).toISOString()}],settings:{cooldownHours:48},feed:[]};
}
const visible=(state,companyId,userId,now=NOW,leadId='lead')=>isLeadVisibleToCompany(state,leadId,companyId,userId,now);

test('a calling company and its colleagues retain the lead while other companies cannot see it without materializing workspaces',()=>{
 const state=fixture(),before=structuredClone(state);
 for(const userId of ['a1','a2'])assert.equal(visible(state,'a',userId),true);
 for(const userId of ['b1','b2'])assert.equal(visible(state,'b',userId),false);
 assert.equal(visible(state,'b','b1',NOW,'other'),true,'A different project is independent of the lock');
 assert.equal(visible(state,'b','chief'),false,'Chief workplace visibility still follows that company context');
 assert.equal(visible(state,'a','chief'),true);assert.deepEqual(state,before);
});

test('the exact cooldown boundary restores visibility and zero or negative configured durations never hide a lead',()=>{
 const state=fixture(),until=NOW-HOUR+48*HOUR;
 assert.equal(visible(state,'b','b1',until-1),false);assert.equal(visible(state,'b','b1',until),true);assert.equal(visible(state,'b','b1',until+1),true);
 for(const cooldownHours of [0,-1,'0']){state.settings.cooldownHours=cooldownHours;assert.equal(visible(state,'b','b1'),true);}
});

test('only the individual assignee of an open due callback can bypass a foreign company cooldown',()=>{
 const state=fixture();state.workspaces.b={lead:workspace({callbacks:[{id:'mine',assigneeId:'b1',dueAt:new Date(NOW).toISOString(),done:false}]})};
 const before=structuredClone(state);assert.equal(visible(state,'b','b1'),true);assert.equal(visible(state,'b','b2'),false);assert.deepEqual(state,before);
 state.workspaces.b.lead.callbacks[0].dueAt=new Date(NOW+1).toISOString();assert.equal(visible(state,'b','b1'),false);
 state.workspaces.b.lead.callbacks[0].dueAt=new Date(NOW-1).toISOString();state.workspaces.b.lead.callbacks[0].done=true;assert.equal(visible(state,'b','b1'),false);
 state.workspaces.b.lead.callbacks[0].done=false;state.workspaces.b.lead.callbacks[0].dueAt='invalid';assert.equal(visible(state,'b','b1'),false);
 state.workspaces.b.other=workspace({callbacks:[{assigneeId:'b1',dueAt:new Date(NOW-1).toISOString(),done:false}]});assert.equal(visible(state,'b','b1'),false);
});

test('latest call ownership and source overlaps use the central lead identity rather than its filter labels',()=>{
 const state=fixture();state.callLog.push({id:'call-b',leadId:'lead',companyId:'b',userId:'b2',at:new Date(NOW-1000).toISOString()});
 assert.equal(visible(state,'b','b1'),true);assert.equal(visible(state,'a','a1'),false);
 state.leads[0].source='filter-b';state.leads[0].sourceIds=['filter-a','filter-b','third-filter'];assert.equal(visible(state,'a','a1'),false);
 state.callLog.unshift({id:'older',leadId:'lead',companyId:'a',at:new Date(NOW-48*HOUR).toISOString()});assert.equal(visible(state,'a','a1'),false);
});

test('visibility matches existing calling permission for valid stored contacts without changing report state',()=>{
 const state=fixture();state.workspaces={a:{lead:workspace()},b:{lead:workspace({callbacks:[{assigneeId:'b2',dueAt:new Date(NOW-1000).toISOString(),done:false}]})}};
 const before=structuredClone(state);
 for(const companyId of ['a','b'])for(const user of state.users.filter(user=>user.companyId===companyId||user.role==='hoofdbeheerder')){
  assert.equal(visible(state,companyId,user.id),callEligibility(state,'lead',companyId,user.id,NOW).allowed);
 }
 assert.deepEqual(state,before);
});

test('unknown scope and malformed timestamps cannot expose a lead or create private state',()=>{
 const state=fixture(),before=structuredClone(state);
 for(const args of [['missing','b','b1'],['lead','missing','b1'],['lead','b','missing'],['lead','a','b1']])assert.equal(isLeadVisibleToCompany(state,...args,NOW),false);
 assert.equal(visible(state,'b','b1',NaN),false);assert.deepEqual(state,before);
 state.callLog.push({leadId:'lead',companyId:'b',at:'invalid'});assert.equal(visible(state,'b','b1'),false,'Malformed newer rows cannot defeat a valid lock');
 state.callLog=[{leadId:'lead',companyId:'a',at:'invalid'}];assert.equal(visible(state,'b','b1'),true);
});

test('temporary report-only lead metadata preserves exact conversion and calling reports across source, date, company and seller filters',()=>{
 const state=fixture(),call={id:'call-b-old',leadId:'lead',companyId:'b',userId:'b1',userName:'Naam bij bellen',at:'2026-11-25T10:00:00.000Z'};
 state.callLog.push(call);state.workspaces={a:{lead:workspace({ownerId:'a1',calls:[{...state.callLog[0]}],commitment:true})},
  b:{lead:workspace({ownerId:'b1',calls:[{...call}],commitment:true,calculation:true}),other:workspace({ownerId:'b2',calls:[]})}};
 const after=structuredClone(state),lead=after.leads[0];after.leads=after.leads.filter(item=>item.id!==lead.id);
 after.reportLeads=[{id:lead.id,source:lead.source,sourceIds:[...lead.sourceIds],createdAt:lead.createdAt}];
 for(const companyId of ['all','a','b'])for(const sellerId of ['all','a1','b1','b2'])for(const source of ['all','filter-a','filter-b'])for(const dates of [{},{from:'2026-01-01',to:'2026-01-01'},{from:'2026-02-01',to:'2026-12-31'}]){
  const options={companyId,sellerId,source,...dates};assert.deepEqual(reportRows(after,options),reportRows(state,options));
 }
 for(const companyId of ['all','a','b'])assert.deepEqual(buildCallReport(after,{companyId,now:NOW}),buildCallReport(state,{companyId,now:NOW}));
 assert.equal(after.leads.some(item=>item.id===lead.id),false);
});

test('active records override stale report metadata and repeated metadata never duplicates conversion results',()=>{
 const state=fixture();state.workspaces={a:{lead:workspace({ownerId:'a1',calls:[],commitment:true})}};
 const previous=reportRows(state);state.reportLeads=[{...state.leads[0],source:'stale-source'}, {...state.leads[0],source:'stale-source'}];
 assert.deepEqual(reportRows(state),previous);
 state.archivedLeads=[{id:'archive',source:'filter-b',createdAt:'2026-01-01T10:00:00Z'}];state.workspaces.a.archive=workspace({ownerId:'a1',calls:[],calculation:true});
 const withArchive=reportRows(state);state.reportLeads.push({id:'archive',source:'stale-source',createdAt:'2020-01-01T10:00:00Z'});assert.deepEqual(reportRows(state),withArchive);
});
