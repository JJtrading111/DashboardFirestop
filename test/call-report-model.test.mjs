import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCallReport} from '../public/call-report.mjs';

const NOW=Date.parse('2026-11-25T18:00:00Z');
const state=()=>({companies:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}],users:[
 {id:'s',name:'Huidige naam',companyId:'b',status:'actief'},
 {id:'zero',name:'Zonder gesprekken',companyId:'a',status:'actief'},
 {id:'invited',name:'Uitgenodigd',companyId:'a',status:'uitgenodigd'},
 {id:'chief',name:'Hoofdbeheerder',companyId:null,status:'actief'}],callLog:[],workspaces:{a:{},b:{}}});
const call=(id,at,extra={})=>({id,at,companyId:'a',leadId:'same-lead',userId:'s',userName:'Oude naam',...extra});

test('actual distinct call registrations count repeated calls to one lead once each and storage copies/outcome edits never multiply them',()=>{
 const s=state(),first=call('one','2026-11-25T09:00:00Z'),second=call('two','2026-11-25T10:00:00Z');
 s.callLog=[first,second,{...first}];
 s.workspaces.a['same-lead']={calls:[{...first,userName:'Verkeerd overschreven',outcome:'reached',detail:'Later aangevuld'},second,{id:'fallback',at:'2026-11-25T11:00:00Z',userId:'s',userName:'Oude naam'}]};
 const before=structuredClone(s),r=buildCallReport(s,{now:NOW});
 assert.deepEqual(s,before);assert.equal(r.error,'');assert.equal(r.totals.calls,3);assert.equal(r.totals.users,1);assert.equal(r.totals.companies,1);
 const seller=r.rows.find(row=>row.sellerId==='s');assert.equal(seller.total,3);assert.equal(seller.sellerName,'Oude naam');assert.deepEqual(seller.companyNames,['Alpha']);assert.equal(seller.periods['2026-11-25'],3);
 assert.equal(r.rows.find(row=>row.sellerId==='zero').total,0);assert.equal(r.rows.some(row=>row.sellerId==='invited'),false);
});

test('the same seller is grouped across original call companies after transfer, retaining real actor snapshots and removed-lead history',()=>{
 const s=state();s.callLog=[call('older','2026-11-24T10:00:00Z',{leadId:'removed-lead'}),call('newer','2026-11-25T10:00:00Z',{companyId:'b',userName:'Nieuwe snapshot'})];
 const all=buildCallReport(s,{now:NOW}),seller=all.rows.find(row=>row.sellerId==='s');
 assert.equal(seller.total,2);assert.equal(seller.sellerName,'Nieuwe snapshot');assert.deepEqual(seller.companyNames,['Alpha','Beta']);assert.equal(all.totals.users,1);assert.equal(all.totals.companies,2);
 const old=buildCallReport(s,{now:NOW,companyId:'a',sellerId:'s'});assert.equal(old.totals.calls,1);assert.equal(old.rows.length,1);assert.equal(old.rows[0].sellerName,'Oude naam');assert.deepEqual(old.rows[0].companyNames,['Alpha']);
 assert.equal(buildCallReport(s,{now:NOW,companyId:'b',sellerId:'zero'}).rows.length,0);
 assert.equal(buildCallReport(s,{now:NOW,companyId:'a'}).rows.find(row=>row.sellerId==='zero').total,0);
});

test('legacy anonymous callers use stable company-and-name identities without merging unrelated users',()=>{
 const s=state();s.callLog=[
  call('a-one','2026-11-25T10:00:00Z',{userId:null,userName:'Voormalige collega'}),
  call('a-two','2026-11-25T11:00:00Z',{userId:null,userName:'Andere collega'}),
  call('b-one','2026-11-25T12:00:00Z',{companyId:'b',userId:null,userName:'Voormalige collega'})];
 const r=buildCallReport(s,{now:NOW}),counted=r.rows.filter(row=>row.total>0);
 assert.equal(r.totals.calls,3);assert.equal(r.totals.users,3);assert.equal(new Set(counted.map(row=>row.sellerId)).size,3);
 const chosen=counted.find(row=>row.companyNames[0]==='Alpha'&&row.sellerName==='Voormalige collega');
 assert.equal(buildCallReport(s,{now:NOW,sellerId:chosen.sellerId}).totals.calls,1);
 assert.deepEqual(buildCallReport(s,{now:NOW}).rows,r.rows);
});

test('day, month and ISO-week buckets use Amsterdam civil dates and the ISO week-year across New Year',()=>{
 const s=state();s.callLog=[call('jan-one','2020-12-31T23:30:00Z'),call('jan-four','2021-01-04T12:00:00Z')];
 const day=buildCallReport(s,{now:NOW,groupBy:'day'});assert.deepEqual(day.periods.map(period=>period.key),['2021-01-01','2021-01-04']);
 const week=buildCallReport(s,{now:NOW,groupBy:'week'});assert.deepEqual(week.periods.map(period=>period.key),['2020-W53','2021-W01']);
 assert.deepEqual(week.periods[0],{key:'2020-W53',label:'Week 53 · 2020',start:'2020-12-28',end:'2021-01-03'});
 const month=buildCallReport(s,{now:NOW,groupBy:'month'});assert.equal(month.periods.length,1);assert.deepEqual(month.periods[0],{key:'2021-01',label:'januari 2021',start:'2021-01-01',end:'2021-01-31'});assert.equal(month.totals.byPeriod['2021-01'],2);
});

test('both daylight-saving transitions retain distinct registrations in the correct local day',()=>{
 const s=state();s.callLog=[
  call('spring-midnight','2026-03-28T23:30:00Z'),call('spring-gap','2026-03-29T01:30:00Z'),
  call('fold-first','2026-10-25T00:30:00Z'),call('fold-second','2026-10-25T01:30:00Z')];
 const r=buildCallReport(s,{now:NOW});assert.equal(r.totals.calls,4);assert.deepEqual(r.totals.byPeriod,{'2026-03-29':2,'2026-10-25':2});
});

test('inclusive civil-date filtering rejects future and invalid calls while filtering after canonical identity selection',()=>{
 const s=state();s.callLog=[call('start','2026-11-24T23:00:00Z'),call('inside','2026-11-25T17:59:00Z'),call('future','2026-11-25T19:00:00Z'),call('outside','2026-11-25T23:00:00Z'),call('bad','niet-geldig'),call('foreign','2026-11-25T10:00:00Z',{companyId:'not-in-scope'})];
 s.workspaces.b.copy={calls:[call('start','2026-11-25T10:00:00Z',{companyId:'b'})]};
 const r=buildCallReport(s,{now:NOW,from:'2026-11-25',to:'2026-11-25'});assert.equal(r.totals.calls,2);assert.deepEqual(r.totals.byPeriod,{'2026-11-25':2});
 assert.equal(buildCallReport(s,{now:NOW,companyId:'b'}).totals.calls,0,'A copied call ID cannot migrate to the other company just because a filter excludes its authoritative record');
});

test('explicit date windows show zero-call periods and active zero-call users without inflating caller totals',()=>{
 const s=state();
 const days=buildCallReport(s,{now:NOW,companyId:'a',from:'2026-11-23',to:'2026-11-25'});
 assert.equal(days.periods.length,3);assert.deepEqual(days.rows.map(row=>row.sellerId),['zero']);assert.equal(days.rows[0].total,0);assert.deepEqual(days.rows[0].periods,{'2026-11-23':0,'2026-11-24':0,'2026-11-25':0});assert.equal(days.totals.users,0);assert.equal(days.totals.companies,0);
 assert.equal(buildCallReport(s,{now:NOW,groupBy:'week',from:'2026-01-01',to:'2026-01-10'}).periods.length,2);
 assert.equal(buildCallReport(s,{now:NOW,groupBy:'month',from:'2026-11-25',to:'2026-12-02'}).periods.length,2);
 s.callLog=[call('old','2020-01-01T10:00:00Z'),call('new','2026-11-25T10:00:00Z')];assert.equal(buildCallReport(s,{now:NOW}).periods.length,2,'Unbounded history contains observed buckets without inventing years of empty columns');
});

test('invalid and inverted ranges return safe empty data and valid extreme date windows do not throw',()=>{
 for(const options of [{from:'2026-02-30'},{to:'morgen'},{from:null},{from:'2026-11-25',to:'2026-11-24'},{groupBy:'hour'},{now:'ongeldig'},{from:'2000-01-01',to:'2026-11-25'}]){
  const r=buildCallReport(state(),{now:NOW,...options});assert.ok(r.error);assert.deepEqual(r.rows,[]);assert.deepEqual(r.periods,[]);assert.deepEqual(r.totals,{calls:0,users:0,companies:0,byPeriod:{}});
 }
 for(const groupBy of ['day','week','month'])for(const date of ['0001-01-01','9999-12-31'])assert.equal(buildCallReport(state(),{now:NOW,groupBy,from:date,to:date}).error,'');
});

test('workspace fallback with missing IDs deduplicates its central copy and scoped company maps exclude foreign historical data',()=>{
 const s=state();s.companies=[{id:'a',name:'Alpha'}];s.callLog=[call(null,'2026-11-25T10:00:00Z'),call('foreign','2026-11-25T11:00:00Z',{companyId:'b',userName:'Privé naam'}),call('central-has-id','2026-11-25T12:00:00Z')];
 s.workspaces.a['same-lead']={calls:[call(null,'2026-11-25T10:00:00Z'),call(null,'2026-11-25T12:00:00Z')]};
 s.workspaces.b.private={calls:[call('foreign-workspace','2026-11-25T13:00:00Z',{companyId:'b',userName:'Privé naam'})]};
 const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};freeze(s);
 const r=buildCallReport(s,{now:NOW});assert.equal(r.totals.calls,2);assert.equal(JSON.stringify(r).includes('Privé naam'),false);assert.equal(r.rows.some(row=>row.sellerId==='s'&&row.total===0),false);
});
