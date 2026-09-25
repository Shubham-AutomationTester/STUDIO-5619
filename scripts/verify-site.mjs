import { args, absoluteBase, writeJson, sleep, positiveInteger } from './common.mjs';
import { performance } from 'node:perf_hooks';
import { validPath, HTTP_STATUSES } from '../lib/catalog.mjs';

const options = args();
const report = { schema: 'qa-origin-check/v1', scope: 'Origin fixture verification only, not SearchStax/Datadog validation', failures: [], checks: 0, startedAt: new Date().toISOString() };
const started = performance.now();
const output = options.out || 'reports/site-check.json';
try {
  const base = absoluteBase(options.base || 'http://localhost:3000');
  const concurrent = positiveInteger(options.concurrency, 3, 8);
  const pause = positiveInteger(options['pause-ms'], 100, 10000);
  report.baseUrl = base; report.allValid = options['all-valid'] === true;
  const config = await fetch(base + '/api/config').then(response => { if (!response.ok) throw new Error(`Config HTTP ${response.status}`); return response.json(); });
  report.serverConfiguration = config;
  const check = async (path, expectedStatus, init = {}, marker = null) => {
    report.checks++;
    try {
      const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
      const text = await response.text();
      if (response.status !== expectedStatus) throw new Error(`Expected ${expectedStatus}, got ${response.status}`);
      if (marker && !text.includes(marker)) throw new Error(`Missing content marker ${marker}`);
      return response;
    } catch (error) { report.failures.push({ path, error: error.message }); return null; }
  };
  await check('/healthz', 200);
  const paths = report.allValid ? Array.from({ length: 15000 }, (_, i) => validPath(i + 1)) : [validPath(1), validPath(7500), validPath(15000)];
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrent }, async () => {
    while (cursor < paths.length) {
      const index = cursor++, path = paths[index], id = Number(path.split('/').pop());
      await check(path, 200, {}, `data-qa-id="valid-${id}"`);
      if ((index + 1) % 1000 === 0) console.log(`Checked ${index + 1} / ${paths.length} valid URLs`);
      await sleep(pause);
    }
  }));
  for (const status of HTTP_STATUSES) await check(`/cases/http-${status}/blog-0001`, status, { method: 'HEAD' });
  for (const status of [301, 302, 307, 308]) {
    const response = await check(`/cases/redirect-${status}/0001`, status, { method: 'HEAD' });
    if (response && response.headers.get('location') !== validPath(1)) report.failures.push({ path: `redirect-${status}`, error: 'Incorrect redirect target' });
  }
  const first = await check('/cases/incremental/0001', 200);
  if (first) await check('/cases/incremental/0001', 304, { headers: { 'If-None-Match': first.headers.get('etag') } });
  const noindex = await check('/cases/noindex-header/0001', 200, { method: 'HEAD' });
  if (noindex?.headers.get('x-robots-tag') !== 'noindex') report.failures.push({ path: '/cases/noindex-header/0001', error: 'Missing noindex header' });
  await check('/cases/noindex-meta/0001', 200, {}, '<meta name="robots" content="noindex, follow">');
  await check('/valid/00000', 404);
  await check('/valid/15001', 404);
  const manifest = await fetch(base + '/api/manifest?profile=mixed').then(response => response.json());
  report.checks++;
  if (manifest.records.length !== config.totalFixtureUrls || new Set(manifest.records.map(row => row.url)).size !== manifest.records.length) report.failures.push({ path: '/api/manifest', error: 'Manifest count or uniqueness mismatch' });
  report.checkedValidUrls = paths.length;
  report.note = 'Stateful retry GETs are intentionally not probed. These checks do create origin observations; reset before a real crawl.';
} catch (error) { report.failures.push({ error: error.message }); }
report.result = report.failures.length ? 'FAIL' : 'PASS';
report.durationMs = Math.round(performance.now() - started);
report.finishedAt = new Date().toISOString();
await writeJson(output, report);
console.log(JSON.stringify({ result: report.result, checks: report.checks, checkedValidUrls: report.checkedValidUrls, failures: report.failures.length, report: output }, null, 2));
process.exitCode = report.failures.length ? 1 : 0;
