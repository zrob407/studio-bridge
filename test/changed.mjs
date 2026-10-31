import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(bridgeDir, 'test');

export const rules = [
  { match: /\.md$/i, tests: [] },
  { match: /^\.gitignore$/, tests: [] },
  { match: /^\.github\//, tests: [] },
  { match: /^assets\//, tests: [] },
  { match: /^build\//, tests: [] },
  { match: /^screenshot\.ps1$/, tests: [] },
  { match: /^docs\.mjs$/, tests: ['docs'] },
  { match: /^marketplace\.mjs$/, tests: ['marketplace'] },
  { match: /^checks\.mjs$|^LICENSE$/, tests: ['checks', 'package'] },
  { match: /^(docs\/|build\/site\.mjs$|tools\.json$|pro\.mjs$|README\.md$)/, tests: ['site'] },
  { match: /^updater\.mjs$/, tests: ['update', 'autoupdate', 'npm-update', 'settings', 'cli'] },
  { match: /^ws\.mjs$/, tests: ['ws-transport', 'reliability'] },
  { match: /^platform\.mjs$/, tests: ['platform', 'platform-tools', 'cli', 'package'] },
  { match: /^packs\.mjs$|^trust\.mjs$|^pro\.mjs$/, tests: ['packs', 'trust', 'pro', 'cli', 'package'] },
  { match: /^handlers\/|^plugin\.(stub|template)\./, tests: ['tools', 'plugin', 'package'] },
];

export function allTests() {
  return fs.readdirSync(testDir).filter((name) => name.endsWith('.test.mjs')).map((name) => name.replace(/\.test\.mjs$/, ''));
}

export function selectTests(changed, everything = allTests()) {
  const selected = new Set();
  for (const file of changed) {
    const own = /^test\/(.+)\.test\.mjs$/.exec(file);
    if (own) {
      if (everything.includes(own[1])) selected.add(own[1]);
      continue;
    }
    if (file.startsWith('test/')) return { tests: everything, reason: `${file} is shared test code` };
    const rule = rules.find((candidate) => candidate.match.test(file));
    if (!rule) return { tests: everything, reason: `${file} can affect every test` };
    for (const name of rule.tests) selected.add(name);
  }
  return { tests: everything.filter((name) => selected.has(name)), reason: null };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: bridgeDir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function changedFiles() {
  return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])].map((file) => file.replace(/\\/g, '/'));
}

function main() {
  const everything = allTests();
  const forceAll = process.argv.includes('--all');
  let plan;
  try {
    plan = forceAll ? { tests: everything, reason: '--all was given' } : selectTests(changedFiles(), everything);
  } catch (err) {
    plan = { tests: everything, reason: err.message };
  }
  const skipped = everything.filter((name) => !plan.tests.includes(name));
  if (plan.reason) console.log(`Running every test: ${plan.reason}`);
  console.log(`Running ${plan.tests.length} of ${everything.length} test files${plan.tests.length ? ': ' + plan.tests.join(', ') : ''}`);
  if (skipped.length) console.log(`Skipping ${skipped.length}: ${skipped.join(', ')}`);
  const failed = [];
  for (const name of plan.tests) {
    const result = spawnSync(process.execPath, [path.join('test', `${name}.test.mjs`)], { cwd: bridgeDir, stdio: 'inherit' });
    if (result.status !== 0) failed.push(name);
  }
  if (failed.length) {
    console.log(`FAILED: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('Selected tests passed. Run npm test (all of them) before a release.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
