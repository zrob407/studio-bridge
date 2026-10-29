import { spawnSync } from 'node:child_process';
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

const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_PORT: '3991' };
const run = (...args) => spawnSync(command[0], [...command.slice(1), ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const version = run('version');
check('version prints the package version', version.status === 0 && /^studio-bridge \d+\.\d+\.\d+/.test(version.stdout), version.stdout.trim());

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

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
