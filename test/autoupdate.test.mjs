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
const feedPort = 3985;
const serverPort = 3986;
const origin = `http://127.0.0.1:${feedPort}`;

const exeBytes = target ? fs.readFileSync(target) : Buffer.from('not an exe');
const exeHash = crypto.createHash('sha256').update(exeBytes).digest('hex');
const exeName = 'studio-bridge-v9.9.9.exe';

let latestTag = 'v9.9.9';
let feedRequests = 0;
const feed = http.createServer((req, res) => {
  if (req.url === '/releases/latest') {
    feedRequests++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        tag_name: latestTag,
        assets: [
          { name: `studio-bridge-${latestTag}.exe`, browser_download_url: `${origin}/files/${exeName}` },
          { name: 'SHA256SUMS.txt', browser_download_url: `${origin}/files/SHA256SUMS.txt` },
        ],
      }),
    );
  } else if (req.url === '/files/SHA256SUMS.txt') {
    res.end(`${exeHash}  studio-bridge-${latestTag}.exe\n`);
  } else if (req.url === `/files/${exeName}`) {
    res.end(exeBytes);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => feed.listen(feedPort, '127.0.0.1', resolve));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-auto-'));
const localAppData = path.join(sandbox, 'LocalAppData');
fs.mkdirSync(localAppData, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(150);
  }
  return false;
}

function startServer(home) {
  const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_TOKEN: 'auto', STUDIO_BRIDGE_PORT: String(serverPort), STUDIO_BRIDGE_RELEASES_URL: `${origin}/releases/latest` };
  delete env.STUDIO_BRIDGE_OFFLINE;
  const child = spawn(command[0], command.slice(1), { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
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
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiters.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result.content[0].text;
  const stop = async () => {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  };
  return { rpc, tool, stop, ready: sleep(900).then(() => rpc('initialize', {})) };
}

const newHome = (name, settings) => {
  const home = path.join(sandbox, name);
  fs.mkdirSync(home, { recursive: true });
  if (settings) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings));
  return home;
};

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

latestTag = 'v9.9.9';
feedRequests = 0;
const homeA = newHome('a');
const first = startServer(homeA);
await first.ready;
const noticed = await until(async () => /Update available: v9\.9\.9/.test(await first.tool('studio_list')), 8000);
check('a newer release shows up as a notice in studio_list', noticed);
check('the notice tells Claude how to install it', /bridge_update/.test(await first.tool('studio_list')));
check('the check asked the feed once and cached the answer', feedRequests === 1 && fs.existsSync(path.join(homeA, 'update-check.json')), `${feedRequests} request(s)`);

const dry = await first.tool('bridge_update');
check('bridge_update without confirm changes nothing and says so', /Nothing was changed/.test(dry) && /confirm true/.test(dry));
if (!target) {
  const source = await first.tool('bridge_update', { confirm: true });
  check('a source checkout cannot update itself through the tool', /source checkout/.test(source));
}
await first.stop();

feedRequests = 0;
const second = startServer(homeA);
await second.ready;
const fromCache = await until(async () => /Update available: v9\.9\.9/.test(await second.tool('studio_list')), 8000);
await sleep(1000);
check('a restart within a day uses the cache and does not ask the feed again', fromCache && feedRequests === 0, `${feedRequests} request(s)`);
await second.stop();

feedRequests = 0;
const homeOff = newHome('off', { checkUpdates: false });
const off = startServer(homeOff);
await off.ready;
await sleep(2500);
check('with check-updates off the feed is never asked and there is no notice', feedRequests === 0 && !/Update available/.test(await off.tool('studio_list')));
await off.stop();

latestTag = 'v0.0.1';
const homeOld = newHome('old');
const old = startServer(homeOld);
await old.ready;
await sleep(2500);
check('an older release produces no notice', !/Update available/.test(await old.tool('studio_list')));
await old.stop();

latestTag = 'v9.9.9';
if (target) {
  const homeTool = newHome('tool');
  const asked = startServer(homeTool);
  await asked.ready;
  const result = await asked.tool('bridge_update', { confirm: true });
  const installedTool = path.join(homeTool, 'studio-bridge.exe');
  check('bridge_update with confirm downloads, verifies and installs', /downloaded, verified against its published checksum and installed/.test(result) && fs.existsSync(installedTool), result.slice(0, 90));
  check('it does not touch the Claude Code registration or leave downloads behind', !fs.existsSync(path.join(homeTool, 'update')));
  check('afterwards studio_list says to restart', /Run \/mcp/.test(await asked.tool('studio_list')));
  check('and the update is written to update-log.txt', /on request/.test(fs.readFileSync(path.join(homeTool, 'update-log.txt'), 'utf8')));
  await asked.stop();

  const homeAuto = newHome('auto', { checkUpdates: true, autoUpdate: true });
  const auto = startServer(homeAuto);
  await auto.ready;
  const installedAuto = path.join(homeAuto, 'studio-bridge.exe');
  const done = await until(async () => fs.existsSync(installedAuto) && /installed/.test(await auto.tool('studio_list')), 20000);
  check('with auto-update on a newer release is installed without being asked', done);
  check('and the automatic update is logged', fs.existsSync(path.join(homeAuto, 'update-log.txt')) && /auto-updated to v9\.9\.9/.test(fs.readFileSync(path.join(homeAuto, 'update-log.txt'), 'utf8')));
  await auto.stop();

  latestTag = 'v0.0.1';
  const homeAutoOld = newHome('autoold', { checkUpdates: true, autoUpdate: true });
  const autoOld = startServer(homeAutoOld);
  await autoOld.ready;
  await sleep(3000);
  check('auto-update does nothing when there is no newer release', !fs.existsSync(path.join(homeAutoOld, 'studio-bridge.exe')));
  await autoOld.stop();
} else {
  console.log('SKIP  install and auto-update scenarios (pass the exe path to run them)');
}

feed.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
