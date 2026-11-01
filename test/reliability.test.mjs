import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(16).toString('hex');
const port = 3999;

const server = spawn('node', [path.join(bridgeDir, 'server.mjs')], {
  env: { ...process.env, STUDIO_BRIDGE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-home-')), STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_GRACE_MS: '1500', STUDIO_BRIDGE_QUEUE_WAIT_MS: '3000' },
  stdio: ['pipe', 'pipe', 'ignore'],
});

const waiters = new Map();
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  const entry = waiters.get(message.id);
  if (entry) {
    waiters.delete(message.id);
    entry(message);
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function callTool(name, args) {
  const started = Date.now();
  const response = await rpc('tools/call', { name, arguments: args });
  return { text: response.result.content[0].text, isError: response.result.isError, ms: Date.now() - started };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pluginRunning = false;
let concurrent = 0;
let maxConcurrent = 0;
const delivered = [];

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function handle(command) {
  concurrent++;
  maxConcurrent = Math.max(maxConcurrent, concurrent);
  delivered.push({ code: command.code, timeout: command.timeout, at: Date.now() });
  if (command.code === 'slow') await sleep(1500);
  if (command.code !== 'hang') {
    concurrent--;
    await post('/result', { requestId: command.requestId, ok: true, returned: [command.code], output: [] });
  }
}

async function pluginLoop() {
  try {
    while (pluginRunning) {
      const command = await post('/poll', { id: 'fake-plugin-0001', role: 'edit', placeId: 1, placeName: 'Test' });
      if (command.requestId) handle(command);
    }
  } catch {
    pluginRunning = false;
  }
}

let failures = 0;
function check(name, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

await rpc('initialize', {});

const noPlugin = await callTool('run_luau', { code: 'x', timeout_seconds: 5 });
check('no window connected is reported', noPlugin.isError && /No Studio window/.test(noPlugin.text), noPlugin.text.slice(0, 60));

pluginRunning = true;
pluginLoop();
await sleep(300);

const [first, second] = await Promise.all([
  callTool('run_luau', { code: 'slow', timeout_seconds: 2 }),
  callTool('run_luau', { code: 'slow', timeout_seconds: 2 }),
]);
check('two queued 1.5s commands with a 2s timeout both succeed', !first.isError && !second.isError, `${first.ms}ms / ${second.ms}ms`);
check('commands run one at a time', maxConcurrent === 1, `max concurrent ${maxConcurrent}`);
check('timeout is passed to the plugin', delivered.every((entry) => entry.timeout === 2));

const hung = callTool('run_luau', { code: 'hang', timeout_seconds: 1 });
await sleep(100);
const behind = callTool('run_luau', { code: 'fast', timeout_seconds: 5 });
const hungResult = await hung;
const behindResult = await behind;
check('hung command times out after its own timeout plus grace', hungResult.isError && /Timed out after 1s/.test(hungResult.text) && hungResult.ms >= 2400 && hungResult.ms < 3600, `${hungResult.ms}ms`);
check('command behind a hung one runs afterwards', !behindResult.isError && behindResult.text.includes('fast'), `${behindResult.ms}ms`);

const stale = await post('/result', { requestId: 'not-a-real-id', ok: true });
check('result for an unknown request is ignored', stale.ignored === true);

const listing = await callTool('studio_list', {});
check('window is not stuck busy', !/busy/.test(listing.text), listing.text);

pluginRunning = false;
server.kill();
await new Promise((resolve) => server.once('exit', resolve));
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
