import {buildCallReport} from './call-report.mjs';

const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const timestamp=value=>value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'&&value?Date.parse(value):NaN;
const normalized=value=>text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL');
const validId=value=>typeof value==='string'&&value.length>0;
const zone=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const dateLabel=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric'});
const partsAt=value=>Object.fromEntries(zone.formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
const localDay=value=>{const p=partsAt(value);return`${p.year}-${p.month}-${p.day}`;};
const initials=name=>text(name).split(/\s+/).filter(Boolean).map(part=>Array.from(part)[0]).slice(0,2).join('').toLocaleUpperCase('nl-NL');
const namedColors={flamestop:'#E8590C',flameguard:'#7C3AED',flameseal:'#0F9F8F'};
const companyColor=company=>namedColors[normalized(company.name)]||(/^#[0-9a-f]{6}$/i.test(company.color||'')?company.color:'#245DE4');
const phrase=(count,singular,plural)=>count+' '+(count===1?singular:plural);
const callbackSignal=value=>/\b(?:tb|terug\s*bellen)\b/i.test(text(value));
const mailSignal=value=>/mail/i.test(text(value));
const doneSignal=value=>/\b(?:al\s+geregeld|opgeleverd)\b/i.test(text(value));
const percentage=(count,total)=>total?count/total*100:0;
const eventOrder=(a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id);

// Only supplied, already-authorized state is read. Missing workspaces remain
// missing; the default Kanban column is counted without materializing records.
export function buildControlekamer(state,{now=Date.now(),companyId='all',type='all',limit=8}={}){
 const instant=Number.isFinite(timestamp(now))?timestamp(now):Date.now(),today=localDay(instant),currentHour=Number(partsAt(instant).hour);
 const companies=[...new Map(list(state?.companies).filter(company=>validId(company?.id)).map(company=>[company.id,{id:company.id,name:text(company.name)||'Onbekend bedrijf',color:companyColor(company),columns:list(company.columns).filter(column=>validId(column?.id)).map(column=>({id:column.id,name:text(column.name)||'Naam niet vastgelegd'}))}])).values()];
 const companyMap=new Map(companies.map(company=>[company.id,company]));
 const selectedId=companyId==='all'||companyMap.has(companyId)?companyId:'all';
 const selectedCompanies=companies.filter(company=>selectedId==='all'||company.id===selectedId),selectedIds=new Set(selectedCompanies.map(company=>company.id));
 const reportState={...state,archivedCompanies:[]};
 const report=buildCallReport(reportState,{now:instant,companyId:selectedId,groupBy:'day',from:today,to:today});
 for(const company of companies)company.callsToday=buildCallReport(reportState,{now:instant,companyId:company.id,groupBy:'day',from:today,to:today}).totals.calls;
 const users=new Map(list(state?.users).filter(user=>validId(user?.id)).map(user=>[user.id,user]));
 const reportRows=new Map(report.rows.map(row=>[row.sellerId,row]));
 const team=[...users.values()].filter(user=>user.status==='actief'&&selectedIds.has(user.companyId)).map(user=>{
  const company=companyMap.get(user.companyId),row=reportRows.get(user.id);
  return{id:user.id,userId:user.id,name:text(user.name)||row?.sellerName||'Naam niet vastgelegd',initials:initials(user.name),companyId:company.id,companyName:company.name,color:company.color,callsToday:row?.total||0,callCompanyIds:row?.companyIds||[],callCompanyNames:row?.companyNames||[],eligible:true,historical:false};
 });
 const eligibleIds=new Set(team.map(member=>member.id));
 for(const row of report.rows)if(row.total>0&&!eligibleIds.has(row.sellerId)){
  const company=companyMap.get(row.companyIds[0]);
  team.push({id:row.sellerId,userId:row.sellerId,name:row.sellerName,initials:initials(row.sellerName),companyId:row.companyIds.length===1?row.companyIds[0]:'all',companyName:row.companyNames.join(', '),color:company?.color||'#245DE4',callsToday:row.total,callCompanyIds:[...row.companyIds],callCompanyNames:[...row.companyNames],eligible:false,historical:true});
 }
 team.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.callsToday-a.callsToday||a.name.localeCompare(b.name,'nl')||a.id.localeCompare(b.id));
 const eligibleTeam=team.filter(member=>member.eligible),activeCallers=eligibleTeam.filter(member=>member.callsToday>0).length,zeroTeam=eligibleTeam.filter(member=>member.callsToday===0);
 const activeLeads=new Map(list(state?.leads).filter(lead=>validId(lead?.id)).map(lead=>[lead.id,lead]));
 const leads=new Map([...list(state?.archivedLeads),...activeLeads.values()].filter(lead=>validId(lead?.id)).map(lead=>[lead.id,lead]));
 const notes=[],events=[],seenNotes=new Set(),seenStatus=new Set(),overdue=[],unassigned=[],callbackCandidates=[],pipelineGroups=new Map(),pipelineByCompany=[];
 const pastToday=value=>{const at=timestamp(value);return Number.isFinite(at)&&at<=instant&&localDay(at)===today;};
 const eventContext=(company,lead)=>({companyId:company.id,companyName:company.name,color:company.color,leadId:lead&&activeLeads.has(lead.id)?lead.id:null,leadTitle:text(lead?.title),...(lead&&!activeLeads.has(lead.id)?{archivedLead:true,archivedLeadId:lead.id}:{})});
 for(const company of selectedCompanies){
  const workspace=state?.workspaces?.[company.id]||{},companyOverdue=[],companyUnassigned=[],companyCandidates=[],columnCounts=new Map(company.columns.map(column=>[column.id,0]));
  for(const [leadId,w]of Object.entries(workspace)){
   const lead=leads.get(leadId);if(!lead||!w||typeof w!=='object')continue;
   const active=activeLeads.has(leadId),openCallbacks=list(w.callbacks).filter(callback=>callback&&callback.done!==true);
   if(active){
    for(const callback of openCallbacks){const due=timestamp(callback.dueAt);if(Number.isFinite(due)&&due<=instant)companyOverdue.push({leadId,callbackId:text(callback.id),dueAt:new Date(due).toISOString(),leadTitle:text(lead.title)});}
    if(w.priority==='high'&&!w.ownerId)companyUnassigned.push({leadId,leadTitle:text(lead.title)});
   }
   const todayNotes=[];
   for(const note of list(w.notes)){
    if(!note||!text(note.text)||!pastToday(note.createdAt))continue;
    const at=new Date(timestamp(note.createdAt)).toISOString(),authorName=text(note.authorName)||text(users.get(note.authorId)?.name)||'Maker niet vastgelegd';
    const key=JSON.stringify([company.id,leadId,text(note.id)||[at,text(note.authorId),authorName,text(note.text)]]);if(seenNotes.has(key))continue;seenNotes.add(key);
    const item={id:'note:'+key,type:'note',at,...eventContext(company,lead),actorId:text(note.authorId),actorName:authorName,title:'Gespreksnotitie',text:text(note.text),detail:text(note.text)};
    notes.push(item);events.push(item);todayNotes.push(item);
   }
   // This is a textual prompt, never proof of an appointment. Any existing open
   // appointment suppresses the prompt; archived projects cannot be reopened.
   if(active&&!openCallbacks.length){const relevant=todayNotes.filter(note=>callbackSignal(note.text)).sort(eventOrder)[0];if(relevant)companyCandidates.push({...relevant,leadId});}
  }
  companyOverdue.sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt)||a.leadId.localeCompare(b.leadId));
  overdue.push(...companyOverdue.map(item=>({...item,companyId:company.id,companyName:company.name})));
  unassigned.push(...companyUnassigned.map(item=>({...item,companyId:company.id,companyName:company.name})));
  callbackCandidates.push(...companyCandidates.map(item=>({...item,companyId:company.id,companyName:company.name})));
  for(const lead of activeLeads.values()){
   const status=text(workspace[lead.id]?.status)||company.columns[0]?.id||'__unassigned';
   columnCounts.set(status,(columnCounts.get(status)||0)+1);
  }
  const companyColumns=[...company.columns];
  for(const status of columnCounts.keys())if(!companyColumns.some(column=>column.id===status))companyColumns.push({id:status,name:status==='__unassigned'?'Niet ingedeeld':'Onbekende status'});
  for(const column of companyColumns){
   const name=column.name,key=normalized(name),isNew=key==='nieuw',count=columnCounts.get(column.id)||0;
   if(!pipelineGroups.has(key))pipelineGroups.set(key,{id:'column:'+key,name,count:0,color:selectedCompanies.length===1?company.color:'#245DE4',isNew,companyColumns:[]});
   const group=pipelineGroups.get(key);group.count+=count;group.companyColumns.push({companyId:company.id,columnId:column.id,count});
  }
  pipelineByCompany.push({companyId:company.id,companyName:company.name,color:company.color,columns:companyColumns.map(column=>({...column,count:columnCounts.get(column.id)||0})),overdue:companyOverdue,unassigned:companyUnassigned,callbackCandidates:companyCandidates});
 }
 for(const feed of list(state?.feed)){
  if(!feed||feed.type!=='status'||!selectedIds.has(feed.companyId)||!pastToday(feed.at))continue;
  const company=companyMap.get(feed.companyId),lead=leads.get(feed.leadId),at=new Date(timestamp(feed.at)).toISOString();
  const key=text(feed.id)||JSON.stringify([feed.companyId,feed.leadId,at,feed.authorId,feed.authorName,feed.text]);if(seenStatus.has(key))continue;seenStatus.add(key);
  const raw=feed.statusChange,change=raw&&typeof raw==='object'&&!Array.isArray(raw)&&['fromId','fromName','toId','toName'].every(field=>typeof raw[field]==='string')?Object.fromEntries(['fromId','fromName','toId','toName'].map(field=>[field,text(raw[field])])):null;
  const content=change?change.fromName+' → '+change.toName:text(feed.text);
  events.push({id:'status:'+key,type:'status',at,...eventContext(company,lead),actorId:text(feed.authorId),actorName:text(feed.authorName)||text(users.get(feed.authorId)?.name)||'Maker niet vastgelegd',title:'Statuswijziging',text:content,detail:content,...change?{statusChange:change}:{}});
 }
 events.sort(eventOrder);
 const noteCount=notes.length,statusCount=events.filter(event=>event.type==='status').length;
 const sourceErrors=selectedId==='all'?list(state?.sources).filter(source=>source&&!source.deleted&&(source.lastImportError||source.scraper?.lastError||['error','login_required'].includes(source.scraper?.status))).map(source=>({id:text(source.id),name:text(source.name)||'Bron zonder naam',message:text(source.scraper?.lastError)||text(source.lastImportError)||'Ophalen vraagt aandacht.'})):[];
 const followupCount=overdue.length+unassigned.length;
 const health=[
  {key:'followup',title:'Opvolging',status:followupCount?'warn':'ok',visible:true,count:followupCount,value:followupCount?phrase(followupCount,'aandachtspunt','aandachtspunten'):'Op orde',text:overdue.length+' verlopen afspraken · '+unassigned.length+' hoge prioriteiten zonder eigenaar',overdue:overdue.length,unassigned:unassigned.length},
  {key:'sources',title:'Bronnen',status:selectedId!=='all'?'neutral':sourceErrors.length?'warn':'ok',visible:selectedId==='all',count:selectedId==='all'?sourceErrors.length:null,value:selectedId!=='all'?'—':sourceErrors.length?phrase(sourceErrors.length,'melding','meldingen'):'Op orde',text:selectedId!=='all'?'Alleen zichtbaar bij Alle bedrijven.':sourceErrors.length?sourceErrors.map(source=>source.name).join(', '):'Geen bronmeldingen gemeld.',errors:sourceErrors},
  {key:'team',title:'Team',status:eligibleTeam.length?(zeroTeam.length?'warn':'ok'):'neutral',visible:true,count:zeroTeam.length,value:eligibleTeam.length?activeCallers+' / '+eligibleTeam.length:'Geen medewerkers',text:activeCallers+' van '+eligibleTeam.length+' medewerkers hebben vandaag gebeld.',activeCallers,teamSize:eligibleTeam.length}
 ];
 const actions=[];
 if(sourceErrors.length)actions.push({id:'source-errors',kind:'logbook',title:phrase(sourceErrors.length,'bronmelding controleren','bronmeldingen controleren'),text:sourceErrors.map(source=>source.name).join(', '),label:'Logboek',count:sourceErrors.length,companyId:'all',sourceId:sourceErrors.length===1?sourceErrors[0].id:'all',color:'#B45309'});
 for(const group of pipelineByCompany)if(group.overdue.length)actions.push({id:'overdue:'+group.companyId,kind:'callbacks',title:phrase(group.overdue.length,'verlopen terugbelafspraak','verlopen terugbelafspraken'),text:group.companyName,label:'Opvolgen',count:group.overdue.length,companyId:group.companyId,color:'#B45309'});
 for(const group of pipelineByCompany)if(group.unassigned.length)actions.push({id:'unassigned:'+group.companyId,kind:'lead',title:phrase(group.unassigned.length,'hoge prioriteit zonder eigenaar','hoge prioriteiten zonder eigenaar'),text:group.companyName+' · eerst: '+group.unassigned[0].leadTitle,label:'Bekijken',count:group.unassigned.length,companyId:group.companyId,leadId:group.unassigned[0].leadId,color:'#B45309'});
 for(const group of pipelineByCompany)if(group.callbackCandidates.length){const first=[...group.callbackCandidates].sort(eventOrder)[0];actions.push({id:'callback-signal:'+group.companyId,kind:'callback',title:phrase(group.callbackCandidates.length,'terugbelsignaal zonder afspraak','terugbelsignalen zonder afspraak'),text:group.companyName+' · mogelijk terugbellen: '+first.leadTitle,label:'Inplannen',count:group.callbackCandidates.length,companyId:group.companyId,leadId:first.leadId,color:'#245DE4'});}
 if(zeroTeam.length)actions.push({id:'zero-callers:'+selectedId,kind:'report',title:phrase(zeroTeam.length,'medewerker zonder belmoment','medewerkers zonder belmoment'),text:zeroTeam.map(member=>member.name).join(', '),label:'Belrapport',count:zeroTeam.length,companyId:selectedId,userId:zeroTeam.length===1?zeroTeam[0].id:'all',color:'#B45309'});
 for(const group of pipelineByCompany){const first=group.columns[0];if(first?.count)actions.push({id:'new-column:'+group.companyId,kind:'kanban',title:phrase(first.count,'lead in kolom '+first.name,'leads in kolom '+first.name),text:group.companyName,label:'Kanban',count:first.count,companyId:group.companyId,columnId:first.id,color:group.color});}
 const signals=[
  {key:'mail',title:'Mail genoemd',text:'Notities waarin mail wordt genoemd.',count:notes.filter(note=>mailSignal(note.text)).length},
  {key:'callback',title:'Terugbellen genoemd',text:'Notities met tb of terugbellen.',count:notes.filter(note=>callbackSignal(note.text)).length},
  {key:'done',title:'Al geregeld of opgeleverd',text:'Tekstsignaal uit notities; beoordeel de lead zelf.',count:notes.filter(note=>doneSignal(note.text)).length}
 ];
 const hourCounts=new Map();for(const event of events){const hour=Number(partsAt(timestamp(event.at)).hour);hourCounts.set(hour,(hourCounts.get(hour)||0)+1);}
 const hours=Array.from({length:10},(_,index)=>{const hour=index+8;return{hour,label:String(hour).padStart(2,'0')+':00',count:hourCounts.get(hour)||0,current:hour===currentHour,future:hour>currentHour};});
 const columns=[...pipelineGroups.values()],pipelineTotal=columns.reduce((total,column)=>total+column.count,0),newCount=columns.filter(column=>column.isNew).reduce((total,column)=>total+column.count,0),newPercent=percentage(newCount,pipelineTotal);
 for(const column of columns)column.percent=percentage(column.count,pipelineTotal);
 const pipeline={columns,total:pipelineTotal,newCount,newPercent,newWarning:pipelineTotal>0&&newPercent>90,warning:pipelineTotal>0&&newPercent>90?Math.round(newPercent)+'% staat op Nieuw':null,description:selectedCompanies.length>1?'Telt per bedrijfswerkplek; dezelfde centrale lead kan bij meerdere bedrijven meetellen.':selectedCompanies.length===1?'Status van de centrale leads bij '+selectedCompanies[0].name+'.':'Geen bedrijfswerkplekken beschikbaar.',byCompany:pipelineByCompany.map(({companyId,companyName,columns})=>({companyId,companyName,columns}))};
 const selectedType=['all','note','status'].includes(type)?type:'all',typed=events.filter(event=>selectedType==='all'||event.type===selectedType),pageLimit=Number.isSafeInteger(limit)&&limit>=0?limit:8;
 const typeCounts={all:events.length,note:noteCount,status:statusCount};
 return{generatedAt:new Date(instant).toISOString(),companyId:selectedId,selectedCompanyId:selectedId,today,dateLabel:dateLabel.format(instant),currentHour,companies,selectedCompanies,team,health,actions,kpis:{calls:report.totals.calls,notes:noteCount,status:statusCount,activeCallers,teamSize:eligibleTeam.length},signals,hours,pipeline,events,typeCounts,timeline:{events,items:typed.slice(0,pageLimit),total:typed.length,hasMore:typed.length>pageLimit,counts:typeCounts},sourceErrors};
}
