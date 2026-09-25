import { configuration, makeCatalog, selectProfile, infrastructurePaths } from '../lib/catalog.mjs';
import { args, absoluteBase, readJson, writeJson } from './common.mjs';

try {
  const options = args();
  if (!options.base) throw new Error('Usage: npm run export:expected -- --base https://YOUR-SERVICE.onrender.com --profile mixed --out reports/expected.json');
  const base = absoluteBase(options.base);
  const profile = options.profile || 'mixed';
  const cfg = configuration({ ...process.env, ...(options['issues-per-status'] ? { ISSUES_PER_STATUS: options['issues-per-status'] } : {}) });
  const catalog = makeCatalog(cfg);
  const rows = selectProfile(catalog, profile);
  const resolutions = options.resolve ? await readJson(options.resolve) : {};
  const known = new Set(rows.map(row => row.path));
  for (const [path, resolution] of Object.entries(resolutions)) {
    if (!known.has(path)) throw new Error(`Resolution path is not in profile: ${path}`);
    if (!['required', 'forbidden'].includes(resolution.expectation)) throw new Error(`Resolution needs expectation required/forbidden: ${path}`);
    if (!resolution.reason || typeof resolution.reason !== 'string') throw new Error(`Resolution needs documented reason: ${path}`);
  }
  const filter = {};
  if (options.status) filter.http_status_code = Number(options.status);
  if (options.search) filter.url_search = options.search;
  if (options.status && (!Number.isInteger(filter.http_status_code) || filter.http_status_code < 100 || filter.http_status_code > 599)) throw new Error('Invalid --status');
  const filtered = Object.keys(filter).length > 0;
  const output = {
    schema: 'qa-issue-oracle/v1', baseUrl: base, profile, issuesPerStatus: cfg.issuesPerStatus, filter,
    required: [], forbidden: [], conditional: [],
    preconditions: ['Finish the real crawl and let issue ingestion settle.', 'All required fixture URLs must have been discovered and attempted.', 'Verify that baseline documents actually parsed and indexed.', 'Use the matching fixture count and crawler configuration.'],
    warning: 'Conditional cases prevent a full PASS until resolved from configuration and documented platform behavior. Resolutions are not derived from the returned issues list.'
  };
  for (const row of rows) {
    const resolution = resolutions[row.path];
    const record = { url: base + row.path, path: row.path, group: row.group, note: resolution?.reason || row.note };
    const expectation = resolution?.expectation || row.expectation;
    // Only permanent failures have a guaranteed final HTTP status. Do not guess retry/redirect final status.
    if (row.kind === 'http-error') record.http_status_code = row.status;
    if (resolution?.http_status_code !== undefined) record.http_status_code = resolution.http_status_code;
    for (const field of ['issue_code', 'pipeline_stage', 'result']) if (resolution?.[field] !== undefined) record[field] = resolution[field];
    if (filtered) {
      if (filter.url_search && !record.url.includes(filter.url_search)) { output.forbidden.push(record); continue; }
      if (filter.http_status_code !== undefined) {
        if (expectation === 'forbidden' || (record.http_status_code !== undefined && record.http_status_code !== filter.http_status_code)) { output.forbidden.push(record); continue; }
        if (record.http_status_code === undefined) { output.conditional.push(record); continue; }
      }
    }
    output[expectation].push(record);
  }
  for (const path of infrastructurePaths(catalog, profile)) output.forbidden.push({ url: base + path, path, group: 'navigation', note: 'Successful discovery/navigation page, not a customer issue.' });
  output.counts = { required: output.required.length, forbidden: output.forbidden.length, conditional: output.conditional.length };
  const path = options.out || 'reports/expected.json';
  await writeJson(path, output);
  console.log(JSON.stringify({ output: path, profile, ...output.counts, note: filtered ? 'Use matching endpoint filters.' : output.warning }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
