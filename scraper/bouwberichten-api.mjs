import {normalizeBouwberichtenFilterUrl} from '../public/bouwberichten-filters.mjs';

// Contract evidence: the public portal bundle's lor/hor/D2 (filters/search),
// tge (project detail), gge/Q9r/jH (organisations/contacts), and OH/sk (EUR).
// This is a code-derived contract, not proof of a working authenticated API session.
export const API_BASE_URL='https://management.bouwberichten.nl/api/v1';
export const PROJECT_RESULT_FIELDS=Object.freeze(['id','name','description','address.city','constructionPhase','estimatedAmountValue','estimateRange','updatedAt','lastPublishedAt','involvements.organisationId']);
const ARRAY_FIELDS=new Set(['id','address.province','buildingSpecifications.buildingCode','buildingSpecifications.constructionType','buildingSpecifications.residentialBuildingType','buildingSpecifications.residentialType','buildingSpecifications.roofType','constructionPhase','involvements.role','sustainableProperties']);
const DATE_FIELDS=new Set(['awardedAt','deliveredAt','firstPublishedAt','lastPublishedAt','registrationDeadline','startedAt']);
const RANGE_FIELDS=new Set(['buildingSpecifications.amount','buildingLayers','estimateRange','surface','volume','score']);
const CORPORATE_ARRAY_FIELDS=new Set(['corporateProjectInfo.assignedToId','corporateProjectInfo.funnelFaseId','corporateProjectInfo.hasOpenUserTask','corporateProjectInfo.hasClosedUserTask']);
const BOOLEAN_FIELDS={active:{Actief:true,'Niet actief':false},isVisible:{Zichtbaar:true,Onzichtbaar:false},demolitionWork:{Ja:true,Nee:false}};
const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

export class BouwberichtenApiError extends Error{
 constructor(message,{code='INVALID_INPUT',status=null,retryAfter=null,reason=null}={}){super(message);this.name='BouwberichtenApiError';this.code=code;this.status=status;if(retryAfter!==null)this.retryAfter=retryAfter;if(reason!==null)this.reason=reason;}
}
const invalid=message=>{throw new BouwberichtenApiError(message);};
const typed=(_type,value)=>({_type,value});
function integer(value,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
 if(typeof value!=='string'&&typeof value!=='number'||!/^[-+]?\d+$/.test(String(value)))invalid('Een filter bevat een ongeldig geheel getal.');
 const number=Number(value);if(!Number.isSafeInteger(number)||number<minimum||number>maximum)invalid('Een filtergetal valt buiten het toegestane bereik.');return number;
}
function projectId(value){
 if(typeof value==='number'&&!Number.isSafeInteger(value)||!['string','number'].includes(typeof value)||!/^\d{1,128}$/.test(String(value).trim()))invalid('Het project- of organisatienummer is ongeldig.');
 const id=String(value).trim().replace(/^0+(?=\d)/,'');if(id==='0')invalid('Het project- of organisatienummer is ongeldig.');return id;
}
function asArray(entries){
 if(entries.some(({tail})=>tail.length>1||tail.length===1&&tail[0]!==''&&!/^\d+$/.test(tail[0])))invalid('Een meervoudige filter heeft een onbekende structuur.');
 const values=entries.map(({value})=>value);if(!values.length||values.some(value=>!value))invalid('Een meervoudige filter bevat een lege waarde.');return [...new Set(values)];
}
function scalar(entries){if(entries.length!==1||entries[0].tail.length)invalid('Een enkelvoudige filter heeft een onbekende structuur.');return entries[0].value;}
function bounds(entries,allowed){
 const value={};for(const entry of entries){if(entry.tail.length!==1||!allowed.includes(entry.tail[0])||has(value,entry.tail[0]))invalid('Een bereikfilter heeft een onbekende structuur.');if(entry.value)value[entry.tail[0]]=entry.value;}
 if(!Object.keys(value).length)invalid('Een bereikfilter bevat geen grens.');return value;
}

export function translateFilterParameters(parameters){
 if(!Array.isArray(parameters)||parameters.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string')))invalid('Gebruik de opgeslagen filterparameters van een Bouwberichten-bron.');
 let normalized;try{normalized=normalizeBouwberichtenFilterUrl('https://portal.bouwberichten.nl/projecten#'+new URLSearchParams(parameters));}catch{invalid('De Bouwberichten-filterparameters zijn ongeldig of bevatten geen expliciete selectie.');}
 const grouped=new Map(),settings={};for(const [key,value]of normalized.filterParameters){const parts=[...key.matchAll(/\[([^\]]*)\]/g)].map(match=>match[1]);if(parts[0]==='filters'){const entries=grouped.get(parts[1])??[];entries.push({tail:parts.slice(2),value});grouped.set(parts[1],entries);}else settings[key]=value;}
 const filters={};
 for(const [field,entries]of grouped){
  if(ARRAY_FIELDS.has(field))filters[field]=typed('multiValue',asArray(entries));
  else if(CORPORATE_ARRAY_FIELDS.has(field)){const values=asArray(entries),notSet=values.includes('none');filters[field]=typed(notSet?'multiValueOrNotSet':'multiValue',values.filter(value=>value!=='none'));}
  else if(field==='involvements.organisationId')filters[field]=typed('multiFilter',asArray(entries));
  else if(DATE_FIELDS.has(field)){const value=bounds(entries,['start','end']);for(const key of Object.keys(value))value[key]=new Date(value[key]).toISOString();if(value.start&&value.end&&value.start>value.end)invalid('De begindatum ligt na de einddatum.');filters[field]=typed('dateRange',value);}
  else if(RANGE_FIELDS.has(field)){const value=bounds(entries,['min','max']);for(const key of Object.keys(value))value[key]=integer(value[key],{minimum:-Number.MAX_SAFE_INTEGER});if(value.min!==undefined&&value.max!==undefined&&value.min>value.max)invalid('De ondergrens ligt boven de bovengrens.');filters[field]=typed('range',value);}
  else if(has(BOOLEAN_FIELDS,field)){const values=asArray(entries);if(values.length!==1||!has(BOOLEAN_FIELDS[field],values[0]))invalid('Kies één geldige waarde voor de ja/nee-filter.');filters[field]=typed('boolean',BOOLEAN_FIELDS[field][values[0]]);}
  else if(['address.zipCode','address.city','address.country','address.distance'].includes(field)){const key=field.slice('address.'.length),value=scalar(entries);if(!value)invalid('Een locatiefilter bevat een lege waarde.');filters.address??=typed('geoLocation',{});filters.address.value[key]=key==='distance'?integer(value):value;}
  else if(field==='tasks'){const value=scalar(entries);if(value==='open')filters['corporateProjectInfo.hasOpenUserTask']=typed('boolean',true);else if(value==='afgerond')filters['corporateProjectInfo.hasClosedUserTask']=typed('boolean',true);else if(value==='none')filters['corporateProjectInfo.hasOpenUserTask']=typed('multiValueOrNotSet',[]);else invalid('De takenfilter bevat een onbekende waarde.');}
  else if(field==='corporateProjectInfo.hasUserComment'){const value=scalar(entries);if(value==='Ja')filters[field]=typed('boolean',true);else if(value==='Nee')filters[field]=typed('multiValueOrNotSet',[]);else invalid('De opmerkingenfilter bevat een onbekende waarde.');}
  else invalid('Deze projectfilter wordt nog niet ondersteund. Er is geen aanvraag verzonden.');
 }
 const sortId=settings['projects[sort][id]'],sortOrder=settings['projects[sort][order]'];if(!!sortId!==!!sortOrder)invalid('De filterlink bevat geen volledige sortering.');
 return{filters,...settings['projects[query]']&&{searchTerm:settings['projects[query]']},sort:sortId?{[sortId]:sortOrder}:{lastPublishedAt:'desc'},filterByUserFavorites:settings['projects[filterByUserFavorites]']==='true'};
}

export function buildProjectSearchPayload({filterParameters,pageNumber=0,amountPerPage=20}={}){
 if(!Number.isInteger(pageNumber)||pageNumber<0||pageNumber>1000000||!Number.isInteger(amountPerPage)||amountPerPage<1||amountPerPage>100)invalid('Gebruik een geldige pagina en 1 tot 100 projecten per aanvraag.');
 const translated=translateFilterParameters(filterParameters);return{amountPerPage,pageNumber,...translated,resultFields:[...new Set([...PROJECT_RESULT_FIELDS,...Object.keys(translated.filters).filter(field=>DATE_FIELDS.has(field))])],excludeHiddenProjects:true,filterByHiddenProjects:false};
}

function checkCoreSelection(project,payload){
 const phases=payload.filters.constructionPhase?.value;if(phases&&(!phases.includes(project.constructionPhase)))throw new BouwberichtenApiError('De bronresultaten passen niet bij de ingestelde fasefilter. De import is gestopt.',{code:'FILTER_MISMATCH'});
 for(const field of DATE_FIELDS){const range=payload.filters[field]?.value;if(!range)continue;const time=Date.parse(project[field]);if(!Number.isFinite(time)||range.start&&time<Date.parse(range.start)||range.end&&time>Date.parse(range.end))throw new BouwberichtenApiError('De bronresultaten passen niet bij de ingestelde datumfilter. De import is gestopt.',{code:'FILTER_MISMATCH'});}
}
async function responseJson(response,maxBytes){
 const contentType=response.headers?.get('content-type')??'';if(!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType))throw new BouwberichtenApiError('De bron geeft geen JSON terug. Controleer de bronaanmelding.',{code:'INVALID_RESPONSE'});
 const length=Number(response.headers?.get('content-length'));if(Number.isFinite(length)&&length>maxBytes)throw new BouwberichtenApiError('Het bronantwoord is te groot.',{code:'INVALID_RESPONSE'});
 const reader=response.body?.getReader();if(!reader)throw new BouwberichtenApiError('Het bronantwoord is leeg.',{code:'INVALID_RESPONSE'});const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new BouwberichtenApiError('Het bronantwoord is te groot.',{code:'INVALID_RESPONSE'});}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new BouwberichtenApiError('De bron gaf een ongeldig JSON-antwoord.',{code:'INVALID_RESPONSE'});}
}

export function createBouwberichtenApi({fetchImpl=globalThis.fetch,authorizedRequest,signal:defaultSignal,timeoutMs=30000,maxResponseBytes=5*1024*1024}={}){
 const transport=authorizedRequest??fetchImpl;if(typeof transport!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>20*1024*1024)invalid('De API-client is onjuist ingesteld.');
 async function request(path,{method='GET',payload,signal}={}){
  const signals=[defaultSignal,signal].filter(Boolean),timeoutSignal=AbortSignal.timeout(timeoutMs),combined=AbortSignal.any([...signals,timeoutSignal]);let response;
  if(combined.aborted)throw new BouwberichtenApiError('De bronaanvraag is gestopt.',{code:'ABORTED'});
  try{response=await transport(API_BASE_URL+path,{method,headers:{Accept:'application/json',...payload&&{'Content-Type':'application/json'}},...payload&&{body:JSON.stringify(payload)},redirect:'error',signal:combined});}catch{throw new BouwberichtenApiError(signals.some(item=>item.aborted)?'De bronaanvraag is gestopt.':timeoutSignal.aborted?'De bronaanvraag duurde te lang.':'De bron is tijdelijk niet bereikbaar.',{code:signals.some(item=>item.aborted)?'ABORTED':timeoutSignal.aborted?'TIMEOUT':'TRANSPORT_ERROR'});}
  if(!response||!Number.isInteger(response.status))throw new BouwberichtenApiError('De bron gaf een ongeldig antwoord.',{code:'INVALID_RESPONSE'});
  if(response.status<200||response.status>=300){const retryValue=response.headers?.get('retry-after'),retryAfter=retryValue&&/^\d+$/.test(retryValue)?Math.min(Number(retryValue),3600):null;throw new BouwberichtenApiError(response.status===401?'Meld de Bouwberichten-bron opnieuw aan.':response.status===403?'De bronaanmelding heeft geen toegang tot deze gegevens.':response.status===429?'De bron vraagt om later opnieuw te proberen.':'De bronaanvraag is mislukt.',{code:response.status===401?'AUTH_REQUIRED':response.status===403?'ACCESS_DENIED':response.status===429?'RATE_LIMIT':'HTTP_ERROR',status:response.status,retryAfter});}
  if(response.redirected)throw new BouwberichtenApiError('De bron heeft de aanvraag doorgestuurd. Controleer de bronaanmelding.',{code:'INVALID_RESPONSE'});
  try{return await responseJson(response,maxResponseBytes);}catch(error){if(error instanceof BouwberichtenApiError)throw error;throw new BouwberichtenApiError('Het bronantwoord kon niet worden gelezen.',{code:combined.aborted?'ABORTED':'INVALID_RESPONSE'});}
 }
 return{
  async listProjects({filterParameters,pageNumber=0,amountPerPage=20,signal}={}){const payload=buildProjectSearchPayload({filterParameters,pageNumber,amountPerPage}),data=await request('/projects',{method:'POST',payload,signal});if(!object(data)||!Array.isArray(data.projects)||!Number.isSafeInteger(data.total)||data.total<0||data.projects.length>amountPerPage||data.projects.length>data.total)throw new BouwberichtenApiError('De projectlijst heeft een onbekend formaat.',{code:'INVALID_RESPONSE'});const ids=new Set();for(const project of data.projects){if(!object(project))throw new BouwberichtenApiError('De projectlijst bevat een ongeldig project.',{code:'INVALID_RESPONSE'});let id;try{id=projectId(project.id);}catch{throw new BouwberichtenApiError('De projectlijst bevat een ongeldig projectnummer.',{code:'INVALID_RESPONSE'});}if(ids.has(id))throw new BouwberichtenApiError('De projectlijst bevat dubbele projectnummers.',{code:'INVALID_RESPONSE',reason:'duplicate_project'});ids.add(id);checkCoreSelection(project,payload);}return{projects:data.projects,total:data.total};},
  async getProject(id,{signal}={}){const normalized=projectId(id),data=await request('/projects?projectId='+encodeURIComponent(normalized),{signal});if(!object(data)||String(data.id)!==normalized)throw new BouwberichtenApiError('Het projectdetail heeft een onbekend formaat of projectnummer.',{code:'INVALID_RESPONSE'});return data;},
  async getOrganisations(ids,{signal}={}){if(!Array.isArray(ids)||ids.length>1000)invalid('Vraag maximaal 1000 betrokken organisaties tegelijk op.');const normalized=[...new Set(ids.map(projectId))];if(!normalized.length)return[];const numeric=normalized.map(id=>integer(id,{minimum:1})),data=await request('/organisations',{method:'POST',payload:{amountPerPage:1000,pageNumber:0,filters:{id:typed('multiValue',numeric)},filterByUserFavorites:false},signal});if(!object(data)||!Array.isArray(data.organisations)||data.organisations.length>normalized.length)throw new BouwberichtenApiError('De organisatielijst heeft een onbekend formaat.',{code:'INVALID_RESPONSE'});const wanted=new Set(normalized),seen=new Set();for(const organisation of data.organisations){if(!object(organisation)||!wanted.has(String(organisation.id))||seen.has(String(organisation.id)))throw new BouwberichtenApiError('De bron gaf andere organisaties terug dan gevraagd.',{code:'INVALID_RESPONSE'});seen.add(String(organisation.id));}return data.organisations;}
 };
}

function plain(value,max){
 if(typeof value!=='string')return'';
 const text=value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:br\s*\/?|\/p|\/div|\/li)\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&(?:#(x[0-9a-f]+|\d+)|([a-z]+));/gi,(entity,numeric,named)=>{if(numeric){const code=Number.parseInt(numeric.replace(/^x/i,''),/^x/i.test(numeric)?16:10);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'';}return({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[named.toLowerCase()]??entity;}).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
 const clipped=text.slice(0,max);return /[\ud800-\udbff]$/.test(clipped)?clipped.slice(0,-1):clipped;
}
const euro=value=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(value);
function unambiguousInvolvement(matches){
 if(!matches.length||new Set(matches.map(item=>String(item.organisationId))).size!==1)return undefined;
 const first=matches[0],sameContact=first.contactId!=null&&matches.every(item=>String(item.contactId)===String(first.contactId));return{...first,contactId:sameContact?first.contactId:undefined};
}
function matchingInvolvement(project,{organisationId,preferredRoles=[]}){
 const involvements=Array.isArray(project.involvements)?project.involvements.filter(object):[];
 if(organisationId!==undefined)return unambiguousInvolvement(involvements.filter(item=>String(item.organisationId)===String(organisationId)));
 for(const role of preferredRoles){const match=unambiguousInvolvement(involvements.filter(item=>item.organisationId!=null&&typeof item.role==='string'&&item.role.toLowerCase()===String(role).toLowerCase()));if(match)return match;}
 return unambiguousInvolvement(involvements.filter(item=>item.organisationId!=null));
}

function website(value){
 const address=plain(value,2000);if(!address)return'';
 try{const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(address)?address:'https://'+address);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.hostname.includes('.')?url.href:'';}catch{return'';}
}
const sourceDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',dateStyle:'short'}).format(new Date(value)):'';

function partyDetails(involvement,organisation){
 const party={name:plain(organisation?.name??involvement.organisationName,120),role:plain(involvement.role,100)};
 const phone=typeof organisation?.phoneNumber==='string'?organisation.phoneNumber.trim().replace(/\s+/g,' '):'';
 const email=typeof organisation?.email==='string'?organisation.email.trim().toLowerCase():'';
 if(/^[+\d ()-]{6,30}$/.test(phone))party.phone=phone;
 if(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))party.email=email;
 const url=website(organisation?.website??organisation?.websiteUrl);if(url)party.website=url;
 return party;
}

function projectDetails(project,item,involvement,organisation,organisations){
 const address=project.address??{},layers=project.buildingLayers;
 const layerCount=Number.isFinite(layers)?String(layers):[layers?.min,layers?.max].filter(Number.isFinite).filter((value,index,values)=>values.indexOf(value)===index).join('–');
 const parties=[];
 for(const entry of Array.isArray(project.involvements)?project.involvements.filter(object):[]){
  if(involvement&&String(entry.organisationId)===String(involvement.organisationId))continue;
  const party=partyDetails(entry,organisations.find(record=>String(record?.id)===String(entry.organisationId)));
  if(party.name&&!parties.some(row=>row.name===party.name&&row.role===party.role))parties.push(party);
 }
 const selected=involvement?partyDetails(involvement,organisation):{};
 return {
  scheduleStart:sourceDate(project.startedAt),scheduleEnd:sourceDate(project.deliveredAt),
  plan:plain(project.planName??(typeof project.plan==='string'?project.plan:project.plan?.name),150),
  subplan:plain(project.subPlanName??project.subPlan??project.subplan??project.plan?.subPlan,150),
  address:[plain(address.street??address.streetName,120),plain(address.zipCode,20),plain(address.city,100)].filter(Boolean).join(', '),
  scope:item.description?.match(/\b\d{1,4}\s+woningen\b/i)?.[0]??'',
  surface:Number.isFinite(project.surface)&&project.surface>0?new Intl.NumberFormat('nl-NL').format(project.surface)+' m²':'',
  layers:layerCount,website:website(project.projectWebsite??project.website),
  sustainability:Array.isArray(project.sustainableProperties)?project.sustainableProperties.map(value=>plain(value,100)).filter(Boolean).slice(0,8).join(', '):'',
  primaryRole:selected.role??'',primaryWebsite:selected.website??'',parties:parties.slice(0,16)
 };
}

export function mapProjectToLead(project,{organisations=[],organisationId,preferredRoles=[],includeDetails=false}={}){
 if(!object(project)||!Array.isArray(organisations)||!Array.isArray(preferredRoles))invalid('Het project of de organisatiekeuze is ongeldig.');const externalId=projectId(project.id),title=plain(project.name,150).replace(/\s+/g,' ');if(!title)invalid('Het bronproject heeft geen projectnaam.');
 const item={externalId,title,sourceUrl:'https://portal.bouwberichten.nl/projecten/'+externalId};
 for(const [field,value,max]of [['city',project.address?.city,100],['description',project.description,3000],['phase',project.constructionPhase,120]]){const normalized=plain(value,max);if(normalized)item[field]=normalized;}
 const time=[project.updatedAt,project.lastPublishedAt].find(value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value)));if(time)item.sourceUpdatedAt=new Date(time).toISOString();
 const amount=value=>Number.isFinite(value)&&value>0&&value<=Number.MAX_SAFE_INTEGER;
 if(amount(project.estimatedAmountValue))item.budget=euro(project.estimatedAmountValue);else if(object(project.estimateRange)){const min=project.estimateRange.min,max=project.estimateRange.max;if(amount(min)&&amount(max)&&max>=min)item.budget=euro(min)+' – '+euro(max);else if(amount(min))item.budget='Vanaf '+euro(min);else if(amount(max))item.budget='Tot '+euro(max);}
 const involvement=matchingInvolvement(project,{organisationId,preferredRoles}),organisation=involvement&&organisations.find(record=>object(record)&&String(record.id)===String(involvement.organisationId));
 const organization=plain(organisation?.name??involvement?.organisationName,120);if(organization)item.organization=organization;
 if(organisation){const phone=typeof organisation.phoneNumber==='string'?organisation.phoneNumber.trim().replace(/\s+/g,' '):'',email=typeof organisation.email==='string'?organisation.email.trim().toLowerCase():'';if(/^[+\d ()-]{6,30}$/.test(phone))item.phone=phone;if(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))item.email=email;const contact=Array.isArray(organisation.contacts)?organisation.contacts.find(record=>object(record)&&involvement.contactId!=null&&String(record.id)===String(involvement.contactId)):undefined;if(contact){const name=[contact.initials,contact.firstName,contact.middleName,contact.lastName].filter(value=>typeof value==='string'&&value.trim()).join(' ');if(name)item.contact=plain(name,100);}}
 if(includeDetails){
  item.projectDetails=projectDetails(project,item,involvement,organisation,organisations);
  // A single source contact replaces earlier imported contact fields together.
  if(organisation&&item.projectDetails.primaryRole.toLowerCase()==='hoofdaannemer')for(const key of ['phone','email','contact'])item[key]??='';
 }
 return item;
}

export function enrichLeadWithPresentation(lead,presentation){
 if(!presentation)return;
 if(presentation.projectImage)lead.projectImage=presentation.projectImage;
 const details=lead.projectDetails;
 if(!details)return;
 const info=presentation.info??{};
 for(const [key,label,max] of [['plan','Plan',150],['subplan','Deelplan',150],['surface','Oppervlakte',120],['layers','Bouwlagen van - t/m',40],['sustainability','Duurzame eigenschappen',850]]){
  details[key]||=plain(info[label],max);
 }
 for(const [key,label] of [['scheduleStart','Start'],['scheduleEnd','Oplevering']]){
  const match=/^(\d{2})-(\d{2})-(\d{4})$/.exec(info[label]??'');if(!match||details[key])continue;
  const date=`${match[3]}-${match[2]}-${match[1]}`;
  if(Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)details[key]=date;
 }
 details.website||=website(info['Project website']);
 const card=presentation.mainContractor,name=plain(card?.name,120);
 if(!name||details.primaryRole.toLowerCase()==='hoofdaannemer'&&lead.organization?.toLowerCase()!==name.toLowerCase())return;
 if(details.primaryRole.toLowerCase()!=='hoofdaannemer'){
  Object.assign(lead,{organization:name,phone:'',email:'',contact:''});
  details.primaryRole='Hoofdaannemer';details.primaryWebsite='';
 }
 const phone=plain(card.phone,30),email=plain(card.email,254).toLowerCase();
 if(!lead.phone&&/^[+\d ()-]{6,30}$/.test(phone))lead.phone=phone;
 if(!lead.email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))lead.email=email;
 details.primaryWebsite||=website(card.website);
 details.parties=details.parties.filter(party=>party.name.toLowerCase()!==name.toLowerCase());
}
