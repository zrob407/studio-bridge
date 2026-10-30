import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

export function dataRoot() {
  if (isWindows) return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  return path.join(os.homedir(), '.local', 'share');
}

export function dataDirName() {
  return isWindows ? 'StudioBridge' : 'studio-bridge';
}

function listDirs(folder) {
  try {
    return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function winePrefixRoots(home = os.homedir(), env = process.env) {
  const roots = [];
  if (env.WINEPREFIX) roots.push(env.WINEPREFIX);
  roots.push(path.join(home, '.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'vinegar', 'prefixes', 'studio'));
  roots.push(path.join(home, '.local', 'share', 'vinegar', 'prefixes', 'studio'));
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  roots.push(path.join(dataHome, 'vinegar', 'prefixes', 'studio'));
  roots.push(path.join(dataHome, 'grapejuice', 'prefixes', 'studio'));
  roots.push(path.join(home, '.wine'));
  return [...new Set(roots)];
}

export function wineRobloxFolders(home = os.homedir(), env = process.env) {
  const found = [];
  for (const root of winePrefixRoots(home, env)) {
    const users = path.join(root, 'drive_c', 'users');
    for (const user of listDirs(users)) {
      if (user === 'Public') continue;
      const roblox = path.join(users, user, 'AppData', 'Local', 'Roblox');
      if (fs.existsSync(roblox)) found.push(roblox);
    }
  }
  return found;
}

export function pluginsDir(home = os.homedir(), env = process.env) {
  if (env.STUDIO_BRIDGE_PLUGINS_DIR) return path.resolve(env.STUDIO_BRIDGE_PLUGINS_DIR);
  if (isWindows) {
    const base = env.LOCALAPPDATA;
    if (!base) throw new Error('LOCALAPPDATA is not set, so the Studio plugin folder cannot be found. Set STUDIO_BRIDGE_PLUGINS_DIR to the folder that Studio loads plugins from.');
    return path.join(base, 'Roblox', 'Plugins');
  }
  const folders = wineRobloxFolders(home, env);
  if (folders.length === 0) {
    throw new Error(
      'No Roblox Studio Wine prefix was found. Roblox has no native Linux Studio, so Studio Bridge looks for it under Vinegar, Grapejuice, $WINEPREFIX and ~/.wine. ' +
        'Start Studio once from your launcher so the prefix exists, or set STUDIO_BRIDGE_PLUGINS_DIR to the Roblox/Plugins folder inside your prefix (drive_c/users/<user>/AppData/Local/Roblox/Plugins).',
    );
  }
  return path.join(folders[0], 'Plugins');
}
