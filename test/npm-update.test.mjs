import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(bridgeDir, 'cli.mjs');
const pkgName = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'package.json'), 'utf8')).name;
const registryPort = 3976;
const serverPort = 3975;

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-npm-'));
const localAppData = path.join(sandbox, 'LocalAppData');
const npmLog = path.join(sandbox, 'npm-calls.log');
const failFlag = path.join(sandbox, 'fail.flag');
const fakeNpm = path.join(sandbox, 'fake-npm.mjs');
fs.mkdirSync(localAppData, { recursive: true });
fs.writeFileSync(fakeNpm, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(npmLog)}, process.argv.slice(2).join(' ') + '\\n');\nif (fs.existsSync(${JSON.stringify(failFlag)})) {\n  console.error('npm ERR! simulated failure');\n  process.exit(1);\n}\n`);

let registry = { status: 200, version: '9.9.9' };
let registryRequests = 0;
const registryServer = http.createServer((req, res) => {
  registryRequests++;
  if (req.url === `/${pkgName.replace('/', '%2F')}/latest`) {
    res.writeHead(registry.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(registry.status === 200 ? { name: pkgName, version: registry.version } : {}));
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => registryServer.listen(registryPort, '127.0.0.1', resolve));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const calls = () => (fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const newHome = (name, settings) => {
  const home = path.join(sandbox, name);
  fs.mkdirSync(home, { recursive: true });
  if (settings) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings));
  return home;
};
const baseEnv = (home) => ({
  ...process.env,
  LOCALAPPDATA: localAppData,
  CODEX_HOME: path.join(sandbox, 'codex'),
  STUDIO_BRIDGE_HOME: home,
  STUDIO_BRIDGE_INSTALL_MODE: 'npm',
  STUDIO_BRIDGE_NPM_REGISTRY_URL: `http://127.0.0.1:${registryPort}`,
  STUDIO_BRIDGE_NPM_COMMAND: `"${process.execPath}" "${fakeNpm}"`,
  STUDIO_BRIDGE_PORT: String(serverPort),
});

const runCli = (home, ...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: baseEnv(home), windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (status) => resolve({ status, out }));
  });

function startServer(home) {
  const env = { ...baseEnv(home), STUDIO_BRIDGE_TOKEN: crypto.randomBytes(8).toString('hex') };
  delete env.STUDIO_BRIDGE_OFFLINE;
  const child = spawn(process.execPath, [cli, 'serve'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
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
  return { rpc, tool, stop, ready: sleep(900) };
}

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const home = newHome('cli');
const checkOnly = await runCli(home, 'update', '--check');
check('--check asks the npm registry and reports the newer version', checkOnly.status === 0 && /newer version is available: v9\.9\.9/.test(checkOnly.out) && registryRequests >= 1);
check('--check does not run npm', calls().length === 0);

const updated = await runCli(home, 'update', '--no-register');
check('update runs npm install -g for the exact new version', updated.status === 0 && calls().length === 1 && calls()[0] === `install -g ${pkgName}@9.9.9`, calls()[0]);
check('and then refreshes the plugin loader with the installed code', fs.existsSync(path.join(localAppData, 'Roblox', 'Plugins', 'Studio Bridge.rbxmx')) && fs.existsSync(path.join(home, 'token.txt')));

fs.rmSync(path.join(localAppData, 'Roblox'), { recursive: true, force: true });
fs.writeFileSync(failFlag, 'x');
fs.writeFileSync(npmLog, '');
const failed = await runCli(newHome('failed'), 'update', '--no-register');
check('a failing npm install is reported and nothing else happens', failed.status === 1 && /npm could not install the update/.test(failed.out) && !fs.existsSync(path.join(localAppData, 'Roblox', 'Plugins', 'Studio Bridge.rbxmx')));
fs.rmSync(failFlag);

registry = { status: 200, version: '0.0.1' };
const older = await runCli(newHome('older'), 'update');
check('an older registry version is reported as up to date', older.status === 0 && /is up to date/.test(older.out));
registry = { status: 404, version: '' };
const unpublished = await runCli(newHome('unpublished'), 'update', '--check');
check('a package that is not on npm yet says so', unpublished.status === 0 && /not been published to npm yet/.test(unpublished.out));
registry = { status: 200, version: '9.9.9' };

fs.writeFileSync(npmLog, '');
const toolHome = newHome('tool');
const asked = startServer(toolHome);
await asked.ready;
await asked.rpc('initialize', {});
let noticed = false;
for (let attempt = 0; attempt < 40 && !noticed; attempt++) {
  noticed = /Update available: v9\.9\.9/.test(await asked.tool('studio_list'));
  if (!noticed) await sleep(150);
}
check('the server notices a newer npm version and says so in studio_list', noticed);
const dry = await asked.tool('bridge_update');
check('bridge_update without confirm changes nothing', /Nothing was changed/.test(dry) && calls().length === 0);
const confirmed = await asked.tool('bridge_update', { confirm: true });
check('bridge_update with confirm installs through npm and says how', /installed with npm/.test(confirmed) && calls().length === 1 && calls()[0] === `install -g ${pkgName}@9.9.9`, confirmed.slice(0, 80));
check('and the update is logged', /on request/.test(fs.readFileSync(path.join(toolHome, 'update-log.txt'), 'utf8')));
await asked.stop();

fs.writeFileSync(npmLog, '');
const autoHome = newHome('auto', { checkUpdates: true, autoUpdate: true });
const auto = startServer(autoHome);
await auto.ready;
await auto.rpc('initialize', {});
let applied = false;
for (let attempt = 0; attempt < 60 && !applied; attempt++) {
  applied = calls().length === 1;
  if (!applied) await sleep(200);
}
check('with auto-update on, a newer npm version is installed without being asked', applied && calls()[0] === `install -g ${pkgName}@9.9.9`);
check('and it is logged', fs.existsSync(path.join(autoHome, 'update-log.txt')) && /auto-updated to v9\.9\.9/.test(fs.readFileSync(path.join(autoHome, 'update-log.txt'), 'utf8')));
await auto.stop();

registryServer.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
