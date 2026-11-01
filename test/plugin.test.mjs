import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(32).toString('hex');
const port = 3993;
const server = spawn('node', [path.join(bridgeDir, 'server.mjs')], {
  env: { ...process.env, STUDIO_BRIDGE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-home-')), STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port) },
  stdio: ['pipe', 'ignore', 'ignore'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ask = (body, headers = { 'X-Bridge-Token': token }, method = 'POST') =>
  fetch(`http://127.0.0.1:${port}/plugin`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await sleep(600);

const refused = await ask({}, {});
check('plugin request without the token is refused', refused.status === 401, `status ${refused.status}`);
const wrong = await ask({}, { 'X-Bridge-Token': 'x'.repeat(token.length) });
check('plugin request with a wrong token is refused', wrong.status === 401, `status ${wrong.status}`);
const got = await ask({}, { 'X-Bridge-Token': token }, 'GET');
check('plugin request by GET is refused', got.status === 405, `status ${got.status}`);

const first = await (await ask({ role: 'edit' })).json();
check('response carries version, source and signature', typeof first.version === 'string' && typeof first.source === 'string' && typeof first.signature === 'string');
check('placeholders are filled in', !first.source.includes('__PORT__') && !first.source.includes('__TOKEN__') && first.source.includes(token) && first.source.includes(`127.0.0.1:${port}`));
const expected = crypto.createHmac('sha256', token).update(first.source).digest('hex');
check('signature is the HMAC-SHA256 of the source keyed by the token', first.signature === expected);
check('source is the current plugin template', first.source.includes('local function runSocketSession') && first.source.includes('return {stop = stop, busy = busy}'));

const same = await (await ask({ have: first.version })).json();
check('same version answers unchanged without the source', same.unchanged === true && same.source === undefined);
const stale = await (await ask({ have: 'old' })).json();
check('a different version gets the full source', stale.source === first.source);

const clientBody = await (await ask({ role: 'client' })).json();
check('the client variant has no secret in it', typeof clientBody.source === 'string' && !clientBody.source.includes(token) && !clientBody.source.includes('__TOKEN__') && clientBody.source.includes('local TOKEN = ""'));
check('the client variant is signed and differs from the edit variant', clientBody.signature === crypto.createHmac('sha256', token).update(clientBody.source).digest('hex') && clientBody.version !== first.version);
const serverBody = await (await ask({ role: 'server' })).json();
check('the server variant keeps the token', serverBody.source.includes(token));

const stubSource = fs.readFileSync(path.join(bridgeDir, 'plugin.stub.lua'), 'utf8').replace(/\r\n/g, '\n');
const verifyAt = stubSource.indexOf('constantTimeEquals(hmacSha256Hex(TOKEN, body.source)');
const runAt = stubSource.indexOf('pcall(fn, {');
check('stub verifies the signature before running anything', verifyAt > 0 && runAt > verifyAt);
check('both the HTTP path and the relay path go through that verification', (stubSource.match(/return verifyBody\(/g) || []).length === 2);
check('a play client never uses HTTP to load the plugin', stubSource.includes('if ROLE == "client" then\n\t\t\tbody, problem = fetchViaRelay()'));
check('the play server hands the client variant to the plugin', stubSource.includes('body.clientBody = (fetch(nil, "client"))') && first.source.includes('return context.clientBody'));

server.kill();
await new Promise((resolve) => server.once('exit', resolve));
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
