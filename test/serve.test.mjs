import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { offeredCatalog } from './helpers/catalog.mjs';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const command = target ? [path.resolve(target), 'serve'] : [process.execPath, path.join(bridgeDir, 'cli.mjs'), 'serve'];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-serve-'));
const token = crypto.randomBytes(32).toString('hex');
const port = 3990;
const server = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_NO_BROWSER: '1' },
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
check('serve lists the tools from tools.json', tools.length === offeredCatalog(bridgeDir).tools.length, `${tools.length} tools`);
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

const spatial = await rpc('tools/call', { name: 'spatial_query', arguments: { mode: 'bounds', path: 'game.Workspace.A' } });
check('a geometry handler also loads the shared geometry helpers', !spatial.result.isError && Boolean(received[3]) && received[3].includes('local function worldBounds') && received[3].includes('local mode = params.mode'));
const mixed = await rpc('tools/call', { name: 'batch', arguments: { operations: [{ tool: 'tag_manage', args: { action: 'list' } }, { tool: 'scatter', args: { template: 'game.A', center: [0, 0, 0], size: [10, 10] } }] } });
check('batch includes the geometry helpers once when a geometry tool is in it', !mixed.result.isError && Boolean(received[4]) && received[4].split('local function worldBounds').length === 2);
check('the plugin source carries the status window', plugin.source.includes('buildStatusWidget') && plugin.source.includes('StudioBridgeStatus'));
check('the plugin source has a Pro tab that only talks to the local bridge', plugin.source.includes('PAGES = {"Status", "Tools", "Pro", "Log"}') && plugin.source.includes('post("/settings", {action = "set"') && plugin.source.includes('post("/pro", {action = "activate"') && plugin.source.includes('ClearTextOnFocus = false') && !/api\.polar\.sh|workers\.dev|studio-bridge-license/.test(plugin.source));
check('the plugin has a settings cogwheel that opens Config, turns white under the pointer and spins once', plugin.source.includes('cogButton.MouseButton1Click') && plugin.source.includes('local COG_SPIN_SECONDS = 0.9') && plugin.source.includes('cubicBezier(0.5, 0, 0.2, 1)') && plugin.source.includes('Color3.fromRGB(255, 255, 255) elseif selected == "Config"'));
const buy = await post('/pro', { action: 'buy' });
check('the bridge answers the buy button with the checkout link', buy.ok === true && /^https:\/\/buy\.polar\.sh\//.test(buy.url) && buy.message.includes(buy.url));
check('the Pro tab has a Buy a license button below Activate that only asks the local bridge', plugin.source.includes('Text = "Buy a license"') && plugin.source.includes('post("/pro", {action = "buy"})') && plugin.source.indexOf('Text = "Buy a license"') > plugin.source.indexOf('Text = "Activate"') && !/buy\.polar\.sh/.test(plugin.source) && plugin.source.includes('Restart your AI tool to update it'));
check('the Pro tab clears the key box after a successful activation and never logs the key', plugin.source.includes('keyBox.Text = ""') && !/(print|warn)\([^)]*keyBox/.test(plugin.source));

const include = async (name, args) => {
  const before = received.length;
  const answered = await rpc('tools/call', { name, arguments: args });
  return { ok: !answered.result.isError, code: received[before] || '' };
};
const spatialFind = await include('spatial_find', { mode: 'ground', x: 1, z: 2 });
check('spatial handlers load the geometry and spatial helpers', spatialFind.ok && spatialFind.code.includes('local function worldBounds') && spatialFind.code.includes('local function groundAt') && spatialFind.code.includes('local mode = params.mode'));
const poseCode = await include('animation_pose', { action: 'reset', rig: 'game.Workspace.R' });
check('animation handlers load the animation helpers', poseCode.ok && poseCode.code.includes('local function posesAt'));
const insertCode = await include('asset_insert', { assetId: '123' });
check('asset_insert loads the scan rules', insertCode.ok && insertCode.code.includes('local SCAN_RULES = {') && insertCode.code.includes('game:GetObjects') && insertCode.code.includes('counts.high > 0') && !insertCode.code.includes('0 high,'));
const snapCode = await include('snap_grid', { path: 'game.Workspace.A' });
check('snap_grid loads the geometry helpers', snapCode.ok && snapCode.code.includes('local function formatVector'));
const plainCode = await include('tag_manage', { action: 'list' });
check('a handler with no includes carries none', plainCode.ok && !plainCode.code.includes('local function worldBounds') && !plainCode.code.includes('local function posesAt'));

const second = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port) },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
let secondError = '';
second.stderr.on('data', (chunk) => {
  secondError += chunk;
});
const secondExit = await Promise.race([new Promise((resolve) => second.once('exit', (code) => resolve(code))), sleep(6000).then(() => 'still running')]);
check('a second server on a busy port exits with an error instead of pretending to work', secondExit === 1 && /already in use/.test(secondError), "exit " + secondExit);
if (secondExit === 'still running') second.kill();

polling = false;
server.kill();
await new Promise((resolve) => server.once('exit', resolve));
fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
