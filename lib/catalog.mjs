export const VALID_COUNT = 15000;
export const PAGE_SIZE = 250;
export const HTTP_STATUSES = [401, 403, 404, 410, 429, 500, 502, 503];
export const PROFILES = ['mixed', 'baseline', 'boundary', 'issues'];
export const pad = (n, width = 4) => String(n).padStart(width, '0');
export const validPath = n => `/valid/${pad(n, 5)}`;

export function integer(value, fallback, min, max, name) {
  const input = value === undefined || value === '' ? String(fallback) : String(value);
  if (!/^\d+$/.test(input)) throw new Error(`${name} must be an integer`);
  const number = Number(input);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

export function configuration(env = process.env) {
  const profile = env.CRAWL_PROFILE || 'mixed';
  if (!PROFILES.includes(profile)) throw new Error('CRAWL_PROFILE must be mixed, baseline, boundary, or issues');
  const version = env.CONTENT_VERSION || 'v1';
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(version)) throw new Error('CONTENT_VERSION must be 1-40 safe characters');
  const lastModified = env.CONTENT_LAST_MODIFIED || 'Wed, 01 Jan 2025 00:00:00 GMT';
  if (!Number.isFinite(Date.parse(lastModified))) throw new Error('CONTENT_LAST_MODIFIED must be an HTTP date');
  let baseUrl = env.BASE_URL || env.RENDER_EXTERNAL_URL || '';
  if (baseUrl) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('BASE_URL must be an http(s) origin with no path, credentials, query, or fragment');
    }
    baseUrl = parsed.origin;
  }
  return {
    issuesPerStatus: integer(env.ISSUES_PER_STATUS, 25, 25, 2000, 'ISSUES_PER_STATUS'),
    retryFailures: integer(env.RETRY_FAILURES, 1, 1, 5, 'RETRY_FAILURES'),
    delayMs: integer(env.DELAY_MS, 8000, 1, 60000, 'DELAY_MS'),
    largeBodyBytes: integer(env.LARGE_BODY_BYTES, 1048576, 1024, 5242880, 'LARGE_BODY_BYTES'),
    adminToken: env.ADMIN_TOKEN || '', baseUrl, version,
    lastModified: new Date(lastModified).toUTCString(), profile,
    requestLogging: env.REQUEST_LOGGING === 'true'
  };
}

export function makeCatalog(config) {
  const valid = Array.from({ length: VALID_COUNT }, (_, i) => ({
    path: validPath(i + 1), group: 'valid', kind: 'valid', id: i + 1,
    status: 200, expectation: 'forbidden',
    note: 'Must be absent from issues after successful fetch, parse, and index.'
  }));
  const cases = [];
  const add = (group, count, properties) => {
    for (let i = 1; i <= count; i++) {
      cases.push({ path: `/cases/${group}/${pad(i)}`, group, id: i, ...properties });
    }
  };
  for (const status of HTTP_STATUSES) {
    for (let i = 1; i <= config.issuesPerStatus; i++) {
      cases.push({
        path: `/cases/http-${status}/${i % 2 ? 'blog' : 'products'}-${pad(i)}`,
        group: `http-${status}`, kind: 'http-error', id: i, status, expectation: 'required',
        note: `Persistent HTTP ${status}. Must be discovered and attempted; no successful recovery.`
      });
    }
  }
  for (const status of [429, 503]) add(`retry-${status}`, 10, {
    kind: 'retry', status, expectation: 'conditional',
    note: `First ${config.retryFailures} GET request(s) return ${status}; later GETs return 200. HEAD does not consume attempts. Exclude only after confirmed crawler recovery.`
  });
  for (const status of [301, 302, 307, 308]) add(`redirect-${status}`, 5, {
    kind: 'redirect', status, expectation: 'conditional',
    note: 'Redirects to an existing valid URL. Successful resolution is not an error; source URL visibility depends on the issues contract.'
  });
  add('redirect-broken', 5, { kind: 'broken', status: 302, expectation: 'conditional', note: 'Redirects to an existing persistent 404 fixture. Confirm whether source, destination, or both are reported.' });
  add('redirect-loop', 2, { kind: 'loop', status: 302, expectation: 'conditional', note: 'Two URLs redirect to each other. Confirm final URL attribution and redirect limit.' });
  add('configured-exclusion', 5, { kind: 'plain', status: 200, expectation: 'conditional', note: 'Add a crawler exclusion for this path. Expected exclusion must not be classified as an error; non-error visibility is contract-dependent.' });
  add('robots-blocked', 5, { kind: 'plain', status: 200, expectation: 'conditional', note: 'Disallowed in robots.txt. Must not be fetched when robots is honored. Confirm expected exclusion visibility.' });
  add('noindex-meta', 5, { kind: 'noindex-meta', status: 200, expectation: 'conditional', note: 'Real HTML robots noindex tag. Check configured behavior and non-error outcome visibility.' });
  add('noindex-header', 5, { kind: 'noindex-header', status: 200, expectation: 'conditional', note: 'Real X-Robots-Tag: noindex header. Check configured behavior and non-error outcome visibility.' });
  add('incremental', 10, { kind: 'incremental', status: 200, expectation: 'conditional', note: 'Stable body, ETag and Last-Modified. Conditional requests may return 304. Exclude unchanged incremental outcomes after a baseline run.' });
  add('timeout', 3, { kind: 'timeout', status: 200, expectation: 'conditional', note: `Waits ${config.delayMs} ms before headers. Set crawler timeout below this. Timeout outcome and URL attribution must be confirmed.` });
  add('empty-html', 2, { kind: 'empty', status: 200, expectation: 'conditional', note: 'Zero-byte text/html response. Parser may skip or reject; confirm its documented policy.' });
  add('parser-invalid', 2, { kind: 'parser-invalid', status: 200, expectation: 'conditional', note: 'Deliberately invalid bytes with application/pdf MIME type; not a real PDF. Parser failure requires file-type extraction to be enabled.' });
  add('large-body', 2, { kind: 'large', status: 200, expectation: 'conditional', note: `HTML of at least ${config.largeBodyBytes} bytes. Requires a smaller configured size threshold to exercise rejection.` });
  const edges = [
    '/cases/url-edge/space%20name', '/cases/url-edge/caf%C3%A9',
    '/cases/url-edge/MixedCase', `/cases/url-edge/${'a'.repeat(180)}`,
    '/cases/url-edge/query?tag=one&tag=two', '/cases/url-edge/plus?value=a%2Bb'
  ];
  edges.forEach((path, index) => cases.push({
    path, group: 'url-edge', kind: 'plain', id: index + 1, status: 200,
    expectation: 'conditional', note: 'Valid HTTP 200 URL. Confirm crawler encoding/query normalization and index identity; should not be an error after successful indexing.'
  }));
  const all = [...valid, ...cases];
  const groups = [...new Set(cases.map(row => row.group))];
  const catalog = { valid, cases, all, groups, byPath: new Map(all.map(row => [row.path, row])) };
  if (catalog.byPath.size !== all.length) throw new Error('Duplicate fixture path');
  return catalog;
}

export function selectProfile(catalog, profile) {
  if (!PROFILES.includes(profile)) throw new Error(`Unknown profile: ${profile}`);
  if (profile === 'baseline') return catalog.valid;
  if (profile === 'boundary') return catalog.cases.filter(row => row.group === 'http-404').slice(0, 25);
  if (profile === 'issues') return catalog.cases.filter(row => row.kind === 'http-error');
  return catalog.all;
}

export function infrastructurePaths(catalog, profile) {
  if (profile === 'boundary') return ['/crawl/boundary'];
  if (profile === 'issues') return ['/crawl/issues', ...HTTP_STATUSES.map(s => `/crawl/cases/http-${s}`)];
  const pages = Array.from({ length: Math.ceil(VALID_COUNT / PAGE_SIZE) }, (_, i) => `/crawl/valid/${pad(i + 1, 2)}`);
  if (profile === 'baseline') return ['/crawl/baseline', ...pages];
  return ['/crawl', ...pages, ...catalog.groups.map(group => `/crawl/cases/${group}`)];
}

export function counts(catalog) {
  return {
    valid: catalog.valid.length, additional: catalog.cases.length,
    totalFixtureUrls: catalog.all.length,
    requiredIssues: catalog.cases.filter(row => row.expectation === 'required').length,
    conditional: catalog.cases.filter(row => row.expectation === 'conditional').length,
    navigationUrls: infrastructurePaths(catalog, 'mixed').length,
    groups: catalog.groups.map(group => {
      const rows = catalog.cases.filter(row => row.group === group);
      return { group, count: rows.length, status: rows[0].status, expectation: rows[0].expectation, note: rows[0].note, sample: rows[0].path };
    })
  };
}
