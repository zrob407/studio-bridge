import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(32).toString('hex');
const port = 3993;
const server = spawn('node', [path.join(bridgeDir, 'server.mjs')], {
  env: { ...process.env, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port) },
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

const stubSource = fs.readFileSync(path.join(bridgeDir, 'plugin.stub.lua'), 'utf8');
check('stub verifies the signature before running anything', stubSource.includes('hmacSha256Hex(TOKEN, body.source)') && stubSource.indexOf('constantTimeEquals(hmacSha256Hex') < stubSource.indexOf('return body\nend\n\nlocal current'));

server.kill();
await new Promise((resolve) => server.once('exit', resolve));
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
