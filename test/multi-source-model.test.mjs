import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState,getWorkspace,leadSourceIds,leadMatchesSource,reportRows} from '../public/model.mjs';

test('overlapping filter memberships preserve unique company totals and exact source conversions',()=>{
 const state=createDemoState();state.leads=state.leads.slice(0,2);
 for(const lead of state.leads){lead.source='filter-a';lead.sourceIds=['filter-a'];lead.createdAt='2026-01-01T12:00:00.000Z';const w=getWorkspace(state,'c-noord',lead.id);w.ownerId='u-admin';w.calls=[];w.commitment=false;w.calculation=false;}
 state.leads[1].sourceIds=['filter-a','filter-b','filter-b'];getWorkspace(state,'c-noord',state.leads[1].id).commitment=true;
 assert.deepEqual(leadSourceIds(state.leads[1]),['filter-a','filter-b']);
 assert.equal(leadMatchesSource(state.leads[1],'filter-b'),true);assert.equal(leadMatchesSource(state.leads[0],'filter-b'),false);
 const all=reportRows(state,{companyId:'c-noord'}),onlyB=reportRows(state,{companyId:'c-noord',source:'filter-b'});
 assert.equal(all.reduce((n,row)=>n+row.total,0),2);assert.equal(all.reduce((n,row)=>n+row.commitments,0),1);
 assert.equal(all.filter(row=>row.sourceIds.includes('filter-b')).reduce((n,row)=>n+row.total,0),1,'Source chart membership must not include A-only leads');
 assert.equal(onlyB.reduce((n,row)=>n+row.total,0),1);assert.equal(onlyB[0].source,'filter-b');assert.equal(onlyB[0].conversion,100);
 assert.deepEqual(reportRows(state,{companyId:'c-noord',source:'filter-b',from:'2026-01-02'}),[]);
 state.sources.push({id:'filter-b',name:'Historisch filter',deleted:true});
 assert.equal(reportRows(state,{companyId:'c-noord',source:'filter-b'})[0].total,1,'Removing a filter must preserve historical report membership');
});

test('legacy single-source leads retain their source membership',()=>{
 assert.deepEqual(leadSourceIds({source:'bouw'}),['bouw']);
 assert.deepEqual(leadSourceIds({source:'bouw',sourceIds:[null,'','bouw','secondary']}),['bouw','secondary']);
 assert.equal(leadMatchesSource({source:'bouw'},'bouw'),true);
 assert.equal(leadMatchesSource({source:'bouw'},'all'),true);
});
