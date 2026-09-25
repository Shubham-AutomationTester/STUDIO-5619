import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { configuration, counts, makeCatalog, selectProfile, infrastructurePaths, VALID_COUNT } from '../lib/catalog.mjs';

let app, base;
const token = 'test-secret-not-for-deployment';
before(async () => {
  app = await createApp(configuration({ ADMIN_TOKEN: token, DELAY_MS: '40', LARGE_BODY_BYTES: '2048' }));
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); });
const request = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
const reset = () => request('/admin/reset', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'unit-test' }) });
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");

test('exactly 15,000 valid + 292 additional unique fixture URLs', () => {
  const summary = counts(app.catalog);
  assert.equal(summary.valid, 15000); assert.equal(summary.additional, 292);
  assert.equal(summary.totalFixtureUrls, 15292); assert.equal(summary.requiredIssues, 200);
  assert.equal(summary.conditional, 92); assert.equal(summary.navigationUrls, 87);
  assert.equal(new Set(app.catalog.all.map(row => row.path)).size, 15292);
});
test('profile isolation and boundary counts', () => {
  assert.equal(selectProfile(app.catalog, 'baseline').length, VALID_COUNT);
  assert.equal(selectProfile(app.catalog, 'boundary').length, 25);
  assert.equal(selectProfile(app.catalog, 'issues').length, 200);
  assert.throws(() => selectProfile(app.catalog, 'bad'));
});
test('extended issue scale leaves the valid 15,000 untouched', () => {
  const catalog = makeCatalog(configuration({ ISSUES_PER_STATUS: '1500' }));
  assert.equal(catalog.valid.length, 15000);
  assert.equal(catalog.cases.filter(row => row.kind === 'http-error').length, 12000);
  assert.equal(catalog.all.length, 27092);
});
test('reject invalid environment values', () => {
  assert.throws(() => configuration({ ISSUES_PER_STATUS: '-1' }));
  assert.throws(() => configuration({ RETRY_FAILURES: '0' }));
  assert.throws(() => configuration({ BASE_URL: 'https://example.com/path' }));
  assert.throws(() => configuration({ CRAWL_PROFILE: 'other' }));
});
test('dashboard, static assets and health are reachable', async () => {
  for (const path of ['/', '/assets/style.css', '/assets/app.js', '/README.md', '/healthz']) {
    const response = await request(path); assert.equal(response.status, 200, path); await response.arrayBuffer();
  }
});
test('baseline first, middle and last have unique server-rendered content', async () => {
  for (const id of [1, 7500, 15000]) {
    const path = `/valid/${String(id).padStart(5, '0')}`;
    const response = await request(path); assert.equal(response.status, 200);
    const text = await response.text(); assert.ok(text.includes(`data-qa-id="valid-${id}"`));
    assert.ok(text.includes(`href="${base}${path}"`)); assert.ok(response.headers.get('etag'));
    assert.equal(response.headers.get('x-robots-tag'), null);
  }
});
test('invalid IDs and unknown query strings do not create extra valid URLs', async () => {
  for (const path of ['/valid/00000', '/valid/15001', '/valid/1', '/valid/00001?other=1']) {
    const response = await request(path); assert.equal(response.status, 404, path); await response.text();
  }
});
test('HEAD has no body and does not count fixture GET observations', async () => {
  await reset(); const response = await request('/valid/00001', { method: 'HEAD' });
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  assert.ok(Number(response.headers.get('content-length')) > 0);
  const stats = await request('/api/stats').then(r => r.json()); assert.equal(stats.fixtureGetRequests, 0);
});
test('all eight persistent HTTP codes stay failures across requests', async () => {
  for (const status of [401, 403, 404, 410, 429, 500, 502, 503]) {
    for (let i = 0; i < 2; i++) { const response = await request(`/cases/http-${status}/blog-0001`); assert.equal(response.status, status); await response.text(); }
  }
});
test('retry HEAD does not consume the failure; GET goes 503 then 200', async () => {
  await reset();
  for (let i = 0; i < 2; i++) assert.equal((await request('/cases/retry-503/0001', { method: 'HEAD' })).status, 503);
  const first = await request('/cases/retry-503/0001'); assert.equal(first.status, 503); await first.text();
  const second = await request('/cases/retry-503/0001'); assert.equal(second.status, 200); await second.text();
  const data = await request('/api/observations').then(r => r.json());
  assert.equal(data.items[0].gets, 2); assert.equal(data.items[0].statusCounts['503'], 1); assert.equal(data.items[0].statusCounts['200'], 1);
});
test('429 retry returns Retry-After and recovers', async () => {
  await reset(); const first = await request('/cases/retry-429/0001');
  assert.equal(first.status, 429); assert.equal(first.headers.get('retry-after'), '1'); await first.text();
  const second = await request('/cases/retry-429/0001'); assert.equal(second.status, 200); await second.text();
});
test('four successful redirect codes lead to existing valid documents', async () => {
  for (const status of [301, 302, 307, 308]) {
    const response = await request(`/cases/redirect-${status}/0001`); assert.equal(response.status, status);
    assert.equal(response.headers.get('location'), '/valid/00001'); await response.text();
    const end = await fetch(base + `/cases/redirect-${status}/0001`); assert.equal(end.status, 200); await end.text();
  }
});
test('broken redirect targets a known 404; redirect cycle has two nodes', async () => {
  const broken = await request('/cases/redirect-broken/0001'); const target = broken.headers.get('location'); await broken.text();
  const failed = await request(target); assert.equal(failed.status, 404); await failed.text();
  const first = await request('/cases/redirect-loop/0001'); assert.equal(first.headers.get('location'), '/cases/redirect-loop/0002'); await first.text();
  const second = await request('/cases/redirect-loop/0002'); assert.equal(second.headers.get('location'), '/cases/redirect-loop/0001'); await second.text();
});
test('incremental validators: ETag, weak ETag, Last-Modified and precedence', async () => {
  const first = await request('/cases/incremental/0001'); const etag = first.headers.get('etag'); const modified = first.headers.get('last-modified'); await first.text();
  for (const headers of [{ 'If-None-Match': etag }, { 'If-None-Match': `W/${etag}` }, { 'If-Modified-Since': modified }]) {
    const response = await request('/cases/incremental/0001', { headers }); assert.equal(response.status, 304); assert.equal(await response.text(), '');
  }
  const response = await request('/cases/incremental/0001', { headers: { 'If-None-Match': '"different"', 'If-Modified-Since': modified } });
  assert.equal(response.status, 200); await response.text();
});
test('robots, noindex meta and response-header fixtures are real', async () => {
  const robots = await request('/robots.txt').then(r => r.text());
  assert.ok(robots.includes('Disallow: /cases/robots-blocked/')); assert.ok(!robots.includes('\nSitemap:'));
  const meta = await request('/cases/noindex-meta/0001').then(r => r.text()); assert.ok(meta.includes('<meta name="robots" content="noindex, follow">'));
  const header = await request('/cases/noindex-header/0001'); assert.equal(header.headers.get('x-robots-tag'), 'noindex'); await header.text();
});
test('all encoded, mixed-case, long and query fixtures respond 200', async () => {
  for (const row of app.catalog.cases.filter(row => row.group === 'url-edge')) {
    const response = await request(row.path); assert.equal(response.status, 200, row.path); await response.text();
  }
});
test('empty HTML, deliberately invalid PDF MIME and large-body fixtures', async () => {
  const empty = await request('/cases/empty-html/0001'); assert.equal(await empty.text(), '');
  const invalid = await request('/cases/parser-invalid/0001'); assert.equal(invalid.headers.get('content-type'), 'application/pdf'); assert.ok((await invalid.text()).startsWith('THIS IS INTENTIONALLY'));
  const large = await request('/cases/large-body/0001'); assert.ok((await large.arrayBuffer()).byteLength >= app.config.largeBodyBytes);
});
test('delayed endpoint is nonblocking and releases its slot', async () => {
  const begin = performance.now(); const response = await request('/cases/timeout/0001'); await response.text();
  assert.ok(performance.now() - begin >= 30);
  const stats = await request('/api/stats').then(r => r.json()); assert.equal(stats.pendingDelays, 0);
});
test('admin reset is POST-only and authenticated, and changes boot ID', async () => {
  assert.equal((await request('/admin/reset')).status, 405);
  const unauthorized = await request('/admin/reset', { method: 'POST' }); assert.equal(unauthorized.status, 401); await unauthorized.text();
  const before = await request('/api/config').then(r => r.json());
  const response = await reset(); assert.equal(response.status, 200); const after = await response.json(); assert.notEqual(after.bootId, before.bootId);
});
test('manifest and observation validation are deterministic', async () => {
  const data = await request('/api/manifest?profile=mixed').then(r => r.json());
  assert.equal(data.records.length, 15292); assert.equal(new Set(data.records.map(row => row.url)).size, 15292);
  assert.equal((await request('/api/manifest?profile=bad')).status, 400);
  assert.equal((await request('/api/observations?limit=-1')).status, 400);
});
test('HTML-only discovery finds every fixture without visiting the dashboard', async () => {
  const queue = ['/crawl'], visited = new Set(), fixturePaths = new Set();
  while (queue.length) {
    const path = queue.shift(); if (visited.has(path)) continue; visited.add(path);
    const response = await request(path); assert.equal(response.status, 200, path); const html = await response.text();
    for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      const url = new URL(decode(match[1]), base); const target = url.pathname + url.search;
      if (target.startsWith('/crawl')) queue.push(target); else fixturePaths.add(target);
    }
  }
  assert.equal(visited.size, infrastructurePaths(app.catalog, 'mixed').length);
  assert.equal(fixturePaths.size, 15292);
  for (const row of app.catalog.all) assert.ok(fixturePaths.has(row.path), row.path);
});
test('mixed sitemap shards enumerate every fixture exactly once and escape queries', async () => {
  const index = await request('/sitemaps/mixed.xml').then(r => r.text());
  const locations = [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => decode(match[1]));
  assert.equal(locations.length, 4);
  const all = [];
  for (const location of locations) {
    const text = await fetch(location).then(r => r.text());
    all.push(...[...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => decode(match[1])));
  }
  assert.equal(all.length, 15292); assert.equal(new Set(all).size, 15292);
  assert.ok(all.includes(base + '/cases/url-edge/query?tag=one&tag=two'));
});
