import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {reportRows} from '../public/model.mjs';

const EMAIL = 'import-owner@example.test';
const PASSWORD = 'Import-test-password-2026!';
const TABLES = ['source_import_credentials', 'source_import_status', 'source_items', 'import_runs', 'import_errors'];

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bouwberichten-import-test-'));
  const options = {dataDir, adminEmail: EMAIL, adminName: 'Importbeheerder', adminPassword: PASSWORD, bootstrapToken: '', demoCleanupId: '', seedDemoData: false, publicOrigin: '', secureCookies: false};
  let app, base;
  async function start() {app = createApp(options);app.server.listen(0, '127.0.0.1');await once(app.server, 'listening');base = `http://127.0.0.1:${app.server.address().port}`;}
  await start();
  async function request(route, {method = 'GET', body, rawBody, headers = {}} = {}) {
    const outgoing = {...headers};
    if (body !== undefined || rawBody !== undefined) outgoing['Content-Type'] ??= 'application/json';
    const response = await fetch(base + route, {method, headers: outgoing, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual'});
    const text = await response.text();let data;try {data = JSON.parse(text);} catch {data = null;}
    return {status: response.status, ok: response.ok, data, text, headers: response.headers};
  }
  function client() {
    const session = {cookie: '', csrfToken: '', user: null};
    session.request = async (route, {method = 'GET', body, csrf = true, origin = true} = {}) => {
      const headers = {};
      if (session.cookie) headers.Cookie = session.cookie;
      if (origin) headers.Origin = typeof origin === 'string' ? origin : base;
      if (csrf && session.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
      const result = await request(route, {method, body, headers});
      const cookie = result.headers.get('set-cookie');if (cookie) session.cookie = cookie.split(';')[0];
      if (result.ok && result.data?.csrfToken) session.csrfToken = result.data.csrfToken;
      if (result.ok && result.data?.user) session.user = result.data.user;
      return result;
    };
    session.login = () => session.request('/api/auth/login', {method: 'POST', body: {email: EMAIL, password: PASSWORD}});
    session.activate = (token, name) => session.request('/api/auth/activate', {method: 'POST', body: {token, name, password: PASSWORD}});
    session.action = (type, payload = {}, companyId = 'c-noord', extra = {}) => session.request('/api/action', {method: 'POST', body: {type, companyId, payload}, ...extra});
    session.state = (companyId = 'c-noord') => session.request(`/api/state?companyId=${encodeURIComponent(companyId)}`);
    return session;
  }
  return {
    client, dataDir, request,
    get base() {return base;},
    machine(sourceId, token, body, extra = {}) {return request(`/api/import/sources/${encodeURIComponent(sourceId)}/leads`, {method: 'POST', body, headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...extra.headers}, ...extra});},
    async restart() {await app.close();await start();},
    async close() {await app.close();assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));assert.ok(path.basename(dataDir).startsWith('bouwberichten-import-test-'));await rm(dataDir, {recursive: true, force: true});}
  };
}

function ok(response, context = '') {assert.ok(response.ok, `${context}: ${response.status} ${response.data?.error || response.text.slice(0, 300)}`);return response.data;}
function stored(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'dashboard.sqlite'));
  try {
    const result = {state: JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json)};
    for (const table of [...TABLES, 'credentials', 'sessions', 'invitations']) {
      result[table] = db.prepare(`SELECT * FROM ${table}`).all().map(row => ({...row})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return result;
  } finally {db.close();}
}
async function addSource(owner, name = 'Import testbron') {return ok(await owner.action('source.create', {name})).result.source;}
async function key(owner, sourceId) {return ok(await owner.action('source.import.rotate', {id: sourceId})).result;}
const minimal = (externalId, title = 'Project voor import') => ({externalId, title});
function assertCounts(result, sourceId, runId, expected) {
  assert.equal(result.sourceId, sourceId);assert.equal(result.runId, runId);assert.deepEqual(result.counts, expected);assert.ok(Number.isFinite(Date.parse(result.importedAt)));
}

test('import keys are chief-only and authenticate the machine endpoint before parsing the body', async t => {
  const env = await fixture();t.after(() => env.close());
  const owner = env.client(), manager = env.client(), seller = env.client();ok(await owner.login());
  const foreignCompany = ok(await owner.action('company.create', {name: 'Import ander bedrijf'})).result.company;
  for (const [browser, name, email, companyId, role] of [[manager, 'Import bedrijfsbeheerder', 'import-manager@example.test', foreignCompany.id, 'bedrijfsbeheerder'], [seller, 'Import verkoper', 'import-seller@example.test', 'c-noord', 'verkoper']]) {
    const invite = ok(await owner.action('invitation.create', {name, email, companyId, role})).result;ok(await browser.activate(invite.token, name));
  }
  const source = await addSource(owner), foreignSource = await addSource(owner, 'Tweede importbron');
  const before = stored(env.dataDir);
  for (const browser of [manager, seller]) for (const [type, payload] of [['source.import.rotate', {id: source.id}], ['source.import.toggle', {id: source.id, enabled: true}], ['source.import.revoke', {id: source.id}]]) {
    assert.equal((await browser.action(type, payload, browser.user.companyId)).status, 403);
  }
  assert.deepEqual(stored(env.dataDir), before);
  for (const [type, payload] of [['source.import.rotate', {id: source.id}], ['source.import.toggle', {id: source.id, enabled: true}], ['source.import.revoke', {id: source.id}]]) {
    assert.equal((await owner.action(type, payload, 'c-noord', {csrf: false})).status, 403);
  }
  assert.equal((await owner.action('source.import.toggle', {id: source.id, enabled: true})).status, 409);
  const credentials = await key(owner, source.id), foreignCredentials = await key(owner, foreignSource.id);
  assert.equal(credentials.sourceId, source.id);assert.ok(credentials.importToken.length >= 40);
  assert.equal(new URL(credentials.importUrl, env.base).pathname, `/api/import/sources/${source.id}/leads`);
  const configured = ok(await owner.state()).state.sources.find(item => item.id === source.id);
  assert.equal(configured.importConfigured, true);assert.equal(configured.importEnabled, true);
  const stateText = JSON.stringify(ok(await owner.state()).state);
  assert.equal(stateText.includes(credentials.importToken), false);assert.doesNotMatch(stateText, /"(?:importToken|token_hash)"\s*:/);
  for (const token of [undefined, 'wrong-import-token', foreignCredentials.importToken]) {
    assert.equal((await env.machine(source.id, token, {runId: 'unauthorized', items: [minimal('denied')]})).status, 401);
  }
  const malformed = await env.request(`/api/import/sources/${source.id}/leads`, {method: 'POST', rawBody: 'This is not JSON', headers: {'Content-Type': 'text/plain'}});
  assert.equal(malformed.status, 401, 'Authentication must happen before content-type or JSON validation');
  assert.equal((await env.machine('source-unknown', credentials.importToken, {runId: 'unknown', items: [minimal('no')]})).status, 401);
  assert.equal((await env.machine('outlook', credentials.importToken, {runId: 'outlook', items: [minimal('no')]})).status, 401);
  assert.equal((await owner.action('source.import.rotate', {id: 'outlook'})).status, 400);
  const accepted = ok(await env.machine(source.id, credentials.importToken, {runId: 'machine-without-browser-csrf', items: [minimal('machine-1')]}));
  assertCounts(accepted, source.id, 'machine-without-browser-csrf', {created: 1, updated: 0, unchanged: 0});
  ok(await owner.action('source.import.toggle', {id: source.id, enabled: false}));
  assert.equal((await env.machine(source.id, credentials.importToken, {runId: 'paused', items: [minimal('paused')]})).status, 403);
  ok(await owner.action('source.import.toggle', {id: source.id, enabled: true}));
  const rotated = await key(owner, source.id);assert.notEqual(rotated.importToken, credentials.importToken);
  assert.equal((await env.machine(source.id, credentials.importToken, {runId: 'old-token', items: [minimal('old')]})).status, 401);
  ok(await env.machine(source.id, rotated.importToken, {runId: 'new-token', items: [minimal('new')]}));
  ok(await owner.action('source.import.revoke', {id: source.id}));
  assert.equal((await env.machine(source.id, rotated.importToken, {runId: 'revoked', items: [minimal('revoked')]})).status, 401);
  const revoked = ok(await owner.state()).state.sources.find(item => item.id === source.id);
  assert.equal(revoked.importConfigured, false);assert.equal(revoked.importEnabled, false);
  const deletedKey = await key(owner, source.id);ok(await owner.action('source.delete', {id: source.id}));
  assert.equal((await env.machine(source.id, deletedKey.importToken, {runId: 'deleted', items: [minimal('deleted')]})).status, 401);
  assert.equal((await owner.action('source.import.rotate', {id: source.id})).status, 404);
});

test('imports deduplicate per source, remain idempotent and preserve company workflow and conversion cohorts', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const source = await addSource(owner), second = await addSource(owner, 'Tweede bron met eigen identifiers');
  const credentials = await key(owner, source.id), secondCredentials = await key(owner, second.id);
  const payload = {runId: 'initial-batch', items: [
    {externalId: 'full-1', title: 'Woonproject eerste versie', organization: 'Eigen ontwikkelaar', city: 'Utrecht', contact: 'Eva Test', phone: '+31 20 000 4400', email: 'import-contact@example.test', description: 'Eerste projectinformatie', phase: 'Ontwerp', budget: '€ 600.000', sourceUpdatedAt: '2026-11-20T10:00:00Z'},
    {externalId: 'optional-1', title: 'Zonder contactgegevens', organization: null, city: null, contact: null, phone: null, email: null, description: null},
    {title: 'Identificatie via projectlink', sourceUrl: 'https://projects.example/project/77?ref=bron#eerste-fragment'}
  ]};
  const first = ok(await env.machine(source.id, credentials.importToken, payload));assertCounts(first, source.id, payload.runId, {created: 3, updated: 0, unchanged: 0});
  let state = ok(await owner.state()).state;
  const full = state.leads.find(lead => lead.source === source.id && lead.title === 'Woonproject eerste versie');
  const optional = state.leads.find(lead => lead.source === source.id && lead.title === 'Zonder contactgegevens');
  const linked = state.leads.find(lead => lead.source === source.id && lead.title === 'Identificatie via projectlink');
  assert.ok(full && optional && linked);assert.equal(full.demo, false);
  for (const lead of [full, optional, linked]) assert.equal(state.workspaces['c-noord']?.[lead.id]?.ownerId ?? null, null);
  for (const field of ['organization', 'city', 'contact', 'phone', 'email', 'description']) assert.equal(optional[field], '');
  assert.equal(linked.sourceUrl, 'https://projects.example/project/77?ref=bron');
  const firstStored = stored(env.dataDir);
  const retried = ok(await env.machine(source.id, credentials.importToken, structuredClone(payload)));
  assert.deepEqual(retried, first, 'A retry returns the original counts and importedAt');
  assert.deepEqual(stored(env.dataDir).source_items, firstStored.source_items);
  assert.deepEqual(stored(env.dataDir).import_runs, firstStored.import_runs);
  assert.equal(ok(await owner.state()).state.leads.length, 3);
  const conflicting = structuredClone(payload);conflicting.items[0].title = 'Geen stille wijziging van dezelfde run';
  assert.equal((await env.machine(source.id, credentials.importToken, conflicting)).status, 409);
  assert.deepEqual(stored(env.dataDir).state.leads, firstStored.state.leads);
  ok(await owner.action('workspace.update', {leadId: full.id, field: 'ownerId', value: owner.user.id}));
  ok(await owner.action('workspace.update', {leadId: full.id, field: 'status', value: 'opvolgen'}));
  ok(await owner.action('workspace.update', {leadId: full.id, field: 'commitment', value: true}));
  ok(await owner.action('workspace.update', {leadId: full.id, field: 'calculation', value: true}));
  ok(await owner.action('note.add', {leadId: full.id, text: 'Eigen gespreksnotitie blijft bij import behouden'}));
  ok(await owner.action('call.record', {leadId: full.id}));
  ok(await owner.action('callback.add', {leadId: full.id, dueAt: new Date(Date.now() + 86400000).toISOString(), assigneeId: owner.user.id}));
  state = ok(await owner.state()).state;const workspaceBefore = structuredClone(state.workspaces['c-noord'][full.id]), reportsBefore = reportRows(state, {source: source.id});
  assert.equal(reportsBefore[0].conversion, 100);
  const unchanged = {...structuredClone(payload), runId: 'same-items-next-run'};
  assertCounts(ok(await env.machine(source.id, credentials.importToken, unchanged)), source.id, unchanged.runId, {created: 0, updated: 0, unchanged: 3});
  const changed = {...structuredClone(payload), runId: 'updated-project'};changed.items[0].title = 'Woonproject nieuwe broninformatie';changed.items[0].phase = 'Uitvoering';changed.items[0].sourceUpdatedAt = '2026-11-24T11:00:00Z';changed.items[2].sourceUrl = 'https://projects.example/project/77?ref=bron#ander-fragment';
  assertCounts(ok(await env.machine(source.id, credentials.importToken, changed)), source.id, changed.runId, {created: 0, updated: 1, unchanged: 2});
  state = ok(await owner.state()).state;const updated = state.leads.find(lead => lead.id === full.id);
  assert.equal(updated.title, changed.items[0].title);assert.equal(updated.phase, 'Uitvoering');assert.equal(updated.createdAt, full.createdAt);
  assert.equal(state.leads.find(lead => lead.sourceUrl === linked.sourceUrl).id, linked.id);
  assert.deepEqual(state.workspaces['c-noord'][full.id], workspaceBefore);
  assert.deepEqual(reportRows(state, {source: source.id}), reportsBefore);
  const crossSource = ok(await env.machine(second.id, secondCredentials.importToken, {runId: 'initial-batch', items: [minimal('full-1', 'Zelfde externe ID in andere bron')]}));
  assertCounts(crossSource, second.id, 'initial-batch', {created: 1, updated: 0, unchanged: 0});
  const otherLead = ok(await owner.state()).state.leads.find(lead => lead.source === second.id);assert.notEqual(otherLead.id, full.id);
  const beforeRestart = stored(env.dataDir);await env.restart();
  assert.deepEqual(stored(env.dataDir).source_items, beforeRestart.source_items);assert.deepEqual(stored(env.dataDir).import_runs, beforeRestart.import_runs);
  assert.deepEqual(ok(await env.machine(source.id, credentials.importToken, payload)), first, 'Successful retries and credentials survive restart');
  assert.deepEqual(ok(await owner.state()).state.workspaces['c-noord'][full.id], workspaceBefore);
  const metadata = ok(await owner.state()).state.sources.find(item => item.id === source.id);
  assert.equal(metadata.importConfigured, true);assert.equal(metadata.importEnabled, true);assert.ok(metadata.lastImportAt);assert.ok(metadata.lastImportCounts);
});

test('invalid batches roll back completely, enforce limits and expose no raw token or payload in status or logs', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const source = await addSource(owner), credentials = await key(owner, source.id);
  const seed = {runId: 'baseline', items: [minimal('existing', 'Bestaand project')]};ok(await env.machine(source.id, credentials.importToken, seed));
  const baseline = stored(env.dataDir), metadataBefore = ok(await owner.state()).state.sources.find(item => item.id === source.id);
  const marker = 'private-payload-must-not-appear-in-logs';const logs = [], originalError = console.error, originalLog = console.log;
  console.error = (...args) => {logs.push(args.map(String).join(' '));};console.log = (...args) => {logs.push(args.map(String).join(' '));};
  try {
    const invalidBatch = {runId: 'atomic-retry', items: [minimal('existing', 'Mag niet gedeeltelijk wijzigen'), {externalId: 'invalid-second', title: '', description: marker}]};
    assert.equal((await env.machine(source.id, credentials.importToken, invalidBatch)).status, 400);
    const afterFailure = stored(env.dataDir);
    assert.deepEqual(afterFailure.state, baseline.state);assert.deepEqual(afterFailure.source_items, baseline.source_items);assert.deepEqual(afterFailure.import_runs, baseline.import_runs);
    const metadata = ok(await owner.state()).state.sources.find(item => item.id === source.id);
    assert.equal(metadata.lastImportAt, metadataBefore.lastImportAt);assert.deepEqual(metadata.lastImportCounts, metadataBefore.lastImportCounts);
    assert.ok(metadata.lastImportError);assert.equal(JSON.stringify(metadata.lastImportError).includes(marker), false);assert.equal(JSON.stringify(metadata.lastImportError).includes(credentials.importToken), false);
    const repaired = {runId: 'atomic-retry', items: [minimal('existing', 'Geldige update'), minimal('new-second', 'Geldige tweede lead')]};
    assertCounts(ok(await env.machine(source.id, credentials.importToken, repaired)), source.id, repaired.runId, {created: 1, updated: 1, unchanged: 0});
    const invalidBodies = [
      {runId: '', items: [minimal('bad-run')]}, {runId: 'r'.repeat(129), items: [minimal('bad-run')]}, {runId: 1, items: [minimal('bad-run')]},
      {runId: 'empty', items: []}, {runId: 'too-many', items: Array.from({length: 101}, (_, i) => minimal(`extra-${i}`))},
      {runId: 'duplicate-identifiers', items: [minimal('same-external-id', 'Eerste project'), minimal('same-external-id', 'Tweede project')]},
      {runId: 'no-identifier', items: [{title: 'Zonder identificatie'}]}, {runId: 'bad-title', items: [minimal('title', '   ')]},
      {runId: 'bad-url-scheme', items: [{externalId: 'url', title: 'Onveilige link', sourceUrl: 'javascript:alert(1)'}]},
      {runId: 'bad-url-credentials', items: [{externalId: 'url', title: 'Onveilige link', sourceUrl: 'https://user:password@projects.example/private'}]},
      {runId: 'bad-email', items: [{externalId: 'email', title: 'Ongeldig e-mailadres', email: 'not-an-email'}]},
      {runId: 'bad-phone', items: [{externalId: 'phone', title: 'Ongeldig telefoonnummer', phone: 'javascript:alert(1)'}]},
      {runId: 'bad-date', items: [{externalId: 'date', title: 'Ongeldige brondatum', sourceUpdatedAt: 'not-a-date'}]}
    ];
    for (const body of invalidBodies) {
      const before = stored(env.dataDir);assert.equal((await env.machine(source.id, credentials.importToken, body)).status, 400, body.runId);
      const after = stored(env.dataDir);assert.deepEqual(after.state, before.state);assert.deepEqual(after.source_items, before.source_items);assert.deepEqual(after.import_runs, before.import_runs);
    }
    const beforeLarge = stored(env.dataDir);
    assert.equal((await env.machine(source.id, credentials.importToken, {runId: 'body-limit', items: [{externalId: 'oversized', title: 'Te groot verzoek', description: 'x'.repeat(1024 * 1024)}]})).status, 413);
    assert.deepEqual(stored(env.dataDir).state, beforeLarge.state);assert.deepEqual(stored(env.dataDir).source_items, beforeLarge.source_items);
    const maximum = {runId: 'maximum-hundred', items: Array.from({length: 100}, (_, i) => minimal(`maximum-${i}`, `Project ${i}`))};
    assertCounts(ok(await env.machine(source.id, credentials.importToken, maximum)), source.id, maximum.runId, {created: 100, updated: 0, unchanged: 0});
    const visible = JSON.stringify(ok(await owner.state()).state), saved = JSON.stringify(stored(env.dataDir));
    assert.equal(visible.includes(credentials.importToken), false);assert.equal(saved.includes(credentials.importToken), false);
    assert.equal(logs.join('\n').includes(credentials.importToken), false);assert.equal(logs.join('\n').includes(marker), false);
    assert.equal(stored(env.dataDir).import_errors.some(row => String(row.message).includes(marker)), false);
  } finally {console.error = originalError;console.log = originalLog;}
});

test('import JSON preserves UTF-8 characters across network chunks and rejects malformed UTF-8', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const source = await addSource(owner, 'Importbron met accenten'), credentials = await key(owner, source.id);
  const title = 'Rénovation van een residentiële gevel';
  const payload = {runId: 'utf8-split', items: [{externalId: 'unicode-1', title, city: 'Dokkum', description: 'Bouwprijs € 80.000; contact vóór de zomer.'}]};
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8'), splitAt = encoded.indexOf(Buffer.from('é', 'utf8')) + 1;
  assert.ok(splitAt > 0 && encoded[splitAt] === 0xa9);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(new URL(`/api/import/sources/${source.id}/leads`, env.base), {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${credentials.importToken}`}}, res => {
      const chunks = [];res.on('data', chunk => chunks.push(chunk));res.on('error', reject);res.on('end', () => {const text = Buffer.concat(chunks).toString('utf8');let data;try {data = JSON.parse(text);} catch {data = null;}resolve({status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data, text});});
    });
    req.on('error', reject);req.write(encoded.subarray(0, splitAt));setTimeout(() => req.end(encoded.subarray(splitAt)), 25);
  });
  assertCounts(ok(response), source.id, payload.runId, {created: 1, updated: 0, unchanged: 0});
  const imported = ok(await owner.state()).state.leads.find(lead => lead.source === source.id);
  assert.equal(imported.title, title);assert.equal(imported.description, payload.items[0].description);
  const before = stored(env.dataDir);
  const invalidUtf8 = Buffer.concat([Buffer.from('{"runId":"invalid-utf8","items":[{"externalId":"invalid-utf8","title":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}]}')]);
  const denied = await env.request(`/api/import/sources/${source.id}/leads`, {method: 'POST', rawBody: invalidUtf8, headers: {Authorization: `Bearer ${credentials.importToken}`, 'Content-Type': 'application/json'}});
  assert.equal(denied.status, 400);
  const after = stored(env.dataDir);assert.deepEqual(after.state, before.state);assert.deepEqual(after.source_items, before.source_items);assert.deepEqual(after.import_runs, before.import_runs);
});

test('partial imports preserve omitted fields, skip stale source updates and respect manual corrections during explicit clears', async t => {
  const env = await fixture();t.after(() => env.close());const owner = env.client();ok(await owner.login());
  const source = await addSource(owner, 'Bron met gedeeltelijke updates'), credentials = await key(owner, source.id);
  const full = {externalId: 'partial-1', title: 'Eerste volledige projecttitel', organization: 'Bronontwikkelaar', city: 'Utrecht', contact: 'Contact vanuit de bron', phone: '+31 20 000 1122', email: 'partial-import@example.test', description: 'Volledige projectbeschrijving', phase: 'Ontwerp', budget: '€ 200.000', sourceUrl: 'https://projects.example/partial/1', sourceUpdatedAt: '2026-11-24T12:00:00Z'};
  ok(await env.machine(source.id, credentials.importToken, {runId: 'partial-initial', items: [full]}));
  const initial = ok(await owner.state()).state.leads.find(lead => lead.source === source.id);
  const partial = {runId: 'partial-title-only', items: [{externalId: 'partial-1', title: 'Bijgewerkte projecttitel'}]};
  assertCounts(ok(await env.machine(source.id, credentials.importToken, partial)), source.id, partial.runId, {created: 0, updated: 1, unchanged: 0});
  const updated = ok(await owner.state()).state.leads.find(lead => lead.id === initial.id);
  assert.equal(updated.title, 'Bijgewerkte projecttitel');
  for (const field of ['organization', 'city', 'contact', 'phone', 'email', 'description', 'phase', 'budget', 'sourceUrl', 'sourceUpdatedAt', 'createdAt']) assert.equal(updated[field], initial[field], `${field} must be preserved when omitted`);
  const beforeStale = stored(env.dataDir);
  const stale = {runId: 'partial-older-source-date', items: [{externalId: 'partial-1', title: 'Oude titel mag niet terugkomen', organization: 'Verouderde bronorganisatie', sourceUpdatedAt: '2026-11-20T12:00:00Z'}]};
  assertCounts(ok(await env.machine(source.id, credentials.importToken, stale)), source.id, stale.runId, {created: 0, updated: 0, unchanged: 1});
  assert.deepEqual(stored(env.dataDir).state.leads, beforeStale.state.leads);
  assert.deepEqual(stored(env.dataDir).source_items, beforeStale.source_items, 'Stale data must not replace the comparison snapshot either');
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  const manuallyCorrected = JSON.parse(setup.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  const corrected = manuallyCorrected.leads.find(lead => lead.id === initial.id);corrected.organization = 'Handmatig gecorrigeerde organisatie';corrected.contact = 'Eigen gecorrigeerde contactpersoon';
  setup.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(manuallyCorrected));setup.close();
  const clear = {runId: 'partial-explicit-clears', items: [{externalId: 'partial-1', title: 'Bijgewerkte projecttitel', organization: null, city: null, contact: '', phone: null, email: '', description: null, phase: '', budget: null, sourceUrl: null, sourceUpdatedAt: null}]};
  assertCounts(ok(await env.machine(source.id, credentials.importToken, clear)), source.id, clear.runId, {created: 0, updated: 1, unchanged: 0});
  const cleared = ok(await owner.state()).state.leads.find(lead => lead.id === initial.id);
  assert.equal(cleared.organization, 'Handmatig gecorrigeerde organisatie');assert.equal(cleared.contact, 'Eigen gecorrigeerde contactpersoon');
  for (const field of ['city', 'phone', 'email', 'description', 'phase', 'budget', 'sourceUrl', 'sourceUpdatedAt']) assert.equal(cleared[field], '', `${field} can be explicitly cleared when it still matches the previous source snapshot`);
  assert.equal(cleared.id, initial.id);assert.equal(cleared.createdAt, initial.createdAt);
  await env.restart();
  assert.deepEqual(ok(await owner.state()).state.leads.find(lead => lead.id === initial.id), cleared);
});
