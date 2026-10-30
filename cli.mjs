#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appDir, assetFile, isPackaged, readAsset } from './paths.mjs';
import { isHyprland, isWindows, pluginsDir, wineRobloxFolders } from './platform.mjs';
import { checkLicense, licenseHash, TAMPER_MESSAGE } from './checks.mjs';
import { applyRelease, checkForUpdate, currentVersion, isNewer, latestUpdate, loadSettings, saveSettings, updateMode } from './updater.mjs';

const PLUGIN_FILE = 'Studio Bridge.rbxmx';
const LEGACY_FILES = ['ClaudeStudioBridge.rbxmx', 'ClaudeStudioBridge.lua'];
const MCP_NAME = 'studio-bridge';

function userArgs() {
  if (!isPackaged) return process.argv.slice(2);
  const second = process.argv[1];
  if (second && path.resolve(second) === path.resolve(process.execPath)) return process.argv.slice(2);
  return process.argv.slice(1);
}

const version = currentVersion;

function ensureToken() {
  fs.mkdirSync(appDir, { recursive: true });
  const file = path.join(appDir, 'token.txt');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(file, 'utf8').trim();
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runClaude(args) {
  return spawnSync(['claude', ...args].join(' '), { shell: true, encoding: 'utf8', windowsHide: true });
}

function claudeMissing(result) {
  const text = `${result.stdout || ''}${result.stderr || ''}`.toLowerCase();
  return result.error !== undefined || /not recognized|not found|no such file/.test(text);
}

function removeOldCopies() {
  let names = [];
  try {
    names = fs.readdirSync(appDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^studio-bridge\.exe\.old(-\d+)?$/.test(name)) continue;
    try {
      fs.rmSync(path.join(appDir, name), { force: true });
    } catch {}
  }
}

function stableServerCommand() {
  if (!isPackaged) return [process.execPath, fileURLToPath(import.meta.url), 'serve'];
  const target = path.join(appDir, 'studio-bridge.exe');
  removeOldCopies();
  const aside = `${target}.old-${Date.now()}`;
  if (path.resolve(target) !== path.resolve(process.execPath)) {
    try {
      fs.copyFileSync(process.execPath, target);
    } catch (err) {
      if (!fs.existsSync(target)) throw err;
      try {
        fs.renameSync(target, aside);
        fs.copyFileSync(process.execPath, target);
        console.log('Updated the installed exe. The copy that is running keeps going until Claude Code restarts it (run /mcp).');
      } catch (renameError) {
        console.log(`Could not replace ${target} (${renameError.code}). Close Claude Code and run the installer again to update it.`);
      }
    }
  }
  return [target, 'serve'];
}

function writePlugin(token, port, standalone) {
  const template = readAsset(standalone ? 'plugin.template.lua' : 'plugin.stub.lua');
  const source = template.replace('__PORT__', port).replace('__TOKEN__', token);
  if (source.includes(']]>')) throw new Error('plugin source contains a CDATA terminator');
  const model = `<roblox version="4">\n\t<Item class="Script" referent="RBX0">\n\t\t<Properties>\n\t\t\t<string name="Name">Studio Bridge</string>\n\t\t\t<ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString>\n\t\t</Properties>\n\t</Item>\n</roblox>\n`;
  const folder = pluginsDir();
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, PLUGIN_FILE);
  fs.writeFileSync(target, model);
  for (const legacyName of LEGACY_FILES) {
    const legacy = path.join(folder, legacyName);
    if (!fs.existsSync(legacy)) continue;
    try {
      fs.unlinkSync(legacy);
      console.log(`Removed the old plugin file ${legacyName}`);
    } catch (err) {
      console.log(`Could not remove ${legacy} (${err.code}); close Studio and delete it, or two copies of the plugin will load.`);
    }
  }
  return target;
}

function register(command, port) {
  const env = process.env.STUDIO_BRIDGE_PORT ? ` -e STUDIO_BRIDGE_PORT=${port}` : '';
  const commandLine = command.map(quote).join(' ');
  const manual = `claude mcp add --scope user${env} ${MCP_NAME} -- ${commandLine}`;
  const existing = runClaude(['mcp', 'get', MCP_NAME]);
  if (claudeMissing(existing)) {
    console.log('The claude command was not found, so Claude Code was not configured. Run this yourself:');
    console.log(`  ${manual}`);
    return false;
  }
  if (existing.status === 0) runClaude(['mcp', 'remove', MCP_NAME, '--scope', 'user']);
  const added = spawnSync(manual, { shell: true, encoding: 'utf8', windowsHide: true });
  if (added.status !== 0) {
    console.log(`Registering with Claude Code failed: ${(added.stderr || added.stdout || '').trim()}`);
    console.log('Run this yourself:');
    console.log(`  ${manual}`);
    return false;
  }
  console.log(existing.status === 0 ? 'Registered with Claude Code (user scope), replacing the previous registration.' : 'Registered with Claude Code (user scope).');
  return true;
}

function parseRegistration(text) {
  const command = /^\s*Command:\s*(.+?)\s*$/m.exec(text);
  const args = /^\s*Args:\s*(.*?)\s*$/m.exec(text);
  return { command: command ? command[1] : '', args: args ? args[1] : '' };
}

function previousSourceFolder() {
  const found = runClaude(['mcp', 'get', MCP_NAME]);
  if (found.status !== 0) return null;
  const { command, args } = parseRegistration(found.stdout || '');
  if (!/(^|[\\/])node(\.exe)?$/i.test(command)) return null;
  const script = /[A-Za-z]:\\[^"]*?\.mjs/.exec(args);
  return script ? path.dirname(script[0]) : null;
}

function migrateFrom(folder) {
  const notes = [];
  if (!folder || !fs.existsSync(folder) || path.resolve(folder) === path.resolve(appDir)) return notes;
  fs.mkdirSync(appDir, { recursive: true });
  const copyIfMissing = (name, valid) => {
    const from = path.join(folder, name);
    const to = path.join(appDir, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) return false;
    if (valid && !valid(fs.readFileSync(from, 'utf8'))) return false;
    fs.copyFileSync(from, to);
    return true;
  };
  if (copyIfMissing('token.txt', (text) => /^[0-9a-f]{32,}\s*$/i.test(text))) {
    notes.push(`Reused the token from ${folder}, so a Studio window that is already open keeps working without a restart.`);
  }
  for (const name of ['uploads.json', 'asset-owners.json']) {
    if (copyIfMissing(name, (text) => text.trim().startsWith('{') || text.trim().startsWith('['))) notes.push(`Carried over ${name} from ${folder}.`);
  }
  if (notes.length > 0) notes.push(`Your old folder ${folder} was left untouched; delete it when you no longer need it.`);
  return notes;
}

const CODEX_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*(?:studio-bridge|"studio-bridge")\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
const ANY_TOML_TABLE = /^\s*\[/;

function codexConfigPath() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

function withoutCodexEntry(lines) {
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (CODEX_TABLE.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && ANY_TOML_TABLE.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept;
}

function codexBlock(command, port) {
  const lines = [
    '[mcp_servers.studio-bridge]',
    `command = ${JSON.stringify(command[0])}`,
    `args = [${command.slice(1).map((arg) => JSON.stringify(arg)).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 600',
  ];
  if (process.env.STUDIO_BRIDGE_PORT) lines.push('', '[mcp_servers.studio-bridge.env]', `STUDIO_BRIDGE_PORT = ${JSON.stringify(String(port))}`);
  return lines;
}

function writeCodexConfig(command, port) {
  const file = codexConfigPath();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const before = existing.split(/\r?\n/);
  const kept = withoutCodexEntry(before);
  const replaced = kept.length !== before.length;
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  const lines = kept.length > 0 ? [...kept, '', ...codexBlock(command, port)] : codexBlock(command, port);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(newline) + newline);
  return replaced;
}

function removeCodexConfig() {
  const file = codexConfigPath();
  if (!fs.existsSync(file)) return false;
  const existing = fs.readFileSync(file, 'utf8');
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const before = existing.split(/\r?\n/);
  const kept = withoutCodexEntry(before);
  if (kept.length === before.length) return false;
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  fs.writeFileSync(file, kept.length > 0 ? kept.join(newline) + newline : '');
  return true;
}

function codexRegisteredCommand() {
  const file = codexConfigPath();
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inside = false;
  for (const line of lines) {
    if (CODEX_TABLE.test(line)) {
      inside = true;
      continue;
    }
    if (inside && ANY_TOML_TABLE.test(line)) inside = false;
    const match = inside && /^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return '';
      }
    }
  }
  return lines.some((line) => CODEX_TABLE.test(line)) ? '' : null;
}

function registerCodex(command, port) {
  const file = codexConfigPath();
  try {
    const replaced = writeCodexConfig(command, port);
    console.log(`Registered with Codex in ${file}${replaced ? ', replacing the previous entry' : ''}.`);
  } catch (err) {
    console.log(`Could not write ${file} (${err.message}). Add this to it yourself:`);
    console.log(codexBlock(command, port).map((line) => `  ${line}`).join('\n'));
  }
}

function install(args) {
  const standalone = args.includes('--standalone');
  const skipRegister = args.includes('--no-register');
  const port = process.env.STUDIO_BRIDGE_PORT || '3010';
  const clientIndex = args.indexOf('--client');
  const client = clientIndex >= 0 ? String(args[clientIndex + 1]) : 'claude';
  if (!['claude', 'codex', 'all'].includes(client)) throw new Error(`--client must be claude, codex or all (got "${client}")`);
  const fromIndex = args.indexOf('--migrate-from');
  const explicitFolder = fromIndex >= 0 ? args[fromIndex + 1] : null;
  const migrationNotes = migrateFrom(explicitFolder || (skipRegister || client === 'codex' ? null : previousSourceFolder()));
  const token = ensureToken();
  const command = stableServerCommand();
  const target = writePlugin(token, port, standalone);
  console.log(standalone ? `Standalone plugin written to ${target} (it does not update itself).` : `Plugin loader written to ${target}.`);
  for (const note of migrationNotes) console.log(note);
  if (!skipRegister && client !== 'codex') register(command, port);
  if (!skipRegister && client !== 'claude') registerCodex(command, port);
  console.log('');
  console.log('Next steps:');
  console.log(client === 'codex' ? '  1. Restart Codex so it starts the bridge.' : '  1. Restart Claude Code, or run /mcp, so it starts the bridge.' + (client === 'all' ? ' Restart Codex too.' : ''));
  console.log('  2. Restart Roblox Studio. If it asks, allow HTTP requests and Script Injection for "Studio Bridge".');
  console.log('  3. Ask Claude to list the connected Studio windows to check it works.');
  if (!isWindows) {
    const prefixes = wineRobloxFolders();
    console.log('');
    console.log('Linux notes:');
    console.log(`  - The plugin went into ${path.dirname(target)}, inside your Wine prefix. Start Studio from the launcher that owns that prefix (Vinegar or Grapejuice).`);
    if (prefixes.length > 1) console.log(`  - ${prefixes.length} Studio prefixes were found and the first was used. To use another, run install again with STUDIO_BRIDGE_PLUGINS_DIR set to its Roblox/Plugins folder.`);
    if (isHyprland()) console.log('  - Hyprland detected: hyprctl focuses Studio for input_keyboard, input_mouse and gui_click, and install grim to enable the screenshot tool.');
    else console.log('  - Install xdotool (X11) if you want input_keyboard, input_mouse and gui_click to focus Studio for you. The screenshot tool is Windows and Hyprland only; use viewport_screenshot.');
    console.log('  - Run studio-bridge doctor if the Studio window does not show up.');
  }
}

function uninstall(args) {
  const folder = pluginsDir();
  for (const name of [PLUGIN_FILE, ...LEGACY_FILES]) {
    const file = path.join(folder, name);
    if (!fs.existsSync(file)) continue;
    try {
      fs.unlinkSync(file);
      console.log(`Removed ${file}`);
    } catch (err) {
      console.log(`Could not remove ${file} (${err.code}); close Studio and try again.`);
    }
  }
  if (!args.includes('--no-register')) {
    const removed = runClaude(['mcp', 'remove', MCP_NAME, '--scope', 'user']);
    if (claudeMissing(removed)) console.log(`The claude command was not found; run: claude mcp remove ${MCP_NAME} --scope user`);
    else console.log(removed.status === 0 ? 'Removed the Claude Code registration.' : 'No Claude Code registration to remove.');
  }
  if (!args.includes('--no-register') && removeCodexConfig()) console.log(`Removed the Codex entry from ${codexConfigPath()}.`);
  if (args.includes('--purge')) {
    if (!isPackaged && !process.env.STUDIO_BRIDGE_HOME) {
      console.log('Not deleting data: this is a source checkout. Delete token.txt, uploads.json, asset-owners.json and exports yourself if you want them gone.');
      return;
    }
    fs.rmSync(appDir, { recursive: true, force: true });
    console.log(`Deleted ${appDir}`);
  } else {
    console.log(`Kept your data in ${appDir} (token, upload records, exports). Add --purge to delete it.`);
  }
}

async function bridgeStatus(token, port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/plugin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token },
      body: JSON.stringify({ have: 'doctor' }),
      signal: AbortSignal.timeout(2000),
    });
    return response.status;
  } catch (err) {
    return err && err.cause && err.cause.code === 'ECONNREFUSED' ? 'down' : 'error';
  }
}

async function doctor(args) {
  const lines = [];
  const note = (state, text) => lines.push(`${state.padEnd(5)} ${text}`);
  note('info', `studio-bridge ${version()} (${{ exe: 'packaged exe', npm: 'npm package, node ' + process.version, source: 'source checkout, node ' + process.version }[updateMode()]})`);
  note('info', `data folder: ${appDir}`);
  const license = checkLicense();
  note(license.ok ? 'ok' : 'FAIL', license.ok ? 'license file is intact' : `license file is ${license.reason}; Studio Bridge is disabled until the original LICENSE is restored`);
  const tokenFile = path.join(appDir, 'token.txt');
  const token = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : null;
  note(token ? 'ok' : 'FAIL', token ? 'token.txt exists' : 'token.txt is missing; run install');
  let folder = null;
  try {
    folder = pluginsDir();
  } catch (err) {
    note('FAIL', err.message);
  }
  if (folder) {
    const pluginPath = path.join(folder, PLUGIN_FILE);
    if (!fs.existsSync(pluginPath)) note('FAIL', `${PLUGIN_FILE} is not in ${folder}; run install`);
    else note('ok', `${PLUGIN_FILE} is installed (${fs.readFileSync(pluginPath, 'utf8').includes('hmacSha256Hex') ? 'loader' : 'standalone'})`);
    for (const legacyName of LEGACY_FILES) {
      if (fs.existsSync(path.join(folder, legacyName))) note('WARN', `old plugin file ${legacyName} is still there and will load a second copy; delete it`);
    }
  }
  if (isWindows) {
    try {
      const helper = assetFile('screenshot.ps1');
      note('ok', `screenshot helper is available (${isPackaged ? 'extracted from the exe' : 'source file'})`);
      if (!fs.existsSync(helper)) throw new Error('extracted file is missing');
    } catch (err) {
      note('FAIL', `screenshot helper is not available: ${err.message}`);
    }
  } else if (isHyprland()) {
    const hyprctl = spawnSync('hyprctl', ['version', '-j'], { encoding: 'utf8' });
    note(hyprctl.error || hyprctl.status !== 0 ? 'WARN' : 'ok', hyprctl.error || hyprctl.status !== 0 ? 'Hyprland was detected but hyprctl does not work from here, so input_keyboard, input_mouse and gui_click cannot focus the Studio window' : 'hyprctl can focus the Studio window');
    const grim = spawnSync('grim', ['-h'], { encoding: 'utf8' });
    note(grim.error ? 'WARN' : 'ok', grim.error ? 'grim is not installed, so the screenshot tool is unavailable (viewport_screenshot still works)' : 'grim is available for the screenshot tool');
  } else {
    const xdotool = spawnSync('xdotool', ['--version'], { encoding: 'utf8' });
    note(xdotool.error ? 'WARN' : 'ok', xdotool.error ? 'xdotool is not installed, so input_keyboard, input_mouse and gui_click cannot focus the Studio window (X11 only); viewport_screenshot does not need it' : `xdotool ${(xdotool.stdout || '').trim()} can focus the Studio window`);
  }
  const port = process.env.STUDIO_BRIDGE_PORT || '3010';
  if (token) {
    const status = await bridgeStatus(token, port);
    if (status === 200) note('ok', `the bridge is running on port ${port}`);
    else if (status === 'down') note('info', `the bridge is not running on port ${port} (Claude Code starts it)`);
    else note('WARN', `something on port ${port} answered unexpectedly (${status})`);
  }
  const claude = runClaude(['--version']);
  if (claudeMissing(claude)) note('WARN', 'the claude command was not found');
  else {
    note('ok', `claude ${(claude.stdout || '').trim()}`);
    const registered = runClaude(['mcp', 'get', MCP_NAME]);
    if (registered.status !== 0) {
      note('WARN', 'not registered with Claude Code; run install');
    } else {
      const { command: registeredCommand } = parseRegistration(registered.stdout || '');
      const installedExe = path.join(appDir, 'studio-bridge.exe');
      if (/(^|[\\/])node(\.exe)?$/i.test(registeredCommand)) note('WARN', 'Claude Code still starts the old source version of Studio Bridge; run install to switch it to this install');
      else if (isPackaged && registeredCommand && path.resolve(registeredCommand).toLowerCase() !== installedExe.toLowerCase()) note('WARN', `Claude Code starts ${registeredCommand}, not this install (${installedExe}); run install to point it here`);
      else note('ok', `registered with Claude Code as ${MCP_NAME}`);
    }
  }
  const codexCommand = codexRegisteredCommand();
  if (codexCommand !== null) {
    const installedForCodex = path.join(appDir, 'studio-bridge.exe');
    if (isPackaged && codexCommand && path.resolve(codexCommand).toLowerCase() !== installedForCodex.toLowerCase()) {
      note('WARN', `Codex starts ${codexCommand}, not this install (${installedForCodex}); run install --client codex to point it here`);
    } else {
      note('ok', `registered with Codex in ${codexConfigPath()}`);
    }
  }
  const preferences = loadSettings();
  note('info', `update check: ${preferences.checkUpdates ? 'on' : 'off'}, auto-update: ${preferences.autoUpdate ? 'on' : 'off'}, tools: ${process.env.STUDIO_BRIDGE_TOOLS || preferences.toolProfile}`);
  if (!args.includes('--offline') && !process.env.STUDIO_BRIDGE_OFFLINE) {
    const [state, text] = await updateNotice();
    note(state, text);
  }
  console.log(lines.join('\n'));
  return lines.some((line) => line.startsWith('FAIL')) ? 1 : 0;
}

async function update(args) {
  const checkOnly = args.includes('--check');
  const release = await latestUpdate();
  if (release.feed && release.feed.overridden) console.log(`Using the release feed from STUDIO_BRIDGE_RELEASES_URL (${release.feed.url}).`);
  if (release.none) {
    console.log(release.mode === 'npm' ? 'The package has not been published to npm yet.' : 'No release has been published yet.');
    return 0;
  }
  const current = version();
  if (!isNewer(release.version, current)) {
    console.log(`studio-bridge ${current} is up to date (latest release: ${release.tag}).`);
    return 0;
  }
  console.log(`A newer version is available: ${release.tag} (you have ${current}).`);
  if (checkOnly) {
    console.log('Run: studio-bridge update');
    return 0;
  }
  if (release.mode === 'source') {
    console.log('This is a source checkout, so update it with git pull and run install again.');
    return 0;
  }
  const passthrough = args.filter((arg) => arg === '--standalone' || arg === '--no-register');
  try {
    const output = await applyRelease(release, passthrough, (line) => console.log(line));
    process.stdout.write(output);
    return 0;
  } catch (err) {
    console.log(err.message);
    return 1;
  }
}

async function updateNotice() {
  try {
    const found = await checkForUpdate({ force: true });
    if (found.none) return ['info', 'no release has been published yet'];
    if (found.newer) return ['info', `update available: ${found.tag} (you have ${version()}); run: studio-bridge update`];
    return ['ok', `up to date (latest release: ${found.tag})`];
  } catch {
    return ['info', 'could not check for updates'];
  }
}

function toolGroups() {
  try {
    return JSON.parse(readAsset('tools.json')).groups || {};
  } catch {
    return {};
  }
}

function settingsCommand(args) {
  const names = { 'check-updates': 'checkUpdates', 'auto-update': 'autoUpdate' };
  const [key, value] = args;
  if (key === 'tools') {
    const groups = toolGroups();
    const known = Object.keys(groups);
    if (value === undefined) {
      const current = loadSettings();
      console.log(`tools          ${current.toolProfile}  (which tool groups are offered: all, or core plus any of ${known.filter((group) => group !== 'core').join(', ')})`);
      for (const group of known) console.log(`  ${group.padEnd(11)} ${groups[group].length} tools`);
      return 0;
    }
    const wanted = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    const unknown = wanted.filter((entry) => entry !== 'all' && !known.includes(entry));
    if (wanted.length === 0 || unknown.length > 0) {
      console.log(`Unknown tool group${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ') || value}. Use all, core, or a comma-separated list of: ${known.filter((group) => group !== 'core').join(', ')}`);
      return 1;
    }
    saveSettings({ toolProfile: wanted.join(',') });
    console.log(`Tool profile set to ${wanted.join(',')}. A running bridge picks it up within a second or two; your AI client may need /mcp to refresh its tool list.`);
    return 0;
  }
  if (key) {
    if (!names[key] || !['on', 'off'].includes(value)) {
      console.log('Usage: studio-bridge settings [check-updates|auto-update on|off] | settings tools [all|group,group]');
      return 1;
    }
    const changes = { [names[key]]: value === 'on' };
    if (key === 'auto-update' && value === 'on') changes.checkUpdates = true;
    saveSettings(changes);
  }
  const current = loadSettings();
  console.log(`check-updates  ${current.checkUpdates ? 'on' : 'off'}  (look for a newer release once a day when the bridge starts)`);
  console.log(`auto-update    ${current.autoUpdate ? 'on' : 'off'}  (download, verify and install new releases yourself; applies at the next restart)`);
  console.log(`tools          ${current.toolProfile}  (settings tools lists the groups)`);
  return 0;
}

function help() {
  console.log(`studio-bridge ${version()}

Usage: studio-bridge <command>

  serve                  Run the MCP server (Claude Code starts this)
  install [options]      Install the Studio plugin and register with Claude Code
      --standalone       Install the full plugin instead of the self-updating loader
      --no-register      Do not touch the Claude Code configuration
      --migrate-from <folder>  Carry the token and upload records over from an old source install
      --client <claude|codex|all>  Which AI client to register with (default claude)
  uninstall [options]    Remove the plugin and the Claude Code registration
      --purge            Also delete the data folder (token, upload records, exports)
      --no-register      Leave the Claude Code configuration alone
  licenses               Print the license and the third-party notices
  doctor                 Check the installation (--offline skips the update check)
  update [--check]       Download and install the latest release (--check only reports)
  settings [name on|off] Show or change check-updates and auto-update
  settings tools [list]  Choose which tool groups are offered (all, or core plus building,ui,...)
  version                Print the version`);
}

function pause() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nPress Enter to close this window. ', () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const [command, ...rest] = userArgs();

  if ((command === 'install' || command === 'update') && !checkLicense().ok) {
    console.error(TAMPER_MESSAGE);
    process.exitCode = 3;
    return;
  }

  if (command === 'serve') {
    await import('./server.mjs');
  } else if (command === 'install') {
    try {
      install(rest);
    } catch (err) {
      console.error(`Install failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else if (command === 'uninstall') {
    uninstall(rest);
  } else if (command === 'update') {
    try {
      process.exitCode = await update(rest);
    } catch (err) {
      console.error(`Update failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else if (command === 'licenses') {
    if (rest.includes('--hash')) console.log(licenseHash(readAsset('LICENSE')));
    else {
      console.log(readAsset('LICENSE'));
      console.log('\n' + readAsset('THIRD_PARTY_NOTICES.txt'));
    }
  } else if (command === 'settings') {
    process.exitCode = settingsCommand(rest);
  } else if (command === 'doctor') {
    process.exitCode = await doctor(rest);
  } else if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`studio-bridge ${version()}`);
  } else if (!command && isPackaged && process.stdin.isTTY) {
    try {
      install([]);
    } catch (err) {
      console.error(`Install failed: ${err.message}`);
      process.exitCode = 1;
    }
    await pause();
  } else {
    help();
    if (command && command !== 'help' && command !== '--help' && command !== '-h') process.exitCode = 1;
  }
}

main();
