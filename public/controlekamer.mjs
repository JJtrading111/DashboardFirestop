const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const list=value=>Array.isArray(value)?value:[];
const number=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const format=value=>new Intl.NumberFormat('nl-NL',{maximumFractionDigits:0}).format(number(value));
const percent=value=>Math.max(0,Math.min(100,Number(value)||0));
const color=value=>/^#[0-9a-f]{6}$/i.test(String(value))?String(value):'#245DE4';
const paths={phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 4 4l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z',note:'M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 16h5',status:'M4 8h13l-3-3 M20 16H7l3 3',arrow:'M5 12h14 M13 6l6 6-6 6',refresh:'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',check:'m5 12 4 4L19 6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2'};
const icon=(name,extra='')=>'<svg class="ck-icon '+extra+'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.note)+'"></path></svg>';
const numeric=(key,value,extra='')=>'<span class="ck-number '+extra+'" data-ck-number="'+escape(key)+'" data-value="'+number(value)+'">'+format(value)+'</span>';
const attributes=item=>['companyId','userId','leadId','columnId','sourceId'].filter(key=>item[key]!==undefined&&item[key]!==null&&item[key]!=='').map(key=>' data-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())+'="'+escape(item[key])+'"').join('');
const actionButton=(item,label,extra='')=>'<button type="button" class="ck-cta '+extra+'" data-action="ck-action" data-kind="'+escape(item.kind||'lead')+'"'+attributes(item)+'>'+escape(label||item.label||'Bekijken')+icon('arrow')+'</button>';
const empty=text=>'<div class="ck-empty">'+escape(text)+'</div>';
const timeLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(date):'—';};
const cardHeading=(title,detail='')=>'<div class="ck-card-heading"><h2>'+escape(title)+'</h2>'+(detail?'<span class="ck-muted">'+escape(detail)+'</span>':'')+'</div>';

function header(data,options){
 const seconds=Math.min(30,number(options.seconds??30));
 return '<header class="ck-heading ck-enter"><div><p class="ck-eyebrow">Hoofdbeheer'+(data.dateLabel?' · '+escape(data.dateLabel):'')+'</p><h1>Alles in één oogopslag</h1></div><div class="ck-live-controls"><span class="ck-updated" data-ck-updated role="status" '+(!options.updated?'hidden':'')+'>'+icon('check')+'Bijgewerkt</span><div class="ck-live" data-ck-live><span class="ck-dot ck-dot-ok" data-ck-live-dot aria-hidden="true"></span><span data-ck-live-label>Live</span><span class="ck-countdown-label" data-ck-countdown-label>ververst over <span data-ck-seconds>'+Math.ceil(seconds)+'</span>s</span><svg class="ck-countdown-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#E8EDF4" stroke-width="4"></circle><circle data-ck-countdown-ring cx="18" cy="18" r="15" fill="none" stroke="#15803D" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+(94.248*seconds/30)+' 94.248"></circle></svg></div><button type="button" class="ck-chip ck-refresh" data-action="ck-refresh" aria-label="Nu vernieuwen" '+(options.busy?'disabled aria-busy="true"':'')+'>'+icon('refresh')+'<span>Nu vernieuwen</span></button></div><p class="ck-refresh-error" data-ck-refresh-error role="status" '+(!options.error?'hidden':'')+'>'+escape(options.error||'')+'</p></header>';
}

function companyFilters(data){
 const selected=data.companyId||'all',companies=list(data.companies),total=companies.reduce((sum,company)=>sum+number(company.callsToday),0);
 return '<div class="ck-company-filters ck-enter" role="group" aria-label="Filter op bedrijf">'+[{id:'all',name:'Alle bedrijven',color:'#245DE4',callsToday:total},...companies].map(company=>'<button type="button" class="ck-chip '+(selected===company.id?'is-selected':'')+'" data-action="ck-company" data-company-id="'+escape(company.id)+'" aria-pressed="'+(selected===company.id)+'"><span class="ck-company-dot" style="--company-color:'+color(company.color)+'" aria-hidden="true"></span><span>'+escape(company.name)+'</span><span class="ck-chip-count" aria-label="'+number(company.callsToday)+' belmomenten vandaag">'+numeric('chip-'+company.id,company.callsToday)+' '+(number(company.callsToday)===1?'belmoment':'belmomenten')+'</span></button>').join('')+'</div>';
}

function healthAndActions(data){
 const health=list(data.health),actions=list(data.actions);
 return '<section class="ck-health-actions ck-grid" aria-label="Gezondheid en acties"><section class="ck-card ck-enter" data-ck-section="health">'+cardHeading('Gezondheid','Groen = op orde · Oranje = kijken')+'<div class="ck-health-grid">'+health.map(item=>{
  const hiddenSource=item.key==='sources'&&item.visible===false,status=hiddenSource?'neutral':['ok','warn','neutral'].includes(item.status)?item.status:'neutral';
  return '<div class="ck-health-tile ck-health-'+status+'" data-ck-health="'+escape(item.key)+'"><h3><span class="ck-dot ck-dot-'+status+'" aria-hidden="true"></span>'+escape(item.title)+'</h3><strong>'+escape(hiddenSource?'—':item.value)+'</strong><p>'+escape(hiddenSource?'Alleen zichtbaar bij Alle bedrijven.':item.text)+'</p></div>';
 }).join('')+'</div></section><section class="ck-card ck-enter" data-ck-section="actions">'+cardHeading('Nu doen',actions.length+' acties')+'<div class="ck-actions">'+(actions.map(item=>'<div class="ck-action" data-ck-action-id="'+escape(item.id)+'" style="--company-color:'+color(item.color)+'"><span class="ck-action-stripe" aria-hidden="true"></span><div><h3>'+escape(item.title)+'</h3><p>'+escape(item.text)+'</p></div>'+actionButton(item)+'</div>').join('')||empty('Geen aandachtspunten voor deze selectie.'))+'</div></section></section>';
}

function kpis(data){
 const values=data.kpis||{},active=number(values.activeCallers),total=number(values.teamSize),ratio=total?active/total:0;
 const tiles=[['calls','Telefoontjes vandaag',values.calls,'Geregistreerde belmomenten','phone','blue'],['notes','Gespreksnotities',values.notes,'Vandaag vastgelegd','note','purple'],['status','Statuswijzigingen',values.status,'Vandaag vastgelegd','status','teal']];
 return '<section class="ck-kpis ck-grid" data-ck-section="kpis" aria-label="Kerncijfers vandaag">'+tiles.map(([key,label,value,sub,shape,tone])=>'<article class="ck-card ck-kpi ck-enter" data-ck-kpi="'+key+'"><div class="ck-kpi-heading"><h2>'+label+'</h2><span class="ck-kpi-icon ck-tone-'+tone+'">'+icon(shape)+'</span></div>'+numeric('kpi-'+key,value,'ck-kpi-value')+'<p>'+sub+'</p></article>').join('')+'<article class="ck-card ck-kpi ck-kpi-callers ck-enter" data-ck-kpi="active"><div class="ck-caller-ring"><svg viewBox="0 0 64 64" role="img" aria-label="'+active+' van '+total+' actieve medewerkers hebben vandaag gebeld"><circle cx="32" cy="32" r="26" fill="none" stroke="#E8EDF4" stroke-width="8"></circle><circle class="ck-caller-ring-value" data-ck-ring="callers" data-ratio="'+Math.min(1,ratio)+'" cx="32" cy="32" r="26" fill="none" stroke="#245DE4" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+(163.363*Math.min(1,ratio))+' 163.363"></circle></svg></div><div><h2>Actieve bellers</h2><div class="ck-active-ratio">'+numeric('kpi-active',active)+'<span class="ck-muted">/ '+format(total)+'</span></div><p>medewerkers met belmoment</p></div></article></section>';
}

function companyTeamSignals(data){
 const companies=list(data.selectedCompanies),team=list(data.team),maxCompany=Math.max(1,...companies.map(item=>number(item.callsToday))),maxTeam=Math.max(1,...team.map(item=>number(item.callsToday)));
 return '<section class="ck-three-grid ck-grid" aria-label="Belactiviteit en gesprekssignalen"><section class="ck-card ck-enter" data-ck-section="companies">'+cardHeading('Per bedrijf','telefoontjes vandaag')+'<div class="ck-company-bars">'+(companies.map(item=>'<div class="ck-bar-row" data-ck-company="'+escape(item.id)+'"><div class="ck-row-label"><strong><span class="ck-company-dot" style="--company-color:'+color(item.color)+'" aria-hidden="true"></span>'+escape(item.name)+'</strong>'+numeric('company-'+item.id,item.callsToday)+'</div><div class="ck-bar-track"><div class="ck-bar" data-ck-bar="company-'+escape(item.id)+'" data-width="'+percent(number(item.callsToday)/maxCompany*100)+'" style="--company-color:'+color(item.color)+';width:'+percent(number(item.callsToday)/maxCompany*100)+'%"></div></div>'+(number(item.callsToday)===0?'<p class="ck-zero-label">Vandaag nog niet gebeld</p>':'')+actionButton({kind:'report',companyId:item.id},'Belrapport','ck-text-action')+'</div>').join('')||empty('Er zijn nog geen bedrijven.'))+'</div></section><section class="ck-card ck-enter" data-ck-section="team">'+cardHeading('Team vandaag',team.filter(item=>item.eligible!==false).length+' medewerkers')+'<div class="ck-team-list">'+(team.map(item=>'<div class="ck-team-member" data-ck-user="'+escape(item.id)+'"><span class="ck-avatar" style="--company-color:'+color(item.color)+'" aria-hidden="true">'+escape(item.initials||String(item.name||'').split(/\s+/).map(word=>word[0]).slice(0,2).join(''))+'</span><div class="ck-team-content"><div class="ck-row-label"><strong>'+escape(item.name)+'</strong>'+numeric('team-'+item.id+'-'+(item.companyId||''),item.callsToday)+'</div><p>'+escape(item.callsToday&&item.callCompanyNames?.length?item.callCompanyNames.join(', '):item.companyName)+(item.eligible===false?' · Buiten huidig team':'')+'</p>'+(number(item.callsToday)===0?'<span class="ck-zero-badge">Nog geen belmoment</span>':'<div class="ck-bar-track ck-small-track"><div class="ck-bar" data-ck-bar="team-'+escape(item.id)+'-'+escape(item.companyId||'')+'" data-width="'+percent(number(item.callsToday)/maxTeam*100)+'" style="--company-color:'+color(item.color)+';width:'+percent(number(item.callsToday)/maxTeam*100)+'%"></div></div>')+'</div>'+actionButton({kind:'report',companyId:data.companyId||'all',userId:item.id},'Rapport','ck-team-report')+'</div>').join('')||empty('Geen medewerkers in deze selectie.'))+'</div></section><section class="ck-card ck-enter" data-ck-section="signals">'+cardHeading('Signalen uit gesprekken','uit notities vandaag')+'<div class="ck-signals">'+list(data.signals).map((item,index)=>'<div class="ck-signal"><span class="ck-signal-count ck-tone-'+['blue','purple','teal'][index%3]+'">'+numeric('signal-'+item.key,item.count)+'</span><div><h3>'+escape(item.title)+'</h3><p>'+escape(item.text)+'</p></div></div>').join('')+'</div><p class="ck-footnote">Tekstsignalen zijn aanwijzingen uit notities, geen bevestigde uitkomsten.</p></section></section>';
}

function hourly(data){
 const hours=list(data.hours),max=Math.max(1,...hours.map(hour=>number(hour.count))),peak=hours.reduce((result,item)=>number(item.count)>number(result?.count)?item:result,null);
 return '<section class="ck-card ck-enter" data-ck-section="hours">'+cardHeading('Activiteit per uur','notities + statuswijzigingen')+'<div class="ck-hour-chart" role="img" aria-label="Activiteit vandaag van 08 tot 17 uur. '+hours.map(item=>String(item.hour).padStart(2,'0')+' uur: '+number(item.count)).join(', ')+'">'+hours.map(item=>{
  const height=item.future?8:number(item.count)?Math.max(5,number(item.count)/max*100):2;
  return '<div class="ck-hour '+(item.current?'is-current ':'')+(item.future?'is-future':'')+'" data-ck-hour="'+number(item.hour)+'" data-count="'+number(item.count)+'" data-current="'+!!item.current+'" data-future="'+!!item.future+'"><span class="ck-hour-value">'+(item.future?'—':format(item.count))+'</span><div class="ck-hour-space"><div class="ck-hour-bar" data-ck-height="hour-'+number(item.hour)+'" data-height="'+height+'" style="height:'+height+'%"></div></div><span class="ck-hour-label">'+String(item.hour).padStart(2,'0')+'u</span><span class="ck-hour-now">'+(item.current?'nu':'')+'</span></div>';
 }).join('')+'</div><p class="ck-footnote">'+(peak&&number(peak.count)?'Piek: '+String(peak.hour).padStart(2,'0')+' uur · '+format(peak.count)+' gebeurtenissen.':'Nog geen activiteit tussen 08 en 17 uur.')+'</p></section>';
}

function pipeline(data){
 const pipeline=data.pipeline||{},columns=list(pipeline.columns),max=Math.max(1,...columns.map(item=>number(item.count)));
 return '<section class="ck-card ck-enter" data-ck-section="pipeline">'+cardHeading('Pijplijn',pipeline.warning?'Meer dan 90% staat op Nieuw':'Kanban-statussen')+(pipeline.warning?'<p class="ck-pipeline-warning">'+icon('clock')+escape(typeof pipeline.warning==='string'?pipeline.warning:'Meer dan 90% van deze werkvoorraad staat op Nieuw.')+'</p>':'')+'<div class="ck-pipeline-grid">'+(columns.map(item=>'<div class="ck-pipeline-column"><h3>'+escape(item.name)+'</h3>'+numeric('pipeline-'+item.id,item.count)+'<div class="ck-bar-track ck-small-track"><div class="ck-bar" data-ck-bar="pipeline-'+escape(item.id)+'" data-width="'+percent(number(item.count)/max*100)+'" style="--company-color:'+color(item.color)+';width:'+percent(number(item.count)/max*100)+'%"></div></div></div>').join('')||empty('Er zijn nog geen Kanban-kolommen.'))+'</div><p class="ck-footnote">'+escape(pipeline.description||'De status volgt de eigen bedrijfswerkplek.')+'</p></section>';
}

function timeline(data,options){
 const selected=options.type||'all',timeline=data.timeline||{},counts=data.typeCounts||{},events=list(timeline.items||data.events),fresh=new Set(list(options.freshIds));
 return '<section class="ck-card ck-enter ck-timeline" data-ck-section="timeline">'+cardHeading('Wat gebeurt er?','vandaag')+'<div class="ck-type-filters" role="group" aria-label="Filter op soort gebeurtenis">'+[['all','Alles'],['note','Notities'],['status','Statuswijzigingen']].map(([key,label])=>'<button type="button" class="ck-chip ck-type-chip '+(selected===key?'is-selected':'')+'" data-action="ck-type" data-type="'+key+'" aria-pressed="'+(selected===key)+'">'+label+' <span>'+format(counts[key])+'</span></button>').join('')+'</div><div class="ck-feed" data-ck-feed>'+(events.map(item=>'<article class="ck-feed-item '+(fresh.has(item.id)?'ck-fresh':'')+'" data-ck-event-id="'+escape(item.id)+'" data-ck-event-type="'+escape(item.type)+'"><div class="ck-feed-time"><time datetime="'+escape(item.at)+'">'+timeLabel(item.at)+'</time><span class="ck-feed-icon ck-tone-'+(item.type==='status'?'teal':'purple')+'">'+icon(item.type==='status'?'status':'note')+'</span></div><div class="ck-feed-content"><div class="ck-feed-meta"><strong><span class="ck-company-dot" style="--company-color:'+color(item.color)+'" aria-hidden="true"></span>'+escape(item.companyName)+'</strong><span>'+escape(item.actorName||'Maker niet vastgelegd')+'</span></div>'+(item.leadTitle?'<h3>'+escape(item.leadTitle)+'</h3>':'')+'<p class="ck-event-title">'+escape(item.title||(item.type==='status'?'Statuswijziging':'Gespreksnotitie'))+'</p>'+((item.detail||item.text)?'<p class="ck-event-detail">'+escape(item.detail||item.text)+'</p>':'')+(item.leadId?actionButton({kind:'lead',companyId:item.companyId,leadId:item.leadId},'Bekijk lead','ck-text-action'):item.archivedLead?'<span class="ck-muted ck-archived">Lead verwijderd · historie bewaard</span>':'')+'</div></article>').join('')||empty('Nog geen activiteit vandaag voor deze selectie.'))+'</div>'+(timeline.hasMore||options.showAll?'<button type="button" class="ck-chip ck-more" data-action="ck-more">'+(options.showAll?'Toon minder':'Toon alle')+'</button>':'')+'</section>';
}

export function renderControlekamer(data,options={}){
 return '<div class="controlekamer" data-controlekamer>'+header(data,options)+companyFilters(data)+healthAndActions(data)+kpis(data)+companyTeamSignals(data)+'<section class="ck-bottom-grid ck-grid" aria-label="Activiteit, pijplijn en tijdlijn"><div class="ck-analysis-stack">'+hourly(data)+pipeline(data)+'</div>'+timeline(data,options)+'</section><p class="ck-footer-note">Automatisch vernieuwd iedere 30 seconden · tijden in Nederland · cijfers uitsluitend uit opgeslagen dashboardgegevens</p></div>';
}

export function updateControlekamerClock(root,{seconds=30,busy=false,updated=false,error=''}={}){
 if(!root?.isConnected)return;
 const set=(selector,value)=>{const node=root.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
 const remaining=Math.max(0,Math.min(30,Math.ceil(Number(seconds)||0))),ring=root.querySelector('[data-ck-countdown-ring]'),button=root.querySelector('[data-action="ck-refresh"]'),badge=root.querySelector('[data-ck-updated]'),errorNode=root.querySelector('[data-ck-refresh-error]');
 set('[data-ck-seconds]',String(remaining));set('[data-ck-live-label]',busy?'Vernieuwen':error?'Verbinding controleren':'Live');
 if(ring)ring.setAttribute('stroke-dasharray',(94.248*remaining/30)+' 94.248');
 if(button){button.disabled=busy;button.setAttribute('aria-busy',String(busy));button.classList.toggle('is-loading',busy);}
 if(badge)badge.hidden=!updated;
 if(errorNode){errorNode.hidden=!error;errorNode.textContent=error;}
 root.querySelector('[data-ck-live-dot]')?.classList.toggle('ck-live-error',!!error);
 const countdown=root.querySelector('[data-ck-countdown-label]');if(countdown)countdown.hidden=busy;
}

export function enhanceControlekamer(root,{previousValues={},freshIds=[],animateCards=true}={}){
 const values={},window=root?.ownerDocument?.defaultView||globalThis.window;
 if(!root||!window)return{values,dispose(){}};
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches||false;
 root.classList.toggle('ck-no-enter',!animateCards||reduce);
 const numberNodes=[...root.querySelectorAll('[data-ck-number]')].map(node=>({node,key:node.dataset.ckNumber,to:number(node.dataset.value)}));
 const bars=[...root.querySelectorAll('[data-ck-bar]')].map(node=>({node,key:'bar:'+node.dataset.ckBar,to:percent(node.dataset.width),property:'width'}));
 const heights=[...root.querySelectorAll('[data-ck-height]')].map(node=>({node,key:'height:'+node.dataset.ckHeight,to:percent(node.dataset.height),property:'height'}));
 const ring=root.querySelector('[data-ck-ring="callers"]'),ringTarget=ring?percent(number(ring.dataset.ratio)*100):0;
 const fresh=new Set(freshIds);root.querySelectorAll('[data-ck-event-id]').forEach(node=>node.classList.toggle('ck-fresh',!reduce&&fresh.has(node.dataset.ckEventId)));
 for(const item of [...numberNodes,...bars,...heights]){item.from=Number.isFinite(previousValues[item.key])?previousValues[item.key]:0;values[item.key]=reduce?item.to:item.from;}
 const ringFrom=Number.isFinite(previousValues['ring:callers'])?previousValues['ring:callers']:0;values['ring:callers']=reduce?ringTarget:ringFrom;
 let frame=null,disposed=false;
 function paint(progress){
  const eased=1-Math.pow(1-progress,3);
  for(const item of numberNodes){const value=item.from+(item.to-item.from)*eased;values[item.key]=value;item.node.textContent=format(value);}
  for(const item of [...bars,...heights]){const value=item.from+(item.to-item.from)*eased;values[item.key]=value;item.node.style[item.property]=value+'%';}
  const ratio=ringFrom+(ringTarget-ringFrom)*eased;values['ring:callers']=ratio;if(ring)ring.setAttribute('stroke-dasharray',(163.363*ratio/100)+' 163.363');
 }
 if(reduce||typeof window.requestAnimationFrame!=='function')paint(1);
 else{paint(0);const start=window.performance.now();const step=now=>{if(disposed||!root.isConnected)return;const progress=Math.min(1,Math.max(0,(now-start)/900));paint(progress);if(progress<1)frame=window.requestAnimationFrame(step);};frame=window.requestAnimationFrame(step);}
 return{values,dispose(){disposed=true;if(frame!==null)window.cancelAnimationFrame(frame);}};
}
