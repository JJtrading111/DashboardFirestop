import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createBouwberichtenApi,enrichLeadWithPresentation,mapProjectToLead} from './bouwberichten-api.mjs';
import {IMAGE_FAILURE_REASONS,loginBouwberichten,sanitizeAuthDiagnostic} from './bouwberichten-auth.mjs';

export const FAILURE_STAGES=Object.freeze(['configuration','login','listing','detail','organisations','presentation','mapping','progress','import','finish','unknown']);
export const FAILURE_REASONS=Object.freeze(['invalid_job','total_changed','duplicate_project','empty_page','empty_selection','selection_limit','filter_mismatch','invalid_input','invalid_response','http_401','http_403','http_429','http_5xx','http_error','request_timeout','network_error','job_timeout','worker_cancelled','lease_lost','login_required','unexpected_error']);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000000;
const httpStatus=value=>Number.isInteger(value)&&value>=100&&value<=599;
export function sanitizeFailureDiagnostic(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const result={stage:FAILURE_STAGES.includes(value.stage)?value.stage:'unknown',reason:FAILURE_REASONS.includes(value.reason)?value.reason:'unexpected_error'};
 if(httpStatus(value.status))result.status=value.status;
 for(const key of ['processed','expectedTotal','observedTotal'])if(count(value[key]))result[key]=value[key];
 const auth=sanitizeAuthDiagnostic({stage:value.authStage,reason:value.authReason});
 if(value.authStage!==undefined)result.authStage=auth.stage;if(value.authReason!==undefined)result.authReason=auth.reason;
 return result;
}
const httpReason=status=>status===401?'http_401':status===403?'http_403':status===429?'http_429':status>=500?'http_5xx':'http_error';

export class WorkerError extends Error{
 constructor(code='scrape_error',status=null,reason=null,details={}){super('Het ophalen is onderbroken.');this.name='WorkerError';this.code=code;this.status=status;this.reason=reason;this.failure=details;}
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
 async function post(path,payload,{retry=true,afterCancellation=false}={}){
  const activeSignal=afterCancellation?undefined:signal;
  for(let attempt=0;attempt<4;attempt++){
   activeSignal?.throwIfAborted();let response;const requestTimeout=AbortSignal.timeout(afterCancellation?5000:45000);
   try{response=await fetchImpl(config.dashboardUrl+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+config.workerToken},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.any([activeSignal,requestTimeout].filter(Boolean))});}
   catch(error){if(!retry||attempt===3)throw new WorkerError('scrape_error',null,requestTimeout.aborted||error?.name==='TimeoutError'?'request_timeout':'network_error');await wait(1000*2**attempt,activeSignal,sleepImpl);continue;}
   if(!afterCancellation&&(response.status===429||retry&&[502,503,504].includes(response.status))&&attempt<3){await response.body?.cancel();await wait(retryAfter(response)??1000*2**attempt,activeSignal,sleepImpl);continue;}
   if(!response.ok){await response.body?.cancel();throw new WorkerError('scrape_error',response.status,response.status===409?'lease_lost':httpReason(response.status));}
   const length=Number(response.headers.get('content-length'));if(length>128*1024)throw new WorkerError('scrape_error',null,'invalid_response');
   const text=await response.text();if(Buffer.byteLength(text)>128*1024)throw new WorkerError('scrape_error',null,'invalid_response');
   try{return JSON.parse(text);}catch{throw new WorkerError('scrape_error',null,'invalid_response');}
  }
 }
 const jobPath=id=>'/api/scraper/jobs/'+encodeURIComponent(id);
 return{
  async claim(){const result=await post('/api/scraper/claim',{leadWorkbook:true}, {retry:false});if(!result||!Object.hasOwn(result,'job'))throw new WorkerError('scrape_error',null,'invalid_response');return result.job;},
  progress:(job,payload)=>post(jobPath(job.id)+'/progress',{leaseToken:job.leaseToken,...payload}),
  batch:(job,batch,items)=>post(jobPath(job.id)+'/batch',{leaseToken:job.leaseToken,batch,items}),
  finish:(job,payload)=>post(jobPath(job.id)+'/finish',{leaseToken:job.leaseToken,...payload}),
  fail:(job,code,diagnostic)=>post(jobPath(job.id)+'/fail',{leaseToken:job.leaseToken,code,...diagnostic&&{diagnostic:sanitizeFailureDiagnostic(diagnostic)}},{...(signal?.aborted?{retry:false,afterCancellation:true}:{})})
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
 if(!job||typeof job.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(job.id)||typeof job.leaseToken!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(job.leaseToken)||!['test','full'].includes(job.mode)||job.limit!==(job.mode==='test'?5:5000)||!Array.isArray(job.filterParameters)||typeof job.filterUrl!=='string'||typeof job.username!=='string'||typeof job.password!=='string')throw new WorkerError('source_error',null,'invalid_job');
}
const classify=error=>error?.code==='login_required'||['AUTH_REQUIRED','ACCESS_DENIED'].includes(error?.code)?'login_required':['source_error','INVALID_INPUT','FILTER_MISMATCH','INVALID_RESPONSE'].includes(error?.code)?'source_error':'scrape_error';
function failureReason(error){
 if(FAILURE_REASONS.includes(error?.reason))return error.reason;
 if(httpStatus(error?.status))return httpReason(error.status);
 if(error?.code==='TIMEOUT'||error?.name==='TimeoutError'||error?.code==='ABORTED')return'request_timeout';
 return({login_required:'login_required',AUTH_REQUIRED:'login_required',ACCESS_DENIED:'login_required',FILTER_MISMATCH:'filter_mismatch',INVALID_INPUT:'invalid_input',INVALID_RESPONSE:'invalid_response',source_error:'invalid_response',TRANSPORT_ERROR:'network_error'})[error?.code]??'unexpected_error';
}
const MAX_BATCH_ITEMS_BYTES=950*1024;

export async function runJob(job,{broker,signal,authenticate=loginBouwberichten,createApi=createBouwberichtenApi,mapLead=mapProjectToLead,sleepImpl=delay,jobTimeoutMs=(job?.mode==='full'?4:1)*60*60*1000}={}){
 let session,stage='configuration',processed=0,pageNumber=0,total=null;const timeout=AbortSignal.timeout(jobTimeoutMs),combined=AbortSignal.any([signal,timeout].filter(Boolean));
 try{
  validateJob(job);combined.throwIfAborted();
  stage='login';
  session=await authenticate({username:job.username,password:job.password,filterUrl:job.filterUrl,signal:combined});
  const api=createApi({authorizedRequest:createPacedRequest(session.authorizedRequest,{signal:combined,sleepImpl}),signal:combined});
  let batch=0;const seen=new Set(),organisationCache=new Map(),amountPerPage=20;
  const workbookCounts={contractorsWithPhone:0,images:0,imageFailures:{}};
  while(total===null||processed<Math.min(total,job.limit)){
   combined.throwIfAborted();stage='listing';const listing=await api.listProjects({filterParameters:job.filterParameters,pageNumber,amountPerPage,signal:combined});
   if(!listing||!Array.isArray(listing.projects)||!count(listing.total))throw new WorkerError('source_error',null,'invalid_response');
   if(total===null)total=listing.total;
   if(job.mode==='full'&&total>job.limit)throw new WorkerError('source_error',null,'selection_limit',{expectedTotal:job.limit,observedTotal:total});
   // Stable totals and unique identities prevent silently skipping projects on changing pages.
   if(listing.total!==total)throw new WorkerError('source_error',null,'total_changed',{observedTotal:listing.total});
   if(!listing.projects.length&&processed<Math.min(total,job.limit))throw new WorkerError('source_error',null,'empty_page');
   stage='progress';await broker.progress(job,{processed,total});let items=[],itemBytes=0;
   async function flush(){
    if(!items.length)return;
    stage='import';await broker.batch(job,batch++,items);processed+=items.length;items=[];itemBytes=0;
   }
   for(const summary of listing.projects){
    if(processed+items.length>=Math.min(total,job.limit))break;
    stage='listing';const identity=String(summary.id);if(seen.has(identity))throw new WorkerError('source_error',null,'duplicate_project');seen.add(identity);
    stage='detail';
    const project=await api.getProject(summary.id,{signal:combined});
    const ids=[...new Set((Array.isArray(project.involvements)?project.involvements:[]).map(item=>item?.organisationId).filter(id=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0||typeof id==='string'&&/^\d{1,16}$/.test(id)&&Number(id)>0).map(String))];
    const missing=ids.filter(id=>!organisationCache.has(id));
    if(missing.length){stage='organisations';const organisations=await api.getOrganisations(missing,{signal:combined});for(const id of missing)organisationCache.set(id,null);for(const organisation of organisations)organisationCache.set(String(organisation.id),organisation);}
    stage='mapping';
    const lead=mapLead(project,{organisations:ids.map(id=>organisationCache.get(id)).filter(Boolean),preferredRoles:['Hoofdaannemer'],includeDetails:true});
    stage='presentation';
    const presentation=await session.projectPresentation?.(identity,project.name,{hasImage:Array.isArray(project.images)?project.images.length>0:undefined});
    stage='mapping';
    enrichLeadWithPresentation(lead,presentation);
    if(lead.projectDetails?.primaryRole?.toLowerCase()==='hoofdaannemer'&&lead.phone)workbookCounts.contractorsWithPhone++;
    if(lead.projectImage)workbookCounts.images++;
    else if(session.projectPresentation){const reason=IMAGE_FAILURE_REASONS.includes(presentation?.imageStatus)?presentation.imageStatus:'capture_failed';workbookCounts.imageFailures[reason]=(workbookCounts.imageFailures[reason]??0)+1;}
    const bytes=Buffer.byteLength(JSON.stringify(lead))+1;
    if(items.length&&itemBytes+bytes>MAX_BATCH_ITEMS_BYTES)await flush();
    items.push(lead);itemBytes+=bytes;
   }
   await flush();
   stage='progress';await broker.progress(job,{processed,total});pageNumber++;
  }
  if(!processed){stage='listing';throw new WorkerError('source_error',null,'empty_selection');}
  stage='finish';
  await broker.finish(job,{processed,total});return{processed,total,...session.projectPresentation&&{workbookCounts}};
 }catch(error){
  const interrupted=signal?.aborted?'worker_cancelled':timeout.aborted?'job_timeout':null,code=interrupted?'scrape_error':classify(error),diagnostic=code==='login_required'?sanitizeAuthDiagnostic(error?.diagnostic):undefined;
  const details=error instanceof WorkerError?error.failure:{};
  const failure=sanitizeFailureDiagnostic({stage,reason:interrupted??failureReason(error),status:error?.status,processed,...total!==null&&{expectedTotal:total},...details,...diagnostic&&{authStage:diagnostic.stage,authReason:diagnostic.reason}});
  try{await broker.fail(job,code,failure);}catch{}
  return{failed:true,code,failure,...diagnostic&&{diagnostic}};
 }
 finally{await session?.close().catch(()=>{});}
}

export async function runWorker({config=loadWorkerConfig(),signal,fetchImpl=fetch,sleepImpl=delay,run=runJob,logger=console}={}){
 const broker=createBrokerClient({...config,signal,fetchImpl,sleepImpl});logger.info('Scrapingworker gestart.');
 while(!signal?.aborted){
  try{const job=await broker.claim();if(job){const result=await run(job,{broker,signal,sleepImpl}),diagnostic=result.failed?sanitizeAuthDiagnostic(result.diagnostic):undefined,failure=result.failed?sanitizeFailureDiagnostic(result.failure):undefined;
   const counts=result.workbookCounts;
   const imageFailures=counts&&Object.fromEntries(IMAGE_FAILURE_REASONS.filter(key=>Number.isSafeInteger(counts.imageFailures?.[key])&&counts.imageFailures[key]>0&&counts.imageFailures[key]<=result.processed).map(key=>[key,counts.imageFailures[key]]));
   const workbookCounts=counts&&{...Object.fromEntries(['contractorsWithPhone','images'].filter(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0&&counts[key]<=result.processed).map(key=>[key,counts[key]])),...imageFailures&&Object.keys(imageFailures).length&&{imageFailures}};
   logger.info(JSON.stringify({event:result.failed?'job_failed':'job_finished',...result.failed?{code:['login_required','source_error','scrape_error'].includes(result.code)?result.code:'scrape_error',...diagnostic&&{diagnostic},...failure&&{failure}}:{processed:result.processed,total:result.total,...workbookCounts&&{workbookCounts}}}));continue;}}
  catch(error){if(signal?.aborted)break;logger.error(JSON.stringify({event:'broker_unavailable',status:httpStatus(error?.status)?error.status:null}));}
  try{await wait(15000,signal,sleepImpl);}catch{break;}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const controller=new AbortController();for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>controller.abort());
 runWorker({signal:controller.signal}).catch(()=>{console.error('De scrapingworker kon niet starten. Controleer de service-instellingen.');process.exitCode=1;});
}
