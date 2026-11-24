import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWorkerConfig,createBrokerClient,createPacedRequest,runJob,runWorker} from '../scraper/worker.mjs';
import {loginBouwberichten,SourceLoginError,sanitizeAuthDiagnostic} from '../scraper/bouwberichten-auth.mjs';

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

test('presentation lookup receives full source names and only image availability hints, with fixed aggregate failure reasons',async()=>{
 const api=fixtureApi({count:2}),broker=fakeBroker(),lookups=[],longName='Volledige projectnaam '+ 'x'.repeat(160);
 api.getProject=async id=>({id,name:longName,involvements:[],...(id===1?{images:[]}: {})});
 const dependencies=jobDependencies(api,broker);
 dependencies.options.mapLead=undefined;
 dependencies.session.projectPresentation=async(...args)=>{lookups.push(args);return{imageStatus:args[0]==='1'?'not_found':'https://secret.example/private-title'};};
 const result=await runJob(job,dependencies.options);
 assert.equal(result.processed,2);assert.deepEqual(lookups,[['1',longName,{hasImage:false}],['2',longName,{hasImage:undefined}]]);
 assert.deepEqual(result.workbookCounts.imageFailures,{not_found:1,capture_failed:1});
 const items=broker.calls.find(call=>call[0]==='batch')[3];
 assert.ok(items.every(item=>item.title.length===150));
 assert.ok(!JSON.stringify(result).includes('secret.example'));
});

test('image diagnostic logging accepts only fixed reason names and bounded integer counters',async()=>{
 const controller=new AbortController(),messages=[];let claims=0;
 await runWorker({config:{dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43)},signal:controller.signal,
  fetchImpl:async()=>{if(++claims===1)return json({job});controller.abort();return json({job:null});},sleepImpl:async()=>{},
  logger:{info:message=>messages.push(message),error:message=>messages.push(message)},
  run:async()=>({processed:2,total:2,workbookCounts:{images:1,contractorsWithPhone:0,imageFailures:{not_found:1,placeholder:3,not_loaded:-1,page_unavailable:1.5,'https://private.example/token':2}}})});
 const message=messages.map(value=>{try{return JSON.parse(value);}catch{return null;}}).find(value=>value?.event==='job_finished');
 assert.deepEqual(message.workbookCounts,{images:1,contractorsWithPhone:0,imageFailures:{not_found:1}});
 assert.equal(messages.join('').includes('private.example'),false);
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

function fakeBrowser({origin='https://vakmedianetid.b2clogin.com',captcha=false,stallAt=null,navigationError=null,launchError=null,loginError=false}={}){
 const state={phase:stallAt==='redirect'?'portal':'email',url:stallAt==='redirect'?'https://portal.bouwberichten.nl/projecten':origin+'/signin',fills:[],clicks:[],closed:0,reloads:0,listeners:{}};
 const emit=token=>state.listeners.request?.({url:()=> 'https://management.bouwberichten.nl/api/v1/projects',headers:()=>({authorization:'Bearer '+token.repeat(30)})});
 const page={setDefaultTimeout(){},on(name,fn){state.listeners[name]=fn;},async goto(){if(navigationError)throw navigationError;},url:()=>state.url,async reload(){state.reloads++;emit('b');},locator(selector){return{first(){return this;},async count(){return 0;},async isVisible(){if(selector.includes('recaptcha'))return captcha;if(selector==='#signInName')return state.phase==='email'||state.phase==='password';if(selector==='#next')return true;if(selector==='input[type="password"]')return state.phase==='password';if(selector.includes('.error.pageLevel'))return loginError===true&&state.phase==='password'&&state.clicks.length>=2||loginError===state.phase;return false;},async fill(value){state.fills.push([selector,value]);},async click(){state.clicks.push(selector);if(state.phase==='email'){if(stallAt!=='email')state.phase='password';}else if(stallAt!=='password'&&!loginError){state.phase='portal';state.url='https://portal.bouwberichten.nl/projecten';if(stallAt!=='token')emit('a');}}};}};
 const chromium={async launch(){if(launchError)throw launchError;return{async newContext(){return{async newPage(){return page;}};},async close(){state.closed++;}};}};
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

function customTemplateBrowser({stallAt=null,errorAt=null,visibleEmptyErrors=false}={}){
 const state={phase:'email',url:'https://vakmedianetid.b2clogin.com/signin',fills:[],clicks:[],lookups:[],closed:0,listeners:{}};
 // The real custom template contains registration and reset controls at the
 // same time. The first generic password node belongs to a hidden other flow.
 const controls=new Map([
  ['#register-password_password',{type:'password',phase:'registration'}],
  ['#reset-password_password',{type:'password',phase:'reset'}],
  ['#login-password_password',{type:'password',phase:'password'}],
  ['#login-password_next',{type:'button',phase:'password'}],
  ['#enterEmail_email',{type:'email',phase:'email'}],
  ['#enterEmail_next',{type:'button',phase:'email'}],
  ['#signInName',{type:'text',phase:'legacy'}],
  ['#next',{type:'button',phase:'legacy'}],
 ]);
 const emit=()=>state.listeners.request?.({url:()=> 'https://management.bouwberichten.nl/api/v1/projects',headers:()=>({authorization:'Bearer '+ 'c'.repeat(30)})});
 const page={setDefaultTimeout(){},on(name,fn){state.listeners[name]=fn;},async goto(){},url:()=>state.url,
  locator(selector){state.lookups.push(selector);const selected=selector==='input[type="password"]'?controls.get('#register-password_password'):controls.get(selector),errorPhase=selector==='#enterEmail #enterEmail_errorMessage'?'email':selector==='#login-password #login-password_passwordInvalid'?'password':null;return{first(){return this;},async count(){return selector==='#enterEmail_email, #login-password_password'?2:controls.has(selector)?1:0;},async isVisible(){return errorPhase?state.phase===errorPhase&&(visibleEmptyErrors||errorAt===errorPhase&&state.clicks.includes(errorPhase==='email'?'#enterEmail_next':'#login-password_next')):!!selected&&selected.phase===state.phase;},async evaluate(fn){const result=fn({textContent:errorPhase&&errorAt===errorPhase?'raw custom rejection containing sensitive account details':''});assert.equal(typeof result,'boolean','only a presence boolean may cross from the browser');return result;},async innerText(){throw Error('Raw source errors must stay inside the browser');},async textContent(){throw Error('Raw source errors must stay inside the browser');},async fill(value){assert(selected&&selected.phase===state.phase,'only the active login control can be filled');state.fills.push([selector,value]);},async click(){assert(selected&&selected.type==='button'&&selected.phase===state.phase,'the custom flow uses its visible type=button control');state.clicks.push(selector);if(selector==='#enterEmail_next'){if(stallAt!=='email'&&errorAt!=='email')state.phase='password';}else if(selector==='#login-password_next'&&stallAt!=='password'&&errorAt!=='password'){state.phase='portal';state.url='https://portal.bouwberichten.nl/projecten';if(stallAt!=='token')emit();}else if(selector!=='#login-password_next')throw Error('Unexpected login button');}};}
 };
 return{state,controls,chromium:{async launch(){return{async newContext(){return{async newPage(){return page;}};},async close(){state.closed++;}};}}};
}

test('the real custom B2C two-step form uses its email/password buttons and never registration, reset or hidden legacy controls',async()=>{
 let elapsed=0;const fake=customTemplateBrowser();
 const session=await loginBouwberichten({...job,chromium:fake.chromium,timeoutMs:1000,now:()=>elapsed,sleepImpl:async ms=>{elapsed+=ms;}});
 assert.deepEqual(fake.state.fills,[['#enterEmail_email',job.username],['#login-password_password',job.password]]);
 assert.deepEqual(fake.state.clicks,['#enterEmail_next','#login-password_next']);
 assert.equal(fake.controls.get('#enterEmail_next').type,'button');assert.equal(fake.controls.get('#login-password_next').type,'button');
 assert.equal(fake.state.lookups.includes('input[type="password"]'),false,'custom template detection must prevent the generic first password lookup');
 assert.equal(fake.state.lookups.includes('#signInName'),false);assert.equal(fake.state.lookups.includes('#next'),false);
 await session.close();assert.equal(fake.state.closed,1);
});

test('a stalled custom B2C step is submitted once and receives a safe phase diagnostic without switching to hidden forms',async()=>{
 for(const [stallAt,stage,passwordSubmitted,clicks]of [['email','email_form',false,1],['password','password_form',true,2],['token','api_wait',true,2]]){
  let elapsed=0;const fake=customTemplateBrowser({stallAt});
  await assert.rejects(loginBouwberichten({...job,chromium:fake.chromium,timeoutMs:1000,now:()=>elapsed,sleepImpl:async ms=>{elapsed+=ms;}}),error=>{
   assert.deepEqual(error.diagnostic,{stage,reason:'login_timeout',originLabel:stallAt==='token'?'portal':'login',emailSubmitted:true,passwordSubmitted});assert.equal(JSON.stringify(error).includes(job.password),false);return true;
  });
  assert.equal(fake.state.clicks.length,clicks);assert.equal(fake.state.fills.some(([selector])=>/register|reset|signInName/.test(selector)),false);assert.equal(fake.state.lookups.includes('input[type="password"]'),false);assert.equal(fake.state.closed,1);
 }
});

test('custom B2C rejects visible nonempty step errors without reading hidden registration errors or exposing their text',async()=>{
 for(const errorAt of ['email','password']){
  let elapsed=0;const fake=customTemplateBrowser({errorAt});
  await assert.rejects(loginBouwberichten({...job,chromium:fake.chromium,timeoutMs:1000,now:()=>elapsed,sleepImpl:async ms=>{elapsed+=ms;}}),error=>{
   assert.deepEqual(error.diagnostic,{stage:errorAt+'_form',reason:errorAt+'_step_error',originLabel:'login',emailSubmitted:true,passwordSubmitted:errorAt==='password'});assert.equal(JSON.stringify(error).includes('sensitive account details'),false);assert.equal(String(error).includes('raw custom rejection'),false);return true;
  });
  assert.equal(fake.state.clicks.length,errorAt==='email'?1:2);assert.equal(fake.state.closed,1);
 }
});

test('visible empty custom error containers do not prevent successful two-step login',async()=>{
 let elapsed=0;const fake=customTemplateBrowser({visibleEmptyErrors:true});
 const session=await loginBouwberichten({...job,chromium:fake.chromium,timeoutMs:1000,now:()=>elapsed,sleepImpl:async ms=>{elapsed+=ms;}});
 assert.deepEqual(fake.state.clicks,['#enterEmail_next','#login-password_next']);assert.equal(fake.state.lookups.includes('input[type="password"]'),false);await session.close();assert.equal(fake.state.closed,1);
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

test('login diagnostics allow only fixed labels and booleans, excluding URLs, credentials, headers and raw error text',()=>{
 const secret='sensitive-regression-value',raw={stage:secret,reason:secret,originLabel:'https://'+secret+'.example.test/path',passwordSubmitted:'true',emailSubmitted:1,username:secret,password:secret,accessToken:secret,refreshToken:secret,headers:{authorization:secret},url:secret,message:secret};
 const expected={stage:'unknown',reason:'unknown',originLabel:'other',passwordSubmitted:false,emailSubmitted:false};
 assert.deepEqual(sanitizeAuthDiagnostic(raw),expected);
 const error=new SourceLoginError(secret,secret,raw);
 assert.equal(error.code,'login_required');assert.deepEqual(error.diagnostic,expected);assert.equal(String(error).includes(secret),false);assert.equal(JSON.stringify(error).includes(secret),false);
 for(const invalid of [undefined,null,'raw secret',42,[],true])assert.equal(sanitizeAuthDiagnostic(invalid),undefined);
 const valid={stage:'api_wait',reason:'login_timeout',originLabel:'portal',passwordSubmitted:true,emailSubmitted:true};
 assert.deepEqual(sanitizeAuthDiagnostic({...valid,password:secret}),valid);
});

test('a failed job returns sanitized login diagnostics while the broker receives only its existing safe failure code',async()=>{
 const secret='sensitive-worker-error-body',raw={stage:'api_wait',reason:'login_timeout',originLabel:'portal',emailSubmitted:true,passwordSubmitted:true,password:secret,authorization:secret,url:secret};
 const error=Object.assign(new Error(secret),{code:'login_required',diagnostic:raw}),broker=fakeBroker();
 const result=await runJob(job,{broker,authenticate:async()=>{throw error;}});
 assert.deepEqual(result,{failed:true,code:'login_required',diagnostic:{stage:'api_wait',reason:'login_timeout',originLabel:'portal',emailSubmitted:true,passwordSubmitted:true}});
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(broker.calls.length,1);assert.equal(broker.calls[0][0],'fail');assert.equal(broker.calls[0][2],'login_required');assert.equal(broker.calls[0].length,3);
 const other=fakeBroker();assert.deepEqual(await runJob(job,{broker:other,authenticate:async()=>{throw Object.assign(new Error(secret),{code:'INVALID_RESPONSE',diagnostic:raw});}}),{failed:true,code:'source_error'});
});

test('worker logging sanitizes a failed job diagnostic again instead of trusting its returned object',async()=>{
 const controller=new AbortController(),messages=[],secret='untrusted-job-secret';let claims=0;
 await runWorker({config:{dashboardUrl:'https://dashboard.example.test',workerToken:'t'.repeat(43)},signal:controller.signal,logger:{info:message=>messages.push(message),error:message=>messages.push(message)},sleepImpl:noopSleep,
  fetchImpl:async()=>{if(++claims===1)return json({job});controller.abort();return json({job:null});},
  run:async()=>({failed:true,code:'login_required',diagnostic:{stage:'api_wait',reason:'login_timeout',originLabel:'https://'+secret+'.example.test',passwordSubmitted:true,emailSubmitted:true,password:secret,headers:{authorization:secret},message:secret}}),
 });
 const event=messages.filter(value=>value.startsWith('{')).map(value=>JSON.parse(value)).find(value=>value.event==='job_failed');
 assert(event);assert.deepEqual(event.diagnostic,{stage:'api_wait',reason:'login_timeout',originLabel:'other',passwordSubmitted:true,emailSubmitted:true});
 assert.equal(messages.join('').includes(secret),false);assert.equal(messages.join('').includes(job.password),false);assert.equal(messages.join('').includes('t'.repeat(43)),false);
});

test('deterministic login timeouts identify whether redirect, email, password or API authorization stalled',async()=>{
 for(const [stallAt,stage,originLabel,emailSubmitted,passwordSubmitted]of [
  ['redirect','portal_wait','portal',false,false],
  ['email','email_form','login',true,false],
  ['password','password_form','login',true,true],
  ['token','api_wait','portal',true,true],
 ]){
  let elapsed=0;const fake=fakeBrowser({stallAt});
  await assert.rejects(loginBouwberichten({...job,chromium:fake.chromium,timeoutMs:1000,now:()=>elapsed,sleepImpl:async ms=>{elapsed+=ms;}}),error=>{
   assert(error instanceof SourceLoginError);assert.equal(error.code,'login_required');assert.deepEqual(error.diagnostic,{stage,reason:'login_timeout',originLabel,passwordSubmitted,emailSubmitted});
   assert.equal(JSON.stringify(error).includes(job.password),false);assert.equal(JSON.stringify(error).includes(job.username),false);assert.equal(JSON.stringify(error).includes(filterUrl),false);return true;
  });
  assert.equal(fake.state.closed,1);assert(elapsed>=1000&&elapsed<2000,'the fake clock avoids a real login timeout');
  assert.equal(fake.state.clicks.length,emailSubmitted?passwordSubmitted?2:1:0,'no login step is repeatedly submitted');
 }
});

test('verification, rejected login steps, navigation failure and browser launch failure retain only safe diagnostic phases',async()=>{
 const secret='raw-login-error-with-credentials';
 for(const [settings,reason,stage,originLabel,emailSubmitted,passwordSubmitted,closed]of [
  [{captcha:true},'interactive_verification','email_form','login',false,false,1],
  [{origin:'https://'+secret+'.example.test'},'unexpected_origin','portal_navigation','other',false,false,1],
  [{loginError:true},'password_step_error','password_form','login',true,true,1],
  [{stallAt:'email',loginError:'email'},'email_step_error','email_form','login',true,false,1],
  [{navigationError:new Error(secret)},'navigation_failed','portal_navigation','other',false,false,1],
  [{launchError:new Error(secret)},'browser_start_failed','browser_start','other',false,false,0],
 ]){
  const fake=fakeBrowser(settings);
  await assert.rejects(loginBouwberichten({...job,chromium:fake.chromium,sleepImpl:noopSleep}),error=>{
   assert.deepEqual(error.diagnostic,{stage,reason,originLabel,passwordSubmitted,emailSubmitted});assert.equal(JSON.stringify(error).includes(secret),false);assert.equal(String(error).includes(secret),false);return true;
  });
  assert.equal(fake.state.closed,closed);
 }
});
