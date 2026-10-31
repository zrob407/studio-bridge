import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRO_PURCHASE_URL, activate, maskKey, openPurchasePage, proPurchaseUrl, proServerUrl, remove, status } from '../pro.mjs';
import { executableFiles, hashFile, signedMessage } from '../trust.mjs';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-test-'));
const proKey = crypto.generateKeyPairSync('ed25519');
const freeKey = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const spki = (pair) => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const keys = { 1: { tier: 'official', key: spki(freeKey) }, 'pro-1': { tier: 'pro', key: spki(proKey) } };
const KEY = 'LICENSE-KEY-FOR-TESTS-1234';

function stubFor(name, { signWith = proKey, keyId = 'pro-1', mutate = null, title = `Pack ${name}`, signed = true } = {}) {
  const folder = fs.mkdtempSync(path.join(sandbox, 'stub-'));
  const files = { 'main.mjs': 'export const tools = {};', 'client.mjs': 'export const client = 1;', 'config.mjs': 'export const packName = "x";' };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, file), text);
  const manifest = { name, version: '1.0.0', title, tools: [{ name: `${name}_tool`, description: 'A tool.', inputSchema: { type: 'object' }, server: true }] };
  if (signed) {
    const covered = executableFiles(folder);
    const hashes = Object.fromEntries(covered.map((file) => [file, hashFile(path.join(folder, file))]));
    manifest.signature = { keyId, files: covered, value: crypto.sign(null, Buffer.from(signedMessage(manifest, hashes)), signWith.privateKey).toString('base64url') };
  }
  const result = { name, version: '1.0.0', stub: 'h', files: { ...files, 'pack.json': JSON.stringify(manifest) } };
  if (mutate) mutate(result);
  return result;
}

let scenario;
const calls = [];
const fetchImpl = async (url, init) => {
  const route = new URL(url).pathname;
  const body = JSON.parse(init.body);
  calls.push({ route, body });
  const reply = (status, data) => new Response(JSON.stringify(data), { status });
  if (scenario.network) throw new Error(scenario.network);
  if (route === '/v1/session') return scenario.session ? scenario.session(body) : reply(200, { token: 'payload.signature', plan: 'lifetime' });
  if (route === '/v1/stubs') return scenario.stubs ? scenario.stubs(body) : reply(200, { packs: [stubFor('demo')] });
  if (route === '/v1/release') return scenario.release ? scenario.release(body) : reply(200, { ok: true, released: true });
  return reply(404, {});
};
const run = (extra = {}) => activate({ key: KEY, appDir: appDir(), fetchImpl, keys, env: { STUDIO_BRIDGE_PRO_URL: 'https://license.example.test/' }, ...extra });
let counter = 0;
const appDir = () => {
  const dir = path.join(sandbox, `app-${counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const fresh = () => {
  counter++;
  scenario = {};
  calls.length = 0;
  return appDir();
};
const packs = (dir) => path.join(dir, 'packs');
const nothingInstalled = (dir) => !fs.existsSync(path.join(packs(dir), 'license.key')) && !fs.existsSync(path.join(packs(dir), 'demo')) && (!fs.existsSync(packs(dir)) || fs.readdirSync(packs(dir)).every((name) => !name.startsWith('.installing') && name !== 'demo'));

check('the server address can be overridden and has no trailing slash', proServerUrl({ STUDIO_BRIDGE_PRO_URL: 'http://127.0.0.1:9/' }) === 'http://127.0.0.1:9' && proServerUrl({}).startsWith('https://'));
check('keys are masked for display', maskKey('ABCDEFGHIJKLMNOP') === 'ABCD...MNOP' && maskKey('short') === '****');

let dir = fresh();
for (const bad of ['', 'abc', 'has a space in it', 'x'.repeat(300), 42, null]) {
  const result = await activate({ key: bad, appDir: dir, fetchImpl, keys });
  if (!(result.ok === false && /does not look like a license key/.test(result.message))) check(`a key that is ${JSON.stringify(bad)} is refused before any request`, false);
}
check('bad key shapes are refused before any network request', calls.length === 0 && nothingInstalled(dir));

dir = fresh();
let result = await run({ appDir: dir });
check('a valid activation installs the pack and saves the key', result.ok === true && result.installed[0].name === 'demo' && result.installed[0].trust === 'pro' && fs.readFileSync(path.join(packs(dir), 'license.key'), 'utf8') === KEY);
check('it asks the session endpoint for activation only, with a device, and sends no old state', calls[0].route === '/v1/session' && calls[0].body.bundles === false && typeof calls[0].body.device.id === 'string' && calls[0].body.device.id.length >= 8 && calls[0].body.key === KEY);
check('then fetches the launchers with the session token, never the key', calls[1].route === '/v1/stubs' && calls[1].body.token === 'payload.signature' && !JSON.stringify(calls[1].body).includes(KEY));
check('the installed folder holds exactly the launcher files', fs.readdirSync(path.join(packs(dir), 'demo')).sort().join() === 'client.mjs,config.mjs,main.mjs,pack.json');
check('the result never contains the key', !JSON.stringify(result).includes(KEY));
check('the device id file is created once and reused', fs.existsSync(path.join(packs(dir), 'license-device.json')));
const deviceBefore = fs.readFileSync(path.join(packs(dir), 'license-device.json'), 'utf8');
await run({ appDir: dir });
check('and stays the same on a second activation', fs.readFileSync(path.join(packs(dir), 'license-device.json'), 'utf8') === deviceBefore);
check('no temporary or aside folders are left behind', fs.readdirSync(packs(dir)).every((name) => !name.startsWith('.installing') && !name.includes('.old-')));
const current = status({ appDir: dir, keys });
check('status shows the masked key, the plan and the pack as official Pro', current.hasKey && current.maskedKey === maskKey(KEY) && current.plan === 'lifetime' && current.packs.length === 1 && current.packs[0].trust === 'pro');
check('status never exposes the key', !JSON.stringify(current).includes(KEY));

fs.writeFileSync(path.join(packs(dir), 'demo', 'main.mjs'), 'export const tools = { changed: 1 };');
await run({ appDir: dir });
check('activating again replaces an edited copy with the signed one', fs.readFileSync(path.join(packs(dir), 'demo', 'main.mjs'), 'utf8') === 'export const tools = {};');

dir = fresh();
scenario.network = 'getaddrinfo ENOTFOUND';
result = await run({ appDir: dir });
check('an unreachable server gives a clear message and installs nothing', result.ok === false && /Could not reach the license server/.test(result.message) && nothingInstalled(dir));

dir = fresh();
scenario.session = () => new Response('{}', { status: 503 });
result = await run({ appDir: dir });
check('a busy server says to wait and installs nothing', result.ok === false && /busy/.test(result.message) && nothingInstalled(dir));

dir = fresh();
scenario.session = () => new Response(JSON.stringify({ error: 'key_unknown', message: 'This license key was not recognized.' }), { status: 403 });
result = await run({ appDir: dir });
check('a refusal shows the server message and installs nothing', result.ok === false && result.message === 'This license key was not recognized.' && calls.length === 1 && nothingInstalled(dir));

dir = fresh();
scenario.session = () => new Response(JSON.stringify({ error: 'blocked', message: 'Too many failed license attempts.' }), { status: 403 });
result = await run({ appDir: dir });
check('a block message is passed on untouched', result.message === 'Too many failed license attempts.');

dir = fresh();
scenario.stubs = () => new Response('{}', { status: 401 });
result = await run({ appDir: dir });
check('a failed launcher download installs nothing and saves no key', result.ok === false && /could not provide/.test(result.message) && nothingInstalled(dir));

dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [] }), { status: 200 });
result = await run({ appDir: dir });
check('a valid license with nothing to install says so', result.ok === false && /no Pro packs available/.test(result.message) && nothingInstalled(dir));

const attacks = {
  'a launcher edited after signing': (stub) => {
    stub.files['main.mjs'] += '\n// injected';
  },
  'an extra script': (stub) => {
    stub.files['evil.mjs'] = 'export const x = 1;';
  },
  'a path that leaves the folder': (stub) => {
    stub.files['../escape.mjs'] = 'x';
  },
  'a nested handler path': (stub) => {
    stub.files['handlers/../../x.luau'] = 'x';
  },
  'a file with a drive letter': (stub) => {
    stub.files['C:/windows/x.mjs'] = 'x';
  },
  'an oversized file': (stub) => {
    stub.files['main.mjs'] = 'x'.repeat(1024 * 1024 + 1);
  },
  'a non-text file body': (stub) => {
    stub.files['main.mjs'] = 12345;
  },
  'a pack whose manifest name differs from its folder name': (stub) => {
    stub.name = 'other';
  },
  'a pack name that tries to escape': (stub) => {
    stub.name = '../elsewhere';
  },
};
for (const [label, mutate] of Object.entries(attacks)) {
  dir = fresh();
  scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { mutate })] }), { status: 200 });
  result = await run({ appDir: dir });
  check(`${label} is refused and nothing is installed or saved`, result.ok === false && nothingInstalled(dir) && !fs.existsSync(path.join(dir, 'elsewhere')) && !fs.existsSync(path.join(dir, 'escape.mjs')), result.message);
}

dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { signWith: stranger })] }), { status: 200 });
result = await run({ appDir: dir });
check('a launcher signed with a stranger\'s key is refused', result.ok === false && /signature check/.test(result.message) && nothingInstalled(dir));
dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { signed: false })] }), { status: 200 });
result = await run({ appDir: dir });
check('an unsigned launcher is refused', result.ok === false && /signature check/.test(result.message) && nothingInstalled(dir));
dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { signWith: freeKey, keyId: 'pro-1' })] }), { status: 200 });
result = await run({ appDir: dir });
check('the free key cannot sign as the paid tier', result.ok === false && nothingInstalled(dir));
dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { signWith: freeKey, keyId: '1' })] }), { status: 200 });
result = await run({ appDir: dir });
check('a launcher signed with the free official key is accepted as official', result.ok === true && result.installed[0].trust === 'official');

dir = fresh();
await run({ appDir: dir });
const goodMain = fs.readFileSync(path.join(packs(dir), 'demo', 'main.mjs'), 'utf8');
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('demo', { mutate: (stub) => { stub.files['main.mjs'] += '//x'; } })] }), { status: 200 });
result = await run({ appDir: dir });
check('a refused update leaves the existing working install exactly as it was', result.ok === false && fs.readFileSync(path.join(packs(dir), 'demo', 'main.mjs'), 'utf8') === goodMain && fs.readFileSync(path.join(packs(dir), 'license.key'), 'utf8') === KEY);

dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('alpha'), stubFor('demo', { mutate: (stub) => { stub.files['main.mjs'] += '//x'; } })] }), { status: 200 });
result = await run({ appDir: dir });
check('if one of several packs fails, none of them is installed', result.ok === false && !fs.existsSync(path.join(packs(dir), 'alpha')) && !fs.existsSync(path.join(packs(dir), 'license.key')));

dir = fresh();
scenario.stubs = () => new Response(JSON.stringify({ packs: [stubFor('alpha'), stubFor('demo')] }), { status: 200 });
result = await run({ appDir: dir });
check('several valid packs install together', result.ok === true && result.installed.map((entry) => entry.name).join() === 'alpha,demo');

dir = fresh();
await run({ appDir: dir });
const freePack = stubFor('freebie', { signWith: freeKey, keyId: '1' });
const unsignedPack = stubFor('community', { signed: false });
for (const entry of [freePack, unsignedPack]) {
  const folder = path.join(packs(dir), entry.name);
  fs.mkdirSync(folder, { recursive: true });
  for (const [file, text] of Object.entries(entry.files)) fs.writeFileSync(path.join(folder, file), text);
}
calls.length = 0;
result = await remove({ appDir: dir, fetchImpl, keys, env: { STUDIO_BRIDGE_PRO_URL: 'https://license.example.test' } });
check('removing frees the device slot using the stored device id and key', result.ok === true && result.released === true && calls.length === 1 && calls[0].route === '/v1/release' && calls[0].body.key === KEY && calls[0].body.device.id.length >= 8);
check('and deletes the paid pack, the key and the saved license files', !fs.existsSync(path.join(packs(dir), 'demo')) && !fs.existsSync(path.join(packs(dir), 'license.key')) && !fs.existsSync(path.join(packs(dir), 'license-info.json')));
check('but leaves free official packs and other people\'s packs alone', fs.existsSync(path.join(packs(dir), 'freebie')) && fs.existsSync(path.join(packs(dir), 'community')));

dir = fresh();
await run({ appDir: dir });
scenario.network = 'offline';
result = await remove({ appDir: dir, fetchImpl, keys, env: { STUDIO_BRIDGE_PRO_URL: 'https://license.example.test' } });
check('removing works offline too, and says the device slot must be freed by hand', result.ok === true && result.released === false && /Polar purchases page/.test(result.message) && !fs.existsSync(path.join(packs(dir), 'license.key')) && !fs.existsSync(path.join(packs(dir), 'demo')));

dir = fresh();
result = await remove({ appDir: dir, fetchImpl, keys });
check('removing when nothing is installed is harmless', result.ok === true && calls.length === 0);
check('status on an empty folder is clean', status({ appDir: fresh(), keys }).hasKey === false);

const launched = [];
const fakeLaunch = (command, args) => {
  launched.push([command, ...args]);
  return { on() {}, unref() {} };
};
const buyWindows = openPurchasePage({ platform: 'win32', env: {}, launch: fakeLaunch });
const buyMac = openPurchasePage({ platform: 'darwin', env: {}, launch: fakeLaunch });
const buyLinux = openPurchasePage({ platform: 'linux', env: {}, launch: fakeLaunch });
check('the buy button opens the checkout page with the right program on each system', launched[0].join(' ') === `rundll32 url.dll,FileProtocolHandler ${PRO_PURCHASE_URL}` && launched[1].join(' ') === `open ${PRO_PURCHASE_URL}` && launched[2].join(' ') === `xdg-open ${PRO_PURCHASE_URL}`);
check('and the answer always carries the link as a fallback', [buyWindows, buyMac, buyLinux].every((entry) => entry.ok && entry.message.includes(PRO_PURCHASE_URL) && entry.url === PRO_PURCHASE_URL));
check('the checkout link is a polar checkout address and can be overridden for tests', /^https:\/\/buy\.polar\.sh\//.test(PRO_PURCHASE_URL) && proPurchaseUrl({ STUDIO_BRIDGE_PRO_BUY_URL: 'https://x.test/y' }) === 'https://x.test/y');
const before = launched.length;
const quiet = openPurchasePage({ platform: 'win32', env: { STUDIO_BRIDGE_NO_BROWSER: '1' }, launch: fakeLaunch });
check('with browser launching switched off nothing starts but the link is returned', quiet.ok && launched.length === before && quiet.message.includes(PRO_PURCHASE_URL));
const broken = openPurchasePage({ platform: 'linux', env: {}, launch: () => { throw new Error('no xdg-open'); } });
check('if no browser can be started it says so and still gives the link', broken.ok === false && broken.message.includes(PRO_PURCHASE_URL));

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
