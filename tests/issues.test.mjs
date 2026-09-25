import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collectIssues, evaluate } from '../scripts/check-issues.mjs';
import { compareProviders } from '../scripts/compare-providers.mjs';

const row = id => ({ url: `https://fixture.example/cases/http-404/blog-${id}`, result: 'failed', issue_code: 'fixture-only-404', pipeline_stage: 'fixture-fetch', http_status_code: 404 });
// These synthetic enums validate the tool itself. They are NOT claims about SearchStax's real contract.
const baseConfig = {
  itemsPath: 'items', nextCursorPath: 'next_cursor', cursorParam: 'cursor', limit: 10,
  fields: { url: 'url', result: 'result', issue_code: 'issue_code', pipeline_stage: 'pipeline_stage', http_status_code: 'http_status_code' },
  availabilityPath: 'availability', availableValues: ['available'], query: {}
};
const oracle = rows => ({ required: rows, forbidden: [], conditional: [], filter: {} });
async function serve(handler, run) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}/issues`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

test('collector returns 25 unique issues with pages 10, 10, 5', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(i));
  await serve((req, res) => {
    const url = new URL(req.url, 'http://localhost'); assert.equal(url.searchParams.get('limit'), '10');
    const offset = Number(url.searchParams.get('cursor') || 0);
    json(res, { items: rows.slice(offset, offset + 10), next_cursor: offset + 10 < rows.length ? String(offset + 10) : null, availability: 'available' });
  }, async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint }), oracle(rows));
    assert.equal(report.result, 'PASS'); assert.deepEqual(report.pages.map(page => page.count), [10, 10, 5]);
  });
});
test('cursor loop is incomplete, never a healthy empty result', async () => {
  await serve((req, res) => json(res, { items: [row(1)], next_cursor: 'again', availability: 'available' }), async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint }), oracle([row(1)]));
    assert.equal(report.result, 'INCOMPLETE'); assert.match(report.error, /Repeated cursor/);
  });
});
test('missing next_cursor field does not silently truncate retrieval', async () => {
  await serve((req, res) => json(res, { items: [row(1)], availability: 'available' }), async endpoint => {
    const report = await collectIssues({ ...baseConfig, endpoint }); assert.equal(report.collectionComplete, false); assert.match(report.error, /missing/);
  });
});
test('HTTP 429 and 503 are data retrieval failures, not zero issues', async () => {
  for (const status of [429, 503]) await serve((req, res) => json(res, { error: 'provider unavailable' }, status), async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint }), oracle([])); assert.equal(report.result, 'INCOMPLETE'); assert.match(report.error, new RegExp(String(status)));
  });
});
test('expired data with empty items is not a clean run', async () => {
  await serve((req, res) => json(res, { items: [], next_cursor: null, availability: 'expired' }), async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint }), oracle([])); assert.equal(report.result, 'INCOMPLETE');
  });
});
test('unknown availability requires review even for a complete empty result', async () => {
  await serve((req, res) => json(res, { items: [], next_cursor: null }), async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint, availabilityPath: null }), oracle([])); assert.equal(report.result, 'NEEDS_REVIEW');
  });
});
test('duplicates, missing URLs and successful URLs appearing are failures', () => {
  const report = { records: [row(1), row(1), row(2)], filter: {}, anomalies: [], collectionComplete: true, dataAvailabilityVerified: true };
  evaluate(report, { required: [row(1), row(3)], forbidden: [row(2)], conditional: [], filter: {} });
  assert.equal(report.result, 'FAIL'); assert.equal(report.duplicateUrls.length, 1); assert.equal(report.missingUrls.length, 1); assert.equal(report.forbiddenUrls.length, 1);
});
test('unknown conditional visibility prevents a premature PASS', () => {
  const report = { records: [row(1)], filter: {}, anomalies: [], collectionComplete: true, dataAvailabilityVerified: true };
  evaluate(report, { required: [row(1)], forbidden: [], conditional: [row(2)], filter: {} }); assert.equal(report.result, 'NEEDS_REVIEW');
});
test('filters are preserved across cursors and checked locally', async () => {
  await serve((req, res) => {
    const url = new URL(req.url, 'http://localhost'); assert.equal(url.searchParams.get('url_search'), 'blog'); assert.equal(url.searchParams.get('http_status_code'), '404');
    const next = url.searchParams.has('cursor') ? null : 'page-two';
    json(res, { items: [row(next ? 1 : 2)], next_cursor: next, availability: 'available' });
  }, async endpoint => {
    const filter = { url_search: 'blog', http_status_code: '404' };
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint, query: filter }), { ...oracle([row(1), row(2)]), filter });
    assert.equal(report.result, 'PASS'); assert.equal(report.pages.length, 2);
  });
});
test('mismatched oracle filters are rejected', () => {
  assert.throws(() => evaluate({ records: [], filter: { http_status_code: '404' }, anomalies: [] }, oracle([])), /mismatch/);
});
test('provider parity ignores record order but compares outcomes', () => {
  const left = { collectionComplete: true, dataAvailabilityVerified: true, records: [row(1), row(2)], filter: {}, result: 'PASS' };
  const right = { ...left, records: [row(2), row(1)] };
  assert.equal(compareProviders(left, right).result, 'PARITY_ONLY_PASS');
  right.records = [row(1), { ...row(2), issue_code: 'different' }]; assert.equal(compareProviders(left, right).result, 'FAIL');
});
test('unavailable providers cannot pass parity', () => {
  const report = { collectionComplete: true, dataAvailabilityVerified: false, records: [] };
  assert.throws(() => compareProviders(report, report), /availability/);
});

test('collector scale: 10,005 unique outcomes across 1,001 pages', async () => {
  const rows = Array.from({ length: 10005 }, (_, i) => row(i));
  await serve((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const offset = Number(url.searchParams.get('cursor') || 0);
    json(res, { items: rows.slice(offset, offset + 10), next_cursor: offset + 10 < rows.length ? String(offset + 10) : null, availability: 'available' });
  }, async endpoint => {
    const report = evaluate(await collectIssues({ ...baseConfig, endpoint }), oracle(rows));
    assert.equal(report.result, 'PASS'); assert.equal(report.pages.length, 1001);
    assert.equal(report.pages.at(-1).count, 5); assert.equal(report.uniqueUrls, 10005);
  });
});
