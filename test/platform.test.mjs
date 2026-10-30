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

const override = path.join(sandbox, 'plugins-override');
check('STUDIO_BRIDGE_PLUGINS_DIR wins', platform.pluginsDir(emptyHome, { STUDIO_BRIDGE_PLUGINS_DIR: override }) === path.resolve(override));

if (platform.isWindows) {
  check('Windows uses LOCALAPPDATA', platform.pluginsDir(emptyHome, { LOCALAPPDATA: 'C:\\L' }) === path.join('C:\\L', 'Roblox', 'Plugins'));
  check('Windows data dir is StudioBridge', platform.dataDirName() === 'StudioBridge');
} else {
  check('plugins folder is inside the detected prefix', platform.pluginsDir(flatpakHome, {}) === path.join(flatpakRoblox, 'Plugins'));
  let message = '';
  try {
    platform.pluginsDir(emptyHome, {});
  } catch (err) {
    message = err.message;
  }
  check('missing prefix explains the options', message.includes('STUDIO_BRIDGE_PLUGINS_DIR') && message.includes('Vinegar'));
  check('Linux data dir follows XDG_DATA_HOME', platform.dataDirName() === 'studio-bridge');
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
