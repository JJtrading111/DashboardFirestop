import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const CANONICAL = 'https://www.msgroup-dashboard.nl';
const OLD_HOST = 'dashboard-production.up.railway.app';
const WORKER_TOKEN = 'canonical-domain-test-worker-token-'.repeat(2);

function fixture(t, publicOrigin = CANONICAL) {
  const app = createApp({dataDir: ':memory:', publicOrigin, secureCookies: true,
    adminEmail: 'domain-test@example.test', adminPassword: '', bootstrapToken: '',
    demoCleanupId: '', seedDemoData: false, scraperWorkerToken: WORKER_TOKEN,
    scraperEncryptionKey: Buffer.alloc(32, 13).toString('base64url')});
  t.after(() => app.close());
  return async function request(url, {method = 'GET', host = OLD_HOST, headers = {}, body} = {}) {
    const responseHeaders = new Map();
    let status = 200, content = Buffer.alloc(0);
    const req = {url, method, socket: {remoteAddress: '127.0.0.1', encrypted: false},
      headers: {host, ...headers},
      async *[Symbol.asyncIterator]() {if (body !== undefined) yield Buffer.from(JSON.stringify(body));}};
    const res = {headersSent: false,
      setHeader(name, value) {responseHeaders.set(name.toLowerCase(), String(value));},
      writeHead(code, values = {}) {status = code;for (const [name, value] of Object.entries(values)) this.setHeader(name, value);this.headersSent = true;},
      end(value) {if (value !== undefined) content = Buffer.from(value);}};
    await app.handler(req, res);
    return {status, headers: responseHeaders, content, json: () => JSON.parse(content.toString())};
  };
}

test('old domain redirects public pages and assets to the configured origin with path and query intact', async t => {
  const request = fixture(t, CANONICAL + '/');
  for (const method of ['GET', 'HEAD']) {
    for (const route of ['/', '/login/', '/index.html?next=%2F%23activate%3Dkeep', '/styles.css?v=2', '/app.mjs?next=https%3A%2F%2Fevil.example']) {
      const response = await request(route, {method, headers: {'x-forwarded-host': 'www.msgroup-dashboard.nl', 'x-forwarded-proto': 'https'}});
      assert.equal(response.status, 308, `${method} ${route}`);
      assert.equal(response.headers.get('location'), CANONICAL + route);
      assert.equal(response.content.length, 0);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.ok(!response.headers.get('location').includes('#'), 'No fragment replaces an existing invitation fragment');
    }
  }
});

test('canonical host does not loop behind the HTTP proxy and no APP_URL leaves local pages unchanged', async t => {
  const request = fixture(t);
  for (const method of ['GET', 'HEAD']) {
    const response = await request('/login?next=dashboard', {method, host: 'WWW.MSGROUP-DASHBOARD.NL',
      headers: {'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http'}});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), undefined);
    if (method === 'HEAD') assert.equal(response.content.length, 0);
    else assert.match(response.content.toString(), /Bouwberichten Dashboard/);
  }
  const localRequest = fixture(t, '');
  const local = await localRequest('/');
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('location'), undefined);
});

test('health, browser API and bearer worker endpoints remain reachable on the old domain without redirects', async t => {
  const request = fixture(t);
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json(), {ok: true});
  const session = await request('/api/session');
  assert.equal(session.status, 200);
  assert.deepEqual(session.json(), {authenticated: false});
  const claim = await request('/api/scraper/claim', {method: 'POST',
    headers: {authorization: 'Bearer ' + WORKER_TOKEN, 'content-type': 'application/json'}, body: {}});
  assert.equal(claim.status, 200);
  assert.equal(claim.json().job, null);
  const unauthorizedImport = await request('/api/import/sources/not-found/leads', {method: 'POST',
    headers: {'content-type': 'application/json'}, body: {items: []}});
  assert.equal(unauthorizedImport.status, 401);
  const badOrigin = await request('/api/auth/login', {method: 'POST',
    headers: {origin: 'https://' + OLD_HOST, 'content-type': 'application/json'}, body: {}});
  assert.equal(badOrigin.status, 403, 'Browser writes still require the configured origin');
  const pagePost = await request('/login', {method: 'POST'});
  assert.equal(pagePost.status, 405, 'Page POST must never redirect');
  for (const response of [health, session, claim, unauthorizedImport, badOrigin, pagePost]) assert.equal(response.headers.get('location'), undefined);
});
