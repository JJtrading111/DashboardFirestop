import {getWorkspace,callEligibility,callOutcomeNames,reportRows,nextFollowUpAt,sortFollowUpLeads,leadSourceIds,leadMatchesSource,buildAdminOverview,effectiveLeadContact,hasLeadContact,contactFingerprint,partyContact,buildCallReport,buildControlekamer,renderControlekamer,enhanceControlekamer,updateControlekamerClock} from './model.mjs';

const PREF='bouwberichten-live-preferences-v1';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
const fmt=(v,opts={})=>v?new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam',...opts}).format(new Date(v)):'—';
const day=v=>fmt(v,{hour:undefined,minute:undefined});
const names={bouw:'Bouwberichten.nl',hotels:'Hotels',vve:'VvE',outlook:'Outlook'};
const priorityNames={high:'Hoog',medium:'Normaal',low:'Laag'};
const routes=[['dashboard','Overzicht','grid'],['leads','Alle leads','layers'],['kanban','Kanban','board'],['calls','Bellijst','phone'],['callbacks','Terugbelafspraken','calendar'],['feed','Nieuwsfeed','activity'],['reports','Rapportages','chart'],['sources','Bronnen & koppelingen','link'],['logbook','Logboek','activity'],['deleted-leads','Verwijderde leads','layers'],['all-companies','Alle bedrijven','building'],['team','Bedrijven & gebruikers','users'],['settings','Instellingen','settings']];
const icons={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',layers:'m12 3 9 5-9 5-9-5 9-5 M3 12l9 5 9-5 M3 16l9 5 9-5',board:'M3 4h18v16H3z M9 4v16 M15 4v16 M5.5 8h1 M11.5 8h1 M17.5 8h1',phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 4 4l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z',calendar:'M4 5h16v16H4z M16 3v4 M8 3v4 M4 11h16 M8 15h2 M14 15h2',activity:'M3 12h4l3-8 4 16 3-8h4',chart:'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',search:'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',plus:'M12 5v14 M5 12h14',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',chevron:'m9 5 7 7-7 7',close:'m6 6 12 12 M6 18 18 6',mail:'M3 5h18v14H3z m0 0 9 7 9-7',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',check:'m5 12 4 4L19 6',building:'M4 21V3h11v18 M15 10h5v11 M7 7h4 M7 11h4 M7 15h4 M2 21h20',download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',edit:'m15 4 5 5 M4 20l4-1L21 6l-4-4L4 15z',menu:'M3 6h18 M3 12h18 M3 18h18',shield:'m12 3 9 4v5c0 5-9 9-9 9s-9-4-9-9V7z m-4 9 3 3 5-6',spark:'m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z'};
const icon=(name)=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]||icons.layers}"/></svg>`;
let state=null,session=null,authError='',authBusy=false,authRemember=false,activation=null,activationToken=null,activationInvalid=false,loggingOut=false,authGeneration=0;
const initialFragment=new URLSearchParams(location.hash.slice(1));
if(initialFragment.has('activate')){activationToken=initialFragment.get('activate');initialFragment.delete('activate');history.replaceState(null,'',location.pathname+location.search);}
let pref;try{pref=JSON.parse(localStorage.getItem(PREF));}catch{}pref||={};
const ui={route:routes.some(r=>r[0]===location.hash.slice(1))?location.hash.slice(1):'dashboard',userId:null,companyId:pref.companyId||null,query:'',source:'all',priority:'all',status:'all',owner:'all',availability:'all',constructionFrom:'',constructionTo:'',deliveryFrom:'',deliveryTo:'',projectDateSort:null,drawer:null,modal:null,feedFilter:'all',reportCompany:'current',reportSeller:'all',reportSource:'all',reportFrom:'',reportTo:'',dismissed:pref.dismissed||[],mobile:false};
let transient=[],lastFocus=null,drawerScroll=0;
let sourceLogbookVersion=0;
const emptySourceLogbook=()=>({viewerId:null,entries:[],status:'failed',source:'all',loaded:false,loading:false,error:'',total:0,hasMore:false,workerOnline:true,busyJobId:null});
let sourceLogbook=emptySourceLogbook();
function clearSourceLogbook(){sourceLogbookVersion++;sourceLogbook=emptySourceLogbook();}
let leadDraft=null,leadReturn=null;
let adminNavigationVersion=0,adminNavigationBusy=false;
const controlekamerState={companyId:'all',type:'all',showAll:false,nextAt:0,updatedUntil:0,busy:false,error:'',view:null,values:{},knownEvents:null,freshIds:[],mounted:false};
Object.assign(ui,{adminCompany:'all',adminPeriod:'7d',adminType:'notes-status',adminActivityLimit:30,adminAttentionLimit:6,adminReturn:null,adminCallsPeriod:'today',adminCompanyDetails:false,deletedLeadQuery:''});
function defaultCallReportDates(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));const to=parts.year+'-'+parts.month+'-'+parts.day;return{from:new Date(Date.parse(to+'T12:00:00Z')-29*86400000).toISOString().slice(0,10),to};}
Object.assign(ui,{reportView:'calls',callReportCompany:'all',callReportSeller:'all',callReportGroupBy:'day',callReportFrom:defaultCallReportDates().from,callReportTo:defaultCallReportDates().to});
const leadContactFields=['contactName','contactEmail','contactPhone'];
const leadFields=['status','priority','ownerId','commitment','calculation',...leadContactFields];
const currentUser=()=>state.users.find(x=>x.id===ui.userId)||state.users[0];
const isChief=()=>currentUser().role==='hoofdbeheerder';
const isAdminOverview=()=>!!state&&isChief()&&['dashboard','all-companies'].includes(ui.route);
const isControlekamer=()=>!!state&&isChief()&&ui.route==='dashboard';
const canManage=()=>isChief()||currentUser().role==='bedrijfsbeheerder';
const company=()=>state.companies.find(x=>x.id===ui.companyId)||state.companies[0]||{id:null,name:'Hoofdbeheer',initials:'HB',columns:[],color:'#dce8ff'};
const activeUsers=()=>state.users.filter(u=>u.companyId===company().id&&u.status!=='uitgenodigd');
const userName=id=>state.users.find(x=>x.id===id)?.name||'Niet toegewezen';
const work=l=>getWorkspace(state,company().id,typeof l==='string'?l:l.id);
const reportingCompanies=()=>[...state.companies,...(isChief()?state.archivedCompanies||[]:[])];
const reportingCompanyOptions=()=>reportingCompanies().map(c=>[c.id,c.name+(state.companies.some(active=>active.id===c.id)?'':' (verwijderd)')]);
const companyName=id=>reportingCompanies().find(c=>c.id===id)?.name||'Onbekend bedrijf';
const accountCompanyName=account=>!account.companyId&&account.role==='hoofdbeheerder'?'Alle bedrijven':companyName(account.companyId);
const companyLogoSource=c=>typeof c?.logoUrl==='string'&&c.logoUrl.startsWith('/api/company-logos/')?c.logoUrl:null;
function companyLogoMarkup(c){const src=companyLogoSource(c);return src?`<span class="company-logo has-image"><img class="company-logo-image" src="${esc(src)}" alt="Logo van ${esc(c.name)}" loading="lazy"></span>`:`<span class="company-logo" style="background:${esc(c.color||'#dce8ff')}">${esc(c.initials||c.name.slice(0,2))}</span>`;}
function dashboardBrand(){const c=company(),src=companyLogoSource(c);return `<span class="brand-mark ${src?'has-company-logo':''}">${src?`<img class="dashboard-company-logo" src="${esc(src)}" alt="Logo van ${esc(c.name)}">`:icon('building')}</span><span>${esc(c.name)}<small>Dashboard</small></span>`;}
function mobileCompanyLogo(){const c=company(),src=companyLogoSource(c);return src?`<img class="mobile-company-logo" src="${esc(src)}" alt="Logo van ${esc(c.name)}">`:'';}
function companyEditorHTML(c){return modalShell('Bedrijf bewerken',`<form id="company-edit-form"><input type="hidden" name="companyId" value="${esc(c.id)}"><label class="field"><span>Bedrijfsnaam</span><input name="name" required maxlength="120" value="${esc(c.name)}" autocomplete="organization"></label><div class="company-logo-editor"><div class="company-logo-preview" aria-label="Voorbeeld bedrijfslogo"></div><div class="company-logo-controls"><label class="field"><span>Bedrijfslogo</span><input class="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp" data-company-logo aria-describedby="logo-upload-note"></label><p class="logo-upload-note" id="logo-upload-note">PNG, JPG of WebP, maximaal 5 MB. We verkleinen het bestand automatisch.</p>${btn('Logo verwijderen','remove-company-logo','ghost small')}<p class="company-logo-status" aria-live="polite"></p></div></div><p class="muted help-text">Het logo verschijnt linksboven in het dashboard van dit bedrijf, ook wanneer gebruikers opnieuw inloggen.</p>${formButtons('Wijzigingen opslaan')}</form>`);}
function updateCompanyLogoPreview(){
 const m=ui.modal;if(m?.type!=='edit-company')return;
 const c=state.companies.find(item=>item.id===m.id),preview=$('.company-logo-preview'),status=$('.company-logo-status');
 if(preview)preview.innerHTML=m.logoDraft?`<img src="${esc(m.logoDraft)}" alt="Voorbeeld van het bedrijfslogo">`:`<span>${esc(c?.initials||'Logo')}</span>`;
 if(status){status.textContent=m.logoBusy?'Logo voorbereiden…':m.logoError||'';status.setAttribute('role',m.logoError?'alert':'status');}
 const submit=$('#company-edit-form [type=submit]');if(submit)submit.disabled=!!m.logoBusy;
 const remove=$('[data-action="remove-company-logo"]');if(remove)remove.disabled=!!m.logoBusy||!m.logoDraft;
 const file=$('[data-company-logo]');if(file)file.disabled=!!m.logoBusy;
}
async function prepareCompanyLogo(file){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Kies een PNG-, JPG- of WebP-afbeelding.');
 if(file.size>5*1024*1024)throw Error('Kies een afbeelding van maximaal 5 MB.');
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('De afbeelding kon niet worden gelezen.'));reader.readAsDataURL(file);});
 const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Deze afbeelding kan niet worden geopend. Kies een ander bestand.'));img.src=data;});
 if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>12000||image.naturalHeight>12000)throw Error('Kies een kleinere, geldige afbeelding.');
 let scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('Je browser kan dit logo niet voorbereiden.');
 for(let attempt=0;attempt<5;attempt++){
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const png=canvas.toDataURL('image/png');if(png.length*3/4<=192*1024)return png;
  const webp=canvas.toDataURL('image/webp',0.9);if(webp.length*3/4<=192*1024)return webp;
  scale*=0.75;
 }
 throw Error('Het logo blijft te groot. Kies een kleinere afbeelding.');
}
const statusName=id=>company().columns.find(c=>c.id===id)?.name||'Nieuw';
function save(){try{localStorage.setItem(PREF,JSON.stringify({companyId:ui.companyId,dismissed:ui.dismissed}));}catch{}}
let mutationQueue=Promise.resolve(),pendingMutations=0,refreshVersion=0,lastSync=null;
async function api(path,{method='GET',body,publicRequest=false,csrfToken=session?.csrfToken,signal}={}){
 const requestSession=session,requestGeneration=authGeneration;
 const headers={Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(csrfToken&&method!=='GET')headers['X-CSRF-Token']=csrfToken;
 let response;try{response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',...(signal?{signal}:{})});}catch{throw Error('Geen verbinding met de server. Probeer het opnieuw.');}
 const result=await response.json().catch(()=>({error:'De server gaf geen geldig antwoord.'}));
 if(!response.ok){if(response.status===401&&!publicRequest&&!loggingOut&&requestGeneration===authGeneration&&session===requestSession){session=null;state=null;refreshVersion++;ui.modal=null;ui.drawer=null;authError='Je sessie is verlopen. Log opnieuw in.';renderAuth();}const error=Error(result.error||'De actie kon niet worden uitgevoerd.');error.status=response.status;throw error;}
 return result;
}
function applyServer(result){if(!session?.authenticated)throw Error('Je sessie is verlopen. Log opnieuw in.');state=result.state;ui.userId=result.userId;ui.companyId=result.companyId;lastSync=new Date();save();markControlekamerSync();}
async function refreshState(companyId=ui.companyId,{renderPage=true,force=false,preserveEditing=false}={}){
 if(loggingOut||!session?.authenticated||(!force&&pendingMutations))return;
 const version=++refreshVersion;
 const actorSession=session;let result,recoveredCompany=false;
 try{result=await api('/api/state'+(companyId?'?companyId='+encodeURIComponent(companyId):''));}
 catch(error){if(error.status!==404||!companyId||loggingOut||version!==refreshVersion||session!==actorSession||session?.user?.role!=='hoofdbeheerder')throw error;result=await api('/api/state');recoveredCompany=!result.state.companies.some(c=>c.id===companyId);}
 if(loggingOut||version!==refreshVersion||session!==actorSession||!session?.authenticated)return;
 applyServer(result);
 if(recoveredCompany){ui.modal=null;ui.drawer=null;leadDraft=null;leadReturn=null;ui.adminReturn=null;resetFilters();if(ui.adminCompany===companyId)ui.adminCompany='all';}
 if(ui.drawer&&!state.leads.some(lead=>lead.id===ui.drawer)){ui.modal=null;leadDraft=null;closeLeadDrawer({saved:true});toast('Deze lead is voor alle bedrijven verwijderd. De rapportages blijven bewaard.');return result;}
 if(ui.modal&&['callback','call-outcome','project-photo','select-party-contact','delete-lead'].includes(ui.modal.type)&&ui.modal.id&&!state.leads.some(lead=>lead.id===ui.modal.id)){ui.modal=null;render();return result;}
 const editing=ui.modal||ui.drawer||document.activeElement?.matches('input,select,textarea');
 if(recoveredCompany||renderPage&&!(preserveEditing&&editing))render();else{if(ui.route==='deleted-leads')renderDeletedLeadResults();if(preserveEditing&&ui.modal?.type==='source-scraper')renderOverlay();renderToasts();}
 return result;
}
function mutate(type,payload={},targetCompany=ui.companyId||''){
 const actorSession=session,generation=authGeneration;
 pendingMutations++;
 refreshVersion++;
 const job=mutationQueue.then(async()=>{
  if(loggingOut||generation!==authGeneration||!actorSession?.authenticated||session!==actorSession)throw Error('Je sessie is gewijzigd. Voer de actie opnieuw uit.');
  const result=await api('/api/action',{method:'POST',body:{type,companyId:targetCompany,payload}});
  if(loggingOut||generation!==authGeneration||session!==actorSession)throw Error('Je sessie is gewijzigd. Voer de actie opnieuw uit.');
  applyServer(result);
  return result;
 });
 mutationQueue=job.catch(()=>{});
 return job.finally(()=>{pendingMutations--;});
}
async function switchCompany(id){
 if(!isChief())throw Error('Je kunt alleen je eigen bedrijf openen.');
 await mutationQueue;ui.drawer=null;ui.modal=null;ui.reportSeller='all';resetFilters();await refreshState(id,{force:true});
}
function showInviteLink(result){
 const details=result.result||{};
 if(!details.token)throw Error('De uitnodiging is opgeslagen, maar de link ontbreekt. Maak een nieuwe link.');
 const inviteUrl=location.origin+'/#activate='+encodeURIComponent(details.token);
 openModal('invite-link',null,{inviteUrl,invitation:details.invitation});
}
function passwordField(name,label,activating){
 const inputId='auth-'+name;
 return `<div class="field"><label for="${inputId}">${esc(label)}</label><div class="password-field"><input id="${inputId}" name="${name}" type="password" required ${activating?'minlength="12" autocomplete="new-password" aria-describedby="activation-password-requirements activation-password-error" aria-invalid="false"':'autocomplete="current-password"'} maxlength="256"><button type="button" class="button ghost password-toggle" data-action="toggle-password" aria-controls="${inputId}" aria-pressed="false" aria-label="${esc(label)} tonen">Tonen</button></div></div>`;
}
function activationPasswordRequirements(){
 return '<section id="activation-password-requirements" aria-label="Voorwaarden voor je wachtwoord"><strong>Voorwaarden voor je wachtwoord</strong><ul aria-live="polite"><li data-password-rule="length" data-state="pending"><span data-rule-text>Minimaal 12 en maximaal 256 tekens.</span></li><li data-password-rule="match" data-state="pending"><span data-rule-text>Herhaal precies hetzelfde wachtwoord.</span></li></ul></section><p id="activation-password-error" data-activation-password-error role="alert" hidden></p>';
}
function showActivationError(form,message){const error=form.querySelector('[data-activation-password-error]');if(error){if(error.textContent!==message)error.textContent=message;error.hidden=!message;}}
function updateActivationPasswordFeedback(form,{submitted=false,editedField=''}={}){
 if(form?.getAttribute('id')!=='activation-form')return false;
 if(submitted)form.dataset.activationSubmitted='true';
 if(editedField==='password')form.dataset.passwordEdited='true';if(editedField==='passwordConfirm')form.dataset.confirmEdited='true';
 const password=form.querySelector('[name="password"]'),confirmation=form.querySelector('[name="passwordConfirm"]'),name=form.querySelector('[name="name"]');if(!password||!confirmation)return false;
 const attempted=form.dataset.activationSubmitted==='true',lengthOK=password.value.length>=12&&password.value.length<=256,matchOK=!!confirmation.value&&password.value===confirmation.value;
 const lengthState=lengthOK?'valid':attempted||password.value||form.dataset.passwordEdited?'invalid':'pending';
 const matchState=matchOK?'valid':attempted||confirmation.value||form.dataset.confirmEdited?'invalid':'pending';
 const rule=(key,value,text)=>{const node=form.querySelector('[data-password-rule="'+key+'"]');if(node){node.dataset.state=value;const label=node.querySelector('[data-rule-text]');if(label.textContent!==text)label.textContent=text;}};
 rule('length',lengthState,lengthState==='valid'?'Minimaal 12 en maximaal 256 tekens: in orde.':lengthState==='invalid'?'Minimaal 12 en maximaal 256 tekens: nog niet in orde.':'Minimaal 12 en maximaal 256 tekens.');
 rule('match',matchState,matchState==='valid'?'De twee wachtwoorden zijn gelijk.':matchState==='invalid'?(confirmation.value?'De twee wachtwoorden zijn niet gelijk.':'Herhaal het wachtwoord ook in het tweede veld.'):'Herhaal precies hetzelfde wachtwoord.');
 password.setAttribute('aria-invalid',String(lengthState==='invalid'));confirmation.setAttribute('aria-invalid',String(matchState==='invalid'));
 const nameOK=!!name?.value.trim()&&name.value.trim().length<=100;if(name&&attempted){name.setAttribute('aria-invalid',String(!nameOK));name.setAttribute('aria-describedby','activation-password-error');}
 const message=attempted&&!nameOK?'Vul je naam in (maximaal 100 tekens).':lengthState==='invalid'?(password.value.length>256?'Je wachtwoord is te lang. Gebruik maximaal 256 tekens.':password.value?'Je wachtwoord is te kort. Gebruik minimaal 12 tekens.':'Vul een wachtwoord in van 12 tot 256 tekens.'):matchState==='invalid'?(confirmation.value.length>256?'Het herhaalde wachtwoord is te lang. Gebruik maximaal 256 tekens.':confirmation.value?'De wachtwoorden komen niet overeen. Vul in beide velden hetzelfde wachtwoord in.':'Herhaal je wachtwoord in het tweede veld.') :'';
 showActivationError(form,message);
 if(submitted&&message)(!nameOK?name:!lengthOK?password:confirmation)?.focus();
 return nameOK&&lengthOK&&matchOK;
}
function authMarkup(){
 const activating=!!activationToken,invalid=activating&&activationInvalid;
 const intro='<main id="main" class="auth-shell" tabindex="-1"><section class="auth-intro"><div class="brand"><span class="brand-mark">'+icon('building')+'</span><span>Bouwberichten<small>Dashboard</small></span></div></section><section class="auth-card"><span class="badge blue">'+(activating?'Uitnodiging':'Jouw werkplek')+'</span><h1 class="auth-title">'+(activating?'Welkom bij het team':'Log in op je dashboard')+'</h1><p>'+(activating?'Activeer je account met deze persoonlijke uitnodiging.':'Gebruik het e-mailadres en wachtwoord van je geactiveerde account.')+'</p>'+(authError?'<div class="auth-error" role="alert">'+esc(authError)+'</div>':'');
 let content;
 if(invalid)content='<p>Vraag de beheerder om een nieuwe uitnodigingslink. Een link werkt één keer en heeft een vervaldatum.</p><button class="button secondary" data-action="show-login">Naar inloggen</button>';
 else if(activating&&!activation)content='<p role="status">Uitnodiging controleren…</p>';
 else content='<form id="'+(activating?'activation-form':'login-form')+'"'+(activating?' novalidate':'')+'>'+(activating?'<div class="invitation-summary"><strong>'+esc(activation.companyName)+'</strong><span>'+esc(activation.role)+'</span><span>Geldig tot '+fmt(activation.expiresAt)+'</span></div><label class="field"><span>Je naam</span><input name="name" required maxlength="100" autocomplete="name" value="'+esc(activation.name)+'"></label>':'')+'<label class="field"><span>E-mailadres</span><input name="email" type="email" required maxlength="160" autocomplete="username" '+(activating?'readonly value="'+esc(activation.email)+'"':'')+'></label>'+passwordField('password',activating?'Kies een wachtwoord':'Wachtwoord',activating)+(activating?passwordField('passwordConfirm','Herhaal je wachtwoord',true)+activationPasswordRequirements()+'<p class="muted help-text">'+(activation.role==='hoofdbeheerder'?'Als hoofdbeheerder heb je toegang tot alle bedrijven.':'Je account is gekoppeld aan '+esc(activation.companyName)+'.')+'</p>':'<label class="remember-login"><input name="rememberMe" type="checkbox" value="true" '+(authRemember?'checked':'')+'><span>Aangemeld blijven<small>30 dagen op dit apparaat</small></span></label><p class="muted help-text">Nog geen account of je wachtwoord vergeten? Vraag je beheerder om hulp.</p>')+'<button type="submit" class="button primary auth-submit" '+(authBusy?'disabled':'')+'>'+(authBusy?'Even geduld…':activating?'Account activeren':'Inloggen')+'</button></form>';
 return intro+content+'<div class="auth-bottom">'+icon('shield')+' Alleen toegang na een uitnodiging.</div></section></main>';
}
function renderAuth(){resetControlekamerRuntime();document.body.classList.remove('ck-dashboard');clearSourceLogbook();document.body.classList.remove('overlay-open');$('#overlay-root').innerHTML='';$('#toast-root').innerHTML='';$('#app').innerHTML=authMarkup();}
function updateLogoutUI(){
 const root=$('.modal');if(!root||ui.modal?.type!=='account')return;
 const button=root.querySelector('[data-action="logout"]'),close=root.querySelectorAll('[data-action="close-modal"]'),error=root.querySelector('[data-logout-error]');
 if(button){button.disabled=loggingOut;button.textContent=loggingOut?'Uitloggen…':'Uitloggen';button.setAttribute('aria-busy',String(loggingOut));}
 close.forEach(button=>{button.disabled=loggingOut;});
 if(error){error.textContent=ui.modal.logoutError||'';error.hidden=!ui.modal.logoutError;}
}
async function logout(){
 if(loggingOut)return;
 loggingOut=true;authGeneration++;refreshVersion++;if(ui.modal?.type==='account')ui.modal.logoutError='';updateLogoutUI();
 try{
  const signal=AbortSignal.timeout(15000);
  // A different tab may have renewed the browser cookie since this page loaded.
  const latest=await api('/api/session',{publicRequest:true,signal});
  const result=await api('/api/auth/logout',{method:'POST',body:{},publicRequest:true,csrfToken:latest.authenticated?latest.csrfToken:null,signal});
  if(result.authenticated!==false)throw Error('Uitloggen is niet bevestigd. Probeer het opnieuw.');
  session=null;state=null;refreshVersion++;authGeneration++;activation=null;activationToken=null;activationInvalid=false;authError='';authBusy=false;authRemember=false;
  ui.route='dashboard';ui.userId=null;ui.companyId=null;ui.drawer=null;ui.modal=null;ui.mobile=false;ui.dismissed=[];Object.assign(ui,{adminCompany:'all',adminPeriod:'7d',adminType:'notes-status',adminActivityLimit:30,adminAttentionLimit:6,adminReturn:null,adminCallsPeriod:'today',adminCompanyDetails:false,deletedLeadQuery:''});resetFilters();
  transient=[];leadDraft=null;leadReturn=null;lastFocus=null;lastSync=null;clearSourceLogbook();
  try{localStorage.removeItem(PREF);}catch{}
  renderAuth();location.replace('/');
 }catch(error){
  loggingOut=false;
  if(ui.modal?.type==='account'){ui.modal.logoutError=error.message||'Uitloggen is niet gelukt. Probeer het opnieuw.';updateLogoutUI();}
  else if(state)toast(error.message||'Uitloggen is niet gelukt. Probeer het opnieuw.','amber');
 }
}
async function initialize(){
 $('#app').innerHTML='<div class="app-loading" role="status">Bouwberichten Dashboard laden…</div>';
 try{
  if(activationToken){try{const response=await api('/api/invitations/preview',{method:'POST',body:{token:activationToken},publicRequest:true});activation=response.invitation;}catch(error){authError=error.message;activationInvalid=true;}renderAuth();return;}
  session=await api('/api/session',{publicRequest:true});
  if(session.authenticated){if(location.pathname==='/login'||location.pathname==='/login/')history.replaceState(null,'','/#'+ui.route);if(session.user?.role!=='hoofdbeheerder'||!ui.companyId)ui.companyId=session.user.companyId;await refreshState(ui.companyId,{force:true});}else renderAuth();
 }catch(error){authError=error.message;renderAuth();}
}
async function authenticate(form,data){
 if(authBusy)return;
 const activating=form.getAttribute('id')==='activation-form';if(!activating)authRemember=data.rememberMe==='true';
 if(activating&&!updateActivationPasswordFeedback(form,{submitted:true}))return;
 authBusy=true;authError='';const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Even geduld…';
 if(activating){showActivationError(form,'');form.querySelectorAll('input,button').forEach(control=>{control.dataset.authWasDisabled=String(control!==submit&&control.disabled);control.disabled=true;});}
 try{
  session=await api(activating?'/api/auth/activate':'/api/auth/login',{method:'POST',body:activating?{token:activationToken,name:data.name,password:data.password}:{email:data.email,password:data.password,rememberMe:authRemember},publicRequest:true});
  if(activating)form.querySelectorAll('input[type="password"],input[name="password"],input[name="passwordConfirm"]').forEach(input=>{input.value='';});
  activationToken=null;activation=null;authBusy=false;if(location.pathname==='/login'||location.pathname==='/login/')history.replaceState(null,'','/#'+ui.route);ui.companyId=session.user?.companyId||null;ui.drawer=null;ui.modal=null;await refreshState(ui.companyId,{force:true});
 }catch(error){
  authBusy=false;authError=error.message;
  if(activating&&activationToken&&form.isConnected){form.querySelectorAll('[data-auth-was-disabled]').forEach(control=>{control.disabled=control.dataset.authWasDisabled==='true';delete control.dataset.authWasDisabled;});submit.textContent='Account activeren';showActivationError(form,error.message||'Je account kon niet worden geactiveerd. Probeer het opnieuw.');}
  else renderAuth();
 }finally{delete data.password;delete data.passwordConfirm;}
}
function toast(text,tone='green'){if(loggingOut)return;const id=uid('toast');transient.push({id,text,tone});renderToasts();setTimeout(()=>{transient=transient.filter(t=>t.id!==id);renderToasts();},6500);}
function callbacks(){if(!company().id)return[];return state.leads.flatMap(l=>work(l).callbacks.map(cb=>({...cb,lead:l}))).filter(c=>!c.done).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));}
function eligible(l){return callEligibility(state,l.id,company().id,currentUser().id);}
const projectDateColumns={scheduleStart:'Start bouw',scheduleEnd:'Oplevering'};
const isProjectDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'');
function matchesProjectDate(date,from,to){
 if(!from&&!to)return true;
 return isProjectDate(date)&&(!from||date>=from)&&(!to||date<=to);
}
function leadSearchText(lead){
 let projectId='';
 try{const url=new URL(lead.sourceUrl),match=/^\/projecten\/(\d{1,16})\/?$/.exec(url.pathname);if(url.origin==='https://portal.bouwberichten.nl'&&!url.username&&!url.password&&match)projectId=match[1];}catch{}
 const externalId=String(lead.importExternalId??'');
 return [lead.title,lead.organization,lead.city,lead.contact,...(lead.tags??[]),externalId.startsWith('url:')?'':externalId,projectId].join(' ').toLowerCase();
}
function filteredLeads(){
 const dateList=ui.route==='leads'||ui.route==='calls',sort=dateList?ui.projectDateSort:null;
 const query=ui.query.trim().toLowerCase();
 return state.leads.filter(l=>{const w=work(l);return (!dateList||(matchesProjectDate(l.projectDetails?.scheduleStart,ui.constructionFrom,ui.constructionTo)&&matchesProjectDate(l.projectDetails?.scheduleEnd,ui.deliveryFrom,ui.deliveryTo)))&&(!query||leadSearchText(l).includes(query))&&(ui.source==='all'||leadMatchesSource(l,ui.source))&&(ui.priority==='all'||w.priority===ui.priority)&&(ui.status==='all'||w.status===ui.status)&&(ui.owner==='all'||w.ownerId===(ui.owner==='me'?currentUser().id:ui.owner))&&(ui.availability==='all'||eligible(l).allowed);}).sort((a,b)=>{
  if(sort){
   const first=a.projectDetails?.[sort.field],second=b.projectDetails?.[sort.field];
   const firstKnown=isProjectDate(first),secondKnown=isProjectDate(second);
   if(firstKnown!==secondKnown)return firstKnown?-1:1;
   if(firstKnown&&first!==second)return (first<second?-1:1)*(sort.direction==='asc'?1:-1);
  }
  return ({high:0,medium:1,low:2}[work(a).priority]-{high:0,medium:1,low:2}[work(b).priority])||new Date(b.updatedAt)-new Date(a.updatedAt);
 });
}
function navTo(route){adminNavigationVersion++;ui.route=route;ui.drawer=null;ui.modal=null;ui.mobile=false;location.hash=route;render();}
function btn(text,action,style='secondary',extra=''){return `<button type="button" class="button ${style}" data-action="${action}" ${extra}>${text}</button>`;}
const activeSources=()=>state.sources.filter(s=>!s.deleted);
const leadSources=()=>activeSources().filter(s=>s.id!=='outlook'&&s.kind!=='mail');
const sourceName=id=>state?.sources.find(s=>s.id===id)?.name||names[id]||'Onbekende bron';
function leadSourceOptions(){return state.sources.filter(s=>s.id!=='outlook'&&s.kind!=='mail'&&(!s.deleted||state.leads.some(l=>leadMatchesSource(l,s.id)))).map(s=>[s.id,s.name+(s.deleted?' (verwijderd)':'')]);}
function sourceBadge(source){return `<span class="source-chip source-${esc(source)}">${esc(sourceName(source))}</span>`;}

function leadSourceBadges(l){return '<span class="lead-source-badges">'+leadSourceIds(l).map(sourceBadge).join('')+'</span>';}
function sourceProvider(s){return s?.provider==='bouwberichten'||!s?.provider&&s?.id==='bouw'?'bouwberichten':'generic';}
function sourceFilterURL(s){try{const url=new URL(s.filterUrl);return url.protocol==='https:'&&url.hostname==='portal.bouwberichten.nl'&&!url.username&&!url.password&&url.pathname.replace(/\/$/,'')==='/projecten'&&url.hash?url.href:'';}catch{return '';}}
function sourceFilterHTML(s,live=false){
 if(sourceProvider(s)!=='bouwberichten')return '';
 const url=sourceFilterURL(s),summary=typeof s.filterSummary==='string'?s.filterSummary:'';
 return '<div class="source-filter"><strong>Opgeslagen Bouwfilter</strong><p '+(live?'data-scraper-filter-summary':'')+'>'+esc(summary||'Nog geen filterlink ingesteld.')+'</p>'+(url||live?'<a class="source-filter-link" '+(url?'href="'+esc(url)+'"':'hidden')+' '+(live?'data-scraper-filter-link':'')+' target="_blank" rel="noopener noreferrer"><span>Open filter in Bouwberichten '+icon('link')+'</span><small '+(live?'data-scraper-filter-url':'')+'>'+esc(url)+'</small></a>':'')+'</div>';
}
function sourceEditorHTML(s=null,draft={}){
 const values=s||draft,provider=sourceProvider(values),bouw=provider==='bouwberichten';
 return modalShell(s?'Bron configureren':'Bron toevoegen','<form id="source-form">'+(s?'<input type="hidden" name="id" value="'+esc(s.id)+'">':'')+'<label class="field"><span>Naam van de bron</span><input name="name" required maxlength="120" value="'+esc(values.name||'')+'" placeholder="'+(bouw?'Bouwberichten – Gegund vanaf 01-01-2026':'Bijv. Woningcorporaties')+'"></label><label class="field"><span>Soort bron</span><select name="provider" data-source-provider><option value="generic" '+(!bouw?'selected':'')+'>Algemene bron</option><option value="bouwberichten" '+(bouw?'selected':'')+'>Bouwberichten.nl (filter)</option></select></label><div class="source-filter-fields" data-bouw-filter-fields '+(!bouw?'hidden':'')+'><label class="field"><span>Filterlink (optioneel)</span><textarea name="filterUrl" rows="4" maxlength="16000" placeholder="https://portal.bouwberichten.nl/projecten#projects[filters]..." aria-describedby="source-filter-help" '+(!bouw?'disabled':'')+'>'+esc(values.filterUrl||'')+'</textarea></label><p class="source-filter-help" id="source-filter-help">Kopieer de link nadat de filters zijn gekozen. De link moet de filtercriteria bevatten; alleen een opgeslagen zoekopdracht is niet genoeg. Maak voor iedere selectie een eigen bron, bijvoorbeeld ‘Bouwberichten – Gegund vanaf 01-01-2026’.</p></div><label class="field"><span>Bron-URL (optioneel)</span><input name="url" type="url" value="'+esc(values.url||(bouw?'https://portal.bouwberichten.nl/projecten':''))+'" placeholder="https://..." maxlength="500"></label><label class="field"><span>Gebruikersnaam (optioneel)</span><input name="username" value="'+esc(values.username||'')+'" autocomplete="off" maxlength="160"></label><div class="info-box"><strong>Een eigen selectie per bron</strong><p>Een bron of filterlink opslaan start geen import. Iedere bron krijgt eigen importinstellingen en een eigen token. Een project dat in meerdere filters voorkomt, houdt dezelfde notities, belgeschiedenis en opvolging per bedrijf.</p></div>'+formButtons(s?'Voorbereiding opslaan':'Bron toevoegen')+'</form>');
}


function sourceImportStatus(s){
 if(s.id==='outlook'||s.kind==='mail')return {label:'Toekomstig',tone:'neutral'};
 if(!s.importConfigured)return {label:'Niet gekoppeld',tone:'amber'};
 if(!s.importEnabled)return {label:'Gepauzeerd',tone:'neutral'};
 return s.lastImportAt?{label:'Import actief',tone:'green'}:{label:'Import gereed',tone:'blue'};
}
function importCountSummary(counts){return ['created','updated','unchanged'].map((key,i)=>Number(counts[key]||0)+' '+['nieuw','bijgewerkt','ongewijzigd'][i]).join(' · ')+(counts.excluded?' · '+Number(counts.excluded)+' uitgesloten na verwijderen':'');}
function sourceImportSummary(s){
 const counts=s.lastImportCounts;
 return '<div class="import-summary"><span>'+(s.lastImportAt?'Laatste import: '+esc(fmt(s.lastImportAt)):'Nog geen leads geïmporteerd')+'</span>'+(counts?'<span>'+importCountSummary(counts)+'</span>':'')+'</div>'+(s.lastImportError?'<p class="import-error" role="status">Laatste import mislukt: '+esc(s.lastImportError)+'</p>':'');
}
function sourceImportHTML(s,m){
 const status=sourceImportStatus(s),endpoint=m.importUrl||location.origin+'/api/import/sources/'+encodeURIComponent(s.id)+'/leads';
 const example=JSON.stringify({runId:'proef-1',items:[{externalId:'project-123',title:'Renovatie hotel',organization:'Hotel Voorbeeld',city:'Utrecht',sourceUrl:'https://voorbeeld.nl/project/123'}]},null,2);
 return modalShell('Import instellen · '+esc(s.name),'<div class="source-import-status"><span class="badge '+status.tone+'">'+status.label+'</span></div><p>Een connector kan leads naar deze bron sturen met een eigen importtoken. Het importadres gebruikt dit token, zonder beheerlogin van het dashboard. Een eventuele bronlogin stel je afzonderlijk in bij de scraper. Een token maken haalt nog geen gegevens op.</p>'+sourceFilterHTML(s)+'<div class="import-connection"><label class="field" for="source-import-url"><span>Importadres · POST met JSON</span></label><div class="import-copy-row"><input id="source-import-url" type="text" readonly value="'+esc(endpoint)+'" autocomplete="off" spellcheck="false">'+btn('Kopiëren','copy-import-url')+'</div><p class="import-help">Dit adres accepteert alleen leads voor '+esc(s.name)+'. Gebruik in je connector de header <code>Authorization: Bearer &lt;importtoken&gt;</code>.</p></div>'+(m.importToken?'<div class="import-token-box"><label class="field" for="source-import-token"><span>Nieuw importtoken · alleen nu zichtbaar</span></label><div class="import-copy-row"><input id="source-import-token" type="text" readonly value="'+esc(m.importToken)+'" autocomplete="off" spellcheck="false">'+btn('Token kopiëren','copy-import-token','primary')+'</div><p class="import-help">Bewaar dit token veilig bij je connector. Na het sluiten kun je het niet opnieuw bekijken.</p></div>':'')+'<div class="source-import-actions">'+btn(s.importConfigured?'Importtoken vernieuwen':'Importtoken maken','rotate-source-import','primary','data-id="'+esc(s.id)+'"')+'</div><p class="import-help">'+(s.importConfigured?'Een nieuw token maakt het vorige direct ongeldig. Werk je connector daarna bij.':'Het token geeft alleen toegang tot de import van deze bron, zonder toegang tot accounts, notities of belgegevens.')+'</p>'+sourceImportSummary(s)+'<details class="import-example"><summary>Voorbeeld voor je connector</summary><p class="import-help">Geef elk project een vast <code>externalId</code>. Herhaal dezelfde aanlevering met dezelfde <code>runId</code>; een nieuwe aanlevering krijgt een nieuwe run-ID. Contactgegevens zijn optioneel.</p><pre>'+esc(example)+'</pre></details>','<div class="source-import-footer">'+(s.importConfigured?btn(s.importEnabled?'Import pauzeren':'Import hervatten','toggle-source-import','secondary','data-id="'+esc(s.id)+'"')+btn('Token intrekken','revoke-source-import','danger','data-id="'+esc(s.id)+'"'):'')+btn('Sluiten','close-modal')+'</div>');
}


function sourceScraperStatus(s){
 const scraper=s.scraper||{};if(!scraper.available)return {label:'Nog niet beschikbaar',tone:'neutral'};
 const test=scraper.jobMode==='test'||!scraper.jobMode&&!scraper.lastTestPassed;
 return {not_configured:{label:'Login vereist',tone:'amber'},ready:{label:'Klaar',tone:'blue'},queued:{label:test?'Proef ingepland':'Ophalen ingepland',tone:'blue'},running:{label:test?'Proef bezig':'Ophalen bezig',tone:'blue'},test_passed:{label:'Proef geslaagd',tone:'green'},active:{label:'Actief',tone:'green'},login_required:{label:'Login vereist',tone:'amber'},error:{label:'Fout bij ophalen',tone:'red'}}[scraper.status]||{label:'Login vereist',tone:'amber'};
}
function sourceScraperCardHTML(s){if(!isChief()||sourceProvider(s)!=='bouwberichten')return '';const status=sourceScraperStatus(s);return '<div class="scraper-card-status"><span>Automatisch ophalen</span><span class="badge '+status.tone+'">'+status.label+'</span></div>';}
function manualScrapeBlock(s){
 const scraper=s.scraper||{};
 if(['queued','running'].includes(scraper.status))return 'Er staat al een ophaalronde klaar of er wordt opgehaald.';
 if(!scraper.available)return 'De scraper is nog niet beschikbaar.';
 if(!sourceFilterURL(s))return 'Sla eerst een filterlink op.';
 if(s.importEnabled===false)return 'Hervat eerst de import voor deze bron.';
 if(!scraper.configured)return 'Verbind eerst je Bouwberichten-account.';
 if(!scraper.lastTestPassed)return 'Laat eerst een proef met deze bron slagen.';
 return '';
}
function sourceManualRunButton(s){
 const reason=manualScrapeBlock(s);
 const attributes='data-id="'+esc(s.id)+'" aria-label="Nu ophalen: '+esc(s.name)+'"';
 return btn('Nu ophalen','run-source-scraper','primary',attributes+(reason?' disabled title="'+esc(reason)+'"':''));
}
const validScraperTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function scraperScheduleTime(scraper){
 if(validScraperTime(scraper.scheduleTime))return scraper.scheduleTime;
 if(scraper.nextRunAt&&Number.isFinite(Date.parse(scraper.nextRunAt)))return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(scraper.nextRunAt));
 return '06:00';
}
function sourceScraperHTML(s,m){
 const scraper=s.scraper||{},status=sourceScraperStatus(s),filter=!!sourceFilterURL(s),working=['queued','running'].includes(scraper.status),busy=!!m.scraperBusy,available=!!scraper.available,disabled=!available||!filter||busy||working;
 let body='<div class="scraper-status-heading"><span class="badge '+status.tone+'" data-scraper-status>'+status.label+'</span><span class="scraper-worker" data-scraper-worker hidden></span></div>'+sourceFilterHTML(s,true);
 body+='<div class="info-box" data-scraper-missing-filter '+(filter?'hidden':'')+'><strong>Stel eerst je Bouwfilter in</strong><p>Deze bron heeft een filterlink met de gekozen criteria nodig voordat je projecten kunt ophalen.</p>'+btn('Bron configureren','source-config','secondary','data-id="'+esc(s.id)+'"')+'</div><div class="info-box" data-scraper-unavailable '+(available?'hidden':'')+'><strong>Automatisch ophalen wordt klaargezet</strong><p>De beveiligde scraper is voor deze werkplek nog niet beschikbaar. Je bronfilter en bestaande leads blijven bewaard.</p></div><p class="scraper-help" data-scraper-offline hidden>De scraper is nog niet online. Een ingeplande proef kan pas starten wanneer hij online is.</p>';
 body+='<form id="source-scraper-form" data-source-id="'+esc(s.id)+'"><input type="hidden" name="id" value="'+esc(s.id)+'"><h3>Beveiligde bronlogin</h3><p class="scraper-help">Gebruik je account van Bouwberichten. De bronlogin wordt versleuteld bij de scraper opgeslagen en komt niet in GitHub. Je wachtwoord wordt hier nooit teruggetoond.</p><label class="field" for="scraper-username"><span>E-mailadres of gebruikersnaam</span></label><input id="scraper-username" name="username" type="text" required maxlength="254" autocomplete="username" value="'+esc(scraper.username||s.username||'')+'" '+(disabled?'disabled':'')+'><div class="field scraper-password"><label for="scraper-password">Wachtwoord van Bouwberichten</label><div class="password-field"><input id="scraper-password" name="password" type="password" required maxlength="256" autocomplete="current-password" '+(disabled?'disabled':'')+'><button type="button" class="button ghost password-toggle" data-action="toggle-password" aria-controls="scraper-password" aria-pressed="false" aria-label="Wachtwoord van Bouwberichten tonen" '+(disabled?'disabled':'')+'>Tonen</button></div></div><p class="scraper-error" data-scraper-action-error role="alert" hidden></p><button type="submit" class="button primary scraper-connect" '+(disabled?'disabled':'')+'>Beveiligd verbinden en proef starten</button></form>';
 body+='<section class="scraper-run-panel"><h3>Projecten ophalen</h3><p class="scraper-help">Na een geslaagde proef kun je de volledige filterselectie direct ophalen, ook als dagelijks ophalen aanstaat.</p><div class="scraper-run-actions">'+btn('Proef met 5 projecten','test-source-scraper','secondary','data-id="'+esc(s.id)+'" disabled')+btn('Volledige selectie nu ophalen','run-source-scraper','primary','data-id="'+esc(s.id)+'" disabled')+'</div><label class="scraper-schedule"><input type="checkbox" data-scraper-schedule="'+esc(s.id)+'" disabled><span><strong>Dagelijks ophalen</strong><small data-scraper-plan-help></small></span></label><div class="scraper-schedule-time"><label class="field" for="scraper-daily-time"><span>Tijdstip (Nederlandse tijd)</span><input id="scraper-daily-time" type="time" step="60" required value="'+esc(m.scheduleTimeDraft??scraperScheduleTime(scraper))+'" data-scraper-time="'+esc(s.id)+'" aria-describedby="scraper-time-help" disabled></label><button type="button" class="button secondary" data-action="save-source-scraper-time" data-id="'+esc(s.id)+'" disabled>Tijd opslaan</button></div><p id="scraper-time-help" class="scraper-help">Dit tijdstip geldt voor deze bron. Zomer- en wintertijd worden automatisch gevolgd.</p><p class="scraper-error" data-scraper-schedule-error role="alert" hidden></p></section>';
 body+='<section class="scraper-run-panel scraper-last-run"><h3>Laatste ophaalronde</h3><dl><dt>Gestart</dt><dd data-scraper-started>—</dd><dt>Afgerond</dt><dd data-scraper-finished>—</dd><dt data-scraper-processed-label hidden>Verwerkt</dt><dd data-scraper-processed hidden></dd></dl><div class="scraper-counts" data-scraper-counts hidden><span><strong data-scraper-count="created">0</strong> nieuw</span><span><strong data-scraper-count="updated">0</strong> bijgewerkt</span><span><strong data-scraper-count="unchanged">0</strong> ongewijzigd</span><span data-scraper-excluded hidden><strong data-scraper-count="excluded">0</strong> uitgesloten na verwijderen</span></div><p class="scraper-help" data-scraper-empty>Er is nog geen ophaalronde afgerond.</p><p class="scraper-error" data-scraper-source-error role="status" hidden></p></section>';
 return modalShell('Automatisch ophalen · '+esc(s.name),body,'<div class="source-import-footer">'+btn('Bronlogin verwijderen','disconnect-source-scraper','danger','data-id="'+esc(s.id)+'" hidden')+btn('Sluiten','close-modal')+'</div>',false,'data-scraper-source-id="'+esc(s.id)+'"');
}
function updateScraperLoginForm(form,s,m){
 const scraper=s.scraper||{},disabled=!!(!scraper.available||!sourceFilterURL(s)||m.scraperBusy||['queued','running'].includes(scraper.status));
 form.querySelectorAll('input:not([type=hidden]),button').forEach(control=>{if(control.disabled!==disabled)control.disabled=disabled;});
 const submit=form.querySelector('[type=submit]'),label=m.scraperBusy?'Even geduld…':'Beveiligd verbinden en proef starten';if(submit&&submit.textContent!==label)submit.textContent=label;
}
function updateScraperModal(modal,s,m){
 const scraper=s.scraper||{},status=sourceScraperStatus(s),available=!!scraper.available,filter=!!sourceFilterURL(s),busy=!!m.scraperBusy,working=['queued','running'].includes(scraper.status),disabled=!available||!filter||busy||working;
 const text=(selector,value)=>{const node=modal.querySelector(selector),next=String(value);if(node&&node.textContent!==next)node.textContent=next;};
 const hidden=(selector,value)=>{const node=modal.querySelector(selector),next=!!value;if(node&&node.hidden!==next)node.hidden=next;};
 const disable=(selector,value)=>{const node=modal.querySelector(selector),next=!!value;if(node&&node.disabled!==next)node.disabled=next;};
 text('#modal-title','Automatisch ophalen · '+s.name);text('[data-scraper-filter-summary]',s.filterSummary||'Nog geen filterlink ingesteld.');const filterUrl=sourceFilterURL(s),filterLink=modal.querySelector('[data-scraper-filter-link]');if(filterLink){if(filterUrl&&filterLink.getAttribute('href')!==filterUrl)filterLink.setAttribute('href',filterUrl);else if(!filterUrl&&filterLink.hasAttribute('href'))filterLink.removeAttribute('href');}hidden('[data-scraper-filter-link]',!filterUrl);text('[data-scraper-filter-url]',filterUrl);
 const statusNode=modal.querySelector('[data-scraper-status]'),statusClass='badge '+status.tone;if(statusNode&&statusNode.className!==statusClass)statusNode.className=statusClass;text('[data-scraper-status]',status.label);
 const worker=modal.querySelector('[data-scraper-worker]'),workerClass='scraper-worker'+(scraper.workerOnline?' online':'');if(worker&&worker.className!==workerClass)worker.className=workerClass;text('[data-scraper-worker]','Scraper '+(scraper.workerOnline?'online':'nog niet online'));hidden('[data-scraper-worker]',!available);
 hidden('[data-scraper-missing-filter]',filter);hidden('[data-scraper-unavailable]',available);hidden('[data-scraper-offline]',!available||scraper.workerOnline);
 const form=modal.querySelector('#source-scraper-form');if(form)updateScraperLoginForm(form,s,m);
 text('[data-scraper-action-error]',m.scraperError||'');hidden('[data-scraper-action-error]',!m.scraperError);
 disable('[data-action="test-source-scraper"]',disabled||!scraper.configured);disable('[data-action="run-source-scraper"]',busy||!!manualScrapeBlock(s));
 const planning=modal.querySelector('[data-scraper-schedule]');if(planning&&!busy&&planning.checked!==!!scraper.scheduleEnabled)planning.checked=!!scraper.scheduleEnabled;disable('[data-scraper-schedule]',!available||!filter||busy||!scraper.lastTestPassed);
 const timeInput=modal.querySelector('[data-scraper-time]'),savedTime=scraperScheduleTime(scraper);
 if(timeInput&&!m.scheduleTimeDirty&&document.activeElement!==timeInput&&timeInput.value!==savedTime)timeInput.value=savedTime;
 disable('[data-scraper-time]',!available||!filter||!scraper.configured||busy);disable('[data-action="save-source-scraper-time"]',!available||!filter||!scraper.configured||busy||!m.scheduleTimeDirty);
 text('[data-action="save-source-scraper-time"]',m.scheduleSaving?'Opslaan…':'Tijd opslaan');text('[data-scraper-schedule-error]',m.scheduleTimeError||'');hidden('[data-scraper-schedule-error]',!m.scheduleTimeError);
 const scheduleHelp=scraper.scheduleEnabled?(scraper.nextRunAt?'Volgende keer: '+fmt(scraper.nextRunAt)+' · Nederlandse tijd':'Dagelijks om '+savedTime+' · Nederlandse tijd'):(scraper.lastTestPassed?'Na aanzetten haalt deze bron dagelijks op het gekozen tijdstip projecten op.':'Een geslaagde proef is nodig om de planning aan te zetten.');text('[data-scraper-plan-help]',scheduleHelp);
 text('[data-scraper-started]',fmt(scraper.lastStartedAt));text('[data-scraper-finished]',fmt(scraper.lastFinishedAt));const processed=scraper.lastProcessed!=null;hidden('[data-scraper-processed-label]',!processed);hidden('[data-scraper-processed]',!processed);text('[data-scraper-processed]',processed?Number(scraper.lastProcessed)+(scraper.lastTotal!=null?' van '+Number(scraper.lastTotal):'')+' projecten':'');
 hidden('[data-scraper-counts]',!scraper.lastCounts);hidden('[data-scraper-empty]',!!scraper.lastCounts);hidden('[data-scraper-excluded]',!scraper.lastCounts?.excluded);for(const key of ['created','updated','unchanged','excluded'])text('[data-scraper-count="'+key+'"]',Number(scraper.lastCounts?.[key]||0));
 text('[data-scraper-source-error]',scraper.lastError||'');hidden('[data-scraper-source-error]',!scraper.lastError);hidden('[data-action="disconnect-source-scraper"]',!scraper.configured);disable('[data-action="disconnect-source-scraper"]',busy);
 const ariaBusy=String(busy);if(modal.getAttribute('aria-busy')!==ariaBusy)modal.setAttribute('aria-busy',ariaBusy);
}

function editScraperScheduleTime(input){
 const modal=ui.modal;if(!state||modal?.type!=='source-scraper'||input.dataset.scraperTime!==modal.id||modal.scraperBusy)return;
 modal.scheduleTimeDraft=input.value;modal.scheduleTimeDirty=true;modal.scheduleTimeError='';
 const source=leadSources().find(source=>source.id===modal.id);if(source)updateScraperModal($('.modal'),source,modal);
}
async function saveScraperSchedule(id,enabled,{timeOnly=false}={}){
 if(!state||!isChief())return;
 const modal=ui.modal,source=leadSources().find(source=>source.id===id&&sourceProvider(source)==='bouwberichten');
 if(!source||modal?.type!=='source-scraper'||modal.id!==id||modal.scraperBusy)return;
 const time=$('[data-scraper-time]')?.value??modal.scheduleTimeDraft??scraperScheduleTime(source.scraper||{});
 modal.scheduleTimeDraft=time;
 if((enabled||timeOnly)&&!validScraperTime(time)){modal.scheduleTimeDirty=true;modal.scheduleTimeError='Kies een geldig tijdstip (uu:mm).';updateScraperModal($('.modal'),source,modal);return;}
 modal.scraperBusy=true;modal.scheduleSaving=true;modal.scheduleTimeError='';updateScraperModal($('.modal'),source,modal);
 try{
  await mutate('source.scraper.schedule',{id,enabled,...(validScraperTime(time)?{time}:{})});
  if(validScraperTime(time)){const updated=leadSources().find(source=>source.id===id);modal.scheduleTimeDraft=scraperScheduleTime(updated?.scraper||{});modal.scheduleTimeDirty=false;}
  toast(timeOnly?'Tijdstip opgeslagen.':enabled?'Dagelijks ophalen staat aan.':'Dagelijks ophalen staat uit.');
 }catch(error){modal.scheduleTimeError=error.message||'Het tijdstip kon niet worden opgeslagen. Probeer het opnieuw.';if(state&&ui.modal!==modal)toast(modal.scheduleTimeError,'amber');}
 finally{modal.scraperBusy=false;modal.scheduleSaving=false;if(state&&ui.modal===modal)renderOverlay();}
}

async function scraperAction(type,id,payload={}){
 if(!isChief())throw Error('Alleen de hoofdbeheerder kan automatisch ophalen instellen.');
 const source=leadSources().find(s=>s.id===id&&sourceProvider(s)==='bouwberichten'),modal=ui.modal;if(!source||modal?.type!=='source-scraper'||modal.id!==id)throw Error('Open eerst de instellingen voor automatisch ophalen.');
 if(modal.scraperBusy)return;modal.scraperError='';modal.scraperBusy=true;renderOverlay();
 try{return await mutate(type,{id,...payload});}catch(error){modal.scraperError=error.message||'Deze actie is niet gelukt. Probeer het opnieuw.';throw error;}finally{modal.scraperBusy=false;if(state)render();}
}
async function connectSourceScraper(form,data){
 const id=data.id,modal=ui.modal,payload={username:String(data.username||'').trim(),password:String(data.password||'')};if(modal?.type==='source-scraper')modal.scraperError='';delete data.password;const password=form.querySelector('[name="password"]');if(password)password.value='';
 try{if(!payload.username||!payload.password)throw Error('Vul je gebruikersnaam en het wachtwoord van Bouwberichten in.');await scraperAction('source.scraper.configure',id,payload);toast('Bronlogin beveiligd opgeslagen. De proef met 5 projecten is ingepland.');}catch(error){if(state&&ui.modal===modal){modal.scraperError=error.message||'Verbinden is niet gelukt. Probeer het opnieuw.';renderOverlay();}throw error;}finally{payload.password='';}
}
let scraperRefreshPending=false;
async function refreshScraperModal(){
 if(scraperRefreshPending||!session?.authenticated||pendingMutations||document.hidden||ui.modal?.type!=='source-scraper')return;const modal=ui.modal;scraperRefreshPending=true;
 try{await refreshState(ui.companyId,{renderPage:false});if(ui.modal===modal)renderOverlay();}catch(error){if(state)toast(error.message,'amber');}finally{scraperRefreshPending=false;}
}

const logbookStatuses={failed:['Mislukt','red'],running:['Bezig met ophalen','blue'],queued:['Ingepland','amber'],finished:['Geslaagd','green'],cancelled:['Geannuleerd','gray']};
function logbookDiagnosticHTML(error){
 const detail=error?.diagnostic;if(!detail)return '';
 const stages={configuration:'Broninstellingen controleren',login:'Inloggen bij Bouwberichten',listing:'Projectselectie ophalen',detail:'Projectgegevens ophalen',organisations:'Betrokken partijen ophalen',presentation:'Projectpresentatie openen',mapping:'Projectgegevens verwerken',progress:'Voortgang doorgeven',import:'Projecten opslaan',finish:'Ophaalpoging afronden'};
 const authReasons={invalid_filter:'De filterlink is ongeldig.',invalid_configuration:'De broninstellingen zijn onvolledig.',browser_start_failed:'De bron kon niet worden geopend.',navigation_failed:'De inlogpagina kon niet worden geladen.',unexpected_origin:'De aanmelding kwam op een onverwachte website terecht.',interactive_verification:'De bron vraagt om een extra handmatige controle.',submit_missing:'De inlogknop kon niet worden gevonden.',email_step_error:'Het e-mailadres kon niet worden verzonden.',password_step_error:'Het wachtwoord kon niet worden verzonden.',login_timeout:'De aanmelding duurde te lang.',control_interaction_failed:'Het inlogformulier kon niet worden bediend.',request_not_allowed:'De bron weigerde deze aanvraag.',browser_closed:'De verbinding met de bron is gesloten.'};
 const details=[];if(stages[detail.stage])details.push('Stap: '+stages[detail.stage]);
 if(Number.isInteger(detail.status))details.push('Antwoordcode: '+detail.status);
 if(Number.isSafeInteger(detail.expectedTotal)&&Number.isSafeInteger(detail.observedTotal))details.push('Verwacht: '+detail.expectedTotal+' projecten · ontvangen: '+detail.observedTotal);
 if(authReasons[detail.authReason])details.push(authReasons[detail.authReason]);
 return details.length?'<p>'+details.map(esc).join('<br>')+'</p>':'';
}
function sourceLogbookContext(){
 if(!state||!session?.authenticated||!isChief()){clearSourceLogbook();return false;}
 if(sourceLogbook.viewerId!==currentUser().id){clearSourceLogbook();sourceLogbook.viewerId=currentUser().id;}
 return true;
}
function sourceLogbookEntries(){
 const log=sourceLogbook;
 if(!log.entries.length)return '<div class="panel panel-body" role="status">'+(log.loading?'Logboek laden…':log.error?'Het logboek kon niet worden geladen. Klik op Vernieuwen om het opnieuw te proberen.':log.status==='failed'?'Geen mislukte ophaalpogingen in deze selectie.':'Geen ophaalpogingen in deze selectie.')+'</div>';
 return log.entries.map(entry=>{
  const [label,tone]=logbookStatuses[entry.status]||['Onbekend','gray'],source=state.sources.find(s=>s.id===entry.sourceId&&!s.deleted),failed=entry.status==='failed';
  const count=Number(entry.processed)||0,total=entry.total==null?'':String(Number(entry.total)||0),error=entry.error;
  const retry=failed?btn(log.busyJobId===entry.id?'Inplannen…':'Opnieuw proberen','retry-source-import','primary','data-id="'+esc(entry.sourceId)+'" data-job-id="'+esc(entry.id)+'"'+(!entry.canRetry||log.busyJobId?' disabled':'')+(!entry.canRetry?' title="'+esc(entry.retryBlockedReason||'Opnieuw proberen is niet beschikbaar.')+'"':'')):'';
  return '<article class="logbook-entry" data-logbook-job="'+esc(entry.id)+'"><div class="logbook-entry-head"><div><h2>'+esc(entry.sourceName)+'</h2><span class="muted">'+(entry.mode==='full'?'Volledige selectie':'Proef met 5 projecten')+(entry.retryOf?' · Nieuwe poging':'')+'</span></div><span class="badge '+tone+'">'+label+'</span></div><div class="logbook-meta"><span>Ingepland: '+fmt(entry.queuedAt)+'</span>'+(entry.startedAt?'<span>Gestart: '+fmt(entry.startedAt)+'</span>':'')+(entry.finishedAt?'<span>Afgerond: '+fmt(entry.finishedAt)+'</span>':'')+'</div><div class="logbook-meta"><strong>'+count+(total?' van '+total:'')+' projecten verwerkt</strong><span>'+importCountSummary(entry.counts||{})+'</span></div>'+(error?'<div class="logbook-error"><p><strong>'+esc(error.message)+'</strong></p>'+logbookDiagnosticHTML(error)+(error.advice?'<p>'+esc(error.advice)+'</p>':'')+'</div>':'')+(failed&&entry.retryBlockedReason?'<p class="scraper-help">'+esc(entry.retryBlockedReason)+'</p>':'')+'<div class="logbook-actions">'+retry+(source&&sourceProvider(source)==='bouwberichten'?btn('Automatisch ophalen','source-scraper','secondary','data-id="'+esc(entry.sourceId)+'"'):'')+'</div></article>';
 }).join('');
}
function sourceLogbookPage(){
 if(!sourceLogbookContext())return heading('Logboek','Alleen de hoofdbeheerder kan het logboek van de bronnen bekijken.');
 const log=sourceLogbook,options=new Map(state.sources.filter(s=>sourceProvider(s)==='bouwberichten').map(s=>[s.id,s.name]));
 for(const entry of log.entries)if(!options.has(entry.sourceId))options.set(entry.sourceId,entry.sourceName);
 if(log.source!=='all'&&!options.has(log.source))options.set(log.source,'Verwijderde bron');
 return heading('Logboek','Bekijk ophaalpogingen per bron, de reden van een fout en de voortgang van een nieuwe poging.',btn(log.loading?'Vernieuwen…':'Vernieuwen','refresh-source-logbook','secondary',log.loading?'disabled':''))+'<section class="logbook-page"><div class="logbook-filters"><label class="field"><span>Status</span><select data-logbook-filter="status"><option value="failed" '+(log.status==='failed'?'selected':'')+'>Mislukt</option><option value="all" '+(log.status==='all'?'selected':'')+'>Alle pogingen</option>'+['running','queued','finished','cancelled'].map(status=>'<option value="'+status+'" '+(log.status===status?'selected':'')+'>'+logbookStatuses[status][0]+'</option>').join('')+'</select></label><label class="field"><span>Bron</span><select data-logbook-filter="source"><option value="all">Alle bronnen</option>'+[...options].map(([id,name])=>'<option value="'+esc(id)+'" '+(log.source===id?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label></div><p class="scraper-error" data-logbook-page-error role="alert" '+(!log.error?'hidden':'')+'>'+esc(log.error)+'</p><p class="scraper-help" data-logbook-worker '+(log.workerOnline?'hidden':'')+'>De scraper is momenteel niet online. Een ingeplande poging wacht tot de verbinding is hersteld.</p><div class="source-logbook" aria-busy="'+log.loading+'">'+sourceLogbookEntries()+'</div><div class="logbook-actions">'+btn(log.loading?'Laden…':'Meer laden','more-source-logbook','secondary',(log.hasMore?'':'hidden ')+(log.loading?'disabled':''))+'<span class="muted" data-logbook-total>'+log.entries.length+' van '+log.total+' pogingen · maximaal de laatste 100 per selectie</span></div></section>';
}
function updateSourceLogbookView(){
 // Update only the logbook: an open source form and its unfinished fields stay intact.
 if(!state||!session?.authenticated||!isChief()||ui.route!=='logbook'||sourceLogbook.viewerId!==currentUser().id)return;
 const root=$('.logbook-page');if(!root)return;
 const log=sourceLogbook,content=root.querySelector('.source-logbook');if(content){content.innerHTML=sourceLogbookEntries();content.setAttribute('aria-busy',String(log.loading));}
 const error=root.querySelector('[data-logbook-page-error]');if(error){error.textContent=log.error;error.hidden=!log.error;}
 const worker=root.querySelector('[data-logbook-worker]');if(worker)worker.hidden=log.workerOnline;
 const filter=root.querySelector('[data-logbook-filter="status"]');if(filter)filter.value=log.status;
 const total=root.querySelector('[data-logbook-total]');if(total)total.textContent=log.entries.length+' van '+log.total+' pogingen · maximaal de laatste 100 per selectie';
 const refresh=$('[data-action="refresh-source-logbook"]');if(refresh){refresh.disabled=log.loading||!!log.busyJobId;refresh.textContent=log.loading?'Vernieuwen…':'Vernieuwen';}
 const more=root.querySelector('[data-action="more-source-logbook"]');if(more){more.hidden=!log.hasMore;more.disabled=log.loading||!!log.busyJobId;more.textContent=log.loading?'Laden…':'Meer laden';}
}
async function refreshSourceLogbook({append=false,quiet=false}={}){
 if(!sourceLogbookContext()||ui.route!=='logbook')return;
 const log=sourceLogbook,viewerId=log.viewerId,version=++sourceLogbookVersion,status=log.status,source=log.source;
 const offset=append?log.entries.length:0;
 log.loading=true;log.error='';updateSourceLogbookView();
 const query=new URLSearchParams({status,limit:quiet?String(Math.max(20,log.entries.length)): '20',offset:String(offset)});if(source!=='all')query.set('sourceId',source);
 const current=()=>sourceLogbook===log&&version===sourceLogbookVersion&&session?.authenticated&&state&&isChief()&&currentUser().id===viewerId;
 try{
  const result=await api('/api/source-logbook?'+query);if(!current())return;
  log.entries=append?[...new Map([...log.entries,...result.entries].map(entry=>[entry.id,entry])).values()]:result.entries;
  log.total=result.total;log.hasMore=result.hasMore;log.workerOnline=result.workerOnline;
 }catch(error){if(current())log.error=error.message||'Het logboek kon niet worden geladen.';}
 finally{if(current()){log.loading=false;log.loaded=true;updateSourceLogbookView();}}
}
async function retrySourceImport(id,jobId){
 if(!sourceLogbookContext()||sourceLogbook.busyJobId)return;
 const log=sourceLogbook,entry=log.entries.find(entry=>entry.id===jobId&&entry.sourceId===id),startingStatus=log.status,startingSource=log.source;if(!entry?.canRetry)return;
 log.busyJobId=jobId;log.error='';updateSourceLogbookView();
 try{
  await mutate('source.scraper.retry',{id,jobId});
  if(sourceLogbook!==log||!state||!isChief()||currentUser().id!==log.viewerId)return;
  if(log.status===startingStatus&&log.source===startingSource)log.status='all';toast('Nieuwe ophaalpoging ingepland.');await refreshSourceLogbook();
 }catch(error){if(sourceLogbook===log)log.error=error.message||'De nieuwe poging kon niet worden ingepland.';}
 finally{if(sourceLogbook===log){log.busyJobId=null;updateSourceLogbookView();}}
}

function priorityBadge(p){return `<span class="priority ${p}">${esc(priorityNames[p])}</span>`;}
function deletedLeadTime(lead){const value=Date.parse(lead.deletedAt);return Number.isFinite(value)?value:-Infinity;}
function deletedLeadSearchText(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL');}
function deletedLeadEntries(){
 if(!state||!isChief())return[];
 const query=deletedLeadSearchText(ui.deletedLeadQuery).trim();
 return(Array.isArray(state.archivedLeads)?state.archivedLeads:[]).filter(lead=>lead&&typeof lead.id==='string'&&(!query||deletedLeadSearchText([lead.title,lead.organization,lead.city,lead.importExternalId,lead.projectDetails?.projectNumber,lead.deletedByName,lead.deletionReason].join(' ')).includes(query))).sort((a,b)=>deletedLeadTime(b)-deletedLeadTime(a)||a.id.localeCompare(b.id));
}
function deletedLeadResultsHTML(leads){
 if(!leads.length)return '<div class="empty-state"><h3>'+(state.archivedLeads?.length?'Geen verwijderde leads gevonden':'Nog geen leads verwijderd')+'</h3><p>'+(state.archivedLeads?.length?'Pas je zoekopdracht aan.':'Hier verschijnen leads die een hoofdbeheerder voor alle bedrijven heeft verwijderd.')+'</p></div>';
 return '<table class="deleted-leads-table"><thead><tr><th>Lead</th><th>Verwijderd door</th><th>Verwijderd op</th><th>Reden</th></tr></thead><tbody>'+leads.map(lead=>{
  const external=lead.importExternalId||lead.projectDetails?.projectNumber,bouw=state.sources.some(source=>leadSourceIds(lead).includes(source.id)&&sourceProvider(source)==='bouwberichten'),validTime=Number.isFinite(deletedLeadTime(lead));
  return '<tr data-deleted-lead data-lead-id="'+esc(lead.id)+'"><td data-label="Lead"><strong>'+esc(lead.title||'Naam niet vastgelegd')+'</strong>'+(external?'<div class="lead-meta">'+(bouw?'Bouwberichten-ID':'Bron-ID')+': '+esc(external)+'</div>':'')+(lead.organization||lead.city?'<div class="lead-meta">'+esc([lead.organization,lead.city].filter(Boolean).join(' · '))+'</div>':'')+'</td><td data-label="Verwijderd door">'+esc(lead.deletedByName?.trim()||'Niet vastgelegd')+'</td><td data-label="Verwijderd op">'+(validTime?'<time datetime="'+esc(lead.deletedAt)+'">'+fmt(lead.deletedAt,{year:'numeric'})+'</time>':'Niet vastgelegd')+'</td><td data-label="Reden" class="deleted-lead-reason">'+esc(lead.deletionReason?.trim()||'Geen reden opgegeven')+'</td></tr>';
 }).join('')+'</tbody></table>';
}
function deletedLeadCountText(leads){const total=state.archivedLeads?.length||0;return leads.length+(ui.deletedLeadQuery.trim()?' van '+total:'')+' verwijderde lead'+(leads.length===1&&!ui.deletedLeadQuery.trim()?'':'s');}
function deletedLeadsPage(){
 if(!isChief())return heading('Geen toegang','Dit overzicht is alleen beschikbaar voor de hoofdbeheerder.','','Beheer');
 const leads=deletedLeadEntries();
 return heading('Verwijderde leads','Wie een lead voor alle bedrijven heeft verwijderd, wanneer en met welke reden.','','Hoofdbeheer · Alle bedrijven')+'<section class="panel deleted-leads-panel"><div class="toolbar"><label class="search">'+icon('search')+'<input id="deleted-lead-search" type="search" maxlength="300" aria-label="Zoek verwijderde leads" placeholder="Zoek project, ID, beheerder of reden…" value="'+esc(ui.deletedLeadQuery)+'"></label>'+btn('Wis zoekopdracht','deleted-leads-reset','ghost small')+'</div><div class="panel-head"><h2>Verwijderhistorie</h2><span class="badge neutral" data-deleted-lead-count aria-live="polite">'+deletedLeadCountText(leads)+'</span></div><div data-deleted-lead-results>'+deletedLeadResultsHTML(leads)+'</div></section><p class="muted help-text">Nieuwste verwijderingen bovenaan. Tijden zijn Nederlandse tijd. Historische rapportages blijven bewaard en de import slaat deze leads over.</p>';
}
function renderDeletedLeadResults(){
 if(!state||!isChief()||ui.route!=='deleted-leads')return;
 const root=$('[data-deleted-lead-results]'),count=$('[data-deleted-lead-count]');if(!root)return;
 const leads=deletedLeadEntries();root.innerHTML=deletedLeadResultsHTML(leads);if(count)count.textContent=deletedLeadCountText(leads);
}
function updateDeletedLeadSearch(event){
 const input=event.target;if(!state||!isChief()||ui.route!=='deleted-leads'||input.id!=='deleted-lead-search'||!input.isConnected)return;
 ui.deletedLeadQuery=input.value;if(!event.isComposing)renderDeletedLeadResults();
}
function heading(title,subtitle,actions='',eyebrow=company().name){return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
function empty(message='Geen leads gevonden.',action=''){return `<div class="empty-state">${icon('layers')}<h3>${message}</h3><p>Pas je filters aan of voeg een nieuwe lead toe.</p>${action}</div>`;}
function resetFilters(){Object.assign(ui,{query:'',source:'all',priority:'all',status:'all',owner:'all',availability:'all',constructionFrom:'',constructionTo:'',deliveryFrom:'',deliveryTo:''});}
function render(){
 if(loggingOut)return;
 if(!state||!session?.authenticated){renderAuth();return;}
 disposeControlekamerView();document.body.classList.toggle('ck-dashboard',isControlekamer());
 if(!isChief())ui.companyId=currentUser().companyId;if(!state.companies.some(c=>c.id===ui.companyId))ui.companyId=state.companies[0]?.id||null;
 const page=routes.find(r=>r[0]===ui.route)||routes[0],due=callbacks().filter(c=>new Date(c.dueAt)<=Date.now()).length;
 $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar ${ui.mobile?'open':''}"><a href="#dashboard" class="brand" data-route="dashboard">${dashboardBrand()}</a><div class="nav-label">WERKPLEK</div><nav class="nav-group" aria-label="Hoofdnavigatie">${routes.slice(0,7).map(([id,label,i])=>`<button class="nav-item ${ui.route===id?'active':''}" data-route="${id}" ${ui.route===id?'aria-current="page"':''}>${icon(i)}<span>${id==='dashboard'&&isChief()?'Controlekamer':label}</span>${id==='callbacks'&&due?`<span class="nav-count">${due}</span>`:''}</button>`).join('')}</nav><div class="nav-label">BEHEER</div><nav class="nav-group" aria-label="Beheer">${routes.slice(7).filter(([id])=>!['logbook','all-companies','deleted-leads'].includes(id)||isChief()).map(([id,label,i])=>`<button class="nav-item ${ui.route===id?'active':''}" data-route="${id}">${icon(i)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-footer"><button class="profile-button" data-action="account"><span class="avatar">${esc(currentUser().name.split(' ').map(s=>s[0]).slice(0,2).join(''))}</span><span><strong>${esc(currentUser().name)}</strong><small>${esc(currentUser().role)}</small></span>${icon('settings')}</button></div></aside><div class="workspace"><header class="topbar"><button class="button icon menu-toggle" data-action="menu" aria-label="Menu openen">${icon('menu')}</button>${mobileCompanyLogo()}<div class="breadcrumbs"><span>Werkplek</span>${icon('chevron')}<strong>${isControlekamer()?'Controlekamer':isAdminOverview()?'Alle bedrijven':esc(page[1])}</strong></div><div class="top-actions"><span class="badge green hide-mobile">${isAdminOverview()?'Hoofdbeheer · Alle bedrijven':'Gedeelde werkplek'}</span>${companyLogoSource(company())?`<img class="workspace-company-logo" src="${esc(companyLogoSource(company()))}" alt="Logo van ${esc(company().name)}">`:''}<label class="sr-only" for="company-switch">${isAdminOverview()?'Open een bedrijfswerkplek':'Actief bedrijf'}</label><select id="company-switch" class="company-switch" data-field="company" ${!isChief()?'disabled':''}>${isAdminOverview()?'<option value="" selected>Open een bedrijf…</option>':''}${state.companies.filter(c=>isChief()||c.id===ui.companyId).map(c=>`<option value="${c.id}" ${!isAdminOverview()&&c.id===ui.companyId?'selected':''}>${esc(c.name)}</option>`).join('')}</select><button class="button icon" data-route="callbacks" aria-label="Terugbelafspraken, ${due} verlopen">${icon('bell')}${due?'<span class="notification-dot"></span>':''}</button></div></header><main id="main" class="main${ui.route==='calls'||ui.route==='leads'?' main-full-width':''}" tabindex="-1">${adminReturnBanner()}${renderPage()}<footer class="page-footer"><span>Bouwberichten Dashboard</span><span>Gedeeld opgeslagen · ${isAdminOverview()?'Alle bedrijven':esc(company().name)} · tijdzone Amsterdam</span></footer></main></div></div>`;
 renderOverlay();renderToasts();save();mountControlekamerView();
 if(ui.route==='logbook'&&isChief()&&!sourceLogbook.loaded&&!sourceLogbook.loading)void refreshSourceLogbook();
}
function renderPage(){if(!state.companies.length&&['leads','kanban','calls','callbacks','feed'].includes(ui.route))return heading('Voeg een bedrijf toe','Maak een bedrijfswerkplek aan om leads op te volgen.',btn('Bedrijf toevoegen','new-company','primary'));switch(ui.route){case'leads':return leadsPage();case'kanban':return kanbanPage();case'calls':return callsPage();case'callbacks':return callbacksPage();case'feed':return feedPage();case'reports':return reportsPage();case'sources':return sourcesPage();case'logbook':return sourceLogbookPage();case'deleted-leads':return deletedLeadsPage();case'all-companies':return adminOverviewPage();case'team':return teamPage();case'settings':return settingsPage();default:return dashboardPage();}}
function dashboardPage(){if(isChief())return controlekamerPage();const all=state.leads,available=all.filter(l=>eligible(l).allowed),todo=callbacks(),due=todo.filter(c=>new Date(c.dueAt)<=Date.now()),commitments=all.filter(l=>work(l).commitment).length,calc=all.filter(l=>work(l).calculation).length;return `${heading('Elke kans in beeld.','Van eerste signaal naar een goed gesprek. Dit is je werkvoorraad voor vandaag.',btn(`${icon('plus')} Nieuwe lead`,'new-lead','primary'))}<div class="stats-grid">${stat('Centrale leads',all.length,`${leadSources().length} bronnen`,'layers','blue')}${stat('Nu te bellen',available.length,`${all.length-available.length} binnen de belwachttijd`,'phone','green')}${stat('Terugbelafspraken',todo.length,`${due.length} vragen nu aandacht`,'calendar','amber')}${stat('Toezeggingen',commitments,`${calc} klaar voor calculatie`,'chart','blue')}</div><div class="content-grid"><section class="panel"><div class="panel-head"><div><div class="eyebrow">AAN DE SLAG</div><h2>Kansen om op te pakken</h2></div><button class="button ghost small" data-route="leads">Alle leads bekijken</button></div><div class="filter-row dashboard-filters"><div class="tabs"><button class="tab ${ui.availability==='all'?'active':''}" data-action="dash-filter" data-value="all">Alle kansen</button><button class="tab ${ui.availability==='available'?'active':''}" data-action="dash-filter" data-value="available">Nu belbaar</button><button class="tab ${ui.owner==='me'?'active':''}" data-action="dash-filter" data-value="me">Mijn leads</button></div></div>${leadTable(filteredLeads().slice(0,6),true)}<div class="panel-bottom"><span>${filteredLeads().length} kansen in je selectie</span><button class="button secondary small" data-route="calls">${icon('phone')} Open mijn bellijst</button></div></section><div class="dashboard-right"><section class="panel"><div class="panel-head"><h2>Je terugbelmomenten</h2><span class="badge amber">${due.length} openstaand</span></div><div class="panel-body callback-list">${todo.slice(0,3).map(callbackCard).join('')||'<p class="muted">Je planning is helemaal bij.</p>'}</div><button class="panel-link" data-route="callbacks">Bekijk de volledige planning</button></section><section class="panel"><div class="panel-head"><h2>Laatste signalen</h2>${icon('activity')}</div><div class="news-list">${feedItems().slice(0,3).map(newsItem).join('')}</div><button class="panel-link" data-route="feed">Open de nieuwsfeed</button></section></div></div><section class="sources-strip"><div>${icon('link')}<strong>Je bronnen, op één plek</strong><span class="muted">Beheer de importinstellingen per bron.</span></div><div>${leadSources().map(s=>`${sourceBadge(s.id)}<span class="muted source-demo">${sourceImportStatus(s).label}</span>`).join('')}<button class="button ghost small" data-route="sources">Beheer bronnen</button></div></section>`;}
const adminActivityNames={call:'Belmoment',note:'Notitie',status:'Statuswijziging',followup:'Terugbelafspraak',update:'Wijziging',source:'Bronupdate',result:'Resultaat'};
function adminReturnBanner(){return isChief()&&ui.adminReturn&&!isAdminOverview()?'<div class="admin-return-bar admin-overview-return"><span>Werkplek van <strong>'+esc(company().name)+'</strong></span>'+btn(ui.adminReturn.route==='dashboard'?'Terug naar Controlekamer':'Terug naar alle bedrijven','admin-return-overview','secondary small')+'</div>':'';}
function adminStat(key,label,value,meta,name,tone){return '<div data-admin-stat="'+key+'">'+stat(label,value,meta,name,tone)+'</div>';}
function adminLeadButton(item,label='Bekijk lead'){return item.leadId&&item.companyId?btn(label,'admin-open-lead','ghost small','data-id="'+esc(item.leadId)+'" data-company-id="'+esc(item.companyId)+'"'):item.leadId?btn(label,'open-lead','ghost small','data-id="'+esc(item.leadId)+'"'):'';}
function adminCompanyCard(row){
 const c=state.companies.find(c=>c.id===row.id),metric=(label,value)=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>';
 return '<article class="admin-company-card" data-company-id="'+esc(row.id)+'"><div class="admin-company-head">'+companyLogoMarkup(c)+'<div><h2>'+esc(row.name)+'</h2><p>'+row.activeUsers+' actieve accounts</p></div>'+(row.overdueCallbacks?'<span class="badge amber">'+row.overdueCallbacks+' te laat</span>':'')+'</div><dl class="admin-company-metrics">'+metric('Leads in opvolging',row.workedLeads)+metric('Belmomenten vandaag',row.callsToday)+metric('Open afspraken',row.openCallbacks)+metric('Toezeggingen',row.commitments)+metric('Klaar voor calculatie',row.calculations)+metric('Belmomenten totaal',row.totalCalls)+'</dl><div class="admin-company-columns" aria-label="Kanban-statussen van '+esc(row.name)+'">'+row.columns.map(column=>'<span class="badge neutral">'+esc(column.name)+' <strong>'+column.count+'</strong></span>').join('')+'</div><p class="admin-company-last">'+(row.lastActivityAt?'Laatste activiteit: '+fmt(row.lastActivityAt,{year:'numeric'}):'Nog geen activiteit vastgelegd.')+'</p><div class="admin-company-actions">'+btn('Open werkplek','admin-open-company','primary small','data-company-id="'+esc(row.id)+'" data-value="kanban"')+btn('Afspraken','admin-open-company','secondary small','data-company-id="'+esc(row.id)+'" data-value="callbacks"')+btn('Rapportage','admin-open-company','ghost small','data-company-id="'+esc(row.id)+'" data-value="reports"')+'</div></article>';
}
function adminActivityItem(item){return '<article class="admin-activity-item" data-admin-activity data-company-id="'+esc(item.companyId||'central')+'"><div class="admin-activity-meta"><span class="badge '+(item.companyId?'green':'blue')+'">'+esc(item.companyName)+'</span><span>'+esc(adminActivityNames[item.type]||'Activiteit')+'</span><time datetime="'+esc(item.at)+'">'+fmt(item.at,{year:'numeric'})+'</time></div><h3>'+esc(item.text)+'</h3>'+(item.detail?'<p>'+esc(item.detail).replace(/\n/g,'<br>')+'</p>':'')+'<div class="admin-activity-meta"><span>'+esc(item.actorName||'Maker niet vastgelegd')+'</span>'+(item.leadTitle?'<span>'+esc(item.leadTitle)+'</span>':'')+adminLeadButton(item)+'</div></article>';}
function adminAttentionItem(item){return '<article class="admin-attention-item" data-admin-attention data-company-id="'+esc(item.companyId)+'"><div class="admin-activity-meta"><span class="badge amber">'+esc(item.companyName)+'</span></div><h3>'+esc(item.leadTitle||'Lead')+'</h3><p>'+esc(item.text)+'</p>'+(item.dueAt?'<p><time datetime="'+esc(item.dueAt)+'">'+fmt(item.dueAt,{year:'numeric'})+'</time></p>':'')+(item.assigneeName?'<p>Voor '+esc(item.assigneeName)+(item.creatorName?' · gemaakt door '+esc(item.creatorName):'')+'</p>':'')+adminLeadButton(item,'Open opvolging')+'</article>';}
function adminSourcesPanel(){
 const sources=state.sources.filter(s=>!s.deleted),errors=sources.filter(s=>s.lastImportError||s.scraper?.lastError||['error','login_required'].includes(s.scraper?.status)),running=sources.filter(s=>['running','queued'].includes(s.scraper?.status)).length;
 return '<section class="panel"><div class="panel-head"><h2>Bronnen</h2><span class="badge '+(errors.length?'red':'neutral')+'">'+errors.length+' meldingen</span></div><div class="panel-body">'+(running?'<p>'+running+' bronnen zijn bezig of ingepland.</p>':'')+(errors.slice(0,3).map(source=>'<div class="admin-attention-item" data-admin-source-alert><strong>'+esc(source.name)+'</strong><p>'+esc(source.scraper?.lastError||source.lastImportError||'Ophalen vraagt aandacht.')+'</p></div>').join('')||'<p class="muted">Geen ophaalfouten gemeld.</p>')+'<button class="button secondary small" data-route="logbook">Open logboek</button></div></section>';
}
function adminAttentionSection(data){
 const issues=state.sources.filter(source=>!source.deleted&&(source.lastImportError||source.scraper?.lastError||['error','login_required'].includes(source.scraper?.status))).length;
 return '<section data-admin-attention-section><div class="section-heading"><div><h2>Nu aandacht nodig</h2><p>Verlopen afspraken, hoge prioriteiten zonder verantwoordelijke en bronmeldingen van alle bedrijven.</p></div><span class="badge amber">'+(data.attentionTotal+issues)+'</span></div><div class="admin-priority-grid"><section class="panel"><div class="panel-head"><h2>Opvolging</h2><span class="badge amber">'+data.attentionTotal+' aandachtspunten</span></div><div class="admin-attention-list">'+(data.attention.slice(0,ui.adminAttentionLimit).map(adminAttentionItem).join('')||'<div class="empty-state"><h3>Opvolging op orde</h3><p>Geen verlopen afspraken of hoge prioriteiten zonder verantwoordelijke.</p></div>')+'</div>'+(data.attentionTotal>ui.adminAttentionLimit&&ui.adminAttentionLimit<500?'<div class="panel-body">'+btn('Meer aandachtspunten','admin-more-attention','secondary')+'</div>':'')+'</section>'+adminSourcesPanel()+'</div></section>';
}
function adminCallingSection(data,report){
 const week=ui.adminCallsPeriod==='week',label=week?'Deze week':'Vandaag',count=row=>week?row.callsThisWeek:row.callsToday;
 const rows=[...data.companies].sort((a,b)=>count(b)-count(a)||a.name.localeCompare(b.name,'nl'));
 return '<section data-admin-calling-section><div class="section-heading"><div><h2>Hoeveel wordt er gebeld?</h2><p>Geregistreerde belmomenten per bedrijf en medewerker. Ook nulactiviteiten blijven zichtbaar.</p></div><label class="field"><span>Belactiviteit</span><select data-admin-calls-period><option value="today" '+(!week?'selected':'')+'>Vandaag</option><option value="week" '+(week?'selected':'')+'>Deze week</option></select></label></div><div class="admin-call-grid"><section class="panel"><div class="panel-head"><h2>Per bedrijf</h2><span class="badge blue">'+label+'</span></div><div class="table-wrap"><table class="admin-company-calls-table"><thead><tr><th>Bedrijf</th><th>'+label+'</th><th></th></tr></thead><tbody>'+rows.map(row=>'<tr data-admin-company-calls data-company-id="'+esc(row.id)+'"><td><strong>'+esc(row.name)+'</strong></td><td data-admin-company-call-count><strong>'+count(row)+'</strong></td><td>'+btn('Rapport','admin-open-call-report','ghost small','data-company-id="'+esc(row.id)+'"')+'</td></tr>').join('')+'</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Per medewerker</h2><span class="badge blue">'+label+'</span></div><div class="table-wrap"><table class="admin-staff-table"><thead><tr><th>Medewerker</th><th>Bedrijf</th><th>'+label+'</th></tr></thead><tbody>'+report.rows.map(row=>'<tr data-admin-staff data-user-id="'+esc(row.sellerId)+'"><td>'+btn(esc(row.sellerName),'admin-open-call-report','ghost small','data-user-id="'+esc(row.sellerId)+'"')+'</td><td>'+esc(row.companyNames.join(', ')||'Hoofdbeheer')+'</td><td data-admin-staff-count><strong>'+row.total+'</strong></td></tr>').join('')+(report.rows.length?'':'<tr><td colspan="3">Nog geen medewerkers of belmomenten vastgelegd.</td></tr>')+'</tbody></table></div></section></div><div class="admin-calls-footer">'+btn('Uitgebreide belrapportage','admin-open-call-report','secondary')+'<span>Iedere belregistratie telt één keer; meerdere telefoontjes bij dezelfde lead tellen apart.</span></div></section>';
}
function markControlekamerSync(){controlekamerState.nextAt=Date.now()+30000;controlekamerState.updatedUntil=Date.now()+1600;controlekamerState.error='';}
function disposeControlekamerView(){
 const view=controlekamerState.view;if(!view)return;
 controlekamerState.values={...view.values};view.dispose();controlekamerState.view=null;
}
function resetControlekamerRuntime(){
 disposeControlekamerView();Object.assign(controlekamerState,{companyId:'all',type:'all',showAll:false,nextAt:0,updatedUntil:0,busy:false,error:'',values:{},knownEvents:null,freshIds:[],mounted:false});
}
function controlekamerClock(){return{seconds:Math.max(0,Math.ceil((controlekamerState.nextAt-Date.now())/1000)),busy:controlekamerState.busy,updated:Date.now()<controlekamerState.updatedUntil,error:controlekamerState.error};}
function controlekamerHTML(){
 const data=buildControlekamer(state,{companyId:controlekamerState.companyId,type:controlekamerState.type,limit:controlekamerState.showAll?Number.MAX_SAFE_INTEGER:8});
 controlekamerState.companyId=data.companyId;
 const allEvents=data.companyId==='all'?data.events:buildControlekamer(state,{companyId:'all'}).events;
 const ids=new Set(allEvents.map(event=>event.id));controlekamerState.freshIds=controlekamerState.knownEvents?[...ids].filter(id=>!controlekamerState.knownEvents.has(id)):[];controlekamerState.knownEvents=ids;
 return renderControlekamer(data,{type:controlekamerState.type,showAll:controlekamerState.showAll,...controlekamerClock(),freshIds:controlekamerState.freshIds});
}
function controlekamerPage(){return '<div id="controlekamer-root">'+controlekamerHTML()+'</div>';}
function mountControlekamerView(){
 if(!isControlekamer())return;const root=$('#controlekamer-root');if(!root)return;
 controlekamerState.view=enhanceControlekamer(root,{previousValues:controlekamerState.values,freshIds:controlekamerState.freshIds,animateCards:!controlekamerState.mounted});controlekamerState.mounted=true;updateControlekamerClock(root,controlekamerClock());
}
function renderControlekamerContent(focusTarget=document.activeElement){
 if(!isControlekamer())return;const root=$('#controlekamer-root');if(!root)return;
 const focus=root.contains(focusTarget)?{...focusTarget.dataset}:null,x=scrollX,y=scrollY,main=$('#main'),top=main?.scrollTop||0;
 disposeControlekamerView();root.innerHTML=controlekamerHTML();mountControlekamerView();
 if(focus){const target=[...root.querySelectorAll('button[data-action]')].find(button=>Object.entries(focus).every(([key,value])=>button.dataset[key]===value));target?.focus({preventScroll:true});}
 if(main)main.scrollTop=top;window.scrollTo(x,y);
}
async function refreshControlekamer({manual=false}={}){
 if(!isControlekamer()||loggingOut||controlekamerState.busy||adminNavigationBusy)return;
 const actorSession=session,generation=authGeneration;controlekamerState.busy=true;controlekamerState.error='';updateControlekamerClock($('#controlekamer-root'),controlekamerClock());
 try{
  if(manual)await mutationQueue;
  if(loggingOut||session!==actorSession||generation!==authGeneration||!isControlekamer())return;
  const result=await refreshState(ui.companyId,{renderPage:false,force:true,preserveEditing:true});
  if(!result||loggingOut||session!==actorSession||generation!==authGeneration||!isControlekamer())return;
  renderControlekamerContent();
 }catch(error){
  if(!loggingOut&&session===actorSession&&generation===authGeneration&&isControlekamer()){controlekamerState.error=error.message||'Vernieuwen is niet gelukt.';controlekamerState.updatedUntil=0;controlekamerState.nextAt=Date.now()+30000;}
 }finally{if(session===actorSession&&generation===authGeneration){controlekamerState.busy=false;if(isControlekamer())updateControlekamerClock($('#controlekamer-root'),controlekamerClock());}}
}
async function tickControlekamer(){
 if(loggingOut||!session?.authenticated||!isControlekamer())return;
 const root=$('#controlekamer-root');if(root)updateControlekamerClock(root,controlekamerClock());
 if(Date.now()>=controlekamerState.nextAt&&!controlekamerState.busy&&!pendingMutations&&!adminNavigationBusy&&!document.hidden)await refreshControlekamer();
}
async function controlekamerAction(target){
 if(!isControlekamer())return;
 const actorSession=session,generation=authGeneration;
 const kind=target.dataset.kind,companyId=target.dataset.companyId||controlekamerState.companyId,userId=target.dataset.userId||'all',leadId=target.dataset.leadId;
 if(kind==='logbook'){ui.adminReturn={route:ui.route,x:scrollX,y:scrollY};clearSourceLogbook();sourceLogbook.source=target.dataset.sourceId||'all';navTo('logbook');return;}
 if(kind==='report'){ui.adminCallsPeriod='today';openAdminCallReport(companyId,userId);return;}
 if(kind==='kanban'||kind==='callbacks'){
  const opened=await openAdminCompany(companyId,kind==='kanban'?'kanban':'callbacks');
  if(!opened||loggingOut||session!==actorSession||generation!==authGeneration||!isChief())return;
  if(kind==='kanban'&&ui.route==='kanban'&&ui.companyId===companyId&&target.dataset.columnId){ui.status=target.dataset.columnId;render();}return;
 }
 if(kind==='lead'||kind==='callback'){
  const opened=await openAdminLead(companyId,leadId,target);
  if(!opened||loggingOut||session!==actorSession||generation!==authGeneration||!isChief())return;
  if(kind==='callback'&&ui.drawer===leadId&&ui.companyId===companyId&&!loggingOut)openModal('callback',leadId);
 }
}
function adminOverviewPage(){
 if(!isChief())return heading('Alle bedrijven','Dit overzicht is alleen beschikbaar voor de hoofdbeheerder.');
 const data=buildAdminOverview(state,{companyId:ui.adminCompany,attentionCompanyId:'all',period:ui.adminPeriod,activityType:ui.adminType,limit:Math.max(ui.adminActivityLimit,ui.adminAttentionLimit)}),t=data.totals;
 const report=buildCallReport({...state,archivedCompanies:[]},{companyId:'all',groupBy:'day',from:ui.adminCallsPeriod==='week'?data.weekStart:data.today,to:data.today});
 const options=(values,current)=>values.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>').join('');
 const summary='<div class="stats-grid compact-stats admin-overview-summary">'+adminStat('callsToday','Telefoontjes vandaag',t.callsToday,'Alle bedrijven','phone','green')+adminStat('callsThisWeek','Telefoontjes deze week',t.callsThisWeek,'Sinds maandag · Nederlandse tijd','phone','blue')+adminStat('callers','Medewerkers met belmomenten',report.totals.users,ui.adminCallsPeriod==='week'?'Deze week':'Vandaag','users','blue')+'</div>';
 const historyFilters='<div class="admin-overview-filters panel"><label class="field"><span>Bedrijf in tijdlijn</span><select data-admin-filter="company">'+options([['all','Alle bedrijven'],...state.companies.map(c=>[c.id,c.name])],ui.adminCompany)+'</select></label><label class="field"><span>Periode voor tijdlijn</span><select data-admin-filter="period">'+options([['today','Vandaag'],['7d','Laatste 7 dagen'],['30d','Laatste 30 dagen'],['all','Alle opgeslagen activiteit']],ui.adminPeriod)+'</select></label><label class="field"><span>Gebeurtenis</span><select data-admin-filter="type">'+options([['notes-status','Notities en statuswijzigingen'],['all','Alle gebeurtenissen'],...Object.entries(adminActivityNames)],ui.adminType)+'</select></label>'+btn('Wis filters','admin-reset-filters','ghost small')+'</div>';
 const historyTitle=ui.adminType==='notes-status'?'Notities en statuswijzigingen':ui.adminType==='all'?'Alle gebeurtenissen':adminActivityNames[ui.adminType]||'Activiteit';
 const history='<section class="panel"><div class="panel-head"><h2>'+esc(historyTitle)+'</h2><span class="badge neutral">'+data.activityTotal+' gebeurtenissen</span></div><div class="admin-activity-list">'+(data.activity.slice(0,ui.adminActivityLimit).map(adminActivityItem).join('')||'<div class="empty-state"><h3>Geen activiteit in deze selectie</h3><p>Kies een andere periode of een ander bedrijf.</p></div>')+'</div>'+(data.activityTotal>ui.adminActivityLimit?'<div class="panel-body">'+(ui.adminActivityLimit<500?btn('Meer activiteit tonen','admin-more-activity','secondary'):'<p class="muted">De laatste 500 gebeurtenissen worden getoond. Verfijn de selectie voor een gerichter overzicht.</p>')+'</div>':'')+'</section>';
 return '<div class="admin-overview"><div class="page-heading"><div><div class="eyebrow">HOOFDBEHEER · ALLE BEDRIJVEN</div><h1>Alle bedrijven in beeld</h1><p>Eerst wat aandacht nodig heeft. Daarna belactiviteit, notities en statuswijzigingen.</p></div><div class="heading-actions">'+btn('Vernieuwen','admin-refresh','secondary')+'</div></div>'+adminAttentionSection(data)+summary+adminCallingSection(data,report)+'<details class="admin-company-details" '+(ui.adminCompanyDetails?'open':'')+'><summary>Volledige bedrijfsstatus ('+t.companyCount+' bedrijven)</summary><div class="admin-company-grid">'+data.companies.map(adminCompanyCard).join('')+'</div></details><section class="admin-history-section"><div class="section-heading"><div><h2>Wat is er gebeurd?</h2><p>Met bedrijf, medewerker en tijdstip. Kies hieronder welke gebeurtenissen je wilt zien.</p></div></div>'+historyFilters+'<p class="admin-overview-note">Deze filters gelden alleen voor de tijdlijn. Aandachtspunten en belactiviteit hierboven blijven over alle bedrijven zichtbaar.</p>'+history+'</section><p class="admin-overview-note">Automatisch ververst ongeveer iedere 30 seconden. Weken beginnen op maandag en tijden volgen de Nederlandse tijd.</p></div>';
}
function openAdminCallReport(companyId='all',sellerId='all'){
 if(!isChief())throw Error('Deze rapportage is alleen beschikbaar voor de hoofdbeheerder.');
 const data=buildAdminOverview(state),back=isAdminOverview()?{route:ui.route,x:scrollX,y:scrollY}:ui.adminReturn;
 ui.adminReturn=back;Object.assign(ui,{reportView:'calls',callReportCompany:companyId,callReportSeller:sellerId,callReportGroupBy:'day',callReportFrom:ui.adminCallsPeriod==='week'?data.weekStart:data.today,callReportTo:data.today});navTo('reports');
}
async function openAdminCompany(companyId,route='kanban'){
 if(!isChief())throw Error('Dit overzicht is alleen beschikbaar voor de hoofdbeheerder.');
 if(adminNavigationBusy||leadDraft?.saving)return false;
 if(!state.companies.some(c=>c.id===companyId))throw Error('Dit bedrijf is niet meer beschikbaar.');
 const origin=ui.route,actorSession=session,version=++adminNavigationVersion,back=isAdminOverview()?{route:origin,x:scrollX,y:scrollY}:ui.adminReturn;
 adminNavigationBusy=true;
 try{await mutationQueue;await refreshState(companyId,{renderPage:false,force:true});if(loggingOut||session!==actorSession||version!==adminNavigationVersion||ui.route!==origin||!isChief()||ui.companyId!==companyId)return false;ui.adminReturn=back;if(route==='reports'){ui.callReportCompany=companyId;ui.callReportSeller='all';ui.reportCompany=companyId;ui.reportSeller='all';}resetFilters();navTo(['kanban','callbacks','reports','leads'].includes(route)?route:'kanban');return true;}
 finally{adminNavigationBusy=false;}
}
async function openAdminLead(companyId,leadId,target){
 if(!isChief())throw Error('Alleen de hoofdbeheerder kan opvolging van andere bedrijven openen.');
 if(adminNavigationBusy||leadDraft?.saving)return false;
 const origin=ui.route,actorSession=session,version=++adminNavigationVersion;adminNavigationBusy=true;
 try{await mutationQueue;await refreshState(companyId,{renderPage:false,force:true});if(loggingOut||session!==actorSession||version!==adminNavigationVersion||ui.route!==origin||!isChief()||ui.companyId!==companyId)return false;if(!state.leads.some(l=>l.id===leadId))throw Error('Deze lead is niet meer beschikbaar.');openLeadDrawer(leadId,target);return true;}
 finally{adminNavigationBusy=false;}
}
function returnAdminOverview(){const back=ui.adminReturn||{route:'all-companies',x:0,y:0};ui.adminReturn=null;navTo(back.route);requestAnimationFrame(()=>window.scrollTo(back.x,back.y));}

function stat(label,value,meta,i,tone){return `<div class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${tone}">${icon(i)}</span></div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></div>`;}
function filters(){return `<div class="toolbar"><label class="search">${icon('search')}<input id="lead-search" type="search" placeholder="Zoek project, organisatie, plaats of Bouwberichten-ID…" aria-label="Zoek leads" data-field="query" value="${esc(ui.query)}"></label>${selectFilter('source','Bron',[['all','Alle bronnen'],...leadSourceOptions()])}${selectFilter('priority','Prioriteit',[['all','Alle prioriteiten'],...Object.entries(priorityNames)])}${selectFilter('status','Status',[['all','Alle statussen'],...company().columns.map(c=>[c.id,c.name])])}${selectFilter('owner','Verkoper',[['all','Alle verkopers'],['me','Mijn leads'],...activeUsers().map(u=>[u.id,u.name])])}<button class="button ghost small" data-action="reset-filters">Wis filters</button></div>`;}
function selectFilter(field,label,options){return `<label class="filter-select"><span class="sr-only">${label}</span><select data-field="${field}" aria-label="${label}">${options.map(([v,l])=>`<option value="${v}" ${ui[field]===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;}
function projectDateFilter(label,key){
 const from=ui[key+'From'],to=ui[key+'To'],invalid=!!(from&&to&&from>to);
 const errorId=key+'-range-error',errorAttrs=invalid?` aria-invalid="true" aria-describedby="${errorId}"`:'';
 return `<fieldset class="project-date-filter"><legend>${label}</legend>
  <label for="${key}-from">Vanaf <input id="${key}-from" type="date" data-field="${key}From" value="${esc(from)}" max="${esc(to||'9999-12-31')}"${errorAttrs}></label>
  <label for="${key}-to">Tot en met <input id="${key}-to" type="date" data-field="${key}To" value="${esc(to)}" min="${esc(from)}" max="9999-12-31"${errorAttrs}></label>
  ${invalid?`<p id="${errorId}" role="status">Kies een einddatum op of na de begindatum.</p>`:''}
 </fieldset>`;
}
function projectDateFilters(){
 return `<div class="project-date-filters">${projectDateFilter('Start bouw','construction')}${projectDateFilter('Oplevering','delivery')}</div>`;
}
function projectDateHeader(field,label){
 const direction=ui.projectDateSort?.field===field?ui.projectDateSort.direction:null;
 const arrows=[['asc','↑','vroeg naar laat'],['desc','↓','laat naar vroeg']];
 return `<th class="project-date-cell" scope="col"${direction?` aria-sort="${direction==='asc'?'ascending':'descending'}"`:''}><span class="project-date-heading">${label}<span class="project-date-arrows">${arrows.map(([value,arrow,order])=>`<button type="button" id="sort-${field}-${value}" data-action="sort-project-date" data-id="${field}" data-value="${value}" aria-pressed="${direction===value}" aria-label="${label} sorteren van ${order}" title="${label} sorteren van ${order}">${arrow}</button>`).join('')}</span></span></th>`;
}
function projectDateCell(value){
 const date=projectDay(value);
 return `<td class="project-date-cell">${date?`<time datetime="${esc(value)}">${esc(date)}</time>`:'<span class="muted">Onbekend</span>'}</td>`;
}
function leadTable(leads,compact=false){if(!leads.length)return empty();return `<div class="table-wrap"><table><thead><tr><th>Project & organisatie</th>${compact?'':Object.entries(projectDateColumns).map(([field,label])=>projectDateHeader(field,label)).join('')}<th>Bron</th><th>Prioriteit</th><th>Status</th>${compact?'':'<th>Verkoper</th>'}<th>Opvolging</th><th><span class="sr-only">Openen</span></th></tr></thead><tbody>${leads.map(l=>{const w=work(l),e=eligible(l);return `<tr><td><button class="lead-title" data-action="open-lead" data-id="${l.id}">${esc(l.title)}</button><div class="lead-meta">${esc(l.organization)} <span>·</span> ${esc(l.city)}</div></td>${compact?'':`${projectDateCell(l.projectDetails?.scheduleStart)}${projectDateCell(l.projectDetails?.scheduleEnd)}`}<td>${leadSourceBadges(l)}</td><td>${priorityBadge(w.priority)}</td><td><span class="status-pill status-${company().columns.findIndex(c=>c.id===w.status)}">${esc(statusName(w.status))}</span></td>${compact?'':`<td><span class="seller-cell">${esc(w.ownerId?userName(w.ownerId):'Niet toegewezen')}</span></td>`}<td><span class="call-state ${e.allowed?'available':'waiting'}">${icon(e.allowed?'phone':'clock')}${e.reason==='callback'?'Eigen terugbelmoment':e.allowed?'Nu belbaar':'Wachttijd'}</span><div class="lead-meta">${w.commitment?'Toezegging':''}${w.commitment&&w.calculation?' · ':''}${w.calculation?'Calculatie':''}</div></td><td><button class="button icon small" data-action="open-lead" data-id="${l.id}" aria-label="Open ${esc(l.title)}">${icon('chevron')}</button></td></tr>`;}).join('')}</tbody></table></div>`;}
function leadsPage(){const leads=filteredLeads();return `${heading('Alle leads','Eén centrale voorraad. De opvolging die je hier ziet, hoort bij je actieve bedrijf.',`${btn(`${icon('download')} Exporteer selectie`,'export','secondary')}${btn(`${icon('plus')} Nieuwe lead`,'new-lead','primary')}`)}<section class="panel">${filters()}${projectDateFilters()}<div class="section-heading"><strong data-lead-search-count aria-live="polite">${leads.length} leads</strong><span class="muted">Statussen en notities van ${esc(company().name)}</span></div><div data-lead-search-results>${leadTable(leads)}</div></section>`;}
function kanbanColumns(leads=filteredLeads()){
 const columns=company().columns.map((c,i)=>{
  const selected=leads.filter(l=>work(l).status===c.id);
  const cards=c.id==='opvolgen'?sortFollowUpLeads(state,company().id,selected):selected;
  return `<section class="kanban-column" data-column="${c.id}" aria-label="${esc(c.name)}"><div class="kanban-head"><span class="column-marker marker-${i}"></span><h2>${esc(c.name)}</h2><span class="column-count">${cards.length}</span>${canManage()?`<button class="button icon small" data-action="columns" aria-label="Kolom ${esc(c.name)} hernoemen">${icon('edit')}</button>`:''}</div>${cards.map(l=>{
   const w=work(l),next=c.id==='opvolgen'?nextFollowUpAt(state,company().id,l.id):null;
   const followUp=c.id==='opvolgen'?`<div class="kanban-date ${next&&Date.parse(next)<=Date.now()?'overdue':''}">${icon('clock')}${next?`<time datetime="${next}">${fmt(next)}</time>`:'<span class="muted">Geen terugbelmoment</span>'}</div>`:'';
   return `<article class="kanban-card" draggable="true" data-lead="${l.id}" data-action="open-lead" data-id="${l.id}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Open ${esc(l.title)}"><div class="card-top">${leadSourceBadges(l)}${priorityBadge(w.priority)}</div><h3 class="lead-title">${esc(l.title)}</h3><p class="lead-meta">${esc(l.organization)}<br>${esc(l.city)}</p>${followUp}<div class="card-tags">${w.commitment?'<span class="badge green">Toezegging</span>':''}${w.calculation?'<span class="badge blue">Calculatie</span>':''}</div><div class="card-footer"><span>${esc(w.ownerId?userName(w.ownerId).split(' ')[0]:'Niet toegewezen')}</span><span>${icon('mail')} ${w.notes.length} notities</span></div></article>`;
  }).join('')}<button class="kanban-add" data-action="new-lead" data-status="${c.id}">${icon('plus')} Lead toevoegen</button></section>`;
 }).join('');
 return columns;
}
function kanbanPage(){return `${heading('Van kans naar opdracht','Klik op een kaart om de lead te openen of sleep deze naar een andere kolom.',`${canManage()?btn(`${icon('edit')} Kolommen beheren`,'columns'):''}${btn(`${icon('plus')} Nieuwe lead`,'new-lead','primary')}`)}${filters()}<div class="kanban" data-lead-search-results>${kanbanColumns()}</div><p class="muted help-text">Opvolgen staat op datum van het vroegste open terugbelmoment, de vroegste datum bovenaan. Leads zonder terugbelmoment staan onderaan.</p>`;}
function callsPage(){const leads=filteredLeads(),available=leads.filter(l=>eligible(l).allowed);return `${heading('Een goed gesprek begint hier','Werk je prioriteiten af. Een belregistratie start de wachttijd voor andere bedrijven.',btn(`${icon('download')} Exporteer bellijst`,'export'))}<div class="call-summary"><div>${icon('phone')}<strong data-call-search-count aria-live="polite">${available.length} leads nu belbaar</strong></div><span>Globale wachttijd: <strong>${state.settings.cooldownHours} uur</strong> · Eigen vervallen terugbelafspraken hebben voorrang.</span>${btn('Instellingen','go-settings','ghost small')}</div><section class="panel">${filters()}${projectDateFilters()}<div class="filter-row"><label class="check-row"><input type="checkbox" data-field="available-check" ${ui.availability==='available'?'checked':''}> Alleen nu belbare leads</label></div><div data-lead-search-results>${leadTable(leads)}</div></section>`;}
function renderLeadSearchResults(){
 const results=$('[data-lead-search-results]');if(!results)return;
 const leads=filteredLeads();
 results.innerHTML=ui.route==='kanban'?kanbanColumns(leads):leadTable(leads);
 const count=$('[data-lead-search-count]'),available=$('[data-call-search-count]');
 if(count)count.textContent=leads.length+' leads';
 if(available)available.textContent=leads.filter(lead=>eligible(lead).allowed).length+' leads nu belbaar';
}
function callbackCard(c,inWorkbook=false){
 const due=Date.parse(c.dueAt)<=Date.now(),leadId=esc(c.lead.id),attributes=`data-id="${esc(c.id)}" data-lead-id="${leadId}"`;
 return `<article class="callback-card"><div class="callback-time ${due?'overdue':''}">${icon('clock')} ${due?'Nu opvolgen · ':''}${fmt(c.dueAt)}</div>
  ${inWorkbook?'':`<button class="lead-title" data-action="open-lead" data-id="${leadId}">${esc(c.lead.title)}</button>`}
  ${c.description?`<p>${esc(c.description)}</p>`:''}<p class="lead-meta">Voor ${esc(userName(c.assigneeId))} · Gemaakt door ${esc(c.creatorName)}</p>
  <div class="callback-actions">${inWorkbook?'':btn('Open lead','open-lead','ghost small',`data-id="${leadId}"`)}${btn('Wijzigen','edit-callback','ghost small',attributes)}${btn(`${icon('check')} Afgehandeld`,'complete-callback','secondary small',attributes)}</div></article>`;
}
function callbacksPage(){const all=callbacks(),due=all.filter(c=>new Date(c.dueAt)<=Date.now());return `${heading('Geen terugbelmoment missen','Afspraken voor jou en je collega’s. De maker blijft zichtbaar bij iedere afspraak.',(state.leads.length?btn(`${icon('plus')} Terugbelafspraak`,'callback','primary'):btn(`${icon('plus')} Nieuwe lead`,'new-lead','primary')))}<div class="stats-grid compact-stats">${stat('Open afspraken',all.length,'Binnen dit bedrijf','calendar','blue')}${stat('Nu opvolgen',due.length,'Vervallen terugbelmomenten','clock','amber')}${stat('Voor mij',all.filter(c=>c.assigneeId===currentUser().id).length,'Persoonlijk toegewezen','users','green')}</div><section class="panel"><div class="panel-head"><h2>Planning van ${esc(company().name)}</h2><span class="badge neutral">${all.length} afspraken</span></div><div class="callback-grid panel-body">${all.map(callbackCard).join('')||'<div class="empty-state"><h3>Alle afspraken zijn afgehandeld</h3><p>Maak een nieuwe terugbelafspraak vanuit een lead.</p></div>'}</div></section><p class="muted help-text">Meldingen rechtsonder verschijnen in dit geopende dashboard. Collega’s zien wijzigingen automatisch binnen ongeveer 30 seconden.</p>`;}
function feedItems(){const items=state.feed.filter(f=>!f.companyId||f.companyId===company().id);const overdue=callbacks().filter(c=>new Date(c.dueAt)<=Date.now()).map(c=>({id:'signal-'+c.id,leadId:c.lead.id,type:'followup',text:`Terugbelmoment voor ${userName(c.assigneeId)}: ${c.lead.title}`,authorName:c.creatorName,at:c.dueAt,companyId:company().id}));return [...overdue,...items].filter(f=>ui.feedFilter==='all'||(ui.feedFilter==='source'?!f.companyId:f.type==='followup')).sort((a,b)=>new Date(b.at)-new Date(a.at));}
function newsItem(f){const lead=state.leads.find(l=>l.id===f.leadId),isGlobal=!f.companyId;return `<article class="news-item"><span class="news-icon ${f.type==='followup'?'amber':isGlobal?'blue':'green'}">${icon(f.type==='followup'?'clock':isGlobal?'layers':'activity')}</span><div class="news-body"><span class="news-kicker">${isGlobal?'CENTRALE PROJECTUPDATE':f.type==='followup'?'OPVOLGSIGNAAL':'JOUW BEDRIJF'}</span><p>${esc(f.text)}</p><div class="news-time">${fmt(f.at)} · ${esc(f.authorName||'Demobron')}${lead?` · <button data-action="open-lead" data-id="${lead.id}" class="text-link">Bekijk lead</button>`:''}</div></div></article>`;}
function feedPage(){return `${heading('Wat speelt er?','Nieuwe leads, projectwijzigingen en signalen om op te volgen. Alle bronupdates zijn demonstraties.')}<section class="panel"><div class="filter-row"><div class="tabs">${[['all','Alle signalen'],['source','Projectupdates'],['followup','Opvolgsignalen']].map(([v,l])=>`<button class="tab ${ui.feedFilter===v?'active':''}" data-action="feed-filter" data-value="${v}">${l}</button>`).join('')}</div></div><div class="news-list full-news">${feedItems().map(newsItem).join('')||empty('Geen signalen in deze selectie.')}</div></section>`;}

function callReportData(){return buildCallReport(state,{companyId:ui.callReportCompany,sellerId:ui.callReportSeller,groupBy:ui.callReportGroupBy,from:ui.callReportFrom,to:ui.callReportTo});}
function reportViewTabs(){return isChief()?'<div class="tabs call-report-tabs" aria-label="Rapportage kiezen">'+[['calls','Belactiviteit'],['conversion','Conversie']].map(([value,label])=>'<button type="button" class="tab '+(ui.reportView===value?'active':'')+'" data-action="report-view" data-value="'+value+'" aria-pressed="'+(ui.reportView===value)+'">'+label+'</button>').join('')+'</div>':'';}
function reportsPage(){return reportViewTabs()+(isChief()&&ui.reportView==='calls'?callReportPage():conversionReportsPage());}
function callReportPage(){
 if(!isChief())return heading('Belactiviteit','Deze rapportage is alleen beschikbaar voor de hoofdbeheerder.');
 const data=callReportData(),options=(values,selected)=>values.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
 const sellers=new Map(state.users.filter(user=>ui.callReportCompany==='all'||user.companyId===ui.callReportCompany).map(user=>[user.id,user.name]));for(const row of data.rows)if(!sellers.has(row.sellerId))sellers.set(row.sellerId,row.sellerName);
 const filter=(name,label,items,current)=>'<label class="field"><span>'+label+'</span><select data-call-report-filter="'+name+'">'+options(items,current)+'</select></label>';
 return '<div class="call-report-page">'+heading('Belactiviteit per gebruiker','Het aantal geregistreerde belmomenten per dag, week of maand.',btn(icon('download')+' Rapport exporteren','export-call-report','secondary',data.error?'disabled':''),'Hoofdbeheer · '+(ui.callReportCompany==='all'?'Alle bedrijven':companyName(ui.callReportCompany)))+'<section class="panel call-report-filters">'+filter('groupBy','Indeling',[['day','Per dag'],['week','Per week'],['month','Per maand']],ui.callReportGroupBy)+filter('company','Bedrijf',[['all','Alle bedrijven'],...reportingCompanyOptions()],ui.callReportCompany)+filter('seller','Gebruiker',[['all','Alle gebruikers'],...[...sellers].sort((a,b)=>a[1].localeCompare(b[1],'nl'))],ui.callReportSeller)+'<label class="field"><span>Vanaf</span><input type="date" data-call-report-filter="from" value="'+esc(ui.callReportFrom)+'" aria-label="Belactiviteit vanaf"></label><label class="field"><span>Tot en met</span><input type="date" data-call-report-filter="to" value="'+esc(ui.callReportTo)+'" aria-label="Belactiviteit tot en met"></label>'+btn('Wis filters','reset-call-report','ghost small')+'</section>'+(data.error?'<div class="auth-error" role="alert" data-call-report-error>'+esc(data.error)+'</div>':'<div class="stats-grid compact-stats call-report-summary"><div data-call-report-stat="calls">'+stat('Telefoontjes',data.totals.calls,'Geregistreerde belmomenten','phone','green')+'</div><div data-call-report-stat="users">'+stat('Gebruikers met belmomenten',data.totals.users,'Binnen de gekozen periode','users','blue')+'</div><div data-call-report-stat="companies">'+stat('Bedrijven met belmomenten',data.totals.companies,'Binnen de gekozen selectie','building','blue')+'</div></div><section class="panel"><div class="panel-head"><h2>Aantallen per gebruiker</h2><span class="badge blue">'+data.totals.calls+' telefoontjes</span></div>'+(data.periods.length>4?'<p class="call-report-scroll-hint">Schuif de tabel opzij om alle perioden te bekijken.</p>':'')+'<div class="table-wrap"><table class="call-report-table"><thead><tr><th>Gebruiker</th><th>Bedrijven</th>'+data.periods.map(period=>'<th data-call-report-period="'+esc(period.key)+'" title="'+esc(period.start)+' t/m '+esc(period.end)+'">'+esc(period.label)+'</th>').join('')+'<th>Totaal</th></tr></thead><tbody>'+data.rows.map(row=>'<tr data-call-report-seller="'+esc(row.sellerId)+'"><td><strong>'+esc(row.sellerName)+'</strong></td><td>'+esc(row.companyNames.join(', ')||'Geen bedrijf')+'</td>'+data.periods.map(period=>'<td data-call-report-count="'+esc(period.key)+'">'+row.periods[period.key]+'</td>').join('')+'<td data-call-report-total><strong>'+row.total+'</strong></td></tr>').join('')+(data.rows.length?'':'<tr><td colspan="'+(data.periods.length+3)+'" class="call-report-empty">Geen gebruikers of belmomenten in deze selectie.</td></tr>')+'</tbody><tfoot><tr><th colspan="2">Totaal</th>'+data.periods.map(period=>'<td>'+data.totals.byPeriod[period.key]+'</td>').join('')+'<td><strong>'+data.totals.calls+'</strong></td></tr></tfoot></table></div></section>')+'<div class="call-report-definition"><strong>Zo tellen we</strong><p>Elke belregistratie telt één keer. Meerdere belmomenten bij dezelfde lead tellen apart. Een uitkomst bijwerken voegt geen extra telefoontje toe. De dagen volgen de Nederlandse tijd; een week begint op maandag. Gebruikers zonder belmomenten krijgen nul.</p></div></div>';
}
function exportCallReport(){
 if(!isChief())throw Error('Alleen de hoofdbeheerder kan deze belrapportage exporteren.');
 const data=callReportData();if(data.error)throw Error(data.error);
 csv('bouwberichten-belactiviteit.csv',[['Gebruiker','Bedrijven',...data.periods.map(period=>period.label),'Totaal'],...data.rows.map(row=>[row.sellerName,row.companyNames.join(', '),...data.periods.map(period=>row.periods[period.key]),row.total]),['Totaal','',...data.periods.map(period=>data.totals.byPeriod[period.key]),data.totals.calls]]);
}
function reportSourceRows(rows){const sources=new Map();for(const row of rows){const ids=ui.reportSource==='all'?leadSourceIds(row):[row.source];for(const id of ids){const total=sources.get(id)||{name:sourceName(id),total:0,commitments:0,calculations:0};total.total+=row.total;total.commitments+=row.commitments;total.calculations+=row.calculations;sources.set(id,total);}}return [...sources.values()];}
function reportSourceIds(row){return ui.reportSource==='all'?leadSourceIds(row):[row.source];}
function reportSourceBadges(row){return '<span class="lead-source-badges">'+reportSourceIds(row).map(sourceBadge).join('')+'</span>';}
function reportSourceLabel(row){return reportSourceIds(row).map(sourceName).join(' · ');}

function conversionReportsPage(){const cid=isChief()?(ui.reportCompany==='current'?company().id:ui.reportCompany):company().id;const rows=reportRows(state,{companyId:cid,sellerId:ui.reportSeller,source:ui.reportSource,from:ui.reportFrom,to:ui.reportTo});const sum=k=>rows.reduce((n,r)=>n+r[k],0),total=sum('total'),comm=sum('commitments'),calc=sum('calculations'),contacted=sum('contacted');const aggregate=(key,name)=>{const m=new Map();rows.forEach(r=>{const id=r[key];const a=m.get(id)||{name:name(r),total:0,commitments:0,calculations:0};a.total+=r.total;a.commitments+=r.commitments;a.calculations+=r.calculations;m.set(id,a);});return [...m.values()];};return `${heading('Van activiteit naar resultaat','Bekijk conversie per bedrijf, verkoper en bron. De cijfers volgen de opgeslagen opvolging van jouw selectie.',btn(`${icon('download')} Rapport exporteren`,'export-report'))}<section class="panel report-filters"><div class="toolbar">${isChief()?`<label class="field"><span>Bedrijf</span><select data-field="reportCompany"><option value="current" ${ui.reportCompany==='current'?'selected':''}>Actief bedrijf</option><option value="all" ${ui.reportCompany==='all'?'selected':''}>Alle bedrijven</option>${reportingCompanyOptions().map(([id,name])=>`<option value="${esc(id)}" ${ui.reportCompany===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`:''}<label class="field"><span>Verkoper</span><select data-field="reportSeller"><option value="all">Alle verkopers</option>${state.users.filter(u=>cid==='all'||u.companyId===cid||Object.values(state.workspaces[cid]||{}).some(w=>w.ownerId===u.id)).map(u=>`<option value="${u.id}" ${ui.reportSeller===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label><label class="field"><span>Bron</span><select data-field="reportSource">${[['all','Alle bronnen'],...leadSourceOptions()].map(([v,l])=>`<option value="${v}" ${ui.reportSource===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label><label class="field"><span>Lead aangemaakt vanaf</span><input type="date" value="${ui.reportFrom}" data-field="reportFrom"></label><label class="field"><span>Tot en met</span><input type="date" value="${ui.reportTo}" data-field="reportTo"></label>${btn('Wis filters','reset-report','ghost small')}</div></section><div class="stats-grid">${stat('Toegewezen leads',total,'Selectie op aanmaakdatum lead','layers','blue')}${stat('Gesproken / gebeld',contacted,'Leads met een belregistratie','phone','green')}${stat('Toezeggingen',comm,`${total?Math.round(comm/total*100):0}% van toegewezen leads`,'check','green')}${stat('Klaar voor calculatie',calc,`${total?Math.round(calc/total*100):0}% van toegewezen leads`,'chart','blue')}</div><div class="report-grid"><section class="panel"><div class="panel-head"><h2>Conversie per bron</h2><span class="badge blue">Toezeggingen</span></div><div class="panel-body">${reportSourceRows(rows).map(r=>chartRow(r)).join('')||'<p class="muted">Geen gegevens in deze selectie.</p>'}${ui.reportSource==='all'?'<p class="report-membership-note">Bronfilters kunnen overlappen. Binnen een bedrijf telt een project één keer mee in het totaal.</p>':''}</div></section><section class="panel"><div class="panel-head"><h2>${cid==='all'?'Conversie per bedrijf':'Conversie per verkoper'}</h2></div><div class="panel-body">${aggregate(cid==='all'?'companyId':'sellerId',r=>cid==='all'?r.companyName:r.sellerName).map(r=>chartRow(r)).join('')||'<p class="muted">Geen gegevens in deze selectie.</p>'}</div></section></div><section class="panel"><div class="panel-head"><h2>Resultaten in detail</h2><span class="muted">${rows.length} combinaties</span></div><div class="table-wrap"><table><thead><tr><th>Bedrijf</th><th>Verkoper</th><th>Bron</th><th>Leads</th><th>Gebeld</th><th>Toezegging</th><th>Calculatie</th><th>Conversie</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.companyName)}</td><td>${esc(r.sellerName)}</td><td>${reportSourceBadges(r)}</td><td>${r.total}</td><td>${r.contacted}</td><td>${r.commitments}</td><td>${r.calculations}</td><td><strong>${Math.round(r.conversion)}%</strong></td></tr>`).join('')||'<tr><td colspan="8">Geen resultaten.</td></tr>'}</tbody></table></div></section><div class="report-definition"><strong>Zo rekenen we</strong><p>Conversie = leads met toezegging ÷ toegewezen leads. Calculatie heeft een eigen percentage en is een apart vinkje. De periode selecteert de aanmaakdatum van de centrale lead; de vinkjes tonen de huidige stand. Niet toegewezen leads tellen niet mee. Bij overplaatsing blijven resultaten bij het oorspronkelijke bedrijf en de vastgelegde verkoper.</p></div>`;}
function chartRow(r){const n=r.total?Math.round(r.commitments/r.total*100):0;return `<div class="chart-row"><div class="chart-label"><strong>${esc(r.name)}</strong><span>${r.commitments} van ${r.total} leads</span></div><div class="chart-track"><div class="chart-fill" style="width:${n}%"></div></div><span class="chart-value">${n}%</span></div>`;}
function sourcesPage(){
 const sources=activeSources();
 return heading('Een centrale plek voor je bronnen','Maak voor elke Bouwfilterselectie een eigen bron. Overlappende projecten delen dezelfde opvolging.',isChief()?btn(icon('plus')+' Bron toevoegen','new-source','primary'):'')+'<div class="integration-grid">'+(sources.map(s=>{
  const mail=s.id==='outlook'||s.kind==='mail',bouw=sourceProvider(s)==='bouwberichten',status=sourceImportStatus(s);
  return '<section class="integration-card"><div class="integration-card-top"><span class="integration-icon '+(mail?'blue':'')+'">'+icon(mail?'mail':s.id==='hotels'?'building':s.id==='vve'?'users':'layers')+'</span><span class="badge '+status.tone+'">'+status.label+'</span></div><h2>'+esc(s.name)+'</h2><p>'+(bouw?'Projectkansen uit jouw Bouwberichten-selectie, centraal beschikbaar voor ieder bedrijf.':s.id==='hotels'?'Hotelprojecten, renovaties en contactgegevens op één plek.':s.id==='vve'?'Onderhouds- en renovatiekansen bij verenigingen van eigenaars.':mail?'Later: e-mails matchen op contact, organisatie en project. Alleen na toestemming.':'Een eigen bron voor centrale leads. Voeg leads handmatig toe of laat je connector projecten importeren.')+'</p>'+sourceFilterHTML(s)+'<div class="integration-meta"><strong>'+(mail?'0 gekoppelde mailboxen':state.leads.filter(l=>leadMatchesSource(l,s.id)).length+' leads')+'</strong>'+(mail?'<span>Nog geen e-mailtoegang</span>':sourceImportSummary(s))+'</div>'+sourceScraperCardHTML(s)+(s.url?'<div class="configured-url">Ingestelde URL: '+esc(s.url)+'</div>':'')+(isChief()?'<div class="source-actions">'+(!mail?(bouw?sourceManualRunButton(s)+btn('Automatisch ophalen','source-scraper','secondary','data-id="'+esc(s.id)+'"'):'')+btn('Import instellen','source-import',bouw?'secondary':'primary','data-id="'+esc(s.id)+'"'):'')+btn(mail?'Bekijk koppelplan':'Bron configureren','source-config','secondary','data-id="'+esc(s.id)+'"')+(bouw?btn('Filter als nieuwe bron','new-source-filter','secondary','data-id="'+esc(s.id)+'"'):'')+btn('Verwijderen','delete-source','danger','data-id="'+esc(s.id)+'" aria-label="Verwijder bron '+esc(s.name)+'"')+'</div>':'<p class="muted">De hoofdbeheerder beheert deze bron.</p>')+'</section>';
 }).join('')||'<section class="panel source-empty"><div class="empty-state">'+icon('layers')+'<h2>Nog geen bronnen</h2><p>'+(isChief()?'Voeg een bron toe om nieuwe leads aan te koppelen.':'Vraag de hoofdbeheerder om een bron toe te voegen.')+'</p>'+(isChief()?btn('Bron toevoegen','new-source','primary'):'')+'</div></section>')+'</div><section class="panel security-panel"><div class="panel-body split">'+icon('shield')+'<div><h2>Veilige import per bron</h2><p>Iedere bron heeft een eigen importadres en token. Een scraper levert daar projecten aan; het dashboard logt niet zelf in op bronsites. De opgeslagen Bouwfilterlink bepaalt welke selectie bij die bron hoort. Na de eerste geslaagde aanlevering zie je de importdatum en aantallen. Outlook krijgt later een afzonderlijke toestemmingsstap.</p></div></div></section>';
}

function inviteStatus(i){if(i.status==='revoked')return 'Ingetrokken';if(i.status==='accepted'||i.status==='used')return 'Geaccepteerd';if(i.status==='expired'||new Date(i.expiresAt)<=Date.now())return 'Verlopen';return 'Openstaand';}
function inviteOpen(i){return !['revoked','accepted','used'].includes(i.status);}
const canManageInvitation=i=>canManage()&&(isChief()||i.companyId===currentUser().companyId&&i.role!=='hoofdbeheerder');
const companyUsers=id=>state.users.filter(user=>user.companyId===id);
function companyManagementCard(c){
 const users=companyUsers(c.id),canDelete=isChief()&&!users.length;
 return `<section class="company-card ${c.id===company().id?'selected':''}" data-company-card="${esc(c.id)}">${companyLogoMarkup(c)}<div><h2>${esc(c.name)}</h2><p>${users.length} gebruikers · ${c.columns.length} Kanban-kolommen</p></div><div class="company-card-actions">${isChief()?btn(c.id===company().id?'Actieve werkplek':'Open werkplek','switch-company','ghost small',`data-id="${esc(c.id)}"`):'<span class="badge blue">Jouw bedrijf</span>'}${canManage()?btn(`${icon('edit')} Bewerken`,'edit-company','secondary small',`data-id="${esc(c.id)}" aria-label="Bewerk ${esc(c.name)}"`)+btn(companyLogoSource(c)?'Logo wijzigen':'Logo toevoegen','edit-company','secondary small',`data-id="${esc(c.id)}" data-logo-shortcut aria-label="${companyLogoSource(c)?'Wijzig':'Voeg'} logo ${esc(c.name)}"`):''}${isChief()?btn('Bedrijf verwijderen','delete-company','danger small',`data-id="${esc(c.id)}" ${canDelete?'':`disabled aria-describedby="company-delete-help-${esc(c.id)}"`}`):''}</div>${isChief()&&users.length?`<p class="company-delete-help" id="company-delete-help-${esc(c.id)}">Verwijderen kan zodra alle gebruikers aan een ander bedrijf zijn gekoppeld.</p>`:''}</section>`;
}
function invitationActions(i){if(!canManageInvitation(i))return '—';return '<div class="invitation-actions">'+(inviteOpen(i)?btn('Nieuwe link','rotate-invite','secondary small','data-id="'+esc(i.id)+'"')+' '+btn('Intrekken','revoke-invite','ghost small','data-id="'+esc(i.id)+'"'):'')+' '+btn('Verwijderen','delete-invite','danger small','data-id="'+esc(i.id)+'" aria-label="Verwijder uitnodiging voor '+esc(i.email)+'"')+'</div>';}
function teamPage(){
 const cs=isChief()?state.companies:state.companies.filter(c=>c.id===company().id),users=state.users.filter(u=>isChief()||cs.some(c=>c.id===u.companyId)),invs=state.invitations.filter(i=>isChief()||cs.some(c=>c.id===i.companyId));
 return heading('Bedrijven & mensen','Kies per gebruiker een rol en een bedrijf. Voor hoofdbeheerders is een bedrijf optioneel.',(isChief()?btn(icon('plus')+' Bedrijf toevoegen','new-company'):'')+(canManage()?btn(icon('link')+' Uitnodigingslink maken','invite','primary'):''))+
 '<div class="company-grid">'+(cs.map(companyManagementCard).join('')||'<section class="panel empty-state"><h2>Nog geen bedrijven</h2><p>Voeg een bedrijf toe en kies daarna een eigen logo.</p>'+btn('Bedrijf toevoegen','new-company','primary')+'</section>')+'</div>'+
 '<section class="panel"><div class="panel-head"><h2>Gebruikers</h2><span class="badge neutral">'+users.length+' personen</span></div><div class="table-wrap"><table><thead><tr><th>Naam</th><th>E-mailadres</th><th>Bedrijf</th><th>Rol</th><th>Status</th>'+(isChief()?'<th>Beheer</th>':'')+'</tr></thead><tbody>'+users.map(u=>'<tr><td><strong>'+esc(u.name)+'</strong>'+(u.id===currentUser().id?'<span class="badge blue inline-badge">Jij</span>':'')+'</td><td>'+esc(u.email)+'</td><td>'+esc(accountCompanyName(u))+'</td><td>'+esc(u.role)+'</td><td><span class="badge '+(u.status==='uitgenodigd'?'amber':'green')+'">'+(u.status==='uitgenodigd'?'Uitgenodigd':'Actief')+'</span></td>'+(isChief()?'<td>'+btn('Aanpassen','edit-user','ghost small','data-id="'+u.id+'"')+'</td>':'')+'</tr>').join('')+'</tbody></table></div></section>'+
 '<section class="panel"><div class="panel-head"><div><h2>Uitnodigingslinks</h2><p>Deel de link zelf met de bedoelde ontvanger. Er wordt geen e-mail verzonden.</p></div><span class="badge blue">Eenmalig · 7 dagen geldig</span></div><div class="table-wrap"><table><thead><tr><th>E-mailadres</th><th>Bedrijf</th><th>Rol</th><th>Status en verloopdatum</th><th>Actie</th></tr></thead><tbody>'+invs.map(i=>'<tr><td><strong>'+esc(i.name)+'</strong><div>'+esc(i.email)+'</div></td><td>'+esc(accountCompanyName(i))+'</td><td>'+esc(i.role)+'</td><td><span class="badge '+(inviteStatus(i)==='Openstaand'?'blue':'neutral')+'">'+inviteStatus(i)+'</span><div class="lead-meta">'+fmt(i.expiresAt)+'</div></td><td>'+invitationActions(i)+'</td></tr>').join('')+(invs.length?'':'<tr><td colspan="5" class="muted">Nog geen uitnodigingen. Maak een link om een collega uit te nodigen.</td></tr>')+'</tbody></table></div></section>'+
 '<div class="report-definition"><strong>Rollen en toegang</strong><p>De hoofdbeheerder beheert alle bedrijven en bronnen. Bedrijfsbeheerders nodigen mensen uit voor hun eigen bedrijf. Verkopers werken binnen hun eigen werkplek. De server controleert de toegang; notities en opvolging blijven bij het oorspronkelijke bedrijf.</p></div>';
}
function settingsPage(){
 const unit=state.settings.cooldownUnit==='days'?'days':'hours',amount=state.settings.cooldownHours/(unit==='days'?24:1),disabled=!isChief()?'disabled':'';
 return heading('Heldere afspraken, betere opvolging','De belwachttijd is één globale instelling en geldt ook voor nieuwe bedrijven.')+'<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Belwachttijd tussen bedrijven</h2>'+icon('clock')+'</div><form id="cooldown-form" class="panel-body"><p>Na een belregistratie op een centrale lead wacht een ander bedrijf de ingestelde periode. Dit geldt alleen voor die lead.</p><div class="cooldown-duration"><label class="field"><span id="cooldown-amount-label">Aantal '+(unit==='days'?'dagen':'uren')+'</span><input name="duration" type="number" min="0" max="'+(unit==='days'?365:8760)+'" step="'+(unit==='days'?'any':'1')+'" required value="'+amount+'" aria-describedby="cooldown-help" '+disabled+'></label><label class="field"><span>Eenheid</span><select name="unit" data-duration-unit="'+unit+'" '+disabled+'><option value="hours" '+(unit==='hours'?'selected':'')+'>Uren</option><option value="days" '+(unit==='days'?'selected':'')+'>Dagen</option></select></label></div><p class="muted help-text" id="cooldown-help">1 dag = 24 uur. Maximaal 365 dagen.</p><div class="info-box"><strong>Uitzondering: eigen terugbelafspraak</strong><p>Is een open terugbelafspraak aan jou toegewezen en is het tijdstip bereikt? Dan kun je die lead bellen, ook als een ander bedrijf recent heeft gebeld.</p></div>'+(isChief()?'<button class="button primary" type="submit">Instelling opslaan</button>':'<p class="muted">Alleen de hoofdbeheerder kan dit wijzigen.</p>')+'</form></section><section class="panel"><div class="panel-head"><h2>Jouw werkplek</h2>'+icon('shield')+'</div><div class="panel-body"><p><strong>'+esc(company().name)+'</strong><br>'+esc(currentUser().name)+' · '+esc(currentUser().role)+'</p><p>Je wijzigingen worden op de server opgeslagen en gedeeld met je collega’s. De importinstellingen en de laatste aanlevering vind je bij Bronnen. Outlook is nog niet gekoppeld.</p>'+btn('Mijn account','account')+'<p class="muted help-text">Meldingen verschijnen in het geopende dashboard. Wijzigingen van collega’s worden iedere 30 seconden opgehaald.</p></div></section></div>';
}
function changeCooldownUnit(select){
 const input=select.closest('form').querySelector('[name="duration"]'),previous=select.dataset.durationUnit,next=select.value;
 if(!['hours','days'].includes(next))return;
 if(input.value!==''&&Number.isFinite(Number(input.value)))input.value=String(Number(input.value)*(previous==='days'?24:1)/(next==='days'?24:1));
 input.max=String(next==='days'?365:8760);input.step=next==='days'?'any':'1';select.dataset.durationUnit=next;
 $('#cooldown-amount-label').textContent='Aantal '+(next==='days'?'dagen':'uren');
}
function renderOverlay(){
 if(loggingOut)return;
 const root=$('#overlay-root'),existing=root.querySelector('.modal');
 if(ui.modal?.type==='source-scraper'&&existing?.dataset.scraperSourceId===ui.modal.id){const source=leadSources().find(s=>s.id===ui.modal.id&&sourceProvider(s)==='bouwberichten');if(source&&isChief()){updateScraperModal(existing,source,ui.modal);return;}}
 const oldBody=root.querySelector('.detail-body');if(oldBody&&oldBody.closest('[data-drawer-id]')?.dataset.drawerId===ui.drawer)drawerScroll=oldBody.scrollTop;
 if(ui.modal){root.innerHTML=modalHTML();if(ui.modal.type==='source-scraper'){const modal=root.querySelector('.modal[data-scraper-source-id]'),source=leadSources().find(s=>s.id===ui.modal.id);if(modal&&source)updateScraperModal(modal,source,ui.modal);}if(ui.modal.type==='delete-lead'&&ui.modal.busy)root.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=true);updateCompanyLogoPreview();requestAnimationFrame(()=>root.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),button:not([disabled])')?.focus());}
 else if(ui.drawer){root.innerHTML=drawerHTML();const body=root.querySelector('.detail-body');if(body)body.scrollTop=drawerScroll;}else root.innerHTML='';
 document.body.classList.toggle('overlay-open',!!(ui.modal||ui.drawer));
 if(ui.drawer&&!ui.modal)updateLeadSaveUI();
}

function leadValues(w){return Object.fromEntries(leadFields.map(field=>[field,['commitment','calculation'].includes(field)?!!w[field]:field==='ownerId'?w[field]||null:leadContactFields.includes(field)?String(w[field]??''):w[field]]));}
function getLeadDraft(leadId=ui.drawer,w=work(leadId)){
 if(!leadDraft||leadDraft.leadId!==leadId||leadDraft.companyId!==ui.companyId||leadDraft.userId!==ui.userId)leadDraft={leadId,companyId:ui.companyId,userId:ui.userId,base:leadValues(w),changes:{},note:'',noteId:null,saving:false,error:''};
 return leadDraft;
}
function draftLeadField(draft,field,value){if(value===draft.base[field])delete draft.changes[field];else draft.changes[field]=value;}
function draftLeadNote(draft,value){if(draft.note.trim()!==value.trim())draft.noteId=null;draft.note=value;}
function captureLeadDraft(){
 const root=$('.workbook-drawer');if(!state||!ui.drawer||root?.dataset.drawerId!==ui.drawer)return null;
 const draft=getLeadDraft();if(draft.saving)return draft;
 root.querySelectorAll('[data-work]').forEach(control=>{const field=control.dataset.work;if(leadFields.includes(field))draftLeadField(draft,field,control.type==='checkbox'?control.checked:field==='ownerId'?control.value||null:control.value);});
 const note=root.querySelector('#note-form textarea[name="text"]');if(note)draftLeadNote(draft,note.value);
 const parties=root.querySelector('[data-lead-parties]');if(parties)draft.partiesOpen=parties.open;
 return draft;
}
function openLeadDrawer(id,target){
 if(leadDraft?.saving||leadDraft?.contactSelectionSaving)return;
 if(!ui.drawer||!leadReturn||leadReturn.route!==ui.route||leadReturn.companyId!==ui.companyId){const main=$('#main');leadReturn={route:ui.route,companyId:ui.companyId,target,leadId:id,x:window.scrollX,y:window.scrollY,scrolls:['#main','.table-wrap','.kanban'].map(selector=>{const element=selector==='#main'?main:main?.querySelector(selector);return{selector,left:element?.scrollLeft||0,top:element?.scrollTop||0};})};}
 ui.modal=null;if(ui.drawer!==id){drawerScroll=0;leadDraft=null;}ui.drawer=id;getLeadDraft(id);lastFocus=target;renderOverlay();$('#detail-title')?.focus();
}
function closeLeadDrawer({saved=false}={}){
 if(leadDraft?.saving||leadDraft?.contactSelectionSaving)return;
 const back=leadReturn;ui.drawer=null;leadDraft=null;leadReturn=null;drawerScroll=0;
 if(saved)render();else renderOverlay();
 if(!back||back.route!==ui.route||back.companyId!==ui.companyId)return;
 requestAnimationFrame(()=>{
  const main=$('#main'),target=back.target?.isConnected?back.target:[...main?.querySelectorAll('[data-action="open-lead"]')??[]].find(element=>element.dataset.id===back.leadId);
  (target||main)?.focus({preventScroll:true});
  for(const position of back.scrolls){const element=position.selector==='#main'?main:main?.querySelector(position.selector);if(element){element.scrollLeft=position.left;element.scrollTop=position.top;}}
  window.scrollTo(back.x,back.y);
 });
}
function leadDeleteHTML(m){
 const lead=state.leads.find(item=>item.id===m.id);if(!lead||!isChief())return modalShell('Lead niet beschikbaar','<p>Deze lead is verwijderd of je hebt geen toegang tot deze beheeractie.</p>',btn('Sluiten','close-modal'));
 const records=Object.values(state.workspaces).map(workspace=>workspace?.[lead.id]).filter(Boolean),notes=records.reduce((n,w)=>n+(w.notes?.length||0),0),callbacks=records.reduce((n,w)=>n+(w.callbacks||[]).filter(cb=>!cb.done).length,0);
 const changed=leadDraft&&(Object.keys(leadDraft.changes).length||leadDraft.note.trim()),external=lead.importExternalId||lead.projectDetails?.projectNumber,externalLabel=state.sources.some(source=>leadSourceIds(lead).includes(source.id)&&sourceProvider(source)==='bouwberichten')?'Bouwberichten-ID':'Bron-ID';
 return modalShell('Lead voor alle bedrijven verwijderen?',`<p>Je verwijdert <strong>${esc(lead.title)}</strong>${external?` (${externalLabel}: <strong>${esc(external)}</strong>)`:''} uit de werkvoorraad van <strong>alle bedrijven</strong>.</p><div class="info-box lead-delete-consequences"><strong>Dit gebeurt na bevestigen</strong><ul><li>De lead verdwijnt uit overzichten, Kanban en bellijsten.</li><li>Open terugbelafspraken en meldingen voor deze lead stoppen.</li><li>Eerdere telefoontjes, notities en resultaten blijven bewaard; rapportages blijven meetellen.</li><li>Volgende imports slaan deze lead over, ook via een ander Bouwberichten-filter.</li></ul></div>${notes||callbacks?`<p class="muted">Opgeslagen bij deze lead: ${notes} notitie${notes===1?'':'s'} en ${callbacks} open terugbelafspraak${callbacks===1?'':'en'}.</p>`:''}${changed?'<p class="lead-delete-draft-warning"><strong>Je hebt nog niet opgeslagen wijzigingen.</strong> Deze conceptwijzigingen worden bij verwijderen niet opgeslagen. Kies Annuleren om terug te gaan.</p>':''}<label class="field"><span>Reden (optioneel)</span><textarea data-lead-delete-reason maxlength="1000" rows="2" placeholder="Bijvoorbeeld: geen werkzaamheden voor onze groep">${esc(m.reason||'')}</textarea></label><p class="auth-error" data-lead-delete-error role="alert" ${m.error?'':'hidden'}>${esc(m.error||'')}</p>`,btn('Annuleren','close-modal','secondary',m.busy?'disabled':'')+btn(m.busy?'Lead verwijderen…':'Verwijder lead compleet','confirm-delete-lead','danger',`data-id="${esc(m.id)}" ${m.busy?'disabled':''}`),false,'data-lead-delete-confirm');
}
async function deleteLeadCompletely(context){
 if(!isChief()||ui.modal!==context||context.type!=='delete-lead'||context.busy||ui.drawer!==context.id)return;
 context.reason=$('[data-lead-delete-reason]')?.value||context.reason||'';context.error='';context.busy=true;renderOverlay();
 try{await mutate('lead.delete',{leadId:context.id,confirmed:true,reason:context.reason},context.companyId);if(ui.modal!==context||!state)return;context.busy=false;ui.modal=null;closeLeadDrawer({saved:true});toast('Lead voor alle bedrijven verwijderd. Rapportages blijven bewaard.');}
 catch(error){context.busy=false;if(state&&ui.modal===context){context.error=error.message||'Verwijderen is niet gelukt. Probeer het opnieuw.';renderOverlay();}}
}
function updateLeadSaveUI(){
 const root=$('.workbook-drawer');if(!root||!leadDraft||root.dataset.drawerId!==leadDraft.leadId)return;
 const focused=document.activeElement;
 const busy=leadDraft.saving||leadDraft.contactSelectionSaving;
 root.querySelectorAll('button,input,select,textarea').forEach(control=>{if(busy){if(!control.hasAttribute('data-lead-save-disabled'))control.dataset.leadSaveDisabled=String(control.disabled);control.disabled=true;}else if(control.hasAttribute('data-lead-save-disabled')){control.disabled=control.dataset.leadSaveDisabled==='true';control.removeAttribute('data-lead-save-disabled');}});
 const button=root.querySelector('[data-action="save-close-lead"]'),error=root.querySelector('.workbook-save-error');
 if(button){button.textContent=leadDraft.contactSelectionSaving?'Contact opslaan…':leadDraft.saving?'Opslaan…':'Opslaan en sluiten';button.setAttribute('aria-busy',String(!!busy));}
 if(error){error.textContent=leadDraft.error;error.hidden=!leadDraft.error;}
 updateLeadContactUI();
 if(leadDraft.saving&&root.contains(focused))root.querySelector('#detail-title')?.focus({preventScroll:true});
}
async function saveLeadDraft({close=false}={}){
 const draft=captureLeadDraft();if(!draft||draft.saving||draft.contactSelectionSaving)return;
 updateLeadContactUI();
 const invalidContact=[...$('.workbook-contact-person')?.querySelectorAll('input')??[]].find(input=>!input.checkValidity());
 if(invalidContact){draft.error=invalidContact.dataset.work==='contactName'?'Vul de naam van de contactpersoon in.':invalidContact.dataset.work==='contactEmail'?'Vul een geldig e-mailadres in of laat het veld leeg.':'Controleer het rechtstreekse telefoonnummer.';updateLeadSaveUI();invalidContact.focus();invalidContact.reportValidity();return;}
 const note=draft.note.trim();if(!close&&!note){draft.error='Schrijf eerst een notitie.';updateLeadSaveUI();return;}
 if(note&&!draft.noteId)draft.noteId='note-'+crypto.randomUUID();
 const payload={leadId:draft.leadId,changes:{...draft.changes},...(note?{note:{id:draft.noteId,text:note}}:{})};
 draft.saving=true;draft.error='';updateLeadSaveUI();
 try{
  await mutate('workspace.save',payload,draft.companyId);
  draft.saving=false;draft.changes={};draft.note='';draft.noteId=null;draft.error='';
  if(ui.drawer!==draft.leadId||ui.companyId!==draft.companyId)return;
  if(close)closeLeadDrawer({saved:true});else{draft.base=leadValues(work(draft.leadId));render();$('#note-form textarea[name="text"]')?.focus();}
  toast(close?'Opgeslagen.':'Notitie opgeslagen en gedeeld met je bedrijf.');
 }catch(error){draft.saving=false;draft.error=error.message||'Opslaan is niet gelukt. Probeer het opnieuw.';if(state&&ui.drawer===draft.leadId)updateLeadSaveUI();}
}

function leadPhone(l){const phone=String(l.phone||'').replace(/[^+\d]/g,'');return /\d/.test(phone)?phone:'';}
function leadSourceLink(l){try{const url=new URL(l.sourceUrl);return ['https:','http:'].includes(url.protocol)?'<p class="lead-source-link"><a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">Project bij de bron '+icon('link')+'</a></p>':'';}catch{return '';}}
function safeLeadLink(value){
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function leadImageURL(l){return /^\/api\/lead-images\/lead-[0-9a-f-]{36}\?v=[0-9a-f]{64}$/.test(l.projectImageUrl??'')?l.projectImageUrl:'';}
const projectDay=value=>isProjectDate(value)?fmt(value,{year:'numeric',hour:undefined,minute:undefined}):'';

function workbookProjectHTML(l){
 const d=l.projectDetails??{},photo=leadImageURL(l),website=safeLeadLink(d.website);
 const metrics=[['Omvang',d.scope],['Raming',l.budget],['Start bouw',projectDay(d.scheduleStart)],['Oplevering',projectDay(d.scheduleEnd)]].filter(([,value])=>value);
 const facts=[['Plan',d.plan],['Deelplan',d.subplan],['Locatie',d.address||l.city],['Oppervlakte',d.surface],['Bouwlagen',d.layers],['Duurzame eigenschappen',d.sustainability]].filter(([,value])=>value);
 return `<section class="workbook-column" aria-labelledby="workbook-project">
  <h3 id="workbook-project">Project</h3>
  ${photo?`<button type="button" class="workbook-photo" data-action="lead-photo" data-id="${esc(l.id)}" aria-label="Vergroot projectimpressie"><img src="${esc(photo)}" alt="Projectimpressie ${esc(l.title)}"><span>Vergroot beeld</span></button>`:''}
  ${metrics.length?`<dl class="workbook-metrics">${metrics.map(([key,value])=>`<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}
  ${l.description?`<p class="workbook-description">${esc(l.description)}</p>`:''}
  ${facts.length||website?`<details class="workbook-details" open><summary>Projectdetails</summary><dl class="project-facts">${facts.map(([key,value])=>`<dt>${key}</dt><dd>${esc(value)}</dd>`).join('')}${website?`<dt>Projectwebsite</dt><dd><a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Open projectwebsite</a></dd>`:''}</dl></details>`:''}
  ${leadSourceLink(l)}
 </section>`;
}

function selectedContactContext(leadId,partyIndex,partyFingerprint,expectedContact){
 const lead=state?.leads.find(item=>item.id===leadId),workspace=lead?work(lead):null,party=lead?partyContact(lead,partyIndex):null,current=lead?effectiveLeadContact(lead,workspace):null;
 if(!lead||ui.drawer!==leadId||!party||!hasLeadContact(party))throw Error('Deze betrokken partij is niet beschikbaar als contact.');
 if(contactFingerprint(party)!==partyFingerprint||contactFingerprint(current)!==expectedContact)throw Error('De contactgegevens zijn inmiddels gewijzigd. Open de lead opnieuw en controleer je keuze.');
 return{id:leadId,companyId:ui.companyId,userId:ui.userId,partyIndex,partyFingerprint,expectedContact,party,current,currentEqual:partyFingerprint===expectedContact,alreadySelected:!!workspace.selectedContact,selectionBusy:false,selectionError:''};
}
async function selectPartyContact(leadId,partyIndex,partyFingerprint,expectedContact){
 if(leadDraft?.saving||leadDraft?.contactSelectionSaving)return;
 const context=selectedContactContext(leadId,partyIndex,partyFingerprint,expectedContact);
 if(context.alreadySelected&&context.currentEqual)return;
 captureLeadDraft();
 if(hasLeadContact(context.current)){openModal('select-party-contact',leadId,context);return;}
 await saveSelectedPartyContact(context,false);
}
async function saveSelectedPartyContact(context,confirmed){
 if(context.selectionBusy||leadDraft?.saving||leadDraft?.contactSelectionSaving||!state||ui.drawer!==context.id||ui.companyId!==context.companyId||ui.userId!==context.userId)return;
 const draft=captureLeadDraft()||getLeadDraft(context.id);if(!draft)return;
 context.selectionBusy=true;context.selectionError='';draft.contactSelectionSaving=true;draft.error='';
 if(ui.modal===context)renderOverlay();else updateLeadSaveUI();
 try{
  await mutate('workspace.contact.select',{leadId:context.id,partyIndex:context.partyIndex,partyFingerprint:context.partyFingerprint,expectedContact:context.expectedContact,confirmed},context.companyId);
  if(!state||ui.drawer!==context.id||ui.companyId!==context.companyId||ui.userId!==context.userId)return;
  if(ui.modal===context)ui.modal=null;
  toast('Contact voor deze lead bijgewerkt.');
 }catch(error){
  context.selectionError=error.message||'Het contact kon niet worden opgeslagen. Probeer het opnieuw.';
  if(ui.modal!==context)draft.error=context.selectionError;
 }finally{
  context.selectionBusy=false;draft.contactSelectionSaving=false;
  if(state&&ui.drawer===context.id&&ui.companyId===context.companyId&&ui.userId===context.userId){renderOverlay();updateLeadSaveUI();}
 }
}
function workbookContactHTML(l,w,e){
 const d=l.projectDetails??{},chosen=effectiveLeadContact(l,w),selected=!!w.selectedContact,phone=leadPhone(chosen),email=String(chosen.email||'').trim(),website=safeLeadLink(chosen.website),canCall=!!phone&&e.allowed;
 const actorId=currentUser().id;
 const latestOwn=[...w.calls].reverse().find(call=>call.userId===actorId);
 const pending=latestOwn&&!latestOwn.outcome&&Date.now()-Date.parse(latestOwn.at)<8*3600000?latestOwn:null;
 const people=chosen.contact;
 return `<section class="workbook-column" aria-labelledby="workbook-contact">
  <h3 id="workbook-contact">Contact</h3>
  <div class="workbook-contact" data-selected-contact-card>
   <span class="workbook-role">${esc(selected?'Contact voor deze lead':chosen.role||'Contact voor deze lead')}</span>
   <strong class="workbook-org">${esc(chosen.name||'Organisatie nog niet bekend')}</strong>
   ${selected&&chosen.role?`<p class="muted">${esc(chosen.role)}</p>`:''}
   ${canCall?`<a class="button primary workbook-call" href="tel:${esc(phone)}" data-action="call-link" data-id="${esc(l.id)}">${icon('phone')} Bel ${esc(chosen.phone)}</a>`:phone?`<span class="button disabled workbook-call" aria-disabled="true">${icon('clock')} Tijdelijk niet belbaar</span>`:'<p class="muted">Geen telefoonnummer beschikbaar</p>'}
   ${people?`<div class="workbook-contact-name"><span>${!selected&&w.lastContactPerson?'Gesproken met':'Contactpersoon'}</span><strong>${esc(people)}</strong></div>`:'<p class="muted">Contactpersoon nog niet bekend</p>'}
   ${!selected&&chosen.role==='Hoofdaannemer'&&phone?'<p class="workbook-number-hint">Algemeen nummer</p>':''}
   <div class="workbook-contact-links">${email?`<a href="mailto:${esc(encodeURIComponent(email).replace(/%40/g,'@'))}">E-mail</a>`:''}${website?`<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Website</a>`:''}${canCall?btn('Kopieer nummer','copy-lead-phone','ghost small',`data-id="${esc(l.id)}"`):''}</div>
   ${phone&&e.reason==='cooldown'?`<div class="call-notice amber"><strong>Wachttijd tot ${fmt(e.until)}</strong><p>Een ander bedrijf heeft deze lead recent gebeld.</p></div>`:phone&&e.reason==='callback'?'<div class="call-notice green">Je eigen terugbelmoment is bereikt.</div>':''}
  </div>
  ${canCall||pending?btn(pending?'Beluitkomst vastleggen':'Gesprek registreren','call-outcome','secondary workbook-register',`data-id="${esc(l.id)}" ${pending?`data-call-id="${esc(pending.id)}"`:''}`):''}
  ${Array.isArray(d.parties)&&d.parties.length?`<details class="workbook-details" data-lead-parties ${getLeadDraft(l.id,w).partiesOpen?'open':''}><summary>Overige betrokken partijen (${d.parties.length})</summary>
    ${d.parties.map((p,index)=>{const number=leadPhone(p),candidate=partyContact(l,index),chosenAlready=selected&&candidate&&contactFingerprint(candidate)===contactFingerprint(chosen);return `<div class="workbook-party" data-party-index="${index}"><small>${esc(p.role)}</small><strong>${esc(p.name)}</strong><div>${number&&e.allowed?`<a href="tel:${esc(number)}" data-action="call-link" data-id="${esc(l.id)}" aria-label="Bel ${esc(p.name)} op ${esc(p.phone)}">${esc(p.phone)}</a>`:`<span${number?' title="Tijdelijk niet belbaar door de belwachttijd"':''}>${esc(p.phone)}</span>`} ${p.email?`<a href="mailto:${esc(encodeURIComponent(p.email).replace(/%40/g,'@'))}">E-mail</a>`:''}${safeLeadLink(p.website)?` <a href="${esc(safeLeadLink(p.website))}" target="_blank" rel="noopener noreferrer">Website</a>`:''}</div>${candidate&&hasLeadContact(candidate)?btn(chosenAlready?'Actieve contact':'Selecteren als contact','select-party-contact','secondary small',`data-id="${esc(l.id)}" data-party-index="${index}" data-party-fingerprint="${esc(contactFingerprint(candidate))}" data-expected-contact="${esc(contactFingerprint(chosen))}" ${chosenAlready||getLeadDraft(l.id,w).contactSelectionSaving?'disabled':''}`):''}</div>`;}).join('')}</details>`:''}
 </section>`;
}

function contactPhoneNumber(w){const value=String(w.contactPhone||'').trim();return leadPhone({phone:/^(?:\+|00)/.test(value)?value.replace(/\(0\)/,''):value});}
function contactPersonLinksHTML(l,values){
 const saved=work(l),normalize=(field,value)=>field==='contactEmail'?String(value??'').trim().toLowerCase():String(value??'').trim();
 const pending=leadContactFields.some(field=>normalize(field,values[field])!==normalize(field,saved[field]));
 if(pending)return leadContactFields.some(field=>String(values[field]??'').trim())?'<span class="muted">Beschikbaar na opslaan.</span>':'';
 const phone=contactPhoneNumber(saved),email=String(saved.contactEmail||'').trim(),name=String(saved.contactName||'').trim();
 if(!name)return '';
 const e=eligible(l);
 return (email?'<a class="button secondary" href="mailto:'+esc(encodeURIComponent(email).replace(/%40/g,'@'))+'" aria-label="E-mail '+esc(name)+'">'+icon('mail')+' '+esc(email)+'</a>':'')+(phone?(e.allowed?'<a class="button secondary" href="tel:'+esc(phone)+'" data-action="call-link" data-id="'+esc(l.id)+'" aria-label="Bel '+esc(name)+' rechtstreeks op '+esc(saved.contactPhone)+'">'+icon('phone')+' '+esc(saved.contactPhone)+'</a>':'<span class="muted" title="'+(e.reason==='cooldown'?'Belwachttijd tot '+esc(fmt(e.until)):'Bellen is momenteel niet beschikbaar')+'">'+esc(saved.contactPhone)+' · tijdelijk niet belbaar</span>'):'');
}
function workbookContactPersonHTML(l,w){
 const required=!!(String(w.contactEmail||'').trim()||String(w.contactPhone||'').trim());
 return '<fieldset class="workbook-contact-person"><legend>Contactpersoon</legend><label class="field"><span>Naam contactpersoon</span><input type="text" data-work="contactName" data-id="'+esc(l.id)+'" value="'+esc(w.contactName)+'" maxlength="120" autocomplete="off" '+(required?'required':'')+'></label><label class="field"><span>E-mailadres (optioneel)</span><input type="email" data-work="contactEmail" data-id="'+esc(l.id)+'" value="'+esc(w.contactEmail)+'" maxlength="254" autocomplete="off" inputmode="email"></label><label class="field"><span>Rechtstreeks telefoonnummer (optioneel)</span><input type="tel" data-work="contactPhone" data-id="'+esc(l.id)+'" value="'+esc(w.contactPhone)+'" maxlength="60" autocomplete="off" inputmode="tel"></label><div class="workbook-contact-person-links" data-contact-person-links>'+contactPersonLinksHTML(l,w)+'</div></fieldset>';
}
function updateLeadContactUI(){
 const root=$('.workbook-contact-person');if(!state||!ui.drawer||!root||!leadDraft||leadDraft.leadId!==ui.drawer)return;
 const values={...leadDraft.base,...leadDraft.changes},name=root.querySelector('[data-work="contactName"]');
 if(name)name.required=!!(String(values.contactEmail||'').trim()||String(values.contactPhone||'').trim());
 const lead=state.leads.find(l=>l.id===ui.drawer),links=root.querySelector('[data-contact-person-links]');if(lead&&links){const html=contactPersonLinksHTML(lead,values);if(links.innerHTML!==html)links.innerHTML=html;}
}
function workbookFollowupHTML(l,w){
 const draft=getLeadDraft(l.id,w);for(const [field,value]of Object.entries(leadValues(w)))if(!Object.hasOwn(draft.changes,field))draft.base[field]=value;w={...w,...draft.changes};
 const members=activeUsers(),historic=w.ownerId&&!members.some(u=>u.id===w.ownerId);
 const conversion=[['commitment','Toezegging ontvangen'],['calculation','Klaar voor calculatie']];
 const notes=w.notes.map(n=>({at:n.createdAt,author:n.authorName,title:'Gespreksnotitie',detail:n.text}));
 const calls=w.calls.map(c=>({at:c.at,author:c.userName||userName(c.userId),title:callOutcomeNames[c.outcome]||'Belmoment',detail:[c.person,c.detail].filter(Boolean).join(' · ')}));
 const activity=[...notes,...calls].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 return `<section class="workbook-column workbook-followup" aria-labelledby="workbook-followup">
  <h3 id="workbook-followup">Opvolging bij ${esc(company().name)}</h3>
  <div class="form-grid">
   <label class="field"><span>Kanban-status</span><select data-work="status" data-id="${esc(l.id)}">${company().columns.map(c=>`<option value="${esc(c.id)}" ${w.status===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>
   <label class="field"><span>Prioriteit</span><select data-work="priority" data-id="${esc(l.id)}">${Object.entries(priorityNames).map(([v,n])=>`<option value="${v}" ${w.priority===v?'selected':''}>${n}</option>`).join('')}</select></label>
   <label class="field full"><span>Verantwoordelijke verkoper</span><select data-work="ownerId" data-id="${esc(l.id)}"><option value="">Niet toegewezen</option>${historic?`<option value="${esc(w.ownerId)}" selected>${esc(userName(w.ownerId))} (historisch)</option>`:''}${members.map(u=>`<option value="${esc(u.id)}" ${w.ownerId===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>
  </div>
  ${workbookContactPersonHTML(l,w)}
  <div class="workbook-next">
   <div class="section-heading"><h4>Volgende actie</h4>${btn('Terugbellen plannen','callback','ghost small',`data-id="${esc(l.id)}"`)}</div>
   ${w.callbacks.filter(c=>!c.done).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)).map(c=>callbackCard({...c,lead:l},true)).join('')||'<p class="muted">Geen terugbelafspraak gepland.</p>'}
  </div>
  <form id="note-form" class="workbook-note"><input type="hidden" name="leadId" value="${esc(l.id)}"><label class="field"><span>Gespreksnotitie</span><textarea name="text" placeholder="Wat is besproken? Wat is de volgende stap?" maxlength="4000" required rows="3">${esc(draft.note)}</textarea></label><button class="button primary small" type="submit">Notitie toevoegen</button></form>
  <div class="workbook-checks">${conversion.map(([key,label])=>`<label><input type="checkbox" data-work="${key}" data-id="${esc(l.id)}" ${w[key]?'checked':''}> ${label}</label>`).join('')}</div>
  <div class="workbook-activity"><h4>Activiteit <span class="badge neutral">${activity.length}</span></h4>
   ${activity.map(item=>`<article class="note"><div class="note-meta"><strong>${esc(item.title)} · ${esc(item.author)}</strong><time>${fmt(item.at)}</time></div>${item.detail?`<p>${esc(item.detail).replace(/\n/g,'<br>')}</p>`:''}</article>`).join('')||'<p class="muted">Nog geen gesprekken of notities.</p>'}
  </div>
 </section>`;
}

function drawerHTML(){
 const l=state.leads.find(x=>x.id===ui.drawer);if(!l)return '';
 const w=work(l),d=l.projectDetails??{};
 const context=[d.plan,d.subplan,l.city].filter(Boolean).map(esc).join(' · ');
 return `<div class="detail-overlay" data-action="close-drawer"></div><aside class="detail-drawer workbook-drawer" data-drawer-id="${esc(l.id)}" role="dialog" aria-modal="true" aria-labelledby="detail-title">
  <div class="detail-header workbook-header"><div class="workbook-heading"><div class="workbook-badges">${leadSourceBadges(l)}${l.phase?`<span class="badge neutral">${esc(l.phase)}</span>`:''}${l.demo?'<span class="badge neutral">Demolead</span>':''}</div><h2 id="detail-title" tabindex="-1">${esc(l.title)}</h2>${context?`<p class="muted">${context}</p>`:''}</div><button class="button icon" data-action="close-drawer" aria-label="Lead sluiten">${icon('close')}</button></div>
  <div class="detail-body workbook-columns">${workbookProjectHTML(l)}${workbookContactHTML(l,w,eligible(l))}${workbookFollowupHTML(l,w)}</div>
  <footer class="workbook-footer"><p class="workbook-save-error" role="alert" hidden></p>${isChief()?`<button type="button" class="button danger workbook-delete-lead" data-action="delete-lead" data-id="${esc(l.id)}">Verwijder lead compleet</button>`:''}<button type="button" class="button primary" data-action="save-close-lead">Opslaan en sluiten</button></footer>
 </aside>`;
}
function modalShell(title,body,footer='',wide=false,attributes=''){return `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal ${wide?'wide':''}" ${attributes} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${title}</h2><button class="button icon" data-action="close-modal" aria-label="Venster sluiten">${icon('close')}</button></div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}</section>`;}
function formButtons(label='Opslaan'){return `<div class="modal-form-actions">${btn('Annuleren','close-modal')}<button type="submit" class="button primary">${label}</button></div>`;}
function accountAccessFields(role,companyId){
 const roles=isChief()?['verkoper','bedrijfsbeheerder','hoofdbeheerder']:['verkoper','bedrijfsbeheerder'];
 const global=role==='hoofdbeheerder',companies=state.companies.filter(c=>isChief()||c.id===company().id);
 return `<div class="form-grid"><label class="field"><span>Rol</span><select name="role" data-account-role>${roles.map(r=>`<option value="${r}" ${r===role?'selected':''}>${r}</option>`).join('')}</select></label>
 <label class="field"><span>Bedrijf</span><select name="companyId" ${global?'':'required'}>${isChief()?`<option value="" ${global?'':'disabled'} ${global&&!companyId?'selected':''}>Geen bedrijf</option>`:''}${companies.map(c=>`<option value="${esc(c.id)}" ${c.id===companyId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>
 ${isChief()?'<p class="muted help-text">Een hoofdbeheerder heeft toegang tot alle bedrijven, ook zonder bedrijfskoppeling.</p>':''}`;
}
function updateAccountCompanyField(roleField){
 const select=roleField.form?.elements.namedItem('companyId');if(!select)return;
 const noCompany=[...select.options].find(option=>option.value===''),global=roleField.value==='hoofdbeheerder';
 select.required=!global;if(!noCompany)return;
 noCompany.disabled=!global;if(!global&&!select.value)select.value=company().id;
}
function modalHTML(){const m=ui.modal;switch(m.type){
case'delete-lead':return leadDeleteHTML(m);
case'select-party-contact':return modalShell(m.currentEqual?'Contact voor deze lead bevestigen?':'Contact voor deze lead vervangen?',(m.currentEqual?'<p>Wil je <strong>'+esc(m.party.name)+'</strong> als vaste contact voor deze lead selecteren?</p>':'<p>Vervang <strong>'+esc(m.current.name||m.current.contact||'het huidige contact')+'</strong> door <strong>'+esc(m.party.name)+'</strong>?</p>')+'<p>Deze keuze geldt voor '+esc(companyName(m.companyId))+'.</p><p class="muted">'+[m.party.role,m.party.contact,m.party.phone,m.party.email].filter(Boolean).map(esc).join(' · ')+'</p><p class="auth-error" data-selected-contact-error role="alert" '+(m.selectionError?'':'hidden')+'>'+esc(m.selectionError||'')+'</p>',btn('Annuleren','close-modal','secondary',m.selectionBusy?'disabled':'')+btn(m.selectionBusy?'Contact opslaan…':m.currentEqual?'Contact selecteren':'Contact vervangen','confirm-select-party-contact','primary','data-id="'+esc(m.id)+'" '+(m.selectionBusy?'disabled':'')),false,'data-selected-contact-confirm');
case'new-source':return sourceEditorHTML(null,m.sourceDraft||{});
case'delete-source':{const s=activeSources().find(s=>s.id===m.id);return s?modalShell('Bron verwijderen?','<p>Verwijder <strong>'+esc(s.name)+'</strong> uit het bronnenoverzicht?</p><p>Bestaande leads, notities en rapportages blijven bewaard onder de oorspronkelijke bronnaam. Je kunt geen nieuwe leads meer aan deze bron toevoegen.</p>',btn('Annuleren','close-modal')+btn('Verwijderen','confirm-delete-source','danger','data-id="'+esc(s.id)+'"')):modalShell('Bron niet gevonden','<p>Deze bron is al verwijderd.</p>',btn('Sluiten','close-modal'));}
case'delete-invite':{const invitation=state.invitations.find(i=>i.id===m.id);return invitation?modalShell('Uitnodigingslink verwijderen?','<p>Verwijder de uitnodiging voor <strong>'+esc(invitation.name)+'</strong> ('+esc(invitation.email)+') uit de lijst.</p><p>De link werkt daarna niet meer. Een bestaand gebruikersaccount en de bijbehorende geschiedenis blijven behouden.</p>',btn('Annuleren','close-modal')+btn('Verwijderen','confirm-delete-invite','danger','data-id="'+esc(invitation.id)+'"')):modalShell('Uitnodiging niet gevonden','<p>Deze uitnodiging is al verwijderd. Sluit dit venster om verder te gaan.</p>',btn('Sluiten','close-modal'));}
case'edit-company':{const c=state.companies.find(item=>item.id===m.id);return c?companyEditorHTML(c):modalShell('Bedrijf niet gevonden','<p>Sluit dit venster en vernieuw de pagina.</p>',btn('Sluiten','close-modal'));}
case'delete-company':{const c=state.companies.find(item=>item.id===m.id);if(!c)return modalShell('Bedrijf niet gevonden','<p>Dit bedrijf is al verwijderd.</p>',btn('Sluiten','close-modal'));const count=companyUsers(c.id).length,pending=state.invitations.filter(invitation=>invitation.companyId===c.id&&inviteStatus(invitation)==='Openstaand').length;return modalShell('Bedrijf verwijderen?',`<p>Wil je <strong>${esc(c.name)}</strong> uit het bedrijvenoverzicht verwijderen?</p><p>De werkplek en het logo verdwijnen uit het dashboard. Eerdere telefoontjes, notities en resultaten blijven bewaard voor de rapportages.</p>${pending?`<p><strong>${pending} openstaande uitnodigingslink${pending===1?' wordt':'s worden'} ingetrokken.</strong></p>`:''}${count?'<p class="auth-error" role="alert">Dit bedrijf heeft nog gebruikers. Koppel hen eerst aan een ander bedrijf.</p>':''}`,btn('Annuleren','close-modal')+(count?'':btn('Bedrijf verwijderen','confirm-delete-company','danger',`data-id="${esc(c.id)}"`)));}
case'demo-info':return modalShell('Je gedeelde werkplek','<p>Accounts, uitnodigingslinks, notities, Kanban, belregistraties en terugbelafspraken werken met gedeelde opslag op de server.</p><div class="info-box"><strong>Bronnen en gegevens</strong><p>Zelf toegevoegde leads en jullie opvolging worden gedeeld opgeslagen. Een importtoken staat klaar voor je connector; pas na een geslaagde aanlevering zijn leads geïmporteerd. Outlook is nog niet aangesloten.</p></div><p>Uitnodigingslinks geven echte toegang aan de bedoelde gebruiker. Deel ze zelf; het dashboard verstuurt geen e-mails. Meldingen verschijnen wanneer het dashboard geopend is.</p>',btn('Begrepen','close-modal','primary'));
case'account':return modalShell('Mijn account','<div class="account-summary"><span class="avatar">'+esc(currentUser().name.split(' ').map(s=>s[0]).slice(0,2).join(''))+'</span><div><strong>'+esc(currentUser().name)+'</strong><p>'+esc(currentUser().email)+'</p></div></div><dl class="project-facts"><dt>Bedrijf</dt><dd>'+esc(accountCompanyName(currentUser()))+'</dd><dt>Rol</dt><dd>'+esc(currentUser().role)+'</dd></dl><p class="muted">'+(isChief()?'Je hebt toegang tot alle bedrijven. Kies bovenaan welke werkplek je wilt openen.':'Je toegang hoort bij één bedrijf. De hoofdbeheerder kan je koppeling aanpassen.')+'</p><p class="auth-error" data-logout-error role="alert" '+(m.logoutError?'':'hidden')+'>'+esc(m.logoutError||'')+'</p>',btn('Sluiten','close-modal')+btn('Uitloggen','logout','primary'));
case'invite-link':return modalShell('Je uitnodigingslink is klaar','<p>Deel deze persoonlijke link met <strong>'+esc(m.invitation?.name||m.invitation?.email||'de ontvanger')+'</strong>. De link werkt één keer en vervalt na zeven dagen.</p><label class="field"><span>Persoonlijke uitnodigingslink</span><input id="invite-link" type="text" readonly value="'+esc(m.inviteUrl)+'" autocomplete="off"></label><p class="muted help-text">De volledige link wordt alleen nu getoond. Later kun je een nieuwe link maken; de vorige werkt dan niet meer.</p><div class="info-box"><strong>Geen e-mail verzonden</strong><p>Kopieer de link en stuur hem zelf naar het ingevulde e-mailadres.</p></div>',btn(icon('link')+' Link kopiëren','copy-invite','primary')+btn('Gereed','close-modal'));

case'new-lead':if(!leadSources().length)return modalShell('Voeg eerst een bron toe','<p>Voeg een bron toe voordat je een nieuwe lead maakt. De hoofdbeheerder beheert de bronnen.</p>',isChief()?btn('Bron toevoegen','new-source','primary'):btn('Sluiten','close-modal'));return modalShell('Een nieuwe kans toevoegen',`<form id="lead-form"><div class="form-grid"><label class="field full"><span>Projectnaam</span><input name="title" required maxlength="150" placeholder="Bijv. Renovatie Stationskwartier"></label><label class="field"><span>Organisatie</span><input name="organization" required maxlength="120"></label><label class="field"><span>Plaats</span><input name="city" required maxlength="100"></label><label class="field"><span>Broncategorie</span><select name="source">${leadSources().map(source=>source.id).map(s=>`<option value="${s}">${esc(sourceName(s))}</option>`).join('')}</select></label><label class="field"><span>Contactpersoon</span><input name="contact" required maxlength="100"></label><label class="field"><span>Telefoon</span><input name="phone" type="tel" required maxlength="30" pattern="[+0-9 ()-]{6,30}"></label><label class="field"><span>E-mailadres</span><input name="email" type="email" required maxlength="160"></label><label class="field full"><span>Projectomschrijving</span><textarea name="description" required maxlength="3000" rows="3"></textarea></label></div><p class="muted">De lead wordt centraal zichtbaar voor alle bedrijven. Opvolging blijft per bedrijf.</p>${formButtons('Lead toevoegen')}</form>`, '',true);
case'callback':{
 if(!state.leads.length)return modalShell('Nog geen leads','<p>Voeg eerst een lead toe om een terugbelafspraak te plannen.</p>',btn('Lead toevoegen','new-lead','primary'));
 const id=m.id||ui.drawer||state.leads[0].id;
 const lead=state.leads.find(l=>l.id===id),callback=lead&&m.callbackId?work(lead).callbacks.find(c=>c.id===m.callbackId&&!c.done):null;
 if(m.callbackId&&!callback)return modalShell('Afspraak niet beschikbaar','<p>Deze open terugbelafspraak bestaat niet meer.</p>',btn('Sluiten','close-modal'));
 const local=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',dateStyle:'short',timeStyle:'short'}).format(value).replace(' ','T');
 const when=callback?local(new Date(callback.dueAt)):local(new Date(Date.now()+86400000)).slice(0,10)+'T09:00';
 const members=activeUsers(),assignee=callback?.assigneeId??currentUser().id;
 return modalShell(callback?'Terugbelafspraak wijzigen':'Terugbellen plannen',`<form id="callback-form">
  ${callback?`<input type="hidden" name="leadId" value="${esc(id)}"><input type="hidden" name="callbackId" value="${esc(callback.id)}"><p>${esc(lead.title)}</p>`:`<label class="field"><span>Lead</span><select name="leadId">${state.leads.map(l=>`<option value="${esc(l.id)}" ${l.id===id?'selected':''}>${esc(l.title)}</option>`).join('')}</select></label>`}
  <div class="form-grid"><label class="field"><span>Datum en tijd (Amsterdam)</span><input type="datetime-local" name="dueAt" required value="${when}"></label><label class="field"><span>Voor wie?</span><select name="assigneeId" required>${members.some(u=>u.id===assignee)?'':'<option value="">Kies een verkoper</option>'}${members.map(u=>`<option value="${esc(u.id)}" ${u.id===assignee?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label></div>
  <label class="field"><span>Waarover?</span><input name="description" maxlength="160" value="${esc(callback?.description)}" placeholder="Bijv. bouwplanning navragen"></label>
  ${formButtons('Afspraak opslaan')}</form>`);
}
case'call-outcome':{
 const l=state.leads.find(record=>record.id===m.id);if(!l)return '';
 return modalShell(m.callId?'Beluitkomst vastleggen':'Gesprek registreren',`<form id="call-outcome-form"><input type="hidden" name="leadId" value="${esc(l.id)}">${m.callId?`<input type="hidden" name="callId" value="${esc(m.callId)}">`:''}
  <p>${esc(effectiveLeadContact(l,work(l)).name||l.title)}</p>
  <label class="field"><span>Uitkomst</span><select name="outcome" required><option value="">Kies een uitkomst</option>${Object.entries(callOutcomeNames).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label>
  <label class="field"><span>Gesproken met</span><input name="person" maxlength="100" placeholder="Naam contactpersoon (optioneel)"></label>
  <label class="field"><span>Korte toelichting</span><textarea name="detail" maxlength="1000" rows="3"></textarea></label>${formButtons('Gesprek opslaan')}</form>`);
}
case'lead-photo':{
 const l=state.leads.find(record=>record.id===m.id),photo=l&&leadImageURL(l);if(!photo)return '';
 return modalShell('Projectimpressie',`<img class="workbook-photo-large" src="${esc(photo)}" alt="Projectimpressie ${esc(l.title)}">`,'',true);
}
case'columns':return modalShell('Kolommen van jouw bedrijf',`<p>Hernoemen wijzigt de bestaande kaarten niet. Kolommen van andere bedrijven blijven behouden.</p><form id="columns-form">${company().columns.map(c=>`<label class="field"><span>Kolomnaam</span><input name="col-${c.id}" value="${esc(c.name)}" maxlength="35" required></label>`).join('')}<label class="field"><span>Nieuwe kolom (optioneel)</span><input name="newColumn" maxlength="35" placeholder="Bijv. Wachten op informatie"></label>${formButtons('Kolommen opslaan')}</form>`);
case'new-company':return modalShell('Bedrijf toevoegen',`<form id="company-form"><label class="field"><span>Bedrijfsnaam</span><input name="name" required maxlength="120" placeholder="Naam van het bedrijf"></label><p>Het bedrijf krijgt een eigen Kanban-bord en eigen opvolging voor alle centrale leads. De globale belwachttijd geldt automatisch.</p>${formButtons('Bedrijf toevoegen')}</form>`);
case'invite':return modalShell('Een gebruiker uitnodigen',`<p>De ontvanger activeert het account via een persoonlijke link.</p><form id="invite-form">
<label class="field"><span>Volledige naam</span><input name="name" required maxlength="100" autocomplete="name"></label>
<label class="field"><span>E-mailadres</span><input name="email" type="email" required maxlength="160" autocomplete="email"></label>
${accountAccessFields('verkoper',company().id)}
<p class="muted help-text">De link is zeven dagen geldig. Je deelt de link zelf.</p>${formButtons('Uitnodigingslink maken')}</form>`);

case'edit-user':{
 const u=state.users.find(u=>u.id===m.id);if(!u)return '';
 return modalShell('Gebruiker aanpassen',`<p><strong>${esc(u.name)}</strong><br>${esc(u.email)}</p><form id="user-form">
<input type="hidden" name="userId" value="${esc(u.id)}">${accountAccessFields(u.role,u.companyId)}
<div class="info-box"><strong>Historie blijft bewaard</strong><p>Bij overplaatsing blijven notities, afspraken en resultaten bij het oorspronkelijke bedrijf.</p></div>${formButtons('Wijzigingen opslaan')}</form>`);
}
case'source-scraper':{const s=leadSources().find(s=>s.id===m.id&&sourceProvider(s)==='bouwberichten');return s&&isChief()?sourceScraperHTML(s,m):modalShell('Automatisch ophalen niet beschikbaar','<p>Deze bron is verwijderd of je hebt geen toegang tot deze instellingen.</p>',btn('Sluiten','close-modal'));}
case'source-scraper-disconnect':{const s=leadSources().find(s=>s.id===m.id);return s&&isChief()?modalShell('Bronlogin verwijderen?','<p>Verwijder de opgeslagen bronlogin van <strong>'+esc(s.name)+'</strong>?</p><p>De dagelijkse planning stopt en ophaalopdrachten worden geannuleerd. Het opgeslagen wachtwoord wordt verwijderd. Bestaande leads, notities en afspraken blijven behouden.</p>','<div class="source-import-footer">'+btn('Annuleren','source-scraper','secondary','data-id="'+esc(s.id)+'"')+btn('Bronlogin verwijderen','confirm-disconnect-source-scraper','danger','data-id="'+esc(s.id)+'"')+'</div>'):modalShell('Bron niet gevonden','<p>Sluit dit venster om verder te gaan.</p>',btn('Sluiten','close-modal'));}
case'source-import':{const s=leadSources().find(s=>s.id===m.id);return s&&isChief()?sourceImportHTML(s,m):modalShell('Import niet beschikbaar','<p>Deze bron is verwijderd of je hebt geen toegang tot de importinstellingen.</p>',btn('Sluiten','close-modal'));}
case'source-import-revoke':{const s=leadSources().find(s=>s.id===m.id);return s&&isChief()?modalShell('Importtoken intrekken?','<p>Trek het importtoken van <strong>'+esc(s.name)+'</strong> in?</p><p>De connector kan daarna geen leads meer aanleveren met dit token. Bestaande leads, notities en afspraken blijven behouden. Om later weer te importeren moet je een nieuw token maken.</p>','<div class="source-import-footer">'+btn('Annuleren','source-import','secondary','data-id="'+esc(s.id)+'"')+btn('Token intrekken','confirm-revoke-source-import','danger','data-id="'+esc(s.id)+'"')+'</div>'):modalShell('Bron niet gevonden','<p>Sluit dit venster om verder te gaan.</p>',btn('Sluiten','close-modal'));}
case'source-config':{const s=activeSources().find(s=>s.id===m.id);if(!s)return modalShell('Bron niet gevonden','<p>Deze bron is verwijderd. Sluit dit venster en vernieuw het overzicht.</p>',btn('Sluiten','close-modal'));if(s.id==='outlook')return modalShell('Outlook: het koppelplan','<p>De toekomstige Outlook-connector matcht e-mails met leads via het e-mailadres van het contact, de organisatie en een projectkenmerk.</p><ol><li>De gebruiker geeft zelf toestemming via Microsoft OAuth.</li><li>De connector zoekt binnen de toegestane mailbox en bewaart geheimen op de server.</li><li>Voorgestelde matches worden zichtbaar ter controle; twijfelgevallen vragen een handmatige keuze.</li><li>E-mails en matches blijven bij het eigen bedrijf.</li></ol><span class="badge amber">Nog niet aangesloten · geen toegang tot je mailbox</span>',btn('Begrepen','close-modal','primary'));return sourceEditorHTML(s);}

default:return '';}}
function closeModal(){if(loggingOut||ui.modal?.type==='select-party-contact'&&ui.modal.selectionBusy||ui.modal?.type==='delete-lead'&&ui.modal.busy)return;const scraper=ui.modal?.type==='source-scraper'||ui.modal?.type==='source-scraper-disconnect';ui.modal=null;if(scraper&&state)render();else renderOverlay();if(lastFocus?.isConnected)lastFocus.focus();else if(ui.drawer)$('#detail-title')?.focus({preventScroll:true});}
function openModal(type,id=null,extra={}){captureLeadDraft();lastFocus=document.activeElement;const draft=type==='edit-company'?{logoDraft:companyLogoSource(state.companies.find(c=>c.id===id)),logoDirty:false,logoBusy:false,logoError:''}:{};ui.modal={type,id,...draft,...extra};renderOverlay();}
function renderToasts(){if(!$('#toast-root')||!state)return;const due=callbacks().filter(c=>new Date(c.dueAt)<=Date.now()&&!ui.dismissed.includes(currentUser().id+':'+c.id)).slice(0,2);$('#toast-root').innerHTML=[...transient.map(t=>`<div class="toast ${t.tone}"><span class="toast-icon">${icon(t.tone==='amber'?'clock':'check')}</span><div><strong>${t.tone==='amber'?'Let op':'Opgeslagen'}</strong><p>${esc(t.text)}</p></div><button class="toast-close" data-action="dismiss-toast" data-id="${t.id}" aria-label="Melding sluiten">${icon('close')}</button></div>`),...due.map(c=>`<div class="toast callback-toast"><span class="toast-icon">${icon('bell')}</span><div><strong>Terugbelmoment voor ${esc(userName(c.assigneeId).split(' ')[0])}</strong><button class="text-link" data-action="open-lead" data-id="${c.lead.id}">${esc(c.lead.title)}</button><p>${fmt(c.dueAt)} · Gemaakt door ${esc(c.creatorName)}</p></div><button class="toast-close" data-action="dismiss-callback" data-id="${c.id}" aria-label="Terugbelmelding sluiten">${icon('close')}</button></div>`)].join('');}

document.addEventListener('click',async e=>{
 const target=e.target.closest('[data-action],[data-route]');if(!target||target.disabled||loggingOut)return;
 const a=target.dataset.action,id=target.dataset.id;if(target.matches('.kanban-card')&&Date.now()<suppressCardClickUntil){e.preventDefault();return;}
 if((leadDraft?.saving||leadDraft?.contactSelectionSaving)&&(target.closest('.workbook-drawer')||a==='open-lead'||a==='close-drawer'||target.dataset.route)){e.preventDefault();return;}
 if(target.dataset.route){e.preventDefault();if(!state)return;if(['leads','calls','kanban'].includes(target.dataset.route))resetFilters();navTo(target.dataset.route);return;}
 e.preventDefault();
 try{
  if(a==='show-login'){activationToken=null;activation=null;activationInvalid=false;authError='';await initialize();return;}
  if(a==='toggle-password'){const input=document.getElementById(target.getAttribute('aria-controls'));if(!input||!target.closest('.password-field')?.contains(input))return;const visible=input.type==='password';input.type=visible?'text':'password';target.textContent=visible?'Verbergen':'Tonen';target.setAttribute('aria-pressed',String(visible));target.setAttribute('aria-label',document.querySelector(`label[for="${input.id}"]`).textContent+(visible?' verbergen':' tonen'));return;}
  if(!state)return;
  switch(a){
   case'ck-company':if(isControlekamer()&&(target.dataset.companyId==='all'||state.companies.some(c=>c.id===target.dataset.companyId))){controlekamerState.companyId=target.dataset.companyId;controlekamerState.showAll=false;renderControlekamerContent(target);}break;
   case'ck-type':if(isControlekamer()&&['all','note','status'].includes(target.dataset.type)){controlekamerState.type=target.dataset.type;controlekamerState.showAll=false;renderControlekamerContent(target);}break;
   case'ck-more':if(isControlekamer()){controlekamerState.showAll=!controlekamerState.showAll;renderControlekamerContent(target);}break;
   case'ck-refresh':await refreshControlekamer({manual:true});break;
   case'ck-action':await controlekamerAction(target);break;
   case'report-view':if(!isChief())throw Error('Deze rapportage is alleen beschikbaar voor de hoofdbeheerder.');if(['calls','conversion'].includes(target.dataset.value)){ui.reportView=target.dataset.value;render();}break;
   case'export-call-report':exportCallReport();break;
   case'admin-open-call-report':openAdminCallReport(target.dataset.companyId||'all',target.dataset.userId||'all');break;
   case'reset-call-report':{const dates=defaultCallReportDates();Object.assign(ui,{callReportCompany:'all',callReportSeller:'all',callReportGroupBy:'day',callReportFrom:dates.from,callReportTo:dates.to});render();break;}
   case'admin-refresh':target.disabled=true;await refreshState(ui.companyId,{force:true,preserveEditing:true});break;
   case'admin-open-company':await openAdminCompany(target.dataset.companyId,target.dataset.value);break;
   case'admin-open-lead':await openAdminLead(target.dataset.companyId,id,target);break;
   case'admin-return-overview':returnAdminOverview();break;
   case'deleted-leads-reset':if(isChief()){ui.deletedLeadQuery='';render();$('#deleted-lead-search')?.focus();}break;
   case'admin-reset-filters':Object.assign(ui,{adminCompany:'all',adminPeriod:'7d',adminType:'notes-status',adminActivityLimit:30,adminAttentionLimit:6});render();break;
   case'admin-more-activity':ui.adminActivityLimit=Math.min(500,ui.adminActivityLimit+30);render();break;
   case'admin-more-attention':ui.adminAttentionLimit=Math.min(500,ui.adminAttentionLimit+6);render();break;
   case'menu':ui.mobile=!ui.mobile;$('.sidebar')?.classList.toggle('open',ui.mobile);break;
   case'open-lead':openLeadDrawer(id,target);break;
   case'close-drawer':closeLeadDrawer();break;
   case'delete-lead':{if(!isChief()||ui.drawer!==id||!state.leads.some(lead=>lead.id===id))throw Error('Alleen de hoofdbeheerder kan deze lead voor alle bedrijven verwijderen.');openModal('delete-lead',id,{companyId:ui.companyId,reason:'',error:'',busy:false});break;}
   case'confirm-delete-lead':if(ui.modal?.type==='delete-lead'&&ui.modal.id===id)await deleteLeadCompletely(ui.modal);break;
   case'select-party-contact':await selectPartyContact(id,Number(target.dataset.partyIndex),target.dataset.partyFingerprint,target.dataset.expectedContact);break;
   case'confirm-select-party-contact':if(ui.modal?.type==='select-party-contact'&&ui.modal.id===id)await saveSelectedPartyContact(ui.modal,true);break;
   case'save-close-lead':await saveLeadDraft({close:true});break;
   case'close-modal':closeModal();break;
   case'demo-info':case'account':case'columns':case'new-company':case'invite':case'new-source':case'source-config':case'edit-user':
    if(['new-company','new-source','source-config','edit-user'].includes(a)&&!isChief())throw Error('Deze actie is voor de hoofdbeheerder.');
    if(['columns','invite'].includes(a)&&!canManage())throw Error('Je hebt geen beheerrol.');openModal(a,id);break;
   case'refresh-source-logbook':await refreshSourceLogbook();break;
   case'more-source-logbook':await refreshSourceLogbook({append:true});break;
   case'retry-source-import':await retrySourceImport(id,target.dataset.jobId);break;
   case'source-scraper':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan automatisch ophalen instellen.');if(!leadSources().some(s=>s.id===id&&sourceProvider(s)==='bouwberichten'))throw Error('Automatisch ophalen is alleen beschikbaar voor Bouwberichten-bronnen.');openModal('source-scraper',id);break;}
   case'test-source-scraper':await scraperAction('source.scraper.test',id);toast('Proef met 5 projecten ingepland.');break;
   case'save-source-scraper-time':{const source=leadSources().find(source=>source.id===id);await saveScraperSchedule(id,!!source?.scraper?.scheduleEnabled,{timeOnly:true});break;}
   case'run-source-scraper':{
    const source=leadSources().find(s=>s.id===id&&sourceProvider(s)==='bouwberichten');
    if(!isChief()||!source)throw Error('Deze bron kan niet handmatig worden opgehaald.');
    if(ui.modal?.type==='source-scraper'&&ui.modal.id===id&&ui.modal.scraperBusy)return;
    const reason=manualScrapeBlock(source);if(reason)throw Error(reason);
    if(ui.modal?.type!=='source-scraper'||ui.modal.id!==id)openModal('source-scraper',id);
    await scraperAction('source.scraper.run',id);
    toast('De volledige filterselectie staat klaar om opgehaald te worden.');break;
   }
   case'disconnect-source-scraper':{if(!isChief()||!leadSources().find(s=>s.id===id)?.scraper?.configured)throw Error('Er is geen opgeslagen bronlogin om te verwijderen.');openModal('source-scraper-disconnect',id);break;}
   case'confirm-disconnect-source-scraper':{if(!isChief()||ui.modal?.type!=='source-scraper-disconnect'||ui.modal.id!==id)return;target.disabled=true;await mutate('source.scraper.disconnect',{id});ui.modal={type:'source-scraper',id};render();toast('Bronlogin verwijderd. Automatisch ophalen is gestopt.');break;}
   case'source-import':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan imports instellen.');if(!leadSources().some(s=>s.id===id))throw Error('Deze bron kan geen leads importeren.');openModal('source-import',id);break;}
   case'rotate-source-import':{if(!isChief()||ui.modal?.type!=='source-import'||ui.modal.id!==id)return;target.disabled=true;target.setAttribute('aria-busy','true');const response=await mutate('source.import.rotate',{id}),details=response.result||{};if(!details.importToken)throw Error('Het token is gemaakt, maar kon niet worden getoond. Maak een nieuw token.');ui.modal={type:'source-import',id,importToken:details.importToken,importUrl:details.importUrl};render();toast('Importtoken gemaakt. Kopieer en bewaar het nu bij je connector.');break;}
   case'toggle-source-import':{if(!isChief()||ui.modal?.type!=='source-import'||ui.modal.id!==id)return;const source=leadSources().find(s=>s.id===id);if(!source?.importConfigured)throw Error('Maak eerst een importtoken.');target.disabled=true;const enabled=!source.importEnabled;await mutate('source.import.toggle',{id,enabled});render();toast(enabled?'Import hervat. Je connector kan weer leads aanleveren.':'Import gepauzeerd. Bestaande leads blijven behouden.');break;}
   case'revoke-source-import':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan importtokens intrekken.');if(!leadSources().find(s=>s.id===id)?.importConfigured)throw Error('Er is geen importtoken om in te trekken.');openModal('source-import-revoke',id);break;}
   case'confirm-revoke-source-import':{if(!isChief()||ui.modal?.type!=='source-import-revoke'||ui.modal.id!==id)return;target.disabled=true;await mutate('source.import.revoke',{id});ui.modal={type:'source-import',id};render();toast('Importtoken ingetrokken. De connector kan niet meer importeren.');break;}
   case'copy-import-url':case'copy-import-token':{if(!isChief()||ui.modal?.type!=='source-import')return;const field=$(a==='copy-import-token'?'#source-import-token':'#source-import-url');if(!field?.value)return;field.focus();field.select();try{await navigator.clipboard.writeText(field.value);toast(a==='copy-import-token'?'Importtoken gekopieerd. Bewaar het veilig bij je connector.':'Importadres gekopieerd.');}catch{toast('Het veld is geselecteerd. Kopieer de tekst met Ctrl+C.','amber');}break;}
   case'new-source-filter':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan bronnen toevoegen.');const source=leadSources().find(s=>s.id===id&&sourceProvider(s)==='bouwberichten');if(!source)throw Error('Deze Bouwbron is niet beschikbaar.');openModal('new-source',null,{sourceDraft:{provider:'bouwberichten',name:'',filterUrl:source.filterUrl||'',url:source.url||'https://portal.bouwberichten.nl/projecten'}});break;}
   case'delete-source':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan bronnen verwijderen.');if(!activeSources().some(s=>s.id===id))throw Error('Deze bron is al verwijderd.');openModal('delete-source',id);break;}
   case'confirm-delete-source':{if(!isChief()||ui.modal?.type!=='delete-source'||ui.modal.id!==id)return;target.disabled=true;await mutate('source.delete',{id});if(!state.leads.some(l=>leadMatchesSource(l,id))){if(ui.source===id)ui.source='all';if(ui.reportSource===id)ui.reportSource='all';}ui.modal=null;render();toast('Bron verwijderd. Bestaande leads en opvolging blijven behouden.');break;}
   case'edit-company':{const c=state.companies.find(item=>item.id===id);if(!c||!canManage()||!isChief()&&c.id!==currentUser().companyId)throw Error('Je kunt dit bedrijf niet bewerken.');openModal(a,id);break;}
   case'delete-company':{if(!isChief())throw Error('Alleen de hoofdbeheerder kan bedrijven verwijderen.');if(!state.companies.some(c=>c.id===id))throw Error('Dit bedrijf is al verwijderd.');if(companyUsers(id).length)throw Error('Koppel eerst alle gebruikers aan een ander bedrijf.');openModal(a,id);break;}
   case'confirm-delete-company':{if(!isChief()||ui.modal?.type!=='delete-company'||ui.modal.id!==id)return;const wasActive=ui.companyId===id;target.disabled=true;target.setAttribute('aria-busy','true');await mutate('company.delete',{companyId:id,confirmed:true});ui.modal=null;ui.drawer=null;leadDraft=null;leadReturn=null;if(wasActive)resetFilters();if(ui.adminCompany===id)ui.adminCompany='all';ui.adminReturn=null;render();toast('Bedrijf verwijderd. Eerdere activiteit en rapportages blijven bewaard.');break;}
   case'remove-company-logo':if(ui.modal?.type==='edit-company'){ui.modal.logoDraft=null;ui.modal.logoDirty=true;ui.modal.logoError='';const fileInput=$('[data-company-logo]');if(fileInput)fileInput.value='';updateCompanyLogoPreview();}break;case'new-lead':openModal(a,null,{status:target.dataset.status});break;
   case'callback':openModal('callback',id);break;
   case'edit-callback':openModal('callback',target.dataset.leadId,{callbackId:id});break;
   case'lead-photo':openModal('lead-photo',id);break;
   case'call-outcome':openModal('call-outcome',id,{callId:target.dataset.callId});break;
   case'copy-lead-phone':{
    const lead=state.leads.find(l=>l.id===id),chosen=lead?effectiveLeadContact(lead,work(lead)):null;if(!chosen||!leadPhone(chosen)||!eligible(lead).allowed)return;
    await navigator.clipboard.writeText(chosen.phone);toast('Telefoonnummer gekopieerd.');break;
   }
   case'switch-company':await switchCompany(id);break;
   case'reset-filters':resetFilters();render();break;
   case'sort-project-date':{
    const direction=target.dataset.value;
    if(!Object.hasOwn(projectDateColumns,id)||!['asc','desc'].includes(direction))return;
    const previous=ui.projectDateSort;
    ui.projectDateSort=previous?.field===id&&previous.direction===direction?null:{field:id,direction};
    render();document.getElementById('sort-'+id+'-'+direction)?.focus();break;
   }
   case'dash-filter':resetFilters();if(target.dataset.value==='available')ui.availability='available';if(target.dataset.value==='me')ui.owner='me';render();break;
   case'feed-filter':ui.feedFilter=target.dataset.value;render();break;
   case'go-settings':navTo('settings');break;
   case'complete-callback':await mutate('callback.complete',{leadId:target.dataset.leadId,callbackId:id});render();toast('Terugbelafspraak afgehandeld.');break;
   case'register-call':case'call-link':{
    const lead=state.leads.find(l=>l.id===id),phone=target.getAttribute('href'),numbers=lead?[lead,effectiveLeadContact(lead,work(lead)),{phone:contactPhoneNumber(work(lead))},...(Array.isArray(lead.projectDetails?.parties)?lead.projectDetails.parties:[])].map(leadPhone).filter(Boolean):[];
    if(!numbers.length||a==='call-link'&&!numbers.some(number=>phone==='tel:'+number))throw Error('Er is geen geldig telefoonnummer beschikbaar voor deze lead.');
    if(target.getAttribute('aria-busy')==='true')return;target.setAttribute('aria-busy','true');await mutate('call.record',{leadId:id});render();toast('Belmoment geregistreerd.');if(a==='call-link')location.href=phone;break;
   }
   case'dismiss-toast':transient=transient.filter(t=>t.id!==id);renderToasts();break;
   case'dismiss-callback':ui.dismissed.push(currentUser().id+':'+id);save();renderToasts();break;
   case'rotate-invite':{target.disabled=true;const response=await mutate('invitation.rotate',{invitationId:id});render();showInviteLink(response);break;}
   case'delete-invite':{const invitation=state.invitations.find(i=>i.id===id);if(!invitation||!canManageInvitation(invitation))throw Error('Je kunt deze uitnodiging niet verwijderen.');openModal('delete-invite',id);break;}
   case'confirm-delete-invite':{if(ui.modal?.type!=='delete-invite'||ui.modal.id!==id)return;target.disabled=true;await mutate('invitation.delete',{invitationId:id});ui.modal=null;render();toast('Uitnodiging verwijderd. Bestaande gebruikersaccounts blijven behouden.');break;}
   case'revoke-invite':target.disabled=true;await mutate('invitation.revoke',{invitationId:id});render();toast('Uitnodiging ingetrokken. De link werkt niet meer.');break;
   case'copy-invite':{
    const field=$('#invite-link');field?.focus();field?.select();
    try{await navigator.clipboard.writeText(ui.modal.inviteUrl);toast('Uitnodigingslink gekopieerd. Deel hem met de ontvanger.');}catch{toast('Selecteer de link en kopieer hem met Ctrl+C.','amber');}break;
   }
   case'logout':await logout();break;
   case'export':exportLeads();break;
   case'export-report':exportReport();break;
   case'reset-report':Object.assign(ui,{reportCompany:'current',reportSeller:'all',reportSource:'all',reportFrom:'',reportTo:''});render();break;
  }
 }catch(error){if(loggingOut)return;if(target.isConnected){target.disabled=false;target.removeAttribute('aria-busy');}if(state)toast(error.message||'De actie is niet gelukt.','amber');else{authError=error.message;renderAuth();}}
});
document.addEventListener('change',async e=>{
 if(loggingOut)return;const el=e.target;const activationForm=el.closest('#activation-form');if(activationForm){updateActivationPasswordFeedback(activationForm,{editedField:el.name});return;}if(!state)return;
 if(el.hasAttribute('data-admin-filter')){if(!isChief())return;const key=el.dataset.adminFilter,field={company:'adminCompany',period:'adminPeriod',type:'adminType'}[key];if(field){ui[field]=el.value;ui.adminActivityLimit=30;render();$('[data-admin-filter="'+key+'"]')?.focus();}return;}
 if(el.hasAttribute('data-admin-calls-period')){if(!isChief())return;if(['today','week'].includes(el.value)){ui.adminCallsPeriod=el.value;render();$('[data-admin-calls-period]')?.focus();}return;}
 if(el.hasAttribute('data-call-report-filter')){if(!isChief())return;const key=el.dataset.callReportFilter,field={company:'callReportCompany',seller:'callReportSeller',groupBy:'callReportGroupBy',from:'callReportFrom',to:'callReportTo'}[key];if(field){ui[field]=el.value;if(key==='company')ui.callReportSeller='all';render();$('[data-call-report-filter="'+key+'"]')?.focus();}return;}
 if(el.dataset.field==='query')return;
 if(el.hasAttribute('data-logbook-filter')){if(!isChief())return;const key=el.dataset.logbookFilter;if(['status','source'].includes(key)){sourceLogbook[key]=el.value;sourceLogbook.entries=[];sourceLogbook.total=0;sourceLogbook.hasMore=false;await refreshSourceLogbook();}return;}
 if(el.hasAttribute('data-account-role')){updateAccountCompanyField(el);return;}
 if(el.hasAttribute('data-scraper-schedule')){await saveScraperSchedule(el.dataset.scraperSchedule,el.checked);return;}
 if(el.hasAttribute('data-scraper-time')){editScraperScheduleTime(el);return;}
 if(el.hasAttribute('data-source-provider')){const form=el.closest('form'),bouw=el.value==='bouwberichten',fields=form.querySelector('[data-bouw-filter-fields]'),filter=form.querySelector('[name="filterUrl"]'),name=form.querySelector('[name="name"]'),url=form.querySelector('[name="url"]');fields.hidden=!bouw;filter.disabled=!bouw;name.placeholder=bouw?'Bouwberichten – Gegund vanaf 01-01-2026':'Bijv. Woningcorporaties';if(bouw&&!url.value.trim())url.value='https://portal.bouwberichten.nl/projecten';return;}
 if(el.hasAttribute('data-duration-unit')){changeCooldownUnit(el);return;}

 if(el.hasAttribute('data-company-logo')){
  const m=ui.modal,file=el.files?.[0];if(m?.type!=='edit-company'||!file)return;
  m.logoBusy=true;m.logoError='';updateCompanyLogoPreview();
  try{const logo=await prepareCompanyLogo(file);if(ui.modal===m){m.logoDraft=logo;m.logoDirty=true;}}
  catch(error){if(ui.modal===m)m.logoError=error.message||'Het logo kon niet worden voorbereid.';}
  finally{if(ui.modal===m){m.logoBusy=false;updateCompanyLogoPreview();}}
  return;
 }
 try{
  if(el.dataset.field){const f=el.dataset.field;if(f==='company'){if(isAdminOverview())await openAdminCompany(el.value,'kanban');else await switchCompany(el.value);return;}else if(f==='available-check')ui.availability=el.checked?'available':'all';else if(f!=='query')ui[f]=el.value;if(f==='reportCompany')ui.reportSeller='all';render();if(['constructionFrom','constructionTo','deliveryFrom','deliveryTo'].includes(f))document.getElementById(el.id)?.focus();}
  if(el.dataset.work){const field=el.dataset.work;if(el.closest('.workbook-drawer')&&ui.drawer===el.dataset.id){if(el.isConnected&&!leadDraft?.saving){const draft=getLeadDraft();draftLeadField(draft,field,el.type==='checkbox'?el.checked:field==='ownerId'?el.value||null:el.value);draft.error='';updateLeadSaveUI();}return;}el.disabled=true;await mutate('workspace.update',{leadId:el.dataset.id,field,value:el.type==='checkbox'?el.checked:el.value||null});render();$('[data-work="'+field+'"]')?.focus();}
 }catch(error){if(state){render();toast(error.message,'amber');}}
});
let searchTimer;
function updateLeadSearch(e){
 const input=e.target;if(!state||input.dataset.field!=='query')return;
 ui.query=input.value;clearTimeout(searchTimer);if(e.isComposing)return;
 searchTimer=setTimeout(()=>{if(input.isConnected&&input===$('#lead-search')&&!ui.modal&&!ui.drawer)renderLeadSearchResults();},180);
}
document.addEventListener('input',e=>{if(loggingOut)return;const activationForm=e.target.closest('#activation-form');if(activationForm)updateActivationPasswordFeedback(activationForm,{editedField:e.target.name});updateLeadSearch(e);updateDeletedLeadSearch(e);if(state&&ui.drawer&&e.target.isConnected&&leadContactFields.includes(e.target.dataset.work)&&e.target.closest('.workbook-drawer')?.dataset.drawerId===ui.drawer&&!leadDraft?.saving){const draft=getLeadDraft();draftLeadField(draft,e.target.dataset.work,e.target.value);draft.error='';updateLeadSaveUI();}if(e.target.hasAttribute('data-scraper-time'))editScraperScheduleTime(e.target);if(state&&ui.drawer&&e.target.isConnected&&e.target.matches('#note-form textarea[name="text"]')&&!leadDraft?.saving)draftLeadNote(getLeadDraft(),e.target.value);});
document.addEventListener('compositionend',updateLeadSearch);
document.addEventListener('compositionend',updateDeletedLeadSearch);
document.addEventListener('toggle',event=>{if(state&&isAdminOverview()&&event.target.isConnected&&event.target.matches?.('.admin-company-details'))ui.adminCompanyDetails=event.target.open;},true);
document.addEventListener('paste',e=>{
 const input=e.target,form=input.closest('#activation-form');if(!form||!['password','passwordConfirm'].includes(input.name)||!e.clipboardData||authBusy)return;
 const text=e.clipboardData.getData('text'),start=input.selectionStart??input.value.length,end=input.selectionEnd??start,value=input.value.slice(0,start)+text+input.value.slice(end);
 // Keep an oversized paste visible for correction instead of silently changing the chosen password.
 if(value.length>256){e.preventDefault();input.value=value;input.setSelectionRange(start+text.length,start+text.length);updateActivationPasswordFeedback(form,{editedField:input.name});}
});
document.addEventListener('invalid',e=>{const form=e.target.closest('#activation-form');if(form)updateActivationPasswordFeedback(form,{submitted:true});},true);
document.addEventListener('submit',async e=>{
 e.preventDefault();if(loggingOut)return;const form=e.target,data=Object.fromEntries(new FormData(form));
 if(form.getAttribute('id')==='login-form'||form.getAttribute('id')==='activation-form'){try{await authenticate(form,data);}catch(error){authError=error.message;renderAuth();}return;}
 if(!state)return;
 if(form.getAttribute('id')==='note-form'&&ui.drawer){await saveLeadDraft();return;}
 if(form.getAttribute('id')==='source-scraper-form'){try{await connectSourceScraper(form,data);}catch(error){if(state)toast(error.message||'Verbinden is niet gelukt.','amber');}return;}
 const submit=form.querySelector('[type="submit"]');if(submit?.disabled)return;if(submit)submit.disabled=true;
 const modalType=ui.modal?.type;
 try{
  let response;
  switch(form.getAttribute('id')){
   case'note-form':if(!data.text.trim())throw Error('Schrijf eerst een notitie.');response=await mutate('note.add',{leadId:data.leadId,text:data.text.trim()});break;
   case'lead-form':{
    const oldIds=new Set(state.leads.map(l=>l.id));response=await mutate('lead.create',{...data,status:ui.modal?.status});ui.drawer=response.result?.leadId||response.result?.lead?.id||state.leads.find(l=>!oldIds.has(l.id))?.id||null;break;
   }
   case'callback-form':response=await mutate(data.callbackId?'callback.update':'callback.add',{leadId:data.leadId,dueAt:amsterdamToISO(data.dueAt),assigneeId:data.assigneeId,description:data.description||'',...data.callbackId&&{callbackId:data.callbackId}});break;
   case'call-outcome-form':response=await mutate('call.record',{leadId:data.leadId,outcome:data.outcome,person:data.person,detail:data.detail,...data.callId&&{callId:data.callId}});break;
   case'columns-form':response=await mutate('columns.update',{columns:company().columns.map(c=>({id:c.id,name:data['col-'+c.id].trim()})),newColumn:data.newColumn.trim()});break;
   case'company-form':response=await mutate('company.create',{name:data.name.trim()});break;case'company-edit-form':{const m=ui.modal;if(m?.logoBusy)throw Error('Wacht tot het logo is voorbereid.');const payload={companyId:data.companyId,name:data.name.trim()};if(m?.logoDirty)payload.logoDataUrl=m.logoDraft;response=await mutate('company.update',payload);break;}
   case'invite-form':response=await mutate('invitation.create',data);break;
   case'user-form':response=await mutate('user.update',data);break;
   case'source-form':response=await mutate(data.id?'source.update':'source.create',{...(data.id?{id:data.id}:{}),name:data.name.trim(),provider:data.provider==='bouwberichten'?'bouwberichten':'generic',filterUrl:data.provider==='bouwberichten'?String(data.filterUrl||'').trim():'',url:data.url.trim(),username:data.username.trim()});break;
   case'cooldown-form':{const hours=Number(data.duration)*(data.unit==='days'?24:1),wholeHours=Math.round(hours);if(!['hours','days'].includes(data.unit)||data.duration.trim()===''||!Number.isFinite(hours)||hours<0||hours>8760||Math.abs(hours-wholeHours)>1e-8)throw Error('Kies een wachttijd van 0 tot 365 dagen, die overeenkomt met een heel aantal uren.');response=await mutate('settings.update',{cooldownHours:wholeHours,cooldownUnit:data.unit});break;}
   default:return;
  }
  ui.modal=null;render();
  if(modalType==='invite')showInviteLink(response);else toast(['source-config','new-source'].includes(modalType)?'Bron opgeslagen. De importinstellingen blijven per bron gescheiden.':form.getAttribute('id')==='note-form'?'Notitie opgeslagen en gedeeld met je bedrijf.':'Je wijziging is opgeslagen.');
 }catch(error){if(submit?.isConnected)submit.disabled=false;if(state)toast(error.message||'Opslaan is niet gelukt.','amber');}
});

// Interpret datetime-local explicitly in Amsterdam, independent of the browser timezone.
function amsterdamToISO(value){const [date,time]=value.split('T'),[y,m,d]=date.split('-').map(Number),[h,minute]=time.split(':').map(Number);const wall=Date.UTC(y,m-1,d,h,minute);let target=wall;for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(target));const actual=Date.parse(parts.replace(' ','T')+'Z');target+=wall-actual;}const result=new Date(target).toISOString();const verify=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(target)).replace(' ','T');if(verify!==value)throw Error('Dit tijdstip bestaat niet door de overgang naar zomertijd. Kies een ander tijdstip.');return result;}
let dragged=null,suppressCardClickUntil=0;document.addEventListener('dragstart',e=>{const card=e.target.closest('[data-lead]');if(card){suppressCardClickUntil=Infinity;dragged=card.dataset.lead;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';}});document.addEventListener('dragover',e=>{const col=e.target.closest('[data-column]');if(col&&dragged){e.preventDefault();col.dataset.dragOver='true';}});document.addEventListener('dragleave',e=>{const col=e.target.closest('[data-column]');if(col&&!col.contains(e.relatedTarget))delete col.dataset.dragOver;});document.addEventListener('drop',async e=>{const col=e.target.closest('[data-column]');if(!col||!dragged)return;e.preventDefault();const leadId=dragged;suppressCardClickUntil=Date.now()+250;dragged=null;try{await mutate('workspace.update',{leadId,field:'status',value:col.dataset.column});render();}catch(error){if(state){render();toast(error.message,'amber');}}});
document.addEventListener('dragend',()=>{suppressCardClickUntil=Date.now()+250;dragged=null;document.querySelectorAll('[data-drag-over]').forEach(e=>delete e.dataset.dragOver);});
document.addEventListener('keydown',e=>{const card=e.target.closest('.kanban-card[role=button]');if(card&&e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();card.click();return;}if(e.key==='Escape'){if(ui.modal)closeModal();else if(ui.drawer)closeLeadDrawer();}if(e.key==='Tab'&&(ui.modal||ui.drawer)){const root=$('.modal')||$('.detail-drawer'),items=[...root.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea')].filter(x=>x.offsetParent!==null),first=items[0],last=items.at(-1);if(!items.length){e.preventDefault();return;}if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
window.addEventListener('hashchange',()=>{if(loggingOut)return;const r=location.hash.slice(1);if(routes.some(x=>x[0]===r)&&r!==ui.route){adminNavigationVersion++;ui.route=r;ui.drawer=null;ui.modal=null;render();}});
window.addEventListener('pageshow',event=>{
 if(!event.persisted)return;
 loggingOut=false;authGeneration++;refreshVersion++;session=null;state=null;ui.modal=null;ui.drawer=null;leadDraft=null;leadReturn=null;transient=[];
 renderAuth();void initialize();
});

function csv(name,rows){const cell=v=>{let value=String(v??'');if(/^[=+\-@\t\r]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Je export is klaargezet als CSV-bestand.');}
function exportLeads(){csv(`bouwberichten-${ui.route==='calls'?'bellijst':'leads'}.csv`,[['Project','Organisatie','Plaats','Start bouw','Oplevering','Bron','Contact','Telefoon','E-mail','Status','Prioriteit','Verkoper','Toezegging','Klaar voor calculatie','Nu belbaar'],...filteredLeads().map(l=>{const w=work(l);return[l.title,l.organization,l.city,l.projectDetails?.scheduleStart||'',l.projectDetails?.scheduleEnd||'',leadSourceIds(l).map(sourceName).join(' · '),l.contact,l.phone,l.email,statusName(w.status),priorityNames[w.priority],userName(w.ownerId),w.commitment?'Ja':'Nee',w.calculation?'Ja':'Nee',eligible(l).allowed?'Ja':'Nee'];})]);}
function exportReport(){const cid=isChief()?(ui.reportCompany==='current'?company().id:ui.reportCompany):company().id;const rows=reportRows(state,{companyId:cid,sellerId:ui.reportSeller,source:ui.reportSource,from:ui.reportFrom,to:ui.reportTo});csv('bouwberichten-conversierapport.csv',[['Bedrijf','Verkoper','Bron','Toegewezen leads','Gebeld','Toezeggingen','Calculaties','Conversie (%)'],...rows.map(r=>[r.companyName,r.sellerName,reportSourceLabel(r),r.total,r.contacted,r.commitments,r.calculations,Math.round(r.conversion)])]);}
initialize();
setInterval(refreshScraperModal,10000);
setInterval(tickControlekamer,1000);
setInterval(async()=>{if(loggingOut||adminNavigationBusy||!session?.authenticated||pendingMutations||document.hidden||isControlekamer())return;try{const editing=!!(ui.modal||ui.drawer||document.activeElement?.matches('input,select,textarea'));await refreshState(ui.companyId,{renderPage:!editing,preserveEditing:true});if(ui.route==='logbook'&&isChief()&&!sourceLogbook.loading&&!sourceLogbook.busyJobId)await refreshSourceLogbook({quiet:true});}catch(error){if(state)toast(error.message,'amber');}},30000);
