import test from 'node:test';
import assert from 'node:assert/strict';
import {API_BASE_URL,BouwberichtenApiError,buildProjectSearchPayload,createBouwberichtenApi,mapProjectToLead,translateFilterParameters} from '../scraper/bouwberichten-api.mjs';

const filters=[['projects[filters][lastPublishedAt][start]','2025-12-31T23:00:00.000Z'],['projects[filters][constructionPhase][]','Gegund']];
const query=[['projects[query]','renovatie']];
const row=(id=565200,overrides={})=>({id,name:'Renovatie zorggebouw',constructionPhase:'Gegund',lastPublishedAt:'2026-02-01T11:00:00Z',...overrides});

test('explicit publication/phase filters become the portal typed search body; saved-search/page metadata never replace the selection',()=>{
 const parameters=[...filters,['projects[savedSearch]','18163'],['projects[page]','7'],['projects[sort][id]','lastPublishedAt'],['projects[sort][order]','desc']];
 const payload=buildProjectSearchPayload({filterParameters:parameters,pageNumber:0,amountPerPage:20});
 assert.deepEqual(payload.filters,{constructionPhase:{_type:'multiValue',value:['Gegund']},lastPublishedAt:{_type:'dateRange',value:{start:'2025-12-31T23:00:00.000Z'}}});
 assert.equal(payload.pageNumber,0);assert.equal(payload.amountPerPage,20);assert.deepEqual(payload.sort,{lastPublishedAt:'desc'});
 assert.equal(payload.excludeHiddenProjects,true);assert.equal(payload.filterByHiddenProjects,false);assert.equal(payload.filterByUserFavorites,false);
 assert(payload.resultFields.includes('id'));assert(payload.resultFields.includes('lastPublishedAt'));assert(!JSON.stringify(payload).includes('18163'));
 assert(!payload.resultFields.some(value=>value.startsWith('corporateProjectInfo')));
});

test('portal range, geolocation, boolean, organisation, and unset filters retain their documented types',()=>{
 const parameters=[['projects[filters][constructionPhase][]','Gegund'],['projects[filters][constructionPhase][]','Uitvoering'],['projects[filters][score][min]','0'],['projects[filters][score][max]','100'],['projects[filters][address.city]','Utrecht'],['projects[filters][address.distance]','25'],['projects[filters][active][]','Actief'],['projects[filters][involvements.organisationId][]','42'],['projects[filters][corporateProjectInfo.assignedToId][]','none'],['projects[filterByUserFavorites]','true'],['projects[query]','school']];
 const result=translateFilterParameters(parameters);
 assert.deepEqual(result.filters.constructionPhase,{_type:'multiValue',value:['Gegund','Uitvoering']});
 assert.deepEqual(result.filters.score,{_type:'range',value:{max:100,min:0}});
 assert.deepEqual(result.filters.address,{_type:'geoLocation',value:{city:'Utrecht',distance:25}});
 assert.deepEqual(result.filters.active,{_type:'boolean',value:true});
 assert.deepEqual(result.filters['involvements.organisationId'],{_type:'multiFilter',value:['42']});
 assert.deepEqual(result.filters['corporateProjectInfo.assignedToId'],{_type:'multiValueOrNotSet',value:[]});
 assert.equal(result.searchTerm,'school');assert.equal(result.filterByUserFavorites,true);
});

test('unknown, ambiguous, unsafe, invalid-range and saved-search-only filters stop before transport',async()=>{
 const client=createBouwberichtenApi({fetchImpl:()=>assert.fail('Invalid filters must not send an API request')});
 for(const parameters of [
  [['projects[savedSearch]','18163']],
  [['projects[filters][unknownFutureFilter]','selected']],
  [['projects[filters][__proto__][polluted]','yes']],
  [['projects[filters][accessToken]','private']],
  [['projects[filters][active][]','Actief'],['projects[filters][active][]','Niet actief']],
  [['projects[filters][surface][min]','1.2']],
  [['projects[filters][surface][min]','20'],['projects[filters][surface][max]','10']],
  [['projects[filters][lastPublishedAt][start]','2026-02-30T00:00:00Z']],
  [...query,['projects[sort][id]','lastPublishedAt']]
 ])await assert.rejects(()=>client.listProjects({filterParameters:parameters}),BouwberichtenApiError);
 assert.throws(()=>buildProjectSearchPayload({filterParameters:filters,pageNumber:-1}));
 assert.throws(()=>buildProjectSearchPayload({filterParameters:filters,amountPerPage:101}));
 assert.equal(Object.prototype.polluted,undefined);
});

test('API transport uses exact public v1 paths, zero-based pages, separate detail and organisation requests, without implicit source credentials',async()=>{
 const requests=[];
 const client=createBouwberichtenApi({authorizedRequest:async(url,init)=>{requests.push({url,init});if(url.endsWith('/organisations'))return Response.json({organisations:[{id:42,name:'Opdrachtgever'}]});if(init.method==='GET')return Response.json(row());return Response.json({projects:[row()],total:21});}});
 assert.deepEqual(await client.listProjects({filterParameters:filters,pageNumber:1,amountPerPage:20}),{projects:[row()],total:21});
 assert.equal((await client.getProject('565200')).id,565200);
 assert.deepEqual(await client.getOrganisations([42,'42']),[{id:42,name:'Opdrachtgever'}]);
 assert.deepEqual(await client.getOrganisations([]),[]);assert.equal(requests.length,3);
 assert.equal(requests[0].url,API_BASE_URL+'/projects');assert.equal(JSON.parse(requests[0].init.body).pageNumber,1);
 assert.equal(requests[1].url,API_BASE_URL+'/projects?projectId=565200');assert.equal(requests[1].init.method,'GET');assert.equal(requests[1].init.body,undefined);
 assert.equal(requests[2].url,API_BASE_URL+'/organisations');
 assert.deepEqual(JSON.parse(requests[2].init.body),{amountPerPage:1000,pageNumber:0,filters:{id:{_type:'multiValue',value:[42]}},filterByUserFavorites:false});
 for(const request of requests){assert.equal(request.init.redirect,'error');assert(request.init.signal instanceof AbortSignal);assert.equal(request.init.headers.Authorization,undefined);assert.equal(request.init.headers.Cookie,undefined);}
});

test('mismatching filters, wrong identities, duplicate rows and unknown envelopes never look like a successful extraction',async()=>{
 for(const project of [row(565200,{constructionPhase:'Ontwerp'}),row(565200,{lastPublishedAt:'2025-12-31T22:59:59.999Z'}),row(565200,{lastPublishedAt:undefined})]){
  const api=createBouwberichtenApi({fetchImpl:async()=>Response.json({projects:[project],total:1})});
  await assert.rejects(()=>api.listProjects({filterParameters:filters}),error=>error.code==='FILTER_MISMATCH');
 }
 for(const data of [{results:[],total:0},{projects:[],total:'0'},{projects:[row(),row()],total:2}]){
  const api=createBouwberichtenApi({fetchImpl:async()=>Response.json(data)});
  await assert.rejects(()=>api.listProjects({filterParameters:query}),error=>error.code==='INVALID_RESPONSE');
 }
 await assert.rejects(()=>createBouwberichtenApi({fetchImpl:async()=>Response.json(row(999))}).getProject(565200),error=>error.code==='INVALID_RESPONSE');
 await assert.rejects(()=>createBouwberichtenApi({fetchImpl:async()=>Response.json({organisations:[{id:999,name:'Ongevraagde organisatie'}]})}).getOrganisations([42]),error=>error.code==='INVALID_RESPONSE');
});

test('auth, throttle, network and non-JSON failures are sanitized without returning tokens, payloads or source error bodies',async()=>{
 const marker='private-auth-marker-never-log';
 for(const [status,code]of [[401,'AUTH_REQUIRED'],[403,'ACCESS_DENIED'],[429,'RATE_LIMIT'],[503,'HTTP_ERROR']]){
  const api=createBouwberichtenApi({fetchImpl:async()=>new Response(marker,{status,headers:{'Retry-After':'12'}})});
  await assert.rejects(()=>api.listProjects({filterParameters:query}),error=>{assert.equal(error.status,status);assert.equal(error.code,code);assert.equal(error.retryAfter,12);assert(!JSON.stringify(error).includes(marker));assert(!error.message.includes(marker));return true;});
 }
 await assert.rejects(()=>createBouwberichtenApi({authorizedRequest:async()=>{throw new Error(marker);}}).getProject(565200),error=>error.code==='TRANSPORT_ERROR'&&!error.message.includes(marker)&&error.cause===undefined);
 await assert.rejects(()=>createBouwberichtenApi({fetchImpl:async()=>new Response('<html>'+marker+'</html>',{headers:{'Content-Type':'text/html'}})}).getProject(565200),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes(marker));
 await assert.rejects(()=>createBouwberichtenApi({fetchImpl:async()=>new Response(marker,{headers:{'Content-Type':'application/json'}})}).getProject(565200),error=>error.code==='INVALID_RESPONSE'&&!error.message.includes(marker));
});

test('response size limits, UTF-8 chunk boundaries and caller cancellation are enforced',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>createBouwberichtenApi({signal:controller.signal,fetchImpl:()=>assert.fail('An aborted request must not send')}).getProject(565200),error=>error.code==='ABORTED');
 const bytes=Buffer.from(JSON.stringify(row(565200,{name:'Café aan de kade'}))),split=bytes.indexOf(Buffer.from('é'))+1;
 const api=createBouwberichtenApi({fetchImpl:async()=>new Response(new ReadableStream({start(stream){stream.enqueue(bytes.subarray(0,split));stream.enqueue(bytes.subarray(split));stream.close();}}),{headers:{'Content-Type':'application/json'}})});
 assert.equal((await api.getProject(565200)).name,'Café aan de kade');
 await assert.rejects(()=>createBouwberichtenApi({maxResponseBytes:50,fetchImpl:async()=>Response.json(row())}).getProject(565200),error=>error.code==='INVALID_RESPONSE');
});

test('project mapper emits stable provenance, safe text, EUR budget and matched contact fields, excluding portal workflow and untrusted source membership',()=>{
 const project={...row(),name:'<b>Renovatie &amp; uitbreiding</b>',description:'<p>Eerste regel.</p><script>privateScript()</script><p>Tweede<br>regel &#8364;.</p>',address:{city:'Utrecht'},updatedAt:'2026-02-02T13:00:00+01:00',estimatedAmountValue:1250000,involvements:[{organisationId:42,organisationName:'Bronnaam',contactId:7,role:'Opdrachtgever'}],corporateProjectInfo:{assignedToId:123},sourceIds:['forged-source'],notes:['Niet importeren']};
 const organisations=[{id:42,name:'Vastgoed Voorbeeld',phoneNumber:'+31\u00a020 1234567',email:' Contact@Example.test ',contacts:[{id:8,firstName:'Andere contactpersoon'},{id:7,initials:'A.',firstName:'Anna',middleName:'de',lastName:'Vries'}]}];
 const item=mapProjectToLead(project,{organisations});
 assert.equal(item.externalId,'565200');assert.equal(item.sourceUrl,'https://portal.bouwberichten.nl/projecten/565200');assert.equal(item.title,'Renovatie & uitbreiding');
 assert.equal(item.city,'Utrecht');assert.equal(item.phase,'Gegund');assert.equal(item.sourceUpdatedAt,'2026-02-02T12:00:00.000Z');
 assert(item.budget.includes('€'));assert(item.budget.includes('1.250.000'));
 assert.equal(item.organization,'Vastgoed Voorbeeld');assert.equal(item.phone,'+31 20 1234567');assert.equal(item.email,'contact@example.test');assert.equal(item.contact,'A. Anna de Vries');
 assert(!item.description.includes('privateScript'));assert(!item.description.includes('<p>'));assert(item.description.includes('€'));
 for(const key of ['corporateProjectInfo','sourceIds','ownerId','notes','status'])assert.equal(Object.hasOwn(item,key),false);
});

test('mapper keeps unavailable fields absent, never guesses among organisations or truncates contact addresses into invented values',()=>{
 const project={...row(),involvements:[{organisationId:1,organisationName:'Organisatie Een',contactId:1,role:'Opdrachtgever'},{organisationId:2,organisationName:'Organisatie Twee',contactId:2,role:'Aannemer'}]};
 const organisations=[{id:1,name:'Organisatie Een',phoneNumber:'0'.repeat(31),email:'x'.repeat(260)+'@example.test',contacts:[{id:1,firstName:'Een'}]},{id:2,name:'Organisatie Twee',phoneNumber:'020-1234567',email:'twee@example.test',contacts:[{id:2,firstName:'Twee'}]}];
 const ambiguous=mapProjectToLead(project,{organisations});for(const key of ['organization','phone','email','contact'])assert.equal(Object.hasOwn(ambiguous,key),false);
 const explicit=mapProjectToLead(project,{organisations,organisationId:2});assert.equal(explicit.organization,'Organisatie Twee');assert.equal(explicit.contact,'Twee');
 assert.equal(mapProjectToLead(project,{organisations,preferredRoles:['Aannemer']}).organization,'Organisatie Twee');
 const first=mapProjectToLead(project,{organisations,organisationId:1});assert.equal(first.organization,'Organisatie Een');assert.equal(first.phone,undefined);assert.equal(first.email,undefined);
 const oneOrgTwoContacts={...row(),involvements:[{organisationId:2,contactId:2,role:'Opdrachtgever'},{organisationId:2,contactId:3,role:'Aannemer'}]};
 assert.equal(mapProjectToLead(oneOrgTwoContacts,{organisations}).contact,undefined);
 const sparse=mapProjectToLead({id:'565201',name:'Zonder contactgegevens',updatedAt:'ongeldig',lastPublishedAt:'2026-02-03T11:00:00Z'});assert.deepEqual(sparse,{externalId:'565201',title:'Zonder contactgegevens',sourceUrl:'https://portal.bouwberichten.nl/projecten/565201',sourceUpdatedAt:'2026-02-03T11:00:00.000Z'});
 assert.throws(()=>mapProjectToLead({id:565200,name:''}));assert.throws(()=>mapProjectToLead({id:'../auth',name:'Geen project'}));
});
