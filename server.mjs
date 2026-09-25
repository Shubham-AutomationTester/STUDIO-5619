import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { configuration, makeCatalog, counts, selectProfile, validPath, pad, VALID_COUNT, PAGE_SIZE, HTTP_STATUSES } from './lib/catalog.mjs';

const root = new URL('./', import.meta.url);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = text => escape(text);
const hash = value => `"${createHash('sha256').update(value).digest('hex').slice(0, 32)}"`;

export async function createApp(config = configuration()) {
  const catalog = makeCatalog(config);
  const summary = counts(catalog);
  const assetFiles = {
    '/': ['public/index.html', 'text/html; charset=utf-8'],
    '/assets/style.css': ['public/style.css', 'text/css; charset=utf-8'],
    '/assets/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
    '/README.md': ['README.md', 'text/plain; charset=utf-8']
  };
  const assets = new Map();
  for (const [url, [path, type]] of Object.entries(assetFiles)) assets.set(url, { body: await readFile(new URL(path, root)), type });
  let state;
  const reset = label => { state = { bootId: randomUUID(), label, startedAt: new Date().toISOString(), attempts: new Map(), observations: new Map(), totalGets: 0 }; };
  reset('initial');
  let delayed = 0;
  const origin = req => {
    if (config.baseUrl) return config.baseUrl;
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwarded === 'https' ? 'https' : 'http';
    const host = req.headers.host || 'localhost:3000';
    return new URL(`${protocol}://${host}`).origin;
  };
  const page = (title, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>${extra}<link rel="stylesheet" href="/assets/style.css"></head><body class="fixture"><main><p class="eyebrow">STUDIO-5619 / CRAWL FIXTURE</p><h1>${escape(title)}</h1>${body}</main></body></html>`;
  const links = rows => `<ul class="url-list">${rows.map(row => `<li><a href="${escape(row.path)}">${escape(row.path)}</a></li>`).join('')}</ul>`;
  const authorize = req => {
    const header = req.headers.authorization || '';
    const wanted = `Bearer ${config.adminToken}`;
    return Boolean(config.adminToken) && Buffer.byteLength(header) === Buffer.byteLength(wanted) && timingSafeEqual(Buffer.from(header), Buffer.from(wanted));
  };
  const server = http.createServer(async (req, res) => {
    const begun = performance.now();
    const requestState = state;
    let record;
    let attempted = false;
    try {
      const url = new URL(req.url, origin(req));
      const path = url.pathname + url.search;
      const base = origin(req);
      const send = (status, body = '', headers = {}) => {
        if (res.destroyed || res.writableEnded) return;
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        const defaults = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (status !== 304 && status !== 204) defaults['Content-Length'] = buffer.length;
        res.writeHead(status, { ...defaults, ...headers });
        res.end(req.method === 'HEAD' || status === 304 ? undefined : buffer);
      };
      const json = (status, body) => send(status, JSON.stringify(body, null, 2), { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' });
      res.on('finish', () => {
        if (record && req.method === 'GET') {
          let observed = requestState.observations.get(path);
          if (!observed) {
            observed = { path, group: record.group, gets: 0, statusCounts: {}, lastStatus: null, firstSeen: new Date().toISOString() };
            requestState.observations.set(path, observed);
          }
          observed.gets++;
          observed.statusCounts[res.statusCode] = (observed.statusCounts[res.statusCode] || 0) + 1;
          observed.lastStatus = res.statusCode;
          observed.lastSeen = new Date().toISOString();
          observed.lastDurationMs = Math.round(performance.now() - begun);
          if (config.requestLogging) console.log(JSON.stringify({ event: 'qa_fixture.response', boot_id: requestState.bootId, path, http_status: res.statusCode, duration_ms: observed.lastDurationMs }));
        }
      });
      res.on('close', () => {
        if (attempted && !res.writableFinished && config.requestLogging) console.log(JSON.stringify({ event: 'qa_fixture.client_closed', boot_id: requestState.bootId, path }));
      });
      if (url.pathname === '/admin/reset') {
        if (req.method !== 'POST') return json(405, { error: 'POST_REQUIRED' });
        if (!config.adminToken) return json(503, { error: 'ADMIN_DISABLED', detail: 'Set ADMIN_TOKEN before resetting.' });
        if (!authorize(req)) return json(401, { error: 'UNAUTHORIZED' });
        let text = '';
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 4096) return json(413, { error: 'BODY_TOO_LARGE' });
        }
        let input;
        try { input = text ? JSON.parse(text) : {}; } catch { return json(400, { error: 'INVALID_JSON' }); }
        const label = input.label || 'manual-reset';
        if (typeof label !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(label)) return json(400, { error: 'INVALID_LABEL' });
        if (delayed) return json(409, { error: 'ACTIVE_DELAYED_REQUESTS', detail: 'Stop the crawler and wait for pending responses before reset.' });
        reset(label);
        return json(200, { reset: true, bootId: state.bootId, label, warning: 'Only fixture counters changed. SearchStax/Datadog data was not changed.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      if (path === '/healthz') return json(200, { status: 'ok', service: 'studio-5619-crawl-lab' });
      if (path === '/favicon.ico') return send(204);
      if (assets.has(path)) {
        const asset = assets.get(path);
        return send(200, asset.body, { 'Content-Type': asset.type, 'X-Robots-Tag': 'noindex, nofollow' });
      }
      if (path === '/robots.txt') return send(200, [
        'User-agent: *', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /assets/',
        'Disallow: /README.md', 'Disallow: /healthz', 'Disallow: /cases/robots-blocked/',
        '# No Sitemap directive: select the matching profile sitemap explicitly.', ''
      ].join('\n'), { 'Content-Type': 'text/plain; charset=utf-8' });
      if (url.pathname === '/api/manifest') {
        const profile = url.searchParams.get('profile') || 'mixed';
        let rows;
        try { rows = selectProfile(catalog, profile); } catch (e) { return json(400, { error: e.message }); }
        return json(200, { schema: 'qa-fixture-manifest/v1', profile, baseUrl: base, summary, warning: 'Expectations are an oracle, not actual SearchStax outcomes. Conditional cases require QA resolution.', records: rows.map(row => ({ ...row, url: base + row.path })) });
      }
      if (path === '/api/config') return json(200, {
        ...summary, baseUrl: base, profile: config.profile, retryFailures: config.retryFailures,
        delayMs: config.delayMs, largeBodyBytes: config.largeBodyBytes, contentVersion: config.version,
        adminEnabled: Boolean(config.adminToken), bootId: state.bootId, label: state.label,
        warning: 'Fixture HTTP responses are not crawler/indexer or Datadog evidence.'
      });
      if (path === '/api/stats') {
        const byGroup = {};
        for (const item of state.observations.values()) {
          const group = byGroup[item.group] ||= { uniqueUrls: 0, gets: 0, statusCounts: {} };
          group.uniqueUrls++; group.gets += item.gets;
          for (const [status, number] of Object.entries(item.statusCounts)) group.statusCounts[status] = (group.statusCounts[status] || 0) + number;
        }
        return json(200, { bootId: state.bootId, label: state.label, startedAt: state.startedAt, fixtureGetRequests: state.totalGets,
          uniqueRespondedUrls: state.observations.size, pendingDelays: delayed, byGroup,
          evidence: 'Origin responses only; requests may include manual probes. Aborted requests are not counted as completed responses.' });
      }
      if (url.pathname === '/api/observations') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) return json(400, { error: 'INVALID_PAGINATION' });
        const rows = [...state.observations.values()].sort((a, b) => a.path.localeCompare(b.path));
        return json(200, { bootId: state.bootId, total: rows.length, items: rows.slice(offset, offset + limit), next_offset: offset + limit < rows.length ? offset + limit : null });
      }
      const sitemapIndex = profile => {
        let locations;
        if (profile === 'mixed') locations = [1, 2, 3].map(n => `${base}/sitemaps/valid-${n}.xml`).concat(`${base}/sitemaps/cases.xml`);
        else if (profile === 'baseline') locations = [1, 2, 3].map(n => `${base}/sitemaps/valid-${n}.xml`);
        else locations = [`${base}/sitemaps/${profile}-urls.xml`];
        return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map(loc => `<sitemap><loc>${xml(loc)}</loc></sitemap>`).join('')}</sitemapindex>`;
      };
      const indexMatch = path.match(/^\/sitemaps\/(mixed|baseline|boundary|issues)\.xml$/);
      if (path === '/sitemap.xml' || indexMatch) return send(200, sitemapIndex(indexMatch ? indexMatch[1] : config.profile), { 'Content-Type': 'application/xml; charset=utf-8' });
      const shardMatch = path.match(/^\/sitemaps\/valid-([1-3])\.xml$/);
      if (shardMatch || ['/sitemaps/cases.xml', '/sitemaps/boundary-urls.xml', '/sitemaps/issues-urls.xml'].includes(path)) {
        let rows;
        if (shardMatch) { const n = Number(shardMatch[1]); rows = catalog.valid.slice((n - 1) * 5000, n * 5000); }
        else rows = path.includes('boundary') ? selectProfile(catalog, 'boundary') : path.includes('issues-urls') ? selectProfile(catalog, 'issues') : catalog.cases;
        return send(200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map(row => `<url><loc>${xml(base + row.path)}</loc></url>`).join('')}</urlset>`, { 'Content-Type': 'application/xml; charset=utf-8' });
      }
      if (['/crawl', '/crawl/baseline', '/crawl/boundary', '/crawl/issues'].includes(path)) {
        const profile = path === '/crawl' ? 'mixed' : path.split('/').pop();
        let rows = [];
        if (['mixed', 'baseline'].includes(profile)) rows.push(...Array.from({ length: VALID_COUNT / PAGE_SIZE }, (_, i) => ({ path: `/crawl/valid/${pad(i + 1, 2)}` })));
        if (profile === 'mixed') rows.push(...catalog.groups.map(group => ({ path: `/crawl/cases/${group}` })));
        if (profile === 'issues') rows.push(...HTTP_STATUSES.map(status => ({ path: `/crawl/cases/http-${status}` })));
        if (profile === 'boundary') rows = selectProfile(catalog, 'boundary');
        let body = `<p>Discovery seed for <strong>${escape(profile)}</strong>. Fixture URLs: ${selectProfile(catalog, profile).length}. Navigation pages are additional, successful HTTP pages.</p>${links(rows)}`;
        if (profile === 'mixed') body += `<h2>Duplicate-link discovery check</h2><p>These repeated links must not create duplicate URL outcomes.</p><a href="${validPath(1)}">Valid URL once</a> <a href="${validPath(1)}">Same URL twice</a> <a href="${validPath(1)}#section">Same URL with fragment</a>`;
        return send(200, page(`Crawl seed: ${profile}`, body));
      }
      const pageMatch = path.match(/^\/crawl\/valid\/(\d{2})$/);
      if (pageMatch && Number(pageMatch[1]) >= 1 && Number(pageMatch[1]) <= VALID_COUNT / PAGE_SIZE) {
        const n = Number(pageMatch[1]);
        return send(200, page(`Valid URL directory ${n}`, links(catalog.valid.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE))));
      }
      const groupMatch = path.match(/^\/crawl\/cases\/([a-z0-9-]+)$/);
      if (groupMatch && catalog.groups.includes(groupMatch[1])) return send(200, page(`Scenario: ${groupMatch[1]}`, links(catalog.cases.filter(row => row.group === groupMatch[1]))));
      record = catalog.byPath.get(path);
      if (!record) return send(404, page('Unknown fixture URL', '<p>This URL is not in the fixture manifest.</p>'));
      const expected = escape(record.note);
      const content = `<article data-qa-id="${escape(record.group)}-${record.id}"><p>${expected}</p><p>Fixture ID: ${escape(record.group)}-${record.id}. Content version: ${escape(config.version)}.</p><p>SearchStax QA content for crawl discovery, text extraction, deterministic indexing and issue retrieval. Record number ${record.id} has unique searchable marker QA5619_${escape(record.group)}_${record.id}.</p><p id="section">This is real HTML delivered by the server, not a JavaScript-only page.</p></article>`;
      const title = record.kind === 'valid' ? `Valid document ${pad(record.id, 5)} | STUDIO-5619` : `${record.group} ${record.id} | STUDIO-5619`;
      const commonHeaders = { 'X-QA-Fixture': record.group, 'X-QA-Boot-Id': requestState.bootId };
      if (req.method === 'GET') { requestState.totalGets++; attempted = true; }
      if (['valid', 'incremental'].includes(record.kind)) {
        const body = page(title, content, `<link rel="canonical" href="${escape(base + path)}"><meta name="description" content="Unique crawl QA document ${record.id}, ${escape(record.group)}">`);
        const etag = hash(body);
        const headers = { ...commonHeaders, ETag: etag, 'Last-Modified': config.lastModified, 'Cache-Control': 'no-cache' };
        const inm = req.headers['if-none-match'];
        const matches = inm ? inm === '*' || inm.split(',').some(item => item.trim().replace(/^W\//, '') === etag) :
          Boolean(req.headers['if-modified-since']) && Date.parse(req.headers['if-modified-since']) >= Date.parse(config.lastModified);
        return send(matches ? 304 : 200, matches ? '' : body, headers);
      }
      if (record.kind === 'http-error') return send(record.status, page(title, content), { ...commonHeaders, ...(record.status === 401 ? { 'WWW-Authenticate': 'Basic realm="QA fixture - intentional unauthorized response"' } : {}), ...(record.status === 429 || record.status === 503 ? { 'Retry-After': '1' } : {}) });
      if (record.kind === 'retry') {
        const previous = requestState.attempts.get(path) || 0;
        const attempt = previous + (req.method === 'GET' ? 1 : 0);
        if (req.method === 'GET') requestState.attempts.set(path, attempt);
        const status = req.method === 'HEAD' ? (previous < config.retryFailures ? record.status : 200) : (attempt <= config.retryFailures ? record.status : 200);
        return send(status, page(title, content), { ...commonHeaders, 'X-QA-Get-Attempts': String(attempt), ...(status !== 200 ? { 'Retry-After': '1' } : {}) });
      }
      if (record.kind === 'redirect') return send(record.status, '', { ...commonHeaders, Location: validPath(record.id) });
      if (record.kind === 'broken') return send(302, '', { ...commonHeaders, Location: catalog.cases.find(row => row.group === 'http-404' && row.id === record.id).path });
      if (record.kind === 'loop') return send(302, '', { ...commonHeaders, Location: `/cases/redirect-loop/${pad(record.id === 1 ? 2 : 1)}` });
      if (record.kind === 'timeout') {
        if (delayed >= 20) return send(429, 'Fixture delay capacity exceeded', { ...commonHeaders, 'Retry-After': '5' });
        delayed++;
        let released = false;
        const release = () => { if (!released) { delayed--; released = true; } };
        const timer = setTimeout(() => { release(); send(200, page(title, content), commonHeaders); }, config.delayMs);
        res.once('close', () => { clearTimeout(timer); release(); });
        return;
      }
      if (record.kind === 'empty') return send(200, '', commonHeaders);
      if (record.kind === 'parser-invalid') return send(200, 'THIS IS INTENTIONALLY NOT A VALID PDF DOCUMENT. QA5619 malformed parser fixture.', { ...commonHeaders, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invalid-${record.id}.pdf"` });
      if (record.kind === 'large') return send(200, page(title, content + `<pre>${'QA5619-large-body '.repeat(Math.ceil(config.largeBodyBytes / 18))}</pre>`), commonHeaders);
      const extra = record.kind === 'noindex-meta' ? '<meta name="robots" content="noindex, follow">' : '';
      return send(200, page(title, content, extra), { ...commonHeaders, ...(record.kind === 'noindex-header' ? { 'X-Robots-Tag': 'noindex' } : {}) });
    } catch (error) {
      console.error(JSON.stringify({ event: 'qa_fixture.server_error', message: error.message }));
      if (!res.headersSent && !res.destroyed) { res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'FIXTURE_SERVER_ERROR' })); }
      else if (!res.destroyed) res.destroy();
    }
  });
  server.requestTimeout = 70000;
  server.headersTimeout = 65000;
  return { server, catalog, config, summary };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  app.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'qa_fixture.started', port, ...app.summary })));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
