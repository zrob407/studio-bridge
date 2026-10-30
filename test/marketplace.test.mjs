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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-market-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
const mock = http.createServer((req, res) => {
  requests.push(req.url);
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');
  const search = url.pathname.match(/^\/toolbox-service\/v1\/marketplace\/(\d+)$/);
  if (search) {
    if (url.searchParams.get('keyword') === 'broken') {
      res.statusCode = 500;
      res.end('{}');
      return;
    }
    const empty = url.searchParams.get('keyword') === 'nothing';
    res.end(
      JSON.stringify({
        totalResults: 2,
        nextPageCursor: empty ? null : 'cursor-two',
        data: empty ? [] : [{ id: 111 }, { id: 222 }, { id: 333 }],
      }),
    );
    return;
  }
  const details = url.pathname.match(/^\/v2\/assets\/(\d+)\/details$/);
  if (details) {
    const id = details[1];
    if (id === '333') {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    res.end(JSON.stringify({ Name: `Asset ${id}`, Creator: { Name: id === '111' ? 'Alice' : 'Bob', CreatorType: 'User' }, PriceInRobux: id === '222' ? 25 : 0, AssetTypeId: 10 }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${mock.address().port}`;

const token = crypto.randomBytes(16).toString('hex');
const server = spawn(command[0], command.slice(1), {
  env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: '3972', STUDIO_BRIDGE_OFFLINE: '1', STUDIO_BRIDGE_TOOLBOX_BASE: base, STUDIO_BRIDGE_ECONOMY_BASE: base },
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
const call = (args) => rpc('tools/call', { name: 'asset_search', arguments: args });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await sleep(800);
await rpc('initialize', {});

const listed = await rpc('tools/list', {});
check('asset_search is listed', listed.result.tools.some((tool) => tool.name === 'asset_search'));

const found = await call({ query: 'tree', limit: 3 });
const text = found.result.content[0].text;
check('a search lists ids with names and creators', !found.result.isError && /111\s+Asset 111 by Alice/.test(text) && /222\s+Asset 222 by Bob/.test(text), text.split('\n')[0]);
check('a price is shown for paid assets', /25 Robux/.test(text));
check('an asset whose details cannot be read is still listed by id', /^333$/m.test(text));
check('the next page cursor is offered', /cursor "cursor-two"/.test(text));
check('the query reaches the model category with the keyword', requests.some((url) => url.includes('/marketplace/10') && url.includes('keyword=tree') && url.includes('limit=3')), requests[0]);

const audio = await call({ query: 'rain', type: 'audio' });
check('type selects the asset category', requests.some((url) => url.includes('/marketplace/3?')));
check('an audio search works', !audio.result.isError);

const paged = await call({ query: 'tree', cursor: 'cursor-two' });
check('a cursor is passed on', requests.some((url) => url.includes('cursor=cursor-two')) && !paged.result.isError);

const none = await call({ query: 'nothing' });
check('no results says so', none.result.content[0].text === 'no assets found');

const broken = await call({ query: 'broken' });
check('a failing search is reported as an error', broken.result.isError === true && /Asset search failed/.test(broken.result.content[0].text));

const badType = await call({ query: 'x', type: 'banana' });
check('an unknown type is rejected', badType.result.isError === true && /type must be one of/.test(badType.result.content[0].text));

const missing = await call({});
check('a missing query is rejected', missing.result.isError === true && /query is required/.test(missing.result.content[0].text));

server.kill();
await new Promise((resolve) => server.once('exit', resolve));
mock.close();
fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
