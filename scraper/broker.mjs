import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';

const DAY=86400000,LEASE=75*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const date=value=>value?new Date(value).toISOString():null;
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const SCHEDULE_ZONE='Europe/Amsterdam',DEFAULT_SCHEDULE_TIME='06:00';
const validScheduleTime=value=>typeof value==='string'&&value.length===5&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const scheduleFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:SCHEDULE_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const localParts=instant=>Object.fromEntries(scheduleFormatter.formatToParts(instant).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
const localDay=instant=>{const p=localParts(instant);return`${p.year}-${p.month}-${p.day}`;};
const localTime=instant=>{const p=localParts(instant);return`${p.hour}:${p.minute}`;};
const nextDay=day=>new Date(Date.parse(day+'T00:00:00.000Z')+DAY).toISOString().slice(0,10);
const localWall=instant=>{const p=localParts(instant);return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`);};
function dailyInstants(day,time){
 const wall=Date.parse(`${day}T${time}:00.000Z`);
 // Examine both offsets around the date, including both sides of a DST change.
 const offsets=new Set([-36,-12,12,36].map(hours=>{const sample=wall+hours*3600000;return localWall(sample)-sample;}));
 const candidates=[...offsets].map(offset=>wall-offset).sort((a,b)=>a-b);
 const exact=candidates.filter(instant=>localDay(instant)===day&&localTime(instant)===time);
 if(exact.length)return exact;
 // A nonexistent spring clock time moves forward by the size of the gap.
 const shifted=candidates.filter(instant=>localDay(instant)===day&&localWall(instant)>wall).sort((a,b)=>localWall(a)-localWall(b)||a-b);
 if(shifted.length)return[shifted[0]];
 throw Error('The daily scraper time could not be resolved.');
}
function nextDailyRun(time,after,alreadyScheduledDay){
 let day=localDay(after);
 for(let count=0;count<4;count++,day=nextDay(day)){
  if(day===alreadyScheduledDay)continue;
  const instant=dailyInstants(day,time).find(value=>value>after);if(instant!==undefined)return instant;
 }
 throw Error('The next daily scraper run could not be resolved.');
}

// The browser never receives the encryption key, password, or worker credential.
export function createScraperBroker({db,readState,importBatch,transaction,fail,encryptionKey='',workerToken='',now=Date.now}){
 let key;
 if(encryptionKey){key=Buffer.from(encryptionKey,'base64url');if(key.length!==32||key.toString('base64url')!==encryptionKey)throw Error('SCRAPER_ENCRYPTION_KEY must be 32 random bytes encoded as base64url.');}
 if(workerToken&&!/^[A-Za-z0-9_-]{43,128}$/.test(workerToken))throw Error('SCRAPER_WORKER_TOKEN must contain at least 43 URL-safe characters.');
 const available=!!key&&!!workerToken;
 db.exec(`CREATE TABLE IF NOT EXISTS scraper_sources(
  source_id TEXT PRIMARY KEY,username TEXT NOT NULL DEFAULT '',encrypted_login TEXT NOT NULL DEFAULT '',
  schedule_enabled INTEGER NOT NULL DEFAULT 0,next_run_at INTEGER,schedule_time TEXT NOT NULL DEFAULT '',last_schedule_day TEXT,test_passed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_configured',last_started_at INTEGER,last_finished_at INTEGER,
  counts_json TEXT,last_processed INTEGER NOT NULL DEFAULT 0,last_total INTEGER,last_error TEXT);
 CREATE TABLE IF NOT EXISTS scraper_jobs(
  id TEXT PRIMARY KEY,source_id TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,queued_at INTEGER NOT NULL,
  started_at INTEGER,finished_at INTEGER,lease_hash TEXT,lease_until INTEGER,processed INTEGER NOT NULL DEFAULT 0,total INTEGER,
  counts_json TEXT NOT NULL DEFAULT '{"created":0,"updated":0,"unchanged":0}');
 CREATE TABLE IF NOT EXISTS scraper_batches(job_id TEXT NOT NULL,batch INTEGER NOT NULL,payload_hash TEXT NOT NULL,
  counts_json TEXT NOT NULL,items_count INTEGER NOT NULL,PRIMARY KEY(job_id,batch));
 CREATE TABLE IF NOT EXISTS scraper_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS scraper_jobs_pending ON scraper_jobs(status,queued_at);`);
 const columns=new Set(db.prepare('PRAGMA table_info(scraper_sources)').all().map(column=>column.name));
 if(!columns.has('schedule_time'))db.exec("ALTER TABLE scraper_sources ADD COLUMN schedule_time TEXT NOT NULL DEFAULT ''");
 if(!columns.has('last_schedule_day'))db.exec('ALTER TABLE scraper_sources ADD COLUMN last_schedule_day TEXT');
 // Preserve every existing first run, deriving only its displayed local clock time.
 for(const cfg of db.prepare("SELECT source_id,next_run_at FROM scraper_sources WHERE schedule_time='' OR schedule_time IS NULL").all()){
  db.prepare('UPDATE scraper_sources SET schedule_time=? WHERE source_id=?').run(localTime(Number.isFinite(cfg.next_run_at)?cfg.next_run_at:now()),cfg.source_id);
 }
 const required=()=>{if(!available)fail(503,'Automatisch ophalen wordt nog voorbereid. Probeer het later opnieuw.');};
 const row=id=>db.prepare('SELECT * FROM scraper_sources WHERE source_id=?').get(id);
 const configuredTime=cfg=>validScheduleTime(cfg?.schedule_time)?cfg.schedule_time:cfg?localTime(Number.isFinite(cfg.next_run_at)?cfg.next_run_at:now()):DEFAULT_SCHEDULE_TIME;
 function encrypt(sourceId,login){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(sourceId));const bytes=Buffer.concat([cipher.update(JSON.stringify(login),'utf8'),cipher.final()]);return[iv,cipher.getAuthTag(),bytes].map(v=>v.toString('base64url')).join('.');}
 function decrypt(sourceId,value){try{const[iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url')),cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(sourceId));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));}catch{fail(409,'De opgeslagen bronaanmelding kan niet worden geopend. Verbind deze bron opnieuw.');}}
 function source(id){const s=readState().sources.find(s=>s.id===id&&!s.deleted);if(!s||s.provider!=='bouwberichten')fail(404,'Deze Bouwberichten-bron bestaat niet.');return s;}
 function usable(id){const s=source(id);if(!s.filterUrl||!s.filterParameters?.length)fail(400,'Sla eerst een expliciete Bouwberichten-filterlink bij deze bron op.');return s;}
 const active=id=>db.prepare("SELECT * FROM scraper_jobs WHERE source_id=? AND status IN ('queued','running') ORDER BY queued_at DESC LIMIT 1").get(id);
 function cancel(id){db.prepare("UPDATE scraper_jobs SET status='cancelled',finished_at=?,lease_hash=NULL WHERE source_id=? AND status IN ('queued','running')").run(now(),id);}
 function invalidate(id,{disconnect=false,message='De bron is gewijzigd. Voer opnieuw een proef uit.'}={}){
  cancel(id);db.prepare("UPDATE scraper_sources SET schedule_enabled=0,next_run_at=NULL,test_passed=0,status=?,last_error=? WHERE source_id=?").run(disconnect?'not_configured':'ready',disconnect?null:message,id);
  if(disconnect)db.prepare("UPDATE scraper_sources SET username='',encrypted_login='' WHERE source_id=?").run(id);
 }
 function queue(id,mode){
  usable(id);const cfg=row(id);if(!cfg?.encrypted_login)fail(409,'Verbind eerst je Bouwberichten-account.');if(active(id))fail(409,'Er staat al een opdracht voor deze bron klaar of er wordt al opgehaald.');
  const credential=db.prepare('SELECT * FROM source_import_credentials WHERE source_id=?').get(id);if(!credential?.enabled)fail(409,'Hervat eerst de import voor deze bron.');
  const jobId='scrape-'+randomUUID();db.prepare("INSERT INTO scraper_jobs(id,source_id,mode,status,queued_at) VALUES(?,?,?,'queued',?)").run(jobId,id,mode,now());
  db.prepare("UPDATE scraper_sources SET status='queued',last_error=NULL WHERE source_id=?").run(id);return jobId;
 }
 function manage(type,p,id){
  required();source(id);if(type!=='source.scraper.disconnect'&&!(type==='source.scraper.schedule'&&p.enabled===false))usable(id);
  if(type==='source.scraper.configure'){
   if(typeof p.username!=='string'||p.username.trim().length<3||p.username.trim().length>254||/[\u0000-\u001f]/.test(p.username)||typeof p.password!=='string'||!p.password.length||p.password.length>256)fail(400,'Vul een geldige Bouwberichten-gebruikersnaam en wachtwoord in.');
   cancel(id);const username=p.username.trim();db.prepare("INSERT INTO scraper_sources(source_id,username,encrypted_login,schedule_time,status) VALUES(?,?,?,?,'ready') ON CONFLICT(source_id) DO UPDATE SET username=excluded.username,encrypted_login=excluded.encrypted_login,status='ready',schedule_enabled=0,next_run_at=NULL,test_passed=0,last_error=NULL").run(id,username,encrypt(id,{username,password:p.password}),localTime(now()));
   // Keep an existing connector key valid; only create an internal key when none exists.
   db.prepare('INSERT INTO source_import_credentials(source_id,token_hash,enabled,created_at) VALUES(?,?,1,?) ON CONFLICT(source_id) DO UPDATE SET enabled=1').run(id,hash(token()),date(now()));
   queue(id,'test');
  }else if(type==='source.scraper.test')queue(id,'test');
  else if(type==='source.scraper.run'){if(!row(id)?.test_passed)fail(409,'Laat eerst een proef met deze bron slagen.');queue(id,'full');}
  else if(type==='source.scraper.schedule'){
   if(typeof p.enabled!=='boolean')fail(400,'Geef aan of dagelijks ophalen aan staat.');
   if(p.time!==undefined&&!validScheduleTime(p.time))fail(400,'Kies een geldig dagelijks tijdstip (UU:MM).');
   const cfg=row(id);if(!cfg?.encrypted_login)fail(409,'Verbind eerst je Bouwberichten-account.');if(p.enabled&&!cfg.test_passed)fail(409,'Laat eerst een proef met deze bron slagen.');
   const credential=db.prepare('SELECT enabled FROM source_import_credentials WHERE source_id=?').get(id);if(p.enabled&&!credential?.enabled)fail(409,'Hervat eerst de import voor deze bron.');
   const time=p.time??configuredTime(cfg);
   db.prepare("UPDATE scraper_sources SET schedule_enabled=?,next_run_at=?,schedule_time=?,status=CASE WHEN status IN ('queued','running') THEN status ELSE ? END WHERE source_id=?").run(p.enabled?1:0,p.enabled?nextDailyRun(time,now(),cfg.last_schedule_day):null,time,p.enabled?'active':cfg.test_passed?'test_passed':'ready',id);
  }else if(type==='source.scraper.disconnect')invalidate(id,{disconnect:true});
  else fail(400,'Onbekende ophaalactie.');
  return{sourceId:id};
 }
 function sourceSummary(id){
  const cfg=row(id),job=active(id),seen=Number(db.prepare("SELECT value FROM scraper_meta WHERE key='worker_seen'").get()?.value||0);
  return{available,configured:!!cfg?.encrypted_login,username:cfg?.username||'',status:job?.status||cfg?.status||'not_configured',jobMode:job?.mode||null,
   scheduleEnabled:!!cfg?.schedule_enabled,scheduleTime:configuredTime(cfg),scheduleTimeZone:SCHEDULE_ZONE,nextRunAt:date(cfg?.next_run_at),lastTestPassed:!!cfg?.test_passed,workerOnline:seen>now()-90000,
   lastStartedAt:date(cfg?.last_started_at),lastFinishedAt:date(cfg?.last_finished_at),lastCounts:cfg?.counts_json?JSON.parse(cfg.counts_json):null,
   lastProcessed:job?.processed??cfg?.last_processed??0,lastTotal:job?.total??cfg?.last_total??null,lastError:cfg?.last_error||null};
 }
 function authorizeWorker(req){required();const raw=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(String(req.headers.authorization||''))?.[1]||'';if(!same(hash(raw),hash(workerToken)))fail(401,'De scraperaanmelding is ongeldig.');}
 function expire(){
  const expired=db.prepare("SELECT * FROM scraper_jobs WHERE status='running' AND lease_until<=?").all(now());
  for(const job of expired){db.prepare("UPDATE scraper_jobs SET status='failed',finished_at=?,lease_hash=NULL WHERE id=?").run(now(),job.id);db.prepare("UPDATE scraper_sources SET status='error',schedule_enabled=0,next_run_at=NULL,test_passed=0,last_error='Het ophalen is onderbroken. Start opnieuw een proef.',last_finished_at=?,counts_json=?,last_processed=?,last_total=? WHERE source_id=?").run(now(),job.counts_json,job.processed,job.total,job.source_id);}
 }
 function queueWorkbookRefreshes(){
  const migration='lead_workbook_refresh_v1';
  if(db.prepare('SELECT 1 FROM scraper_meta WHERE key=?').get(migration))return;
  const s=readState();
  const legacySources=new Set(s.leads.filter(lead=>lead.imported&&!lead.projectDetails).flatMap(lead=>lead.sourceIds??[lead.source]));
  let waiting=false;
  for(const entry of s.sources){
   if(!legacySources.has(entry.id)||entry.deleted||entry.provider!=='bouwberichten'||!entry.importEnabled||!entry.filterParameters?.length)continue;
   const cfg=row(entry.id);if(!cfg?.encrypted_login||!cfg.test_passed)continue;
   const key=migration+':'+entry.id;if(db.prepare('SELECT 1 FROM scraper_meta WHERE key=?').get(key))continue;
   const previous=db.prepare("SELECT mode FROM scraper_jobs WHERE source_id=? AND status='finished' ORDER BY finished_at DESC,rowid DESC LIMIT 1").get(entry.id);
   if(!previous)continue;
   if(active(entry.id)){waiting=true;continue;}
   // Refresh only the selection and mode already completed by this connection.
   const jobId=queue(entry.id,previous.mode);db.prepare('INSERT INTO scraper_meta(key,value) VALUES(?,?)').run(key,jobId);
  }
  if(!waiting)db.prepare('INSERT INTO scraper_meta(key,value) VALUES(?,?)').run(migration,date(now()));
 }
 function claim({leadWorkbook=false}={}){return transaction(()=>{
  db.prepare("INSERT INTO scraper_meta(key,value) VALUES('worker_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now()));expire();
  for(const cfg of db.prepare('SELECT * FROM scraper_sources WHERE schedule_enabled=1 AND next_run_at<=?').all(now())){
   const s=readState().sources.find(s=>s.id===cfg.source_id&&!s.deleted&&s.provider==='bouwberichten'),credential=db.prepare('SELECT enabled FROM source_import_credentials WHERE source_id=?').get(cfg.source_id);
   if(!s||!credential?.enabled||!cfg.test_passed||!cfg.encrypted_login){invalidate(cfg.source_id);continue;}
   const today=localDay(now());
   if(cfg.last_schedule_day!==today&&!active(cfg.source_id))queue(cfg.source_id,'full');
   db.prepare('UPDATE scraper_sources SET next_run_at=?,last_schedule_day=? WHERE source_id=?').run(nextDailyRun(configuredTime(cfg),now(),today),today,cfg.source_id);
  }
  if(leadWorkbook===true)queueWorkbookRefreshes();
  const job=db.prepare("SELECT * FROM scraper_jobs WHERE status='queued' ORDER BY queued_at,rowid LIMIT 1").get();if(!job)return{job:null};
  const s=usable(job.source_id),cfg=row(job.source_id),credential=db.prepare('SELECT enabled FROM source_import_credentials WHERE source_id=?').get(job.source_id);
  if(!cfg?.encrypted_login||!credential?.enabled){cancel(job.source_id);return{job:null};}
  let login;try{login=decrypt(job.source_id,cfg.encrypted_login);}catch{invalidate(job.source_id,{message:'Verbind het Bouwberichten-account opnieuw.'});return{job:null};}
  const leaseToken=token(),started=now();db.prepare("UPDATE scraper_jobs SET status='running',started_at=?,lease_hash=?,lease_until=? WHERE id=?").run(started,hash(leaseToken),started+LEASE,job.id);
  db.prepare("UPDATE scraper_sources SET status='running',last_started_at=?,last_error=NULL WHERE source_id=?").run(started,job.source_id);
  return{job:{id:job.id,sourceId:s.id,sourceName:s.name,filterUrl:s.filterUrl,filterParameters:s.filterParameters,...login,leaseToken,mode:job.mode,limit:job.mode==='test'?5:5000}};
 });}
 function leased(id,p,{finished=false}={}){
  const job=db.prepare('SELECT * FROM scraper_jobs WHERE id=?').get(id);if(!job||!['running',...(finished?['finished']:[])].includes(job.status)||job.lease_until<=now()||typeof p.leaseToken!=='string'||!same(hash(p.leaseToken),job.lease_hash||''))fail(409,'Deze ophaalopdracht is niet meer actief.');
  const s=source(job.source_id),cfg=row(s.id),credential=db.prepare('SELECT * FROM source_import_credentials WHERE source_id=?').get(s.id);if(!cfg?.encrypted_login||!credential?.enabled)fail(409,'Deze bron is gepauzeerd of ontkoppeld.');return{job,credential};
 }
 const integer=(v,max)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
 function report(id,kind,p){
  const{job,credential}=leased(id,p,{finished:kind==='finish'||kind==='batch'}),maximum=job.mode==='test'?5:5000;
  db.prepare("INSERT INTO scraper_meta(key,value) VALUES('worker_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now()));
  if(kind==='batch'){
   if(!integer(p.batch,maximum-1)||!Array.isArray(p.items)||!p.items.length||p.items.length>100)fail(400,'De ophaalbatch is ongeldig.');
   const fingerprint=hash(JSON.stringify(p.items)),existing=db.prepare('SELECT * FROM scraper_batches WHERE job_id=? AND batch=?').get(id,p.batch);
   if(existing){if(existing.payload_hash!==fingerprint)fail(409,'Deze ophaalbatch is al anders verwerkt.');return{counts:JSON.parse(existing.counts_json)};}
   if(job.status!=='running'||job.processed+p.items.length>maximum)fail(400,'Deze ophaalopdracht bevat te veel projecten.');
   const result=importBatch({sourceId:job.source_id,tokenHash:credential.token_hash},{runId:`${id}:${p.batch}`,items:p.items});
   transaction(()=>{const counts=JSON.parse(job.counts_json);for(const k of ['created','updated','unchanged'])counts[k]+=result.counts[k];db.prepare('INSERT INTO scraper_batches(job_id,batch,payload_hash,counts_json,items_count) VALUES(?,?,?,?,?)').run(id,p.batch,fingerprint,JSON.stringify(result.counts),p.items.length);db.prepare('UPDATE scraper_jobs SET processed=processed+?,counts_json=? WHERE id=?').run(p.items.length,JSON.stringify(counts),id);});
   return{counts:result.counts};
  }
  if(kind==='progress'){
   if(!integer(p.processed,maximum)||!integer(p.total,10000000)||p.processed>p.total)fail(400,'De ophaalvoortgang is ongeldig.');
   if(job.total!==null&&p.total!==job.total)fail(409,'Het brontotaal is gewijzigd. Start opnieuw een proef.');
   if(job.mode==='full'&&p.total>maximum)fail(409,'Deze selectie is te groot. Verklein de filterselectie tot maximaal 5000 projecten.');
   db.prepare('UPDATE scraper_jobs SET total=?,lease_until=? WHERE id=?').run(p.total,now()+LEASE,id);return{ok:true};
  }
  if(kind==='finish'){
   if(job.status==='finished')return{ok:true,counts:JSON.parse(job.counts_json)};
   if(!integer(p.processed,maximum)||!integer(p.total,10000000)||job.total===null||p.total!==job.total||p.processed!==job.processed||p.processed!==Math.min(p.total,maximum)||job.mode==='full'&&p.total>maximum)fail(400,'De opdracht is nog niet volledig verwerkt.');
   if(!p.processed)fail(409,'De selectie bevat geen projecten. Controleer de filterlink en voer opnieuw een proef uit.');
   const cfg=row(job.source_id),status=cfg.schedule_enabled?'active':'test_passed';
   transaction(()=>{db.prepare("UPDATE scraper_jobs SET status='finished',finished_at=?,total=? WHERE id=?").run(now(),p.total,id);db.prepare('UPDATE scraper_sources SET status=?,test_passed=1,last_finished_at=?,counts_json=?,last_processed=?,last_total=?,last_error=NULL WHERE source_id=?').run(status,now(),job.counts_json,job.processed,p.total,job.source_id);});
   return{ok:true,counts:JSON.parse(job.counts_json)};
  }
  if(kind==='fail'){
   const login=p.code==='login_required',message=login?'Bouwberichten vraagt om opnieuw inloggen of een extra controle. Verbind het account opnieuw.':p.code==='source_error'?'De bron kon niet betrouwbaar worden uitgelezen. Controleer de selectie en voer opnieuw een proef uit.':'Het ophalen is mislukt. Voer opnieuw een proef uit.';
   transaction(()=>{db.prepare("UPDATE scraper_jobs SET status='failed',finished_at=?,lease_hash=NULL WHERE id=?").run(now(),id);db.prepare('UPDATE scraper_sources SET status=?,schedule_enabled=0,next_run_at=NULL,test_passed=0,last_finished_at=?,counts_json=?,last_processed=?,last_total=?,last_error=? WHERE source_id=?').run(login?'login_required':'error',now(),job.counts_json,job.processed,job.total,message,job.source_id);});return{ok:true};
  }
  fail(404,'Deze scraperfunctie bestaat niet.');
 }
 return{manage,invalidate,sourceSummary,authorizeWorker,claim,report};
}
