import { args, readJson, writeJson, isMain } from './common.mjs';
const fields = ['url', 'result', 'issue_code', 'pipeline_stage', 'http_status_code'];
export function compareProviders(left, right) {
  for (const report of [left, right]) {
    if (!report.collectionComplete || !report.dataAvailabilityVerified) throw new Error('Both collections must be complete with availability verified. Missing data cannot pass parity.');
    if (!Array.isArray(report.records)) throw new Error('Input is not an issue collection report');
  }
  const filterKeys = new Set([...Object.keys(left.filter || {}), ...Object.keys(right.filter || {})]);
  for (const key of filterKeys) if (String(left.filter?.[key]) !== String(right.filter?.[key])) throw new Error(`Providers used different ${key} filters`);
  const key = row => JSON.stringify(fields.map(field => row[field] ?? null));
  const a = new Set(left.records.map(key)), b = new Set(right.records.map(key));
  const leftOnly = [...a].filter(value => !b.has(value)).map(JSON.parse);
  const rightOnly = [...b].filter(value => !a.has(value)).map(JSON.parse);
  const duplicateUrls = report => report.records.length - new Set(report.records.map(row => row.url)).size;
  const equal = !leftOnly.length && !rightOnly.length && !duplicateUrls(left) && !duplicateUrls(right);
  return { result: equal ? 'PARITY_ONLY_PASS' : 'FAIL', comparedFields: fields, leftCount: left.records.length, rightCount: right.records.length,
    leftOnly, rightOnly, leftDuplicateUrls: duplicateUrls(left), rightDuplicateUrls: duplicateUrls(right),
    bothOraclesPassed: left.result === 'PASS' && right.result === 'PASS',
    warning: 'Parity alone is not correctness: both providers can omit the same events. Validate each against the oracle and prove the input events are equivalent.' };
}
if (isMain(import.meta.url)) {
  try {
    const options = args();
    if (!options.left || !options.right) throw new Error('Usage: npm run compare:providers -- --left reports/default.json --right reports/datadog.json --out reports/parity.json');
    const result = compareProviders(await readJson(options.left), await readJson(options.right));
    const output = options.out || 'reports/parity.json'; await writeJson(output, result);
    console.log(JSON.stringify({ ...result, leftOnly: result.leftOnly.length, rightOnly: result.rightOnly.length, report: output }, null, 2));
    process.exitCode = result.result === 'PARITY_ONLY_PASS' ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
