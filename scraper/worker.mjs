import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createBouwberichtenApi,enrichLeadWithPresentation,mapProjectToLead} from './bouwberichten-api.mjs';
import {IMAGE_FAILURE_REASONS,loginBouwberichten,sanitizeAuthDiagnostic} from './bouwberichten-auth.mjs';

export class WorkerError extends Error{
 constructor(code='scrape_error',status=null){super('Het ophalen is onderbroken.');this.name='WorkerError';this.code=code;this.status=status;}
}

export function loadWorkerConfig(env=process.env){
 let url;try{url=new URL(env.DASHBOARD_URL);}catch{throw new Error('DASHBOARD_URL must be an HTTPS origin.');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('DASHBOARD_URL must be an HTTPS origin.');
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.SCRAPER_WORKER_TOKEN??''))throw new Error('SCRAPER_WORKER_TOKEN is missing or invalid.');
 return{dashboardUrl:url.origin,workerToken:env.SCRAPER_WORKER_TOKEN};
}

const wait=(ms,signal,sleepImpl)=>sleepImpl(ms,undefined,{signal});
const retryAfter=response=>{const value=response.headers.get('retry-after');return value&&/^\d+$/.test(value)?Math.min(60000,Number(value)*1000):null;};

export function createBrokerClient({dashboardUrl,workerToken,fetchImpl=fetch,sleepImpl=delay,signal}={}){
 const config=loadWorkerConfig({DASHBOARD_URL:dashboardUrl,SCRAPER_WORKER_TOKEN:workerToken});
 async function post(path,payload,{retry=true}={}){
  for(let attempt=0;attempt<4;attempt++){
   signal?.throwIfAborted();let response;
   try{response=await fetchImpl(config.dashboardUrl+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+config.workerToken},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(45000)].filter(Boolean))});}
   catch{if(!retry||attempt===3)throw new WorkerError();await wait(1000*2**attempt,signal,sleepImpl);continue;}
   if((response.status===429||retry&&[502,503,504].includes(response.status))&&attempt<3){await response.body?.cancel();await wait(retryAfter(response)??1000*2**attempt,signal,sleepImpl);continue;}
   if(!response.ok){await response.body?.cancel();throw new WorkerError('scrape_error',response.status);}
   const length=Number(response.headers.get('content-length'));if(length>128*1024)throw new WorkerError();
   const text=await response.text();if(Buffer.byteLength(text)>128*1024)throw new WorkerError();
   try{return JSON.parse(text);}catch{throw new WorkerError();}
  }
 }
 const jobPath=id=>'/api/scraper/jobs/'+encodeURIComponent(id);
 return{
  async claim(){const result=await post('/api/scraper/claim',{leadWorkbook:true}, {retry:false});if(!result||!Object.hasOwn(result,'job'))throw new WorkerError();return result.job;},
  progress:(job,payload)=>post(jobPath(job.id)+'/progress',{leaseToken:job.leaseToken,...payload}),
  batch:(job,batch,items)=>post(jobPath(job.id)+'/batch',{leaseToken:job.leaseToken,batch,items}),
  finish:(job,payload)=>post(jobPath(job.id)+'/finish',{leaseToken:job.leaseToken,...payload}),
  fail:(job,code)=>post(jobPath(job.id)+'/fail',{leaseToken:job.leaseToken,code})
 };
}

// Serial requests are intentionally paced. A 429 retries the exact request;
// authentication/validation failures are surfaced instead of retried blindly.
export function createPacedRequest(request,{signal,sleepImpl=delay,now=Date.now,intervalMs=1000}={}){
 let next=0;
 return async(input,init={})=>{
  for(let attempt=0;attempt<5;attempt++){
   const combined=AbortSignal.any([signal,init.signal].filter(Boolean));combined.throwIfAborted();
   if(next>now())await wait(next-now(),combined,sleepImpl);next=now()+intervalMs;
   const response=await request(input,{...init,signal:combined});
   if(response.status!==429||attempt===4)return response;
   await response.body?.cancel();await wait(retryAfter(response)??Math.min(60000,2000*2**attempt),combined,sleepImpl);
  }
 };
}

function validateJob(job){
 if(!job||typeof job.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(job.id)||typeof job.leaseToken!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(job.leaseToken)||!['test','full'].includes(job.mode)||job.limit!==(job.mode==='test'?5:5000)||!Array.isArray(job.filterParameters)||typeof job.filterUrl!=='string'||typeof job.username!=='string'||typeof job.password!=='string')throw new WorkerError('source_error');
}
const classify=error=>error?.code==='login_required'||['AUTH_REQUIRED','ACCESS_DENIED'].includes(error?.code)?'login_required':['source_error','INVALID_INPUT','FILTER_MISMATCH','INVALID_RESPONSE'].includes(error?.code)?'source_error':'scrape_error';
const MAX_BATCH_ITEMS_BYTES=950*1024;

export async function runJob(job,{broker,signal,authenticate=loginBouwberichten,createApi=createBouwberichtenApi,mapLead=mapProjectToLead,sleepImpl=delay,jobTimeoutMs=(job?.mode==='full'?4:1)*60*60*1000}={}){
 let session;const timeout=AbortSignal.timeout(jobTimeoutMs),combined=AbortSignal.any([signal,timeout].filter(Boolean));
 try{
  validateJob(job);combined.throwIfAborted();
  session=await authenticate({username:job.username,password:job.password,filterUrl:job.filterUrl,signal:combined});
  const api=createApi({authorizedRequest:createPacedRequest(session.authorizedRequest,{signal:combined,sleepImpl}),signal:combined});
  let processed=0,batch=0,pageNumber=0,total=null;const seen=new Set(),organisationCache=new Map(),amountPerPage=20;
  const workbookCounts={contractorsWithPhone:0,images:0,imageFailures:{}};
  while(total===null||processed<Math.min(total,job.limit)){
   combined.throwIfAborted();const listing=await api.listProjects({filterParameters:job.filterParameters,pageNumber,amountPerPage,signal:combined});
   if(total===null)total=listing.total;
   if(job.mode==='full'&&total>job.limit)throw new WorkerError('source_error');
   // Stable totals and unique identities prevent silently skipping projects on changing pages.
   if(listing.total!==total||!listing.projects.length&&processed<Math.min(total,job.limit))throw new WorkerError('source_error');
   await broker.progress(job,{processed,total});let items=[],itemBytes=0;
   async function flush(){
    if(!items.length)return;
    await broker.batch(job,batch++,items);processed+=items.length;items=[];itemBytes=0;
   }
   for(const summary of listing.projects){
    if(processed+items.length>=Math.min(total,job.limit))break;
    const identity=String(summary.id);if(seen.has(identity))throw new WorkerError('source_error');seen.add(identity);
    const project=await api.getProject(summary.id,{signal:combined});
    const ids=[...new Set((Array.isArray(project.involvements)?project.involvements:[]).map(item=>item?.organisationId).filter(id=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^\d{1,16}$/.test(id)&&Number(id)>0).map(String))];
    const missing=ids.filter(id=>!organisationCache.has(id));
    if(missing.length){const organisations=await api.getOrganisations(missing,{signal:combined});for(const id of missing)organisationCache.set(id,null);for(const organisation of organisations)organisationCache.set(String(organisation.id),organisation);}
    const lead=mapLead(project,{organisations:ids.map(id=>organisationCache.get(id)).filter(Boolean),preferredRoles:['Hoofdaannemer'],includeDetails:true});
    const presentation=await session.projectPresentation?.(identity,project.name,{hasImage:Array.isArray(project.images)?project.images.length>0:undefined});
    enrichLeadWithPresentation(lead,presentation);
    if(lead.projectDetails?.primaryRole?.toLowerCase()==='hoofdaannemer'&&lead.phone)workbookCounts.contractorsWithPhone++;
    if(lead.projectImage)workbookCounts.images++;
    else if(session.projectPresentation){const reason=IMAGE_FAILURE_REASONS.includes(presentation?.imageStatus)?presentation.imageStatus:'capture_failed';workbookCounts.imageFailures[reason]=(workbookCounts.imageFailures[reason]??0)+1;}
    const bytes=Buffer.byteLength(JSON.stringify(lead))+1;
    if(items.length&&itemBytes+bytes>MAX_BATCH_ITEMS_BYTES)await flush();
    items.push(lead);itemBytes+=bytes;
   }
   await flush();
   await broker.progress(job,{processed,total});pageNumber++;
  }
  if(!processed)throw new WorkerError('source_error');
  await broker.finish(job,{processed,total});return{processed,total,...session.projectPresentation&&{workbookCounts}};
 }catch(error){const code=classify(error),diagnostic=code==='login_required'?sanitizeAuthDiagnostic(error?.diagnostic):undefined;await broker.fail(job,code).catch(()=>{});return{failed:true,code,...diagnostic&&{diagnostic}};}
 finally{await session?.close().catch(()=>{});}
}

export async function runWorker({config=loadWorkerConfig(),signal,fetchImpl=fetch,sleepImpl=delay,run=runJob,logger=console}={}){
 const broker=createBrokerClient({...config,signal,fetchImpl,sleepImpl});logger.info('Scrapingworker gestart.');
 while(!signal?.aborted){
  try{const job=await broker.claim();if(job){const result=await run(job,{broker,signal,sleepImpl}),diagnostic=result.failed?sanitizeAuthDiagnostic(result.diagnostic):undefined;
   const counts=result.workbookCounts;
   const imageFailures=counts&&Object.fromEntries(IMAGE_FAILURE_REASONS.filter(key=>Number.isSafeInteger(counts.imageFailures?.[key])&&counts.imageFailures[key]>0&&counts.imageFailures[key]<=result.processed).map(key=>[key,counts.imageFailures[key]]));
   const workbookCounts=counts&&{...Object.fromEntries(['contractorsWithPhone','images'].filter(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0&&counts[key]<=result.processed).map(key=>[key,counts[key]])),...imageFailures&&Object.keys(imageFailures).length&&{imageFailures}};
   logger.info(JSON.stringify({event:result.failed?'job_failed':'job_finished',...result.failed?{code:['login_required','source_error','scrape_error'].includes(result.code)?result.code:'scrape_error',...diagnostic&&{diagnostic}}:{processed:result.processed,total:result.total,...workbookCounts&&{workbookCounts}}}));continue;}}
  catch(error){if(signal?.aborted)break;logger.error(JSON.stringify({event:'broker_unavailable',status:error?.status??null}));}
  try{await wait(15000,signal,sleepImpl);}catch{break;}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController();for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>controller.abort());
 runWorker({signal:controller.signal}).catch(()=>{console.error('De scrapingworker kon niet starten. Controleer de service-instellingen.');process.exitCode=1;});
}
