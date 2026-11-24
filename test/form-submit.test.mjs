import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const appSource=await readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
const sourceId='source-bouw-form-regression';
const filterUrl='https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';

// A native HTMLFormElement exposes named controls as properties. DOM shims do
// not consistently reproduce this: an input name="id" can shadow form.id.
function clobberedForm(id,values){
 const controls=Object.entries(values).map(([name,value])=>({nodeName:'INPUT',name,value,type:name==='id'?'hidden':name==='password'?'password':'text'}));
 const submit={disabled:false,isConnected:true};
 const form={
  controls,submit,
  getAttribute:name=>name==='id'?id:null,
  querySelector:selector=>selector==='[type="submit"]'?submit:selector==='[name="password"]'?controls.find(control=>control.name==='password'):null,
 };
 Object.defineProperty(form,'id',{value:controls.find(control=>control.name==='id'),enumerable:true});
 assert.equal(form.id.nodeName,'INPUT');assert.notEqual(form.id,id);
 return form;
}

function frontendFixture({modalType='source-scraper',mutationError=null,beforeMutation=()=>{}}={}){
 const listeners=new Map(),mutations=[],messages=[],renderCalls=[];
 const context=vm.createContext({
  URLSearchParams,
  location:{hash:'#sources',pathname:'/',search:'',origin:'https://dashboard.example.test'},
  localStorage:{getItem:()=>null},
  document:{addEventListener:(name,listener)=>listeners.set(name,listener)},
  window:{addEventListener(){}},
  setInterval:()=>0,
  FormData:class{
   constructor(form){this.values=form.controls.map(({name,value})=>[name,value]);}
   *[Symbol.iterator](){yield* this.values;}
  },
  recordMutation:async(type,payload)=>{
   beforeMutation();mutations.push({type,payload:JSON.parse(JSON.stringify(payload))});
   if(mutationError)throw mutationError;return{};
  },
  recordRender:name=>renderCalls.push(name),
  recordToast:(text,tone)=>messages.push({text,tone}),
 });
 // Keep all production event listeners and routing functions. Suppress only
 // automatic boot; imported model functions are unused in these two flows.
 assert.match(appSource,/^import .* from '\.\/model\.mjs';\r?$/m);
 assert.equal([...appSource.matchAll(/^initialize\(\);\r?$/gm)].length,1);
 const script=appSource.replace(/^import .* from '\.\/model\.mjs';\r?\n/,'').replace(/^initialize\(\);\r?$/m,'');
 new vm.Script(script,{filename:'public/app.mjs'}).runInContext(context);
 new vm.Script(`
  state={users:[{id:'chief',role:'hoofdbeheerder',companyId:'company-1'}],companies:[{id:'company-1',name:'Bedrijf'}],sources:[{id:${JSON.stringify(sourceId)},provider:'bouwberichten',name:'Bouwfilter',filterUrl:${JSON.stringify(filterUrl)}}]};
  session={authenticated:true};ui.userId='chief';ui.companyId='company-1';ui.modal={type:${JSON.stringify(modalType)},id:${JSON.stringify(sourceId)}};
  mutate=async(type,payload)=>recordMutation(type,payload);
  render=()=>recordRender('render');renderOverlay=()=>recordRender('overlay');toast=(text,tone)=>recordToast(text,tone);
  globalThis.inspectUI=()=>JSON.stringify({ui,state,transient,authError});
 `).runInContext(context);
 assert.equal(typeof listeners.get('submit'),'function');
 return{mutations,messages,renderCalls,inspectUI:context.inspectUI,async submit(form){let prevented=false;await listeners.get('submit')({target:form,preventDefault(){prevented=true;}});assert.equal(prevented,true);}};
}

test('a source login form routes despite hidden name=id shadowing form.id and clears its password before submission',async()=>{
 const password='only-a-regression-fixture-password';
 const form=clobberedForm('source-scraper-form',{id:sourceId,username:'  login@example.test  ',password});
 const fixture=frontendFixture({beforeMutation:()=>assert.equal(form.querySelector('[name="password"]').value,'')});
 await fixture.submit(form);
 assert.deepEqual(fixture.mutations,[{type:'source.scraper.configure',payload:{id:sourceId,username:'login@example.test',password}}]);
 assert.equal(form.querySelector('[name="password"]').value,'');
 assert.equal(fixture.inspectUI().includes(password),false);
 assert.equal(fixture.messages.some(message=>message.text.includes(password)),false);
 assert.match(fixture.messages.at(-1).text,/proef met 5 projecten is ingepland/);
 assert.deepEqual(fixture.renderCalls,['overlay','render']);
});

test('an existing source editor with a shadowed form.id still updates its hidden source identity',async()=>{
 const form=clobberedForm('source-form',{id:sourceId,name:'  Gewijzigd Bouwfilter  ',provider:'bouwberichten',filterUrl:'  '+filterUrl+'  ',url:'  https://portal.bouwberichten.nl/projecten  ',username:'  organisatie@example.test  '});
 const fixture=frontendFixture({modalType:'source-config'});
 await fixture.submit(form);
 assert.deepEqual(fixture.mutations,[{type:'source.update',payload:{id:sourceId,name:'Gewijzigd Bouwfilter',provider:'bouwberichten',filterUrl,url:'https://portal.bouwberichten.nl/projecten',username:'organisatie@example.test'}}]);
 assert.match(fixture.messages.at(-1).text,/Bron opgeslagen/);
 assert.deepEqual(fixture.renderCalls,['render']);
 assert.equal(JSON.parse(fixture.inspectUI()).ui.modal,null);
});

test('a rejected source connection also clears the shadowed form password and leaves no secret in UI state',async()=>{
 const password='discard-after-rejected-regression';
 const form=clobberedForm('source-scraper-form',{id:sourceId,username:'login@example.test',password});
 const fixture=frontendFixture({mutationError:new Error('Bronverbinding tijdelijk niet beschikbaar.')});
 await fixture.submit(form);
 assert.equal(fixture.mutations.length,1);
 assert.equal(form.querySelector('[name="password"]').value,'');
 assert.equal(fixture.inspectUI().includes(password),false);
 assert.deepEqual(fixture.messages,[{text:'Bronverbinding tijdelijk niet beschikbaar.',tone:'amber'}]);
 assert.equal(JSON.parse(fixture.inspectUI()).ui.modal.scraperBusy,false);
});
