import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readProjectPresentation} from '../scraper/bouwberichten-auth.mjs';

let chromium;
try{({chromium}=await import('../scraper/node_modules/playwright/index.mjs'));}catch{}
const executablePath=process.env.PRESENTATION_TEST_BROWSER_PATH||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chromium?.executablePath()
].find(value=>value&&existsSync(value));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/64kAAAAASUVORK5CYII=','base64');
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const title='Project '+ 'lange volledige projectnaam '.repeat(8);
const url='https://portal.bouwberichten.nl/projecten/232259';
function html({photo='',spacer=0,noise}={}){
 const script=noise?`<script>const canvas=document.createElement('canvas');canvas.width=${noise[0]};canvas.height=${noise[1]};const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);let seed=7;for(let i=0;i<data.data.length;i+=4){for(let j=0;j<3;j++){seed=(1664525*seed+1013904223)>>>0;data.data[i+j]=seed>>>24;}data.data[i+3]=255;}ctx.putImageData(data,0,0);document.querySelector('.ImageSlider__image').src=canvas.toDataURL();</script>`:'';
 return `<!doctype html><main id="main"><h1>${escape(title)}</h1><dl><dt>Plan</dt><dd>Nieuwbouwplan</dd></dl><dl><dt>Hoofdaannemer</dt><dd>Testaannemer</dd><dt>Telefoon</dt><dd><a href="tel:0302222222">030-2222222</a></dd></dl><div style="height:${spacer}px"></div>${photo}</main>${script}`;
}
const photo=(src='https://management.bouwberichten.nl/test-project.png',name=title,width=320,height=180)=>`<img class="ImageSlider__image" loading="lazy" alt="${escape(name)}" src="${src}" style="width:${width}px;height:${height}px">`;

test('project presentation extraction against the real portal DOM contract', {skip:!chromium||!executablePath?'Install scraper dependencies and a Chromium browser to run the DOM checks':false}, async t=>{
 const browser=await chromium.launch({headless:true,executablePath});
 t.after(()=>browser.close());
 async function fixture(t,body,{delayImage=0,failNavigations=0}={}){
  const page=await browser.newPage();t.after(()=>page.close());
  const state={navigations:0,images:0,imageScrollY:[]};
  await page.route('**/*',async route=>{
   if(route.request().isNavigationRequest()){
    state.navigations++;
    if(state.navigations<=failNavigations)return route.abort('failed');
    return route.fulfill({status:200,contentType:'text/html',body});
   }
   state.images++;state.imageScrollY.push(await page.evaluate(()=>scrollY));
   if(delayImage)await new Promise(resolve=>setTimeout(resolve,delayImage));
   await route.fulfill({status:200,contentType:'image/png',body:PNG});
  });
  return{page,state};
 }
 await t.test('full source title and scrolling load a photograph that starts below the lazy-load threshold',async t=>{
  const {page,state}=await fixture(t,html({photo:photo(),spacer:6000}));
  await page.goto(url);await page.waitForTimeout(100);
  assert.equal(state.images,0,'The below-fold lazy image has not been requested before scrolling');
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'captured');assert.match(result.projectImage,/^data:image\/jpeg;base64,/);
  assert.ok(state.imageScrollY.every(value=>value>0),'Loading starts after the extractor scrolls the photograph into view');
  assert.equal(result.info.Plan,'Nieuwbouwplan');assert.equal(result.mainContractor.phone,'030-2222222');
 });
 await t.test('one delayed image load can finish during the bounded second load attempt',async t=>{
  const {page,state}=await fixture(t,html({photo:photo(),spacer:6000}),{delayImage:2200});
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'captured');assert.equal(state.images,1);
 });
 await t.test('a transient failed page navigation is retried once',async t=>{
  const {page,state}=await fixture(t,html({photo:photo()}),{failNavigations:1});
  assert.equal((await readProjectPresentation(page,232259,title)).imageStatus,'captured');
  assert.equal(state.navigations,2);
 });
 await t.test('persistent navigation failure stops after two attempts with a fixed diagnostic',async t=>{
  const {page,state}=await fixture(t,html(),{failNavigations:10});
  assert.deepEqual(await readProjectPresentation(page,232259,title),{imageStatus:'page_unavailable'});
  assert.equal(state.navigations,2);
 });
 await t.test('empty source galleries preserve project metadata without waiting for an image',async t=>{
  const {page}=await fixture(t,html({photo:'<div class="ImageSlider__placeholder" style="height:180px"></div>'}));
  const before=Date.now(),result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'not_found');assert.equal(result.projectImage,undefined);
  assert.equal(result.info.Plan,'Nieuwbouwplan');assert.equal(result.mainContractor.name,'Testaannemer');
  assert.ok(Date.now()-before<2000,'A known empty gallery must not add a full image timeout to each lead');
  const hinted=await readProjectPresentation(page,232259,title,{hasImage:false});
  assert.equal(hinted.imageStatus,'not_found');assert.equal(hinted.mainContractor.name,'Testaannemer');
 });
 await t.test('source error placeholders are not imported as project photographs',async t=>{
  const {page}=await fixture(t,html({photo:photo('/images/placeholder-Woningbouw.jpg')}));
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'placeholder');assert.equal(result.projectImage,undefined);
  assert.equal(result.info.Plan,'Nieuwbouwplan');
 });
 await t.test('an unrelated placeholder cannot hide the exact project photograph',async t=>{
  const {page}=await fixture(t,html({photo:'<div class="ImageSlider__placeholder" style="height:100px"></div>'+photo()}));
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'captured');assert.match(result.projectImage,/^data:image\/jpeg;base64,/);
 });
 await t.test('a matching logo or another project image cannot satisfy the exact project image selector',async t=>{
  const logo=`<img class="brand-logo" alt="${escape(title)}" src="data:image/png;base64,${PNG.toString('base64')}">`;
  const {page}=await fixture(t,html({photo:logo+photo(undefined,'Ander project')}));
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'not_found');assert.equal(result.projectImage,undefined);
  assert.equal(result.info.Plan,'Nieuwbouwplan');
 });
 await t.test('a large real photograph is recompressed below the existing 256 KiB limit',async t=>{
  const {page}=await fixture(t,html({photo:photo('',title,1024,768),noise:[1024,768]}));
  await page.goto(url);const image=page.locator('img.ImageSlider__image');
  await image.evaluate(element=>element.decode());
  const initial=await image.screenshot({type:'jpeg',quality:70,scale:'css'});
  assert.ok(initial.length>256*1024,'Fixture must exercise the oversize branch');
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'captured');
  assert.ok(Buffer.from(result.projectImage.split(',')[1],'base64').length<=256*1024);
 });
 await t.test('an image that remains oversized is skipped while preserving metadata',async t=>{
  const {page}=await fixture(t,html({photo:photo('',title,1600,1600),noise:[1600,1600]}));
  const result=await readProjectPresentation(page,232259,title);
  assert.equal(result.imageStatus,'too_large');assert.equal(result.projectImage,undefined);
  assert.equal(result.mainContractor.name,'Testaannemer');
 });
});
