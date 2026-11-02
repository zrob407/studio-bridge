import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';
export const isMac = process.platform === 'darwin';

export async function portHolder(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/plugin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2000) });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && body.error === 'unauthorized') return { studioBridge: true, version: typeof body.version === 'string' ? body.version : null };
    return { studioBridge: false };
  } catch (err) {
    return err && err.cause && err.cause.code === 'ECONNREFUSED' ? null : { studioBridge: false };
  }
}

export function portHolderHint(port, system = process.platform) {
  if (system === 'win32') return `find it with: Get-NetTCPConnection -LocalPort ${port} | Select OwningProcess`;
  if (system === 'darwin') return `find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  return `find it with: ss -ltnp | grep ${port}`;
}

export function describeHolder(holder) {
  if (!holder) return 'nothing';
  if (!holder.studioBridge) return 'another program';
  return holder.version ? `Studio Bridge ${holder.version}` : 'an older Studio Bridge (before 0.6.9, which does not report its version)';
}

export function dataRoot(system = process.platform, env = process.env, home = os.homedir()) {
  if (system === 'win32') return env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  if (system === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (env.XDG_DATA_HOME) return env.XDG_DATA_HOME;
  return path.join(home, '.local', 'share');
}

export function dataDirName(system = process.platform) {
  return system === 'win32' || system === 'darwin' ? 'StudioBridge' : 'studio-bridge';
}

export function isHyprland(env = process.env) {
  return isLinux && Boolean(env.HYPRLAND_INSTANCE_SIGNATURE);
}

export function findHyprWindow(clients, titleLike) {
  const wanted = String(titleLike || '').toLowerCase();
  const mapped = (Array.isArray(clients) ? clients : []).filter((client) => client && client.mapped !== false && typeof client.title === 'string');
  const studio = mapped.filter((client) => client.title.toLowerCase().includes('roblox studio'));
  const exact = wanted ? mapped.filter((client) => client.title.toLowerCase().includes(wanted)) : [];
  return exact[0] || studio[0] || null;
}

export function hyprGrimArgs(client, maxWidth, outPath) {
  const [x, y] = client.at;
  const [width, height] = client.size;
  const scale = Math.min(1, Number(maxWidth) / width) || 1;
  return ['-t', 'jpeg', '-q', '80', '-s', String(scale), '-g', `${x},${y} ${width}x${height}`, outPath];
}

export const MAC_WINDOW_SCRIPT = `ObjC.import('CoreGraphics');
const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
const list = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
JSON.stringify(list.map((w) => ({
  id: w.kCGWindowNumber,
  owner: w.kCGWindowOwnerName || '',
  title: w.kCGWindowName || '',
  layer: w.kCGWindowLayer,
  width: w.kCGWindowBounds ? w.kCGWindowBounds.Width : 0,
  height: w.kCGWindowBounds ? w.kCGWindowBounds.Height : 0,
})));`;

export function findMacWindow(windows, titleLike) {
  const wanted = String(titleLike || '').toLowerCase();
  const candidates = (Array.isArray(windows) ? windows : []).filter((window) => window && typeof window.owner === 'string' && /roblox/i.test(window.owner) && window.layer === 0 && window.width >= 200 && window.height >= 150 && Number.isFinite(window.id));
  const byTitle = wanted ? candidates.filter((window) => String(window.title || '').toLowerCase().includes(wanted)) : [];
  const pool = byTitle.length > 0 ? byTitle : candidates;
  const studio = pool.filter((window) => /roblox studio/i.test(window.title || ''));
  const ranked = (studio.length > 0 ? studio : pool).slice().sort((a, b) => b.width * b.height - a.width * a.height);
  return ranked[0] || null;
}

export function macCaptureArgs(windowId, outPath) {
  return ['-x', '-o', '-l', String(windowId), '-t', 'jpg', outPath];
}

export function parsePixelWidth(sipsOutput) {
  const match = /pixelWidth:\s*(\d+)/.exec(String(sipsOutput || ''));
  return match ? Number(match[1]) : null;
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

export function vinegarAppdataRoots(home = os.homedir(), env = process.env) {
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return [
    path.join(home, '.var', 'app', 'org.vinegarhq.Vinegar', 'data', 'vinegar', 'appdata'),
    path.join(home, '.local', 'share', 'vinegar', 'appdata'),
    path.join(dataHome, 'vinegar', 'appdata'),
  ].filter((root, index, all) => all.indexOf(root) === index);
}

export function wineRobloxFolders(home = os.homedir(), env = process.env) {
  const vinegar = vinegarAppdataRoots(home, env).filter((root) => fs.existsSync(root)).map((root) => path.join(root, 'Roblox'));
  const found = [...vinegar];
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

export function pluginsDirs(home = os.homedir(), env = process.env, system = process.platform) {
  if (env.STUDIO_BRIDGE_PLUGINS_DIR) return [path.resolve(env.STUDIO_BRIDGE_PLUGINS_DIR)];
  if (system === 'win32') {
    const base = env.LOCALAPPDATA;
    if (!base) throw new Error('LOCALAPPDATA is not set, so the Studio plugin folder cannot be found. Set STUDIO_BRIDGE_PLUGINS_DIR to the folder that Studio loads plugins from.');
    return [path.join(base, 'Roblox', 'Plugins')];
  }
  if (system === 'darwin') return [path.join(home, 'Documents', 'Roblox', 'Plugins'), path.join(home, 'Library', 'Application Support', 'Roblox', 'Plugins')];
  const folders = wineRobloxFolders(home, env);
  if (folders.length === 0) {
    throw new Error(
      'No Roblox Studio Wine prefix was found. Roblox has no native Linux Studio, so Studio Bridge looks for it under Vinegar, Grapejuice, $WINEPREFIX and ~/.wine. ' +
        'Start Studio once from your launcher so the prefix exists, or set STUDIO_BRIDGE_PLUGINS_DIR to the Roblox/Plugins folder inside your prefix (drive_c/users/<user>/AppData/Local/Roblox/Plugins).',
    );
  }
  return folders.map((folder) => path.join(folder, 'Plugins'));
}

export function pluginsDir(home = os.homedir(), env = process.env, system = process.platform) {
  return pluginsDirs(home, env, system)[0];
}

const probed = new Map();

export function commandExists(name) {
  if (!probed.has(name)) probed.set(name, !spawnSync(name, ['-h'], { stdio: 'ignore', timeout: 5000 }).error);
  return probed.get(name);
}

export function unsupportedTools({ platform = process.platform, hyprland = isHyprland(), has = commandExists } = {}) {
  const unsupported = new Set();
  const canCapture = platform === 'win32' || (platform === 'darwin' && has('screencapture') && has('osascript') && has('sips')) || (platform === 'linux' && hyprland && has('hyprctl') && has('grim'));
  if (!canCapture) unsupported.add('screenshot');
  return unsupported;
}
