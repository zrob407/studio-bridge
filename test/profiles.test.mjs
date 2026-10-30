import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const base = target ? [target] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-profiles-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const catalog = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8'));
const allNames = catalog.tools.map((tool) => tool.name);

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

function start(label, { profile, settings } = {}) {
  const home = path.join(sandbox, label);
  fs.mkdirSync(home, { recursive: true });
  if (settings) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings));
  const env = { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: crypto.randomBytes(16).toString('hex'), STUDIO_BRIDGE_PORT: '3970', STUDIO_BRIDGE_OFFLINE: '1' };
  delete env.STUDIO_BRIDGE_TOOLS;
  if (profile !== undefined) env.STUDIO_BRIDGE_TOOLS = profile;
  const child = spawn(base[0], [...base.slice(1), 'serve'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const waiters = new Map();
  const notifications = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method) {
      notifications.push(message.method);
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
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  return {
    home,
    notifications,
    rpc,
    tools: async () => (await rpc('tools/list', {})).result.tools,
    call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result,
    stop: async () => {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    },
    ready: sleep(900),
  };
}

const groupNames = Object.keys(catalog.groups);
const grouped = Object.values(catalog.groups).flat();
check('every tool is in exactly one group', allNames.length === grouped.length && allNames.every((name) => grouped.filter((entry) => entry === name).length === 1));
check('there is a core group', Array.isArray(catalog.groups.core) && catalog.groups.core.includes('run_luau') && catalog.groups.core.includes('studio_list'));

const everything = start('all');
await everything.ready;
await everything.rpc('initialize', {});
check('by default every tool is offered', (await everything.tools()).length === allNames.length, `${allNames.length} tools`);
await everything.stop();

const core = start('core', { profile: 'core' });
await core.ready;
await core.rpc('initialize', {});
const coreTools = await core.tools();
check('the core profile offers only the core group', coreTools.length === catalog.groups.core.length && coreTools.every((tool) => catalog.groups.core.includes(tool.name)), `${coreTools.length} tools`);
const batchEnum = coreTools.find((tool) => tool.name === 'batch').inputSchema.properties.operations.items.properties.tool.enum;
check('batch lists only tools that are offered', batchEnum.includes('script_get') && !batchEnum.includes('instance_bulk') && batchEnum.every((name) => catalog.groups.core.includes(name)));
const hidden = await core.call('terrain', { action: 'read', center: [0, 0, 0] });
check('a tool outside the profile explains how to enable it', hidden.isError === true && /not enabled/.test(hidden.content[0].text) && /studio-bridge settings tools building/.test(hidden.content[0].text), hidden.content[0].text.slice(0, 70));
const hiddenBatch = await core.call('batch', { operations: [{ tool: 'instance_bulk', args: { action: 'get' } }] });
check('batch refuses a tool outside the profile', hiddenBatch.isError === true && /cannot be batched/.test(hiddenBatch.content[0].text));
const visible = await core.call('studio_list', {});
check('tools inside the profile still work', !visible.isError);
await core.stop();

const mixed = start('mixed', { profile: 'building,ui' });
await mixed.ready;
await mixed.rpc('initialize', {});
const mixedNames = (await mixed.tools()).map((tool) => tool.name);
check('several groups can be combined with core', mixedNames.includes('terrain') && mixedNames.includes('ui_build') && mixedNames.includes('run_luau') && !mixedNames.includes('animation_create'), `${mixedNames.length} tools`);
await mixed.stop();

const fromSettings = start('settings', { settings: { toolProfile: 'ui' } });
await fromSettings.ready;
await fromSettings.rpc('initialize', {});
const settingsNames = (await fromSettings.tools()).map((tool) => tool.name);
check('the profile in settings.json is used when no environment override is set', settingsNames.includes('ui_build') && !settingsNames.includes('terrain'));

fs.writeFileSync(path.join(fromSettings.home, 'settings.json'), JSON.stringify({ toolProfile: 'media' }));
await sleep(1200);
const changedNames = (await fromSettings.tools()).map((tool) => tool.name);
check('changing the setting while running re-lists the tools', changedNames.includes('animation_create') && !changedNames.includes('ui_build'));
check('and tells the client the list changed', fromSettings.notifications.includes('notifications/tools/list_changed'));
await fromSettings.stop();

const unknown = start('unknown', { profile: 'nonsense,ui' });
await unknown.ready;
await unknown.rpc('initialize', {});
const unknownNames = (await unknown.tools()).map((tool) => tool.name);
check('an unknown group is ignored and the rest still apply', unknownNames.includes('ui_build') && unknownNames.includes('run_luau') && !unknownNames.includes('terrain'));
await unknown.stop();

const cliEnv = { ...process.env, STUDIO_BRIDGE_HOME: path.join(sandbox, 'cli'), STUDIO_BRIDGE_OFFLINE: '1' };
delete cliEnv.STUDIO_BRIDGE_TOOLS;
const run = (...args) => {
  const finished = spawnSync(base[0], [...base.slice(1), 'settings', ...args], { env: cliEnv, encoding: 'utf8', windowsHide: true });
  return { status: finished.status, out: `${finished.stdout || ''}${finished.stderr || ''}` };
};
const listed = run('tools');
check('the settings command lists the groups', listed.status === 0 && groupNames.every((group) => listed.out.includes(group)));
const set = run('tools', 'building,ui');
check('the settings command saves a profile', set.status === 0 && /building,ui/.test(fs.readFileSync(path.join(sandbox, 'cli', 'settings.json'), 'utf8')));
const bad = run('tools', 'bogus');
check('the settings command rejects an unknown group', bad.status === 1 && /Unknown tool group/.test(bad.out));
check('the settings command keeps the old choice after a rejection', /building,ui/.test(fs.readFileSync(path.join(sandbox, 'cli', 'settings.json'), 'utf8')));

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
