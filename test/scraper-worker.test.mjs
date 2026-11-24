import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWorkerConfig,createBrokerClient,createPacedRequest,runJob,runWorker} from '../scraper/worker.mjs';
import {loginBouwberichten,SourceLoginError} from '../scraper/bouwberichten-auth.mjs';

const filterUrl='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const filterParameters=[['projects[filters][constructionPhase][]','Gegund']];
const job={id:'scrape-unit-job',leaseToken:'l'.repeat(43),sourceId:'bouw',username:'user@example.test',password:'not-a-real-password',filterUrl,filterParameters,mode:'test',limit:5};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const noopSleep=async()=>{};
function fakeBroker(){const calls=[];return{calls,...Object.fromEntries(['progress','batch','finish','fail'].map(name=>[name,async(...args)=>{calls.push([name,...args]);return{};}]))};}
function fixtureApi({count=24,changeTotal=false,duplicate=false,detailError}={}){
 const calls=[];return{calls,
  async listProjects({pageNumber,amountPerPage}){calls.push(['list',pageNumber,amountPerPage]);return{total:count+(changeTotal&&pageNumber?1:0),projects:Array.from({length:Math.min(amountPerPage,Math.max(0,count-pageNumber*amountPerPage))},(_,i)=>({id:duplicate?1:pageNumber*amountPerPage+i+1}))};},
  async getProject(id){calls.push(['detail',id]);if(detailError)throw detailError;return{id,name:'Project '+id,involvements:[{organisationId:71}]};},
  async getOrganisations(ids){calls.push(['organisations',ids]);return[{id:71,name:'Aannemer',phoneNumber:'020 1234567'}];}
 };
}
function jobDependencies(api,broker){const session={closed:0,authorizedRequest:async()=>json({}),async close(){this.closed++;}};return{session,options:{broker,createApi:()=>api,authenticate:async()=>session,mapLead:(project,{organisations})=>({externalId:String(project.id),title:project.name,organization:organisations[0]?.name}),sleepImpl:noopSleep}};}

test('worker accepts only an HTTPS dashboard origin and validates secrets without reflecting them',()=>{
 const config={DASHBOARD_URL:'https://dashboard.example.test',SCRAPER_WORKER_TOKEN:'t'.repeat(43)};
 assert.equal(loadWorkerConfig(config).dashboardUrl,config.DASHBOARD_URL);
 for(const url of ['http://dashboard.example.test','https://user:secret@dashboard.example.test','https://dashboard.example.test/path','https://dashboard.example.test/?token=secret'])assert.throws(()=>loadWorkerConfig({...config,DASHBOARD_URL:url}),/HTTPS origin/);
 assert.throws(()=>loadWorkerConfig({...config,SCRAPER_WORKER_TOKEN:'secret'}),error=>!error.message.includes('secret'));
});

test('test job imports exactly five real mapped details, shares organisation lookup, and closes its browser',async()=>{
 const api=fixtureApi(),broker=fakeBroker(),{session,options}=jobDependencies(api,broker);
 assert.deepEqual(await runJob(job,options),{processed:5,total:24});
 assert.deepEqual(api.calls.filter(c=>c[0]==='list'),[['list',0,20]],'the portal page uses its known size while only five details are imported');
 assert.deepEqual(api.calls.filter(c=>c[0]==='detail').map(c=>c[1]),[1,2,3,4,5]);
 assert.equal(api.calls.filter(c=>c[0]==='organisations').length,1);
 const batch=broker.calls.find(c=>c[0]==='batch');assert.equal(batch[2],0);assert.equal(batch[3].length,5);assert.equal(batch[3][0].organization,'Aannemer');
 assert.deepEqual(broker.calls.find(c=>c[0]==='finish').at(-1),{processed:5,total:24});assert.equal(session.closed,1);
 assert.equal(broker.calls.some(c=>c[0]==='fail'),false);
});

test('full job pages zero-based, commits distinct batches and finishes only complete selection',async()=>{
 const api=fixtureApi(),broker=fakeBroker(),{options}=jobDependencies(api,broker);
 assert.deepEqual(await runJob({...job,mode:'full',limit:5000},options),{processed:24,total:24});
 assert.deepEqual(api.calls.filter(c=>c[0]==='list'),[['list',0,20],['list',1,20]]);
 assert.deepEqual(broker.calls.filter(c=>c[0]==='batch').map(c=>[c[2],c[3].length]),[[0,20],[1,4]]);
 assert.deepEqual(broker.calls.find(c=>c[0]==='finish').at(-1),{processed:24,total:24});
});

test('empty, oversized, changing or duplicate result sets fail without marking a job complete',async()=>{
 for(const params of [{count:0},{count:5001},{count:24,changeTotal:true},{count:24,duplicate:true}]){
  const api=fixtureApi(params),broker=fakeBroker(),{session,options}=jobDependencies(api,broker);
  assert.deepEqual(await runJob({...job,mode:'full',limit:5000},options),{failed:true,code:'source_error'});
  assert.equal(broker.calls.some(c=>c[0]==='finish'),false);assert.equal(broker.calls.at(-1)[0],'fail');assert.equal(session.closed,1);
  if(params.count===5001)assert.equal(broker.calls.some(c=>c[0]==='batch'),false);
 }
});

test('account challenges, denied API access and malformed source data report safe error codes and close context',async()=>{
 for(const code of ['login_required','AUTH_REQUIRED','ACCESS_DENIED','INVALID_RESPONSE','TIMEOUT']){
  const error=Object.assign(new Error('secret password / source response'),{code}),api=fixtureApi({detailError:error}),broker=fakeBroker(),{session,options}=jobDependencies(api,broker);
  const result=await runJob(job,options);
  assert.equal(result.code,['login_required','AUTH_REQUIRED','ACCESS_DENIED'].includes(code)?'login_required':code==='INVALID_RESPONSE'?'source_error':'scrape_error');
  assert.equal(session.closed,1);assert.equal(broker.calls.some(c=>c[0]==='batch'||c[0]==='finish'),false);
  assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(broker.calls.at(-1).length,3);
 }
});

test('broker batches retry identical payload after transient failure and redact error responses',async()=>{
 const sent=[],sleeps=[];let count=0;
 const broker=createBrokerClient({dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43),sleepImpl:async ms=>sleeps.push(ms),fetchImpl:async(url,init)=>{sent.push({url,init});return ++count===1?new Response('sensitive body',{status:503}):json({counts:{created:1,updated:0,unchanged:0}});}});
 await broker.batch(job,0,[{externalId:'1',title:'Voorbeeld'}]);assert.equal(sent.length,2);assert.equal(sent[0].init.body,sent[1].init.body);assert.equal(sent[0].init.headers.Authorization,'Bearer '+'t'.repeat(43));assert.deepEqual(sleeps,[1000]);
 const denied=createBrokerClient({dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43),fetchImpl:async()=>new Response('password=secret',{status:401})});
 await assert.rejects(denied.claim(),error=>error.status===401&&!error.message.includes('secret'));
 let claims=0;const lost=createBrokerClient({dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43),fetchImpl:async()=>{claims++;throw Error('network');}});
 await assert.rejects(lost.claim());assert.equal(claims,1,'an uncertain claim must not allocate another job');
});

test('source requests are paced and a 429 respects Retry-After with the same request',async()=>{
 let time=0,attempt=0;const waits=[],requests=[];
 const request=createPacedRequest(async(url,init)=>{requests.push([url,init.body]);return ++attempt===1?new Response('',{status:429,headers:{'retry-after':'3'}}):json({ok:true});},{now:()=>time,sleepImpl:async ms=>{waits.push(ms);time+=ms;}});
 await request('https://management.bouwberichten.nl/api/v1/projects',{method:'POST',body:'same'});await request('https://management.bouwberichten.nl/api/v1/projects?projectId=1');
 assert.deepEqual(requests.slice(0,2),[['https://management.bouwberichten.nl/api/v1/projects','same'],['https://management.bouwberichten.nl/api/v1/projects','same']]);assert.deepEqual(waits,[3000,1000]);
});

function fakeBrowser({origin='https://vakmedianetid.b2clogin.com',captcha=false}={}){
 const state={phase:'email',url:origin+'/signin',fills:[],clicks:[],closed:0,reloads:0,listeners:{}};
 const emit=token=>state.listeners.request?.({url:()=> 'https://management.bouwberichten.nl/api/v1/projects',headers:()=>({authorization:'Bearer '+token.repeat(30)})});
 const page={setDefaultTimeout(){},on(name,fn){state.listeners[name]=fn;},async goto(){},url:()=>state.url,async reload(){state.reloads++;emit('b');},locator(selector){return{first(){return this;},async isVisible(){if(selector.includes('recaptcha'))return captcha;if(selector==='#signInName')return state.phase==='email'||state.phase==='password';if(selector==='#next')return true;if(selector==='input[type="password"]')return state.phase==='password';return false;},async fill(value){state.fills.push([selector,value]);},async click(){state.clicks.push(selector);if(state.phase==='email')state.phase='password';else{state.phase='portal';state.url='https://portal.bouwberichten.nl/projecten';emit('a');}}};}};
 const chromium={async launch(){return{async newContext(){return{async newPage(){return page;}};},async close(){state.closed++;}};}};
 return{chromium,state,emit};
}

test('fresh B2C email/password flow captures only management API authorization, refreshes 401, and never forwards cookies',async()=>{
 const fake=fakeBrowser(),requests=[];let call=0;
 const session=await loginBouwberichten({...job,chromium:fake.chromium,sleepImpl:noopSleep,fetchImpl:async(url,init)=>{requests.push([url,init]);return ++call===1?new Response('',{status:401}):json({ok:true});}});
 assert.deepEqual(fake.state.fills,[['#signInName',job.username],['#signInName',job.username],['input[type="password"]',job.password]]);
 await session.authorizedRequest('https://management.bouwberichten.nl/api/v1/projects',{headers:{Cookie:'browser-secret'}});
 assert.equal(requests[0][1].headers.get('Authorization'),'Bearer '+'a'.repeat(30));assert.equal(requests[1][1].headers.get('Authorization'),'Bearer '+'b'.repeat(30));assert.equal(requests[1][1].headers.get('Cookie'),null);assert.equal(requests[1][1].redirect,'error');assert.equal(fake.state.reloads,1);
 await assert.rejects(session.authorizedRequest('https://evil.example.test/api/v1/projects'),SourceLoginError);assert.equal(requests.length,2);
 await session.close();await session.close();assert.equal(fake.state.closed,1);
 await assert.rejects(session.authorizedRequest('https://management.bouwberichten.nl/api/v1/projects'),SourceLoginError);
});

test('unexpected login origins and verification challenges stop before entering credentials',async()=>{
 for(const settings of [{origin:'https://evil.example.test'},{captcha:true}]){
  const fake=fakeBrowser(settings);await assert.rejects(loginBouwberichten({...job,chromium:fake.chromium,sleepImpl:noopSleep}),error=>error.code==='login_required'&&!error.message.includes(job.password));assert.deepEqual(fake.state.fills,[]);assert.equal(fake.state.closed,1);
 }
});

test('worker shutdown does not log broker secrets or keep polling',async()=>{
 const controller=new AbortController(),messages=[];let polls=0;
 await runWorker({config:{dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43)},signal:controller.signal,logger:{info:message=>messages.push(message),error:message=>messages.push(message)},sleepImpl:async()=>controller.abort(),fetchImpl:async()=>{polls++;return json({job:null});}});
 assert.equal(polls,1);assert.equal(messages.join('').includes('t'.repeat(43)),false);
});
