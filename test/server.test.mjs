import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {createApp} from '../server.mjs';
import {reportRows} from '../public/model.mjs';

const PASSWORD = 'Test-only-password-2026!';
const OTHER_PASSWORD = 'Another-test-password-2026!';
const ADMIN_EMAIL = 'owner@example.test';

async function fixture(extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bouwberichten-api-test-'));
  const bootstrapToken = randomBytes(32).toString('base64url');
  const options = {dataDir, bootstrapToken, adminEmail: ADMIN_EMAIL, adminName: 'Testbeheerder', adminPassword: '', demoCleanupId: '', seedDemoData: true, publicOrigin: '', secureCookies: false, ...extra};
  let app, base;
  async function start() {
    app = await createApp(options);
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await start();
  function client() {
    const session = {cookie: '', csrfToken: '', user: null};
    return Object.assign(session, {
      async request(route, {method = 'GET', body, csrf = true, origin = true, headers = {}} = {}) {
        const outgoing = {...headers};
        if (session.cookie) outgoing.Cookie = session.cookie;
        if (origin) outgoing.Origin = typeof origin === 'string' ? origin : base;
        if (body !== undefined) outgoing['Content-Type'] = 'application/json';
        if (csrf && session.csrfToken) outgoing['X-CSRF-Token'] = session.csrfToken;
        const response = await fetch(base + route, {method, headers: outgoing, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'});
        const cookie = response.headers.get('set-cookie');
        if (cookie) session.cookie = cookie.split(';')[0];
        const bytes = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder().decode(bytes);
        let data; try {data = JSON.parse(text);} catch {data = null;}
        if (response.ok && data?.csrfToken) session.csrfToken = data.csrfToken;
        if (response.ok && data?.user) session.user = data.user;
        return {status: response.status, ok: response.ok, data, text, bytes, headers: response.headers};
      },
      async action(type, companyId, payload = {}, requestOptions = {}) {
        return session.request('/api/action', {method: 'POST', body: {type, companyId, payload}, ...requestOptions});
      },
      async activate(token, name = 'Testgebruiker', password = PASSWORD) {
        return session.request('/api/auth/activate', {method: 'POST', body: {token, name, password}});
      },
      async login(email = ADMIN_EMAIL, password = PASSWORD, rememberMe) {
        return session.request('/api/auth/login', {method: 'POST', body: {email, password, ...(rememberMe === undefined ? {} : {rememberMe})}});
      },
      async state(companyId = 'c-noord') {
        return session.request(`/api/state?companyId=${encodeURIComponent(companyId)}`);
      }
    });
  }
  return {
    client, bootstrapToken: options.bootstrapToken, dataDir,
    get base() {return base;},
    get maintenanceResult() {return app?.maintenanceResult;},
    async restart(optionsPatch = {}) {if (app) await app.close(); app = null; Object.assign(options, optionsPatch); await start();},
    async close() {
      if (app) {await app.close(); app = null;}
      const resolved = path.resolve(dataDir), parent = path.resolve(os.tmpdir());
      assert.equal(path.dirname(resolved), parent);
      assert.ok(path.basename(resolved).startsWith('bouwberichten-api-test-'));
      await rm(resolved, {recursive: true, force: true});
    }
  };
}

function accepted(response, context = '') {
  assert.ok(response.ok, `${context}: ${response.status} ${response.data?.error || response.text.slice(0, 300)}`);
  return response.data;
}
function denied(response, context = '') {
  assert.ok(response.status >= 400 && response.status < 500, `${context} should fail: ${response.status}`);
  assert.equal(typeof response.data?.error, 'string', `${context} needs a useful error`);
}
function assertNoSecrets(state) {
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /"(?:passwordHash|password_hash|tokenHash|token_hash|csrfToken|sessionHash|session_hash|salt)"\s*:/i);
}

function databaseSnapshot(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'dashboard.sqlite'));
  try {
    const optionalRows = (table, orderBy = 'id') => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all().map(row => ({...row})) : [];
    return {
      state: JSON.parse(db.prepare('SELECT json FROM app_state WHERE id=1').get().json),
      credentials: db.prepare('SELECT * FROM credentials ORDER BY user_id').all().map(row => ({...row})),
      sessions: db.prepare('SELECT * FROM sessions ORDER BY token_hash').all().map(row => ({...row})),
      invitations: db.prepare('SELECT * FROM invitations ORDER BY id').all().map(row => ({...row})),
      archives: optionalRows('demo_lead_archives'),
      migrations: optionalRows('app_migrations'),
      companyLogos: optionalRows('company_logos', 'company_id')
    };
  } finally {db.close();}
}

function pngFixture(width = 1, height = 1, variant = false, noisy = false) {
  const crc32 = bytes => {let crc = 0xffffffff;for (const byte of bytes) {crc ^= byte;for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}return (crc ^ 0xffffffff) >>> 0;};
  const chunk = (type, data) => {const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));return Buffer.concat([length, label, data, checksum]);};
  const header = Buffer.alloc(13);header.writeUInt32BE(width, 0);header.writeUInt32BE(height, 4);header[8] = 8;header[9] = 6;
  const stride = width * 4 + 1, pixels = noisy ? randomBytes(stride * height) : Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {pixels[y * stride] = 0;if (!noisy) for (let x = 0; x < width; x++) {const offset = y * stride + 1 + x * 4;pixels[offset] = variant ? 8 : 36;pixels[offset + 1] = variant ? 126 : 93;pixels[offset + 2] = variant ? 115 : 228;pixels[offset + 3] = 255;}}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const asPngDataUrl = bytes => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');

test('account activation, invitations, company boundaries and persistent shared work', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client(), anonymous = env.client();
  let seller, deltaAdmin, deltaSeller, sellerId, deltaAdminId, originalInvite;

  await t.test('only public assets and health are accessible before sign-in', async () => {
    assert.equal(accepted(await anonymous.request('/health')).ok, true);
    const session = accepted(await anonymous.request('/api/session'));
    assert.equal(session.authenticated, false);
    assert.equal((await anonymous.state()).status, 401);
    denied(await anonymous.action('settings.update', 'c-noord', {cooldownHours: 0}));
    const index = await anonymous.request('/');
    assert.equal(index.status, 200);
    assert.match(index.text, /Bouwberichten Dashboard/);
    for (const route of ['/server.mjs', '/.env', '/.git/config', '/data/app.sqlite', '/%2e%2e%2fserver.mjs']) {
      const result = await anonymous.request(route);
      assert.equal(result.status, 404, `${route} must not expose private files or a misleading success`);
    }
  });

  await t.test('bootstrap invitation is one-use and a weak password does not consume it', async () => {
    const preview = accepted(await anonymous.request('/api/invitations/preview', {method: 'POST', body: {token: env.bootstrapToken}}));
    assert.equal(preview.invitation.email, ADMIN_EMAIL);
    assert.equal(preview.invitation.role, 'hoofdbeheerder');
    denied(await anonymous.activate('not-a-valid-token'));
    denied(await anonymous.activate(env.bootstrapToken, 'Testbeheerder', 'short'));
    const activated = accepted(await owner.activate(env.bootstrapToken, 'Testbeheerder'));
    assert.equal(activated.authenticated, true);
    assert.equal(activated.user.role, 'hoofdbeheerder');
    assert.equal(activated.user.companyId, 'c-noord');
    assert.match(owner.cookie, /=.+/);
    assert.ok(owner.csrfToken.length >= 24);
    denied(await anonymous.activate(env.bootstrapToken));
    assertNoSecrets(activated.user);
  });

  await t.test('sessions use HttpOnly cookies and reject cross-site or missing-CSRF writes', async () => {
    const signIn = await env.client().login();
    accepted(signIn);
    assert.match(signIn.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(signIn.headers.get('set-cookie'), /SameSite=Lax/i);
    assert.match(signIn.headers.get('cache-control'), /no-store/i);
    assert.equal((await owner.action('settings.update', 'c-noord', {cooldownHours: 24}, {csrf: false})).status, 403);
    const unicodeCsrf = 'é'.repeat(owner.csrfToken.length);
    const malformed = await owner.action('settings.update', 'c-noord', {cooldownHours: 24}, {csrf: false, headers: {'X-CSRF-Token': unicodeCsrf}});
    assert.equal(malformed.status, 403, 'A byte-length mismatch in the CSRF header must be rejected, never throw a 500');
    assert.equal((await owner.action('settings.update', 'c-noord', {cooldownHours: 24}, {origin: 'https://untrusted.example'})).status, 403);
    denied(await env.client().login(ADMIN_EMAIL, 'incorrect-password'));
    assert.equal(accepted(await owner.request('/api/session')).user.id, owner.user.id);
  });

  await t.test('links carry an unpredictable token, list responses never expose it, and activation fixes one company', async () => {
    originalInvite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Noord Verkoper', email: 'seller@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
    assert.ok(originalInvite.token.length >= 40);
    assert.ok(originalInvite.invitation.id);
    const state = accepted(await owner.state()).state;
    assertNoSecrets(state);
    assert.ok(!JSON.stringify(state).includes(originalInvite.token));
    const link = new URL('/#activate=' + originalInvite.token, env.base);
    assert.equal(link.search, '');
    assert.equal(link.hash.slice(10), originalInvite.token);
    const preview = accepted(await anonymous.request('/api/invitations/preview', {method: 'POST', body: {token: originalInvite.token}}));
    assert.equal(preview.invitation.companyId, 'c-noord');
    seller = env.client();
    const result = accepted(await seller.request('/api/auth/activate', {method: 'POST', body: {token: originalInvite.token, name: 'Noord Verkoper', password: PASSWORD, email: 'forged@example.test', companyId: 'c-delta', role: 'hoofdbeheerder'}}));
    sellerId = result.user.id;
    assert.equal(result.user.companyId, 'c-noord');
    assert.equal(result.user.role, 'verkoper');
    denied(await owner.action('invitation.create', 'c-delta', {name: 'Duplicate', email: 'SELLER@example.test', companyId: 'c-delta', role: 'verkoper'}));
  });

  await t.test('only one activation wins when the invitation is used concurrently', async () => {
    const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Eenmaal', email: 'once@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
    const outcomes = await Promise.all([env.client().activate(invite.token, 'Eenmaal'), env.client().activate(invite.token, 'Nogmaals')]);
    assert.equal(outcomes.filter(r => r.ok).length, 1);
    assert.equal(outcomes.filter(r => r.status >= 400 && r.status < 500).length, 1);
  });

  await t.test('rotating and revoking links invalidate the previous token immediately', async () => {
    const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Nieuwe link', email: 'rotate@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
    const rotated = accepted(await owner.action('invitation.rotate', 'c-noord', {invitationId: invite.invitation.id})).result;
    assert.notEqual(rotated.token, invite.token);
    denied(await anonymous.activate(invite.token));
    accepted(await anonymous.request('/api/invitations/preview', {method: 'POST', body: {token: rotated.token}}));
    accepted(await owner.action('invitation.revoke', 'c-noord', {invitationId: invite.invitation.id}));
    denied(await anonymous.activate(rotated.token));
  });

  await t.test('company administrators manage only their company and cannot create a head administrator', async () => {
    const invite = accepted(await owner.action('invitation.create', 'c-delta', {name: 'Delta Beheerder', email: 'delta-admin@example.test', companyId: 'c-delta', role: 'bedrijfsbeheerder'})).result;
    deltaAdmin = env.client();
    const activated = accepted(await deltaAdmin.activate(invite.token, 'Delta Beheerder'));
    deltaAdminId = activated.user.id;
    const ownInvite = accepted(await deltaAdmin.action('invitation.create', 'c-delta', {name: 'Delta Verkoper', email: 'delta-seller@example.test', companyId: 'c-delta', role: 'verkoper'})).result;
    deltaSeller = env.client();
    accepted(await deltaSeller.activate(ownInvite.token, 'Delta Verkoper'));
    assert.equal((await deltaAdmin.action('invitation.create', 'c-delta', {name: 'Hoofd', email: 'bad-head@example.test', companyId: 'c-delta', role: 'hoofdbeheerder'})).status, 403);
    assert.equal((await deltaAdmin.action('invitation.create', 'c-noord', {name: 'Ander bedrijf', email: 'bad-company@example.test', companyId: 'c-noord', role: 'verkoper'})).status, 403);
    assert.equal((await deltaAdmin.action('settings.update', 'c-delta', {cooldownHours: 0})).status, 403);
  });

  await t.test('sellers cannot gain management roles, create invitations or select another company', async () => {
    assert.equal((await seller.action('invitation.create', 'c-noord', {name: 'Collega', email: 'seller-invite@example.test', companyId: 'c-noord', role: 'verkoper'})).status, 403);
    assert.equal((await seller.action('user.update', 'c-noord', {userId: sellerId, companyId: 'c-noord', role: 'hoofdbeheerder'})).status, 403);
    assert.equal((await seller.action('settings.update', 'c-noord', {cooldownHours: 0})).status, 403);
    assert.equal((await seller.state('c-delta')).status, 403);
    assert.equal((await seller.action('note.add', 'c-delta', {leadId: 'l-01', text: 'Foreign write'})).status, 403);
    denied(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'role', value: 'hoofdbeheerder'}));
  });

  await t.test('notes and ownership stay inside one company and actor identity comes from the session', async () => {
    const noteText = 'Confidential Noord note ' + randomBytes(8).toString('hex');
    accepted(await seller.action('note.add', 'c-noord', {leadId: 'l-01', text: noteText, authorName: 'Forged administrator', authorId: owner.user.id}));
    const own = accepted(await seller.state()).state;
    const note = own.workspaces['c-noord']['l-01'].notes.find(n => n.text === noteText);
    assert.equal(note.authorId, sellerId);
    assert.equal(note.authorName, 'Noord Verkoper');
    const foreign = accepted(await deltaAdmin.state('c-delta')).state;
    assert.equal(JSON.stringify(foreign).includes(noteText), false);
    assert.deepEqual(Object.keys(foreign.workspaces), ['c-delta']);
    assert.ok(foreign.users.every(u => u.companyId === 'c-delta'));
    assert.ok(foreign.invitations.every(i => i.companyId === 'c-delta'));
    assertNoSecrets(own);
    assertNoSecrets(foreign);
  });

  await t.test('toezegging and calculation are separate flags and field types are validated', async () => {
    accepted(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'commitment', value: true}));
    let work = accepted(await seller.state()).state.workspaces['c-noord']['l-01'];
    assert.equal(work.commitment, true);
    assert.equal(work.calculation, false);
    accepted(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'calculation', value: true}));
    accepted(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'commitment', value: false}));
    work = accepted(await seller.state()).state.workspaces['c-noord']['l-01'];
    assert.equal(work.commitment, false);
    assert.equal(work.calculation, true);
    denied(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'commitment', value: 'false'}));
    denied(await seller.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'status', value: 'unknown-column'}));
  });

  await t.test('the global cooldown is per lead and an assigned due callback is the exception', async () => {
    accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 48}));
    accepted(await deltaAdmin.action('call.record', 'c-delta', {leadId: 'l-02'}));
    denied(await seller.action('call.record', 'c-noord', {leadId: 'l-02'}));
    accepted(await seller.action('call.record', 'c-noord', {leadId: 'l-03'}));
    accepted(await owner.action('callback.add', 'c-noord', {leadId: 'l-02', dueAt: new Date(Date.now() - 60000).toISOString(), assigneeId: owner.user.id}));
    denied(await seller.action('call.record', 'c-noord', {leadId: 'l-02'}));
    accepted(await owner.action('callback.add', 'c-noord', {leadId: 'l-02', dueAt: new Date(Date.now() - 30000).toISOString(), assigneeId: sellerId}));
    accepted(await seller.action('call.record', 'c-noord', {leadId: 'l-02'}));
    const hidden = accepted(await deltaAdmin.state('c-delta')).state.callLog.filter(c => c.companyId !== 'c-delta');
    assert.ok(hidden.length > 0);
    assert.ok(hidden.every(c => !c.userName && !c.userId));
  });

  await t.test('a head administrator can log a call for another company without assigning themselves to that company', async () => {
    const result = accepted(await owner.action('call.record', 'c-horizon', {leadId: 'l-05'}));
    const work = result.state.workspaces['c-horizon']['l-05'];
    assert.equal(work.ownerId, null);
    assert.equal(work.calls.at(-1).userId, owner.user.id);
    assert.equal(result.state.users.find(u => u.id === owner.user.id).companyId, 'c-noord');
  });

  await t.test('company additions and historical data survive moving a user, while their old session is revoked', async () => {
    const before = accepted(await owner.state()).state;
    const historyBefore = before.workspaces['c-noord']['l-01'].notes;
    const oldCompanyCount = before.companies.length;
    accepted(await owner.action('company.create', 'c-noord', {name: 'Nieuw bedrijf voor test'}));
    assert.equal(accepted(await owner.state()).state.companies.length, oldCompanyCount + 1);
    accepted(await owner.action('user.update', 'c-noord', {userId: sellerId, companyId: 'c-delta', role: 'verkoper'}));
    assert.equal((await seller.state()).status, 401);
    accepted(await seller.login('seller@example.test'));
    assert.equal(seller.user.companyId, 'c-delta');
    assert.equal((await seller.state('c-noord')).status, 403);
    const after = accepted(await owner.state()).state;
    assert.deepEqual(after.workspaces['c-noord']['l-01'].notes, historyBefore);
    assert.equal(JSON.stringify(accepted(await seller.state('c-delta')).state).includes(historyBefore[0].text), false);
  });

  await t.test('accounts and shared work remain after restarting the application', async () => {
    const before = accepted(await owner.state()).state;
    await env.restart();
    const newOwner = env.client();
    accepted(await newOwner.login());
    const after = accepted(await newOwner.state()).state;
    assert.deepEqual(after.companies, before.companies);
    assert.deepEqual(after.workspaces['c-noord']['l-01'].notes, before.workspaces['c-noord']['l-01'].notes);
    assert.equal(after.users.find(u => u.id === sellerId).companyId, 'c-delta');
    denied(await env.client().activate(env.bootstrapToken));
    accepted(await newOwner.request('/api/auth/logout', {method: 'POST', body: {}}));
    assert.equal((await newOwner.state()).status, 401);
  });
});

test('expired invitations are rejected and a fresh link restores only the intended invitation', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client(), anonymous = env.client();
  accepted(await owner.activate(env.bootstrapToken, 'Owner'));
  const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Verlopen uitnodiging', email: 'expired@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  // Move only this invitation's expiry into the past to exercise the public API
  // without waiting seven days or changing process-global time.
  const clockSetup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  clockSetup.prepare('UPDATE invitations SET expires_at=? WHERE id=?').run(Date.now() - 1000, invite.invitation.id);
  clockSetup.close();
  assert.equal((await anonymous.request('/api/invitations/preview', {method: 'POST', body: {token: invite.token}})).status, 410);
  assert.equal((await anonymous.activate(invite.token)).status, 410);
  const rotated = accepted(await owner.action('invitation.rotate', 'c-noord', {invitationId: invite.invitation.id})).result;
  assert.equal(rotated.invitation.email, 'expired@example.test');
  assert.equal(rotated.invitation.companyId, 'c-noord');
  assert.equal(rotated.invitation.role, 'verkoper');
  accepted(await anonymous.activate(rotated.token, 'Verlopen uitnodiging'));
});

test('production cookies are Secure and invalid origins cannot activate a link', async t => {
  const expectedOrigin = 'https://dashboard.example.test';
  const env = await fixture({secureCookies: true, publicOrigin: expectedOrigin});
  t.after(() => env.close());
  const browser = env.client();
  const bad = await browser.request('/api/auth/activate', {method: 'POST', body: {token: env.bootstrapToken, name: 'Owner', password: PASSWORD}, origin: 'https://evil.example'});
  assert.equal(bad.status, 403);
  const result = await browser.request('/api/auth/activate', {method: 'POST', body: {token: env.bootstrapToken, name: 'Owner', password: OTHER_PASSWORD}, origin: expectedOrigin});
  accepted(result);
  assert.match(result.headers.get('set-cookie'), /(?:^|;)\s*Secure(?:;|$)/i);
  assert.match(result.headers.get('set-cookie'), /HttpOnly/i);
});

test('changing your own role keeps a head administrator and immediately invalidates the old session', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const first = env.client(), second = env.client();
  accepted(await first.activate(env.bootstrapToken, 'Eerste hoofdbeheerder'));
  const firstId = first.user.id;
  denied(await first.action('user.update', 'c-noord', {userId: firstId, companyId: 'c-noord', role: 'verkoper'}));
  const invite = accepted(await first.action('invitation.create', 'c-noord', {name: 'Tweede hoofdbeheerder', email: 'second-head@example.test', companyId: 'c-noord', role: 'hoofdbeheerder'})).result;
  accepted(await second.activate(invite.token, 'Tweede hoofdbeheerder'));
  const changed = accepted(await first.action('user.update', 'c-noord', {userId: firstId, companyId: 'c-noord', role: 'verkoper'}));
  assert.equal(changed.state.users.find(u => u.id === firstId).role, 'verkoper');
  assert.equal((await first.state()).status, 401);
  accepted(await first.login());
  assert.equal(first.user.role, 'verkoper');
  assert.equal((await first.action('settings.update', 'c-noord', {cooldownHours: 0})).status, 403);
  accepted(await second.action('settings.update', 'c-noord', {cooldownHours: 24}));
});

test('a configured administrator password enables direct login without a bootstrap link', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const browser = env.client();
  assert.equal(accepted(await browser.request('/api/session')).authenticated, false);
  for (const route of ['/login', '/login/']) {
    const page = await browser.request(route);
    assert.equal(page.status, 200);
    assert.match(page.text, /src="\/app\.mjs"/);
    assert.match(page.text, /href="\/styles\.css"/);
  }
  const session = accepted(await browser.login());
  assert.equal(session.user.id, 'u-admin');
  assert.equal(session.user.email, ADMIN_EMAIL);
  assert.equal(session.user.role, 'hoofdbeheerder');
  assert.equal(session.user.status, 'actief');
  assertNoSecrets(accepted(await browser.state()).state);
  assert.equal(databaseSnapshot(env.dataDir).invitations.some(row => row.id === 'bootstrap-owner'), false);
});

test('an unchanged configured password preserves its hash and existing sessions across a restart', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Notitie vóór een normale herstart'}));
  const before = databaseSnapshot(env.dataDir);
  await env.restart();
  const resumed = accepted(await owner.request('/api/session'));
  assert.equal(resumed.authenticated, true);
  assert.equal(resumed.csrfToken, owner.csrfToken);
  const after = databaseSnapshot(env.dataDir);
  assert.deepEqual(after.credentials, before.credentials);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.state, before.state);
  assert.equal(accepted(await owner.state()).state.workspaces['c-noord']['l-01'].notes[0].text, 'Notitie vóór een normale herstart');
});

test('changing the configured password revokes old sessions and keeps the owner identity and history', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const oldSession = env.client();
  accepted(await oldSession.login());
  accepted(await oldSession.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Historie blijft na wachtwoordwijziging'}));
  const before = databaseSnapshot(env.dataDir);
  await env.restart({adminPassword: OTHER_PASSWORD});
  assert.equal((await oldSession.state()).status, 401);
  assert.equal(accepted(await oldSession.request('/api/session')).authenticated, false);
  denied(await env.client().login(ADMIN_EMAIL, PASSWORD));
  const owner = env.client();
  const session = accepted(await owner.login(ADMIN_EMAIL, OTHER_PASSWORD));
  assert.equal(session.user.id, 'u-admin');
  assert.equal(session.user.name, 'Testbeheerder');
  const after = databaseSnapshot(env.dataDir);
  assert.notEqual(after.credentials[0].password_hash, before.credentials[0].password_hash);
  assert.equal(after.state.users.length, before.state.users.length);
  assert.deepEqual(after.state.workspaces, before.state.workspaces);
});

test('changing the configured email updates the existing owner and preserves company, name, password hash and history', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD, adminName: 'Bestaande beheerdersnaam'});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Bewaarde historie bij e-mailwijziging'}));
  accepted(await owner.action('user.update', 'c-noord', {userId: 'u-admin', companyId: 'c-delta', role: 'hoofdbeheerder'}));
  accepted(await owner.login());
  const before = databaseSnapshot(env.dataDir);
  const nextEmail = 'renamed-owner@example.test';
  await env.restart({adminEmail: nextEmail, adminName: 'Naam uit nieuwe configuratie'});
  assert.equal((await owner.state('c-delta')).status, 401);
  denied(await env.client().login(ADMIN_EMAIL, PASSWORD));
  const renamed = env.client();
  const session = accepted(await renamed.login(nextEmail, PASSWORD));
  assert.equal(session.user.id, 'u-admin');
  assert.equal(session.user.name, 'Bestaande beheerdersnaam');
  assert.equal(session.user.companyId, 'c-delta');
  const after = databaseSnapshot(env.dataDir);
  assert.equal(after.state.users.length, before.state.users.length);
  assert.equal(after.credentials[0].password_hash, before.credentials[0].password_hash);
  assert.equal(after.credentials[0].email, nextEmail);
  assert.deepEqual(after.state.workspaces, before.state.workspaces);
});

test('configuring the password revokes an unused bootstrap link without replacing existing owner data', async t => {
  const env = await fixture({adminName: 'Naam uit bestaande opslag'});
  t.after(() => env.close());
  const before = databaseSnapshot(env.dataDir);
  const pending = env.client();
  accepted(await pending.request('/api/invitations/preview', {method: 'POST', body: {token: env.bootstrapToken}}));
  await env.restart({adminPassword: PASSWORD, adminName: 'Nieuwe configuratienaam'});
  assert.equal((await pending.request('/api/invitations/preview', {method: 'POST', body: {token: env.bootstrapToken}})).status, 410);
  assert.equal((await pending.activate(env.bootstrapToken)).status, 410);
  const owner = env.client();
  const session = accepted(await owner.login());
  assert.equal(session.user.id, 'u-admin');
  assert.equal(session.user.name, 'Naam uit bestaande opslag');
  const after = databaseSnapshot(env.dataDir);
  assert.equal(after.invitations.find(row => row.id === 'bootstrap-owner').status, 'revoked');
  assert.deepEqual(after.state.leads, before.state.leads);
  assert.deepEqual(after.state.companies, before.state.companies);
  assert.deepEqual(after.state.workspaces, before.state.workspaces);
});

test('weak configured passwords and email collisions fail without partially changing stored accounts', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Deze historie mag niet gedeeltelijk wijzigen'}));
  const second = env.client();
  const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Ander account', email: 'collision@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  accepted(await second.activate(invite.token, 'Ander account'));
  const pendingInvite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Open uitnodiging', email: 'pending-collision@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  let before = databaseSnapshot(env.dataDir);
  await assert.rejects(env.restart({adminPassword: 'short'}), /ADMIN_PASSWORD/);
  assert.deepEqual(databaseSnapshot(env.dataDir), before);
  await env.restart({adminPassword: PASSWORD});
  assert.equal(accepted(await owner.request('/api/session')).authenticated, true);
  before = databaseSnapshot(env.dataDir);
  await assert.rejects(env.restart({adminEmail: 'collision@example.test'}), /ADMIN_EMAIL/);
  assert.deepEqual(databaseSnapshot(env.dataDir), before);
  await env.restart({adminEmail: ADMIN_EMAIL});
  before = databaseSnapshot(env.dataDir);
  await assert.rejects(env.restart({adminEmail: 'pending-collision@example.test'}), /ADMIN_EMAIL/);
  assert.deepEqual(databaseSnapshot(env.dataDir), before);
  await env.restart({adminEmail: ADMIN_EMAIL});
  assert.equal(accepted(await owner.request('/api/session')).authenticated, true);
  accepted(await env.client().request('/api/invitations/preview', {method: 'POST', body: {token: pendingInvite.token}}));
});

test('a managed administrator cannot be downgraded even when another head administrator exists', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client(), secondHead = env.client();
  accepted(await owner.login());
  const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Tweede hoofdbeheerder', email: 'managed-second-head@example.test', companyId: 'c-noord', role: 'hoofdbeheerder'})).result;
  accepted(await secondHead.activate(invite.token, 'Tweede hoofdbeheerder'));
  denied(await owner.action('user.update', 'c-noord', {userId: 'u-admin', companyId: 'c-noord', role: 'verkoper'}));
  denied(await secondHead.action('user.update', 'c-noord', {userId: 'u-admin', companyId: 'c-noord', role: 'bedrijfsbeheerder'}));
  assert.equal(accepted(await owner.request('/api/session')).user.role, 'hoofdbeheerder');
  assert.equal(accepted(await owner.state()).state.users.find(user => user.id === 'u-admin').role, 'hoofdbeheerder');
});

test('demo cleanup removes only demo leads and their follow-up, preserving real work and account access', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client(), seller = env.client();
  accepted(await owner.login());
  const initial = accepted(await owner.state()).state;
  assert.equal(initial.leads.length, 18);
  assert.ok(initial.leads.every(lead => lead.demo === true));
  const demoIds = new Set(initial.leads.map(lead => lead.id));
  const invite = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Echte verkoper', email: 'cleanup-seller@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  accepted(await seller.activate(invite.token, 'Echte verkoper'));
  accepted(await owner.action('invitation.create', 'c-noord', {name: 'Uitnodiging bewaren', email: 'cleanup-pending@example.test', companyId: 'c-noord', role: 'verkoper'}));
  accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 72}));
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Alleen gekoppeld aan een demolead'}));
  accepted(await owner.action('call.record', 'c-noord', {leadId: 'l-01'}));
  accepted(await owner.action('callback.add', 'c-noord', {leadId: 'l-01', dueAt: new Date(Date.now() + 86400000).toISOString(), assigneeId: owner.user.id}));
  accepted(await owner.action('note.add', 'c-delta', {leadId: 'l-02', text: 'Demo-opvolging bij een ander bedrijf'}));
  const created = accepted(await owner.action('lead.create', 'c-noord', {
    title: 'Renovatie Hotel Duinzicht', organization: 'Echt door gebruiker toegevoegd', city: 'Utrecht', source: 'hotels', contact: 'Eigen contactpersoon', phone: '+31 20 000 9876', email: 'real-project@example.test', description: 'Handmatig project dat ook bij een bestaande demonaam behouden moet blijven.'
  }));
  const realId = created.result.lead?.id || created.result.leadId;
  assert.ok(realId);
  assert.equal(created.state.leads.find(lead => lead.id === realId).demo, false);
  accepted(await seller.action('note.add', 'c-noord', {leadId: realId, text: 'Echte gespreksnotitie die bewaard moet blijven'}));
  accepted(await seller.action('call.record', 'c-noord', {leadId: realId}));
  accepted(await seller.action('callback.add', 'c-noord', {leadId: realId, dueAt: new Date(Date.now() + 7200000).toISOString(), assigneeId: seller.user.id}));
  accepted(await seller.action('workspace.update', 'c-noord', {leadId: realId, field: 'commitment', value: true}));
  const before = databaseSnapshot(env.dataDir);
  assert.equal((await seller.action('demo.remove', 'c-noord')).status, 403);
  assert.deepEqual(databaseSnapshot(env.dataDir), before, 'A rejected cleanup must not change live data');
  const removed = accepted(await owner.action('demo.remove', 'c-noord'));
  assert.equal(removed.result.removedCount, 18);
  assert.equal(removed.result.remainingCount, 1);
  assert.deepEqual(removed.state.leads, before.state.leads.filter(lead => lead.id === realId));
  assert.deepEqual(removed.state.workspaces['c-noord'][realId], before.state.workspaces['c-noord'][realId]);
  for (const workspace of Object.values(removed.state.workspaces)) {
    assert.ok(Object.keys(workspace).every(leadId => !demoIds.has(leadId)));
  }
  assert.ok(removed.state.callLog.every(call => !demoIds.has(call.leadId)));
  assert.ok(removed.state.feed.every(item => !demoIds.has(item.leadId)));
  assert.deepEqual(removed.state.callLog.filter(call => call.leadId === realId), before.state.callLog.filter(call => call.leadId === realId));
  assert.deepEqual(removed.state.users, before.state.users);
  assert.deepEqual(removed.state.companies, before.state.companies);
  assert.deepEqual(removed.state.settings, before.state.settings);
  assertNoSecrets(removed.state);
  assert.equal(JSON.stringify(removed.state).includes('Alleen gekoppeld aan een demolead'), false);
  assert.ok(!Object.keys(removed.state).some(key => /archive/i.test(key)), 'Private archives must not be included in application state');
  const after = databaseSnapshot(env.dataDir);
  assert.deepEqual(after.credentials, before.credentials);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.invitations, before.invitations);
  assert.equal(accepted(await seller.request('/api/session')).authenticated, true);
  const sellerState = accepted(await seller.state()).state;
  assert.equal(sellerState.leads.length, 1);
  assert.ok(!Object.keys(sellerState).some(key => /archive/i.test(key)));
  for (const route of ['/api/demo/archive', '/api/archives', '/data/dashboard.sqlite', '/demo-archive.json']) {
    const blocked = await seller.request(route);
    assert.ok(blocked.status >= 400 && blocked.status < 500, 'Archived demo records must not be publicly retrievable');
  }
  const archiveDb = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  const archives = archiveDb.prepare('SELECT json FROM demo_lead_archives').all();
  archiveDb.close();
  assert.equal(archives.length, 1);
  const archived = JSON.parse(archives[0].json);
  assert.equal(archived.leads.length, 18);
  assert.ok(archived.leads.every(lead => lead.demo === true));
  assert.ok(JSON.stringify(archived).includes('Alleen gekoppeld aan een demolead'));
  assert.equal(JSON.stringify(archived).includes('Echte gespreksnotitie die bewaard moet blijven'), false);
  assertNoSecrets(archived);
  const repeated = accepted(await owner.action('demo.remove', 'c-noord'));
  assert.equal(repeated.result.removedCount, 0);
  assert.equal(repeated.result.remainingCount, 1);
  const afterRepeatDb = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  assert.equal(afterRepeatDb.prepare('SELECT count(*) AS count FROM demo_lead_archives').get().count, 1);
  afterRepeatDb.close();
  await env.restart();
  const reloaded = accepted(await owner.state()).state;
  assert.equal(reloaded.leads.length, 1, 'A restart must not recreate demo leads, even with the test seed option still true');
  assert.equal(reloaded.leads[0].id, realId);
  assert.deepEqual(reloaded.workspaces['c-noord'][realId], before.state.workspaces['c-noord'][realId]);
});

test('a fresh normal application starts with no demo leads and keeps accounts available', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD, seedDemoData: false});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  const state = accepted(await owner.state()).state;
  assert.deepEqual(state.leads, []);
  assert.deepEqual(state.callLog, []);
  assert.ok(state.feed.every(item => !item.leadId));
  assert.equal(state.users.find(user => user.id === 'u-admin').status, 'actief');
  assert.equal(state.companies.length, 1);
  assert.equal(state.companies[0].id, 'c-noord');
  const result = accepted(await owner.action('demo.remove', 'c-noord'));
  assert.deepEqual(result.result, {removedCount: 0, remainingCount: 0});
  await env.restart();
  assert.equal(accepted(await owner.state()).state.leads.length, 0);
});

test('an explicit startup cleanup runs once without changing credentials, sessions or real work', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client(), seller = env.client();
  accepted(await owner.activate(env.bootstrapToken, 'Werkende eigenaar'));
  const invitation = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Bestaande verkoper', email: 'startup-seller@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  accepted(await seller.activate(invitation.token, 'Bestaande verkoper', OTHER_PASSWORD));
  accepted(await owner.action('invitation.create', 'c-noord', {name: 'Open uitnodiging bewaren', email: 'startup-pending@example.test', companyId: 'c-noord', role: 'verkoper'}));
  accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 96}));
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Demogeschiedenis voor het privéarchief'}));
  accepted(await owner.action('call.record', 'c-noord', {leadId: 'l-01'}));
  const created = accepted(await owner.action('lead.create', 'c-noord', {title: 'Echt project naast de demovoorraad', organization: 'Bestaande klant', city: 'Leiden', source: 'vve', contact: 'Eigen contact', phone: '+31 20 000 7733', email: 'startup-real@example.test', description: 'Dit handmatig toegevoegde project en alle opvolging blijven behouden.'}));
  const realId = created.result.lead?.id || created.result.leadId;
  accepted(await seller.action('note.add', 'c-noord', {leadId: realId, text: 'Blijvende echte gespreksnotitie'}));
  accepted(await seller.action('call.record', 'c-noord', {leadId: realId}));
  accepted(await seller.action('callback.add', 'c-noord', {leadId: realId, dueAt: new Date(Date.now() + 3600000).toISOString(), assigneeId: seller.user.id}));
  const before = databaseSnapshot(env.dataDir);
  await env.restart({demoCleanupId: ''});
  assert.equal(env.maintenanceResult, null);
  assert.deepEqual(databaseSnapshot(env.dataDir), before, 'Starting without a cleanup ID must not clean existing data');
  const cleanupId = 'remove-demo-leads-test-2026-11-23';
  await env.restart({demoCleanupId: cleanupId});
  assert.deepEqual(env.maintenanceResult, {removedCount: 18, remainingCount: 1});
  const after = databaseSnapshot(env.dataDir);
  assert.equal(after.state.leads.length, 1);
  assert.equal(after.state.leads[0].id, realId);
  assert.deepEqual(after.state.workspaces['c-noord'][realId], before.state.workspaces['c-noord'][realId]);
  assert.deepEqual(after.state.users, before.state.users);
  assert.deepEqual(after.state.companies, before.state.companies);
  assert.deepEqual(after.state.settings, before.state.settings);
  assert.deepEqual(after.credentials, before.credentials);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.invitations, before.invitations);
  assert.equal(after.archives.length, 1);
  assert.equal(after.migrations.length, 1);
  assert.equal(after.migrations[0].id, cleanupId);
  assert.deepEqual(JSON.parse(after.migrations[0].result_json), {removedCount: 18, remainingCount: 1});
  assert.equal(accepted(await owner.request('/api/session')).user.name, 'Werkende eigenaar');
  assert.equal(accepted(await seller.request('/api/session')).authenticated, true);
  const ownState = accepted(await owner.state()).state;
  assert.ok(!Object.keys(ownState).some(key => /archive|migration/i.test(key)));
  assert.equal(JSON.stringify(ownState).includes('Demogeschiedenis voor het privéarchief'), false);
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  const withNewDemo = JSON.parse(setup.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  withNewDemo.leads.push({...before.state.leads.find(lead => lead.demo === true), id: 'demo-added-after-completed-migration'});
  setup.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(withNewDemo));
  setup.close();
  const inserted = databaseSnapshot(env.dataDir);
  await env.restart({demoCleanupId: cleanupId});
  assert.equal(env.maintenanceResult, null);
  assert.deepEqual(databaseSnapshot(env.dataDir), inserted, 'The same ID must never re-run, even if a new demo fixture record is added later');
  await env.restart({demoCleanupId: ''});
  assert.equal(env.maintenanceResult, null);
  assert.deepEqual(databaseSnapshot(env.dataDir), inserted);
  assert.equal(accepted(await seller.state()).state.leads.length, 2);
});

test('malformed startup cleanup IDs fail before writing any application data or migration', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.activate(env.bootstrapToken, 'Eigenaar met bestaand wachtwoord'));
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Dit mag niet wijzigen door een ongeldige onderhoudsinstelling'}));
  const before = databaseSnapshot(env.dataDir);
  for (const invalidId of [true, false, 1, {}, [], ' ', '../cleanup', 'cleanup with spaces', 'cleanup\nnext', 'x'.repeat(129)]) {
    await assert.rejects(env.restart({demoCleanupId: invalidId}), /DEMO_CLEANUP_ID/);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  await env.restart({demoCleanupId: ''});
  assert.equal(accepted(await owner.request('/api/session')).authenticated, true);
  assert.equal(accepted(await owner.state()).state.leads.length, 18);
});

test('startup cleanup archives, removes and records its marker atomically', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.activate(env.bootstrapToken, 'Eigenaar zonder wachtwoordreset'));
  accepted(await owner.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Verwijdering moet terugrollen als de marker niet kan worden vastgelegd'}));
  const before = databaseSnapshot(env.dataDir);
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  setup.exec("CREATE TRIGGER test_block_cleanup_marker BEFORE INSERT ON app_migrations BEGIN SELECT RAISE(ABORT,'Test blocked migration marker'); END;");
  setup.close();
  await assert.rejects(env.restart({demoCleanupId: 'atomic-cleanup-test'}), /Test blocked migration marker/);
  assert.deepEqual(databaseSnapshot(env.dataDir), before, 'A failed marker must roll back both the archive and live data deletion');
  const repair = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  repair.exec('DROP TRIGGER test_block_cleanup_marker;');
  repair.close();
  await env.restart({demoCleanupId: 'atomic-cleanup-test'});
  assert.deepEqual(env.maintenanceResult, {removedCount: 18, remainingCount: 0});
  const after = databaseSnapshot(env.dataDir);
  assert.equal(after.state.leads.length, 0);
  assert.equal(after.archives.length, 1);
  assert.equal(after.migrations.length, 1);
  assert.deepEqual(after.credentials, before.credentials);
  assert.deepEqual(after.sessions, before.sessions);
  assert.equal(accepted(await owner.request('/api/session')).authenticated, true);
});

test('company names and logos respect roles, preserve history and persist without exposing image data', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client(), seller = env.client(), deltaAdmin = env.client(), anonymous = env.client();
  accepted(await owner.login());
  const sellerInvitation = accepted(await owner.action('invitation.create', 'c-noord', {name: 'Logo Verkoper', email: 'logo-seller@example.test', companyId: 'c-noord', role: 'verkoper'})).result;
  accepted(await seller.activate(sellerInvitation.token, 'Logo Verkoper'));
  const adminInvitation = accepted(await owner.action('invitation.create', 'c-delta', {name: 'Logo Bedrijfsbeheerder', email: 'logo-admin@example.test', companyId: 'c-delta', role: 'bedrijfsbeheerder'})).result;
  accepted(await deltaAdmin.activate(adminInvitation.token, 'Logo Bedrijfsbeheerder'));
  accepted(await seller.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Historie mag niet veranderen bij een bedrijfslogo'}));
  accepted(await owner.action('workspace.update', 'c-noord', {leadId: 'l-01', field: 'status', value: 'opvolgen'}));
  const before = databaseSnapshot(env.dataDir);
  const originalCompany = before.state.companies.find(company => company.id === 'c-noord');
  const firstPng = pngFixture(), replacementPng = pngFixture(1, 1, true);
  let firstLogoUrl, latestLogoUrl;

  await t.test('the head administrator can change a name and upload a real PNG fixture', async () => {
    const response = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Mijn Bouwbedrijf', logoDataUrl: asPngDataUrl(firstPng)}));
    const company = response.state.companies.find(company => company.id === 'c-noord');
    assert.equal(company.name, 'Mijn Bouwbedrijf');
    assert.equal(company.id, originalCompany.id);
    assert.deepEqual(company.columns, originalCompany.columns);
    assert.match(company.logoUrl, /^\/api\/company-logos\/c-noord\?v=.+/);
    assert.equal(typeof company.logoVersion, 'string');
    firstLogoUrl = company.logoUrl;
    assert.equal(response.result.company.logoUrl, firstLogoUrl);
    assert.equal(JSON.stringify(response.state).includes('data:image/'), false);
    assert.equal(JSON.stringify(response.state).includes(firstPng.toString('base64')), false);
    assert.deepEqual(response.state.workspaces, before.state.workspaces);
    assert.deepEqual(response.state.users, before.state.users);
    assert.deepEqual(response.state.leads, before.state.leads);
    const image = await owner.request(firstLogoUrl);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /^image\/png(?:;|$)/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.match(image.headers.get('cache-control'), /private|no-store/);
    assert.deepEqual(Buffer.from(image.bytes), firstPng);
  });

  await t.test('company administrators edit only their own company and sellers cannot edit branding', async () => {
    assert.equal((await seller.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Verkoper mag dit niet'})).status, 403);
    assert.equal((await deltaAdmin.action('company.update', 'c-delta', {companyId: 'c-noord', name: 'Ander bedrijf mag dit niet', logoDataUrl: asPngDataUrl(replacementPng)})).status, 403);
    const own = accepted(await deltaAdmin.action('company.update', 'c-delta', {companyId: 'c-delta', name: 'Delta Team', logoDataUrl: asPngDataUrl(replacementPng)}));
    assert.equal(own.state.companies[0].name, 'Delta Team');
    assert.equal(own.state.companies[0].id, 'c-delta');
    assert.ok(own.state.companies[0].logoUrl);
    const foreignByChief = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-delta', name: 'Delta Hoofdkantoor'}));
    assert.equal(foreignByChief.state.companies.find(company => company.id === 'c-delta').name, 'Delta Hoofdkantoor');
  });

  await t.test('a case-only rename is allowed for the same company and omitted logos stay unchanged', async () => {
    const response = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'MIJN BOUWBEDRIJF'}));
    assert.equal(response.result.company.name, 'MIJN BOUWBEDRIJF');
    assert.equal(response.result.company.logoUrl, firstLogoUrl);
    const collisionBefore = databaseSnapshot(env.dataDir);
    const collision = await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'DELTA HOOFDKANTOOR', logoDataUrl: asPngDataUrl(replacementPng)});
    assert.equal(collision.status, 409);
    assert.deepEqual(databaseSnapshot(env.dataDir), collisionBefore, 'An invalid rename must not partially replace the logo or change history');
    denied(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: ' '}));
    assert.equal((await owner.action('company.update', 'c-noord', {companyId: 'unknown-company', name: 'Onbekend'})).status, 404);
  });

  await t.test('logo requests require a session and the correct company', async () => {
    assert.equal((await anonymous.request(firstLogoUrl)).status, 401);
    assert.equal((await deltaAdmin.request(firstLogoUrl)).status, 403);
    const deltaLogo = accepted(await owner.state()).state.companies.find(company => company.id === 'c-delta').logoUrl;
    assert.equal((await seller.request(deltaLogo)).status, 403);
    assert.equal((await seller.request(firstLogoUrl)).status, 200);
    assert.equal((await owner.request('/api/company-logos/unknown-company')).status, 404);
    assert.equal((await owner.request('/api/company-logos/c-horizon')).status, 404);
  });

  await t.test('replacing a logo rotates its URL and does not expose old or foreign bytes', async () => {
    const response = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Mijn Bouwbedrijf', logoDataUrl: asPngDataUrl(replacementPng)}));
    latestLogoUrl = response.result.company.logoUrl;
    assert.notEqual(latestLogoUrl, firstLogoUrl);
    assert.deepEqual(Buffer.from((await seller.request(latestLogoUrl)).bytes), replacementPng);
    const stale = await owner.request(firstLogoUrl);
    assert.ok(stale.status === 404 || stale.status === 200);
    if (stale.status === 200) assert.deepEqual(Buffer.from(stale.bytes), replacementPng, 'An old version URL may only resolve to the replacement, never retained old bytes');
    assert.equal((await deltaAdmin.request(latestLogoUrl)).status, 403);
    assert.equal(databaseSnapshot(env.dataDir).companyLogos.filter(row => row.company_id === 'c-noord').length, 1);
    const state = accepted(await owner.state()).state;
    assert.deepEqual(state.workspaces, before.state.workspaces);
    assert.deepEqual(state.users, before.state.users);
    assert.deepEqual(state.companies.find(company => company.id === 'c-noord').columns, originalCompany.columns);
  });

  await t.test('the name and logo survive restart and null removes only that company logo', async () => {
    const storedBefore = databaseSnapshot(env.dataDir);
    await env.restart();
    const state = accepted(await owner.state()).state;
    const company = state.companies.find(company => company.id === 'c-noord');
    assert.equal(company.name, 'Mijn Bouwbedrijf');
    assert.equal(company.logoUrl, latestLogoUrl);
    assert.deepEqual(Buffer.from((await seller.request(latestLogoUrl)).bytes), replacementPng);
    assert.deepEqual(databaseSnapshot(env.dataDir).companyLogos, storedBefore.companyLogos);
    const removed = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Mijn Bouwbedrijf', logoDataUrl: null}));
    assert.equal(removed.result.company.logoUrl, null);
    assert.equal(removed.result.company.logoVersion, null);
    assert.equal((await owner.request(latestLogoUrl)).status, 404);
    const logos = databaseSnapshot(env.dataDir).companyLogos;
    assert.equal(logos.filter(row => row.company_id === 'c-noord').length, 0);
    assert.equal(logos.filter(row => row.company_id === 'c-delta').length, 1);
    assert.deepEqual(removed.state.workspaces, before.state.workspaces);
    assert.deepEqual(removed.state.users, before.state.users);
  });
});

test('company logo validation and upload body limits reject unsafe content atomically', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  const png = pngFixture(), pngUrl = asPngDataUrl(png);
  accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Bewaard bedrijf', logoDataUrl: pngUrl}));
  const base64 = png.toString('base64'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  assert.ok(padding > 0, 'The PNG fixture must exercise canonical base64 padding');
  const index = base64.length - padding - 1, alteredBase64 = base64.slice(0, index) + alphabet[alphabet.indexOf(base64[index]) + 1] + base64.slice(index + 1);
  assert.deepEqual(Buffer.from(alteredBase64, 'base64'), png, 'Noncanonical base64 fixture must decode to the original bytes');
  const invalid = [
    ['remote URL', 'https://untrusted.example/logo.png'],
    ['SVG', 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')],
    ['MIME/signature mismatch', 'data:image/jpeg;base64,' + base64],
    ['invalid PNG signature', 'data:image/png;base64,' + Buffer.from('This is not an image').toString('base64')],
    ['truncated PNG', asPngDataUrl(png.subarray(0, 33))],
    ['oversized dimensions', asPngDataUrl(pngFixture(2049, 1))],
    ['noncanonical padding bits', 'data:image/png;base64,' + alteredBase64],
    ['missing padding', 'data:image/png;base64,' + base64.replace(/=+$/, '')],
    ['embedded whitespace', 'data:image/png;base64,' + base64.slice(0, 16) + '\n' + base64.slice(16)],
    ['boolean value', false],
    ['object value', {url: pngUrl}]
  ];
  for (const [label, logoDataUrl] of invalid) {
    const before = databaseSnapshot(env.dataDir);
    const response = await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Dit mag niet gedeeltelijk worden opgeslagen', logoDataUrl});
    assert.equal(response.status, 400, label);
    assert.deepEqual(databaseSnapshot(env.dataDir), before, `${label} must not change the old name, image or history`);
  }
  const oversizedPng = pngFixture(256, 256, false, true);
  assert.ok(oversizedPng.length > 256 * 1024);
  const sizeBefore = databaseSnapshot(env.dataDir);
  assert.equal((await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Te groot', logoDataUrl: asPngDataUrl(oversizedPng)})).status, 413);
  assert.deepEqual(databaseSnapshot(env.dataDir), sizeBefore);
  const largerThan64KiB = pngFixture(128, 128, false, true);
  assert.ok(largerThan64KiB.length > 64 * 1024 && largerThan64KiB.length < 256 * 1024);
  const acceptedLarge = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Groter geldig logo', logoDataUrl: asPngDataUrl(largerThan64KiB)}));
  assert.deepEqual(Buffer.from((await owner.request(acceptedLarge.result.company.logoUrl)).bytes), largerThan64KiB);
  const beforeBodyLimit = databaseSnapshot(env.dataDir);
  assert.equal((await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Te groot verzoek', logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(400 * 1024)})).status, 413);
  assert.deepEqual(databaseSnapshot(env.dataDir), beforeBodyLimit);
  const oversizedLogin = await env.client().request('/api/auth/login', {method: 'POST', body: {email: ADMIN_EMAIL, password: PASSWORD, extra: 'x'.repeat(70 * 1024)}});
  assert.equal(oversizedLogin.status, 413, 'Auth endpoints must retain their smaller 64 KiB request limit');
});

test('real small JPEG and WebP images can be uploaded and retrieved without conversion', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  // Complete 2x2 RGB images generated and independently decoded with Pillow.
  // Fixtures are embedded so this test has no image-library dependency.
  const images = [
    ['image/jpeg', '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDhKKKK/ez4E//Z'],
    ['image/webp', 'UklGRj4AAABXRUJQVlA4IDIAAADwAQCdASoCAAIAAQAcJaACdLoB+AAETAAA/vD6K/+JC/EhfiQv/Cmv/PzO7cX85gAAAA==']
  ];
  let previousUrl;
  for (const [mime, base64] of images) {
    const uploaded = accepted(await owner.action('company.update', 'c-noord', {companyId: 'c-noord', name: 'Logoformaat getest', logoDataUrl: `data:${mime};base64,${base64}`}));
    const url = uploaded.result.company.logoUrl;
    assert.notEqual(url, previousUrl);
    const downloaded = await owner.request(url);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('content-type'), mime);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(downloaded.bytes), Buffer.from(base64, 'base64'));
    assert.equal(JSON.stringify(uploaded.state).includes(base64), false);
    previousUrl = url;
  }
});

test('login remembers a session only for an explicit boolean true and validates other types before creating sessions', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  for (const rememberMe of [undefined, false, true]) {
    const browser = env.client();
    const response = await browser.login(ADMIN_EMAIL, PASSWORD, rememberMe);
    accepted(response);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    if (rememberMe === true) assert.match(cookie, /(?:^|;)\s*Max-Age=2592000(?:;|$)/i);
    else assert.doesNotMatch(cookie, /(?:Max-Age|Expires)=/i, 'A normal login must use a browser-session cookie');
    const stored = databaseSnapshot(env.dataDir).sessions.find(row => row.csrf === browser.csrfToken);
    assert.ok(stored);
    assert.equal(stored.expires_at - stored.created_at, rememberMe === true ? 30 * 86400000 : 12 * 3600000);
    accepted(await browser.action('settings.update', 'c-noord', {cooldownHours: 48}));
    assert.equal((await browser.action('settings.update', 'c-noord', {cooldownHours: 0}, {csrf: false})).status, 403);
  }
  for (const rememberMe of [null, 'true', 1, 0, [], {}]) {
    const before = databaseSnapshot(env.dataDir);
    const response = await env.client().login(ADMIN_EMAIL, PASSWORD, rememberMe);
    assert.equal(response.status, 400, 'A present nonboolean rememberMe must not be coerced');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
});

test('activation always creates an ordinary twelve-hour session', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const browser = env.client();
  const response = await browser.request('/api/auth/activate', {method: 'POST', body: {token: env.bootstrapToken, name: 'Geactiveerde gebruiker', password: PASSWORD, rememberMe: true}});
  accepted(response);
  assert.doesNotMatch(response.headers.get('set-cookie'), /(?:Max-Age|Expires)=/i);
  const stored = databaseSnapshot(env.dataDir).sessions.find(row => row.csrf === browser.csrfToken);
  assert.equal(stored.expires_at - stored.created_at, 12 * 3600000);
});

test('a remembered session survives a restart and logout revokes it as well as clearing the cookie', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const browser = env.client();
  accepted(await browser.login(ADMIN_EMAIL, PASSWORD, true));
  const originalCookie = browser.cookie;
  const before = databaseSnapshot(env.dataDir).sessions.find(row => row.csrf === browser.csrfToken);
  await env.restart();
  assert.equal(accepted(await browser.request('/api/session')).authenticated, true);
  assert.deepEqual(databaseSnapshot(env.dataDir).sessions.find(row => row.csrf === browser.csrfToken), before);
  assert.equal((await browser.request('/api/auth/logout', {method: 'POST', body: {}, csrf: false})).status, 403);
  assert.equal(accepted(await browser.request('/api/session')).authenticated, true);
  const logout = await browser.request('/api/auth/logout', {method: 'POST', body: {}});
  accepted(logout);
  assert.match(logout.headers.get('set-cookie'), /(?:^|;)\s*Max-Age=0(?:;|$)/i);
  assert.equal(databaseSnapshot(env.dataDir).sessions.some(row => row.csrf === browser.csrfToken), false);
  const replay = env.client();
  replay.cookie = originalCookie;
  assert.equal(accepted(await replay.request('/api/session')).authenticated, false);
  assert.equal((await replay.state()).status, 401);
});

test('an expired remembered session is rejected despite retaining its cookie, including after restart', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const browser = env.client();
  accepted(await browser.login(ADMIN_EMAIL, PASSWORD, true));
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  setup.prepare('UPDATE sessions SET expires_at=? WHERE csrf=?').run(Date.now() - 1000, browser.csrfToken);
  setup.close();
  assert.equal(accepted(await browser.request('/api/session')).authenticated, false);
  assert.equal((await browser.state()).status, 401);
  assert.equal((await browser.action('settings.update', 'c-noord', {cooldownHours: 0})).status, 401);
  await env.restart();
  assert.equal(accepted(await browser.request('/api/session')).authenticated, false);
  assert.equal((await browser.state()).status, 401);
});

test('ordinary and remembered production sessions retain Secure, HttpOnly and SameSite protections', async t => {
  const origin = 'https://remembered.example.test';
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD, publicOrigin: origin, secureCookies: true});
  t.after(() => env.close());
  for (const rememberMe of [false, true]) {
    const browser = env.client();
    const response = await browser.request('/api/auth/login', {method: 'POST', body: {email: ADMIN_EMAIL, password: PASSWORD, rememberMe}, origin});
    accepted(response);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /(?:^|;)\s*Secure(?:;|$)/i);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    if (rememberMe) assert.match(cookie, /Max-Age=2592000/i);
    else assert.doesNotMatch(cookie, /(?:Max-Age|Expires)=/i);
    const responseState = await browser.request('/api/state?companyId=c-noord', {origin});
    accepted(responseState);
    assertNoSecrets(responseState.data.state);
  }
});

test('global call-wait settings keep canonical hours and persist the selected hours or days unit', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  let response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 24}));
  assert.equal(response.state.settings.cooldownHours, 24);
  assert.equal(response.state.settings.cooldownUnit, 'hours', 'Legacy settings without a unit must default to hours');
  response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 48, cooldownUnit: 'days'}));
  assert.equal(response.state.settings.cooldownHours, 48, 'Two days must stay 48 canonical hours');
  assert.equal(response.state.settings.cooldownUnit, 'days');
  response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 72}));
  assert.equal(response.state.settings.cooldownHours, 72);
  assert.equal(response.state.settings.cooldownUnit, 'days', 'Omitting the unit must preserve the current valid unit');
  await env.restart();
  let settings = accepted(await owner.state()).state.settings;
  assert.equal(settings.cooldownHours, 72);
  assert.equal(settings.cooldownUnit, 'days');
  response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 48, cooldownUnit: 'hours'}));
  assert.equal(response.state.settings.cooldownHours, 48);
  assert.equal(response.state.settings.cooldownUnit, 'hours');
  response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 8760, cooldownUnit: 'days'}));
  assert.equal(response.state.settings.cooldownHours, 365 * 24, '365 days must remain within the 8760-hour ceiling');
  assert.equal(response.state.settings.cooldownUnit, 'days');
  await env.restart();
  settings = accepted(await owner.state()).state.settings;
  assert.equal(settings.cooldownHours, 8760);
  assert.equal(settings.cooldownUnit, 'days');
  response = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 0, cooldownUnit: 'days'}));
  assert.equal(response.state.settings.cooldownHours, 0);
  assert.equal(response.state.settings.cooldownUnit, 'days');
});

test('invalid call-wait units or noncanonical hour values are rejected without writes', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 48, cooldownUnit: 'days'}));
  for (const cooldownUnit of [null, true, 1, 'weeks', 'Days', '', {}, []]) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('settings.update', 'c-noord', {cooldownHours: 24, cooldownUnit})).status, 400);
    assert.deepEqual(databaseSnapshot(env.dataDir), before, 'Invalid units must not change the value, unit or newsfeed');
  }
  for (const cooldownHours of [-24, 8761, 2.5, '48', null]) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('settings.update', 'c-noord', {cooldownHours, cooldownUnit: 'days'})).status, 400);
    assert.deepEqual(databaseSnapshot(env.dataDir), before, 'Changing display units must not weaken canonical hour validation');
  }
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  const legacy = JSON.parse(setup.prepare('SELECT json FROM app_state WHERE id=1').get().json);
  legacy.settings.cooldownUnit = 'legacy-weeks';
  setup.prepare('UPDATE app_state SET json=? WHERE id=1').run(JSON.stringify(legacy));
  setup.close();
  const updated = accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 96}));
  assert.equal(updated.state.settings.cooldownHours, 96);
  assert.equal(updated.state.settings.cooldownUnit, 'hours', 'An invalid legacy unit must fall back to hours when the new payload omits it');
});

test('company administrators and sellers cannot change the global call-wait unit', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  accepted(await owner.action('settings.update', 'c-noord', {cooldownHours: 48, cooldownUnit: 'days'}));
  for (const [role, email, companyId] of [['verkoper', 'unit-seller@example.test', 'c-noord'], ['bedrijfsbeheerder', 'unit-admin@example.test', 'c-delta']]) {
    const invitation = accepted(await owner.action('invitation.create', 'c-noord', {name: role, email, companyId, role})).result;
    const browser = env.client();
    accepted(await browser.activate(invitation.token, role));
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await browser.action('settings.update', companyId, {cooldownHours: 24, cooldownUnit: 'hours'})).status, 403);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  const settings = accepted(await owner.state()).state.settings;
  assert.equal(settings.cooldownHours, 48);
  assert.equal(settings.cooldownUnit, 'days');
});

test('deleting invitations in every status removes only the invitation, preserving accounts and history after restart', async t => {
  const env = await fixture();
  t.after(() => env.close());
  const owner = env.client(), activatedUser = env.client(), anonymous = env.client();
  accepted(await owner.activate(env.bootstrapToken, 'Eigenaar met blijvend account'));
  const create = async (name, email) => accepted(await owner.action('invitation.create', 'c-noord', {name, email, companyId: 'c-noord', role: 'verkoper'})).result;
  const pending = await create('Open uitnodiging', 'delete-pending@example.test');
  const revoked = await create('Ingetrokken uitnodiging', 'delete-revoked@example.test');
  accepted(await owner.action('invitation.revoke', 'c-noord', {invitationId: revoked.invitation.id}));
  const expired = await create('Verlopen uitnodiging', 'delete-expired@example.test');
  const setup = new DatabaseSync(path.join(env.dataDir, 'dashboard.sqlite'));
  setup.prepare('UPDATE invitations SET expires_at=? WHERE id=?').run(Date.now() - 1000, expired.invitation.id);
  setup.close();
  const acceptedInvitation = await create('Gebruiker blijft actief', 'delete-accepted@example.test');
  accepted(await activatedUser.activate(acceptedInvitation.token, 'Gebruiker blijft actief', OTHER_PASSWORD));
  accepted(await activatedUser.action('note.add', 'c-noord', {leadId: 'l-01', text: 'Deze notitie blijft bestaan na het verwijderen van de uitnodiging'}));
  accepted(await activatedUser.action('call.record', 'c-noord', {leadId: 'l-01'}));
  accepted(await activatedUser.action('callback.add', 'c-noord', {leadId: 'l-01', dueAt: new Date(Date.now() + 7200000).toISOString(), assigneeId: activatedUser.user.id}));
  const initial = databaseSnapshot(env.dataDir);
  const deletions = [
    ['pending', pending.invitation.id, pending.token],
    ['revoked', revoked.invitation.id, revoked.token],
    ['expired', expired.invitation.id, expired.token],
    ['accepted', acceptedInvitation.invitation.id, acceptedInvitation.token],
    ['accepted bootstrap owner', 'bootstrap-owner', env.bootstrapToken]
  ];
  for (const [status, invitationId, token] of deletions) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('invitation.delete', 'c-noord', {invitationId}, {csrf: false})).status, 403, `${status} deletion requires CSRF`);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
    const result = accepted(await owner.action('invitation.delete', 'c-noord', {invitationId}), status);
    assert.equal(result.state.invitations.some(invitation => invitation.id === invitationId), false);
    const after = databaseSnapshot(env.dataDir);
    assert.deepEqual(after.invitations, before.invitations.filter(invitation => invitation.id !== invitationId));
    assert.deepEqual(after.state.users, before.state.users);
    assert.deepEqual(after.state.companies, before.state.companies);
    assert.deepEqual(after.state.settings, before.state.settings);
    assert.deepEqual(after.state.leads, before.state.leads);
    assert.deepEqual(after.state.workspaces, before.state.workspaces);
    assert.deepEqual(after.state.callLog, before.state.callLog);
    assert.deepEqual(after.credentials, before.credentials);
    assert.deepEqual(after.sessions, before.sessions);
    assert.deepEqual(after.archives, before.archives);
    assert.deepEqual(after.migrations, before.migrations);
    assert.deepEqual(after.companyLogos, before.companyLogos);
    assert.equal((await anonymous.request('/api/invitations/preview', {method: 'POST', body: {token}})).status, 410);
    assert.equal((await anonymous.activate(token)).status, 410);
    assert.equal((await owner.action('invitation.rotate', 'c-noord', {invitationId})).status, 404);
    assert.equal((await owner.action('invitation.delete', 'c-noord', {invitationId})).status, 404);
  }
  assert.equal(accepted(await owner.request('/api/session')).authenticated, true);
  assert.equal(accepted(await activatedUser.request('/api/session')).authenticated, true);
  await env.restart();
  const afterRestart = databaseSnapshot(env.dataDir);
  assert.equal(afterRestart.invitations.length, 0, 'Deleting the accepted bootstrap row must not recreate an invitation on restart');
  assert.deepEqual(afterRestart.credentials, initial.credentials);
  assert.deepEqual(afterRestart.sessions, initial.sessions);
  assert.deepEqual(afterRestart.state.users, initial.state.users);
  assert.deepEqual(afterRestart.state.workspaces, initial.state.workspaces);
  assert.equal(accepted(await owner.request('/api/session')).user.id, 'u-admin');
  const freshUser = env.client();
  const login = accepted(await freshUser.login('delete-accepted@example.test', OTHER_PASSWORD));
  assert.equal(login.user.id, activatedUser.user.id);
  assert.equal(login.user.status, 'actief');
  assert.ok(accepted(await freshUser.state()).state.workspaces['c-noord']['l-01'].notes.some(note => note.text === 'Deze notitie blijft bestaan na het verwijderen van de uitnodiging'));
});

test('only authorized administrators can delete invitations within their permitted company and role', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client(), northAdmin = env.client(), deltaAdmin = env.client(), seller = env.client();
  accepted(await owner.login());
  const invite = async (name, email, companyId, role = 'verkoper') => accepted(await owner.action('invitation.create', 'c-noord', {name, email, companyId, role})).result;
  const northAdminInvite = await invite('Noord beheerder', 'delete-north-admin@example.test', 'c-noord', 'bedrijfsbeheerder');
  const deltaAdminInvite = await invite('Delta beheerder', 'delete-delta-admin@example.test', 'c-delta', 'bedrijfsbeheerder');
  const sellerInvite = await invite('Noord verkoper', 'delete-north-seller@example.test', 'c-noord');
  accepted(await northAdmin.activate(northAdminInvite.token, 'Noord beheerder'));
  accepted(await deltaAdmin.activate(deltaAdminInvite.token, 'Delta beheerder'));
  accepted(await seller.activate(sellerInvite.token, 'Noord verkoper'));
  const headInvite = await invite('Nieuwe hoofdbeheerder', 'delete-head@example.test', 'c-noord', 'hoofdbeheerder');
  const deltaPending = await invite('Delta open uitnodiging', 'delete-delta-pending@example.test', 'c-delta');
  const beforeDenied = databaseSnapshot(env.dataDir);
  assert.equal((await seller.action('invitation.delete', 'c-noord', {invitationId: sellerInvite.invitation.id})).status, 403);
  assert.equal((await northAdmin.action('invitation.delete', 'c-noord', {invitationId: headInvite.invitation.id})).status, 403);
  assert.equal((await northAdmin.action('invitation.delete', 'c-noord', {invitationId: deltaPending.invitation.id})).status, 403);
  assert.equal((await deltaAdmin.action('invitation.delete', 'c-delta', {invitationId: sellerInvite.invitation.id})).status, 403);
  assert.deepEqual(databaseSnapshot(env.dataDir), beforeDenied);
  const own = accepted(await northAdmin.action('invitation.delete', 'c-noord', {invitationId: sellerInvite.invitation.id}));
  assert.equal(own.state.invitations.some(invitation => invitation.id === sellerInvite.invitation.id), false);
  assert.equal(accepted(await seller.request('/api/session')).authenticated, true);
  const foreignByChief = accepted(await owner.action('invitation.delete', 'c-noord', {invitationId: deltaPending.invitation.id}));
  assert.equal(foreignByChief.state.invitations.some(invitation => invitation.id === deltaPending.invitation.id), false);
  assert.equal((await owner.action('invitation.delete', 'c-noord', {invitationId: 'invite-record-that-does-not-exist'})).status, 404);
  const remaining = databaseSnapshot(env.dataDir);
  assert.deepEqual(remaining.credentials, beforeDenied.credentials);
  assert.deepEqual(remaining.sessions, beforeDenied.sessions);
  assert.deepEqual(remaining.state.users, beforeDenied.state.users);
  assert.deepEqual(remaining.state.workspaces, beforeDenied.state.workspaces);
});

test('global source management is chief-only, requires CSRF and persists configured sources', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client(), seller = env.client(), manager = env.client();
  accepted(await owner.login());
  for (const [browser, name, email, role, companyId] of [[seller, 'Bron verkoper', 'source-seller@example.test', 'verkoper', 'c-noord'], [manager, 'Bron beheerder', 'source-manager@example.test', 'bedrijfsbeheerder', 'c-delta']]) {
    const invitation = accepted(await owner.action('invitation.create', 'c-noord', {name, email, companyId, role})).result;
    accepted(await browser.activate(invitation.token, name));
  }
  const beforeCreate = databaseSnapshot(env.dataDir);
  assert.equal((await owner.action('source.create', 'c-noord', {name: 'Mag niet zonder CSRF'}, {csrf: false})).status, 403);
  assert.deepEqual(databaseSnapshot(env.dataDir), beforeCreate);
  const created = accepted(await owner.action('source.create', 'c-noord', {name: '  Nieuw Bouwcontact  ', url: 'https://source.example/catalogus', username: '  connector-gebruiker  '}));
  const source = created.result.source;
  assert.match(source.id, /^source-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(source.name, 'Nieuw Bouwcontact');
  assert.equal(source.kind, 'lead');
  assert.equal(source.enabled, false, 'Saving a source must not connect it');
  assert.equal(source.url, 'https://source.example/catalogus');
  assert.equal(source.username, 'connector-gebruiker');
  for (const [browser, companyId] of [[seller, 'c-noord'], [manager, 'c-delta']]) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await browser.action('source.create', companyId, {name: 'Onbevoegde bron'})).status, 403);
    assert.equal((await browser.action('source.update', companyId, {id: source.id, name: 'Onbevoegde wijziging', url: '', username: ''})).status, 403);
    assert.equal((await browser.action('source.delete', companyId, {id: source.id})).status, 403);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  for (const [type, payload] of [['source.update', {id: source.id, name: 'Zonder CSRF', url: '', username: ''}], ['source.delete', {id: source.id}]]) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action(type, 'c-noord', payload, {csrf: false})).status, 403);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  const caseOnly = accepted(await owner.action('source.update', 'c-noord', {id: source.id, name: 'NIEUW BOUWCONTACT', url: 'http://source.example/nieuw', username: 'voorbereide-gebruiker'})).result.source;
  assert.equal(caseOnly.id, source.id);
  assert.equal(caseOnly.name, 'NIEUW BOUWCONTACT');
  assert.equal(caseOnly.enabled, false);
  const withoutName = accepted(await owner.action('source.update', 'c-noord', {id: source.id, url: 'https://source.example/definitief', username: 'eigen-gebruiker'})).result.source;
  assert.equal(withoutName.name, 'NIEUW BOUWCONTACT', 'The optional name must keep the existing label when omitted');
  assert.equal(withoutName.id, source.id);
  await env.restart();
  const reloaded = accepted(await owner.state()).state.sources.find(candidate => candidate.id === source.id);
  assert.deepEqual(reloaded, withoutName);
  const empty = accepted(await owner.action('source.create', 'c-noord', {name: 'Zonder verbinding'})).result.source;
  assert.equal(empty.url, '');
  assert.equal(empty.username, '');
  assert.equal(empty.enabled, false);
});

test('source names, duplicate labels and unsafe URL configuration are rejected atomically', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  const source = accepted(await owner.action('source.create', 'c-noord', {name: 'Bewaarde bron', url: 'https://source.example/projecten', username: 'bewaarde-gebruiker'})).result.source;
  for (const name of ['bewaarde BRON', '  BOUWBERICHTEN.NL  ']) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('source.create', 'c-noord', {name})).status, 409);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  const duplicateBefore = databaseSnapshot(env.dataDir);
  assert.equal((await owner.action('source.update', 'c-noord', {id: source.id, name: 'HOTELS', url: 'https://source.example/veranderd', username: 'niet-opslaan'})).status, 409);
  assert.deepEqual(databaseSnapshot(env.dataDir), duplicateBefore);
  for (const name of ['', '   ', 'x'.repeat(121), null, true, {}]) {
    for (const type of ['source.create', 'source.update']) {
      const before = databaseSnapshot(env.dataDir);
      assert.equal((await owner.action(type, 'c-noord', {id: source.id, name, url: 'https://source.example/geldig', username: 'geldig'})).status, 400);
      assert.deepEqual(databaseSnapshot(env.dataDir), before);
    }
  }
  for (const url of ['not-a-url', 'javascript:alert(1)', 'ftp://source.example/projecten', 'https://username:password@source.example/projecten', 'https://source.example/projecten?token=secret', 'https://source.example/projecten#fragment', 'https://' + 'x'.repeat(501), null, true]) {
    for (const type of ['source.create', 'source.update']) {
      const before = databaseSnapshot(env.dataDir);
      assert.equal((await owner.action(type, 'c-noord', {id: source.id, name: 'Niet gedeeltelijk bewaren', url, username: 'geldig'})).status, 400);
      assert.deepEqual(databaseSnapshot(env.dataDir), before);
    }
  }
  for (const username of ['x'.repeat(161), null, true, {}]) {
    const before = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('source.update', 'c-noord', {id: source.id, name: 'Niet gedeeltelijk bewaren', url: 'https://source.example/geldig', username})).status, 400);
    assert.deepEqual(databaseSnapshot(env.dataDir), before);
  }
  assert.equal((await owner.action('source.update', 'c-noord', {id: 'source-not-present', name: 'Onbekend', url: '', username: ''})).status, 404);
  assert.equal((await owner.action('source.delete', 'c-noord', {id: 'source-not-present'})).status, 404);
  assert.equal(accepted(await owner.action('source.create', 'c-noord', {name: 'X'})).result.source.name, 'X');
  assert.equal(accepted(await owner.action('source.create', 'c-noord', {name: 'x'.repeat(120)})).result.source.name.length, 120);
});

test('deleting a source keeps its leads, notes and conversions, prevents new use and is not reversed by restart', async t => {
  const env = await fixture({bootstrapToken: '', adminPassword: PASSWORD});
  t.after(() => env.close());
  const owner = env.client();
  accepted(await owner.login());
  const source = accepted(await owner.action('source.create', 'c-noord', {name: 'Eigen projectbron', url: 'https://source.example/contacten', username: 'eigen-connector'})).result.source;
  const leadFields = {title: 'Project uit een eigen bron', organization: 'Eigen contactorganisatie', city: 'Haarlem', contact: 'Eigen contact', phone: '+31 20 000 5566', email: 'custom-source-contact@example.test', description: 'Dit project blijft bestaan na het verwijderen van de bron.'};
  const created = accepted(await owner.action('lead.create', 'c-noord', {...leadFields, source: source.id}));
  const leadId = created.result.lead?.id || created.result.leadId;
  assert.equal(created.result.lead.source, source.id);
  accepted(await owner.action('note.add', 'c-noord', {leadId, text: 'Echte bronhistorie die niet verloren mag gaan'}));
  accepted(await owner.action('note.add', 'c-delta', {leadId, text: 'Eigen opvolging van een ander bedrijf blijft ook bestaan'}));
  accepted(await owner.action('call.record', 'c-noord', {leadId}));
  accepted(await owner.action('workspace.update', 'c-noord', {leadId, field: 'commitment', value: true}));
  accepted(await owner.action('workspace.update', 'c-noord', {leadId, field: 'calculation', value: true}));
  const before = databaseSnapshot(env.dataDir);
  const reportsBefore = reportRows(accepted(await owner.state()).state, {source: source.id});
  assert.equal(reportsBefore.length, 1);
  assert.equal(reportsBefore[0].source, source.id);
  assert.equal(reportsBefore[0].total, 1);
  assert.equal(reportsBefore[0].contacted, 1);
  assert.equal(reportsBefore[0].commitments, 1);
  assert.equal(reportsBefore[0].calculations, 1);
  assert.equal(reportsBefore[0].conversion, 100);
  const deleted = accepted(await owner.action('source.delete', 'c-noord', {id: source.id}));
  const tombstone = deleted.result.source;
  assert.equal(tombstone.id, source.id);
  assert.equal(tombstone.name, source.name);
  assert.equal(tombstone.kind, 'lead');
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.enabled, false);
  assert.equal(tombstone.url, '');
  assert.equal(tombstone.username, '');
  assert.deepEqual(deleted.state.leads, before.state.leads);
  assert.deepEqual(deleted.state.workspaces, before.state.workspaces);
  assert.deepEqual(deleted.state.callLog, before.state.callLog);
  assert.deepEqual(deleted.state.users, before.state.users);
  assert.deepEqual(deleted.state.companies, before.state.companies);
  assert.deepEqual(deleted.state.settings, before.state.settings);
  for (const item of before.state.feed) assert.deepEqual(deleted.state.feed.find(candidate => candidate.id === item.id), item);
  assert.deepEqual(reportRows(deleted.state, {source: source.id}), reportsBefore);
  const after = databaseSnapshot(env.dataDir);
  assert.deepEqual(after.credentials, before.credentials);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.invitations, before.invitations);
  assert.equal((await owner.action('source.delete', 'c-noord', {id: source.id})).status, 404);
  assert.equal((await owner.action('source.update', 'c-noord', {id: source.id, name: 'Weer terug', url: '', username: ''})).status, 404);
  for (const unavailableSource of [source.id, 'outlook', 'source-unknown']) {
    const snapshot = databaseSnapshot(env.dataDir);
    assert.equal((await owner.action('lead.create', 'c-noord', {...leadFields, source: unavailableSource})).status, 400);
    assert.deepEqual(databaseSnapshot(env.dataDir), snapshot);
  }
  const outlook = accepted(await owner.action('source.delete', 'c-noord', {id: 'outlook'})).result.source;
  assert.equal(outlook.id, 'outlook');
  assert.equal(outlook.deleted, true);
  assert.equal((await owner.action('source.update', 'c-noord', {id: 'outlook', url: '', username: ''})).status, 404);
  const legacy = accepted(await owner.action('source.delete', 'c-noord', {id: 'bouw'}));
  assert.equal(legacy.state.sources.find(candidate => candidate.id === 'bouw').deleted, true);
  assert.deepEqual(legacy.state.leads, before.state.leads, 'Deleting a built-in source must not delete its existing demo or real leads');
  assert.equal((await owner.action('lead.create', 'c-noord', {...leadFields, source: 'bouw'})).status, 400);
  const replacement = accepted(await owner.action('source.create', 'c-noord', {name: '  EIGEN PROJECTBRON  '})).result.source;
  assert.notEqual(replacement.id, source.id);
  assert.equal(replacement.deleted === true, false);
  assert.equal((await owner.action('lead.create', 'c-noord', {...leadFields, source: replacement.id})).status, 200);
  const beforeRestart = accepted(await owner.state()).state;
  await env.restart();
  const reloaded = accepted(await owner.state()).state;
  assert.deepEqual(reloaded.sources, beforeRestart.sources);
  for (const id of [source.id, 'bouw', 'outlook']) assert.equal(reloaded.sources.find(candidate => candidate.id === id).deleted, true);
  assert.deepEqual(reloaded.workspaces['c-noord'][leadId], before.state.workspaces['c-noord'][leadId]);
  assert.deepEqual(reportRows(reloaded, {source: source.id}), reportsBefore);
});
