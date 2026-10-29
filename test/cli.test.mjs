import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const command = target ? [path.resolve(target)] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-cli-'));
const localAppData = path.join(sandbox, 'LocalAppData');
const home = path.join(sandbox, 'home');
const pluginsDir = path.join(localAppData, 'Roblox', 'Plugins');
fs.mkdirSync(pluginsDir, { recursive: true });

const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_PORT: '3991', STUDIO_BRIDGE_OFFLINE: '1' };
const run = (...args) => spawnSync(command[0], [...command.slice(1), ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const version = run('version');
check('version prints the package version', version.status === 0 && /^studio-bridge \d+\.\d+\.\d+/.test(version.stdout), version.stdout.trim());

const licenses = run('licenses');
check('licenses prints the Studio Bridge License and the Node.js notice', licenses.status === 0 && /Studio Bridge License/.test(licenses.stdout) && /No selling the Software/.test(licenses.stdout) && /Node\.js is licensed for use as follows/.test(licenses.stdout), licenses.stdout.split('\n')[0]);

const unknown = run('nonsense');
check('an unknown command prints help and fails', unknown.status === 1 && /Usage: studio-bridge/.test(unknown.stdout));

fs.writeFileSync(path.join(pluginsDir, 'ClaudeStudioBridge.rbxmx'), 'old');
const first = run('install', '--no-register');
const pluginPath = path.join(pluginsDir, 'Studio Bridge.rbxmx');
check('install succeeds', first.status === 0, (first.stderr || '').trim());
check('install writes a token', fs.existsSync(path.join(home, 'token.txt')) && fs.readFileSync(path.join(home, 'token.txt'), 'utf8').trim().length === 64);
check('install writes the plugin under its new name', fs.existsSync(pluginPath));
check('install removes the old plugin file', !fs.existsSync(path.join(pluginsDir, 'ClaudeStudioBridge.rbxmx')));
const token = fs.readFileSync(path.join(home, 'token.txt'), 'utf8').trim();
const loader = fs.readFileSync(pluginPath, 'utf8');
check('the plugin is the loader with the token and port filled in', loader.includes('hmacSha256Hex') && loader.includes(token) && loader.includes('127.0.0.1:3991') && !loader.includes('__TOKEN__') && !loader.includes('__PORT__'));
check('the plugin is named Studio Bridge', loader.includes('<string name="Name">Studio Bridge</string>'));

const second = run('install', '--no-register');
check('a second install keeps the same token', second.status === 0 && fs.readFileSync(path.join(home, 'token.txt'), 'utf8').trim() === token);

const standalone = run('install', '--standalone', '--no-register');
const full = fs.readFileSync(pluginPath, 'utf8');
check('standalone install writes the full plugin', standalone.status === 0 && full.includes('runSocketSession') && !full.includes('hmacSha256Hex'));

run('install', '--no-register');
const doctor = run('doctor');
check('doctor reports the token and the loader', doctor.status === 0 && /ok\s+token\.txt exists/.test(doctor.stdout) && /Studio Bridge\.rbxmx is installed \(loader\)/.test(doctor.stdout), doctor.stdout.split('\n').slice(0, 3).join(' | '));
check('doctor finds the embedded screenshot helper', /ok\s+screenshot helper is available/.test(doctor.stdout), (doctor.stdout.match(/screenshot helper[^\n]*/) || [''])[0]);
check('doctor sees that the bridge is not running', /not running on port 3991/.test(doctor.stdout));

fs.writeFileSync(path.join(pluginsDir, 'ClaudeStudioBridge.rbxmx'), 'old');
const warned = run('doctor');
check('doctor warns about a leftover old plugin file', /WARN\s+old plugin file ClaudeStudioBridge\.rbxmx/.test(warned.stdout));
fs.unlinkSync(path.join(pluginsDir, 'ClaudeStudioBridge.rbxmx'));

const uninstall = run('uninstall', '--no-register');
check('uninstall removes the plugin but keeps the data', uninstall.status === 0 && !fs.existsSync(pluginPath) && fs.existsSync(path.join(home, 'token.txt')));

run('install', '--no-register');
const purge = run('uninstall', '--no-register', '--purge');
check('uninstall --purge also deletes the data folder', purge.status === 0 && !fs.existsSync(home) && !fs.existsSync(pluginPath));

if (target) {
  const lockHome = path.join(sandbox, 'lockhome');
  fs.mkdirSync(lockHome, { recursive: true });
  const installed = path.join(lockHome, 'studio-bridge.exe');
  const leftover = path.join(lockHome, 'studio-bridge.exe.old');
  fs.copyFileSync(target, installed);
  fs.copyFileSync(target, leftover);
  const lockEnv = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: lockHome, STUDIO_BRIDGE_TOKEN: 'lock', STUDIO_BRIDGE_OFFLINE: '1' };
  const holders = [
    spawn(installed, ['serve'], { env: { ...lockEnv, STUDIO_BRIDGE_PORT: '3981' }, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }),
    spawn(leftover, ['serve'], { env: { ...lockEnv, STUDIO_BRIDGE_PORT: '3982' }, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }),
  ];
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const locked = spawnSync(target, ['install', '--no-register'], { env: lockEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lockedOut = `${locked.stdout || ''}${locked.stderr || ''}`;
  check('installing while the installed exe and a stale leftover are both running succeeds', locked.status === 0 && /Updated the installed exe/.test(lockedOut) && !/Could not replace/.test(lockedOut), lockedOut.trim().split('\n')[0]);
  const names = fs.readdirSync(lockHome);
  check('the running copy is moved aside under a unique name', names.some((name) => /^studio-bridge\.exe\.old-\d+$/.test(name)) && names.includes('studio-bridge.exe'), names.join(', '));
  for (const holder of holders) {
    holder.kill();
    await new Promise((resolve) => holder.once('exit', resolve));
  }
  const again = spawnSync(target, ['install', '--no-register'], { env: lockEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const remaining = fs.readdirSync(lockHome).filter((name) => name.startsWith('studio-bridge.exe.old'));
  check('leftover copies are cleaned up once they are no longer running', again.status === 0 && remaining.length === 0, remaining.join(', ') || 'none left');
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
