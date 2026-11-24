import {setTimeout as delay} from 'node:timers/promises';
import {normalizeBouwberichtenFilterUrl} from '../public/bouwberichten-filters.mjs';

const PORTAL_ORIGIN='https://portal.bouwberichten.nl';
const API_ORIGIN='https://management.bouwberichten.nl';
const LOGIN_ORIGIN='https://vakmedianetid.b2clogin.com';

export class SourceLoginError extends Error{
 constructor(){super('De bronaanmelding vraagt om aandacht. Verbind de bron opnieuw.');this.name='SourceLoginError';this.code='login_required';}
}

// These selectors follow the public B2C sign-in template: email is a separate
// first step (#signInName/#next); the next step uses a native password control.
// No browser profile, storageState, token, or screenshot is written to disk.
export async function loginBouwberichten({username,password,filterUrl,signal,chromium,fetchImpl=fetch,timeoutMs=90000,sleepImpl=delay}={}){
 let normalized;
 try{normalized=normalizeBouwberichtenFilterUrl(filterUrl).filterUrl;}catch{throw new SourceLoginError();}
 if(typeof username!=='string'||!username.trim()||typeof password!=='string'||!password||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new SourceLoginError();
 signal?.throwIfAborted();
 let browser,context,page,accessToken='',tokenVersion=0,closed=false;
 const close=async()=>{if(closed)return;closed=true;accessToken='';signal?.removeEventListener('abort',onAbort);await browser?.close().catch(()=>{});};
 const onAbort=()=>{void close();};
 const visible=async selector=>{try{return await page.locator(selector).first().isVisible();}catch{return false;}};
 const pause=ms=>sleepImpl(ms,undefined,{signal});
 const rememberRequest=request=>{
  try{const url=new URL(request.url());if(url.origin!==API_ORIGIN||!url.pathname.startsWith('/api/v1/'))return;const value=request.headers().authorization??request.headers().Authorization;if(typeof value==='string'&&/^Bearer [A-Za-z0-9._~-]{20,16384}$/.test(value)){accessToken=value;tokenVersion++;}}catch{}
 };
 try{
  if(!chromium)({chromium}=await import('playwright'));
  browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  signal?.throwIfAborted();signal?.addEventListener('abort',onAbort,{once:true});
  context=await browser.newContext({acceptDownloads:false,locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});
  page=await context.newPage();page.on('request',rememberRequest);
  page.setDefaultTimeout(10000);
  await page.goto(normalized,{waitUntil:'domcontentloaded',timeout:Math.min(timeoutMs,45000)});
  const deadline=Date.now()+timeoutMs;let emailSubmitted=false,passwordSubmitted=false;
  while(!accessToken){
   signal?.throwIfAborted();if(closed||Date.now()>=deadline)throw new SourceLoginError();
   let origin;try{origin=new URL(page.url()).origin;}catch{throw new SourceLoginError();}
   if(![PORTAL_ORIGIN,LOGIN_ORIGIN].includes(origin))throw new SourceLoginError();
   if(await visible('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], input[id*="captcha" i], input#verificationCode, input#otpCode'))throw new SourceLoginError();
   if(origin===LOGIN_ORIGIN){
    const passwordVisible=await visible('input[type="password"]');
    if(passwordVisible&&!passwordSubmitted){
     if(await visible('#signInName'))await page.locator('#signInName').first().fill(username.trim());
     await page.locator('input[type="password"]').first().fill(password);
     const submit=await visible('#next')?'#next':await visible('#continue')?'#continue':'form button[type="submit"]';
     if(!await visible(submit))throw new SourceLoginError();
     passwordSubmitted=true;await page.locator(submit).first().click();
    }else if(!emailSubmitted&&!passwordVisible&&await visible('#signInName')&&await visible('#next')){
     await page.locator('#signInName').first().fill(username.trim());emailSubmitted=true;await page.locator('#next').first().click();
    }else if(passwordSubmitted&&await visible('.error.pageLevel[aria-hidden="false"], .error.itemLevel[aria-hidden="false"]'))throw new SourceLoginError();
   }
   if(!accessToken)await pause(400);
  }
  async function authorizedRequest(input,init={}){
   const url=new URL(input);if(url.origin!==API_ORIGIN||!url.pathname.startsWith('/api/v1/')||url.username||url.password||url.hash||closed)throw new SourceLoginError();
   if(!['GET','POST'].includes(String(init.method??'GET').toUpperCase()))throw new SourceLoginError();
   signal?.throwIfAborted();const requestSignal=AbortSignal.any([signal,init.signal].filter(Boolean));
   const send=()=>{const headers=new Headers(init.headers);headers.delete('cookie');headers.set('Authorization',accessToken);return fetchImpl(url.href,{...init,headers,signal:requestSignal,redirect:'error'});};
   let response=await send();
   if(response.status===401){
    // The portal owns its OIDC refresh cycle; do not extract or persist refresh tokens.
    const before=tokenVersion;await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    for(let i=0;i<25&&tokenVersion===before;i++){requestSignal.throwIfAborted();await pause(400);}
    if(tokenVersion!==before){await response.body?.cancel();await pause(1000);response=await send();}
   }
   return response;
  }
  return{authorizedRequest,close};
 }catch(error){await close();if(signal?.aborted)throw signal.reason;throw error instanceof SourceLoginError?error:new SourceLoginError();}
}
