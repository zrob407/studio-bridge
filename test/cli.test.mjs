import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const command = target ? [path.resolve(target)] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-cli-'));
const localAppData = path.join(sandbox, 'LocalAppData');
const home = path.join(sandbox, 'home');
const pluginsDir = path.join(localAppData, 'Roblox', 'Plugins');
fs.mkdirSync(pluginsDir, { recursive: true });

const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_PORT: '3991', STUDIO_BRIDGE_OFFLINE: '1', CODEX_HOME: path.join(sandbox, 'unused-codex-home') };
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

const oldFolder = path.join(sandbox, 'old-source-install');
fs.mkdirSync(path.join(oldFolder, 'exports'), { recursive: true });
const oldToken = 'ab'.repeat(32);
fs.writeFileSync(path.join(oldFolder, 'token.txt'), oldToken);
fs.writeFileSync(path.join(oldFolder, 'uploads.json'), '{"records":[1]}');
fs.writeFileSync(path.join(oldFolder, 'asset-owners.json'), '{"owners":[2]}');
fs.writeFileSync(path.join(oldFolder, 'exports', 'keep.rbxm'), 'x');
const migrateRun = (homeName, ...args) => {
  const migrateHome = path.join(sandbox, homeName);
  const finished = spawnSync(command[0], [...command.slice(1), 'install', '--no-register', ...args], { env: { ...env, STUDIO_BRIDGE_HOME: migrateHome }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { home: migrateHome, status: finished.status, out: `${finished.stdout || ''}${finished.stderr || ''}` };
};

const migrated = migrateRun('migrated', '--migrate-from', oldFolder);
check('installing over an old source install reuses its token', migrated.status === 0 && fs.readFileSync(path.join(migrated.home, 'token.txt'), 'utf8').trim() === oldToken && /Reused the token/.test(migrated.out));
check('the new plugin loader carries that same token', fs.readFileSync(pluginPath, 'utf8').includes(oldToken));
check('upload and owner records are carried over', fs.readFileSync(path.join(migrated.home, 'uploads.json'), 'utf8') === '{"records":[1]}' && fs.readFileSync(path.join(migrated.home, 'asset-owners.json'), 'utf8') === '{"owners":[2]}');
check('the old folder is left untouched', fs.existsSync(path.join(oldFolder, 'token.txt')) && fs.existsSync(path.join(oldFolder, 'exports', 'keep.rbxm')) && /left untouched/.test(migrated.out));
check('large exports are not copied', !fs.existsSync(path.join(migrated.home, 'exports')));

fs.writeFileSync(path.join(migrated.home, 'uploads.json'), '{"records":["newer"]}');
migrateRun('migrated', '--migrate-from', oldFolder);
check('installing again never overwrites files that already exist', fs.readFileSync(path.join(migrated.home, 'uploads.json'), 'utf8') === '{"records":["newer"]}');

const homeWithToken = path.join(sandbox, 'has-token');
fs.mkdirSync(homeWithToken, { recursive: true });
fs.writeFileSync(path.join(homeWithToken, 'token.txt'), 'cd'.repeat(32));
const keptToken = migrateRun('has-token', '--migrate-from', oldFolder);
check('an existing token in the new location is kept', fs.readFileSync(path.join(homeWithToken, 'token.txt'), 'utf8').trim() === 'cd'.repeat(32) && !/Reused the token/.test(keptToken.out));

const garbageFolder = path.join(sandbox, 'garbage-old');
fs.mkdirSync(garbageFolder, { recursive: true });
fs.writeFileSync(path.join(garbageFolder, 'token.txt'), 'not a token');
const garbage = migrateRun('garbage-home', '--migrate-from', garbageFolder);
check('a token file that is not a real token is ignored', garbage.status === 0 && fs.readFileSync(path.join(garbage.home, 'token.txt'), 'utf8').trim().length === 64 && !/Reused the token/.test(garbage.out));

const absent = migrateRun('absent-home', '--migrate-from', path.join(sandbox, 'does-not-exist'));
check('a missing old folder is not an error', absent.status === 0);

const fakeBin = path.join(sandbox, 'fake-bin');
const claudeLog = path.join(sandbox, 'claude-calls.log');
fs.mkdirSync(fakeBin, { recursive: true });
const oldScript = path.join(oldFolder, 'server.mjs');
fs.writeFileSync(
  path.join(fakeBin, 'claude.cmd'),
  [
    '@echo off',
    'if "%1"=="mcp" if "%2"=="get" goto get',
    'if "%1"=="mcp" if "%2"=="remove" goto remove',
    'if "%1"=="mcp" if "%2"=="add" goto add',
    'exit /b 1',
    ':get',
    'echo studio-bridge:',
    'echo   Scope: User config (available in all your projects)',
    'echo   Type: stdio',
    'echo   Command: node',
    `echo   Args: ${oldScript}`,
    'exit /b 0',
    ':remove',
    `echo remove %* >> "${claudeLog}"`,
    'exit /b 0',
    ':add',
    `echo add %* >> "${claudeLog}"`,
    'exit /b 0',
    '',
  ].join('\r\n'),
);
const registerHome = path.join(sandbox, 'register-home');
const registerEnv = { ...env, STUDIO_BRIDGE_HOME: registerHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
const registered = spawnSync(command[0], [...command.slice(1), 'install'], { env: registerEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
const registeredOut = `${registered.stdout || ''}${registered.stderr || ''}`;
const calls = fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8') : '';
check('the installer finds the old source install from its Claude Code registration', registered.status === 0 && fs.existsSync(path.join(registerHome, 'token.txt')) && fs.readFileSync(path.join(registerHome, 'token.txt'), 'utf8').trim() === oldToken, registeredOut.split('\n').slice(0, 3).join(' | '));
check('it replaces the old registration instead of adding a second one', /remove/.test(calls) && /add/.test(calls) && calls.indexOf('remove') < calls.indexOf('add') && /replacing the previous registration/.test(registeredOut));
check('the new registration is a user-scope entry named studio-bridge', /add .*--scope user.* studio-bridge -- /.test(calls));
const oldDoctor = spawnSync(command[0], [...command.slice(1), 'doctor'], { env: { ...registerEnv, STUDIO_BRIDGE_OFFLINE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
check('doctor warns when Claude Code still starts the old source version', /WARN\s+Claude Code still starts the old source version/.test(oldDoctor.stdout || ''));

const codexHome = path.join(sandbox, 'codex');
const codexFile = path.join(codexHome, 'config.toml');
fs.mkdirSync(codexHome, { recursive: true });
fs.writeFileSync(codexFile, 'model = "gpt-5"\r\n# keep me\r\n\r\n[mcp_servers.other]\r\ncommand = "other-tool"\r\nargs = ["--x"]\r\n');
const codexInstallHome = path.join(sandbox, 'codex-install-home');
const codexEnv = { ...registerEnv, STUDIO_BRIDGE_HOME: codexInstallHome, CODEX_HOME: codexHome };
const runCodex = (...args) => {
  const finished = spawnSync(command[0], [...command.slice(1), ...args], { env: codexEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { status: finished.status, out: `${finished.stdout || ''}${finished.stderr || ''}` };
};
const claudeCallsBefore = fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8') : '';
const codexInstall = runCodex('install', '--client', 'codex');
const codexText = fs.readFileSync(codexFile, 'utf8');
const codexParsed = parseToml(codexText);
const entry = (codexParsed.mcp_servers || {})['studio-bridge'] || {};
const expectedCommand = target ? path.join(codexInstallHome, 'studio-bridge.exe') : process.execPath;
check('install --client codex registers with Codex', codexInstall.status === 0 && /Registered with Codex/.test(codexInstall.out), codexInstall.out.split('\n')[1]);
check('and does not touch Claude Code', (fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8') : '') === claudeCallsBefore);
check('the entry is valid TOML with the right command, args and timeouts', entry.command === expectedCommand && Array.isArray(entry.args) && entry.args[entry.args.length - 1] === 'serve' && entry.tool_timeout_sec === 600 && entry.startup_timeout_sec === 30, JSON.stringify(entry).slice(0, 120));
check('the port is passed through when one is set', entry.env && entry.env.STUDIO_BRIDGE_PORT === '3991');
check('existing Codex settings and other servers are preserved', codexParsed.model === 'gpt-5' && codexParsed.mcp_servers.other.command === 'other-tool' && /# keep me/.test(codexText));
check('Windows line endings in the file are kept', /\r\n/.test(codexText) && !/[^\r]\n/.test(codexText));
runCodex('install', '--client', 'codex');
const again = fs.readFileSync(codexFile, 'utf8');
check('installing again replaces the entry instead of adding another', (again.match(/\[mcp_servers\.studio-bridge\]/g) || []).length === 1 && Object.keys(parseToml(again).mcp_servers).length === 2);
const codexDoctor = runCodex('doctor');
check('doctor reports the Codex registration', /ok\s+registered with Codex/.test(codexDoctor.out));
const badClient = runCodex('install', '--client', 'bogus');
check('an unknown client is refused with a clear message', badClient.status === 1 && /--client must be/.test(badClient.out));
const codexUninstall = runCodex('uninstall');
const afterUninstall = parseToml(fs.readFileSync(codexFile, 'utf8'));
check('uninstall removes only our Codex entry', codexUninstall.status === 0 && !(afterUninstall.mcp_servers || {})['studio-bridge'] && afterUninstall.mcp_servers.other.command === 'other-tool' && afterUninstall.model === 'gpt-5');
fs.rmSync(codexFile);
runCodex('install', '--client', 'codex');
check('a missing Codex config file is created', fs.existsSync(codexFile) && Boolean(parseToml(fs.readFileSync(codexFile, 'utf8')).mcp_servers['studio-bridge']));

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
