import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const command = target ? [target, 'serve'] : [process.execPath, path.join(bridgeDir, 'cli.mjs'), 'serve'];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-packs-'));
const token = crypto.randomBytes(32).toString('hex');
const port = 3988;
const packsRoot = path.join(home, 'packs');

const writePack = (folder, manifest, handlers = {}, main = null) => {
  const root = path.join(packsRoot, folder);
  fs.mkdirSync(path.join(root, 'handlers'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pack.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [name, body] of Object.entries(handlers)) fs.writeFileSync(path.join(root, 'handlers', `${name}.luau`), body);
  if (main) fs.writeFileSync(path.join(root, 'main.mjs'), main);
};
const schema = { type: 'object', properties: { deny: { type: 'boolean' } } };

writePack(
  'demo',
  {
    name: 'demo',
    version: '1.2.3',
    title: 'Demo Pack',
    summary: 'Pack used by the tests.',
    tools: [
      { name: 'demo_hello', description: 'Says hello from a pack.', inputSchema: schema },
      { name: 'script_get', description: 'Collides with a built-in tool.', inputSchema: schema },
      { name: 'demo_missing', description: 'Has no handler file.', inputSchema: schema },
      { name: 'demo_bad', description: 'Has a schema that is not an object.', inputSchema: { type: 'string' } },
      { name: 'demo_server', description: 'Runs code on the server side of the pack.', inputSchema: { type: 'object', properties: { n: { type: 'number' }, deny: { type: 'boolean' } } }, server: true },
      { name: 'demo_boom', description: 'Throws inside the pack.', inputSchema: schema, server: true },
      { name: 'demo_inline', description: 'Runs Luau held in memory.', inputSchema: schema, server: true },
      { name: 'demo_inline_empty', description: 'Runs empty Luau.', inputSchema: schema, server: true },
    ],
  },
  {
    demo_hello: 'return "hello from the demo pack " .. tostring(params.deny)',
    script_get: 'return "should never run"',
    _ping: ['bridge.attachFile("note.txt", "hello")', 'return "pong " .. tostring(params.n)'].join(String.fromCharCode(10)),
  },
  [
    "import fs from 'node:fs';",
    'export async function authorize({ tool, args }) { return args.deny ? { ok: false, message: "Demo pack says no." } : { ok: true }; }',
    'export const tools = {',
    '  demo_server: async (args, api) => {',
    "    const result = await api.runHandler('_ping', { n: args.n });",
    '    const file = result.files[0];',
    "    return api.text('ok=' + result.ok + ' returned=' + result.returned.join(',') + ' file=' + (file ? file.name + ':' + file.bytes.toString() : 'none') + ' dir=' + fs.existsSync(api.dataDir));",
    '  },',
    "  demo_boom: async () => { throw new Error('kaboom'); },",
    "  demo_inline: async (args, api) => { const result = await api.runLuau('return params.n', { n: 5 }); return api.text('inline=' + result.ok + ':' + result.returned.join(',')); },",
    "  demo_inline_empty: async (args, api) => api.text(String(await api.runLuau('', {}))),",
    '};',
  ].join(String.fromCharCode(10)),
);
writePack('noserver', { name: 'noserver', tools: [{ name: 'needs_main', description: 'Server tool without main.mjs.', inputSchema: schema, server: true }] });
writePack('broken', '{ not json', { x: 'return 1' });
writePack('nameless', { tools: [] });

const server = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port) },
  stdio: ['pipe', 'pipe', 'ignore'],
  windowsHide: true,
});

const waiters = new Map();
let listChanged = 0;
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'notifications/tools/list_changed') listChanged++;
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
await rpc('initialize', {});
const builtIn = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8')).tools.length;
const names = async () => (await rpc('tools/list', {})).result.tools.map((tool) => tool.name);

let listed = await names();
check('a valid pack tool is listed next to the built-in tools', listed.includes('demo_hello') && listed.includes('script_get'));
check('only the valid tools of that pack are added', listed.length === builtIn + 5, `${listed.length} tools`);
check('a server tool without a main.mjs is skipped', !listed.includes('needs_main'));
check('the server flag is not shown to the client', !JSON.stringify((await rpc('tools/list', {})).result.tools.find((tool) => tool.name === 'demo_server')).includes('"server"'));
check('a tool that reuses a built-in name does not replace it', (await rpc('tools/list', {})).result.tools.filter((tool) => tool.name === 'script_get').length === 1);

const received = [];
let polling = true;
(async () => {
  try {
    while (polling) {
      const next = await post('/poll', { id: 'packs-test-0001', role: 'edit', placeId: 5, placeName: 'PacksTest' });
      if (next.requestId) {
        received.push(next.code);
        const withFile = next.code.includes('bridge.attachFile("note.txt"');
        await post('/result', withFile
          ? { requestId: next.requestId, ok: true, returned: ['pong 7'], output: [], files: [{ name: 'note.txt', base64: Buffer.from('hello').toString('base64') }] }
          : { requestId: next.requestId, ok: true, returned: ['done'], output: [] });
      }
    }
  } catch {
    polling = false;
  }
})();
await sleep(300);

const ran = await rpc('tools/call', { name: 'demo_hello', arguments: {} });
check('a pack tool runs its own Luau with the shared prelude', !ran.result.isError && received.length === 1 && received[0].includes('hello from the demo pack') && received[0].includes('local function requireScript'));
check('the built-in tool of the same name still runs its own handler', await (async () => {
  const before = received.length;
  const answered = await rpc('tools/call', { name: 'script_get', arguments: { path: 'game.A' } });
  return !answered.result.isError && received.length === before + 1 && !received[before].includes('should never run') && received[before].includes('readSource(script)');
})());

const before = received.length;
const denied = await rpc('tools/call', { name: 'demo_hello', arguments: { deny: true } });
check('the pack can refuse a call and its message reaches the client', denied.result.isError === true && denied.result.content[0].text === 'Demo pack says no.');
check('a refused call never reaches Studio', received.length === before);

const served = await rpc('tools/call', { name: 'demo_server', arguments: { n: 7 } });
const servedText = served.result.content[0].text;
check('a server tool runs its own code and can run Luau in Studio', !served.result.isError && /ok=true returned=pong 7/.test(servedText));
check('and receives the files the Luau attached', /file=note.txt:hello/.test(servedText));
check('and gets a data folder of its own', /dir=true/.test(servedText));
check('the pack Luau reached Studio with the shared prelude', received.some((code) => code.includes('bridge.attachFile("note.txt"') && code.includes('local function requireScript')));
const beforeServer = received.length;
const refusedServer = await rpc('tools/call', { name: 'demo_server', arguments: { deny: true } });
check('the license hook also guards server tools', refusedServer.result.isError === true && refusedServer.result.content[0].text === 'Demo pack says no.' && received.length === beforeServer);
const inline = await rpc('tools/call', { name: 'demo_inline', arguments: {} });
check('a pack can run Luau it holds in memory, with no handler file', !inline.result.isError && /inline=true:done/.test(inline.result.content[0].text) && received.some((code) => code.includes('return params.n') && code.includes('"n":5')), inline.result.content[0].text);
const inlineEmpty = await rpc('tools/call', { name: 'demo_inline_empty', arguments: {} });
check('empty Luau is refused', inlineEmpty.result.isError === true && /non-empty string/.test(inlineEmpty.result.content[0].text), inlineEmpty.result.content[0].text);
const boom = await rpc('tools/call', { name: 'demo_boom', arguments: {} });
check('a server tool that throws is reported without crashing the bridge', boom.result.isError === true && /demo_boom|pack failed/.test(boom.result.content[0].text) && /kaboom/.test(boom.result.content[0].text));

const batched = await rpc('tools/call', { name: 'batch', arguments: { operations: [{ tool: 'demo_hello', args: {} }] } });
check('pack tools cannot be batched', batched.result.isError === true && /cannot be batched/.test(batched.result.content[0].text));

const changedBefore = listChanged;
writePack(
  'second',
  { name: 'second', tools: [{ name: 'second_tool', description: 'Added while running.', inputSchema: schema }] },
  { second_tool: 'return "second"' },
  'export async function authorize() { throw new Error("license server unreachable"); }',
);
await sleep(1500);
listed = await names();
check('a pack dropped in while running appears without a restart', listed.includes('second_tool') && listed.includes('demo_hello'));
check('and the client is told the list changed', listChanged > changedBefore);
const failedCheck = await rpc('tools/call', { name: 'second_tool', arguments: {} });
check('a pack whose check throws is refused with an explanation', failedCheck.result.isError === true && /could not check this call: license server unreachable/.test(failedCheck.result.content[0].text));

fs.rmSync(path.join(packsRoot, 'second'), { recursive: true, force: true });
await sleep(1500);
check('removing a pack removes its tools', !(await names()).includes('second_tool'));

polling = false;
server.kill();
await new Promise((resolve) => server.once('exit', resolve));
fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
