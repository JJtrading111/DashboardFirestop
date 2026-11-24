import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,scryptSync,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createDemoState,getWorkspace,recordCall,transferUser} from './public/model.mjs';

const scrypt=promisify(scryptCallback), ROOT=path.dirname(fileURLToPath(import.meta.url));
const DAY=86400000,SESSION_AGE=12*60*60*1000,REMEMBERED_SESSION_AGE=30*DAY,INVITE_AGE=7*DAY;
const roles=['hoofdbeheerder','bedrijfsbeheerder','verkoper'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const id=p=>`${p}-${randomUUID()}`;
const iso=t=>new Date(t).toISOString();
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new ApiError(status,message);};
const text=(v,label,max=200,min=1)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail(400,`${label}: vul ${min===1?'een geldige waarde':`minimaal ${min} tekens`} in (maximaal ${max} tekens).`);return v.trim();};
const emailValue=v=>{const email=text(v,'E-mailadres',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Vul een geldig e-mailadres in.');return email;};
const tokenValue=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(v))fail(400,'Deze uitnodigingslink is ongeldig.');return v;};
const publicUser=u=>({id:u.id,name:u.name,email:u.email,companyId:u.companyId,role:u.role,status:u.status});
const isLeadSource=source=>!!source&&!source.deleted&&source.id!=='outlook'&&(!source.kind||source.kind==='lead');
const canonicalJson=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const importText=(value,label,max)=>value===undefined||value===null?'':text(value,label,max,0);
function normalizeImportItem(item){
 if(!item||typeof item!=='object'||Array.isArray(item))fail(400,'Iedere importvermelding moet een object zijn.');
 let sourceUrl=importText(item.sourceUrl,'Bronverwijzing',2000);
 if(sourceUrl){try{const parsed=new URL(sourceUrl);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();parsed.hash='';sourceUrl=parsed.href;if(sourceUrl.length>2000)throw Error();}catch{fail(400,'Gebruik een geldige http(s)-bronverwijzing zonder inloggegevens.');}}
 let externalId=importText(item.externalId,'Extern project-ID',128);if(!externalId){if(!sourceUrl)fail(400,'Geef een extern project-ID of een bronverwijzing op.');externalId='url:'+digest(sourceUrl);}
 const fields={title:text(item.title,'Projectnaam',150),organization:importText(item.organization,'Organisatie',120),city:importText(item.city,'Plaats',100),contact:importText(item.contact,'Contactpersoon',100),phone:importText(item.phone,'Telefoonnummer',30),email:importText(item.email,'E-mailadres',254),description:importText(item.description,'Projectomschrijving',3000),phase:importText(item.phase,'Projectfase',120),budget:importText(item.budget,'Budget',120),sourceUrl,sourceUpdatedAt:importText(item.sourceUpdatedAt,'Brondatum',100)};
 if(fields.email)fields.email=emailValue(fields.email);
 if(fields.phone&&!/^[+\d ()-]{6,30}$/.test(fields.phone))fail(400,'Vul een geldig telefoonnummer in.');
 if(fields.sourceUpdatedAt){if(!/^\d{4}-\d{2}-\d{2}T/.test(fields.sourceUpdatedAt)||!Number.isFinite(Date.parse(fields.sourceUpdatedAt)))fail(400,'Gebruik een geldige ISO-datum met tijd voor de brondatum.');fields.sourceUpdatedAt=iso(Date.parse(fields.sourceUpdatedAt));}
 return{externalId,fields,providedFields:Object.keys(fields).filter(field=>Object.prototype.hasOwnProperty.call(item,field))};
}
const MAX_LOGO_BYTES=256*1024,MAX_LOGO_DIMENSION=2048;
function logoDimensions(bytes,mime){
 if(mime==='image/png'){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return null;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);let offset=8,hasPixels=false,hasEnd=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);if(length>bytes.length-offset-12||!/^[A-Za-z]{4}$/.test(kind))return null;if(kind==='IDAT'&&length>0)hasPixels=true;offset+=length+12;if(kind==='IEND'){if(length!==0||offset!==bytes.length)return null;hasEnd=true;break;}}
  return hasPixels&&hasEnd?{width,height}:null;
 }
 if(mime==='image/jpeg'){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return null;
  const frames=new Set([192,193,194,195,197,198,199,201,202,203,205,206,207]);let offset=2,frame=null;
  while(offset<bytes.length-2){if(bytes[offset++]!==255)return null;while(offset<bytes.length&&bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217)return null;if(marker===1||marker>=208&&marker<=215)continue;if(offset+2>bytes.length)return null;const length=bytes.readUInt16BE(offset);if(length<2||length>bytes.length-offset)return null;if(marker===218)return frame&&length>=6&&bytes.length-offset-length>2?frame:null;if(frames.has(marker)){if(length<8||frame)return null;frame={width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};}offset+=length;}
  return null;
 }
 if(mime==='image/webp'){
  if(bytes.length<26||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)return null;
  let offset=12,canvas=null,frame=null;
  while(offset+8<=bytes.length){const kind=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8;if(length>bytes.length-start)return null;
   if(kind==='VP8X'){if(length!==10)return null;canvas={width:bytes.readUIntLE(start+4,3)+1,height:bytes.readUIntLE(start+7,3)+1};}
   else if(kind==='VP8 '){if(length<10||bytes[start]&1||!bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42])))return null;frame={width:bytes.readUInt16LE(start+6)&16383,height:bytes.readUInt16LE(start+8)&16383};}
   else if(kind==='VP8L'){if(length<5||bytes[start]!==47)return null;frame={width:1+((bytes[start+1]|bytes[start+2]<<8)&16383),height:1+((bytes[start+2]>>6|bytes[start+3]<<2|bytes[start+4]<<10)&16383)};}
   else if(kind==='ANIM'||kind==='ANMF')return null;
   offset=start+length+(length%2);
  }
  if(offset!==bytes.length||!frame||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))return null;
  return canvas||frame;
 }
 return null;
}
function decodeCompanyLogo(value){
 if(typeof value!=='string')fail(400,'Kies een geldig PNG-, JPEG- of WebP-logo.');
 if(value.length>Math.ceil(MAX_LOGO_BYTES/3)*4+64)fail(413,'Het logo is te groot. Gebruik een afbeelding van maximaal 256 kB.');
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)fail(400,'Kies een geldig PNG-, JPEG- of WebP-logo.');
 const bytes=Buffer.from(match[2],'base64');if(bytes.length>MAX_LOGO_BYTES)fail(413,'Het logo is te groot. Gebruik een afbeelding van maximaal 256 kB.');
 if(bytes.toString('base64')!==match[2])fail(400,'Het logo bevat ongeldige afbeeldingsgegevens.');
 const dimensions=logoDimensions(bytes,match[1]);
 if(!dimensions||dimensions.width<1||dimensions.height<1||dimensions.width>MAX_LOGO_DIMENSION||dimensions.height>MAX_LOGO_DIMENSION)fail(400,'Gebruik een geldig logo van maximaal 2048 bij 2048 pixels.');
 return{mime:match[1],bytes};
}
async function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>256)fail(400,'Gebruik een wachtwoord van minimaal 12 en maximaal 256 tekens.');const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `${salt}:${Buffer.from(hash).toString('hex')}`;}
async function passwordMatches(password,stored){if(typeof password!=='string'||password.length>256)return false;const [salt,expected]=String(stored||'').split(':');const actual=await scrypt(password,salt||'invalid-password-salt',64,{N:32768,r:8,p:1,maxmem:64*1024*1024});const expectedBytes=expected?Buffer.from(expected,'hex'):Buffer.alloc(64);return expectedBytes.length===actual.length&&timingSafeEqual(expectedBytes,actual)&&!!stored;}

export function createApp(options={}){
 const dataDir=options.dataDir??process.env.DATA_DIR??path.join(ROOT,'data');
 const publicOrigin=options.publicOrigin??process.env.APP_URL??'';
 const secureCookies=options.secureCookies??(process.env.NODE_ENV==='production');
 const adminEmail=emailValue(options.adminEmail??process.env.ADMIN_EMAIL??'jjthtrading@gmail.com');
 const adminName=options.adminName??process.env.ADMIN_NAME??'Beheerder';
 const adminPassword=options.adminPassword??process.env.ADMIN_PASSWORD??'';
 const bootstrapToken=options.bootstrapToken??process.env.BOOTSTRAP_TOKEN??'';
 const demoCleanupId=options.demoCleanupId??process.env.DEMO_CLEANUP_ID??'';
 if(typeof demoCleanupId!=='string'||demoCleanupId!==''&&!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(demoCleanupId))throw Error('DEMO_CLEANUP_ID must be empty or a 1–128 character maintenance identifier.');
 if(adminPassword&&(typeof adminPassword!=='string'||adminPassword.length<12||adminPassword.length>256))throw Error('ADMIN_PASSWORD must contain between 12 and 256 characters.');
 if(process.env.NODE_ENV==='production'&&!publicOrigin)throw Error('APP_URL is required in production.');
 if(publicOrigin&&new URL(publicOrigin).origin!==publicOrigin.replace(/\/$/,''))throw Error('APP_URL must contain only the public origin.');
 if(dataDir!==':memory:')mkdirSync(dataDir,{recursive:true});
 const db=new DatabaseSync(dataDir===':memory:'?':memory:':path.join(dataDir,'dashboard.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS credentials(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,company_id TEXT NOT NULL,role TEXT NOT NULL,user_id TEXT,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,creator_id TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS demo_lead_archives(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,actor_id TEXT NOT NULL,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS app_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL,result_json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_logos(company_id TEXT PRIMARY KEY,mime TEXT NOT NULL,bytes BLOB NOT NULL,version TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_import_credentials(source_id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS source_import_status(source_id TEXT PRIMARY KEY,last_import_at TEXT,counts_json TEXT,last_error TEXT);
 CREATE TABLE IF NOT EXISTS source_items(source_id TEXT NOT NULL,external_id TEXT NOT NULL,lead_id TEXT NOT NULL,imported_json TEXT NOT NULL,PRIMARY KEY(source_id,external_id));
 CREATE TABLE IF NOT EXISTS import_runs(source_id TEXT NOT NULL,run_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(source_id,run_id));
 CREATE TABLE IF NOT EXISTS import_errors(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,created_at TEXT NOT NULL,status INTEGER NOT NULL,message TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE INDEX IF NOT EXISTS invitations_email ON invitations(email);`);
 const readState=()=>{const s=JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);s.settings.cooldownUnit=s.settings.cooldownUnit==='days'?'days':'hours';const credentials=new Map(db.prepare('SELECT source_id,enabled FROM source_import_credentials').all().map(row=>[row.source_id,row])),statuses=new Map(db.prepare('SELECT * FROM source_import_status').all().map(row=>[row.source_id,row]));for(const source of s.sources){const credential=credentials.get(source.id),status=statuses.get(source.id);source.importConfigured=!source.deleted&&!!credential;source.importEnabled=source.importConfigured&&!!credential.enabled;source.lastImportAt=status?.last_import_at??null;source.lastImportCounts=status?.counts_json?JSON.parse(status.counts_json):null;source.lastImportError=status?.last_error??null;source.enabled=source.importEnabled&&!!source.lastImportAt;}return s;};
 const writeState=s=>{const copy={...s,invitations:[]};db.prepare('INSERT INTO app_state(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(copy));};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 function removeDemoLeads(s,actor,cid){
  const demoLeads=s.leads.filter(lead=>lead.demo===true),removedIds=new Set(demoLeads.map(lead=>lead.id));
  if(removedIds.size){
   const archivedWorkspaces={};
   for(const [companyId,entries]of Object.entries(s.workspaces)){
    const archived=Object.fromEntries(Object.entries(entries).filter(([leadId])=>removedIds.has(leadId)));
    if(Object.keys(archived).length)archivedWorkspaces[companyId]=archived;
   }
   const archive={leads:demoLeads,workspaces:archivedWorkspaces,callLog:s.callLog.filter(call=>removedIds.has(call.leadId)),feed:s.feed.filter(item=>removedIds.has(item.leadId))};
   db.prepare('INSERT INTO demo_lead_archives(id,created_at,actor_id,json) VALUES(?,?,?,?)').run(id('demo-archive'),iso(Date.now()),actor.id,JSON.stringify(archive));
   s.leads=s.leads.filter(lead=>lead.demo!==true);
   for(const entries of Object.values(s.workspaces))for(const leadId of Object.keys(entries))if(removedIds.has(leadId))delete entries[leadId];
   s.callLog=s.callLog.filter(call=>!removedIds.has(call.leadId));
   s.feed=s.feed.filter(item=>!removedIds.has(item.leadId));
   addFeed(s,actor,cid,`${removedIds.size} demoleads verwijderd`);
  }
  return{removedCount:removedIds.size,remainingCount:s.leads.length};
 }
 if(!db.prepare('SELECT id FROM app_state WHERE id=1').get()){
  const seed=options.seedDemoData===true?createDemoState():{
   version:1,
   companies:[{id:'c-noord',name:'Mijn bedrijf',initials:'MB',color:'#2563eb',columns:[{id:'nieuw',name:'Nieuw'},{id:'contact',name:'In contact'},{id:'opvolgen',name:'Opvolgen'},{id:'offerte',name:'Offerte'},{id:'afgerond',name:'Afgerond'}]}],
   users:[],leads:[],workspaces:{},callLog:[],feed:[],invitations:[],
   sources:[{id:'bouw',name:'Bouwberichten.nl',url:'https://www.bouwberichten.nl',username:'',enabled:false},{id:'hotels',name:'Hotels',url:'',username:'',enabled:false},{id:'vve',name:'VvE',url:'',username:'',enabled:false},{id:'outlook',name:'Microsoft Outlook',url:'',username:'',enabled:false}],
   settings:{cooldownHours:48,cooldownUnit:'hours'}
  };seed.users=[{id:'u-admin',name:text(adminName,'Naam',100),email:adminEmail,companyId:'c-noord',role:'hoofdbeheerder',status:'uitgenodigd'}];
  const ownerCompany=seed.companies.find(c=>c.id==='c-noord');ownerCompany.name='Mijn bedrijf';ownerCompany.initials='MB';
  seed.workspaces={};for(const c of seed.companies)seed.workspaces[c.id]={};seed.callLog=[];seed.feed=seed.feed.filter(f=>!f.companyId);seed.invitations=[];seed.leads.forEach(l=>l.demo=true);seed.shared=true;
  writeState(seed);
 }
 // An explicitly configured Railway password manages only the existing owner.
 // Reuse the stored salt when checking it, so an unchanged deployment keeps sessions.
 if(adminPassword){
  try{transaction(()=>{
   const s=readState(),owner=s.users.find(u=>u.id==='u-admin');
   if(!owner)throw Error('The configured administrator account is missing.');
   const collision=s.users.some(u=>u.id!==owner.id&&u.email.toLowerCase()===adminEmail)||db.prepare('SELECT user_id FROM credentials WHERE email=? AND user_id<>?').get(adminEmail,owner.id)||db.prepare("SELECT id FROM invitations WHERE email=? AND status='pending' AND (user_id IS NULL OR user_id<>?)").get(adminEmail,owner.id);
   if(collision)throw Error('ADMIN_EMAIL is already assigned to another account or invitation.');
   const existing=db.prepare('SELECT * FROM credentials WHERE user_id=?').get(owner.id);
   let unchanged=false;
   if(existing){const [salt,hex]=existing.password_hash.split(':'),expected=Buffer.from(hex,'hex'),actual=scryptSync(adminPassword,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});unchanged=expected.length===actual.length&&timingSafeEqual(expected,actual);}
   const changed=!unchanged||existing?.email!==adminEmail||owner.email!==adminEmail||owner.status!=='actief'||owner.role!=='hoofdbeheerder';
   if(changed){
    let hash=existing?.password_hash;
    if(!unchanged){const salt=randomBytes(16).toString('hex');hash=salt+':'+scryptSync(adminPassword,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');}
    Object.assign(owner,{email:adminEmail,status:'actief',role:'hoofdbeheerder'});
    db.prepare('INSERT INTO credentials(user_id,email,password_hash) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash').run(owner.id,adminEmail,hash);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner.id);
    writeState(s);
   }
   db.prepare("UPDATE invitations SET status='revoked' WHERE user_id=? AND status='pending'").run(owner.id);
  });}catch(error){db.close();throw error;}
 }
 if(process.env.NODE_ENV==='production'&&!bootstrapToken&&!db.prepare('SELECT user_id FROM credentials LIMIT 1').get()){db.close();throw Error('ADMIN_PASSWORD or BOOTSTRAP_TOKEN is required until the administrator account has been activated.');}
 // Bootstrap is minted once only, never regenerated after use or on a restart.
 if(bootstrapToken&&!db.prepare('SELECT id FROM invitations WHERE user_id=?').get('u-admin')&&!db.prepare('SELECT user_id FROM credentials WHERE user_id=?').get('u-admin')){
  tokenValue(bootstrapToken);const owner=readState().users.find(u=>u.id==='u-admin');
  if(owner)db.prepare('INSERT INTO invitations(id,token_hash,email,name,company_id,role,user_id,created_at,expires_at,status,creator_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('bootstrap-owner',digest(bootstrapToken),owner.email,owner.name,owner.companyId,owner.role,owner.id,Date.now(),Date.now()+INVITE_AGE,'pending',null);
 }
 let maintenanceResult=null;
 // Only an explicit deployment maintenance ID enables this one-time data cleanup.
 // The archive, active-state update and completion marker commit atomically.
 if(demoCleanupId){
  try{
   maintenanceResult=transaction(()=>{
    if(db.prepare('SELECT id FROM app_migrations WHERE id=?').get(demoCleanupId))return null;
    const s=readState(),owner=s.users.find(user=>user.id==='u-admin');
    if(!owner)throw Error('The owner account required for maintenance is missing.');
    const result=removeDemoLeads(s,owner,owner.companyId);
    writeState(s);
    db.prepare('INSERT INTO app_migrations(id,applied_at,result_json) VALUES(?,?,?)').run(demoCleanupId,iso(Date.now()),JSON.stringify(result));
    return result;
   });
  }catch(error){db.close();throw error;}
  if(maintenanceResult)console.log('Demo cleanup complete: '+JSON.stringify(maintenanceResult));
 }
 const limits=new Map();let hashing=0;
 function rate(key,maximum,period=15*60000){const now=Date.now();let hit=limits.get(key);if(!hit||hit.until<now){hit={count:0,until:now+period};limits.set(key,hit);}if(++hit.count>maximum)fail(429,'Te veel pogingen. Probeer het later opnieuw.');if(limits.size>5000)for(const [k,v]of limits)if(v.until<now)limits.delete(k);}
 async function hashWork(fn){if(hashing>=8)fail(429,'Er zijn veel aanmeldpogingen. Probeer het over een moment opnieuw.');hashing++;try{return await fn();}finally{hashing--;}}
 function invitationPublic(row,s){return{id:row.id,name:row.name,email:row.email,companyId:row.company_id,companyName:s.companies.find(c=>c.id===row.company_id)?.name||'Bedrijf',role:row.role,createdAt:iso(row.created_at),expiresAt:iso(row.expires_at),status:row.status==='pending'&&row.expires_at<=Date.now()?'expired':row.status,creatorId:row.creator_id};}
 function invitationByToken(raw){const row=db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(digest(tokenValue(raw)));if(!row||row.status!=='pending'||row.expires_at<=Date.now())fail(410,'Deze uitnodigingslink is verlopen, ingetrokken of al gebruikt. Vraag de beheerder om een nieuwe link.');return row;}
 function cookieSession(req){const raw=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('bouw_session='))?.slice(13);if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(raw),Date.now());if(!session)return null;const user=readState().users.find(u=>u.id===session.user_id&&u.status==='actief');return user?{...session,user}:null;}
 function sessionBody(session){return {authenticated:true,user:publicUser(session.user),csrfToken:session.csrf};}
 function newSession(user,{rememberMe=false}={}){const raw=token(),csrf=token(),now=Date.now(),duration=rememberMe?REMEMBERED_SESSION_AGE:SESSION_AGE;db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)').run(digest(raw),user.id,csrf,now,now+duration);return{raw,csrf,user,cookieMaxAge:rememberMe?duration/1000:null};}
 function setCookie(res,raw,{maxAge=null,remove=false}={}){const persistence=remove?'; Max-Age=0':maxAge===null?'':`; Max-Age=${maxAge}`;res.setHeader('Set-Cookie',`bouw_session=${raw}; Path=/; HttpOnly; SameSite=Lax${persistence}${secureCookies?'; Secure':''}`);}
 function authorized(req){const session=cookieSession(req);if(!session)fail(401,'Meld je aan om verder te gaan.');return session;}
 function checkOrigin(req){const origin=req.headers.origin;if(!origin){if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Dit verzoek is niet toegestaan.');return;}const expected=publicOrigin?new URL(publicOrigin).origin:`${secureCookies?'https':'http'}://${req.headers.host}`;if(origin!==expected)fail(403,'Dit verzoek is niet toegestaan.');}
 function csrf(req,session){checkOrigin(req);const value=req.headers['x-csrf-token'],actual=typeof value==='string'?Buffer.from(value):Buffer.alloc(0),expected=Buffer.from(session.csrf);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail(403,'Je sessie is gewijzigd. Vernieuw de pagina en probeer opnieuw.');}
 function scoped(s,actor,cid){
  const chief=actor.role==='hoofdbeheerder';if(!chief&&cid!==actor.companyId)fail(403,'Je kunt alleen je eigen bedrijf openen.');if(!s.companies.some(c=>c.id===cid))fail(404,'Dit bedrijf bestaat niet.');
  const invitations=db.prepare('SELECT * FROM invitations ORDER BY created_at DESC').all().filter(i=>chief||i.company_id===actor.companyId).map(i=>invitationPublic(i,s));
  if(chief)return{state:{...s,users:s.users.map(publicUser),invitations},userId:actor.id,companyId:cid};
  const own=s.users.filter(u=>u.companyId===actor.companyId).map(publicUser);
  const referenced=new Set();for(const w of Object.values(s.workspaces[actor.companyId]||{})){if(w.ownerId)referenced.add(w.ownerId);}
  // Transferred owners remain as anonymous historical labels; never expose their new company or email.
  for(const historicId of referenced)if(!own.some(u=>u.id===historicId)){const original=s.users.find(u=>u.id===historicId);own.push({id:historicId,name:original?.name||'Voormalige medewerker',email:'',companyId:null,role:'verkoper',status:'historisch'});}
  const latest=new Map();for(const call of s.callLog){const old=latest.get(call.leadId);if(!old||Date.parse(call.at)>Date.parse(old.at))latest.set(call.leadId,call);}
  return{state:{...s,companies:s.companies.filter(c=>c.id===actor.companyId),users:own,workspaces:{[actor.companyId]:s.workspaces[actor.companyId]||{}},callLog:[...latest.values()].map(c=>c.companyId===actor.companyId?c:{id:c.id,leadId:c.leadId,companyId:c.companyId,at:c.at,userId:null}),feed:s.feed.filter(f=>!f.companyId||f.companyId===actor.companyId),invitations:actor.role==='bedrijfsbeheerder'?invitations:[],sources:s.sources.map(src=>({...src,url:'',username:''}))},userId:actor.id,companyId:cid};
 }
 function requireCompany(s,cid){const c=s.companies.find(c=>c.id===cid);if(!c)fail(404,'Dit bedrijf bestaat niet.');return c;}
 function requireLead(s,lid){const l=s.leads.find(l=>l.id===lid);if(!l)fail(404,'Deze lead bestaat niet.');return l;}
 function requireMember(s,uid,cid){const u=s.users.find(u=>u.id===uid&&u.companyId===cid&&u.status==='actief');if(!u)fail(400,'Kies een actieve gebruiker van dit bedrijf.');return u;}
 function requireChief(actor){if(actor.role!=='hoofdbeheerder')fail(403,'Alleen de hoofdbeheerder kan dit wijzigen.');}
 function requireManager(actor,cid){if(actor.role==='verkoper'||actor.role!=='hoofdbeheerder'&&actor.companyId!==cid)fail(403,'Je hebt geen beheerrechten voor dit bedrijf.');}
 function sourceConnection(p){let url='';if(p.url!==undefined&&p.url!==''){try{const parsed=new URL(text(p.url,'Bron-URL',500));if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error();url=parsed.href;}catch{fail(400,'Gebruik een http(s)-URL zonder inloggegevens, tokens of queryparameters.');}}const username=p.username===undefined?'':text(p.username,'Gebruikersnaam',160,0);return{url,username};}
 function sourceName(s,value,excludedId=null){const name=text(value,'Bronnaam',120);if(s.sources.some(source=>!source.deleted&&source.id!==excludedId&&source.name.toLowerCase()===name.toLowerCase()))fail(409,'Deze bronnaam bestaat al.');return name;}
 function addFeed(s,actor,cid,message,leadId=null,type='update'){s.feed.unshift({id:id('feed'),companyId:cid,leadId,type,text:message,authorName:actor.name,at:iso(Date.now())});if(s.feed.length>10000)s.feed.length=10000;}
 function managedImportSource(s,sourceId){const source=s.sources.find(item=>item.id===sourceId&&!item.deleted);if(!source)fail(404,'Deze bron bestaat niet.');if(!isLeadSource(source))fail(400,'Deze bron ondersteunt geen leadimport.');return source;}
 function authorizedImport(req,sourceId){
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(String(req.headers.authorization||'')),source=readState().sources.find(item=>item.id===sourceId),credential=match&&db.prepare('SELECT * FROM source_import_credentials WHERE source_id=? AND token_hash=?').get(sourceId,digest(match[1]));
  if(!isLeadSource(source)||!credential)fail(401,'De importsleutel is ongeldig.');if(!credential.enabled)fail(403,'De import voor deze bron is gepauzeerd.');return{sourceId,tokenHash:credential.token_hash};
 }
 function importFailure(sourceId,error){
  const status=error instanceof ApiError?error.status:500;if(status===401||status===403)return;
  const message=status===413?'De import is te groot. Gebruik maximaal 1 MiB en 100 projecten per batch.':status===409?'De import bevat een conflict. Controleer het run-ID en de bronvermeldingen.':status===400||status===415?'De import is geweigerd. Controleer de JSON en projectvelden.':status===429?'Er zijn te veel importverzoeken. Probeer het later opnieuw.':'De import kon niet worden verwerkt. Probeer het later opnieuw.';
  transaction(()=>{db.prepare('INSERT INTO source_import_status(source_id,last_error) VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET last_error=excluded.last_error').run(sourceId,message);db.prepare('INSERT INTO import_errors(id,source_id,created_at,status,message) VALUES(?,?,?,?,?)').run(id('import-error'),sourceId,iso(Date.now()),status,message);db.prepare('DELETE FROM import_errors WHERE source_id=? AND id NOT IN (SELECT id FROM import_errors WHERE source_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)').run(sourceId,sourceId);});
 }
 function importBatch(auth,p){
  const runId=text(p.runId,'Import-run-ID',128);if(!Array.isArray(p.items)||p.items.length<1||p.items.length>100)fail(400,'Importeer tussen 1 en 100 projecten per batch.');
  const items=p.items.map(normalizeImportItem);if(new Set(items.map(item=>item.externalId)).size!==items.length)fail(400,'De batch bevat dezelfde bronvermelding meer dan één keer.');let payloadHash;try{payloadHash=digest(canonicalJson(p));}catch{fail(400,'De import bevat te ingewikkelde gegevens.');}
  return transaction(()=>{
   const s=readState(),source=s.sources.find(item=>item.id===auth.sourceId),credential=db.prepare('SELECT * FROM source_import_credentials WHERE source_id=? AND token_hash=?').get(auth.sourceId,auth.tokenHash);if(!isLeadSource(source)||!credential)fail(401,'De importsleutel is ongeldig.');if(!credential.enabled)fail(403,'De import voor deze bron is gepauzeerd.');
   const previousRun=db.prepare('SELECT * FROM import_runs WHERE source_id=? AND run_id=?').get(source.id,runId);if(previousRun){if(previousRun.payload_hash!==payloadHash)fail(409,'Dit import-run-ID is al gebruikt voor een andere batch.');return JSON.parse(previousRun.result_json);}
   const now=iso(Date.now()),counts={created:0,updated:0,unchanged:0},actor={name:'Import: '+source.name};
   for(const item of items){
    const existing=db.prepare('SELECT * FROM source_items WHERE source_id=? AND external_id=?').get(source.id,item.externalId);let lead;
    if(existing){
     lead=s.leads.find(record=>record.id===existing.lead_id);if(!lead)fail(409,'Een bronvermelding verwijst naar een ontbrekend project.');const previous=JSON.parse(existing.imported_json);if(previous.sourceUpdatedAt&&item.fields.sourceUpdatedAt&&Date.parse(item.fields.sourceUpdatedAt)<Date.parse(previous.sourceUpdatedAt)){counts.unchanged++;continue;}const incoming={...previous};for(const field of item.providedFields)incoming[field]=item.fields[field];let changed=false;
     for(const [field,value]of Object.entries(incoming)){if(lead[field]===previous[field]||(previous[field]===undefined&&!lead[field])){if(lead[field]!==value){lead[field]=value;changed=true;}}}
     if(changed){lead.updatedAt=now;counts.updated++;addFeed(s,actor,null,`Projectgegevens bijgewerkt: ${lead.title}`,lead.id);}else counts.unchanged++;
     db.prepare('UPDATE source_items SET imported_json=? WHERE source_id=? AND external_id=?').run(JSON.stringify(incoming),source.id,item.externalId);
    }else{
     lead={id:id('lead'),source:source.id,...item.fields,createdAt:now,updatedAt:now,tags:['Geïmporteerd'],demo:false,imported:true,importedAt:now,importExternalId:item.externalId};s.leads.unshift(lead);counts.created++;
     db.prepare('INSERT INTO source_items(source_id,external_id,lead_id,imported_json) VALUES(?,?,?,?)').run(source.id,item.externalId,lead.id,JSON.stringify(item.fields));addFeed(s,actor,null,`Nieuwe centrale lead: ${lead.title}`,lead.id,'new');
    }
   }
   db.prepare('INSERT INTO source_import_status(source_id,last_import_at,counts_json,last_error) VALUES(?,?,?,NULL) ON CONFLICT(source_id) DO UPDATE SET last_import_at=excluded.last_import_at,counts_json=excluded.counts_json,last_error=NULL').run(source.id,now,JSON.stringify(counts));Object.assign(source,{lastImportAt:now,lastImportCounts:counts,lastImportError:null,enabled:true});writeState(s);
   const result={sourceId:source.id,runId,counts,importedAt:now};db.prepare('INSERT INTO import_runs(source_id,run_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').run(source.id,runId,payloadHash,JSON.stringify(result),now);return result;
  });
 }
 function invite(s,actor,p){
  const cid=text(p.companyId,'Bedrijf',100),c=requireCompany(s,cid);requireManager(actor,cid);const name=text(p.name,'Naam',100),email=emailValue(p.email),role=p.role;
  if(!roles.includes(role)||actor.role!=='hoofdbeheerder'&&role==='hoofdbeheerder')fail(403,'Je mag deze rol niet toekennen.');
  if(s.users.some(u=>u.email.toLowerCase()===email)||db.prepare("SELECT id FROM invitations WHERE email=? AND status='pending'").get(email))fail(409,'Dit e-mailadres heeft al een account of openstaande uitnodiging. Vernieuw eventueel de bestaande link.');
  const raw=token(),now=Date.now(),iid=id('invite');db.prepare('INSERT INTO invitations(id,token_hash,email,name,company_id,role,user_id,created_at,expires_at,status,creator_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(iid,digest(raw),email,name,cid,role,null,now,now+INVITE_AGE,'pending',actor.id);const invitation=invitationPublic(db.prepare('SELECT * FROM invitations WHERE id=?').get(iid),s);addFeed(s,actor,cid,`Uitnodiging voorbereid voor ${name}`);return{invitation,token:raw};
 }
 function action(actor,type,cid,p,requestOrigin){return transaction(()=>{
  const s=readState(),fresh=s.users.find(u=>u.id===actor.id&&u.status==='actief');if(!fresh)fail(401,'Meld je opnieuw aan.');actor=fresh;const company=requireCompany(s,cid);if(actor.role!=='hoofdbeheerder'&&actor.companyId!==cid)fail(403,'Je kunt alleen je eigen bedrijf wijzigen.');let result;
  switch(type){
   case'demo.remove':{
    requireChief(actor);
    result=removeDemoLeads(s,actor,cid);
    break;
   }
   case'workspace.update':{const lead=requireLead(s,p.leadId),w=getWorkspace(s,cid,lead.id),field=p.field;if(!['status','priority','ownerId','commitment','calculation'].includes(field))fail(400,'Dit veld kan niet worden aangepast.');if(field==='status'&&!company.columns.some(c=>c.id===p.value))fail(400,'Kies een geldige Kanban-status.');if(field==='priority'&&!['high','medium','low'].includes(p.value))fail(400,'Kies een geldige prioriteit.');if(field==='ownerId'&&p.value)requireMember(s,p.value,cid);if(['commitment','calculation'].includes(field)&&typeof p.value!=='boolean')fail(400,'Gebruik een geldig vinkje.');w[field]=field==='ownerId'?(p.value||null):p.value;if(['commitment','calculation'].includes(field))w[field+'At']=p.value?iso(Date.now()):null;addFeed(s,actor,cid,`Opvolging bijgewerkt: ${lead.title}`,lead.id);break;}
   case'note.add':{const lead=requireLead(s,p.leadId),w=getWorkspace(s,cid,lead.id);w.notes.push({id:id('note'),text:text(p.text,'Notitie',4000),authorId:actor.id,authorName:actor.name,createdAt:iso(Date.now())});w.ownerId??=actor.companyId===cid?actor.id:null;addFeed(s,actor,cid,`Gespreksnotitie toegevoegd: ${lead.title}`,lead.id);break;}
   case'call.record':{requireLead(s,p.leadId);const workspace=getWorkspace(s,cid,p.leadId),previousOwner=workspace.ownerId;try{recordCall(s,p.leadId,cid,actor.id);}catch(error){fail(409,error.message);}if(!previousOwner&&actor.companyId!==cid)workspace.ownerId=null;break;}
   case'callback.add':{const lead=requireLead(s,p.leadId),assignee=requireMember(s,p.assigneeId,cid),due=Date.parse(p.dueAt);if(!Number.isFinite(due)||due<Date.now()-365*DAY||due>Date.now()+3650*DAY)fail(400,'Kies een geldige terugbeldatum.');const cb={id:id('callback'),dueAt:iso(due),creatorId:actor.id,creatorName:actor.name,assigneeId:assignee.id,done:false,notified:false};getWorkspace(s,cid,lead.id).callbacks.push(cb);addFeed(s,actor,cid,`Terugbelafspraak voor ${assignee.name}: ${lead.title}`,lead.id,'followup');result={callback:cb};break;}
   case'callback.complete':{const lead=requireLead(s,p.leadId),cb=getWorkspace(s,cid,lead.id).callbacks.find(c=>c.id===p.callbackId);if(!cb)fail(404,'Deze terugbelafspraak bestaat niet.');cb.done=true;addFeed(s,actor,cid,`Terugbelafspraak afgehandeld: ${lead.title}`,lead.id,'followup');break;}
   case'lead.create':{const source=p.source;if(!s.sources.some(item=>item.id===source&&!item.deleted&&item.id!=='outlook'&&(!item.kind||item.kind==='lead')))fail(400,'Kies een geldige broncategorie.');const now=iso(Date.now()),lead={id:id('lead'),title:text(p.title,'Projectnaam',150),organization:text(p.organization,'Organisatie',120),city:text(p.city,'Plaats',100),source,contact:text(p.contact,'Contactpersoon',100),phone:text(p.phone,'Telefoonnummer',30),email:emailValue(p.email),description:text(p.description,'Projectomschrijving',3000),phase:'Oriëntatie',budget:'Nog niet bekend',createdAt:now,updatedAt:now,tags:['Handmatig toegevoegd'],demo:false};if(!/^[+\d ()-]{6,30}$/.test(lead.phone))fail(400,'Vul een geldig telefoonnummer in.');s.leads.unshift(lead);const w=getWorkspace(s,cid,lead.id);w.ownerId=actor.companyId===cid?actor.id:null;if(p.status){if(!company.columns.some(c=>c.id===p.status))fail(400,'Kies een geldige Kanban-status.');w.status=p.status;}s.feed.unshift({id:id('feed'),companyId:null,leadId:lead.id,type:'new',text:`Nieuwe centrale lead: ${lead.title}`,authorName:'Handmatig toegevoegd',at:now});result={lead,leadId:lead.id};break;}
   case'columns.update':{requireManager(actor,cid);if(!Array.isArray(p.columns)||p.columns.length!==company.columns.length||p.columns.length>30)fail(400,'Behoud de bestaande kolommen.');const next=p.columns.map(c=>({id:c.id,name:text(c.name,'Kolomnaam',35)}));if(next.some(c=>!company.columns.some(old=>old.id===c.id))||new Set(next.map(c=>c.id)).size!==next.length)fail(400,'De kolomindeling is ongeldig.');if(p.newColumn){if(next.length>=30)fail(400,'Gebruik maximaal 30 kolommen.');next.push({id:id('col'),name:text(p.newColumn,'Nieuwe kolom',35)});}if(new Set(next.map(c=>c.name.toLowerCase())).size!==next.length)fail(400,'Gebruik verschillende kolomnamen.');company.columns=next;addFeed(s,actor,cid,'Kanban-kolommen bijgewerkt');break;}
   case'company.create':{requireChief(actor);const name=text(p.name,'Bedrijfsnaam',120);if(s.companies.some(c=>c.name.toLowerCase()===name.toLowerCase()))fail(409,'Dit bedrijf bestaat al.');const c={id:id('company'),name,initials:name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase(),color:'#dce8ff',columns:[{id:'nieuw',name:'Nieuw'},{id:'contact',name:'In contact'},{id:'opvolgen',name:'Opvolgen'},{id:'offerte',name:'Offerte'},{id:'afgerond',name:'Afgerond'}]};s.companies.push(c);s.workspaces[c.id]={};result={company:c};break;}
   case'company.update':{
    const targetId=text(p.companyId,'Bedrijf',100);requireManager(actor,targetId);const target=requireCompany(s,targetId),name=text(p.name,'Bedrijfsnaam',120);
    if(s.companies.some(c=>c.id!==targetId&&c.name.toLowerCase()===name.toLowerCase()))fail(409,'Dit bedrijf bestaat al.');
    const changesLogo=Object.prototype.hasOwnProperty.call(p,'logoDataUrl');let logo;
    if(changesLogo&&p.logoDataUrl!==null&&p.logoDataUrl!=='')logo=decodeCompanyLogo(p.logoDataUrl);
    target.name=name;target.initials=name.split(/\s+/).map(word=>Array.from(word)[0]).slice(0,2).join('').toUpperCase();
    if(changesLogo){
     if(logo){const version=randomUUID();db.prepare('INSERT INTO company_logos(company_id,mime,bytes,version) VALUES(?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,version=excluded.version').run(targetId,logo.mime,logo.bytes,version);target.logoVersion=version;target.logoUrl='/api/company-logos/'+encodeURIComponent(targetId)+'?v='+version;}
     else{db.prepare('DELETE FROM company_logos WHERE company_id=?').run(targetId);target.logoVersion=null;target.logoUrl=null;}
    }
    addFeed(s,actor,targetId,`Bedrijfsgegevens bijgewerkt: ${target.name}`);result={company:target};break;
   }
   case'user.update':{const target=s.users.find(u=>u.id===p.userId);if(!target)fail(404,'Deze gebruiker bestaat niet.');if(adminPassword&&target.id==='u-admin'&&p.role!=='hoofdbeheerder')fail(400,'Dit beheeraccount moet hoofdbeheerder blijven.');if(!roles.includes(p.role))fail(400,'Kies een geldige rol.');requireCompany(s,p.companyId);if(actor.role!=='hoofdbeheerder'){requireManager(actor,target.companyId);if(p.companyId!==actor.companyId||target.role==='hoofdbeheerder'||p.role==='hoofdbeheerder')fail(403,'Je kunt alleen rollen binnen je eigen bedrijf beheren.');}if(target.role==='hoofdbeheerder'&&p.role!=='hoofdbeheerder'&&s.users.filter(u=>u.role==='hoofdbeheerder'&&u.status==='actief').length===1)fail(400,'Er moet minimaal één actieve hoofdbeheerder blijven.');transferUser(s,target.id,p.companyId);target.role=p.role;db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);addFeed(s,actor,cid,`Gebruiker bijgewerkt: ${target.name}`);break;}
   case'source.create':{requireChief(actor);const name=sourceName(s,p.name),connection=sourceConnection(p),source={id:id('source'),name,kind:'lead',...connection,enabled:false,importConfigured:false,importEnabled:false,lastImportAt:null,lastImportCounts:null,lastImportError:null};s.sources.push(source);addFeed(s,actor,null,`Bron toegevoegd: ${source.name}`);result={source};break;}
   case'source.update':{requireChief(actor);const source=s.sources.find(item=>item.id===p.id&&!item.deleted);if(!source)fail(404,'Deze bron bestaat niet.');if(source.id==='outlook')fail(400,'Deze bron kan niet worden aangepast.');const name=p.name===undefined?source.name:sourceName(s,p.name,source.id),connection=sourceConnection(p);Object.assign(source,{name,...connection,enabled:source.importEnabled&&!!source.lastImportAt});addFeed(s,actor,null,`Bron bijgewerkt: ${source.name}`);result={source};break;}
   case'source.delete':{requireChief(actor);const source=s.sources.find(item=>item.id===p.id&&!item.deleted);if(!source)fail(404,'Deze bron bestaat niet.');db.prepare('DELETE FROM source_import_credentials WHERE source_id=?').run(source.id);Object.assign(source,{deleted:true,url:'',username:'',enabled:false,importConfigured:false,importEnabled:false});addFeed(s,actor,null,`Bron verwijderd: ${source.name}`);result={source};break;}
   case'source.import.rotate':{requireChief(actor);const source=managedImportSource(s,p.id),raw=token();db.prepare('INSERT INTO source_import_credentials(source_id,token_hash,enabled,created_at) VALUES(?,?,1,?) ON CONFLICT(source_id) DO UPDATE SET token_hash=excluded.token_hash,enabled=1,created_at=excluded.created_at').run(source.id,digest(raw),iso(Date.now()));Object.assign(source,{importConfigured:true,importEnabled:true,enabled:!!source.lastImportAt});addFeed(s,actor,null,`Nieuwe importsleutel ingesteld voor ${source.name}`);result={importToken:raw,sourceId:source.id,importUrl:new URL('/api/import/sources/'+encodeURIComponent(source.id)+'/leads',requestOrigin).href};break;}
   case'source.import.toggle':{requireChief(actor);const source=managedImportSource(s,p.id);if(typeof p.enabled!=='boolean')fail(400,'Geef aan of de import is ingeschakeld.');if(p.enabled&&!db.prepare('SELECT source_id FROM source_import_credentials WHERE source_id=?').get(source.id))fail(409,'Maak eerst een importsleutel voor deze bron.');db.prepare('UPDATE source_import_credentials SET enabled=? WHERE source_id=?').run(p.enabled?1:0,source.id);source.importEnabled=p.enabled;source.enabled=p.enabled&&!!source.lastImportAt;addFeed(s,actor,null,`Import ${p.enabled?'hervat':'gepauzeerd'} voor ${source.name}`);break;}
   case'source.import.revoke':{requireChief(actor);const source=managedImportSource(s,p.id);db.prepare('DELETE FROM source_import_credentials WHERE source_id=?').run(source.id);Object.assign(source,{importConfigured:false,importEnabled:false,enabled:false});addFeed(s,actor,null,`Importsleutel ingetrokken voor ${source.name}`);break;}
   case'settings.update':{requireChief(actor);if(!Number.isInteger(p.cooldownHours)||p.cooldownHours<0||p.cooldownHours>8760)fail(400,'Gebruik een geheel aantal uren tussen 0 en 8760.');if(p.cooldownUnit!==undefined&&!['hours','days'].includes(p.cooldownUnit))fail(400,'Kies uren of dagen voor de belwachttijd.');const unit=p.cooldownUnit??s.settings.cooldownUnit;s.settings.cooldownHours=p.cooldownHours;s.settings.cooldownUnit=unit;addFeed(s,actor,cid,`Globale belwachttijd ingesteld op ${unit==='days'?Number(p.cooldownHours/24)+' dagen':p.cooldownHours+' uur'}`);break;}
   case'invitation.create':{result=invite(s,actor,p);break;}
   case'invitation.rotate':{const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(p.invitationId);if(!row)fail(404,'Deze uitnodiging bestaat niet.');requireManager(actor,row.company_id);if(actor.role!=='hoofdbeheerder'&&row.role==='hoofdbeheerder')fail(403,'Je mag deze uitnodiging niet beheren.');if(row.status==='accepted')fail(409,'Deze uitnodiging is al gebruikt.');if(s.users.some(u=>u.email.toLowerCase()===row.email&&u.status==='actief'))fail(409,'Dit account is al actief.');const raw=token();db.prepare("UPDATE invitations SET token_hash=?,status='pending',created_at=?,expires_at=? WHERE id=?").run(digest(raw),Date.now(),Date.now()+INVITE_AGE,row.id);result={invitation:invitationPublic(db.prepare('SELECT * FROM invitations WHERE id=?').get(row.id),s),token:raw};break;}
   case'invitation.revoke':{const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(p.invitationId);if(!row)fail(404,'Deze uitnodiging bestaat niet.');requireManager(actor,row.company_id);if(actor.role!=='hoofdbeheerder'&&row.role==='hoofdbeheerder')fail(403,'Je mag deze uitnodiging niet beheren.');if(row.status==='accepted')fail(409,'Dit account is al geactiveerd.');db.prepare("UPDATE invitations SET status='revoked' WHERE id=?").run(row.id);break;}
   case'invitation.delete':{requireManager(actor,cid);const invitationId=text(p.invitationId,'Uitnodiging',100),row=db.prepare('SELECT * FROM invitations WHERE id=?').get(invitationId);if(!row)fail(404,'Deze uitnodiging bestaat niet.');requireManager(actor,row.company_id);if(actor.role!=='hoofdbeheerder'&&row.role==='hoofdbeheerder')fail(403,'Je mag deze uitnodiging niet beheren.');db.prepare('DELETE FROM invitations WHERE id=?').run(row.id);addFeed(s,actor,row.company_id,`Uitnodigingslink verwijderd voor ${row.name}`);break;}
   default:fail(400,'Onbekende actie.');
  }
  writeState(s);const responseActor=s.users.find(u=>u.id===actor.id);const responseCompany=responseActor.role==='hoofdbeheerder'?cid:responseActor.companyId;return{...scoped(s,responseActor,responseCompany),...(result?{result}:{})};
 });}
 const assets=new Map([['/','index.html'],['/index.html','index.html'],['/login','index.html'],['/login/','index.html'],['/app.mjs','app.mjs'],['/styles.css','styles.css'],['/model.mjs','model.mjs']]);
 const contentTypes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
 function headers(res,isApi=false){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Cache-Control',isApi?'no-store':'no-cache');if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');}
 function json(res,status,data){headers(res,true);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
 async function body(req,maxBytes=65536){if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'Gebruik een JSON-verzoek.');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes)fail(413,'Dit verzoek is te groot.');chunks.push(chunk);}let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))||'{}');}catch{fail(400,'Het verzoek bevat ongeldige gegevens.');}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail(400,'Het verzoek bevat ongeldige gegevens.');return parsed;}
 const handler=async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true});
  if(url.pathname.startsWith('/api/')){
   headers(res,true);const ip=req.socket.remoteAddress||'unknown';
   const importRoute=/^\/api\/import\/sources\/([^/]+)\/leads$/.exec(url.pathname);
   if(importRoute){
    if(req.method!=='POST')fail(405,'Deze methode is niet toegestaan.');rate(`import-auth:${ip}`,120,60000);let sourceId;try{sourceId=decodeURIComponent(importRoute[1]);}catch{fail(401,'De importsleutel is ongeldig.');}
    const auth=authorizedImport(req,sourceId);rate(`import-source:${sourceId}`,60,60000);
    try{const p=await body(req,1024*1024);return json(res,200,importBatch(auth,p));}catch(error){try{importFailure(sourceId,error);}catch{console.error('Import status could not be recorded.');}throw error;}
   }
   if(req.method==='GET'&&url.pathname==='/api/session'){const session=cookieSession(req);return json(res,200,session?sessionBody(session):{authenticated:false});}
   if(['GET','HEAD'].includes(req.method)&&url.pathname.startsWith('/api/company-logos/')){
    const session=authorized(req);let companyId;try{companyId=decodeURIComponent(url.pathname.slice('/api/company-logos/'.length));}catch{fail(404,'Dit logo bestaat niet.');}
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(companyId))fail(404,'Dit logo bestaat niet.');
    if(session.user.role!=='hoofdbeheerder'&&session.user.companyId!==companyId)fail(403,'Je kunt alleen het logo van je eigen bedrijf openen.');
    requireCompany(readState(),companyId);const logo=db.prepare('SELECT mime,bytes FROM company_logos WHERE company_id=?').get(companyId);if(!logo)fail(404,'Dit bedrijf heeft nog geen logo.');
    const bytes=Buffer.from(logo.bytes);headers(res,true);res.setHeader('Cache-Control','private, no-store');res.writeHead(200,{'Content-Type':logo.mime,'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/state'){const session=authorized(req),s=readState();return json(res,200,scoped(s,session.user,url.searchParams.get('companyId')||session.user.companyId));}
   if(req.method!=='POST')fail(405,'Deze methode is niet toegestaan.');checkOrigin(req);
   if(url.pathname==='/api/auth/login'){
    rate(`login-ip:${ip}`,60);const p=await body(req);if(p.rememberMe!==undefined&&typeof p.rememberMe!=='boolean')fail(400,'Aangemeld blijven moet aan of uit staan.');const email=emailValue(p.email);rate(`login-email:${email}`,10);const credential=db.prepare('SELECT * FROM credentials WHERE email=?').get(email);const matches=await hashWork(()=>passwordMatches(p.password,credential?.password_hash));const user=credential&&readState().users.find(u=>u.id===credential.user_id&&u.status==='actief');if(!matches||!user)fail(401,'E-mailadres of wachtwoord klopt niet.');const session=newSession(user,{rememberMe:p.rememberMe===true});setCookie(res,session.raw,{maxAge:session.cookieMaxAge});return json(res,200,sessionBody(session));
   }
   if(url.pathname==='/api/invitations/preview'){rate(`preview:${ip}`,120);const p=await body(req),row=invitationByToken(p.token);return json(res,200,{invitation:invitationPublic(row,readState())});}
   if(url.pathname==='/api/auth/activate'){
    rate(`activate:${ip}`,20);const p=await body(req),initial=invitationByToken(p.token);const name=text(p.name??initial.name,'Naam',100);const hashed=await hashWork(()=>passwordHash(p.password));
    const session=transaction(()=>{const row=invitationByToken(p.token),s=readState();if(db.prepare('SELECT user_id FROM credentials WHERE email=?').get(row.email))fail(409,'Dit account is al actief. Meld je aan.');requireCompany(s,row.company_id);let user=row.user_id?s.users.find(u=>u.id===row.user_id):null;if(!user){if(s.users.some(u=>u.email.toLowerCase()===row.email))fail(409,'Dit e-mailadres heeft al een account.');user={id:id('user'),email:row.email,companyId:row.company_id,role:row.role,status:'actief',name};s.users.push(user);}else{if(user.status==='actief')fail(409,'Dit account is al actief.');Object.assign(user,{name,email:row.email,companyId:row.company_id,role:row.role,status:'actief'});}db.prepare('INSERT INTO credentials(user_id,email,password_hash) VALUES(?,?,?)').run(user.id,user.email,hashed);db.prepare("UPDATE invitations SET status='accepted' WHERE id=?").run(row.id);writeState(s);return newSession(user);});setCookie(res,session.raw,{maxAge:session.cookieMaxAge});return json(res,200,sessionBody(session));
   }
   if(url.pathname==='/api/auth/logout'){const session=authorized(req);csrf(req,session);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);setCookie(res,'',{remove:true});return json(res,200,{authenticated:false});}
   if(url.pathname==='/api/action'){const session=authorized(req);csrf(req,session);rate(`action:${session.user.id}`,300,60000);const p=await body(req,384*1024);if(typeof p.type!=='string'||typeof p.companyId!=='string'||!p.payload||typeof p.payload!=='object'||Array.isArray(p.payload))fail(400,'Dit verzoek bevat ongeldige gegevens.');if(p.type.startsWith('invitation.'))rate(`invite:${session.user.id}`,40);return json(res,200,action(session.user,p.type,p.companyId,p.payload,publicOrigin||`${secureCookies?'https':'http'}://${req.headers.host}`));}
   fail(404,'Deze functie bestaat niet.');
  }
  if(!['GET','HEAD'].includes(req.method))fail(405,'Deze methode is niet toegestaan.');const asset=assets.get(url.pathname);if(!asset)fail(404,'Deze pagina bestaat niet.');headers(res);res.writeHead(200,{'Content-Type':contentTypes[path.extname(asset)]});res.end(req.method==='HEAD'?undefined:readFileSync(path.join(ROOT,'public',asset)));
 }catch(error){const status=error instanceof ApiError?error.status:500;if(status===500)console.error('Request failed:',error?.name||'Error');if(!res.headersSent)json(res,status,{error:status===500?'Er ging iets mis. Probeer het opnieuw.':error.message});else res.end();}};
 const server=http.createServer(handler);server.requestTimeout=30000;server.headersTimeout=15000;
 const close=()=>new Promise((resolve,reject)=>{if(server.listening){server.close(error=>{db.close();error?reject(error):resolve();});server.closeIdleConnections();}else{db.close();resolve();}});
 return{server,handler,close,maintenanceResult};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const app=createApp();const port=Number(process.env.PORT||3000);app.server.listen(port,'0.0.0.0',()=>console.log(`Bouwberichten Dashboard luistert op poort ${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
