import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const command = target ? [path.resolve(target), 'serve'] : [process.execPath, path.join(bridgeDir, 'cli.mjs'), 'serve'];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-serve-'));
const token = crypto.randomBytes(32).toString('hex');
const port = 3990;
const server = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port) },
  stdio: ['pipe', 'pipe', 'ignore'],
  windowsHide: true,
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
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiters.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (route, body) =>
  fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: JSON.stringify(body) }).then((response) => response.json());

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await sleep(800);
const initialized = await rpc('initialize', {});
check('serve answers the MCP handshake', initialized.result && initialized.result.capabilities.tools.listChanged === true);

const listed = await rpc('tools/list', {});
const tools = listed.result.tools;
check('serve lists the tools from tools.json', tools.length === JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8')).tools.length, `${tools.length} tools`);
const batchEnum = tools.find((tool) => tool.name === 'batch').inputSchema.properties.operations.items.properties.tool.enum;
check('batch list is built from the handler files', batchEnum.includes('script_get') && batchEnum.includes('instance_find') && !batchEnum.includes('play_start'), `${batchEnum.length} batchable`);

const plugin = await post('/plugin', { role: 'edit' });
const expected = crypto.createHmac('sha256', token).update(plugin.source || '').digest('hex');
check('the plugin endpoint serves signed source', plugin.signature === expected && plugin.source.includes('return {stop = stop, busy = busy}') && plugin.source.includes(token));

const received = [];
let polling = true;
(async () => {
  try {
    while (polling) {
      const next = await post('/poll', { id: 'serve-test-0001', role: 'edit', placeId: 5, placeName: 'ServeTest' });
      if (next.requestId) {
        received.push(next.code);
        await post('/result', { requestId: next.requestId, ok: true, returned: ['done'], output: [] });
      }
    }
  } catch {
    polling = false;
  }
})();
await sleep(300);

const single = await rpc('tools/call', { name: 'script_get', arguments: { path: 'game.ServerScriptService.A' } });
check('a handler tool runs with its Luau body and the shared prelude', !single.result.isError && received[0] && received[0].includes('local function requireScript') && received[0].includes('readSource(script)'));

const batch = await rpc('tools/call', {
  name: 'batch',
  arguments: { operations: [{ tool: 'script_get', args: { path: 'game.A' } }, { tool: 'instance_children', args: { path: 'game.Workspace' } }] },
});
check('batch composes the embedded handlers into one chunk', !batch.result.isError && received[1] && received[1].includes('readSource(script)') && received[1].includes('local root = resolve(params.path)'));

const scan = await rpc('tools/call', { name: 'script_scan', arguments: { path: 'game.A' } });
check('a scanner handler also loads the scan rules', !scan.result.isError && Boolean(received[2]) && received[2].includes('local SCAN_RULES = {') && received[2].includes('scanScripts(root'));

polling = false;
server.kill();
await new Promise((resolve) => server.once('exit', resolve));
fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
