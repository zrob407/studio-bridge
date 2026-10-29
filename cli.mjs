import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appDir, assetFile, isPackaged, readAsset } from './paths.mjs';
import { applyRelease, checkForUpdate, currentVersion, isNewer, latestRelease, loadSettings, saveSettings } from './updater.mjs';

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

function pluginsDir() {
  const base = process.env.LOCALAPPDATA;
  if (!base) throw new Error('LOCALAPPDATA is not set; the Studio plugin folder can only be found on Windows.');
  return path.join(base, 'Roblox', 'Plugins');
}

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
  console.log('Registered with Claude Code (user scope).');
  return true;
}

function install(args) {
  const standalone = args.includes('--standalone');
  const skipRegister = args.includes('--no-register');
  const port = process.env.STUDIO_BRIDGE_PORT || '3010';
  const token = ensureToken();
  const command = stableServerCommand();
  const target = writePlugin(token, port, standalone);
  console.log(standalone ? `Standalone plugin written to ${target} (it does not update itself).` : `Plugin loader written to ${target}.`);
  if (!skipRegister) register(command, port);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code, or run /mcp, so it starts the bridge.');
  console.log('  2. Restart Roblox Studio. If it asks, allow HTTP requests and Script Injection for "Studio Bridge".');
  console.log('  3. Ask Claude to list the connected Studio windows to check it works.');
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
  note('info', `studio-bridge ${version()} (${isPackaged ? 'packaged exe' : 'node ' + process.version})`);
  note('info', `data folder: ${appDir}`);
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
  try {
    const helper = assetFile('screenshot.ps1');
    note('ok', `screenshot helper is available (${isPackaged ? 'extracted from the exe' : 'source file'})`);
    if (!fs.existsSync(helper)) throw new Error('extracted file is missing');
  } catch (err) {
    note('FAIL', `screenshot helper is not available: ${err.message}`);
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
    note(registered.status === 0 ? 'ok' : 'WARN', registered.status === 0 ? `registered with Claude Code as ${MCP_NAME}` : `not registered with Claude Code; run install`);
  }
  const preferences = loadSettings();
  note('info', `update check: ${preferences.checkUpdates ? 'on' : 'off'}, auto-update: ${preferences.autoUpdate ? 'on' : 'off'}`);
  if (!args.includes('--offline') && !process.env.STUDIO_BRIDGE_OFFLINE) {
    const [state, text] = await updateNotice();
    note(state, text);
  }
  console.log(lines.join('\n'));
  return lines.some((line) => line.startsWith('FAIL')) ? 1 : 0;
}

async function update(args) {
  const checkOnly = args.includes('--check');
  const release = await latestRelease();
  if (release.feed.overridden) console.log(`Using the release feed from STUDIO_BRIDGE_RELEASES_URL (${release.feed.url}).`);
  if (release.none) {
    console.log('No release has been published yet.');
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
  if (!isPackaged) {
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

function settingsCommand(args) {
  const names = { 'check-updates': 'checkUpdates', 'auto-update': 'autoUpdate' };
  const [key, value] = args;
  if (key) {
    if (!names[key] || !['on', 'off'].includes(value)) {
      console.log('Usage: studio-bridge settings [check-updates|auto-update on|off]');
      return 1;
    }
    const changes = { [names[key]]: value === 'on' };
    if (key === 'auto-update' && value === 'on') changes.checkUpdates = true;
    saveSettings(changes);
  }
  const current = loadSettings();
  console.log(`check-updates  ${current.checkUpdates ? 'on' : 'off'}  (look for a newer release once a day when the bridge starts)`);
  console.log(`auto-update    ${current.autoUpdate ? 'on' : 'off'}  (download, verify and install new releases yourself; applies at the next restart)`);
  return 0;
}

function help() {
  console.log(`studio-bridge ${version()}

Usage: studio-bridge <command>

  serve                  Run the MCP server (Claude Code starts this)
  install [options]      Install the Studio plugin and register with Claude Code
      --standalone       Install the full plugin instead of the self-updating loader
      --no-register      Do not touch the Claude Code configuration
  uninstall [options]    Remove the plugin and the Claude Code registration
      --purge            Also delete the data folder (token, upload records, exports)
      --no-register      Leave the Claude Code configuration alone
  doctor                 Check the installation (--offline skips the update check)
  update [--check]       Download and install the latest release (--check only reports)
  settings [name on|off] Show or change check-updates and auto-update
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
