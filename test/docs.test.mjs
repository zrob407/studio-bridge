import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const command = target ? [target, 'serve'] : [process.execPath, path.join(bridgeDir, 'cli.mjs'), 'serve'];
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-docs-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
const longPage = 'Line of documentation.\n'.repeat(1000);
const mock = http.createServer((req, res) => {
  requests.push(req.url);
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/docs/api/search') {
    res.setHeader('Content-Type', 'application/json');
    const query = url.searchParams.get('q');
    if (query === 'nothing') return res.end(JSON.stringify({ results: [] }));
    if (query === 'broken') {
      res.statusCode = 500;
      return res.end('{}');
    }
    return res.end(
      JSON.stringify({
        query,
        results: [
          { title: 'RaycastParams', url: 'https://create.roblox.com/docs/en-us/reference/engine/datatypes/RaycastParams.md', summary: 'A container\nfor parameters.\n', type: 'LuaApi' },
          { title: 'Raycasting', url: 'https://create.roblox.com/docs/en-us/workspace/raycasting.md', summary: 'A guide.', type: 'Guide' },
        ],
      }),
    );
  }
  if (url.pathname === '/docs/reference/engine/classes/Part.md') return res.end('# Part\nA part.');
  if (url.pathname === '/docs/long.md') return res.end(longPage);
  res.statusCode = 404;
  res.end('missing');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${mock.address().port}`;

const server = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: crypto.randomBytes(16).toString('hex'), STUDIO_BRIDGE_PORT: '3971', STUDIO_BRIDGE_OFFLINE: '1', STUDIO_BRIDGE_DOCS_BASE: base },
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
const docs = async (args) => (await rpc('tools/call', { name: 'roblox_docs', arguments: args })).result;

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await sleep(800);
await rpc('initialize', {});
const listed = (await rpc('tools/list', {})).result.tools.map((tool) => tool.name);
check('the documentation and input tools are listed', ['roblox_docs', 'input_keyboard', 'input_mouse', 'character_move', 'generate_model'].every((name) => listed.includes(name)));

const found = await docs({ query: 'raycast params' });
const text = found.content[0].text;
check('a search lists titles, paths and one-line summaries', !found.isError && /RaycastParams \[LuaApi\]\s+reference\/engine\/datatypes\/RaycastParams\.md/.test(text) && /A container for parameters\./.test(text), text.split('\n')[0]);
check('the query is passed to the search endpoint', requests.some((url) => url.includes('/docs/api/search?q=raycast%20params')));

const limited = await docs({ query: 'raycast', limit: 1 });
check('limit caps the results', !limited.isError && !/Raycasting \[Guide\]/.test(limited.content[0].text));

const none = await docs({ query: 'nothing' });
check('no results says so', none.content[0].text === 'no documentation found');

const broken = await docs({ query: 'broken' });
check('a failing search is reported as an error', broken.isError === true && /Documentation lookup failed/.test(broken.content[0].text));

const page = await docs({ mode: 'read', path: 'reference/engine/classes/Part' });
check('a page is read from its markdown file', !page.isError && /# Part/.test(page.content[0].text) && requests.some((url) => url === '/docs/reference/engine/classes/Part.md'));

const byUrl = await docs({ mode: 'read', path: `${base}/docs/en-us/reference/engine/classes/Part.md#Anchor` });
check('a full URL on the docs host works', !byUrl.isError && /# Part/.test(byUrl.content[0].text));

const foreign = await docs({ mode: 'read', path: 'https://example.com/docs/x.md' });
check('a URL on another host is refused', foreign.isError === true && /only .* pages can be read/.test(foreign.content[0].text));

const traversal = await docs({ mode: 'read', path: '../secrets' });
check('a path that climbs out is refused', traversal.isError === true);

const first = await docs({ mode: 'read', path: 'long', maxChars: 1000 });
check('a long page is cut with a note on where to continue', !first.isError && /pass offset 1000 for more/.test(first.content[0].text));
const second = await docs({ mode: 'read', path: 'long', offset: 1000, maxChars: 1000 });
check('the offset continues from there', !second.isError && /characters 1000 to 2000 of 23000/.test(second.content[0].text));

const missing = await docs({ mode: 'read', path: 'no/such/page' });
check('a missing page is reported', missing.isError === true && /no such documentation page/.test(missing.content[0].text));

const empty = await docs({});
check('a search without a query is refused', empty.isError === true && /query is required/.test(empty.content[0].text));

server.kill();
await new Promise((resolve) => server.once('exit', resolve));
mock.close();
fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
