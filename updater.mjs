import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { appDir, installedViaNpm, isPackaged, readAsset } from './paths.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = { checkUpdates: true, autoUpdate: false };

export function currentVersion() {
  if (process.env.STUDIO_BRIDGE_TEST_VERSION) return process.env.STUDIO_BRIDGE_TEST_VERSION;
  try {
    return JSON.parse(readAsset('package.json')).version;
  } catch {
    return 'unknown';
  }
}

export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

export function releaseFeed() {
  if (process.env.STUDIO_BRIDGE_RELEASES_URL) return { url: process.env.STUDIO_BRIDGE_RELEASES_URL, overridden: true };
  let repository = '';
  try {
    const value = JSON.parse(readAsset('package.json')).repository;
    repository = typeof value === 'string' ? value : value && value.url;
  } catch {
    repository = '';
  }
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(repository || '');
  if (!match) throw new Error('this build does not know where its releases are published');
  return { url: `https://api.github.com/repos/${match[1]}/releases/latest`, overridden: false };
}

function trustedUrl(url, feed) {
  const parsed = new URL(url);
  if (feed.overridden) return parsed.origin === new URL(feed.url).origin;
  return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com') || parsed.hostname.endsWith('.githubusercontent.com'));
}

export async function latestRelease() {
  const feed = releaseFeed();
  const response = await fetch(feed.url, { headers: { 'User-Agent': 'studio-bridge', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return { feed, none: true };
  if (!response.ok) throw new Error(`the release feed answered HTTP ${response.status}`);
  const data = await response.json();
  const tag = String(data.tag_name || '');
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const exe = assets.find((asset) => /^studio-bridge-.*\.exe$/.test(asset.name));
  const sums = assets.find((asset) => asset.name === 'SHA256SUMS.txt');
  return { feed, tag, version: tag.replace(/^v/, ''), exe, sums };
}

async function download(url, file, feed) {
  if (!trustedUrl(url, feed)) throw new Error(`refusing to download from ${new URL(url).origin}`);
  const response = await fetch(url, { headers: { 'User-Agent': 'studio-bridge' }, signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
  const hash = crypto.createHash('sha256');
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(file),
  );
  return hash.digest('hex');
}

function expectedHash(sumsText, fileName) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match && match[2] === fileName) return match[1].toLowerCase();
  }
  return null;
}

export function updateMode() {
  const forced = process.env.STUDIO_BRIDGE_INSTALL_MODE;
  if (['exe', 'npm', 'source'].includes(forced)) return forced;
  return isPackaged ? 'exe' : installedViaNpm ? 'npm' : 'source';
}

function packageName() {
  try {
    return JSON.parse(readAsset('package.json')).name;
  } catch {
    return 'studio-bridge';
  }
}

async function latestNpmVersion() {
  const base = (process.env.STUDIO_BRIDGE_NPM_REGISTRY_URL || 'https://registry.npmjs.org').replace(/\/$/, '');
  const name = packageName();
  const response = await fetch(`${base}/${name.replace('/', '%2F')}/latest`, { headers: { 'User-Agent': 'studio-bridge', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return { mode: 'npm', none: true };
  if (!response.ok) throw new Error(`the npm registry answered HTTP ${response.status}`);
  const data = await response.json();
  const version = String(data.version || '');
  return { mode: 'npm', name, tag: `v${version}`, version };
}

export async function latestUpdate() {
  const mode = updateMode();
  if (mode === 'npm') return latestNpmVersion();
  return { mode, ...(await latestRelease()) };
}

function runProcess(file, args, shell = false) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (err) => resolve({ status: 1, output: String(err.message) }));
    child.on('close', (status) => resolve({ status, output }));
  });
}

async function applyNpm(info, installArgs, log) {
  const command = process.env.STUDIO_BRIDGE_NPM_COMMAND || 'npm';
  const line = `${command} install -g ${info.name}@${info.version}`;
  log(`Running: ${line}`);
  const installedPackage = await runProcess(line, [], true);
  if (installedPackage.status !== 0) throw new Error(`npm could not install the update: ${installedPackage.output.trim().split('\n').slice(-3).join(' | ')}`);
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
  const refreshed = await runProcess(process.execPath, [cli, 'install', ...installArgs]);
  if (refreshed.status !== 0) throw new Error(`The new version's installer failed: ${refreshed.output.trim().split('\n').slice(-3).join(' | ')}`);
  return refreshed.output;
}

export async function stageRelease(release, log = () => {}) {
  if (!release.exe || !release.sums) throw new Error('The release does not include both the exe and SHA256SUMS.txt, so nothing was changed.');
  const folder = path.join(appDir, 'update');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  try {
    const sumsFile = path.join(folder, 'SHA256SUMS.txt');
    await download(release.sums.browser_download_url, sumsFile, release.feed);
    const expected = expectedHash(fs.readFileSync(sumsFile, 'utf8'), release.exe.name);
    if (!expected) throw new Error(`SHA256SUMS.txt has no entry for ${release.exe.name}, so nothing was changed.`);
    const exeFile = path.join(folder, release.exe.name);
    log(`Downloading ${release.exe.name} ...`);
    const actual = await download(release.exe.browser_download_url, exeFile, release.feed);
    if (actual !== expected) throw new Error(`The download does not match its published checksum (expected ${expected}, got ${actual}). Nothing was changed.`);
    log('Checksum matches.');
    return { folder, exeFile };
  } catch (err) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw err;
  }
}

export function runInstall(exeFile, args) {
  return new Promise((resolve) => {
    const child = spawn(exeFile, ['install', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (err) => resolve({ status: 1, output: String(err.message) }));
    child.on('close', (status) => resolve({ status, output }));
  });
}

export async function applyRelease(release, installArgs = [], log = () => {}) {
  if (release.mode === 'npm') return applyNpm(release, installArgs, log);
  const staged = await stageRelease(release, log);
  try {
    const installed = await runInstall(staged.exeFile, installArgs);
    if (installed.status !== 0) throw new Error(`The new version's installer failed: ${installed.output.trim().split('\n').slice(-3).join(' | ')}`);
    return installed.output;
  } finally {
    fs.rmSync(staged.folder, { recursive: true, force: true });
  }
}

const settingsPath = () => path.join(appDir, 'settings.json');

export function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(changes) {
  const next = { ...loadSettings(), ...changes };
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

const cachePath = () => path.join(appDir, 'update-check.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

export async function checkForUpdate({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && typeof cached.checkedAt === 'number' && Date.now() - cached.checkedAt < DAY_MS && cached.tag) {
    return { tag: cached.tag, version: cached.tag.replace(/^v/, ''), newer: isNewer(cached.tag, currentVersion()), cached: true };
  }
  const release = await latestUpdate();
  if (release.none) return { none: true, newer: false };
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify({ checkedAt: Date.now(), tag: release.tag }) + '\n');
  return { release, tag: release.tag, version: release.version, newer: isNewer(release.tag, currentVersion()), cached: false };
}
