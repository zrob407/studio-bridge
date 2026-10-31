import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-tools-'));
const catalog = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8'));

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

async function listTools(label, port, preload) {
  const args = preload ? ['--import', pathToFileUrl(preload), path.join(bridgeDir, 'server.mjs')] : [path.join(bridgeDir, 'server.mjs')];
  const home = path.join(sandbox, label);
  const server = spawn(process.execPath, args, {
    env: { ...process.env, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_PACKS_DIR: path.join(home, 'no-packs'), STUDIO_BRIDGE_TOKEN: crypto.randomBytes(16).toString('hex'), STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_OFFLINE: '1' },
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
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  await new Promise((resolve) => setTimeout(resolve, 800));
  await rpc('initialize', {});
  const tools = (await rpc('tools/list', {})).result.tools.map((tool) => tool.name);
  const called = await rpc('tools/call', { name: 'screenshot', arguments: {} });
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  return { tools, called };
}

const pathToFileUrl = (file) => pathToFileURL(path.resolve(file)).href;

const normal = await listTools('normal', 3979, null);
check('on this platform every catalog tool is offered', normal.tools.length === catalog.tools.length && normal.tools.includes('screenshot'), `${normal.tools.length} tools`);

const linux = await listTools('linux', 3978, path.join(bridgeDir, 'test', 'helpers', 'fake-linux.mjs'));
check('on a Linux desktop without Hyprland the window screenshot is not offered', !linux.tools.includes('screenshot') && linux.tools.length === catalog.tools.length - 1, `${linux.tools.length} tools`);
check('and nothing else is hidden', catalog.tools.map((tool) => tool.name).filter((name) => !linux.tools.includes(name)).join() === 'screenshot');
check('calling it anyway gets a short answer that points to viewport_screenshot', linux.called.result.isError === true && /viewport_screenshot/.test(linux.called.result.content[0].text) && linux.called.result.content[0].text.length < 260, linux.called.result.content[0].text);

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
