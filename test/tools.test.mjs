import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { offeredCatalog } from './helpers/catalog.mjs';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-tools-'));
const toolsFile = path.join(workDir, 'tools.json');
fs.copyFileSync(path.join(bridgeDir, 'tools.json'), toolsFile);

const server = spawn('node', [path.join(bridgeDir, 'server.mjs')], {
  env: { ...process.env, STUDIO_BRIDGE_TOKEN: crypto.randomBytes(16).toString('hex'), STUDIO_BRIDGE_PORT: '3994', STUDIO_BRIDGE_TOOLS_FILE: toolsFile, STUDIO_BRIDGE_PACKS_DIR: path.join(workDir, 'no-packs') },
  stdio: ['pipe', 'pipe', 'ignore'],
});

const waiters = new Map();
let notifications = 0;
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'notifications/tools/list_changed') {
    notifications++;
    return;
  }
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
const listTools = async () => (await rpc('tools/list', {})).result.tools;
const batchEnum = (tools) => tools.find((tool) => tool.name === 'batch').inputSchema.properties.operations.items.properties.tool.enum;

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const initialized = await rpc('initialize', {});
check('server announces that its tool list can change', initialized.result.capabilities.tools.listChanged === true);

const original = offeredCatalog(toolsFile);
const first = await listTools();
check('tools come from tools.json', first.length === original.tools.length, `${first.length} tools`);
check('batch lists the batchable handler tools', batchEnum(first).includes('script_get') && !batchEnum(first).includes('play_start'));

const changed = structuredClone(original);
changed.tools.push({ name: 'example_tool', description: 'Added while running.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
changed.meta.script_get = { batchable: false };
fs.writeFileSync(toolsFile, JSON.stringify(changed, null, 2));
await sleep(900);
const second = await listTools();
check('a new tool appears without a restart', second.some((tool) => tool.name === 'example_tool'));
check('a notification tells the client to refetch', notifications >= 1, `${notifications} notification(s)`);
check('batchable flag in the file changes the batch tool', !batchEnum(second).includes('script_get') && batchEnum(second).includes('script_set'));

const before = notifications;
fs.writeFileSync(toolsFile, '{ not json');
await sleep(900);
const third = await listTools();
check('an invalid file keeps the previous tools', third.length === second.length);
check('and sends no notification', notifications === before);

fs.writeFileSync(toolsFile, JSON.stringify(original, null, 2));
await sleep(900);
const fourth = await listTools();
check('restoring the file restores the tools', fourth.length === original.tools.length && !fourth.some((tool) => tool.name === 'example_tool'));

const unknown = await rpc('tools/call', { name: 'example_tool', arguments: {} });
check('a tool with no implementation answers with a clear error', unknown.result.isError === true);

server.kill();
await new Promise((resolve) => server.once('exit', resolve));
fs.rmSync(workDir, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
