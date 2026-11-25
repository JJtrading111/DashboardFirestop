import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const appSource=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
const filterUrl='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const selectorKey=value=>value.replace(/["']/g,'');

// These fixed DOM nodes model an already-open dialog. They deliberately cannot
// parse HTML: replacing any dialog structure is a test failure, even if a form
// is later put back. Production polling, rendering and update code remain live.
function modalFixture(){
 const writes=[],structureWrites=[],intervals=new Map(),requests=[],messages=[],listeners={};
 function node(name,initial={}){
  const attributes=new Map(),children=new Map(),values={textContent:'',className:'',hidden:false,disabled:false,checked:false,scrollTop:0,...initial};
  const result={nodeName:name,dataset:{},isConnected:true,children,
   querySelector(selector){const key=selectorKey(selector);if(children.has(key))return children.get(key);throw Error('Unmodelled DOM selector: '+name+' '+selector);},
   querySelectorAll(selector){if(selector==='input:not([type=hidden]),button')return result.controls;throw Error('Unmodelled DOM list: '+selector);},
   getAttribute:key=>attributes.get(key)??null,
   setAttribute(key,value){writes.push([name,key,String(value)]);attributes.set(key,String(value));},
   removeAttribute(key){writes.push([name,key,null]);attributes.delete(key);},
   hasAttribute:key=>attributes.has(key),
   contains:target=>target===result||[...children.values()].includes(target),
   closest:()=>null,
   matches:selector=>selector==='input,select,textarea'&&['password','username','time'].includes(name),
   focus(){writes.push([name,'focus']);document.activeElement=result;},
   replaceWith(){structureWrites.push(name+'.replaceWith');throw Error('Dialog node replaced');},
  };
  for(const key of Object.keys(values))Object.defineProperty(result,key,{enumerable:true,get:()=>values[key],set:value=>{writes.push([name,key,value]);values[key]=value;}});
  Object.defineProperty(result,'innerHTML',{get:()=>'',set:()=>{structureWrites.push(name+'.innerHTML');throw Error('Dialog structure replaced');}});
  result.classList={toggle(name,enabled){const classes=new Set(result.className.split(/\s+/).filter(Boolean));if(enabled===undefined)enabled=!classes.has(name);if(enabled)classes.add(name);else classes.delete(name);const value=[...classes].join(' ');if(value!==result.className)result.className=value;},remove(){},add(){}};
  return result;
 }
 const root=node('overlay'),modal=node('modal'),body=node('body',{scrollTop:233}),form=node('form'),app={set innerHTML(value){this.lastHTML=value;}};
 modal.dataset.scraperSourceId='source-a';form.dataset.sourceId='source-a';
 const username=node('username',{value:'edited-user@example.test',type:'text'}),password=node('password',{value:'unsubmitted-secret',type:'text',selectionStart:4,selectionEnd:12,selectionDirection:'forward'}),submit=node('submit'),toggle=node('toggle'),schedule=node('schedule'),time=node('time',{value:'06:00',type:'time'}),saveTime=node('save-time');
 form.controls=[username,password,submit,toggle];
 for(const selector of ['[type=submit]','[type="submit"]'])form.children.set(selectorKey(selector),submit);
 form.children.set('[name=username]',username);form.children.set('[name=password]',password);
 const fields=new Map();
 for(const hook of ['status','worker','missing-filter','unavailable','offline','action-error','plan-help','schedule-error','started','finished','processed-label','processed','counts','excluded','empty','source-error','filter-summary','filter-link','filter-url']){const field=node(hook);fields.set(hook,field);modal.children.set('[data-scraper-'+hook+']',field);}
 for(const count of ['created','updated','unchanged','excluded']){const field=node('count-'+count);fields.set('count-'+count,field);modal.children.set('[data-scraper-count='+count+']',field);}
 const title=node('title');fields.set('title',title);modal.children.set('#modal-title',title);modal.children.set('#source-scraper-form',form);modal.children.set('.modal-body',body);modal.children.set('[data-scraper-schedule]',schedule);modal.children.set('.modal-header h2',title);
 modal.children.set('[data-scraper-time]',time);modal.children.set('#scraper-daily-time',time);modal.children.set('[data-action=save-source-scraper-time]',saveTime);
 for(const action of ['test-source-scraper','run-source-scraper','disconnect-source-scraper'])modal.children.set('[data-action='+action+']',node(action));
 root.children.set('.modal',modal);root.children.set('.detail-body',null);root.children.set('#source-scraper-form',form);
 const document={hidden:false,activeElement:password,body:node('document-body'),addEventListener(type,listener){listeners[type]=listener;},querySelector(selector){if(selector==='#app')return app;if(selector==='#overlay-root')return root;if(selector==='.modal')return root.children.get('.modal');if(selector==='#source-scraper-form')return form;return modal.querySelector(selector);}};
 const context=vm.createContext({URL,URLSearchParams,Date,Intl,document,window:{addEventListener(){}},location:{hash:'#sources',pathname:'/',search:'',origin:'https://dashboard.example.test'},localStorage:{getItem:()=>null,setItem(){}},setInterval:(fn,ms)=>{intervals.set(ms,fn);return ms;},requestAnimationFrame:fn=>fn(),fetch:async()=>new Promise(resolve=>requests.push(resolve)),recordToast:(text,tone)=>messages.push({text,tone})});
 assert.equal([...appSource.matchAll(/^initialize\(\);\r?$/gm)].length,1);
 const source=appSource.replace(/^import .* from '\.\/model\.mjs';\r?\n/,'').replace(/^initialize\(\);\r?$/m,'');
 new vm.Script(source,{filename:'public/app.mjs'}).runInContext(context);
 const state={users:[{id:'chief',name:'Eigenaar',role:'hoofdbeheerder',companyId:'company-1'}],companies:[{id:'company-1',name:'Bedrijf',columns:[]}],leads:[],sources:[{id:'source-a',name:'Selectie A',provider:'bouwberichten',filterUrl,scraper:{available:true,configured:true,status:'ready',workerOnline:true,lastTestPassed:false,lastProcessed:0,lastTotal:24}},{id:'source-b',name:'Selectie B',provider:'bouwberichten',filterUrl,scraper:{available:true,configured:true,status:'ready',workerOnline:true,lastProcessed:0,lastTotal:24}}]};
 context.initialState=state;
 new vm.Script(`state=initialState;session={authenticated:true};ui.userId='chief';ui.companyId='company-1';ui.modal={type:'source-scraper',id:'source-a'};renderPage=()=>'';renderToasts=()=>{};toast=(text,tone)=>recordToast(text,tone);globalThis.inspectState=()=>state;globalThis.inspectModal=()=>ui.modal;`).runInContext(context);
 function snapshot(overrides={},sourceOverrides={}){const next=structuredClone(state);Object.assign(next.sources[0].scraper,overrides);Object.assign(next.sources[0],sourceOverrides);return{state:next,userId:'chief',companyId:'company-1'};}
 return{context,root,modal,body,form,username,password,submit,fields,document,writes,structureWrites,requests,messages,snapshot,listeners,
  async respond(index,value){requests[index]({ok:true,json:async()=>value});},
  poll:ms=>intervals.get(ms)(),
  run:code=>vm.runInContext(code,context),
  assertPreserved(){assert.equal(root.children.get('.modal'),modal);assert.equal(modal.querySelector('#source-scraper-form'),form);assert.equal(form.querySelector('[name=password]'),password);assert.equal(username.value,'edited-user@example.test');assert.equal(password.value,'unsubmitted-secret');assert.equal(password.type,'text');assert.equal(password.selectionStart,4);assert.equal(password.selectionEnd,12);assert.equal(password.selectionDirection,'forward');assert.equal(document.activeElement,password);assert.equal(body.scrollTop,233);assert.deepEqual(structureWrites,[]);},
 };
}

test('the source card starts the full filter import manually while daily fetching is enabled',async()=>{
 const f=modalFixture(),calls=[];
 f.context.recordManual=(...args)=>calls.push(args);
 f.run(`ui.modal=null;state.sources[0].importEnabled=true;
  Object.assign(state.sources[0].scraper,{status:'active',lastTestPassed:true,scheduleEnabled:true});
  openModal=(type,id)=>{ui.modal={type,id};recordManual('open',type,id);};
  scraperAction=async(type,id)=>{recordManual('queue',type,id);};`);
 const card=f.run('sourceManualRunButton(state.sources[0])');
 assert.match(card,/data-action="run-source-scraper"/);assert.doesNotMatch(card,/disabled/);
 const target={dataset:{action:'run-source-scraper',id:'source-a'},closest(){return this;},matches(){return false;}};
 await f.listeners.click({target,preventDefault(){}});
 assert.deepEqual(calls,[['open','source-scraper','source-a'],['queue','source.scraper.run','source-a']]);
 f.run("state.sources[0].scraper.status='running';");
 assert.match(f.run('sourceManualRunButton(state.sources[0])'),/disabled title="Er staat al een ophaalronde/);
 await f.listeners.click({target,preventDefault(){}});assert.equal(calls.length,2);
});

test('ten-second polling updates status and progress in place while preserving the complete open dialog and an unfinished password',async()=>{
 const f=modalFixture();
 const polling=f.poll(10000);await f.respond(0,f.snapshot({status:'running',jobMode:'test',lastProcessed:3,lastTotal:24}));await polling;
 f.assertPreserved();assert.match(f.fields.get('status').textContent,/Proef bezig/);assert.match(f.fields.get('processed').textContent,/3 van 24 projecten/);assert.deepEqual(f.messages,[]);
 f.writes.length=0;
 const unchanged=f.poll(10000);await f.respond(1,f.snapshot({status:'running',jobMode:'test',lastProcessed:3,lastTotal:24}));await unchanged;
 f.assertPreserved();assert.deepEqual(f.writes,[],'unchanged polling must not rewrite even text, classes, focus or controls');
});

test('a newer thirty-second response wins over an outstanding ten-second response without rebuilding the popup',async()=>{
 const f=modalFixture(),old=f.poll(10000),newer=f.poll(30000);
 await f.respond(1,f.snapshot({status:'test_passed',lastTestPassed:true,lastProcessed:5,lastTotal:24,lastCounts:{created:5,updated:0,unchanged:0}}));await newer;
 await f.respond(0,f.snapshot({status:'running',lastProcessed:1,lastTotal:24}));await old;
 f.assertPreserved();assert.equal(f.context.inspectState().sources[0].scraper.lastProcessed,5);assert.match(f.fields.get('status').textContent,/Proef geslaagd/);assert.equal(f.fields.get('count-created').textContent,'5');assert.deepEqual(f.messages,[]);
});

test('polling shows excluded projects without rebuilding the login form and clears their display for a later ordinary round',async()=>{
 const f=modalFixture(),polling=f.poll(10000);
 await f.respond(0,f.snapshot({status:'test_passed',lastTestPassed:true,lastProcessed:5,lastTotal:5,lastCounts:{created:0,updated:0,unchanged:0,excluded:5}}));await polling;
 f.assertPreserved();assert.equal(f.fields.get('excluded').hidden,false);assert.equal(f.fields.get('count-excluded').textContent,'5');assert.equal(f.fields.get('counts').hidden,false);assert.deepEqual(f.messages,[]);
 const next=f.poll(10000);await f.respond(1,f.snapshot({status:'test_passed',lastTestPassed:true,lastProcessed:1,lastTotal:1,lastCounts:{created:1,updated:0,unchanged:0}}));await next;
 f.assertPreserved();assert.equal(f.fields.get('excluded').hidden,true);assert.equal(f.fields.get('count-excluded').textContent,'0');assert.deepEqual(f.messages,[]);
});

test('a thirty-second refresh started before opening the dialog preserves it when its response renders the dashboard',async()=>{
 const f=modalFixture();f.run('ui.modal=null;');f.document.activeElement=null;
 const polling=f.poll(30000);
 f.run("ui.modal={type:'source-scraper',id:'source-a'};");f.document.activeElement=f.password;
 await f.respond(0,f.snapshot({status:'running',jobMode:'test',lastProcessed:2,lastTotal:24}));await polling;
 f.assertPreserved();assert.match(f.fields.get('status').textContent,/Proef bezig/);assert.match(f.fields.get('processed').textContent,/2 van 24 projecten/);assert.deepEqual(f.messages,[]);
});

test('periodic status changes preserve an actionable connection error alongside the unfinished login fields',async()=>{
 const f=modalFixture();f.run("ui.modal.scraperError='Controleer de bronaanmelding en probeer opnieuw.';");
 const polling=f.poll(10000);await f.respond(0,f.snapshot({status:'login_required',lastError:'Opnieuw inloggen bij Bouwberichten is nodig.'}));await polling;
 f.assertPreserved();assert.equal(f.fields.get('action-error').textContent,'Controleer de bronaanmelding en probeer opnieuw.');assert.equal(f.fields.get('action-error').hidden,false);assert.match(f.fields.get('source-error').textContent,/Opnieuw inloggen/);assert.deepEqual(f.messages,[]);
});

test('a remotely renamed source and changed public selection update the existing dialog title and filter nodes',async()=>{
 const f=modalFixture(),nextFilter='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Uitvoering';
 const summary=f.fields.get('filter-summary'),link=f.fields.get('filter-link'),url=f.fields.get('filter-url'),title=f.fields.get('title');
 const polling=f.poll(10000);await f.respond(0,f.snapshot({},{name:'Selectie na wijziging',filterUrl:nextFilter,filterSummary:'Uitvoering vanaf 01-02-2026'}));await polling;
 f.assertPreserved();assert.equal(f.modal.querySelector('[data-scraper-filter-summary]'),summary);assert.equal(f.modal.querySelector('[data-scraper-filter-link]'),link);assert.equal(f.modal.querySelector('[data-scraper-filter-url]'),url);
 assert.equal(summary.textContent,'Uitvoering vanaf 01-02-2026');assert.equal(link.getAttribute('href'),nextFilter);assert.equal(link.hidden,false);assert.equal(url.textContent,nextFilter);assert.equal(title.textContent,'Automatisch ophalen · Selectie na wijziging');assert.deepEqual(f.messages,[]);
});

test('late polling cannot reopen a closed popup or repaint a different or newly opened instance of the same source',async()=>{
 for(const nextModal of [null,{type:'source-scraper',id:'source-b'},{type:'source-scraper',id:'source-a'}]){
  const f=modalFixture(),pending=f.poll(10000);
  f.context.nextModal=nextModal;f.run('ui.modal=nextModal;');
  f.writes.length=0;
  await f.respond(0,f.snapshot({status:'running',lastProcessed:3,lastTotal:24}));await pending;
  assert.equal(f.context.inspectModal(),nextModal);assert.deepEqual(f.writes,[]);assert.deepEqual(f.structureWrites,[]);assert.deepEqual(f.messages,[]);
 }
});
