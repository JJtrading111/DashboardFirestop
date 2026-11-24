import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {reportRows} from '../public/model.mjs';

const EMAIL = 'filters-owner@example.test', PASSWORD = 'Filters-test-password-2026!';
const FILTER_A = 'https://portal.bouwberichten.nl/projecten#projects%5Bfilters%5D%5BlastPublishedAt%5D%5Bstart%5D=2025-12-31T23%3A00%3A00.000Z&projects%5Bfilters%5D%5BconstructionPhase%5D%5B%5D=Gegund';
const FILTER_B = FILTER_A.replace('2025-12-31', '2024-12-31');
const filterUrl = pairs => 'https://portal.bouwberichten.nl/projecten#' + new URLSearchParams(pairs).toString();

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bouwberichten-filter-test-'));
  const options = {dataDir, adminEmail: EMAIL, adminName: 'Filterbeheerder', adminPassword: PASSWORD, bootstrapToken: '', demoCleanupId: '', seedDemoData: false, publicOrigin: '', secureCookies: false};
  let app, base;
  async function start() {app = createApp(options);app.server.listen(0, '127.0.0.1');await once(app.server, 'listening');base = `http://127.0.0.1:${app.server.address().port}`;}
  await start();
  async function request(route, {method = 'GET', body, headers = {}} = {}) {
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + route, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();let data;try {data = JSON.parse(text);} catch {data = null;}
    return {status: res.status, ok: res.ok, data, text, headers: res.headers};
  }
  function client() {
    const browser = {cookie: '', csrfToken: '', user: null};
    browser.request = async (route, {method = 'GET', body, csrf = true} = {}) => {
      const headers = {Origin: base};if (browser.cookie) headers.Cookie = browser.cookie;if (csrf && browser.csrfToken) headers['X-CSRF-Token'] = browser.csrfToken;
      const res = await request(route, {method, body, headers});const cookie = res.headers.get('set-cookie');if (cookie) browser.cookie = cookie.split(';')[0];
      if (res.ok && res.data?.csrfToken) browser.csrfToken = res.data.csrfToken;if (res.ok && res.data?.user) browser.user = res.data.user;return res;
    };
    browser.login = () => browser.request('/api/auth/login', {method: 'POST', body: {email: EMAIL, password: PASSWORD}});
    browser.activate = (token, name) => browser.request('/api/auth/activate', {method: 'POST', body: {token, name, password: PASSWORD}});
    browser.action = (type, payload = {}, companyId = 'c-noord', extra = {}) => browser.request('/api/action', {method: 'POST', body: {type, companyId, payload}, ...extra});
    browser.state = (companyId = 'c-noord') => browser.request(`/api/state?companyId=${encodeURIComponent(companyId)}`);
    return browser;
  }
  return {client, dataDir,
    machine(sourceId, token, runId, items) {return request(`/api/import/sources/${encodeURIComponent(sourceId)}/leads`, {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: {runId, items}});},
    async restart() {await app.close();await start();},
    async close() {await app.close();assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('bouwberichten-filter-test-'));await rm(dataDir, {recursive: true, force: true});}
  };
}
function ok(response, context = '') {assert.ok(response.ok, `${context}: ${response.status} ${response.data?.error || response.text.slice(0, 200)}`);return response.data;}
function snapshot(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'dashboard.sqlite'));
  try {
    const result = {state: JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json)};
    for (const table of ['source_items', 'provider_items', 'import_runs', 'source_import_credentials', 'credentials', 'sessions']) {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      result[table] = exists ? db.prepare(`SELECT * FROM ${table}`).all().map(row => ({...row})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : [];
    }
    return result;
  } finally {db.close();}
}
async function source(owner, name, provider, filter = '') {return ok(await owner.action('source.create', {name, provider, filterUrl: filter})).result.source;}
async function token(owner, id) {return ok(await owner.action('source.import.rotate', {id})).result.importToken;}

test('Bouwberichten filter sources normalize the real publication-date link, stay chief-only and persist repeated saves', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client(), seller = env.client(), manager = env.client();ok(await owner.login());
  const initial = ok(await owner.state()).state;assert.equal(initial.sources.find(item => item.id === 'bouw').provider, 'bouwberichten');
  const foreign = ok(await owner.action('company.create', {name: 'Filter ander bedrijf'})).result.company;
  for (const [browser, name, email, role, companyId] of [[seller, 'Filter verkoper', 'filter-seller@example.test', 'verkoper', 'c-noord'], [manager, 'Filter bedrijfsbeheerder', 'filter-manager@example.test', 'bedrijfsbeheerder', foreign.id]]) {
    const invitation = ok(await owner.action('invitation.create', {name, email, role, companyId})).result;ok(await browser.activate(invitation.token, name));
  }
  const before = snapshot(env.dataDir);
  assert.equal((await owner.action('source.create', {name: 'Zonder CSRF', provider: 'bouwberichten', filterUrl: FILTER_A}, 'c-noord', {csrf: false})).status, 403);
  for (const browser of [seller, manager]) assert.equal((await browser.action('source.create', {name: 'Geen hoofdbeheerder', provider: 'bouwberichten', filterUrl: FILTER_A}, browser.user.companyId)).status, 403);
  assert.deepEqual(snapshot(env.dataDir), before);
  const created = await source(owner, '  Gegund vanaf 2026  ', 'bouwberichten', FILTER_A);
  assert.equal(created.name, 'Gegund vanaf 2026');assert.equal(created.provider, 'bouwberichten');assert.ok(created.filterUrl);
  assert.equal(created.filterSummary, 'Gegund vanaf 01-01-2026', 'The UTC boundary must be interpreted as New Year in Amsterdam');
  assert.ok(Array.isArray(created.filterParameters));assert.ok(created.filterParameters.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')));
  assert.ok(created.filterParameters.some(([key, value]) => key === 'projects[filters][lastPublishedAt][start]' && value === '2025-12-31T23:00:00.000Z'));
  assert.ok(created.filterParameters.some(([key, value]) => key === 'projects[filters][constructionPhase][]' && value === 'Gegund'));
  const storedCount = ok(await owner.state()).state.sources.length;
  for (let i = 0; i < 3; i++) {
    const saved = ok(await owner.action('source.update', {id: created.id, provider: 'bouwberichten', filterUrl: FILTER_A, name: created.name, url: '', username: ''})).result.source;
    assert.equal(saved.id, created.id);assert.equal(saved.filterUrl, created.filterUrl);assert.deepEqual(saved.filterParameters, created.filterParameters);assert.equal(saved.filterSummary, created.filterSummary);
  }
  assert.equal(ok(await owner.state()).state.sources.length, storedCount);
  for (const browser of [seller, manager]) assert.equal((await browser.action('source.update', {id: created.id, provider: 'bouwberichten', filterUrl: FILTER_B, url: '', username: ''}, browser.user.companyId)).status, 403);
  assert.equal((await owner.action('source.update', {id: created.id, provider: 'bouwberichten', filterUrl: FILTER_B, url: '', username: ''}, 'c-noord', {csrf: false})).status, 403);
  const codeFilter = filterUrl([['projects[filters][buildingCode][]', 'B01'], ['projects[filters][zipCode][]', '1234AB']]);
  const coded = await source(owner, 'Veilige gebouw- en postcodefilters', 'bouwberichten', codeFilter);
  assert.ok(coded.filterParameters.some(([key, value]) => key === 'projects[filters][buildingCode][]' && value === 'B01'));
  assert.ok(coded.filterParameters.some(([key, value]) => key === 'projects[filters][zipCode][]' && value === '1234AB'));
  const query = await source(owner, 'Expliciete zoektekst', 'bouwberichten', filterUrl([['projects[query]', 'Renovatie hotel']]));assert.equal(query.filterSummary, 'Zoektekst ingesteld');
  const favorites = await source(owner, 'Expliciete favorieten', 'bouwberichten', filterUrl([['projects[filterByUserFavorites]', 'true']]));assert.equal(favorites.filterSummary, 'Eigen favorieten');
  const combined = await source(owner, 'Fase, publicatiedatum, zoektekst en favorieten', 'bouwberichten', FILTER_A + '&projects%5Bquery%5D=Hotel&projects%5BfilterByUserFavorites%5D=true');assert.equal(combined.filterSummary, 'Gegund vanaf 01-01-2026 · Zoektekst ingesteld · Eigen favorieten');
  const savedWithFilters = await source(owner, 'Opgeslagen zoekopdracht met expliciete filters', 'bouwberichten', FILTER_A + '&projects%5BsavedSearch%5D=123');assert.ok(savedWithFilters.filterParameters.some(([key, value]) => key === 'projects[savedSearch]' && value === '123'));
  const draft = await source(owner, 'Bouwbron later voorbereiden', 'bouwberichten');assert.equal(draft.filterUrl, '');assert.deepEqual(draft.filterParameters, []);
  const generic = ok(await owner.action('source.create', {name: 'Standaard generieke bron'})).result.source;assert.equal(generic.provider, 'generic');
  await env.restart();const reloaded = ok(await owner.state()).state.sources.find(item => item.id === created.id);
  assert.equal(reloaded.provider, 'bouwberichten');assert.equal(reloaded.filterUrl, created.filterUrl);assert.deepEqual(reloaded.filterParameters, created.filterParameters);assert.equal(reloaded.filterSummary, 'Gegund vanaf 01-01-2026');
});

test('filter URLs reject unsafe hosts, auth, saved-search-only parameters, prototype paths and excessive input atomically', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const existing = await source(owner, 'Veilig bestaande filter', 'bouwberichten', FILTER_A);
  const tooManyPairs = filterUrl(Array.from({length: 201}, (_, index) => ['projects[filters][region][]', String(index)]));
  const tooLongUrl = filterUrl(Array.from({length: 150}, (_, index) => ['projects[filters][region][]', `r${index}-` + 'x'.repeat(100)]));assert.ok(tooLongUrl.length > 16000);
  const invalidUrls = [
    FILTER_A.replace('https:', 'http:'), FILTER_A.replace('portal.bouwberichten.nl', 'portal.bouwberichten.nl.evil.example'), FILTER_A.replace('portal.bouwberichten.nl', 'user:password@portal.bouwberichten.nl'),
    FILTER_A.replace('/projecten#', '/projecten/other#'), FILTER_A.replace('/projecten#', '/projecten?token=secret#'), 'javascript:alert(1)', 'https://portal.bouwberichten.nl/projecten',
    filterUrl([['projects[savedSearch]', '123']]), filterUrl([['projects[savedSearchId]', '123']]),
    filterUrl([['projects[filterByUserFavorites]', 'false']]), filterUrl([['projects[query]', '  ']]), FILTER_A.replace('2025-12-31', '2025-02-30'),
    filterUrl([['projects[filters][token]', 'secret']]), filterUrl([['projects[auth][password]', 'secret']]),
    filterUrl([['projects[filters][__proto__][polluted]', 'yes']]), filterUrl([['projects[filters][constructor][prototype][polluted]', 'yes']]), filterUrl([['projects[filters][__proto__.polluted]', 'yes']]),
    tooManyPairs, filterUrl([['projects[filters][' + 'k'.repeat(201) + ']', 'value']]), filterUrl([['projects[query]', 'x'.repeat(2001)]]), tooLongUrl
  ];
  assert.equal(Object.prototype.polluted, undefined);
  for (const filter of invalidUrls) {
    for (const type of ['source.create', 'source.update']) {
      const before = snapshot(env.dataDir);
      const response = await owner.action(type, {id: existing.id, name: 'Dit mag niet gedeeltelijk wijzigen', provider: 'bouwberichten', filterUrl: filter, url: '', username: ''});
      assert.equal(response.status, 400, filter.slice(0, 100));assert.deepEqual(snapshot(env.dataDir), before);
    }
  }
  for (const provider of ['Bouwberichten', 'outlook', '', null, true, {}]) {
    const before = snapshot(env.dataDir);assert.equal((await owner.action('source.update', {id: existing.id, provider, filterUrl: FILTER_A, url: '', username: ''})).status, 400);assert.deepEqual(snapshot(env.dataDir), before);
  }
  const genericBefore = snapshot(env.dataDir);assert.equal((await owner.action('source.create', {name: 'Geen Bouwprovider', provider: 'generic', filterUrl: FILTER_A})).status, 400);assert.deepEqual(snapshot(env.dataDir), genericBefore);
  assert.equal(Object.prototype.polluted, undefined);
});

test('overlapping Bouw filters share one project and preserve shared snapshots, company workflow and historical source membership', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client(), colleague = env.client();ok(await owner.login());
  const a = await source(owner, 'Gegund 2026', 'bouwberichten', FILTER_A), b = await source(owner, 'Gegund 2025', 'bouwberichten', FILTER_B);
  const keyA = await token(owner, a.id), keyB = await token(owner, b.id);
  const firstItem = {externalId: 'BOUW-2026-001', title: 'Project vanuit filter A', organization: 'Centrale ontwikkelaar', city: 'Utrecht', sourceUrl: 'https://projects.example/bouw/2026-001', sourceUpdatedAt: '2026-11-24T10:00:00Z'};
  const first = ok(await env.machine(a.id, keyA, 'first-project-run', [firstItem]));assert.deepEqual(first.counts, {created: 1, updated: 0, unchanged: 0});
  const initial = ok(await owner.state()).state.leads[0];assert.equal(initial.source, a.id);
  const second = ok(await env.machine(b.id, keyB, 'first-project-run', [firstItem]));assert.deepEqual(second.counts, {created: 0, updated: 1, unchanged: 0});
  let state = ok(await owner.state()).state;assert.equal(state.leads.length, 1);let shared = state.leads[0];assert.equal(shared.id, initial.id);assert.equal(shared.source, a.id);assert.deepEqual(new Set(shared.sourceIds), new Set([a.id, b.id]));
  assert.deepEqual(ok(await env.machine(b.id, keyB, 'repeat-project-new-run', [firstItem])).counts, {created: 0, updated: 0, unchanged: 1});
  const mappings = snapshot(env.dataDir).source_items.filter(row => row.external_id === firstItem.externalId);assert.equal(mappings.length, 2);assert.ok(mappings.every(row => row.lead_id === shared.id));
  ok(await owner.action('workspace.update', {leadId: shared.id, field: 'ownerId', value: owner.user.id}));ok(await owner.action('workspace.update', {leadId: shared.id, field: 'status', value: 'opvolgen'}));
  ok(await owner.action('workspace.update', {leadId: shared.id, field: 'commitment', value: true}));ok(await owner.action('workspace.update', {leadId: shared.id, field: 'calculation', value: true}));
  ok(await owner.action('note.add', {leadId: shared.id, text: 'Eigen opvolging op het gedeelde Bouwproject'}));ok(await owner.action('call.record', {leadId: shared.id}));
  const foreign = ok(await owner.action('company.create', {name: 'Tweede bedrijf met dezelfde centrale lead'})).result.company;
  const invite = ok(await owner.action('invitation.create', {name: 'Andere bedrijfverkoper', email: 'filter-colleague@example.test', role: 'verkoper', companyId: foreign.id})).result;ok(await colleague.activate(invite.token, 'Andere bedrijfverkoper'));
  assert.equal((await colleague.action('call.record', {leadId: shared.id}, foreign.id)).status, 409, 'The same shared lead has one global call-wait lock across all filters');
  ok(await owner.action('callback.add', {leadId: shared.id, dueAt: new Date(Date.now() - 60000).toISOString(), assigneeId: colleague.user.id}, foreign.id));ok(await colleague.action('call.record', {leadId: shared.id}, foreign.id));
  ok(await colleague.action('note.add', {leadId: shared.id, text: 'Afgeschermde notitie van het tweede bedrijf'}, foreign.id));
  const beforeUpdates = ok(await owner.state()).state;const workflows = structuredClone(beforeUpdates.workspaces), calls = structuredClone(beforeUpdates.callLog);
  const bUpdate = {...firstItem, title: 'Nieuwe informatie vanuit filter B', city: 'Amersfoort', sourceUpdatedAt: '2026-11-24T11:00:00Z'};assert.deepEqual(ok(await env.machine(b.id, keyB, 'update-via-b', [bUpdate])).counts, {created: 0, updated: 1, unchanged: 0});
  assert.equal(ok(await owner.state()).state.leads[0].title, bUpdate.title);
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));const manual = JSON.parse(setup.prepare('SELECT json FROM app_state WHERE id=1').get().json);manual.leads.find(lead => lead.id === shared.id).city = 'Handmatig gecorrigeerd Dokkum';setup.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(manual));setup.close();
  const aUpdate = {...firstItem, title: 'Vervolgupdate vanuit filter A', city: 'Haarlem', sourceUpdatedAt: '2026-11-24T12:00:00Z'};assert.deepEqual(ok(await env.machine(a.id, keyA, 'update-via-a', [aUpdate])).counts, {created: 0, updated: 1, unchanged: 0});
  state = ok(await owner.state()).state;shared = state.leads[0];assert.equal(shared.title, aUpdate.title, 'A must compare against the shared latest snapshot, not its stale source-specific snapshot');assert.equal(shared.city, 'Handmatig gecorrigeerd Dokkum');
  const newestB = {...firstItem, title: 'Laatste update vanuit filter B', city: 'Rotterdam', sourceUpdatedAt: '2026-11-24T13:00:00Z'};ok(await env.machine(b.id, keyB, 'newest-via-b', [newestB]));
  const staleA = {...firstItem, title: 'Oude update vanuit A mag niet terugkomen', sourceUpdatedAt: '2026-11-24T12:30:00Z'};assert.deepEqual(ok(await env.machine(a.id, keyA, 'stale-via-a', [staleA])).counts, {created: 0, updated: 0, unchanged: 1});
  state = ok(await owner.state()).state;assert.equal(state.leads.length, 1);shared = state.leads[0];assert.equal(shared.title, newestB.title);assert.equal(shared.city, 'Handmatig gecorrigeerd Dokkum');assert.equal(shared.createdAt, initial.createdAt);assert.equal(shared.source, a.id);
  assert.deepEqual(state.workspaces, workflows);assert.deepEqual(state.callLog, calls);
  const reportsA = reportRows(state, {companyId: 'c-noord', source: a.id}), reportsB = reportRows(state, {companyId: 'c-noord', source: b.id}), allReports = reportRows(state, {companyId: 'c-noord'});
  assert.equal(reportsA.reduce((sum, row) => sum + row.total, 0), 1);assert.equal(reportsB.reduce((sum, row) => sum + row.total, 0), 1);assert.equal(allReports.reduce((sum, row) => sum + row.total, 0), 1);assert.equal(reportsB[0].source, b.id);assert.equal(reportsB[0].conversion, 100);
  const lockedBefore = snapshot(env.dataDir);assert.equal((await owner.action('source.update', {id: a.id, provider: 'generic', filterUrl: '', url: '', username: ''})).status, 409);assert.deepEqual(snapshot(env.dataDir), lockedBefore);
  const beforeDelete = structuredClone(shared);ok(await owner.action('source.delete', {id: b.id}));
  assert.equal((await env.machine(b.id, keyB, 'deleted-b', [firstItem])).status, 401);
  state = ok(await owner.state()).state;assert.deepEqual(state.leads[0], beforeDelete);assert.deepEqual(state.workspaces, workflows);assert.deepEqual(reportRows(state, {companyId: 'c-noord', source: b.id}), reportsB);
  const afterDeleteA = {...firstItem, title: 'Filter A werkt door na verwijderen B', sourceUpdatedAt: '2026-11-24T14:00:00Z'};ok(await env.machine(a.id, keyA, 'a-after-delete-b', [afterDeleteA]));
  state = ok(await owner.state()).state;assert.equal(state.leads[0].id, initial.id);assert.equal(state.leads[0].title, afterDeleteA.title);assert.equal(state.leads[0].source, a.id);assert.deepEqual(new Set(state.leads[0].sourceIds), new Set([a.id, b.id]));assert.deepEqual(state.workspaces, workflows);
  const beforeRestart = snapshot(env.dataDir);await env.restart();state = ok(await owner.state()).state;
  assert.deepEqual(state.leads, beforeRestart.state.leads);assert.deepEqual(state.workspaces, workflows);assert.deepEqual(snapshot(env.dataDir).source_items, beforeRestart.source_items);assert.equal(state.sources.find(item => item.id === b.id).deleted, true);
});

test('generic imports remain separate and provider changes are allowed only before any import history', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const a = await source(owner, 'Generiek A', 'generic'), b = await source(owner, 'Generiek B', 'generic'), draft = await source(owner, 'Nog niet geïmporteerde bron', 'generic');
  const keyA = await token(owner, a.id), keyB = await token(owner, b.id);const item = {externalId: 'same-project-id', title: 'Apart project per generieke bron'};
  assert.deepEqual(ok(await env.machine(a.id, keyA, 'same-run', [item])).counts, {created: 1, updated: 0, unchanged: 0});assert.deepEqual(ok(await env.machine(b.id, keyB, 'same-run', [item])).counts, {created: 1, updated: 0, unchanged: 0});
  const state = ok(await owner.state()).state;assert.equal(state.leads.length, 2);assert.notEqual(state.leads.find(lead => lead.source === a.id).id, state.leads.find(lead => lead.source === b.id).id);
  ok(await owner.action('source.import.revoke', {id: a.id}));const before = snapshot(env.dataDir);
  assert.equal((await owner.action('source.update', {id: a.id, provider: 'bouwberichten', filterUrl: FILTER_A, url: '', username: ''})).status, 409);assert.deepEqual(snapshot(env.dataDir), before);
  const changed = ok(await owner.action('source.update', {id: draft.id, provider: 'bouwberichten', filterUrl: FILTER_A, url: '', username: ''})).result.source;assert.equal(changed.id, draft.id);assert.equal(changed.provider, 'bouwberichten');assert.equal(changed.filterSummary, 'Gegund vanaf 01-01-2026');
  const backToGeneric = ok(await owner.action('source.update', {id: draft.id, provider: 'generic', filterUrl: '', url: '', username: ''})).result.source;assert.equal(backToGeneric.provider, 'generic');assert.equal(backToGeneric.filterUrl, '');assert.deepEqual(backToGeneric.filterParameters, []);
});

test('pre-existing Bouw duplicate mappings retain their own leads while a new filter links the oldest canonical record', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const a = await source(owner, 'Historische Bouwbron A', 'generic'), b = await source(owner, 'Historische Bouwbron B', 'generic');
  const keyA = await token(owner, a.id), keyB = await token(owner, b.id), externalId = 'PRE-INDEX-BOUW-001';
  const itemA = {externalId, title: 'Bestaande eigen lead A', city: 'Utrecht', sourceUpdatedAt: '2026-11-24T10:00:00Z'};
  const itemB = {externalId, title: 'Bestaande eigen lead B', city: 'Leeuwarden', sourceUpdatedAt: '2026-11-24T10:00:00Z'};
  ok(await env.machine(a.id, keyA, 'historic-a', [itemA]));ok(await env.machine(b.id, keyB, 'historic-b', [itemB]));
  let state = ok(await owner.state()).state;const leadA = state.leads.find(lead => lead.source === a.id), leadB = state.leads.find(lead => lead.source === b.id);assert.notEqual(leadA.id, leadB.id);
  for (const [lead, label] of [[leadA, 'A'], [leadB, 'B']]) {
    ok(await owner.action('workspace.update', {leadId: lead.id, field: 'status', value: 'opvolgen'}));ok(await owner.action('note.add', {leadId: lead.id, text: `Historische gespreksnotitie ${label} blijft bij de eigen lead`}));ok(await owner.action('workspace.update', {leadId: lead.id, field: 'commitment', value: true}));
  }
  // Simulate the pre-provider-index database: two independently imported Bouw
  // mappings already exist. Both old leads have their own company history.
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));const legacy = JSON.parse(setup.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  for (const id of [a.id, b.id]) legacy.sources.find(candidate => candidate.id === id).provider = 'bouwberichten';
  setup.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(legacy));setup.prepare('DELETE FROM provider_items WHERE provider=? AND external_id=?').run('bouwberichten', externalId);
  assert.equal(setup.prepare('SELECT source_id FROM source_items WHERE external_id=? ORDER BY rowid LIMIT 1').get(externalId).source_id, a.id);setup.close();
  const before = snapshot(env.dataDir), workflows = structuredClone(before.state.workspaces);
  const updatedB = {...itemB, title: 'Eigen historische lead B bijgewerkt', sourceUpdatedAt: '2026-11-24T11:00:00Z'};
  assert.deepEqual(ok(await env.machine(b.id, keyB, 'historic-b-new-run', [updatedB])).counts, {created: 0, updated: 1, unchanged: 0});
  state = ok(await owner.state()).state;assert.equal(state.leads.length, 2);assert.equal(state.leads.find(lead => lead.id === leadB.id).title, updatedB.title);assert.deepEqual(state.leads.find(lead => lead.id === leadA.id), before.state.leads.find(lead => lead.id === leadA.id));assert.deepEqual(state.workspaces, workflows);
  let mappings = snapshot(env.dataDir);assert.equal(mappings.source_items.find(row => row.source_id === b.id && row.external_id === externalId).lead_id, leadB.id);assert.equal(mappings.provider_items.find(row => row.provider === 'bouwberichten' && row.external_id === externalId).lead_id, leadA.id, 'Lazy canonical onboarding must select the oldest existing mapping, not the first source that reimports');
  const c = await source(owner, 'Nieuwe overlappende Bouwfilter C', 'bouwberichten', FILTER_A), keyC = await token(owner, c.id);
  const fromC = {...itemA, title: 'Nieuwe filter C gebruikt de oudste lead A', sourceUpdatedAt: '2026-11-24T12:00:00Z'};
  assert.deepEqual(ok(await env.machine(c.id, keyC, 'new-c-first-run', [fromC])).counts, {created: 0, updated: 1, unchanged: 0});
  state = ok(await owner.state()).state;assert.equal(state.leads.length, 2);assert.equal(state.leads.find(lead => lead.id === leadA.id).title, fromC.title);assert.equal(state.leads.find(lead => lead.id === leadB.id).title, updatedB.title);
  assert.equal(state.leads.find(lead => lead.id === leadA.id).source, a.id);assert.deepEqual(new Set(state.leads.find(lead => lead.id === leadA.id).sourceIds), new Set([a.id, c.id]));assert.deepEqual(new Set(state.leads.find(lead => lead.id === leadB.id).sourceIds), new Set([b.id]));assert.deepEqual(state.workspaces, workflows);
  const bAgain = {...itemB, title: 'B behoudt ook na C zijn eigen record', sourceUpdatedAt: '2026-11-24T13:00:00Z'};ok(await env.machine(b.id, keyB, 'historic-b-after-c', [bAgain]));
  state = ok(await owner.state()).state;assert.equal(state.leads.length, 2);assert.equal(state.leads.find(lead => lead.id === leadB.id).title, bAgain.title);assert.equal(state.leads.find(lead => lead.id === leadA.id).title, fromC.title);assert.deepEqual(state.workspaces, workflows);
  mappings = snapshot(env.dataDir);assert.equal(mappings.source_items.find(row => row.source_id === a.id && row.external_id === externalId).lead_id, leadA.id);assert.equal(mappings.source_items.find(row => row.source_id === b.id && row.external_id === externalId).lead_id, leadB.id);assert.equal(mappings.source_items.find(row => row.source_id === c.id && row.external_id === externalId).lead_id, leadA.id);
  assert.deepEqual(mappings.credentials, before.credentials);assert.deepEqual(mappings.sessions, before.sessions);
  const beforeRestart = structuredClone(state.leads);await env.restart();assert.deepEqual(ok(await owner.state()).state.leads, beforeRestart);assert.deepEqual(ok(await owner.state()).state.workspaces, workflows);
});
