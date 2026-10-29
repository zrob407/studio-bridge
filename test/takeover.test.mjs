import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const base = target ? [target] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];
const port = 3974;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-takeover-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function start(label, { version, token }) {
  const env = { ...process.env, STUDIO_BRIDGE_HOME: path.join(sandbox, label), STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_OFFLINE: '1', LOCALAPPDATA: sandbox };
  if (version) env.STUDIO_BRIDGE_TEST_VERSION = version;
  else delete env.STUDIO_BRIDGE_TEST_VERSION;
  const child = spawn(base[0], [...base.slice(1), 'serve'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const state = { child, stderr: '', exited: false, code: null };
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  state.done = new Promise((resolve) =>
    child.once('exit', (code) => {
      state.exited = true;
      state.code = code;
      resolve(code);
    }),
  );
  const waiters = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const entry = waiters.get(message.id);
    if (entry) {
      waiters.delete(message.id);
      entry(message);
    }
  });
  let nextId = 1;
  state.rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  state.stop = async () => {
    if (!state.exited) child.kill();
    await state.done;
  };
  return state;
}

const answers = async (token) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/plugin`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: '{"role":"edit"}', signal: AbortSignal.timeout(2000) });
    return response.status === 200;
  } catch {
    return false;
  }
};

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const token = crypto.randomBytes(16).toString('hex');

const older = start('older', { version: '0.0.1', token });
await sleep(1200);
check('an older server is running and answering', await answers(token));
const newer = start('newer', { version: null, token });
const olderExit = await Promise.race([older.done, sleep(6000).then(() => 'still running')]);
await sleep(1500);
check('a newer server asks the older one to stop', olderExit === 0, `older exit: ${olderExit}`);
check('and takes over its port', !newer.exited && (await answers(token)));
check('and says so on stderr', /taking over/.test(newer.stderr), newer.stderr.trim().split('\n').pop());
const init = await newer.rpc('initialize', {});
const listed = await newer.rpc('tools/call', { name: 'studio_list', arguments: {} });
check('the new server speaks MCP right away', init.result && !listed.result.isError);
await newer.stop();

const first = start('first', { version: null, token });
await sleep(1200);
const second = start('second', { version: null, token });
const secondExit = await Promise.race([second.done, sleep(6000).then(() => 'still running')]);
check('a second server of the same version exits with an error', secondExit === 1 && /already in use/.test(second.stderr), `exit ${secondExit}`);
check('and leaves the first one alone', !first.exited && (await answers(token)));
await first.stop();

const ahead = start('ahead', { version: '9.9.9', token });
await sleep(1200);
const behind = start('behind', { version: null, token });
const behindExit = await Promise.race([behind.done, sleep(6000).then(() => 'still running')]);
check('an older server never replaces a newer one', behindExit === 1 && !ahead.exited && (await answers(token)), `exit ${behindExit}`);
await ahead.stop();

const stale = start('stale', { version: '0.0.1', token });
await sleep(1200);
const stranger = start('stranger', { version: null, token: crypto.randomBytes(16).toString('hex') });
const strangerExit = await Promise.race([stranger.done, sleep(6000).then(() => 'still running')]);
check('a server with a different token cannot stop another one', strangerExit === 1 && !stale.exited && (await answers(token)), `exit ${strangerExit}`);
await stale.stop();

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
