const fail=message=>{throw new Error(message);};
const forbidden=part=>/^(?:__proto__|constructor|prototype|state|code|token|signature|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|passwd|secret|client[_-]?(?:id|secret)|code[_-]?verifier|code[_-]?challenge|redirect[_-]?uri|response[_-]?type|nonce|scope|session|cookie|credentials?)$/i.test(part);
const dateFields=new Set(['lastPublishedAt','firstPublishedAt','awardedAt','deliveredAt','registrationDeadline','startedAt']);
const amsterdamDate=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
function normalizeDate(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
 if(!match)fail('Gebruik een geldige datum in de filterlink.');
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 if(!year||month<1||month>12||day<1||day>days[month-1]||match[4]&&(Number(match[4])>23||Number(match[5])>59||Number(match[6])>59)||!Number.isFinite(Date.parse(value)))fail('Gebruik een geldige datum in de filterlink.');
 return match[4]?new Date(value).toISOString():value;
}

// Keep pairs rather than reconstructing nested objects from untrusted bracket keys.
export function normalizeBouwberichtenFilterUrl(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>16000)fail('Gebruik een Bouwberichten-filterlink van maximaal 16000 tekens.');
 let url;try{url=new URL(value.trim());}catch{fail('Gebruik een geldige Bouwberichten-filterlink.');}
 if(url.protocol!=='https:'||url.hostname!=='portal.bouwberichten.nl'||url.port||url.pathname!=='/projecten'||url.username||url.password||url.search)fail('Gebruik een filterlink van https://portal.bouwberichten.nl/projecten zonder inloggegevens of losse queryparameters.');
 const hash=url.hash.slice(1);try{if(!hash||/%(?![0-9a-f]{2})/i.test(hash))throw new Error();decodeURIComponent(hash.replace(/\+/g,' '));}catch{fail('De filterlink bevat een ongeldige filtercodering.');}
 const params=new URLSearchParams(hash),pairs=[...params];if(!pairs.length||pairs.length>200)fail('Gebruik maximaal 200 filterwaarden in de filterlink.');
 let hasCriteria=false;const normalized=new URLSearchParams(),seen=new Set(),phases=[],otherFields=new Set();let startDate='',endDate='';
 for(const [key,rawValue]of pairs){
  if(key.length>200||rawValue.length>2000||/[\u0000-\u001f\u007f]/.test(key+rawValue)||!/^projects(?:\[[A-Za-z0-9_.-]*\])+$/.test(key))fail('De filterlink bevat een ongeldige filterparameter.');
  const parts=[...key.matchAll(/\[([^\]]*)\]/g)].map(match=>match[1]);
  if(parts.some((part,index)=>!part&&index!==parts.length-1)||parts.some(part=>part.split('.').some(forbidden)))fail('De filterlink bevat een verboden aanmeld- of objectparameter.');
  const root=parts[0];if(!['filters','query','filterByUserFavorites','sort','page','savedSearch'].includes(root))fail('De filterlink bevat een onbekende projectparameter.');
  if(seen.has(key)&&parts.at(-1)!=='')fail('De filterlink bevat een dubbele enkelvoudige parameter.');seen.add(key);
  let itemValue=rawValue.trim();
  if(root==='filters'){
   if(parts.length<2||!parts[1])fail('De filterlink bevat een ongeldige projectfilter.');
   if(dateFields.has(parts[1])){if(parts.length!==3||!['start','end'].includes(parts.at(-1)))fail('De filterlink bevat een ongeldige datumfilter.');if(itemValue)itemValue=normalizeDate(itemValue);}
   if(itemValue){hasCriteria=true;if(parts[1]==='constructionPhase')phases.push(itemValue);else if(parts[1]!=='lastPublishedAt')otherFields.add(parts[1]);}
   if(parts[1]==='lastPublishedAt'&&parts.at(-1)==='start')startDate=itemValue;
   if(parts[1]==='lastPublishedAt'&&parts.at(-1)==='end')endDate=itemValue;
  }else if(root==='query'){
   if(parts.length!==1)fail('De zoektekst in de filterlink is ongeldig.');if(itemValue)hasCriteria=true;
  }else if(root==='filterByUserFavorites'){
   if(parts.length!==1||!['true','false'].includes(itemValue))fail('De favorietenfilter in de link is ongeldig.');if(itemValue==='true')hasCriteria=true;
  }else if(root==='page'){
   if(parts.length!==1||!/^\d{1,7}$/.test(itemValue))fail('Het paginanummer in de filterlink is ongeldig.');itemValue=String(Number(itemValue));
  }else if(root==='savedSearch'){
   if(parts.length!==1||!/^\d{1,20}$/.test(itemValue))fail('Het zoekopdracht-ID in de filterlink is ongeldig.');
  }else if(root==='sort'){
   if(parts.length!==2||!['id','order'].includes(parts[1])||parts[1]==='order'&&!['asc','desc'].includes(itemValue)||parts[1]==='id'&&(!/^[A-Za-z0-9_.-]{1,100}$/.test(itemValue)||itemValue.split('.').some(forbidden)))fail('De sortering in de filterlink is ongeldig.');
  }
  normalized.append(key,itemValue);
 }
 if(!hasCriteria)fail('Deze link bevat geen expliciete filters. Kies eerst de gewenste filters; alleen een opgeslagen zoekopdracht-ID is niet voldoende.');
 normalized.sort();const filterParameters=[...normalized],summary=[];
 if(phases.length)summary.push([...new Set(phases)].join(', '));if(startDate)summary.push('vanaf '+amsterdamDate(startDate));if(endDate)summary.push('t/m '+amsterdamDate(endDate));
 if(otherFields.size)summary.push(`${otherFields.size} andere ${otherFields.size===1?'filter':'filters'}`);
 const extraSummary=[];if(normalized.get('projects[query]'))extraSummary.push('Zoektekst ingesteld');if(normalized.get('projects[filterByUserFavorites]')==='true')extraSummary.push('Eigen favorieten');
 const filterUrl='https://portal.bouwberichten.nl/projecten#'+normalized.toString();if(filterUrl.length>16000)fail('Gebruik een Bouwberichten-filterlink van maximaal 16000 tekens.');
 return{filterUrl,filterParameters,filterSummary:[summary.join(' '),...extraSummary].filter(Boolean).join(' · ')};
}
