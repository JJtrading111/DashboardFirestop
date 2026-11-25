import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createScraperBroker} from '../scraper/broker.mjs';

const FILTER='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const LOGIN={username:'schedule@example.test',password:'Not-a-real-source-password'};
const key=Buffer.alloc(32,17).toString('base64url');
const iso=value=>new Date(value).toISOString();

function fixture(t,start='2026-11-24T09:00:30.000Z',{legacy}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let clock=Date.parse(start),broker;
 db.exec('CREATE TABLE source_import_credentials(source_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL)');
 const state={leads:[],sources:['a','b'].map(id=>({id,name:'Bron '+id,provider:'bouwberichten',filterUrl:FILTER,filterParameters:[['projects[filters][constructionPhase][]','Gegund']],importEnabled:true}))};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const options={db,readState:()=>state,transaction,encryptionKey:key,workerToken:'s'.repeat(43),now:()=>clock,
  fail:(status,message)=>{const error=Error(message);error.status=status;throw error;},
  importBatch:(_auth,payload)=>({counts:{created:payload.items.length,updated:0,unchanged:0}})};
 if(legacy)legacy(db);
 const restart=()=>broker=createScraperBroker(options);restart();
 const manage=(type,payload,id='a')=>transaction(()=>broker.manage(type,payload,id));
 const tick=value=>clock=typeof value==='number'?value:Date.parse(value);
 const config=id=>db.prepare('SELECT * FROM scraper_sources WHERE source_id=?').get(id);
 const summary=(id='a')=>broker.sourceSummary(id);
 const finish=job=>{
  broker.report(job.id,'progress',{leaseToken:job.leaseToken,processed:0,total:1});
  broker.report(job.id,'batch',{leaseToken:job.leaseToken,batch:0,items:[{externalId:'schedule-project-'+job.id,title:'Planningsproject'}]});
  broker.report(job.id,'finish',{leaseToken:job.leaseToken,processed:1,total:1});
 };
 const configure=(id='a',{proof=true}={})=>{
  manage('source.scraper.configure',LOGIN,id);
  if(proof){const {job}=broker.claim();assert.equal(job.sourceId,id);assert.equal(job.mode,'test');finish(job);}
 };
 const schedule=(time,enabled=true,id='a')=>manage('source.scraper.schedule',{enabled,...time===undefined?{}:{time}},id);
 const fullJobs=(id='a')=>db.prepare("SELECT * FROM scraper_jobs WHERE source_id=? AND mode='full' ORDER BY queued_at,rowid").all(id);
 return{db,state,manage,configure,schedule,summary,config,finish,tick,restart,fullJobs,get broker(){return broker;},get now(){return clock;}};
}

test('each source stores an independent HH:mm and returns its fixed Amsterdam time zone',t=>{
 const env=fixture(t);env.configure('a');env.configure('b');
 env.schedule('11:15',true,'a');env.schedule('16:45',true,'b');
 assert.equal(env.summary('a').scheduleTime,'11:15');assert.equal(env.summary('b').scheduleTime,'16:45');
 assert.equal(env.summary().scheduleTimeZone,'Europe/Amsterdam');
 assert.equal(env.summary('a').nextRunAt,'2026-11-24T10:15:00.000Z');assert.equal(env.summary('b').nextRunAt,'2026-11-24T15:45:00.000Z');
 const first={...env.config('a')};env.schedule('14:10',false,'b');
 assert.deepEqual({...env.config('a')},first);assert.equal(env.summary('b').scheduleTime,'14:10');assert.equal(env.summary('b').nextRunAt,null);assert.equal(env.summary('b').scheduleEnabled,false);
 env.restart();assert.equal(env.summary('b').scheduleTime,'14:10');assert.equal(env.summary('a').nextRunAt,'2026-11-24T10:15:00.000Z');
});

test('legacy boolean-only toggles use the stored local time and preserve the approximately 24-hour default',t=>{
 const env=fixture(t);env.configure();env.schedule(undefined);
 assert.equal(env.summary().scheduleTime,'10:00');assert.equal(env.summary().nextRunAt,'2026-11-25T09:00:00.000Z');
 assert(Date.parse(env.summary().nextRunAt)>env.now+23*3600000);
 env.schedule('15:20',false);env.schedule(undefined,true);
 assert.equal(env.summary().scheduleTime,'15:20');assert.equal(env.summary().nextRunAt,'2026-11-24T14:20:00.000Z');
});

test('saving a disabled clock time requires configured login but only enabling requires a successful proof and active import',t=>{
 const env=fixture(t);assert.equal(env.summary().scheduleTime,'06:00');
 assert.throws(()=>env.schedule('08:30',false),error=>error.status===409);
 env.configure('a',{proof:false});const proof=env.db.prepare("SELECT * FROM scraper_jobs WHERE source_id='a'").get();
 env.schedule('08:30',false);assert.equal(env.summary().scheduleTime,'08:30');assert.equal(env.summary().status,'queued');
 assert.deepEqual({...env.db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(proof.id)},{...proof});
 assert.throws(()=>env.schedule('08:30',true),error=>error.status===409);
 const job=env.broker.claim().job;env.finish(job);
 env.db.prepare("UPDATE source_import_credentials SET enabled=0 WHERE source_id='a'").run();
 env.schedule('09:15',false);assert.throws(()=>env.schedule('09:15',true),error=>error.status===409);
});

test('invalid times are rejected atomically even while disabling the schedule',t=>{
 const env=fixture(t);env.configure();env.schedule('13:00');
 const before={...env.config('a')},jobs=env.db.prepare('SELECT * FROM scraper_jobs ORDER BY id').all().map(row=>({...row}));
 for(const time of ['', '6:00','24:00','12:60','12:3','12:00:00',' 12:00','12:00 ','12:00\n','१२:००',null,12,{},[]])for(const enabled of [true,false]){
  assert.throws(()=>env.schedule(time,enabled),error=>error.status===400,JSON.stringify({time,enabled}));
  assert.deepEqual({...env.config('a')},before);assert.deepEqual(env.db.prepare('SELECT * FROM scraper_jobs ORDER BY id').all().map(row=>({...row})),jobs);
 }
 assert.throws(()=>env.manage('source.scraper.schedule',{enabled:'true',time:'12:00'}),error=>error.status===400);
 assert.deepEqual({...env.config('a')},before);
});

test('normal winter and summer clock times resolve to the correct UTC instants, including midnight',t=>{
 const env=fixture(t,'2026-01-10T06:00:00.000Z');env.configure();env.schedule('08:30');assert.equal(env.summary().nextRunAt,'2026-01-10T07:30:00.000Z');
 env.tick('2026-07-10T06:00:00.000Z');env.schedule('08:30');assert.equal(env.summary().nextRunAt,'2026-07-10T06:30:00.000Z');
 env.tick('2026-11-24T22:59:30.000Z');env.schedule('00:00');assert.equal(env.summary().nextRunAt,'2026-11-24T23:00:00.000Z');
 env.tick('2026-11-24T23:00:00.000Z');env.schedule('00:00');assert.equal(env.summary().nextRunAt,'2026-11-25T23:00:00.000Z','Scheduling at the exact minute chooses a strictly future occurrence');
});

test('daily claims keep 08:30 local across both DST boundaries rather than adding 24 hours',t=>{
 const env=fixture(t,'2026-03-27T06:00:00.000Z');env.configure();env.schedule('08:30');
 for(const [due,next]of [
  ['2026-03-27T07:30:00.000Z','2026-03-28T07:30:00.000Z'],
  ['2026-03-28T07:30:00.000Z','2026-03-29T06:30:00.000Z'],
  ['2026-03-29T06:30:00.000Z','2026-03-30T06:30:00.000Z']
 ]){env.tick(due);const job=env.broker.claim().job;assert.equal(job.mode,'full');assert.equal(env.summary().nextRunAt,next);env.finish(job);}
 env.tick('2026-10-24T05:00:00.000Z');env.schedule('08:30');assert.equal(env.summary().nextRunAt,'2026-10-24T06:30:00.000Z');
 env.tick('2026-10-24T06:30:00.000Z');env.finish(env.broker.claim().job);assert.equal(env.summary().nextRunAt,'2026-10-25T07:30:00.000Z');
 env.tick('2026-10-25T07:30:00.000Z');env.finish(env.broker.claim().job);assert.equal(env.summary().nextRunAt,'2026-10-26T07:30:00.000Z');
 assert.equal(env.summary().scheduleTime,'08:30');
});

test('a nonexistent spring 02:30 runs at 03:30 that day and returns to 02:30 the next day',t=>{
 const env=fixture(t,'2026-03-28T12:00:00.000Z');env.configure();env.schedule('02:30');
 assert.equal(env.summary().nextRunAt,'2026-03-29T01:30:00.000Z');
 env.tick(env.summary().nextRunAt);const job=env.broker.claim().job;assert.equal(job.mode,'full');env.finish(job);
 assert.equal(env.summary().nextRunAt,'2026-03-30T00:30:00.000Z');assert.equal(env.summary().scheduleTime,'02:30');
});

test('the fall repeated 02:30 queues only one daily job and disabling or re-enabling cannot create the second occurrence',t=>{
 const env=fixture(t,'2026-10-24T12:00:00.000Z');env.configure();env.schedule('02:30');
 assert.equal(env.summary().nextRunAt,'2026-10-25T00:30:00.000Z');
 env.tick(env.summary().nextRunAt);const job=env.broker.claim().job;env.finish(job);
 assert.equal(env.config('a').last_schedule_day,'2026-10-25');assert.equal(env.summary().nextRunAt,'2026-10-26T01:30:00.000Z');
 env.tick('2026-10-25T00:45:00.000Z');env.schedule(undefined,false);env.schedule('02:30',true);
 assert.equal(env.summary().nextRunAt,'2026-10-26T01:30:00.000Z');
 env.tick('2026-10-25T01:30:00.000Z');assert.equal(env.broker.claim().job,null);assert.equal(env.fullJobs().length,1);
 env.restart();assert.equal(env.config('a').last_schedule_day,'2026-10-25');assert.equal(env.summary().scheduleTime,'02:30');
});

test('if nothing ran on the fall date yet, a newly configured 02:30 uses the earliest still-future repeated occurrence',t=>{
 const env=fixture(t,'2026-10-25T00:45:00.000Z');env.configure();env.schedule('02:30');
 assert.equal(env.summary().nextRunAt,'2026-10-25T01:30:00.000Z');assert.equal(env.config('a').last_schedule_day,null);
 env.tick(env.summary().nextRunAt);env.finish(env.broker.claim().job);assert.equal(env.summary().nextRunAt,'2026-10-26T01:30:00.000Z');
});

test('coming online after missed dates queues one catch-up and plans a future local day without a backlog',t=>{
 const env=fixture(t);env.configure();env.schedule('18:00');
 env.tick('2026-11-28T11:00:00.000Z');const job=env.broker.claim().job;assert.equal(job.mode,'full');
 assert.equal(env.summary().nextRunAt,'2026-11-29T17:00:00.000Z');assert.equal(env.broker.claim().job,null);env.finish(job);
 assert.equal(env.broker.claim().job,null);assert.equal(env.fullJobs().length,1);
});

test('an existing active job is neither duplicated nor changed when its daily time arrives or its clock setting is edited',t=>{
 const env=fixture(t,'2026-11-24T09:00:00.000Z');env.configure();env.schedule('11:00');
 env.manage('source.scraper.run',{});const job=env.broker.claim().job;
 const before={...env.db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(job.id)};
 env.schedule('11:00');assert.deepEqual({...env.db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(job.id)},before);
 env.tick('2026-11-24T10:00:00.000Z');assert.equal(env.broker.claim().job,null);
 assert.deepEqual({...env.db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(job.id)},before);
 assert.equal(env.fullJobs().length,1);assert.equal(env.summary().nextRunAt,'2026-11-25T10:00:00.000Z');
 env.schedule('16:00');assert.equal(env.summary().nextRunAt,'2026-11-25T15:00:00.000Z');
 assert.deepEqual({...env.db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(job.id)},before);
});

test('old SQLite rows migrate without moving their first run or changing active scheduling and source history',t=>{
 const next=Date.parse('2026-10-25T00:30:44.123Z');let original;
 const env=fixture(t,'2026-10-24T12:22:33.456Z',{legacy:db=>{
  db.exec(`CREATE TABLE scraper_sources(source_id TEXT PRIMARY KEY,username TEXT NOT NULL DEFAULT '',encrypted_login TEXT NOT NULL DEFAULT '',
   schedule_enabled INTEGER NOT NULL DEFAULT 0,next_run_at INTEGER,test_passed INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'not_configured',
   last_started_at INTEGER,last_finished_at INTEGER,counts_json TEXT,last_processed INTEGER NOT NULL DEFAULT 0,last_total INTEGER,last_error TEXT)`);
  db.prepare("INSERT INTO scraper_sources(source_id,username,encrypted_login,schedule_enabled,next_run_at,test_passed,status,last_started_at,last_processed,last_total) VALUES('a','legacy@example.test','encrypted-legacy-placeholder',1,?,1,'running',?,8,100)").run(next,Date.parse('2026-10-24T12:00:00.000Z'));
  db.prepare("INSERT INTO scraper_sources(source_id,status) VALUES('b','ready')").run();
  original={...db.prepare("SELECT * FROM scraper_sources WHERE source_id='a'").get()};
 }});
 const current={...env.config('a')};const {schedule_time,last_schedule_day,configuration_version,...legacyColumns}=current;
 assert.equal(configuration_version,0);
 assert.deepEqual(legacyColumns,original);assert.equal(schedule_time,'02:30');assert.equal(last_schedule_day,null);
 assert.equal(env.summary().nextRunAt,iso(next));assert.equal(env.summary().scheduleEnabled,true);assert.equal(env.summary().status,'running');
 assert.equal(env.summary('b').scheduleTime,'14:22');
 env.db.prepare("UPDATE scraper_sources SET last_schedule_day='2026-10-24' WHERE source_id='a'").run();env.restart();
 assert.equal(env.summary().nextRunAt,iso(next));assert.equal(env.config('a').last_schedule_day,'2026-10-24');assert.equal(env.summary().scheduleTime,'02:30');
});

test('reconnecting login retains the chosen daily clock and already-covered local date',t=>{
 const env=fixture(t);env.configure();env.schedule('11:00');env.tick('2026-11-24T10:00:00.000Z');env.finish(env.broker.claim().job);
 env.manage('source.scraper.configure',{...LOGIN,password:'Different-fake-source-password'});
 assert.equal(env.summary().scheduleTime,'11:00');assert.equal(env.config('a').last_schedule_day,'2026-11-24');
 assert.equal(env.summary().scheduleEnabled,false);assert.equal(env.summary().nextRunAt,null);assert.equal(env.summary().lastTestPassed,false);
});
