import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const base = target ? [target] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];
const { LICENSE_SHA256, licenseHash } = await import(pathToFileURL(path.join(bridgeDir, 'license.mjs')).href);
const realLicense = fs.readFileSync(path.join(bridgeDir, 'LICENSE'), 'utf8');

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

check('the built-in reference hash matches the LICENSE in the repository', licenseHash(realLicense) === LICENSE_SHA256);
check('Windows line endings do not count as tampering', licenseHash(realLicense.replace(/\n/g, '\r\n')) === LICENSE_SHA256);
check('trailing spaces, extra final newlines and a BOM do not count either', licenseHash('﻿' + realLicense.replace(/\n/g, '   \n') + '\n\n\n') === LICENSE_SHA256);
check('appending a word is detected', licenseHash(realLicense + ' x') !== LICENSE_SHA256);
check('changing one letter is detected', licenseHash(realLicense.replace('No selling', 'No Selling')) !== LICENSE_SHA256);
check('deleting a clause is detected', licenseHash(realLicense.replace(/2\. No selling[\s\S]*?\n\n/, '')) !== LICENSE_SHA256);
check('an empty file is detected', licenseHash('') !== LICENSE_SHA256);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-license-'));
const localAppData = path.join(sandbox, 'LocalAppData');
fs.mkdirSync(localAppData, { recursive: true });

function makeHome(name, license) {
  const home = path.join(sandbox, name);
  fs.mkdirSync(path.join(home, 'overrides'), { recursive: true });
  if (license !== undefined) fs.writeFileSync(path.join(home, 'overrides', 'LICENSE'), license);
  return home;
}

const token = crypto.randomBytes(16).toString('hex');
const port = 3984;

function startServer(home) {
  const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_OFFLINE: '1' };
  const child = spawn(base[0], [...base.slice(1), 'serve'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const waiters = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const entry = waiters.get(message.id);
    if (entry) {
      waiters.delete(message.id);
      entry(message);
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const stop = async () => {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  };
  return { rpc, stop, ready: sleep(900) };
}

const post = (route) =>
  fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: '{"id":"x","role":"edit"}' }).then(async (response) => ({ status: response.status, body: await response.json() }));

function upgradeStatus() {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.on('connect', () =>
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nX-Bridge-Token: ${token}\r\n\r\n`),
    );
    socket.on('data', (chunk) => {
      data += chunk;
      socket.destroy();
    });
    socket.on('close', () => resolve(Number(data.split(' ')[1])));
    socket.on('error', () => {});
  });
}

const intactHome = makeHome('intact');
const intact = startServer(intactHome);
await intact.ready;
const intactInit = await intact.rpc('initialize', {});
check('an intact copy says nothing about tampering', !/Tampering detected/.test(intactInit.result.instructions || ''));
const intactList = await intact.rpc('tools/call', { name: 'studio_list', arguments: {} });
check('and its tools work', !intactList.result.isError);
check('and it serves the plugin', (await post('/plugin')).status === 200);
await intact.stop();

const tamperedHome = makeHome('tampered', realLicense + '\nCopyright (c) someone else\n');
const locked = startServer(tamperedHome);
await locked.ready;
const lockedInit = await locked.rpc('initialize', {});
check('a tampered copy tells the AI client in the server instructions', /Tampering detected/.test(lockedInit.result.instructions || '') && /not allowed/.test(lockedInit.result.instructions || ''));
const lockedCall = await locked.rpc('tools/call', { name: 'studio_list', arguments: {} });
check('every tool call returns the tampering message as an error', lockedCall.result.isError === true && /Tampering detected/.test(lockedCall.result.content[0].text));
const lockedBatch = await locked.rpc('tools/call', { name: 'run_luau', arguments: { code: 'return 1' } });
check('including tools that would run code in Studio', lockedBatch.result.isError === true && /Tampering detected/.test(lockedBatch.result.content[0].text));
const plugin = await post('/plugin');
check('the plugin is not served', plugin.status === 403 && /Tampering detected/.test(plugin.body.message) && !plugin.body.source);
const poll = await post('/poll');
check('the plugin cannot poll for commands', poll.status === 403);
check('the plugin cannot open the WebSocket', (await upgradeStatus()) === 403);

fs.rmSync(path.join(tamperedHome, 'overrides', 'LICENSE'));
await sleep(5600);
const restored = await locked.rpc('tools/call', { name: 'studio_list', arguments: {} });
check('restoring the original license lifts the lock without a restart', !restored.result.isError && (await post('/plugin')).status === 200);
await locked.stop();

const missingHome = makeHome('missing', '');
const missing = startServer(missingHome);
await missing.ready;
const missingInit = await missing.rpc('initialize', {});
check('an emptied license file is treated as tampering', /Tampering detected/.test(missingInit.result.instructions || ''));
await missing.stop();

const cliEnv = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: tamperedHome, STUDIO_BRIDGE_OFFLINE: '1' };
fs.writeFileSync(path.join(tamperedHome, 'overrides', 'LICENSE'), realLicense.replace('Permission is granted', 'Permission is not granted'));
const runCli = (...args) => {
  const finished = spawnSync(base[0], [...base.slice(1), ...args], { env: cliEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { status: finished.status, out: `${finished.stdout || ''}${finished.stderr || ''}` };
};
const install = runCli('install', '--no-register');
check('install refuses with the tampering message', install.status === 3 && /Tampering detected/.test(install.out));
check('and writes no plugin', !fs.existsSync(path.join(localAppData, 'Roblox', 'Plugins', 'Studio Bridge.rbxmx')));
const update = runCli('update', '--check');
check('update refuses too', update.status === 3 && /Tampering detected/.test(update.out));
const doctor = runCli('doctor');
check('doctor reports the modified license', /FAIL\s+license file is modified/.test(doctor.out));
const version = runCli('version');
check('version and licenses still work so the user can see what is wrong', version.status === 0 && runCli('licenses').status === 0);

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
