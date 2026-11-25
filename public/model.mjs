export {buildAdminOverview} from './admin-overview.mjs';
export {effectiveLeadContact,hasLeadContact,contactFingerprint,partyContact} from './selected-contact.mjs';
export {buildCallReport} from './call-report.mjs';

const HOUR = 3600000;
const roles = ['hoofdbeheerder', 'bedrijfsbeheerder', 'verkoper'];
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const iso = value => new Date(value).toISOString();
export const callOutcomeNames = Object.freeze({ reached: 'Gesproken', unanswered: 'Geen gehoor', voicemail: 'Voicemail ingesproken' });
const dayInAmsterdam = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const mustCompany = (state, id) => {
  const company = state.companies.find(item => item.id === id);
  if (!company) throw new Error('Dit bedrijf bestaat niet.');
  return company;
};
const mustUser = (state, id) => {
  const user = state.users.find(item => item.id === id);
  if (!user) throw new Error('Deze gebruiker bestaat niet.');
  return user;
};

export function getWorkspace(state, companyId, leadId) {
  const company = mustCompany(state, companyId);
  if (!state.leads.some(lead => lead.id === leadId)) throw new Error('Deze lead bestaat niet.');
  state.workspaces[companyId] ??= {};
  state.workspaces[companyId][leadId] ??= {
    status: company.columns[0]?.id ?? 'nieuw', priority: 'medium', ownerId: null,
    commitment: false, calculation: false, commitmentAt: null, calculationAt: null,
    contactName: '', contactEmail: '', contactPhone: '',
    notes: [], callbacks: [], calls: []
  };
  return state.workspaces[companyId][leadId];
}

export function nextFollowUpAt(state, companyId, leadId) {
  const callbacks = getWorkspace(state, companyId, leadId).callbacks;
  let earliest = Infinity;
  for (const callback of callbacks) {
    const due = Date.parse(callback.dueAt);
    if (!callback.done && Number.isFinite(due) && due < earliest) earliest = due;
  }
  return earliest === Infinity ? null : new Date(earliest).toISOString();
}

export function sortFollowUpLeads(state, companyId, leads) {
  const dates = new Map(leads.map(lead => [lead.id, nextFollowUpAt(state, companyId, lead.id)]));
  return [...leads].sort((a, b) => {
    const first = dates.get(a.id), second = dates.get(b.id);
    if (first === second) return 0;
    if (!first) return 1;
    if (!second) return -1;
    return Date.parse(first) - Date.parse(second);
  });
}

export function callEligibility(state, leadId, companyId, userId, now = Date.now()) {
  const workspace = getWorkspace(state, companyId, leadId);
  const user = mustUser(state, userId);
  if (user.companyId !== companyId && user.role !== 'hoofdbeheerder') {
    throw new Error('Deze gebruiker hoort niet bij dit bedrijf.');
  }
  const lastCall = state.callLog.filter(call => call.leadId === leadId)
    .reduce((latest, call) => !latest || Date.parse(call.at) > Date.parse(latest.at) ? call : latest, null);
  const until = lastCall ? iso(Date.parse(lastCall.at) + Math.max(0, Number(state.settings.cooldownHours) || 0) * HOUR) : null;
  const blocked = lastCall && lastCall.companyId !== companyId && Date.parse(until) > now;
  if (!blocked) return { allowed: true, reason: 'available', until: null, lastCall };
  const ownCallback = workspace.callbacks.some(callback => !callback.done && callback.assigneeId === userId && Date.parse(callback.dueAt) <= now);
  return { allowed: !!ownCallback, reason: ownCallback ? 'callback' : 'cooldown', until, lastCall };
}

export function recordCall(state, leadId, companyId, userId, now = Date.now()) {
  const permission = callEligibility(state, leadId, companyId, userId, now);
  if (!permission.allowed) throw new Error('Deze lead is nog niet belbaar door de wachttijd tussen bedrijven.');
  const user = mustUser(state, userId);
  const workspace = getWorkspace(state, companyId, leadId);
  const call = { id: uid('call'), leadId, companyId, userId, userName: user.name, at: iso(now) };
  state.callLog.push(call);
  workspace.calls.push({ id: call.id, at: call.at, userId, userName: user.name });
  workspace.ownerId ??= userId;
  workspace.callbacks.forEach(callback => {
    if (!callback.done && callback.assigneeId === userId && Date.parse(callback.dueAt) <= now) callback.done = true;
  });
  state.feed.unshift({ id: uid('feed'), companyId, leadId, type: 'call', text: `${user.name} heeft een belmoment geregistreerd.`, authorName: user.name, at: call.at });
  return call;
}

export function transferUser(state, userId, companyId) {
  mustCompany(state, companyId);
  const user = mustUser(state, userId);
  user.companyId = companyId;
  return user;
}

export function inviteUser(state, { name, email, companyId, role }) {
  mustCompany(state, companyId);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) throw new Error('Vul de naam van de gebruiker in.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Vul een geldig e-mailadres in.');
  if (!roles.includes(role)) throw new Error('Kies een geldige gebruikersrol.');
  if (state.users.some(user => user.email.toLowerCase() === normalizedEmail) ||
    state.invitations.some(invitation => invitation.email.toLowerCase() === normalizedEmail && invitation.status !== 'ingetrokken')) {
    throw new Error('Dit e-mailadres heeft al een account of een openstaande uitnodiging.');
  }
  const invitation = { id: uid('invite'), name: normalizedName, email: normalizedEmail, companyId, role,
    status: 'demo', createdAt: iso(Date.now()), expiresAt: iso(Date.now() + 7 * 24 * HOUR), demo: true };
  state.invitations.push(invitation);
  return invitation;
}

export function leadSourceIds(lead) {
  return [...new Set([lead?.source, ...(Array.isArray(lead?.sourceIds) ? lead.sourceIds : [])]
    .filter(value => typeof value === 'string' && value.length > 0))];
}

export function leadMatchesSource(lead, sourceId) {
  return sourceId === 'all' || leadSourceIds(lead).includes(sourceId);
}

export function reportRows(state, { companyId = 'all', sellerId = 'all', source = 'all', from = '', to = '' } = {}) {
  // The date range defines an acquisition cohort by the lead's creation day in
  // Amsterdam. Later notes, calls and conversion updates do not change membership.
  const rows = new Map();
  const companies = new Map([...(state.archivedCompanies || []), ...state.companies].map(company => [company.id, company]));
  for (const company of companies.values()) {
    if (companyId !== 'all' && companyId !== company.id) continue;
    for (const lead of state.leads) {
      if (!leadMatchesSource(lead, source)) continue;
      const workspace = state.workspaces[company.id]?.[lead.id];
      if (!workspace?.ownerId) continue;
      if (sellerId !== 'all' && sellerId !== workspace.ownerId) continue;
      const creationDay = dayInAmsterdam(lead.createdAt);
      if (!creationDay || (from && creationDay < from) || (to && creationDay > to)) continue;
      const seller = state.users.find(user => user.id === workspace.ownerId);
      const historicCall = workspace.calls.find(call => call.userId === workspace.ownerId);
      const sourceIds = leadSourceIds(lead);
      const attributedSource = source === 'all' ? lead.source : source;
      // Separate membership groups preserve exact per-filter totals without
      // duplicating a lead in its company's overall conversion figures.
      const key = JSON.stringify([company.id, workspace.ownerId, attributedSource, [...sourceIds].sort()]);
      if (!rows.has(key)) rows.set(key, { companyId: company.id, companyName: company.name,
        sellerId: workspace.ownerId, sellerName: historicCall?.userName ?? seller?.name ?? 'Voormalige medewerker', source: attributedSource, sourceIds,
        total: 0, contacted: 0, commitments: 0, calculations: 0, conversion: 0 });
      const row = rows.get(key);
      row.total++;
      if (workspace.calls.length) row.contacted++;
      if (workspace.commitment) row.commitments++;
      if (workspace.calculation) row.calculations++;
    }
  }
  return [...rows.values()].map(row => ({ ...row, conversion: row.total ? row.commitments / row.total * 100 : 0 }));
}

export function createDemoState() {
  const now = Date.now();
  const ago = hours => iso(now - hours * HOUR);
  const columns = () => [
    { id: 'nieuw', name: 'Nieuw' }, { id: 'contact', name: 'In contact' },
    { id: 'opvolgen', name: 'Opvolgen' }, { id: 'offerte', name: 'Offerte' }, { id: 'afgerond', name: 'Afgerond' }
  ];
  const companies = [
    { id: 'c-noord', name: 'Noord Bouwadvies', initials: 'NB', color: '#2563eb', columns: columns() },
    { id: 'c-delta', name: 'Delta Projectbouw', initials: 'DP', color: '#0f766e', columns: columns() },
    { id: 'c-horizon', name: 'Horizon Vastgoed', initials: 'HV', color: '#7c3aed', columns: columns() }
  ];
  const users = [
    { id: 'u-admin', name: 'Mark de Vries', email: 'mark@noordbouwadvies.example', companyId: 'c-noord', role: 'hoofdbeheerder', status: 'actief' },
    { id: 'u-sanne', name: 'Sanne Bakker', email: 'sanne@noordbouwadvies.example', companyId: 'c-noord', role: 'bedrijfsbeheerder', status: 'actief' },
    { id: 'u-thomas', name: 'Thomas Jansen', email: 'thomas@noordbouwadvies.example', companyId: 'c-noord', role: 'verkoper', status: 'actief' },
    { id: 'u-lisa', name: 'Lisa van Dijk', email: 'lisa@deltaprojectbouw.example', companyId: 'c-delta', role: 'bedrijfsbeheerder', status: 'actief' },
    { id: 'u-omar', name: 'Omar Smit', email: 'omar@horizonvastgoed.example', companyId: 'c-horizon', role: 'verkoper', status: 'actief' }
  ];
  const rawLeads = [
    ['Transformatie De Kade', 'De Kade Ontwikkeling', 'Utrecht', 'bouw', 'Eva Vermeer', 'Ontwerpfase', '€ 2,4 mln', 'Transformatie van een voormalig kantoorgebouw naar 28 appartementen. Adviseur voor gevel- en isolatieoplossingen gezocht.', ['Transformatie', '28 woningen']],
    ['Renovatie Hotel Duinzicht', 'Hotel Duinzicht', 'Noordwijk', 'hotels', 'Daan de Groot', 'Voorbereiding', '€ 860.000', 'Renovatie van 42 kamers en de lobby. De hotelmanager verzamelt voorstellen voor uitvoering na het zomerseizoen.', ['Renovatie', '42 kamers']],
    ['Verduurzaming Parkresidentie', 'VvE Parkresidentie', 'Amersfoort', 'vve', 'Nora Meijer', 'Besluitvorming', '€ 480.000', 'VvE met 36 appartementen onderzoekt dakisolatie, kozijnen en collectieve ventilatie. MJOP is beschikbaar.', ['Verduurzaming', '36 appartementen']],
    ['Nieuwbouw Waterlinie', 'Waterlinie Projecten', 'Nieuwegein', 'bouw', 'Bram Visser', 'Vergunning aangevraagd', '€ 4,8 mln', 'Nieuw woonblok met 52 appartementen. Bestek wordt begin volgend kwartaal verwacht.', ['Nieuwbouw', '52 woningen']],
    ['Uitbreiding Stadshotel West', 'Stadshotel West', 'Rotterdam', 'hotels', 'Lotte Bos', 'Haalbaarheid', '€ 1,2 mln', 'Uitbreiding met 18 kamers en een vergadervleugel. Eerste gesprekken met adviseurs zijn gestart.', ['Uitbreiding', '18 kamers']],
    ['Dakherstel De Lijsterhof', 'VvE De Lijsterhof', 'Haarlem', 'vve', 'Tim van Leeuwen', 'Offertefase', '€ 210.000', 'Dakherstel en vervanging van hemelwaterafvoer voor 24 appartementen. Offertes worden deze maand vergeleken.', ['Dakrenovatie', '24 appartementen']],
    ['Bedrijfshal Noordpoort', 'Noordpoort Logistiek', 'Zwolle', 'bouw', 'Sophie Mulder', 'Uitvoeringsontwerp', '€ 3,1 mln', 'Nieuwe bedrijfshal van 3.600 m² met kantoren. Interesse in duurzame gevelbekleding en brandwerende oplossingen.', ['Bedrijfshal', '3.600 m²']],
    ['Kamerrenovatie Aan de Gracht', 'Boutiquehotel Aan de Gracht', 'Delft', 'hotels', 'Milan Dekker', 'Offertefase', '€ 340.000', 'Gefaseerde renovatie van 16 kamers. Eigenaar wil planning en materiaalvoorstel bespreken.', ['Interieur', '16 kamers']],
    ['Gevelrenovatie De Singel', 'VvE De Singel', 'Breda', 'vve', 'Julia de Wit', 'Voorbereiding', '€ 390.000', 'Gevelreiniging, voegwerk en herstel van balkons bij 48 appartementen. Technisch rapport beschikbaar.', ['Gevels', '48 appartementen']],
    ['Woonzorglocatie De Linden', 'Linden Zorgvastgoed', 'Ede', 'bouw', 'Lucas Peters', 'Ontwerpfase', '€ 5,6 mln', 'Woonzorgcomplex met 32 studio’s en gezamenlijke voorzieningen. Bouwteamselectie start volgende maand.', ['Zorgvastgoed', '32 studio’s']],
    ['Wellnessvleugel Bosrijk', 'Hotel Bosrijk', 'Apeldoorn', 'hotels', 'Fleur Hendriks', 'Besluitvorming', '€ 950.000', 'Nieuwe wellnessvleugel met zwembad, sauna en acht suites. Directie wil een kostenraming ontvangen.', ['Wellness', 'Uitbreiding']],
    ['Kozijnen Buitenhof', 'VvE Buitenhof', 'Leiden', 'vve', 'Sem Vos', 'Offertefase', '€ 620.000', 'Vervanging van houten kozijnen voor 64 appartementen. Bewonersavond staat gepland.', ['Kozijnen', '64 appartementen']],
    ['Campusgebouw Oost', 'Oost Campusontwikkeling', 'Enschede', 'bouw', 'Emma Kok', 'Aanbesteding', '€ 7,2 mln', 'Onderwijsgebouw met laboratoria en lesruimten. Selectiefase voor gespecialiseerde leveranciers.', ['Onderwijs', '6.400 m²']],
    ['Restauratie Hotel Het Pakhuis', 'Hotel Het Pakhuis', 'Deventer', 'hotels', 'Finn van den Berg', 'Vergunning verleend', '€ 1,7 mln', 'Restauratie van monumentaal pakhuis naar een hotel met 26 kamers. Monumentenadviseur is betrokken.', ['Monument', '26 kamers']],
    ['Balkonherstel Rivierstaete', 'VvE Rivierstaete', 'Arnhem', 'vve', 'Tess van Beek', 'Technisch onderzoek', '€ 280.000', 'Onderzoek en herstel van betonconstructies en balkonhekken voor 40 appartementen.', ['Betonherstel', '40 appartementen']],
    ['Dorpscentrum De Brink', 'De Brink Vastgoed', 'Zeist', 'bouw', 'Jesse Willems', 'Voorbereiding', '€ 2,8 mln', 'Winkels en 22 appartementen rondom een vernieuwd dorpsplein. Technische uitwerking in voorbereiding.', ['Gemengd gebruik', '22 woningen']],
    ['Hotelkamers Havenlicht', 'Hotel Havenlicht', 'Vlissingen', 'hotels', 'Sara van Dam', 'Uitvoering gepland', '€ 540.000', 'Vernieuwing van 30 badkamers en installaties. Uitvoering vindt in twee fases plaats.', ['Installaties', '30 kamers']],
    ['Energieplan De Esdoorn', 'VvE De Esdoorn', 'Alkmaar', 'vve', 'Noah Jacobs', 'Haalbaarheid', '€ 750.000', 'Integraal verduurzamingsplan met dakisolatie en warmtepompen voor 72 appartementen.', ['Energie', '72 appartementen']]
  ];
  const leads = rawLeads.map((row, index) => ({
    id: `l-${String(index + 1).padStart(2, '0')}`, title: row[0], organization: row[1], city: row[2], source: row[3],
    contact: row[4], phase: row[5], budget: row[6], description: row[7], tags: row[8],
    phone: `+31 20 000 ${String(index + 1000).padStart(4, '0')}`,
    email: `contact@${['dekade','duinzicht','parkresidentie','waterlinie','stadshotelwest','lijsterhof','noordpoort','aandegracht','desingel','delinden','bosrijk','buitenhof','oostcampus','hetpakhuis','rivierstaete','debrink','havenlicht','deesdoorn'][index]}.example`,
    createdAt: ago(24 + index * 9), updatedAt: ago(index === 0 ? 0.5 : 2 + index * 1.75)
  }));
  const state = { version: 1, companies, users, leads, workspaces: {}, callLog: [], feed: [],
    sources: [
      { id: 'bouw', name: 'Bouwberichten.nl', url: 'https://www.bouwberichten.nl', username: '', enabled: false },
      { id: 'hotels', name: 'Hotels', url: '', username: '', enabled: false },
      { id: 'vve', name: 'VvE', url: '', username: '', enabled: false },
      { id: 'outlook', name: 'Microsoft Outlook', url: '', username: '', enabled: false }
    ], settings: { cooldownHours: 48 }, invitations: [] };
  const seedCall = (leadId, companyId, userId, hoursAgo) => {
    const user = users.find(item => item.id === userId);
    const workspace = getWorkspace(state, companyId, leadId);
    const call = { id: `seed-call-${state.callLog.length + 1}`, leadId, companyId, userId, userName: user.name, at: ago(hoursAgo) };
    state.callLog.push(call);
    workspace.calls.push({ id: call.id, userId, userName: user.name, at: call.at });
    workspace.ownerId = userId;
  };
  for (let index = 0; index < leads.length; index++) {
    const workspace = getWorkspace(state, 'c-noord', leads[index].id);
    workspace.priority = index % 4 === 0 || [1, 2].includes(index) ? 'high' : index % 5 === 0 ? 'low' : 'medium';
    workspace.status = ['contact','nieuw','opvolgen','contact','nieuw','offerte','contact','offerte','opvolgen','nieuw','offerte','afgerond','nieuw','contact','opvolgen','nieuw','afgerond','nieuw'][index];
    workspace.ownerId = index % 5 === 4 ? null : ['u-admin','u-sanne','u-admin','u-thomas'][index % 4];
    if (workspace.ownerId && index !== 1) seedCall(leads[index].id, 'c-noord', workspace.ownerId, 12 + index * 3);
    if ([5, 7, 10, 11, 16].includes(index)) { workspace.commitment = true; workspace.commitmentAt = ago(6 + index); }
    if ([7, 10, 11, 14].includes(index)) { workspace.calculation = true; workspace.calculationAt = ago(4 + index); }
  }
  seedCall('l-02', 'c-delta', 'u-lisa', 2);
  seedCall('l-03', 'c-delta', 'u-lisa', 1);
  seedCall('l-06', 'c-delta', 'u-lisa', 80);
  seedCall('l-09', 'c-delta', 'u-lisa', 60);
  seedCall('l-11', 'c-horizon', 'u-omar', 90);
  seedCall('l-12', 'c-horizon', 'u-omar', 70);
  for (const [companyId, leadId, status, commitment, calculation] of [
    ['c-delta','l-02','contact',false,false], ['c-delta','l-03','offerte',true,true],
    ['c-delta','l-06','offerte',true,false], ['c-delta','l-09','opvolgen',false,false],
    ['c-horizon','l-11','offerte',true,true], ['c-horizon','l-12','contact',false,true]
  ]) {
    Object.assign(getWorkspace(state, companyId, leadId), { status, commitment, calculation,
      commitmentAt: commitment ? ago(18) : null, calculationAt: calculation ? ago(12) : null });
  }
  const addNote = (companyId, leadId, authorId, text, hoursAgo) => {
    const user = users.find(item => item.id === authorId);
    getWorkspace(state, companyId, leadId).notes.push({ id: uid('note'), text, authorId, authorName: user.name, createdAt: ago(hoursAgo) });
  };
  addNote('c-noord', 'l-01', 'u-admin', 'Eva gesproken. Interesse in een voorstel voor gevelisolatie. Bestek wordt vrijdag verwacht; daarna opnieuw contact opnemen.', 12);
  addNote('c-noord', 'l-03', 'u-sanne', 'Nora wil de technische stukken delen. Mark belt terug op het afgesproken tijdstip. Eigen terugbelafspraak mag de algemene wachttijd passeren.', 3);
  addNote('c-noord', 'l-04', 'u-thomas', 'Architect verwerkt de laatste wijzigingen. Sanne heeft een terugbelverzoek klaargezet om de planning af te stemmen.', 5);
  addNote('c-noord', 'l-08', 'u-thomas', 'Toezegging voor opname op locatie ontvangen. Details staan klaar voor calculatie.', 8);
  addNote('c-delta', 'l-03', 'u-lisa', 'Eigen gesprek Delta: afspraak over een kostenraming voor de VvE.', 1);
  const callback = (leadId, assigneeId, creatorId, hoursFromNow) => {
    const creator = users.find(user => user.id === creatorId);
    getWorkspace(state, 'c-noord', leadId).callbacks.push({ id: uid('callback'), dueAt: iso(now + hoursFromNow * HOUR),
      creatorId, creatorName: creator.name, assigneeId, done: false, notified: false });
  };
  callback('l-03', 'u-admin', 'u-sanne', -0.15);
  callback('l-04', 'u-thomas', 'u-sanne', -0.05);
  callback('l-01', 'u-admin', 'u-admin', 1.25);
  callback('l-09', 'u-sanne', 'u-thomas', 3);
  callback('l-14', 'u-thomas', 'u-thomas', 24);
  state.feed = [
    { id: 'feed-1', companyId: null, leadId: 'l-01', type: 'update', text: 'Transformatie De Kade: ontwerpfase bijgewerkt. Nieuwe informatie over gevelisolatie beschikbaar.', authorName: 'Demo bronbericht', at: ago(0.5) },
    { id: 'feed-2', companyId: 'c-noord', leadId: 'l-03', type: 'callback', text: 'Sanne Bakker maakte een terugbelafspraak voor Mark de Vries bij VvE Parkresidentie.', authorName: 'Sanne Bakker', at: ago(1) },
    { id: 'feed-3', companyId: null, leadId: 'l-05', type: 'new', text: 'Nieuwe hotelkans: uitbreiding Stadshotel West met 18 kamers.', authorName: 'Demo bronbericht', at: ago(2.5) },
    { id: 'feed-4', companyId: 'c-noord', leadId: 'l-08', type: 'calculation', text: 'Thomas Jansen heeft Kamerrenovatie Aan de Gracht klaargezet voor calculatie.', authorName: 'Thomas Jansen', at: ago(4) },
    { id: 'feed-5', companyId: null, leadId: 'l-12', type: 'update', text: 'VvE Buitenhof: bewonersavond gepland. Een goed moment om opnieuw contact te leggen.', authorName: 'Demo bronbericht', at: ago(5.5) },
    { id: 'feed-6', companyId: 'c-noord', leadId: 'l-06', type: 'commitment', text: 'Sanne Bakker registreerde een toezegging voor Dakherstel De Lijsterhof.', authorName: 'Sanne Bakker', at: ago(7) },
    { id: 'feed-7', companyId: 'c-delta', leadId: 'l-03', type: 'call', text: 'Lisa van Dijk heeft een belmoment geregistreerd voor VvE Parkresidentie.', authorName: 'Lisa van Dijk', at: ago(1) }
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return state;
}
