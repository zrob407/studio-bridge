import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packsDir } from './packs.mjs';
import { OFFICIAL_KEYS, isSigned, verifyPack } from './trust.mjs';

export const PRO_SERVER_URL = 'https://studio-bridge-license.studio-bridge.workers.dev';

const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const FILE = /^(pack\.json|main\.mjs|client\.mjs|config\.mjs|handlers\/[A-Za-z0-9][A-Za-z0-9_.-]*\.luau)$/;
const MAX_FILE_CHARS = 1024 * 1024;
const SESSION_FILES = ['license.key', 'license-session.json', 'license-info.json', 'license-block.json', 'license-incidents.json'];

export const PRO_PURCHASE_URL = 'https://buy.polar.sh/polar_cl_5c8YQvxi93De84kvcyfDl0CkAtxiYMb6dnDR61HbTDI';

export const proPurchaseUrl = (env = process.env) => String(env.STUDIO_BRIDGE_PRO_BUY_URL || PRO_PURCHASE_URL);

export function openPurchasePage({ platform = process.platform, env = process.env, launch = spawn } = {}) {
  const url = proPurchaseUrl(env);
  if (env.STUDIO_BRIDGE_NO_BROWSER === '1') return { ok: true, url, message: `Open this page to buy a license: ${url}` };
  const [command, args] = platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = launch(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return { ok: true, url, message: `Opened the license page in your browser. If nothing appeared, open this link: ${url}` };
  } catch {
    return { ok: false, url, message: `Could not open a browser. Open this link to buy a license: ${url}` };
  }
}

export const proServerUrl = (env = process.env) => String(env.STUDIO_BRIDGE_PRO_URL || PRO_SERVER_URL).replace(/\/+$/, '');

const fail = (message) => ({ ok: false, message });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readKey(root) {
  try {
    return fs.readFileSync(path.join(root, 'license.key'), 'utf8').trim();
  } catch {
    return '';
  }
}

function deviceFor(root) {
  const file = path.join(root, 'license-device.json');
  const saved = readJson(file);
  if (saved && typeof saved.id === 'string' && saved.id.length >= 8) return { id: saved.id, label: os.hostname() };
  const created = { id: crypto.randomUUID() };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(created));
  return { id: created.id, label: os.hostname() };
}

async function post(url, route, body, fetchImpl) {
  const response = await fetchImpl(`${url}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

export const maskKey = (key) => (key.length > 10 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '****');

function installedPacks(root, keys) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const folder = path.join(root, entry.name);
    const manifest = readJson(path.join(folder, 'pack.json'));
    if (!manifest) continue;
    found.push({ name: String(manifest.name || entry.name), title: String(manifest.title || manifest.name || entry.name), version: String(manifest.version || ''), trust: verifyPack(folder, manifest, keys).trust, folder });
  }
  return found;
}

export function status({ appDir, keys = OFFICIAL_KEYS }) {
  const root = packsDir(appDir);
  const key = readKey(root);
  const info = readJson(path.join(root, 'license-info.json')) || {};
  const session = readJson(path.join(root, 'license-session.json'));
  let validUntil = null;
  if (session && typeof session.token === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString('utf8'));
      validUntil = payload.exp ? payload.exp * 1000 : null;
    } catch {
      validUntil = null;
    }
  }
  return {
    hasKey: key !== '',
    maskedKey: key ? maskKey(key) : null,
    plan: info.plan || (session && session.plan) || null,
    activatedAt: info.activatedAt || null,
    sessionValidUntil: validUntil,
    packs: installedPacks(root, keys).map(({ folder, ...rest }) => rest),
  };
}

export async function activate({ key, appDir, fetchImpl = fetch, keys = OFFICIAL_KEYS, env = process.env }) {
  const cleaned = typeof key === 'string' ? key.trim() : '';
  if (cleaned.length < 8 || cleaned.length > 200 || /\s/.test(cleaned)) return fail('That does not look like a license key. Paste it exactly as it was sent to you.');
  const root = packsDir(appDir);
  fs.mkdirSync(root, { recursive: true });
  const url = proServerUrl(env);

  let session;
  try {
    session = await post(url, '/v1/session', { key: cleaned, device: deviceFor(root), have: {}, bundles: false }, fetchImpl);
  } catch (err) {
    return fail(`Could not reach the license server (${err.message}). Check your internet connection and try again.`);
  }
  if (session.status === 429 || session.status >= 500) return fail('The license server is busy right now. Wait a minute and try again.');
  if (session.status !== 200 || !session.data || typeof session.data.token !== 'string') return fail((session.data && session.data.message) || `The license server refused this key (HTTP ${session.status}).`);

  let stubs;
  try {
    stubs = await post(url, '/v1/stubs', { token: session.data.token }, fetchImpl);
  } catch (err) {
    return fail(`Could not download the Pro packs (${err.message}). Try again.`);
  }
  if (stubs.status !== 200 || !stubs.data || !Array.isArray(stubs.data.packs)) return fail('The license server could not provide the Pro packs. Try again shortly.');
  if (stubs.data.packs.length === 0) return fail('Your license is valid, but there are no Pro packs available to install yet.');

  const stage = fs.mkdtempSync(path.join(root, '.installing-'));
  const staged = [];
  try {
    for (const entry of stubs.data.packs) {
      if (!entry || !NAME.test(String(entry.name)) || !entry.files || typeof entry.files !== 'object') return fail('The license server sent a pack in a form that could not be used, so nothing was installed.');
      const folder = path.join(stage, entry.name);
      fs.mkdirSync(folder);
      for (const [file, text] of Object.entries(entry.files)) {
        if (!FILE.test(file) || typeof text !== 'string' || text.length > MAX_FILE_CHARS) return fail(`The pack ${entry.name} contained a file that is not allowed, so nothing was installed.`);
        const target = path.join(folder, ...file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      }
      const manifest = readJson(path.join(folder, 'pack.json'));
      if (!manifest || manifest.name !== entry.name) return fail(`The pack ${entry.name} is missing a valid pack.json, so nothing was installed.`);
      const verdict = verifyPack(folder, manifest, keys);
      if (!isSigned(verdict.trust)) return fail(`The pack ${entry.name} did not pass its signature check, so nothing was installed and your key was not saved.`);
      staged.push({ name: entry.name, folder, version: String(manifest.version || ''), trust: verdict.trust });
    }

    for (const item of staged) {
      const target = path.join(root, item.name);
      const aside = `${target}.old-${Date.now()}`;
      const existed = fs.existsSync(target);
      if (existed) fs.renameSync(target, aside);
      try {
        fs.renameSync(item.folder, target);
      } catch (err) {
        if (existed) fs.renameSync(aside, target);
        return fail(`Could not install the pack ${item.name} (${err.code || err.message}). Close anything using the packs folder and try again.`);
      }
      if (existed) fs.rmSync(aside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(root, 'license.key'), cleaned, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'license-info.json'), JSON.stringify({ plan: session.data.plan || null, activatedAt: Date.now() }));
  fs.rmSync(path.join(root, 'license-block.json'), { force: true });
  return {
    ok: true,
    plan: session.data.plan || null,
    installed: staged.map(({ name, version, trust }) => ({ name, version, trust })),
    message: `License accepted${session.data.plan ? ` (${session.data.plan})` : ''}. Installed ${staged.map((item) => item.name).join(', ')}. The tools are available now.`,
  };
}

export async function remove({ appDir, fetchImpl = fetch, keys = OFFICIAL_KEYS, env = process.env }) {
  const root = packsDir(appDir);
  const key = readKey(root);
  const device = readJson(path.join(root, 'license-device.json'));
  let released = false;
  if (key && device && typeof device.id === 'string') {
    try {
      const result = await post(proServerUrl(env), '/v1/release', { key, device: { id: device.id } }, fetchImpl);
      released = result.status === 200;
    } catch {
      released = false;
    }
  }
  const removedPacks = [];
  for (const pack of installedPacks(root, keys)) {
    if (pack.trust !== 'pro') continue;
    fs.rmSync(pack.folder, { recursive: true, force: true });
    removedPacks.push(pack.name);
  }
  for (const file of SESSION_FILES) fs.rmSync(path.join(root, file), { force: true });
  fs.rmSync(path.join(root, 'license-cache'), { recursive: true, force: true });
  return {
    ok: true,
    released,
    removedPacks,
    message: `License removed from this computer${released ? ' and its device slot was freed' : ''}${removedPacks.length ? `; removed ${removedPacks.join(', ')}` : ''}.${released || !key ? '' : ' The device slot could not be freed automatically; you can free it on your Polar purchases page.'}`,
  };
}
