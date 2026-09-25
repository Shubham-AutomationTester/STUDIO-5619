import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export function args(argv = process.argv.slice(2)) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return result;
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
export function getPath(value, path) {
  if (path === '' || path === '$') return value;
  if (typeof path !== 'string') return undefined;
  return path.split('.').reduce((item, key) => item === null || item === undefined ? undefined : item[key], value);
}
export function absoluteBase(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--base must be an HTTP(S) origin without a path or credentials');
  return url.origin;
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function positiveInteger(value, fallback, max = 100000) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`Expected positive integer no greater than ${max}`);
  return number;
}
export function isMain(metaUrl) { return process.argv[1] && fileURLToPath(metaUrl) === process.argv[1]; }
