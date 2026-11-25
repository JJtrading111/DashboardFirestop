import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');

export function prepareBatches(input,runId){
 const items=Array.isArray(input)?input:input?.items;
 if(!Array.isArray(items))throw Error('Gebruik een JSON-lijst of een object met een items-lijst.');
 const seen=new Set();
 for(const item of items){
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.title!=='string'||!item.title.trim())throw Error('Ieder project moet een titel hebben.');
  let url;
  if(item.sourceUrl){try{url=new URL(item.sourceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();url.hash='';}catch{throw Error('Een project bevat een ongeldige bronlink.');}}
  const key=typeof item.externalId==='string'&&item.externalId.trim()?item.externalId.trim():url?'url:'+hash(url.href):null;
  if(!key)throw Error('Ieder project heeft een externalId of een bronlink nodig.');
  if(seen.has(key))throw Error('De invoer bevat meerdere projecten met dezelfde bronidentiteit.');
  seen.add(key);
 }
 const identity=runId??(!Array.isArray(input)?input?.runId:undefined)??'file-'+hash(JSON.stringify(items)).slice(0,40);
 if(typeof identity!=='string'||!identity.trim()||identity.length>100)throw Error('Gebruik een run-id van 1 tot 100 tekens.');
 const batches=[];let pending=[];
 const body=entries=>({runId:identity.trim()+':'+(batches.length+1),items:entries});
 for(const item of items){
  const candidate=[...pending,item];
  if(candidate.length>100||Buffer.byteLength(JSON.stringify(body(candidate)))>MAX_BYTES){
   if(!pending.length)throw Error('Eén project is groter dan de maximale importgrootte.');
   batches.push(body(pending));pending=[item];
   if(Buffer.byteLength(JSON.stringify(body(pending)))>MAX_BYTES)throw Error('Eén project is groter dan de maximale importgrootte.');
  }else pending=candidate;
 }
 if(pending.length)batches.push(body(pending));
 return{total:items.length,batches};
}

function endpoint(value){
 let url;try{url=new URL(value);}catch{throw Error('Stel BOUWBERICHTEN_IMPORT_URL in op het importadres uit het dashboard.');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(!(url.protocol==='https:'||url.protocol==='http:'&&local)||url.username||url.password||url.search||url.hash||!/^\/api\/import\/sources\/[^/]+\/leads$/.test(url.pathname))throw Error('Gebruik een HTTPS-importadres zonder inloggegevens of queryparameters.');
 return url.href;
}

export async function sendImport({input,runId,url,token,dryRun=false,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const prepared=prepareBatches(input,runId);
 if(dryRun||!prepared.total)return{dryRun,total:prepared.total,batches:prepared.batches.length,sent:0};
 const target=endpoint(url);
 if(typeof token!=='string'||token.trim().length<32||/[\r\n]/.test(token))throw Error('Stel BOUWBERICHTEN_IMPORT_TOKEN in via de geheime omgevingsvariabelen van de scraper.');
 const totals={created:0,updated:0,unchanged:0};
 for(const batch of prepared.batches){
  const body=JSON.stringify(batch);let result;
  for(let attempt=0;attempt<3;attempt++){
   let response;
   try{response=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token.trim()},body,redirect:'error',signal:AbortSignal.timeout(30000)});}
   catch{if(attempt===2)throw Error('De importserver is niet bereikbaar. Herhaal dezelfde invoer om veilig verder te gaan.');await sleep(500*2**attempt);continue;}
   if([429,500,502,503,504].includes(response.status)&&attempt<2){await sleep(500*2**attempt);continue;}
   if(!response.ok)throw Error(`Import geweigerd (HTTP ${response.status}). Controleer de bronstatus, importsleutel en invoer.`);
   try{result=await response.json();}catch{throw Error('De importserver gaf geen geldig antwoord.');}
   if(!result?.counts||['created','updated','unchanged'].some(k=>!Number.isSafeInteger(result.counts[k])||result.counts[k]<0)||result.counts.excluded!==undefined&&(!Number.isSafeInteger(result.counts.excluded)||result.counts.excluded<0))throw Error('De importserver gaf geen geldige aantallen terug.');
   break;
  }
  for(const key of ['created','updated','unchanged'])totals[key]+=result.counts[key];
  if(result.counts.excluded)totals.excluded=(totals.excluded||0)+result.counts.excluded;
 }
 return{dryRun:false,total:prepared.total,batches:prepared.batches.length,sent:prepared.total,counts:totals};
}

async function main(){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--help'){console.log('node scripts/import-leads.mjs --file projecten.json [--run-id naam] [--dry-run]\nGeheimen: BOUWBERICHTEN_IMPORT_URL en BOUWBERICHTEN_IMPORT_TOKEN.');return;}
  if(key==='--dry-run'){options.dryRun=true;continue;}
  if(!['--file','--run-id'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Gebruik --file projecten.json, eventueel --run-id naam en --dry-run.');
  options[key==='--file'?'file':'runId']=args[++i];
 }
 if(!options.file)throw Error('Geef een JSON-bestand op met --file.');
 let input;try{input=JSON.parse(await readFile(options.file,'utf8'));}catch{throw Error('Het invoerbestand kan niet als JSON worden gelezen.');}
 console.log(JSON.stringify(await sendImport({...options,input,url:process.env.BOUWBERICHTEN_IMPORT_URL,token:process.env.BOUWBERICHTEN_IMPORT_TOKEN})));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
