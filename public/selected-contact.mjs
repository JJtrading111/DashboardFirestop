const fields=['role','name','contact','phone','email','website'];
const word=value=>typeof value==='string'?value.trim():'';
const unknown=new Set(['organisatie nog niet bekend','contactpersoon nog niet bekend','nog niet bekend','onbekend']);
const actual=value=>!!word(value)&&!unknown.has(word(value).toLocaleLowerCase('nl-NL'));
const snapshot=value=>Object.fromEntries(fields.map(field=>[field,word(value?.[field])]));

// Public comparison data only: exact field content avoids ambiguous hash collisions.
export function contactFingerprint(contact){return JSON.stringify(fields.map(field=>word(contact?.[field])));}

export function effectiveLeadContact(lead,workspace={}){
 if(workspace?.selectedContact&&typeof workspace.selectedContact==='object'&&!Array.isArray(workspace.selectedContact))return snapshot(workspace.selectedContact);
 const details=lead?.projectDetails??{};
 return snapshot({role:details.primaryRole,name:lead?.organization,contact:workspace?.lastContactPerson||lead?.contact,phone:lead?.phone,email:lead?.email,website:details.primaryWebsite});
}

export function hasLeadContact(contact){return ['name','contact','phone','email','website'].some(field=>actual(contact?.[field]));}

export function partyContact(lead,index){
 const parties=lead?.projectDetails?.parties;
 if(!Number.isInteger(index)||index<0||!Array.isArray(parties)||index>=parties.length)return null;
 const raw=parties[index];if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const bounds={role:100,name:120,contact:100,phone:30,email:254,website:2000};
 for(const [field,max]of Object.entries(bounds))if(raw[field]!=null&&(typeof raw[field]!=='string'||raw[field].length>max||/[\u0000-\u001f\u007f-\u009f]/.test(raw[field])))return null;
 const contact=snapshot(raw);if(!contact.name)return null;
 if(contact.phone&&!/^[+\d ()-]{6,30}$/.test(contact.phone))return null;
 if(contact.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email))return null;
 if(contact.website){try{const url=new URL(contact.website);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;contact.website=url.href;}catch{return null;}}
 return contact;
}
