import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,scryptSync,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createDemoState,getWorkspace,recordCall,transferUser} from './public/model.mjs';

const scrypt=promisify(scryptCallback), ROOT=path.dirname(fileURLToPath(import.meta.url));
const DAY=86400000,SESSION_AGE=7*DAY,INVITE_AGE=7*DAY;
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
 CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
 CREATE INDEX IF NOT EXISTS invitations_email ON invitations(email);`);
 const readState=()=>JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json);
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
   settings:{cooldownHours:48}
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
 function newSession(user){const raw=token(),csrf=token(),now=Date.now();db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)').run(digest(raw),user.id,csrf,now,now+SESSION_AGE);return{raw,csrf,user};}
 function setCookie(res,raw,remove=false){res.setHeader('Set-Cookie',`bouw_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove?0:SESSION_AGE/1000}${secureCookies?'; Secure':''}`);}
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
 function addFeed(s,actor,cid,message,leadId=null,type='update'){s.feed.unshift({id:id('feed'),companyId:cid,leadId,type,text:message,authorName:actor.name,at:iso(Date.now())});if(s.feed.length>10000)s.feed.length=10000;}
 function invite(s,actor,p){
  const cid=text(p.companyId,'Bedrijf',100),c=requireCompany(s,cid);requireManager(actor,cid);const name=text(p.name,'Naam',100),email=emailValue(p.email),role=p.role;
  if(!roles.includes(role)||actor.role!=='hoofdbeheerder'&&role==='hoofdbeheerder')fail(403,'Je mag deze rol niet toekennen.');
  if(s.users.some(u=>u.email.toLowerCase()===email)||db.prepare("SELECT id FROM invitations WHERE email=? AND status='pending'").get(email))fail(409,'Dit e-mailadres heeft al een account of openstaande uitnodiging. Vernieuw eventueel de bestaande link.');
  const raw=token(),now=Date.now(),iid=id('invite');db.prepare('INSERT INTO invitations(id,token_hash,email,name,company_id,role,user_id,created_at,expires_at,status,creator_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(iid,digest(raw),email,name,cid,role,null,now,now+INVITE_AGE,'pending',actor.id);const invitation=invitationPublic(db.prepare('SELECT * FROM invitations WHERE id=?').get(iid),s);addFeed(s,actor,cid,`Uitnodiging voorbereid voor ${name}`);return{invitation,token:raw};
 }
 function action(actor,type,cid,p){return transaction(()=>{
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
   case'lead.create':{const source=p.source;if(!['bouw','hotels','vve'].includes(source))fail(400,'Kies een geldige broncategorie.');const now=iso(Date.now()),lead={id:id('lead'),title:text(p.title,'Projectnaam',150),organization:text(p.organization,'Organisatie',120),city:text(p.city,'Plaats',100),source,contact:text(p.contact,'Contactpersoon',100),phone:text(p.phone,'Telefoonnummer',30),email:emailValue(p.email),description:text(p.description,'Projectomschrijving',3000),phase:'Oriëntatie',budget:'Nog niet bekend',createdAt:now,updatedAt:now,tags:['Handmatig toegevoegd'],demo:false};if(!/^[+\d ()-]{6,30}$/.test(lead.phone))fail(400,'Vul een geldig telefoonnummer in.');s.leads.unshift(lead);const w=getWorkspace(s,cid,lead.id);w.ownerId=actor.companyId===cid?actor.id:null;if(p.status){if(!company.columns.some(c=>c.id===p.status))fail(400,'Kies een geldige Kanban-status.');w.status=p.status;}s.feed.unshift({id:id('feed'),companyId:null,leadId:lead.id,type:'new',text:`Nieuwe centrale lead: ${lead.title}`,authorName:'Handmatig toegevoegd',at:now});result={lead,leadId:lead.id};break;}
   case'columns.update':{requireManager(actor,cid);if(!Array.isArray(p.columns)||p.columns.length!==company.columns.length||p.columns.length>30)fail(400,'Behoud de bestaande kolommen.');const next=p.columns.map(c=>({id:c.id,name:text(c.name,'Kolomnaam',35)}));if(next.some(c=>!company.columns.some(old=>old.id===c.id))||new Set(next.map(c=>c.id)).size!==next.length)fail(400,'De kolomindeling is ongeldig.');if(p.newColumn){if(next.length>=30)fail(400,'Gebruik maximaal 30 kolommen.');next.push({id:id('col'),name:text(p.newColumn,'Nieuwe kolom',35)});}if(new Set(next.map(c=>c.name.toLowerCase())).size!==next.length)fail(400,'Gebruik verschillende kolomnamen.');company.columns=next;addFeed(s,actor,cid,'Kanban-kolommen bijgewerkt');break;}
   case'company.create':{requireChief(actor);const name=text(p.name,'Bedrijfsnaam',120);if(s.companies.some(c=>c.name.toLowerCase()===name.toLowerCase()))fail(409,'Dit bedrijf bestaat al.');const c={id:id('company'),name,initials:name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase(),color:'#dce8ff',columns:[{id:'nieuw',name:'Nieuw'},{id:'contact',name:'In contact'},{id:'opvolgen',name:'Opvolgen'},{id:'offerte',name:'Offerte'},{id:'afgerond',name:'Afgerond'}]};s.companies.push(c);s.workspaces[c.id]={};result={company:c};break;}
   case'user.update':{const target=s.users.find(u=>u.id===p.userId);if(!target)fail(404,'Deze gebruiker bestaat niet.');if(adminPassword&&target.id==='u-admin'&&p.role!=='hoofdbeheerder')fail(400,'Dit beheeraccount moet hoofdbeheerder blijven.');if(!roles.includes(p.role))fail(400,'Kies een geldige rol.');requireCompany(s,p.companyId);if(actor.role!=='hoofdbeheerder'){requireManager(actor,target.companyId);if(p.companyId!==actor.companyId||target.role==='hoofdbeheerder'||p.role==='hoofdbeheerder')fail(403,'Je kunt alleen rollen binnen je eigen bedrijf beheren.');}if(target.role==='hoofdbeheerder'&&p.role!=='hoofdbeheerder'&&s.users.filter(u=>u.role==='hoofdbeheerder'&&u.status==='actief').length===1)fail(400,'Er moet minimaal één actieve hoofdbeheerder blijven.');transferUser(s,target.id,p.companyId);target.role=p.role;db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);addFeed(s,actor,cid,`Gebruiker bijgewerkt: ${target.name}`);break;}
   case'source.update':{requireChief(actor);const source=s.sources.find(x=>x.id===p.id);if(!source||source.id==='outlook')fail(400,'Deze bron kan niet worden aangepast.');let url='';if(p.url){try{const parsed=new URL(text(p.url,'Bron-URL',500));if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error();url=parsed.href;}catch{fail(400,'Gebruik een http(s)-URL zonder inloggegevens, tokens of queryparameters.');}}source.url=url;source.username=typeof p.username==='string'?text(p.username||' ','Gebruikersnaam',160,0):'';source.enabled=false;break;}
   case'settings.update':{requireChief(actor);if(!Number.isInteger(p.cooldownHours)||p.cooldownHours<0||p.cooldownHours>8760)fail(400,'Gebruik een geheel aantal uren tussen 0 en 8760.');s.settings.cooldownHours=p.cooldownHours;addFeed(s,actor,cid,`Globale belwachttijd ingesteld op ${p.cooldownHours} uur`);break;}
   case'invitation.create':{result=invite(s,actor,p);break;}
   case'invitation.rotate':{const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(p.invitationId);if(!row)fail(404,'Deze uitnodiging bestaat niet.');requireManager(actor,row.company_id);if(actor.role!=='hoofdbeheerder'&&row.role==='hoofdbeheerder')fail(403,'Je mag deze uitnodiging niet beheren.');if(row.status==='accepted')fail(409,'Deze uitnodiging is al gebruikt.');if(s.users.some(u=>u.email.toLowerCase()===row.email&&u.status==='actief'))fail(409,'Dit account is al actief.');const raw=token();db.prepare("UPDATE invitations SET token_hash=?,status='pending',created_at=?,expires_at=? WHERE id=?").run(digest(raw),Date.now(),Date.now()+INVITE_AGE,row.id);result={invitation:invitationPublic(db.prepare('SELECT * FROM invitations WHERE id=?').get(row.id),s),token:raw};break;}
   case'invitation.revoke':{const row=db.prepare('SELECT * FROM invitations WHERE id=?').get(p.invitationId);if(!row)fail(404,'Deze uitnodiging bestaat niet.');requireManager(actor,row.company_id);if(actor.role!=='hoofdbeheerder'&&row.role==='hoofdbeheerder')fail(403,'Je mag deze uitnodiging niet beheren.');if(row.status==='accepted')fail(409,'Dit account is al geactiveerd.');db.prepare("UPDATE invitations SET status='revoked' WHERE id=?").run(row.id);break;}
   default:fail(400,'Onbekende actie.');
  }
  writeState(s);const responseActor=s.users.find(u=>u.id===actor.id);const responseCompany=responseActor.role==='hoofdbeheerder'?cid:responseActor.companyId;return{...scoped(s,responseActor,responseCompany),...(result?{result}:{})};
 });}
 const assets=new Map([['/','index.html'],['/index.html','index.html'],['/login','index.html'],['/login/','index.html'],['/app.mjs','app.mjs'],['/styles.css','styles.css'],['/model.mjs','model.mjs']]);
 const contentTypes={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
 function headers(res,isApi=false){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Cache-Control',isApi?'no-store':'no-cache');if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=31536000');}
 function json(res,status,data){headers(res,true);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
 async function body(req){if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'Gebruik een JSON-verzoek.');let size=0,data='';for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'Dit verzoek is te groot.');data+=chunk;}let parsed;try{parsed=JSON.parse(data||'{}');}catch{fail(400,'Het verzoek bevat ongeldige gegevens.');}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail(400,'Het verzoek bevat ongeldige gegevens.');return parsed;}
 const handler=async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true});
  if(url.pathname.startsWith('/api/')){
   headers(res,true);const ip=req.socket.remoteAddress||'unknown';
   if(req.method==='GET'&&url.pathname==='/api/session'){const session=cookieSession(req);return json(res,200,session?sessionBody(session):{authenticated:false});}
   if(req.method==='GET'&&url.pathname==='/api/state'){const session=authorized(req),s=readState();return json(res,200,scoped(s,session.user,url.searchParams.get('companyId')||session.user.companyId));}
   if(req.method!=='POST')fail(405,'Deze methode is niet toegestaan.');checkOrigin(req);
   if(url.pathname==='/api/auth/login'){
    rate(`login-ip:${ip}`,60);const p=await body(req),email=emailValue(p.email);rate(`login-email:${email}`,10);const credential=db.prepare('SELECT * FROM credentials WHERE email=?').get(email);const matches=await hashWork(()=>passwordMatches(p.password,credential?.password_hash));const user=credential&&readState().users.find(u=>u.id===credential.user_id&&u.status==='actief');if(!matches||!user)fail(401,'E-mailadres of wachtwoord klopt niet.');const session=newSession(user);setCookie(res,session.raw);return json(res,200,sessionBody(session));
   }
   if(url.pathname==='/api/invitations/preview'){rate(`preview:${ip}`,120);const p=await body(req),row=invitationByToken(p.token);return json(res,200,{invitation:invitationPublic(row,readState())});}
   if(url.pathname==='/api/auth/activate'){
    rate(`activate:${ip}`,20);const p=await body(req),initial=invitationByToken(p.token);const name=text(p.name??initial.name,'Naam',100);const hashed=await hashWork(()=>passwordHash(p.password));
    const session=transaction(()=>{const row=invitationByToken(p.token),s=readState();if(db.prepare('SELECT user_id FROM credentials WHERE email=?').get(row.email))fail(409,'Dit account is al actief. Meld je aan.');requireCompany(s,row.company_id);let user=row.user_id?s.users.find(u=>u.id===row.user_id):null;if(!user){if(s.users.some(u=>u.email.toLowerCase()===row.email))fail(409,'Dit e-mailadres heeft al een account.');user={id:id('user'),email:row.email,companyId:row.company_id,role:row.role,status:'actief',name};s.users.push(user);}else{if(user.status==='actief')fail(409,'Dit account is al actief.');Object.assign(user,{name,email:row.email,companyId:row.company_id,role:row.role,status:'actief'});}db.prepare('INSERT INTO credentials(user_id,email,password_hash) VALUES(?,?,?)').run(user.id,user.email,hashed);db.prepare("UPDATE invitations SET status='accepted' WHERE id=?").run(row.id);writeState(s);return newSession(user);});setCookie(res,session.raw);return json(res,200,sessionBody(session));
   }
   if(url.pathname==='/api/auth/logout'){const session=authorized(req);csrf(req,session);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);setCookie(res,'',true);return json(res,200,{authenticated:false});}
   if(url.pathname==='/api/action'){const session=authorized(req);csrf(req,session);rate(`action:${session.user.id}`,300,60000);const p=await body(req);if(typeof p.type!=='string'||typeof p.companyId!=='string'||!p.payload||typeof p.payload!=='object'||Array.isArray(p.payload))fail(400,'Dit verzoek bevat ongeldige gegevens.');if(p.type.startsWith('invitation.'))rate(`invite:${session.user.id}`,40);return json(res,200,action(session.user,p.type,p.companyId,p.payload));}
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
