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
 let browser,context,page,accessToken='',tokenVersion=0,closed=false,customTemplateSeen=false;
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
  return{authorizedRequest,close};
 }catch(error){await close();if(signal?.aborted)throw signal.reason;throw error instanceof SourceLoginError?error:failure(stage==='browser_start'?'browser_start_failed':stage==='portal_navigation'?'navigation_failed':['email_form','email_submitted','password_form','password_submitted'].includes(stage)?'control_interaction_failed':'unexpected_error');}
}
