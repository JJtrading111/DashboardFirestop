import {callOutcomeNames} from './model.mjs';

const DAY=86400000;
const list=value=>Array.isArray(value)?value:[];
const words=value=>typeof value==='string'?value.trim():'';
const time=value=>typeof value==='number'?value:typeof value==='string'&&value?Date.parse(value):NaN;
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});
const dayAt=value=>Object.fromEntries(dayFormatter.formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
const localDay=value=>{const p=dayAt(value);return`${p.year}-${p.month}-${p.day}`;};
const shiftedDay=(day,offset)=>new Date(Date.parse(day+'T12:00:00.000Z')+offset*DAY).toISOString().slice(0,10);
const validId=value=>typeof value==='string'&&value.length>0;
const sortLatest=(a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id);

// This reads the supplied, already-authorized state. It never creates a workspace
// merely because a central project is available to a company.
export function buildAdminOverview(state,{now=Date.now(),period='7d',companyId='all',attentionCompanyId=companyId,activityType='all',limit=30}={}){
 const instant=Number.isFinite(time(now))?time(now):Date.now(),today=localDay(instant);
 const weekday=new Date(Date.parse(today+'T12:00:00.000Z')).getUTCDay()||7,weekStart=shiftedDay(today,1-weekday);
 const pageLimit=Number.isSafeInteger(limit)?Math.max(1,Math.min(500,limit)):30;
 const selectedPeriod=['today','7d','30d','all'].includes(period)?period:'7d';
 const selectedType=['all','call','note','status','notes-status','followup','update','source','result'].includes(activityType)?activityType:'all';
 const leads=new Map(list(state?.leads).filter(lead=>validId(lead?.id)).map(lead=>[lead.id,lead]));
 const users=new Map(list(state?.users).filter(user=>validId(user?.id)).map(user=>[user.id,user]));
 const rows=new Map(list(state?.companies).filter(company=>validId(company?.id)).map(company=>[company.id,{
  id:company.id,name:words(company.name)||'Onbekend bedrijf',companyId:company.id,companyName:words(company.name)||'Onbekend bedrijf',
  initials:words(company.initials),color:words(company.color),logoUrl:words(company.logoUrl),
  activeUsers:0,workedLeads:0,totalCalls:0,callsToday:0,callsThisWeek:0,notesCount:0,openCallbacks:0,overdueCallbacks:0,
  commitments:0,calculations:0,highPriorityUnassigned:0,
  columns:list(company.columns).map(column=>({id:column.id,name:words(column.name)||'Onbekende status',count:0})),lastActivityAt:null
 }]));
 const activity=[],attention=[],worked=new Map([...rows.keys()].map(id=>[id,new Set()]));
 const canonicalCalls=new Set(),callSignatures=new Set(),callEvents=[],noteEvents=[];
 const actor=(snapshot,id)=>words(snapshot)||words(users.get(id)?.name)||'Onbekende gebruiker';
 const past=value=>Number.isFinite(time(value))&&time(value)<=instant;
 const mark=(row,at)=>{if(past(at)&&(!row.lastActivityAt||time(at)>time(row.lastActivityAt)))row.lastActivityAt=new Date(time(at)).toISOString();};
 const event=(type,row,lead,entry)=>({type,companyId:row?.id??null,companyName:row?.name??'Centrale bronnen',leadId:lead?.id??null,leadTitle:words(lead?.title),...entry});
 const normalizedFeed=list(state?.feed).filter(item=>item&&past(item.at)&&(!item.companyId||rows.has(item.companyId)));
 for(const user of users.values())if(user.status==='actief'&&rows.has(user.companyId))rows.get(user.companyId).activeUsers++;
 for(const feed of normalizedFeed){const row=rows.get(feed.companyId);if(row){mark(row,feed.at);if(leads.has(feed.leadId))worked.get(row.id).add(feed.leadId);}}

 function addCall(row,lead,call,{fallback=false}={}){
  if(!call||!past(call.at))return;
  const signature=JSON.stringify([row.id,lead.id,new Date(time(call.at)).toISOString(),call.userId||'']);
  const key=JSON.stringify([row.id,lead.id,call.id||signature]);
  if(canonicalCalls.has(key)||fallback&&callSignatures.has(signature))return;
  canonicalCalls.add(key);callSignatures.add(signature);worked.get(row.id).add(lead.id);
  const callDay=localDay(time(call.at));row.totalCalls++;if(callDay===today)row.callsToday++;if(callDay>=weekStart)row.callsThisWeek++;mark(row,call.at);
  const actorName=actor(call.userName,call.userId),at=new Date(time(call.at)).toISOString();
  const item=event('call',row,lead,{id:'call:'+key,at,actorName,authorName:actorName,
   text:(callOutcomeNames[call.outcome]||'Belmoment geregistreerd')+': '+words(lead.title),detail:[words(call.person),words(call.detail)].filter(Boolean).join(' · ')});
  callEvents.push(item);activity.push(item);
 }
 for(const [id,row]of rows){
  const workspace=state?.workspaces?.[id]||{};
  for(const [leadId,w]of Object.entries(workspace)){
   const lead=leads.get(leadId);if(!lead||!w||typeof w!=='object')continue;
   const calls=list(w.calls),notes=list(w.notes),callbacks=list(w.callbacks);
   if(w.ownerId||w.status&&w.status!==row.columns[0]?.id||w.priority&&w.priority!=='medium'||w.commitment||w.calculation||calls.length||notes.length||callbacks.length||words(w.contactName)||words(w.contactEmail)||words(w.contactPhone)||words(w.lastContactPerson)||words(w.selectedContact?.name))worked.get(id).add(leadId);
   if(words(w.selectedContact?.name))mark(row,w.selectedContact.selectedAt);
   for(const call of calls)addCall(row,lead,call);
   for(const note of notes){
    if(!note||!words(note.text))continue;
    row.notesCount++;
    if(!past(note.createdAt))continue;
    const actorName=actor(note.authorName,note.authorId),at=new Date(time(note.createdAt)).toISOString();mark(row,at);
    const item=event('note',row,lead,{id:'note:'+JSON.stringify([id,leadId,note.id||at,actorName]),at,actorName,authorName:actorName,text:'Gespreksnotitie: '+words(lead.title),detail:words(note.text)});
    noteEvents.push(item);activity.push(item);
   }
   for(const callback of callbacks){
    if(!callback||callback.done||!Number.isFinite(time(callback.dueAt)))continue;
    row.openCallbacks++;
    if(time(callback.dueAt)>instant)continue;
    row.overdueCallbacks++;
    const dueAt=new Date(time(callback.dueAt)).toISOString(),creatorName=actor(callback.creatorName,callback.creatorId),assigneeName=words(users.get(callback.assigneeId)?.name)||'Voormalige medewerker';
    attention.push(event('overdue',row,lead,{id:'callback:'+JSON.stringify([id,leadId,callback.id||dueAt]),kind:'callback',at:dueAt,dueAt,actorName:creatorName,authorName:creatorName,creatorName,assigneeName,text:words(callback.description)||'Terugbelafspraak verlopen'}));
   }
   if(w.priority==='high'&&!w.ownerId){row.highPriorityUnassigned++;attention.push(event('unassigned',row,lead,{id:'unassigned:'+JSON.stringify([id,leadId]),kind:'unassigned',at:null,actorName:'',authorName:'',assigneeName:'Niet toegewezen',text:'Hoge prioriteit zonder verantwoordelijke verkoper'}));}
   for(const [field,metric,label]of [['commitment','commitments','Toezegging ontvangen'],['calculation','calculations','Klaar voor calculatie']]){
    if(!w[field])continue;
    row[metric]++;
    if(!past(w[field+'At']))continue;
    const at=new Date(time(w[field+'At'])).toISOString();mark(row,at);
    activity.push(event('result',row,lead,{id:'result:'+JSON.stringify([id,leadId,field,at]),kind:field,at,actorName:'',authorName:'',text:label+': '+words(lead.title),detail:''}));
   }
  }
 }
 // The workspace record has the richer outcome/person snapshot. Retain a
 // historical central call only when its company/lead call was not retained there.
 for(const call of list(state?.callLog)){const row=rows.get(call?.companyId),lead=leads.get(call?.leadId);if(row&&lead)addCall(row,lead,call,{fallback:true});}
 const eventIndex=items=>{
  const index=new Map();
  for(const item of items)for(const name of ['',item.actorName]){
   const key=JSON.stringify([item.companyId,item.leadId,name]);if(!index.has(key))index.set(key,[]);index.get(key).push(time(item.at));
  }
  for(const values of index.values())values.sort((a,b)=>a-b);
  return index;
 };
 const callIndex=eventIndex(callEvents),noteIndex=eventIndex(noteEvents);
 const represented=(index,feed)=>{
  const values=index.get(JSON.stringify([feed.companyId,feed.leadId,words(feed.authorName)]))||[],target=time(feed.at);
  let low=0,high=values.length;while(low<high){const middle=(low+high)>>>1;if(values[middle]<target-1000)low=middle+1;else high=middle;}
  return low<values.length&&values[low]<=target+1000;
 };
 const seenFeed=new Set();
 for(const feed of normalizedFeed){
  const key=feed.id||JSON.stringify([feed.companyId,feed.leadId,feed.at,feed.text]);if(seenFeed.has(key))continue;seenFeed.add(key);
  const row=rows.get(feed.companyId),lead=leads.get(feed.leadId),isNote=/^Gespreksnotitie toegevoegd:/i.test(words(feed.text));
  if(feed.type==='call'&&represented(callIndex,feed)||isNote&&represented(noteIndex,feed))continue;
  const type=!row?'source':feed.type==='call'?'call':isNote?'note':feed.type==='status'?'status':feed.type==='followup'?'followup':'update';
  const actorName=words(feed.authorName)||'Onbekende gebruiker';
  const rawChange=feed.statusChange,statusChange=type==='status'&&rawChange&&typeof rawChange==='object'&&!Array.isArray(rawChange)&&['fromId','fromName','toId','toName'].every(field=>typeof rawChange[field]==='string')?Object.fromEntries(['fromId','fromName','toId','toName'].map(field=>[field,words(rawChange[field])])):null;
  activity.push(event(type,row,lead,{id:'feed:'+key,at:new Date(time(feed.at)).toISOString(),actorName,authorName:actorName,actorId:words(feed.authorId),text:words(feed.text),detail:'',...(statusChange?{statusChange}:{})}));
 }
 for(const row of rows.values()){
  row.workedLeads=worked.get(row.id).size;
  for(const leadId of worked.get(row.id)){
   const w=state?.workspaces?.[row.id]?.[leadId],status=w?.status||row.columns[0]?.id;
   let column=row.columns.find(column=>column.id===status);
   if(!column){column=row.columns.find(column=>column.id==='__unknown');if(!column){column={id:'__unknown',name:'Onbekende status',count:0};row.columns.push(column);}}
   column.count++;
  }
 }
 const companies=[...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,'nl')||a.id.localeCompare(b.id));
 const keys=['activeUsers','workedLeads','totalCalls','callsToday','callsThisWeek','notesCount','openCallbacks','overdueCallbacks','commitments','calculations','highPriorityUnassigned'];
 const totals={centralLeads:leads.size,companyCount:companies.length,...Object.fromEntries(keys.map(key=>[key,companies.reduce((total,row)=>total+row[key],0)]))};
 const firstDay=selectedPeriod==='today'?today:shiftedDay(today,selectedPeriod==='30d'?-29:-6);
 const matchesType=item=>selectedType==='all'||(selectedType==='notes-status'?['note','status'].includes(item.type):item.type===selectedType);
 const filtered=activity.filter(item=>(companyId==='all'||item.companyId===companyId)&&matchesType(item)&&(selectedPeriod==='all'||localDay(time(item.at))>=firstDay)).sort(sortLatest);
 const currentAttention=attention.filter(item=>attentionCompanyId==='all'||item.companyId===attentionCompanyId).sort((a,b)=>a.type!==b.type?(a.type==='overdue'?-1:1):a.dueAt&&b.dueAt?time(a.dueAt)-time(b.dueAt)||a.id.localeCompare(b.id):a.companyName.localeCompare(b.companyName,'nl')||a.leadTitle.localeCompare(b.leadTitle,'nl'));
 const activityLimited=filtered.length>pageLimit;
 return{generatedAt:new Date(instant).toISOString(),today,weekStart,totals,companies,activity:filtered.slice(0,pageLimit),activityTotal:filtered.length,activityLimited,hasMoreActivity:activityLimited,attention:currentAttention.slice(0,pageLimit),attentionTotal:currentAttention.length};
}
