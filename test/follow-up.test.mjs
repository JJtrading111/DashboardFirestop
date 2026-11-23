import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState,getWorkspace,nextFollowUpAt,sortFollowUpLeads} from '../public/model.mjs';

test('follow-up dates use the earliest valid unfinished callback within the selected company',()=>{
 const state=createDemoState();
 const own=getWorkspace(state,'c-noord','l-01');
 own.callbacks=[
  {dueAt:'2026-11-25T12:00:00Z',done:false},
  {dueAt:'2026-11-20T12:00:00Z',done:true},
  {dueAt:'2026-11-24T12:00:00Z',done:false},
  {dueAt:'invalid',done:false}
 ];
 getWorkspace(state,'c-delta','l-01').callbacks=[{dueAt:'2026-11-19T12:00:00Z',done:false}];
 assert.equal(nextFollowUpAt(state,'c-noord','l-01'),'2026-11-24T12:00:00.000Z');
 assert.equal(nextFollowUpAt(state,'c-delta','l-01'),'2026-11-19T12:00:00.000Z');
 own.callbacks.forEach(c=>c.done=true);
 assert.equal(nextFollowUpAt(state,'c-noord','l-01'),null);
});

test('follow-up cards sort chronologically before undated cards without mutating other columns',()=>{
 const state=createDemoState(),leads=state.leads.slice(0,4);
 getWorkspace(state,'c-noord',leads[0].id).callbacks=[{dueAt:'2026-11-24T10:00:00+01:00',done:false}];
 getWorkspace(state,'c-noord',leads[1].id).callbacks=[{dueAt:'2026-11-24T09:30:00Z',done:false}];
 getWorkspace(state,'c-noord',leads[2].id).callbacks=[{dueAt:'2026-11-23T08:00:00Z',done:false}];
 getWorkspace(state,'c-noord',leads[3].id).callbacks=[{dueAt:'2026-11-21T08:00:00Z',done:true}];
 const original=leads.map(l=>l.id);
 assert.deepEqual(sortFollowUpLeads(state,'c-noord',leads).map(l=>l.id),[leads[2].id,leads[0].id,leads[1].id,leads[3].id]);
 assert.deepEqual(leads.map(l=>l.id),original);
 getWorkspace(state,'c-noord',leads[1].id).callbacks=[{dueAt:'2026-11-24T09:00:00Z',done:false}];
 assert.deepEqual(sortFollowUpLeads(state,'c-noord',leads).slice(1,3).map(l=>l.id),[leads[0].id,leads[1].id]);
});
