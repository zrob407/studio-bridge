import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'package.json'), 'utf8'));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-package-'));
const localAppData = path.join(sandbox, 'LocalAppData');
const prefix = path.join(sandbox, 'prefix');
fs.mkdirSync(localAppData, { recursive: true });
fs.mkdirSync(prefix, { recursive: true });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const shell = (line, options = {}) => spawnSync(line, { shell: true, encoding: 'utf8', windowsHide: true, timeout: 180000, ...options });

const packed = shell(`npm pack --json --pack-destination "${sandbox}"`, { cwd: bridgeDir });
const packInfo = JSON.parse(packed.stdout)[0];
const tarball = path.join(sandbox, packInfo.filename);
const names = packInfo.files.map((file) => file.path);

check('the package has the scoped name and a studio-bridge command', pkg.name === '@zrob407/studio-bridge' && pkg.bin && pkg.bin['studio-bridge'] === 'cli.mjs' && pkg.private !== true);
check('the tarball contains the program, the tools and the plugin sources', ['cli.mjs', 'server.mjs', 'checks.mjs', 'tools.json', 'plugin.template.lua', 'plugin.stub.lua', 'LICENSE', 'handlers/_prelude.luau', 'handlers/script_get.luau'].every((name) => names.includes(name)), `${names.length} files`);
const forbidden = names.filter((name) => /^(test|build|dist|exports|node_modules|\.github)\//.test(name) || /(^|\/)(token\.txt|uploads\.json|asset-owners\.json|settings\.json|update-log\.txt)$/.test(name) || /\.key$/.test(name));
check('no tests, build files, tokens or local data are published', forbidden.length === 0, forbidden.join(', '));
check('the tarball is small', packInfo.size < 400 * 1024, `${(packInfo.size / 1024).toFixed(0)} KB`);

const installed = shell(`npm install --prefix "${prefix}" "${tarball}" --no-audit --no-fund --ignore-scripts`);
const packageDir = path.join(prefix, 'node_modules', ...pkg.name.split('/'));
const cli = path.join(packageDir, 'cli.mjs');
check('npm installs the tarball', installed.status === 0 && fs.existsSync(cli), (installed.stderr || '').trim().split('\n').pop());
check('npm creates the studio-bridge command', fs.existsSync(path.join(prefix, 'node_modules', '.bin', 'studio-bridge.cmd')));

const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_OFFLINE: '1', STUDIO_BRIDGE_PORT: '3977', CODEX_HOME: path.join(sandbox, 'codex') };
delete env.STUDIO_BRIDGE_HOME;
const run = (...args) => {
  const finished = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { status: finished.status, out: `${finished.stdout || ''}${finished.stderr || ''}` };
};

const version = run('version');
check('the installed package runs and reports its version', version.status === 0 && version.out.trim() === `studio-bridge ${pkg.version}`, version.out.trim());
const viaShim = shell(`"${path.join(prefix, 'node_modules', '.bin', 'studio-bridge.cmd')}" version`, { env });
check('the command shim runs it too', viaShim.status === 0 && /studio-bridge \d/.test(viaShim.stdout), (viaShim.stdout || '').trim());

const install = run('install', '--no-register');
const dataDir = path.join(localAppData, 'StudioBridge');
check('install keeps its data outside npm\'s folder, in the app data folder', install.status === 0 && fs.existsSync(path.join(dataDir, 'token.txt')) && !fs.existsSync(path.join(packageDir, 'token.txt')));
check('install writes the plugin loader with that token', fs.readFileSync(path.join(localAppData, 'Roblox', 'Plugins', 'Studio Bridge.rbxmx'), 'utf8').includes(fs.readFileSync(path.join(dataDir, 'token.txt'), 'utf8').trim()));
const doctor = run('doctor');
check('doctor recognises an npm install', /npm package, node/.test(doctor.out) && /ok\s+token\.txt exists/.test(doctor.out));

const server = spawn(process.execPath, [cli, 'serve'], { env: { ...env, STUDIO_BRIDGE_TOKEN: crypto.randomBytes(16).toString('hex') }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
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
await new Promise((resolve) => setTimeout(resolve, 900));
const initialized = await rpc('initialize', {});
const listed = await rpc('tools/list', {});
const expectedTools = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8')).tools.length;
check('the installed server answers the MCP handshake', initialized.result && initialized.result.serverInfo.version === pkg.version);
check('and lists every tool from the packaged tools.json', listed.result.tools.length === expectedTools, `${listed.result.tools.length} tools`);
const batchEnum = listed.result.tools.find((tool) => tool.name === 'batch').inputSchema.properties.operations.items.properties.tool.enum;
check('the packaged handler files are found', batchEnum.includes('script_get') && batchEnum.includes('instance_find'), `${batchEnum.length} batchable`);
server.kill();
await new Promise((resolve) => server.once('exit', resolve));

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
