import {setTimeout as delay} from 'node:timers/promises';
import {normalizeBouwberichtenFilterUrl} from '../public/bouwberichten-filters.mjs';

const PORTAL_ORIGIN='https://portal.bouwberichten.nl';
const API_ORIGIN='https://management.bouwberichten.nl';
const LOGIN_ORIGIN='https://vakmedianetid.b2clogin.com';
const STAGES=new Set(['configuration','browser_start','portal_navigation','portal_wait','login_wait','email_form','email_submitted','password_form','password_submitted','api_wait','api_request','api_refresh','unknown']);
const REASONS=new Set(['invalid_filter','invalid_configuration','browser_start_failed','navigation_failed','unexpected_origin','interactive_verification','submit_missing','email_step_error','password_step_error','login_timeout','control_interaction_failed','request_not_allowed','browser_closed','unexpected_error','unknown']);

export function sanitizeAuthDiagnostic(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 return{stage:STAGES.has(value.stage)?value.stage:'unknown',reason:REASONS.has(value.reason)?value.reason:'unknown',originLabel:['portal','login','other'].includes(value.originLabel)?value.originLabel:'other',passwordSubmitted:value.passwordSubmitted===true,emailSubmitted:value.emailSubmitted===true};
}

export class SourceLoginError extends Error{
 constructor(reason='unknown',stage='unknown',context={}){super('De bronaanmelding vraagt om aandacht. Verbind de bron opnieuw.');this.name='SourceLoginError';this.code='login_required';this.diagnostic=sanitizeAuthDiagnostic({...context,reason,stage});}
}

export const IMAGE_FAILURE_REASONS=Object.freeze(['not_found','placeholder','not_loaded','page_unavailable','page_mismatch','capture_failed','too_large']);

export async function readProjectPresentation(page,projectId,title,{signal,hasImage}={}){
 if(!/^\d{1,16}$/.test(String(projectId))||typeof title!=='string'||!title.trim())return;
 const sourceTitle=title.replace(/\s+/g,' ').trim(),url=PORTAL_ORIGIN+'/projecten/'+projectId;
 let main,result={};
 for(let attempt=0;attempt<2;attempt++){
  try{
   signal?.throwIfAborted();
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:6000});
   if(page.url()!==url)return{imageStatus:'page_mismatch'};
   main=page.locator('#main');
   await main.getByRole('heading',{name:sourceTitle,exact:true}).waitFor({state:'visible',timeout:3000});
   break;
  }catch{signal?.throwIfAborted();if(attempt===1)return{imageStatus:'page_unavailable'};
   // Allow a failed Chromium error-page navigation to settle before the single retry.
   await delay(250,undefined,{signal});
  }
 }
 try{
  result=await main.evaluate(root=>{
   const terms=[...root.querySelectorAll('dt')].filter(term=>term.getClientRects().length),info={};
   for(const term of terms){
    const label=term.textContent.trim().replace(/:$/,'');
    if(!['Plan','Deelplan','Start','Oplevering','Oppervlakte','Bouwlagen van - t/m','Duurzame eigenschappen','Project website'].includes(label))continue;
    const value=term.nextElementSibling;
    if(value?.tagName==='DD')info[label]=label==='Project website'?value.querySelector('a[href]')?.href:value.textContent.trim();
   }
   const contractors=terms.filter(term=>term.textContent.trim()==='Hoofdaannemer');
   const term=contractors.length===1?contractors[0]:null,card=term?.closest('dl');
   const value=term?.nextElementSibling,name=value?.tagName==='DD'?value.textContent.trim():'';
   const byHref=prefix=>card?.querySelector(`a[href^="${prefix}"]`)?.textContent?.trim();
   const phone=byHref('tel:'),email=byHref('mailto:');
   const web=[...card?.querySelectorAll('dt')??[]].find(label=>label.textContent.trim()==='Website');
   const mainContractor=name?{name,phone,email,website:web?.nextElementSibling?.querySelector('a[href]')?.href}:undefined;
   return{info,mainContractor};
  },undefined,{timeout:1500});
 }catch{signal?.throwIfAborted();}
 let imageStatus='not_found';
 try{
  // Empty galleries render a category background, never a project photograph.
  if(hasImage===false)return{...result,imageStatus};
  const candidates=main.getByRole('img',{name:sourceTitle,exact:true}).and(main.locator('img.ImageSlider__image')).filter({visible:true});
  if(await candidates.count()===0&&await main.locator('.ImageSlider__placeholder').first().isVisible())return{...result,imageStatus};
  const image=candidates.first();
  await image.waitFor({state:'visible',timeout:3000});
  imageStatus='not_loaded';
  for(let attempt=0;attempt<2;attempt++){
   // The portal marks project photographs loading="lazy"; visibility alone does not start loading.
   await image.scrollIntoViewIfNeeded({timeout:1500});
   const state=await image.evaluate(async element=>{
    const placeholder=()=>{try{return /\/images\/placeholder-[^/]+\.(?:jpe?g|png|webp)$/i.test(new URL(element.currentSrc||element.src,element.baseURI).pathname);}catch{return false;}};
    const loaded=()=>element.complete&&element.naturalWidth>0&&element.naturalHeight>0;
    if(!placeholder()&&!loaded())await new Promise(resolve=>{
     let timer;const finish=()=>{clearTimeout(timer);element.removeEventListener('load',finish);element.removeEventListener('error',finish);resolve();};
     timer=setTimeout(finish,1800);element.addEventListener('load',finish,{once:true});element.addEventListener('error',finish,{once:true});
     element.decode().then(finish).catch(()=>{if(element.complete)finish();});if(loaded())finish();
    });
    return{loaded:loaded(),placeholder:placeholder()};
   },undefined,{timeout:2500});
   if(state.placeholder)return{...result,imageStatus:'placeholder'};
   if(!state.loaded)continue;
   imageStatus='capture_failed';
   for(const quality of [70,50,30]){
    const bytes=await image.screenshot({type:'jpeg',quality,timeout:2500,animations:'disabled',scale:'css'});
    if(bytes.length<=256*1024)return{...result,projectImage:'data:image/jpeg;base64,'+bytes.toString('base64'),imageStatus:'captured'};
   }
   return{...result,imageStatus:'too_large'};
  }
 }catch{signal?.throwIfAborted();}
 return{...result,imageStatus};
}

// Public evidence: https://vmnb2contentprod.blob.core.windows.net/static/unified.html
// and its static/bundle.js bindings. Custom: #enterEmail_email/#enterEmail_next,
// then #login-password_password/#login-password_next. Other password fields
// belong to registration/reset flows and must never be selected in this template.
// The legacy B2C template remains a fallback only when no custom controls exist.
// No browser profile, storageState, token, or screenshot is written to disk.
export async function loginBouwberichten({username,password,filterUrl,signal,chromium,fetchImpl=fetch,timeoutMs=90000,sleepImpl=delay,now=Date.now}={}){
 let stage='configuration',originLabel='other',emailSubmitted=false,passwordSubmitted=false;
 const failure=reason=>new SourceLoginError(reason,stage,{originLabel,emailSubmitted,passwordSubmitted});
 let normalized;
 try{normalized=normalizeBouwberichtenFilterUrl(filterUrl).filterUrl;}catch{throw failure('invalid_filter');}
 if(typeof username!=='string'||!username.trim()||typeof password!=='string'||!password||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||typeof now!=='function')throw failure('invalid_configuration');
 signal?.throwIfAborted();
 let browser,context,page,photoPage,accessToken='',tokenVersion=0,closed=false,customTemplateSeen=false;
 const close=async()=>{if(closed)return;closed=true;accessToken='';signal?.removeEventListener('abort',onAbort);await browser?.close().catch(()=>{});};
 const onAbort=()=>{void close();};
 const visible=async selector=>{try{return await page.locator(selector).first().isVisible();}catch{return false;}};
 const visibleError=async selector=>{try{const control=page.locator(selector).first();return await control.isVisible()&&await control.evaluate(element=>Boolean(element.textContent?.trim()));}catch{return false;}};
 const present=async selector=>{try{return await page.locator(selector).count()>0;}catch{return false;}};
 const pause=ms=>sleepImpl(ms,undefined,{signal});
 const rememberRequest=request=>{
  try{const url=new URL(request.url());if(url.origin!==API_ORIGIN||!url.pathname.startsWith('/api/v1/'))return;const value=request.headers().authorization??request.headers().Authorization;if(typeof value==='string'&&/^Bearer [A-Za-z0-9._~-]{20,16384}$/.test(value)){accessToken=value;tokenVersion++;}}catch{}
 };
 try{
  stage='browser_start';
  if(!chromium)({chromium}=await import('playwright'));
  browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  signal?.throwIfAborted();signal?.addEventListener('abort',onAbort,{once:true});
  context=await browser.newContext({acceptDownloads:false,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  page=await context.newPage();page.on('request',rememberRequest);
  page.setDefaultTimeout(10000);
  stage='portal_navigation';
  await page.goto(normalized,{waitUntil:'domcontentloaded',timeout:Math.min(timeoutMs,45000)});
  const deadline=now()+timeoutMs;
  while(!accessToken){
   signal?.throwIfAborted();if(closed)throw failure('browser_closed');
   let origin;try{origin=new URL(page.url()).origin;}catch{originLabel='other';throw failure('unexpected_origin');}
   originLabel=origin===PORTAL_ORIGIN?'portal':origin===LOGIN_ORIGIN?'login':'other';
   if(originLabel==='other')throw failure('unexpected_origin');
   if(origin===LOGIN_ORIGIN&&await present('#enterEmail_email, #login-password_password'))customTemplateSeen=true;
   const emailSelector=customTemplateSeen?'#enterEmail_email':'#signInName',passwordSelector=customTemplateSeen?'#login-password_password':'input[type="password"]',emailSubmitSelector=customTemplateSeen?'#enterEmail_next':'#next';
   // Only boolean control visibility is inspected for the diagnostic phase.
   const passwordVisible=origin===LOGIN_ORIGIN&&await visible(passwordSelector),emailVisible=origin===LOGIN_ORIGIN&&await visible(emailSelector);
   stage=origin===PORTAL_ORIGIN?(emailSubmitted||passwordSubmitted?'api_wait':'portal_wait'):passwordVisible?'password_form':emailVisible?'email_form':passwordSubmitted?'password_submitted':emailSubmitted?'email_submitted':'login_wait';
   if(now()>=deadline)throw failure('login_timeout');
   if(await visible('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[id*="captcha" i], input#verificationCode, input#otpCode'))throw failure('interactive_verification');
   if(origin===LOGIN_ORIGIN){
    if(customTemplateSeen){
     if(emailSubmitted&&await visibleError('#enterEmail #enterEmail_errorMessage'))throw failure('email_step_error');
     if(passwordSubmitted&&await visibleError('#login-password #login-password_passwordInvalid'))throw failure('password_step_error');
    }else if((emailSubmitted||passwordSubmitted)&&await visible('.error.pageLevel[aria-hidden="false"], .error.itemLevel[aria-hidden="false"]'))throw failure(passwordSubmitted?'password_step_error':'email_step_error');
    if(passwordVisible&&!passwordSubmitted){
     if(emailVisible)await page.locator(emailSelector).first().fill(username.trim());
     await page.locator(passwordSelector).first().fill(password);
     const submit=customTemplateSeen?'#login-password_next':await visible('#next')?'#next':await visible('#continue')?'#continue':'form button[type="submit"]';
     if(!await visible(submit))throw failure('submit_missing');
     passwordSubmitted=true;stage='password_submitted';await page.locator(submit).first().click();
    }else if(!emailSubmitted&&!passwordVisible&&emailVisible&&await visible(emailSubmitSelector)){
     await page.locator(emailSelector).first().fill(username.trim());emailSubmitted=true;stage='email_submitted';await page.locator(emailSubmitSelector).first().click();
    }
   }
   if(!accessToken)await pause(400);
  }
  async function authorizedRequest(input,init={}){
   stage='api_request';const url=new URL(input);if(url.origin!==API_ORIGIN||!url.pathname.startsWith('/api/v1/')||url.username||url.password||url.hash||closed)throw failure('request_not_allowed');
   if(!['GET','POST'].includes(String(init.method??'GET').toUpperCase()))throw failure('request_not_allowed');
   signal?.throwIfAborted();const requestSignal=AbortSignal.any([signal,init.signal].filter(Boolean));
   const send=()=>{const headers=new Headers(init.headers);headers.delete('cookie');headers.set('Authorization',accessToken);return fetchImpl(url.href,{...init,headers,signal:requestSignal,redirect:'error'});};
   let response=await send();
   if(response.status===401){
    // The portal owns its OIDC refresh cycle; do not extract or persist refresh tokens.
    stage='api_refresh';const before=tokenVersion;await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    for(let i=0;i<25&&tokenVersion===before;i++){requestSignal.throwIfAborted();await pause(400);}
    if(tokenVersion!==before){await response.body?.cancel();await pause(1000);response=await send();}
   }
   return response;
  }
   async function projectPresentation(projectId,title,{hasImage}={}){
   if(!/^\d{1,16}$/.test(String(projectId))||!title||closed)return;
    try{photoPage??=await context.newPage();return await readProjectPresentation(photoPage,projectId,title,{signal,hasImage});}
    catch{signal?.throwIfAborted();return{imageStatus:'page_unavailable'};}
  }
  return{authorizedRequest,projectPresentation,close};
 }catch(error){await close();if(signal?.aborted)throw signal.reason;throw error instanceof SourceLoginError?error:failure(stage==='browser_start'?'browser_start_failed':stage==='portal_navigation'?'navigation_failed':['email_form','email_submitted','password_form','password_submitted'].includes(stage)?'control_interaction_failed':'unexpected_error');}
}
