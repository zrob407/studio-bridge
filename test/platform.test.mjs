import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = await import(pathToFileURL(path.join(bridgeDir, 'platform.mjs')).href);
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-platform-'));

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const makeRoblox = (home, prefixParts, user) => {
  const roblox = path.join(home, ...prefixParts, 'drive_c', 'users', user, 'AppData', 'Local', 'Roblox');
  fs.mkdirSync(roblox, { recursive: true });
  return roblox;
};

const emptyHome = path.join(sandbox, 'empty');
fs.mkdirSync(emptyHome);
check('no prefix means no folders', platform.wineRobloxFolders(emptyHome, {}).length === 0);

const flatpakHome = path.join(sandbox, 'flatpak');
const flatpakRoblox = makeRoblox(flatpakHome, ['.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'vinegar', 'prefixes', 'studio'], 'steamuser');
makeRoblox(flatpakHome, ['.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'vinegar', 'prefixes', 'studio'], 'Public');
check('Vinegar flatpak prefix is found and Public is skipped', JSON.stringify(platform.wineRobloxFolders(flatpakHome, {})) === JSON.stringify([flatpakRoblox]));

const nativeHome = path.join(sandbox, 'native');
const nativeRoblox = makeRoblox(nativeHome, ['.local', 'share', 'vinegar', 'prefixes', 'studio'], 'steamuser');
check('native Vinegar prefix is found', platform.wineRobloxFolders(nativeHome, {}).includes(nativeRoblox));

const grapeHome = path.join(sandbox, 'grape');
const grapeRoblox = makeRoblox(grapeHome, ['.local', 'share', 'grapejuice', 'prefixes', 'studio'], 'someone');
check('Grapejuice prefix is found with any user name', platform.wineRobloxFolders(grapeHome, {}).includes(grapeRoblox));

const xdgHome = path.join(sandbox, 'xdg');
const xdgData = path.join(sandbox, 'xdg-data');
const xdgRoblox = makeRoblox(xdgData, ['vinegar', 'prefixes', 'studio'], 'steamuser');
check('XDG_DATA_HOME is honored', platform.wineRobloxFolders(xdgHome, { XDG_DATA_HOME: xdgData }).includes(xdgRoblox));

const wineHome = path.join(sandbox, 'wine');
const customPrefix = path.join(sandbox, 'custom-prefix');
fs.mkdirSync(path.join(customPrefix, 'drive_c', 'users', 'me', 'AppData', 'Local', 'Roblox'), { recursive: true });
check('WINEPREFIX comes first', platform.wineRobloxFolders(wineHome, { WINEPREFIX: customPrefix })[0] === path.join(customPrefix, 'drive_c', 'users', 'me', 'AppData', 'Local', 'Roblox'));

const appdataHome = path.join(sandbox, 'appdata');
const appdataRoblox = path.join(appdataHome, '.local', 'share', 'vinegar', 'appdata', 'Roblox');
fs.mkdirSync(path.dirname(appdataRoblox), { recursive: true });
makeRoblox(appdataHome, ['.local', 'share', 'vinegar', 'prefixes', 'studio'], 'steamuser');
const appdataFolders = platform.wineRobloxFolders(appdataHome, {});
check('Vinegar appdata comes first and the prefix is written too, since either can be the one Studio reads', appdataFolders.length === 2 && appdataFolders[0] === appdataRoblox && appdataFolders[1].includes('prefixes'));
check('Vinegar flatpak appdata folder is found', (() => {
  const home = path.join(sandbox, 'flatpak-appdata');
  const root = path.join(home, '.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'vinegar', 'appdata');
  fs.mkdirSync(root, { recursive: true });
  return platform.wineRobloxFolders(home, {})[0] === path.join(root, 'Roblox');
})());

const override = path.join(sandbox, 'plugins-override');
check('STUDIO_BRIDGE_PLUGINS_DIR wins', platform.pluginsDir(emptyHome, { STUDIO_BRIDGE_PLUGINS_DIR: override }) === path.resolve(override));

if (platform.isWindows) {
  check('Windows uses LOCALAPPDATA', platform.pluginsDir(emptyHome, { LOCALAPPDATA: 'C:\\L' }) === path.join('C:\\L', 'Roblox', 'Plugins'));
  check('Windows data dir is StudioBridge', platform.dataDirName() === 'StudioBridge');
} else {
  check('plugins folder is inside the detected prefix', platform.pluginsDir(flatpakHome, {}) === path.join(flatpakRoblox, 'Plugins'));
  check('Vinegar plugins folder is under appdata', platform.pluginsDirs(appdataHome, {})[0] === path.join(appdataRoblox, 'Plugins'));
  let message = '';
  try {
    platform.pluginsDir(emptyHome, {});
  } catch (err) {
    message = err.message;
  }
  check('missing prefix explains the options', message.includes('STUDIO_BRIDGE_PLUGINS_DIR') && message.includes('Vinegar'));
  check('Linux data dir follows XDG_DATA_HOME', platform.dataDirName() === 'studio-bridge');
}

check('describeHolder names what holds a port', platform.describeHolder(null) === 'nothing' && platform.describeHolder({ studioBridge: false }) === 'another program' && platform.describeHolder({ studioBridge: true, version: '0.6.9' }) === 'Studio Bridge 0.6.9' && /older Studio Bridge/.test(platform.describeHolder({ studioBridge: true, version: null })));
check('the port hint names a command for this system', platform.portHolderHint(3010).includes('3010') && /ss -ltnp|Get-NetTCPConnection/.test(platform.portHolderHint(3010)));
{
  const { createServer } = await import('node:http');
  const fake = (status, body) => new Promise((resolve) => {
    const server = createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const old = await fake(401, { error: 'unauthorized' });
  const current = await fake(401, { error: 'unauthorized', version: '0.6.9' });
  const other = await fake(200, { hello: 'world' });
  const oldHolder = await platform.portHolder(old.address().port);
  const currentHolder = await platform.portHolder(current.address().port);
  const otherHolder = await platform.portHolder(other.address().port);
  const freePort = await new Promise((resolve) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  const nobody = await platform.portHolder(freePort);
  check('a port held by an older Studio Bridge is recognized without a version', oldHolder.studioBridge === true && oldHolder.version === null);
  check('a newer Studio Bridge reports its version', currentHolder.studioBridge === true && currentHolder.version === '0.6.9');
  check('another program on the port is not mistaken for Studio Bridge', otherHolder.studioBridge === false);
  check('a free port has no holder', nobody === null);
  for (const server of [old, current, other]) server.close();
}

const clients = [
  { address: '0x1', title: 'Terminal', mapped: true, at: [0, 0], size: [800, 600] },
  { address: '0x2', title: 'Obby - Roblox Studio', mapped: true, at: [100, 50], size: [2000, 1000] },
  { address: '0x3', title: 'Lure - Roblox Studio', mapped: true, at: [10, 20], size: [1000, 500] },
  { address: '0x4', title: 'Hidden - Roblox Studio', mapped: false, at: [0, 0], size: [1, 1] },
];
check('Hyprland window is matched by place name', platform.findHyprWindow(clients, 'lure').address === '0x3');
check('Hyprland falls back to any Studio window', platform.findHyprWindow(clients, 'missing').address === '0x2');
check('Hyprland skips unmapped and unrelated windows', platform.findHyprWindow(clients.filter((client) => client.address !== '0x2' && client.address !== '0x3'), '') === null);
check('Hyprland handles bad input', platform.findHyprWindow(null, 'x') === null);
const grim = platform.hyprGrimArgs(clients[1], 1000, '/tmp/out.jpg');
check('grim geometry and scale are built from the window', grim.includes('100,50 2000x1000') && grim[grim.indexOf('-s') + 1] === '0.5' && grim.at(-1) === '/tmp/out.jpg');
check('grim does not upscale', platform.hyprGrimArgs(clients[0], 4000, 'o.jpg')[grim.indexOf('-s') + 1] === '1');
check('Hyprland is detected from its environment variable', platform.isHyprland({ HYPRLAND_INSTANCE_SIGNATURE: 'abc' }) === platform.isLinux && platform.isHyprland({}) === false);

check('every tool is offered on Windows', platform.unsupportedTools({ platform: 'win32', hyprland: false, has: () => false }).size === 0);
check('the window screenshot is not offered on a Linux desktop without Hyprland', platform.unsupportedTools({ platform: 'linux', hyprland: false, has: () => true }).has('screenshot'));
check('nor on Hyprland when grim or hyprctl is missing', platform.unsupportedTools({ platform: 'linux', hyprland: true, has: (name) => name === 'hyprctl' }).has('screenshot') && platform.unsupportedTools({ platform: 'linux', hyprland: true, has: (name) => name === 'grim' }).has('screenshot'));
check('but it is offered on Hyprland with both tools installed', !platform.unsupportedTools({ platform: 'linux', hyprland: true, has: () => true }).has('screenshot'));
check('and not on other systems', platform.unsupportedTools({ platform: 'darwin', hyprland: false, has: () => true }).has('screenshot'));
check('a missing command is reported as missing, not as an error', platform.commandExists('definitely-not-a-real-command-xyz') === false);

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
