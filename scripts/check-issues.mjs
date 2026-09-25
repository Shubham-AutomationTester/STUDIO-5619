import { performance } from 'node:perf_hooks';
import { args, readJson, writeJson, getPath, positiveInteger, isMain } from './common.mjs';

export async function collectIssues(config, { availabilityConfirmed = false } = {}) {
  const endpoint = process.env.ISSUES_ENDPOINT || config.endpoint;
  if (!endpoint || endpoint.includes('REPLACE_')) throw new Error('Set the real issues endpoint. The Jira ticket does not specify its URL or JSON envelope.');
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Endpoint must be HTTP(S) without URL credentials');
  const headers = { Accept: 'application/json' };
  for (const [header, variable] of Object.entries(config.headersFromEnv || {})) {
    if (!process.env[variable]) throw new Error(`Set environment variable ${variable}; do not put secrets in the config file.`);
    headers[header] = process.env[variable];
  }
  const limit = positiveInteger(config.limit, 10);
  const cursorParam = config.cursorParam || 'cursor';
  const limitParam = config.limitParam || 'limit';
  const fields = config.fields;
  if (!fields?.url || !fields?.result || !fields?.issue_code || !fields?.pipeline_stage || !fields?.http_status_code) throw new Error('Map all five fields in config.fields to the real response schema.');
  if (typeof config.itemsPath !== 'string' || typeof config.nextCursorPath !== 'string') throw new Error('Map itemsPath and nextCursorPath. An absent cursor field is an error, not end-of-data.');
  const query = config.query || {};
  if (Object.hasOwn(query, cursorParam) || Object.hasOwn(query, limitParam)) throw new Error('Keep cursor and limit out of query; use the dedicated config fields.');
  for (const [key, value] of Object.entries(query)) base.searchParams.set(key, String(value));
  base.searchParams.set(limitParam, String(limit));
  base.searchParams.delete(cursorParam);
  const filterKeys = ['url_search', 'result', 'issue_code', 'pipeline_stage', 'http_status_code'];
  const effectiveFilter = Object.fromEntries(filterKeys.filter(key => base.searchParams.has(key)).map(key => [key, base.searchParams.get(key)]));
  const report = { schema: 'qa-issue-report/v1', startedAt: new Date().toISOString(), collectionComplete: false,
    dataAvailabilityVerified: Boolean(availabilityConfirmed), filter: effectiveFilter, limit,
    records: [], pages: [], anomalies: [], peakRssBytes: process.memoryUsage().rss };
  const start = performance.now();
  const cursors = new Set();
  let cursor;
  try {
    for (let n = 1; n <= positiveInteger(config.maxPages, 20000); n++) {
      const requestUrl = new URL(base);
      if (cursor !== undefined) requestUrl.searchParams.set(cursorParam, String(cursor));
      const pageStart = performance.now();
      const response = await fetch(requestUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(positiveInteger(config.timeoutMs, 30000, 300000)) });
      if (!response.ok) throw new Error(`Issues API returned HTTP ${response.status}. Retrieval is INCOMPLETE, not zero issues. Retry-After: ${response.headers.get('retry-after') || 'not supplied'}`);
      const data = await response.json();
      if (config.errorPath && getPath(data, config.errorPath)) throw new Error('Configured error field is populated. Inspect the real response securely.');
      if (config.availabilityPath) {
        const availability = getPath(data, config.availabilityPath);
        if (!Array.isArray(config.availableValues) || !config.availableValues.includes(availability)) throw new Error(`Observability data is unavailable, expired, or its status is unrecognized: ${String(availability)}`);
        report.dataAvailabilityVerified = true;
      }
      const items = getPath(data, config.itemsPath);
      const next = getPath(data, config.nextCursorPath);
      if (!Array.isArray(items)) throw new Error(`itemsPath '${config.itemsPath}' did not resolve to an array.`);
      if (next === undefined) throw new Error(`nextCursorPath '${config.nextCursorPath}' is missing. Refusing to assume the last page.`);
      if (next !== null && next !== '' && !['string', 'number'].includes(typeof next)) throw new Error('Next cursor must be null, empty string, string, or number. Configure the nested scalar cursor path.');
      if (items.length > limit) report.anomalies.push(`Page ${n} exceeds requested limit: ${items.length} > ${limit}`);
      if (!items.length && next !== null && next !== '') report.anomalies.push(`Page ${n} is empty but has a continuation cursor`);
      for (const item of items) {
        const row = {};
        for (const [key, path] of Object.entries(fields)) {
          const value = getPath(item, path);
          if (value === undefined && key !== 'http_status_code') throw new Error(`Mapped field '${key}' missing at '${path}'. Update the adapter rather than silently dropping it.`);
          row[key] = value === undefined ? null : value;
        }
        if (typeof row.url !== 'string' || !/^https?:\/\//.test(row.url)) throw new Error('Returned issue URL must be an absolute HTTP(S) URL. Adjust the adapter if necessary.');
        if (row.http_status_code !== null) {
          row.http_status_code = Number(row.http_status_code);
          if (!Number.isInteger(row.http_status_code)) throw new Error('Invalid HTTP status field');
        }
        report.records.push(row);
      }
      report.pages.push({ page: n, count: items.length, latencyMs: Math.round(performance.now() - pageStart), hasNext: next !== null && next !== '' });
      report.peakRssBytes = Math.max(report.peakRssBytes, process.memoryUsage().rss);
      if (next === null || next === '') { report.collectionComplete = true; break; }
      const key = String(next);
      if (cursors.has(key)) throw new Error('Repeated cursor detected. Pagination would loop.');
      cursors.add(key); cursor = next;
    }
    if (!report.collectionComplete) throw new Error('maxPages reached before a terminal cursor. Retrieval is incomplete.');
  } catch (error) { report.error = error.message; }
  report.finishedAt = new Date().toISOString();
  report.totalRetrievalMs = Math.round(performance.now() - start);
  report.totalRecords = report.records.length;
  return report;
}

export function evaluate(report, oracle) {
  const byUrl = new Map();
  const duplicates = [];
  const filterViolations = [];
  for (const row of report.records) {
    if (byUrl.has(row.url)) duplicates.push(row.url);
    byUrl.set(row.url, row);
    for (const [key, value] of Object.entries(report.filter)) {
      const match = key === 'url_search' ? row.url.includes(String(value)) : String(row[key]) === String(value);
      if (!match) filterViolations.push({ url: row.url, filter: key, expected: value, actual: key === 'url_search' ? row.url : row[key] });
    }
  }
  report.duplicateUrls = [...new Set(duplicates)];
  report.filterViolations = filterViolations;
  report.uniqueUrls = byUrl.size;
  if (oracle) {
    for (const key of ['required', 'forbidden', 'conditional']) if (!Array.isArray(oracle[key])) throw new Error(`Oracle must contain ${key} array`);
    // A filtered response must not be compared with an unfiltered oracle or vice versa.
    const keys = new Set([...Object.keys(oracle.filter || {}), ...Object.keys(report.filter || {})]);
    for (const key of keys) if (String(oracle.filter?.[key]) !== String(report.filter?.[key])) throw new Error(`Oracle/API filter mismatch for ${key}. Create an oracle for exactly this query.`);
    const required = new Map(oracle.required.map(row => [row.url, row]));
    const forbidden = new Set(oracle.forbidden.map(row => row.url));
    const conditional = new Set(oracle.conditional.map(row => row.url));
    report.missingUrls = [...required.keys()].filter(url => !byUrl.has(url));
    report.forbiddenUrls = [...byUrl.keys()].filter(url => forbidden.has(url));
    report.unexpectedUrls = [...byUrl.keys()].filter(url => !required.has(url) && !forbidden.has(url) && !conditional.has(url));
    report.unresolvedConditionalUrls = [...conditional];
    report.outcomeMismatches = [];
    for (const [url, expected] of required) {
      const actual = byUrl.get(url);
      if (!actual) continue;
      for (const key of ['http_status_code', 'issue_code', 'pipeline_stage', 'result']) {
        if (Object.hasOwn(expected, key) && String(expected[key]) !== String(actual[key])) report.outcomeMismatches.push({ url, field: key, expected: expected[key], actual: actual[key] });
      }
    }
  }
  const fail = report.duplicateUrls.length || report.filterViolations.length || report.anomalies.length || report.missingUrls?.length || report.forbiddenUrls?.length || report.unexpectedUrls?.length || report.outcomeMismatches?.length;
  report.result = !report.collectionComplete ? 'INCOMPLETE' : fail ? 'FAIL' : !report.dataAvailabilityVerified || !oracle || report.unresolvedConditionalUrls?.length ? 'NEEDS_REVIEW' : 'PASS';
  return report;
}

if (isMain(import.meta.url)) {
  let report;
  let output = 'reports/issues.json';
  try {
    const options = args(); output = options.out || output;
    if (!options.config) throw new Error('Usage: npm run check:issues -- --config examples/issues-config.local.json --expected reports/expected.json --out reports/issues.json');
    const config = await readJson(options.config);
    report = await collectIssues(config, { availabilityConfirmed: options['availability-confirmed'] === true });
    evaluate(report, options.expected ? await readJson(options.expected) : null);
    await writeJson(output, report);
    console.log(JSON.stringify({ result: report.result, collectionComplete: report.collectionComplete, dataAvailabilityVerified: report.dataAvailabilityVerified, pages: report.pages.length, totalRecords: report.totalRecords, uniqueUrls: report.uniqueUrls, duplicates: report.duplicateUrls.length, missing: report.missingUrls?.length, unexpected: report.unexpectedUrls?.length, unresolved: report.unresolvedConditionalUrls?.length, totalRetrievalMs: report.totalRetrievalMs, report: output, error: report.error }, null, 2));
    process.exitCode = report.result === 'PASS' ? 0 : report.result === 'NEEDS_REVIEW' ? 2 : 1;
  } catch (error) {
    report ||= { schema: 'qa-issue-report/v1', records: [], pages: [], collectionComplete: false };
    report.result = 'INCOMPLETE'; report.error = error.message;
    await writeJson(output, report); console.error(error.message); process.exitCode = 1;
  }
}
