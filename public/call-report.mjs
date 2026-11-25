const DAY=86400000;
const array=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const timestamp=value=>value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'&&value?Date.parse(value):NaN;
const zoneFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});
const dayLabel=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
const monthLabel=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',month:'long',year:'numeric'});
const civilTime=day=>Date.parse(day+'T12:00:00.000Z');
const civilDay=value=>new Date(value).toISOString().split('T')[0];
const shift=(day,days)=>civilDay(civilTime(day)+days*DAY);
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1&&Number.isFinite(civilTime(value))&&civilDay(civilTime(value))===value;
const localDay=value=>{const parts=Object.fromEntries(zoneFormatter.formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return`${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`;};

function bucket(day,groupBy){
 if(groupBy==='month'){
  const start=day.slice(0,7)+'-01',date=new Date(civilTime(start));date.setUTCMonth(date.getUTCMonth()+1,0);
  return{key:day.slice(0,7),label:monthLabel.format(civilTime(start)),start,end:civilDay(date)};
 }
 if(groupBy==='week'){
  const weekday=new Date(civilTime(day)).getUTCDay()||7,start=shift(day,1-weekday),thursday=shift(start,3),year=new Date(civilTime(thursday)).getUTCFullYear();
  const january=new Date(civilTime(thursday));january.setUTCMonth(0,4);const januaryFourth=civilDay(january),januaryWeekday=january.getUTCDay()||7,firstMonday=shift(januaryFourth,1-januaryWeekday);
  const number=1+Math.round((civilTime(start)-civilTime(firstMonday))/(7*DAY));
  return{key:String(year).padStart(4,'0')+'-W'+String(number).padStart(2,'0'),label:'Week '+number+' · '+year,start,end:shift(start,6)};
 }
 return{key:day,label:dayLabel.format(civilTime(day)),start:day,end:day};
}

// The server supplies the authorized company scope. Canonical call identities
// count actual telephone registrations, including repeated calls to one lead.
export function buildCallReport(state,{companyId='all',sellerId='all',groupBy='day',from='',to='',now=Date.now()}={}){
 const empty=error=>({error,groupBy,from,to,rows:[],periods:[],totals:{calls:0,users:0,companies:0,byPeriod:{}}});
 if(!['day','week','month'].includes(groupBy))return empty('Kies een geldige indeling: dag, week of maand.');
 if(typeof from!=='string'||typeof to!=='string'||from&&!validDay(from)||to&&!validDay(to))return empty('Kies geldige begin- en einddatums.');
 if(from&&to&&from>to)return empty('Kies een einddatum op of na de begindatum.');
 if(from&&to&&(civilTime(to)-civilTime(from))/DAY>3660)return empty('Kies een periode van maximaal 10 jaar, of laat de datumfilters leeg voor alle geregistreerde belmomenten.');
 const instant=timestamp(now);if(!Number.isFinite(instant))return empty('Het peilmoment voor de belrapportage is ongeldig.');
 const companies=new Map([...array(state?.archivedCompanies),...array(state?.companies)].filter(company=>text(company?.id)).map(company=>[company.id,text(company.name)||'Onbekend bedrijf']));
 const users=new Map(array(state?.users).filter(user=>text(user?.id)).map(user=>[user.id,user]));
 const calls=[],ids=new Set(),signatures=new Set();
 function accept(call,contextCompany,contextLead,{fallback=false}={}){
  if(!call||typeof call!=='object')return;
  const cid=text(contextCompany||call.companyId),at=timestamp(call.at);if(!companies.has(cid)||!Number.isFinite(at)||at>instant)return;
  const userId=text(call.userId),snapshot=text(call.userName),name=snapshot||text(users.get(userId)?.name)||'Onbekende gebruiker';
  const leadId=text(contextLead||call.leadId),signature=JSON.stringify([cid,leadId,at,userId||snapshot]);
  const id=text(call.id),identity=id?'id:'+id:'legacy:'+signature;
  if(ids.has(identity)||fallback&&signatures.has(signature))return;
  ids.add(identity);signatures.add(signature);
  const actorId=userId||'legacy:'+JSON.stringify([cid,snapshot||'Onbekende gebruiker']);
  calls.push({id:identity,companyId:cid,sellerId:actorId,sellerName:name,at,day:localDay(at)});
 }
 // First occurrence in callLog is authoritative, even when an outcome later
 // enriched its workspace copy. Filtering happens after global deduplication.
 for(const call of array(state?.callLog))accept(call);
 for(const [cid,workspace]of Object.entries(state?.workspaces||{}))if(companies.has(cid))for(const [leadId,w]of Object.entries(workspace||{}))for(const call of array(w?.calls))accept(call,cid,leadId,{fallback:true});
 const rows=new Map(),periods=new Map();
 function userRow(id,name){
  if(!rows.has(id))rows.set(id,{sellerId:id,sellerName:name,companyNames:[],companyIds:[],periods:{},total:0,_companies:new Set(),_nameAt:-Infinity});
  return rows.get(id);
 }
 for(const user of users.values()){
  if(user.status!=='actief'||user.companyId&&!companies.has(user.companyId)||companyId!=='all'&&user.companyId!==companyId||sellerId!=='all'&&user.id!==sellerId)continue;
  const row=userRow(user.id,text(user.name)||'Onbekende gebruiker');if(companies.has(user.companyId))row._companies.add(user.companyId);
 }
 if(from&&to){
  for(let day=from;day<=to;){const period=bucket(day,groupBy);periods.set(period.key,period);if(civilTime(period.end)>=civilTime(to))break;day=shift(period.end,1);}
 }
 const countedCompanies=new Set();let count=0;
 for(const call of calls){
  if(companyId!=='all'&&call.companyId!==companyId||sellerId!=='all'&&call.sellerId!==sellerId||from&&call.day<from||to&&call.day>to)continue;
  const period=bucket(call.day,groupBy);periods.set(period.key,period);
  const row=userRow(call.sellerId,call.sellerName);
  if(!row.total)row._companies.clear(); // Counted history supplies the company attribution.
  row._companies.add(call.companyId);row.total++;row.periods[period.key]=(row.periods[period.key]||0)+1;
  if(call.at>row._nameAt){row.sellerName=call.sellerName;row._nameAt=call.at;}
  countedCompanies.add(call.companyId);count++;
 }
 const orderedPeriods=[...periods.values()].sort((a,b)=>a.start.localeCompare(b.start));
 const orderedRows=[...rows.values()].map(row=>({sellerId:row.sellerId,sellerName:row.sellerName,
  companyIds:[...row._companies].sort((a,b)=>companies.get(a).localeCompare(companies.get(b),'nl')||a.localeCompare(b)),
  companyNames:[...row._companies].map(id=>companies.get(id)).sort((a,b)=>a.localeCompare(b,'nl')),
  periods:Object.fromEntries(orderedPeriods.map(period=>[period.key,row.periods[period.key]||0])),total:row.total
 })).sort((a,b)=>b.total-a.total||a.sellerName.localeCompare(b.sellerName,'nl')||a.sellerId.localeCompare(b.sellerId));
 const byPeriod=Object.fromEntries(orderedPeriods.map(period=>[period.key,orderedRows.reduce((total,row)=>total+row.periods[period.key],0)]));
 return{error:'',groupBy,from,to,rows:orderedRows,periods:orderedPeriods,totals:{calls:count,users:orderedRows.filter(row=>row.total>0).length,companies:countedCompanies.size,byPeriod}};
}
