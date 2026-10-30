import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uploadAsset, assetStatus, keyCheck, uploadBatch, batchStatus } from './assets.mjs';
import { rgbaToPng, downscaleRgba } from './png.mjs';
import { runAudit } from './audit.mjs';
import { readDocs, searchDocs } from './docs.mjs';
import { formatSearch, searchAssets } from './marketplace.mjs';
import { appDir, assetExists, assetFile, isPackaged, readAsset, assetOnDisk } from './paths.mjs';
import { checkLicense, TAMPER_MESSAGE } from './checks.mjs';
import { applyRelease, checkForUpdate, currentVersion, isNewer, latestUpdate, loadSettings, saveSettings, updateMode } from './updater.mjs';
import { acceptWebSocket } from './ws.mjs';

const dir = appDir;

function readToken() {
  try {
    return fs.readFileSync(path.join(dir, 'token.txt'), 'utf8').trim();
  } catch {
    process.stderr.write(`[studio-bridge] no token found in ${dir}. Run the installer first (install).
`);
    process.exit(1);
  }
}

const token = process.env.STUDIO_BRIDGE_TOKEN || readToken();
const PORT = Number(process.env.STUDIO_BRIDGE_PORT || 3010);
const HOLD_MS = 15000;
const STALE_MS = 40000;
const TRANSIENT_STALE_MS = 25000;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const GRACE_MS = Number(process.env.STUDIO_BRIDGE_GRACE_MS || 10000);
const QUEUE_WAIT_MS = Number(process.env.STUDIO_BRIDGE_QUEUE_WAIT_MS || 120000);
const SOCKET_SILENCE_MS = Number(process.env.STUDIO_BRIDGE_SOCKET_SILENCE_MS || 35000);
const TRANSIENT_SILENCE_MS = 20000;
const RECONNECT_GRACE_MS = 3000;
const MAX_REQUEUES = 3;
const SOCKET_PROTOCOL = 1;

const studios = new Map();
const pending = new Map();

function log(...parts) {
  process.stderr.write(parts.join(' ') + '\n');
}

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function touch(info) {
  const existing = studios.get(info.id);
  const studio = existing || { id: info.id, queue: [], waiter: null, socket: null, inflight: new Set(), connectedAt: Date.now() };
  studio.role = info.role || 'edit';
  studio.placeId = info.placeId;
  studio.placeName = info.placeName;
  studio.gameId = info.gameId;
  studio.lastSeen = Date.now();
  studios.set(info.id, studio);
  return studio;
}

function isActive(studio) {
  const limit = studio.role === 'edit' ? STALE_MS : TRANSIENT_STALE_MS;
  return studio.socket !== null || studio.inflight.size > 0 || studio.queue.length > 0 || Date.now() - studio.lastSeen < limit;
}

function activeStudios() {
  for (const [id, studio] of studios) {
    if (!isActive(studio) && Date.now() - studio.lastSeen > STALE_MS * 6) studios.delete(id);
  }
  return [...studios.values()].filter(isActive).sort((a, b) => b.connectedAt - a.connectedAt);
}

function describeStudio(studio) {
  return `${studio.id.slice(0, 8)}  ${studio.placeName} [${studio.role}] (placeId ${studio.placeId})${studio.socket ? '  [ws]' : ''}${studio.inflight.size > 0 ? '  [busy]' : ''}`;
}

function pickStudio(selector) {
  const active = activeStudios();
  if (active.length === 0) return { error: 'No Studio window is connected. Open Studio with the bridge plugin installed and allow localhost HTTP when prompted.' };
  const tokens = selector === undefined || selector === null ? [] : String(selector).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    const editWindows = active.filter((s) => s.role === 'edit');
    if (editWindows.length === 1) return { studio: editWindows[0] };
    if (active.length === 1) return { studio: active[0] };
    return { error: 'Several Studio windows are connected, so pass "studio":\n' + active.map(describeStudio).join('\n') };
  }
  const matches = active.filter((s) =>
    tokens.every(
      (token) =>
        s.id.toLowerCase().startsWith(token) ||
        String(s.placeId) === token ||
        String(s.placeName).toLowerCase().includes(token) ||
        s.role === token,
    ),
  );
  if (matches.length === 1) return { studio: matches[0] };
  if (matches.length > 1 && matches[0].role !== 'edit' && matches.every((s) => s.role === matches[0].role)) return { studio: matches[0] };
  if (matches.length === 0) return { error: `No connected Studio matches "${selector}". Connected:\n` + active.map(describeStudio).join('\n') };
  return { error: `"${selector}" matches several windows:\n` + matches.map(describeStudio).join('\n') };
}

function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function release(studio, command) {
  if (studio.waiter) {
    clearTimeout(studio.waiter.timer);
    respond(studio.waiter.res, 200, command || {});
    studio.waiter = null;
  }
}

function splitTarget(selector) {
  const tokens = selector === undefined || selector === null ? [] : String(selector).split(/\s+/).filter(Boolean);
  if (!tokens.some((token) => token.toLowerCase() === 'client')) return { selector, target: undefined };
  const rest = tokens.filter((token) => token.toLowerCase() !== 'client');
  rest.push('server');
  return { selector: rest.join(' '), target: 'client' };
}

function finish(requestId, result) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.studio.inflight.delete(requestId);
  entry.resolve(result);
  pump(entry.studio);
  return true;
}

function takeNext(studio) {
  while (studio.queue.length > 0) {
    const command = studio.queue.shift();
    const entry = pending.get(command.requestId);
    if (!entry) continue;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      finish(command.requestId, {
        ok: false,
        error: `Timed out after ${entry.timeoutS}s and the plugin did not answer. The code may still be running in Studio.`,
        output: [],
      });
    }, entry.timeoutS * 1000 + GRACE_MS);
    studio.inflight.add(command.requestId);
    return command;
  }
  return null;
}

function sendCommand(studio, command) {
  const entry = pending.get(command.requestId);
  if (!entry) return;
  if (!checkLicense().ok) {
    studio.inflight.delete(command.requestId);
    finish(command.requestId, { ok: false, error: TAMPER_MESSAGE, output: [] });
    return;
  }
  entry.acked = false;
  entry.socket = studio.socket;
  const sent = studio.socket.send(JSON.stringify({ type: 'command', ...command }));
  if (!sent) requeue(studio, command.requestId);
}

function pump(studio) {
  if (studio.inflight.size > 0) return;
  if (studio.socket) {
    const command = takeNext(studio);
    if (command) sendCommand(studio, command);
    return;
  }
  if (!studio.waiter) return;
  const command = takeNext(studio);
  if (command) release(studio, command);
}

function queueTimer(studio, requestId) {
  return setTimeout(() => {
    studio.queue = studio.queue.filter((command) => command.requestId !== requestId);
    finish(requestId, {
      ok: false,
      error: `Studio did not start this within ${Math.round(QUEUE_WAIT_MS / 1000)}s. Another command may still be running, or the plugin is not connected.`,
      output: [],
    });
  }, QUEUE_WAIT_MS);
}

function requeue(studio, requestId) {
  const entry = pending.get(requestId);
  if (!entry) return;
  entry.requeues = (entry.requeues || 0) + 1;
  if (entry.requeues > MAX_REQUEUES) {
    finish(requestId, {
      ok: false,
      error: `The connection to Studio dropped ${MAX_REQUEUES} times before it acknowledged this command, so it was not run again.`,
      output: [],
    });
    return;
  }
  clearTimeout(entry.timer);
  entry.timer = queueTimer(studio, requestId);
  entry.socket = null;
  studio.inflight.delete(requestId);
  studio.queue.unshift({ requestId, code: entry.code, target: entry.target, timeout: entry.timeoutS });
}

function dispatch(studio, code, timeoutS, target) {
  return new Promise((resolve) => {
    if (!checkLicense().ok) return resolve({ ok: false, error: TAMPER_MESSAGE, output: [] });
    const requestId = crypto.randomUUID();
    pending.set(requestId, { resolve, timer: queueTimer(studio, requestId), studio, timeoutS, code, target, acked: false, socket: null });
    studio.queue.push({ requestId, code, target, timeout: timeoutS });
    pump(studio);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 40 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '');
  if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) return respond(res, 403, { error: 'forbidden' });
  if (req.method !== 'POST') return respond(res, 405, { error: 'method not allowed' });
  if (!tokenMatches(req.headers['x-bridge-token'])) return respond(res, 401, { error: 'unauthorized' });
  if (!checkLicense().ok) return respond(res, 403, { error: 'license tampered', message: TAMPER_MESSAGE });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return respond(res, 400, { error: 'bad request' });
  }

  if (req.url === '/shutdown') {
    if (!isNewer(String(body.version || ''), currentVersion())) return respond(res, 409, { error: 'only a newer version may replace this server' });
    respond(res, 200, { ok: true });
    log('[studio-bridge] a newer studio-bridge asked this server to stop and take over its port');
    setTimeout(() => process.exit(0), 200);
    return;
  }

  if (req.url === '/profile') {
    if (body.action === 'set') {
      if (process.env.STUDIO_BRIDGE_TOOLS) return respond(res, 409, { error: 'the tool profile is set by the STUDIO_BRIDGE_TOOLS environment variable, so it cannot be changed here' });
      const next = normalizeProfile(body.profile);
      if (next.error) return respond(res, 400, { error: next.error });
      saveSettings({ toolProfile: next.profile });
      lastProfile = profileText();
      send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      log(`[studio-bridge] tool profile is now ${lastProfile}`);
    }
    return respond(res, 200, profileInfo());
  }

  if (req.url === '/plugin') {
    let source;
    try {
      source = readAsset('plugin.template.lua').replace('__PORT__', String(PORT)).replace('__TOKEN__', body.role === 'client' ? '' : token);
    } catch {
      return respond(res, 500, { error: 'plugin source unavailable' });
    }
    const version = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
    if (body.have === version) return respond(res, 200, { version, unchanged: true });
    const signature = crypto.createHmac('sha256', token).update(source).digest('hex');
    return respond(res, 200, { version, source, signature });
  }

  if (req.url === '/poll') {
    if (typeof body.id !== 'string' || body.id === '') return respond(res, 400, { error: 'missing id' });
    const studio = touch(body);
    if (studio.waiter) release(studio, {});
    if (studio.inflight.size === 0) {
      const command = takeNext(studio);
      if (command) return respond(res, 200, command);
    }
    const timer = setTimeout(() => {
      if (studio.waiter && studio.waiter.res === res) {
        studio.waiter = null;
        respond(res, 200, {});
      }
    }, HOLD_MS);
    studio.waiter = { res, timer };
    res.on('close', () => {
      if (studio.waiter && studio.waiter.res === res) {
        clearTimeout(timer);
        studio.waiter = null;
        if (!res.writableEnded) studio.lastSeen = 0;
      }
    });
    return;
  }

  if (req.url === '/result') {
    const entry = pending.get(body.requestId);
    if (!entry) return respond(res, 200, { ok: true, ignored: true });
    entry.studio.lastSeen = Date.now();
    finish(body.requestId, body);
    return respond(res, 200, { ok: true });
  }

  respond(res, 404, { error: 'not found' });
});

function detachSocket(studio, connection) {
  if (studio.socket === connection) studio.socket = null;
  for (const requestId of [...studio.inflight]) {
    const entry = pending.get(requestId);
    if (entry && entry.socket === connection && !entry.acked) requeue(studio, requestId);
  }
}

function acceptResult(connection, message) {
  const entry = pending.get(message.requestId);
  if (entry) {
    entry.studio.lastSeen = Date.now();
    finish(message.requestId, message);
  }
  if (typeof message.requestId === 'string') connection.send(JSON.stringify({ type: 'result_ack', requestId: message.requestId }));
}

function releaseSocket(state) {
  if (state.released) return;
  state.released = true;
  clearTimeout(state.silence);
  const studio = state.studio;
  if (!studio) return;
  const wasCurrent = studio.socket === state.connection;
  detachSocket(studio, state.connection);
  if (wasCurrent && !studio.socket) {
    const limit = studio.role === 'edit' ? STALE_MS : TRANSIENT_STALE_MS;
    studio.lastSeen = state.goodbye ? 0 : Date.now() - limit + RECONNECT_GRACE_MS;
  }
}

function handleSocketMessage(state, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;
  const { connection } = state;
  if (message.type === 'hello') {
    if (typeof message.id !== 'string' || message.id === '') return connection.close(1008);
    const studio = touch(message);
    const previous = studio.socket;
    if (previous && previous !== connection) {
      detachSocket(studio, previous);
      previous.close(1000);
    }
    state.studio = studio;
    studio.socket = connection;
    connection.send(JSON.stringify({ type: 'hello_ack', protocol: SOCKET_PROTOCOL }));
    return;
  }
  const studio = state.studio;
  if (!studio) return;
  studio.lastSeen = Date.now();
  if (message.type === 'ready') {
    pump(studio);
  } else if (message.type === 'ack') {
    const entry = pending.get(message.requestId);
    if (entry) entry.acked = true;
  } else if (message.type === 'goodbye') {
    state.goodbye = true;
    connection.close(1000);
    releaseSocket(state);
  } else if (message.type === 'result') {
    acceptResult(connection, message);
  } else if (message.type === 'resume') {
    for (const result of Array.isArray(message.finished) ? message.finished : []) {
      if (result && typeof result === 'object') acceptResult(connection, result);
    }
  }
}

server.on('upgrade', (req, socket) => {
  socket.on('error', () => {});
  const host = String(req.headers.host || '');
  const hostOk = host.startsWith('127.0.0.1') || host.startsWith('localhost');
  const pathOk = String(req.url || '').split('?')[0] === '/ws';
  if (!hostOk || !pathOk || req.headers.origin !== undefined || !tokenMatches(req.headers['x-bridge-token'])) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  if (!checkLicense().ok) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const state = { studio: null, connection: null, silence: null };
  const resetSilence = () => {
    clearTimeout(state.silence);
    const transient = state.studio && state.studio.role !== 'edit';
    state.silence = setTimeout(() => state.connection && state.connection.terminate(), transient ? Math.min(SOCKET_SILENCE_MS, TRANSIENT_SILENCE_MS) : SOCKET_SILENCE_MS);
  };
  const connection = acceptWebSocket(req, socket, {
    onMessage: (text) => {
      resetSilence();
      if (typeof text === 'string') handleSocketMessage(state, text);
    },
    onClose: () => releaseSocket(state),
  });
  if (!connection) return;
  state.connection = connection;
  resetSilence();
});

async function askOlderServerToStop() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token },
      body: JSON.stringify({ version: currentVersion() }),
      signal: AbortSignal.timeout(3000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

let takeover = null;
let listenAttempts = 0;

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    log(`[studio-bridge] HTTP server error: ${err.message}`);
    return;
  }
  if (takeover === null) {
    takeover = await askOlderServerToStop();
    if (takeover) log(`[studio-bridge] port ${PORT} was held by an older studio-bridge; it was asked to stop and this one is taking over`);
  }
  if (takeover && listenAttempts < 10) {
    listenAttempts++;
    setTimeout(() => server.listen(PORT, '127.0.0.1'), 500);
    return;
  }
  log(`[studio-bridge] port ${PORT} is already in use, by another studio-bridge that is not older or does not share this token. Stop it and reconnect.`);
  process.exit(1);
});

let tamperLogged = false;

function licenseWatchdog() {
  if (checkLicense().ok) {
    tamperLogged = false;
    return;
  }
  if (!tamperLogged) {
    tamperLogged = true;
    log(`[studio-bridge] ${TAMPER_MESSAGE}`);
  }
  for (const studio of studios.values()) if (studio.socket) studio.socket.close(1008);
}

server.on('listening', () => {
  log(`[studio-bridge] listening on 127.0.0.1:${PORT}`);
  licenseWatchdog();
  setInterval(licenseWatchdog, 10000).unref();
  runUpdateWatcher();
});

server.listen(PORT, '127.0.0.1');

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INSTRUCTIONS =
  'Studio Bridge runs Luau inside Roblox Studio. studio_list shows the connected windows: edit (the default), and server and client during a play session; pass studio "server" or "client" to target those. Prefer batch (several edit-window tools in one call and one undo step) or a single run_luau over many small calls. run_test starts its own play session, so stop a running one with play_stop first. Long operations accept timeout_seconds.';

let updateState = { newer: false, tag: null, applied: null };
let updating = false;

function recordUpdate(line) {
  try {
    fs.appendFileSync(path.join(dir, 'update-log.txt'), `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    log(`[studio-bridge] could not write update-log.txt: ${err.message}`);
  }
}

async function runUpdateWatcher() {
  if (process.env.STUDIO_BRIDGE_OFFLINE) return;
  if (updateMode() === 'source' && !process.env.STUDIO_BRIDGE_RELEASES_URL && !process.env.STUDIO_BRIDGE_INSTALL_MODE) return;
  const settings = loadSettings();
  if (!settings.checkUpdates) return;
  try {
    const found = await checkForUpdate();
    if (found.none || !found.newer) return;
    updateState = { newer: true, tag: found.tag, applied: null };
    if (!settings.autoUpdate || updateMode() === 'source') return;
    if (updating) return;
    updating = true;
    try {
      const release = found.release || (await latestUpdate());
      await applyRelease(release, ['--no-register'], (line) => log(`[studio-bridge] auto-update: ${line}`));
      updateState = { newer: false, tag: release.tag, applied: release.tag };
      recordUpdate(`auto-updated to ${release.tag}; restart to use it`);
      log(`[studio-bridge] auto-update installed ${release.tag}; it takes effect at the next restart`);
    } catch (err) {
      recordUpdate(`auto-update to ${found.tag} failed: ${err.message}`);
      log(`[studio-bridge] auto-update failed: ${err.message}`);
    } finally {
      updating = false;
    }
  } catch (err) {
    log(`[studio-bridge] update check failed: ${err.message}`);
  }
}

function updateNotice() {
  if (updateState.applied) return `Studio Bridge ${updateState.applied} was installed. Run /mcp so Claude Code starts the new version.`;
  if (updateState.newer) return `Update available: ${updateState.tag} (you have ${currentVersion()}). If the user wants it, call bridge_update with confirm true, then ask them to run /mcp.`;
  return '';
}

async function runBridgeUpdate(args) {
  if (!checkLicense().ok) return { content: [{ type: 'text', text: TAMPER_MESSAGE }], isError: true };
  if (updating) return { content: [{ type: 'text', text: 'An update is already in progress.' }], isError: true };
  let release;
  try {
    release = await latestUpdate();
  } catch (err) {
    return { content: [{ type: 'text', text: `Could not check for updates: ${err.message}` }], isError: true };
  }
  const reply = (text, isError = false) => ({ content: [{ type: 'text', text }], isError });
  if (release.none) return reply('No release has been published yet.');
  const current = currentVersion();
  if (!isNewer(release.version, current)) return reply(`Studio Bridge ${current} is up to date (latest release: ${release.tag}).`);
  if (args.confirm !== true) {
    return reply(`Update available: ${release.tag} (you have ${current}). Nothing was changed. Ask the user whether to install it, then call this tool again with confirm true. They run /mcp afterwards to start the new version.`);
  }
  if (release.mode === 'source') return reply('This is a source checkout, so it cannot update itself: update it with git pull and run install again.');
  updating = true;
  try {
    await applyRelease(release, ['--no-register']);
    updateState = { newer: false, tag: release.tag, applied: release.tag };
    recordUpdate(`updated to ${release.tag} on request; restart to use it`);
    const how = release.mode === 'npm' ? 'installed with npm' : 'downloaded, verified against its published checksum and installed';
    return reply(`Studio Bridge ${release.tag} was ${how}. Ask the user to run /mcp so Claude Code starts the new version.`);
  } catch (err) {
    return reply(`Update failed: ${err.message}`, true);
  } finally {
    updating = false;
  }
}


const TOOLS_OVERRIDE = process.env.STUDIO_BRIDGE_TOOLS_FILE || null;
const toolsFileOnDisk = () => TOOLS_OVERRIDE || assetOnDisk('tools.json');
let allTools = [];
let toolMeta = {};
let handlerToolNames = new Set();
let BATCHABLE = [];
let toolGroups = {};
let toolGroupInfo = {};
let toolPresets = [];

function loadTools() {
  const data = JSON.parse(TOOLS_OVERRIDE ? fs.readFileSync(TOOLS_OVERRIDE, 'utf8') : readAsset('tools.json'));
  if (!data || !Array.isArray(data.tools)) throw new Error('tools.json needs a "tools" array');
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const handlers = new Set(data.tools.filter((tool) => assetExists(`handlers/${tool.name}.luau`)).map((tool) => tool.name));
  const batchable = [...handlers].filter((toolName) => !(meta[toolName] && meta[toolName].batchable === false));
  allTools = data.tools.map((tool) => {
    if (tool.name !== 'batch') return tool;
    const copy = structuredClone(tool);
    copy.inputSchema.properties.operations.items.properties.tool.enum = batchable;
    return copy;
  });
  toolMeta = meta;
  handlerToolNames = handlers;
  BATCHABLE = batchable;
  toolGroups = data.groups && typeof data.groups === 'object' ? data.groups : {};
  toolGroupInfo = data.groupInfo && typeof data.groupInfo === 'object' ? data.groupInfo : {};
  toolPresets = Array.isArray(data.presets) ? data.presets : [];
}

function profileText() {
  return String(process.env.STUDIO_BRIDGE_TOOLS || loadSettings().toolProfile || 'all').trim();
}

function visibleTools() {
  const wanted = profileText()
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0 || wanted.includes('all')) return null;
  const visible = new Set(toolGroups.core || []);
  for (const group of wanted) {
    if (group === 'core') continue;
    if (!toolGroups[group]) {
      log(`[studio-bridge] unknown tool group "${group}" ignored; groups are ${Object.keys(toolGroups).join(', ')}`);
      continue;
    }
    for (const name of toolGroups[group]) visible.add(name);
  }
  return visible;
}

function isVisible(name) {
  const visible = visibleTools();
  return visible === null || visible.has(name);
}

function listedTools() {
  const visible = visibleTools();
  if (visible === null) return allTools;
  return allTools
    .filter((tool) => visible.has(tool.name))
    .map((tool) => {
      if (tool.name !== 'batch') return tool;
      const copy = structuredClone(tool);
      const items = copy.inputSchema.properties.operations.items.properties.tool;
      items.enum = items.enum.filter((name) => visible.has(name));
      return copy;
    });
}

function normalizeProfile(text) {
  const wanted = String(text || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) return { error: 'profile is empty' };
  if (wanted.includes('all')) return { profile: 'all' };
  const unknown = wanted.filter((entry) => entry !== 'core' && !toolGroups[entry]);
  if (unknown.length > 0) return { error: `unknown tool group ${unknown.join(', ')}` };
  const groups = Object.keys(toolGroups).filter((group) => group !== 'core' && wanted.includes(group));
  return { profile: groups.length > 0 ? groups.join(',') : 'core' };
}

function tokensOf(names) {
  const wanted = new Set(names);
  return Math.round(allTools.filter((tool) => wanted.has(tool.name)).reduce((total, tool) => total + JSON.stringify(tool).length, 0) / 3.6);
}

function profileInfo() {
  const visible = visibleTools();
  const names = visible === null ? allTools.map((tool) => tool.name) : [...visible];
  return {
    version: currentVersion(),
    profile: profileText(),
    locked: Boolean(process.env.STUDIO_BRIDGE_TOOLS),
    groups: Object.keys(toolGroups).map((name) => ({
      name,
      title: (toolGroupInfo[name] && toolGroupInfo[name].title) || name,
      summary: (toolGroupInfo[name] && toolGroupInfo[name].summary) || '',
      tools: toolGroups[name].length,
      tokens: tokensOf(toolGroups[name]),
    })),
    presets: toolPresets,
    total: { tools: names.length, tokens: tokensOf(names) },
  };
}

function hiddenToolMessage(name) {
  const group = Object.keys(toolGroups).find((entry) => toolGroups[entry].includes(name));
  const current = profileText();
  return `The ${name} tool is not enabled in the current tool profile (${current}). It belongs to the "${group}" group. Enable it with: studio-bridge settings tools ${current === 'core' ? group : `${current},${group}`}`;
}

loadTools();

let reloadTimer = null;
function watchTools() {
  try {
    const file = toolsFileOnDisk();
    if (!file) return;
    const watched = path.basename(file);
    fs.watch(path.dirname(file), (event, filename) => {
      if (filename !== watched) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try {
          loadTools();
          send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
          log('[studio-bridge] tools reloaded: ' + allTools.length + ' tools');
        } catch (err) {
          log('[studio-bridge] tools.json not reloaded: ' + err.message);
        }
      }, 300);
    });
  } catch (err) {
    log('[studio-bridge] cannot watch tools.json: ' + err.message);
  }
}
watchTools();

let lastProfile = profileText();
let profileTimer = null;
try {
  fs.watch(appDir, (event, filename) => {
    if (filename !== 'settings.json') return;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(() => {
      const next = profileText();
      if (next === lastProfile) return;
      lastProfile = next;
      send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      log(`[studio-bridge] tool profile is now ${next}`);
    }, 300);
  });
} catch (err) {
  log('[studio-bridge] cannot watch settings.json: ' + err.message);
}

const HANDLER_INCLUDES = {
  script_scan: ['_scan'],
  import_rbxm: ['_scan'],
  raycast: ['_geometry'],
  spatial_query: ['_geometry'],
  scatter: ['_geometry'],
  terrain: ['_geometry'],
  instance_pivot: ['_geometry'],
  snap_grid: ['_geometry'],
  character_move: ['_geometry'],
  spatial_find: ['_geometry', '_spatial'],
  spatial_check: ['_geometry', '_spatial'],
  spatial_map: ['_geometry', '_spatial'],
  animation_pose: ['_animation'],
  animation_play: ['_animation'],
  asset_insert: ['_scan'],
};

function handlerIncludes(names) {
  const wanted = new Set(names.flatMap((name) => HANDLER_INCLUDES[name] || []));
  return [...wanted].map((include) => readAsset(`handlers/${include}.luau`)).join('\n');
}
const MAX_BATCH_OPERATIONS = 50;

function buildHandlerCode(name, args) {
  const prelude = readAsset('handlers/_prelude.luau');
  const body = readAsset(`handlers/${name}.luau`);
  const scanner = handlerIncludes([name]);
  const { studio, ...params } = args;
  const json = JSON.stringify(params);
  let level = 0;
  while (json.includes(']' + '='.repeat(level) + ']')) level++;
  const equals = '='.repeat(level);
  return `${prelude}\n${scanner}\nlocal params = HttpService:JSONDecode([${equals}[${json}]${equals}])\n${body}`;
}

function luaLongString(text) {
  let level = 0;
  while (text.includes(']' + '='.repeat(level) + ']')) level++;
  const equals = '='.repeat(level);
  return `[${equals}[${text}]${equals}]`;
}

function buildBatchCode(operations, stopOnError) {
  const prelude = readAsset('handlers/_prelude.luau');
  const scanner = handlerIncludes(operations.map((operation) => operation.tool));
  const steps = operations.map((operation) => {
    const body = readAsset(`handlers/${operation.tool}.luau`);
    const { studio, ...params } = operation.args || {};
    return `{${JSON.stringify(operation.tool)}, ${luaLongString(JSON.stringify(params))}, function(params)\n${body}\nend}`;
  });
  return `${prelude}
${scanner}
local steps = {
${steps.join(',\n')}
}
local stopOnError = ${stopOnError ? 'true' : 'false'}
local out = {}
local failures = 0

local function describe(value)
	if type(value) == "string" then
		return value
	elseif type(value) == "table" then
		local ok, encoded = pcall(HttpService.JSONEncode, HttpService, value)

		return if ok then encoded else tostring(value)
	end

	return tostring(value)
end

for index, step in ipairs(steps) do
	local ok, value = pcall(step[3], HttpService:JSONDecode(step[2]))
	local text = if ok then describe(value) else "FAILED: " .. tostring(value)

	if not ok then
		failures += 1
	end

	if string.find(text, "\\n", 1, true) then
		table.insert(out, "[" .. index .. "] " .. step[1] .. ":\\n" .. text)
	else
		table.insert(out, "[" .. index .. "] " .. step[1] .. ": " .. text)
	end

	if not ok and stopOnError then
		if index < #steps then
			table.insert(out, "[stopped: " .. (#steps - index) .. " operation(s) not run]")
		end

		break
	end
end

table.insert(out, tostring(failures))

return table.unpack(out)`;
}

async function runBatch(args) {
  const operations = args.operations;
  if (!Array.isArray(operations) || operations.length === 0) return textResult('operations must be a non-empty array.', true);
  if (operations.length > MAX_BATCH_OPERATIONS) return textResult(`At most ${MAX_BATCH_OPERATIONS} operations per batch.`, true);
  for (const [index, operation] of operations.entries()) {
    if (!operation || typeof operation.tool !== 'string' || !BATCHABLE.includes(operation.tool) || !isVisible(operation.tool)) {
      return textResult(`Operation ${index + 1}: "${operation && operation.tool}" cannot be batched. Allowed: ${BATCHABLE.filter(isVisible).join(', ')}.`, true);
    }
    if (operation.args !== undefined && (operation.args === null || typeof operation.args !== 'object' || Array.isArray(operation.args))) {
      return textResult(`Operation ${index + 1}: args must be an object.`, true);
    }
  }
  const picked = pickStudio(args.studio);
  if (picked.error) return textResult(picked.error, true);
  let code;
  try {
    code = buildBatchCode(operations, args.stop_on_error !== false);
  } catch (err) {
    return textResult(`Could not build the batch: ${err.message}`, true);
  }
  const requested = Number(args.timeout_seconds);
  const timeoutS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
  const result = await dispatch(picked.studio, code, timeoutS);
  let failed = 0;
  if (result.ok && Array.isArray(result.returned) && result.returned.length > 0) {
    failed = Number(result.returned[result.returned.length - 1]) || 0;
    result.returned = result.returned.slice(0, -1);
  }
  return textResult(render(result, picked.studio, true), !result.ok || failed > 0);
}

function saveFilesDetailed(result) {
  const files = Array.isArray(result.files) ? result.files : [];
  if (files.length === 0) return [];
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const safeName = String(file.name || 'export.bin').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) || 'export.bin';
    const target = path.join(exportsDir, `${Date.now()}-${safeName}`);
    const bytes = Buffer.from(String(file.base64 || ''), 'base64');
    fs.writeFileSync(target, bytes);
    saved.push({ path: target, bytes: bytes.length });
  }
  return saved;
}

function saveFiles(result) {
  return saveFilesDetailed(result).map((file) => `saved ${file.bytes} bytes to ${file.path}`);
}

function leafName(instancePath) {
  const quoted = String(instancePath).match(/\["([^"]+)"\]$/);
  if (quoted) return quoted[1];
  return String(instancePath).split('.').pop();
}

function render(result, studio, handler = false) {
  const parts = [];
  if (!handler || activeStudios().length > 1) {
    parts.push(`[${studio.placeName} | placeId ${studio.placeId} | ${studio.id.slice(0, 8)}]`);
  }
  const output = Array.isArray(result.output) ? result.output : [];
  if (output.length) parts.push(output.join('\n'));
  if (result.ok) {
    const returned = Array.isArray(result.returned) ? result.returned : [];
    if (returned.length) parts.push(handler ? returned.join('\n') : 'Returned: ' + returned.join(', '));
    else if (!output.length) parts.push('(no output)');
  } else {
    parts.push('Error: ' + (result.error || 'unknown error'));
  }
  parts.push(...saveFiles(result));
  return parts.join('\n');
}

function takeScreenshot(titleLike, maxWidth) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `studio-bridge-${crypto.randomUUID()}.jpg`);
    const script = assetFile('screenshot.ps1');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TitleLike', titleLike, '-MaxWidth', String(maxWidth), '-OutPath', file];
    execFile('powershell.exe', args, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      const summary = String(stdout || '').trim();
      if (err || !summary.startsWith('OK') || !fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        const detail = summary || String(stderr || '').trim() || (err && err.message) || 'unknown error';
        return resolve({ content: [{ type: 'text', text: `Screenshot failed: ${detail}` }], isError: true });
      }
      const data = fs.readFileSync(file).toString('base64');
      fs.rmSync(file, { force: true });
      resolve({
        content: [
          { type: 'image', data, mimeType: 'image/jpeg' },
          { type: 'text', text: summary.slice(3).trim() },
        ],
      });
    });
  });
}

function focusStudio(titleLike) {
  return new Promise((resolve) => {
    const script = assetFile('screenshot.ps1');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TitleLike', titleLike, '-FocusOnly'];
    execFile('powershell.exe', args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout || '').trim().startsWith('OK'));
    });
  });
}

async function runHandlerOn(handler, params, base, timeoutS = DEFAULT_TIMEOUT_S) {
  const { selector, target } = splitTarget(base);
  const picked = pickStudio(selector);
  if (picked.error) return { error: picked.error };
  let code;
  try {
    code = buildHandlerCode(handler, params);
  } catch (err) {
    return { error: `Could not load handler ${handler}: ${err.message}` };
  }
  const result = await dispatch(picked.studio, code, timeoutS, target);
  return { result, studio: picked.studio };
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function guiClick(args) {
  const userSelector = args.studio ? String(args.studio) : '';
  let x = Number(args.x);
  let y = Number(args.y);
  let locatedStudio;

  if (args.path) {
    const located = await runHandlerOn('gui_locate', { path: args.path }, [userSelector, 'client'].filter(Boolean).join(' '));
    if (located.error) return textResult(located.error, true);
    if (!located.result.ok) return textResult(render(located.result, located.studio, true), true);
    locatedStudio = located.studio;
    try {
      const point = JSON.parse(located.result.returned[0]);
      x = point.x;
      y = point.y;
    } catch {
      return textResult('Could not read the button position from the client.', true);
    }
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return textResult('Pass either path, or both x and y.', true);

  const editWindows = activeStudios().filter((s) => s.role === 'edit');
  let edit = editWindows.length === 1 ? editWindows[0] : undefined;
  if (!edit && editWindows.length > 1) {
    const sameGame = locatedStudio ? editWindows.filter((s) => s.placeId !== 0 && s.placeId === locatedStudio.placeId) : [];
    edit = sameGame.length === 1 ? sameGame[0] : undefined;
  }
  if (!edit) {
    const picked = pickStudio([userSelector, 'edit'].filter(Boolean).join(' '));
    if (picked.error) return textResult(picked.error, true);
    edit = picked.studio;
  }
  await focusStudio(edit.placeName);

  const code = buildHandlerCode('gui_input', { x, y, button: args.button });
  const result = await dispatch(edit, code, DEFAULT_TIMEOUT_S);
  return textResult(render(result, edit, true), !result.ok);
}

async function importRbxm(args) {
  const file = String(args.file || '');
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return textResult(`Could not read ${file}`, true);
  }
  if (bytes.length > 12 * 1024 * 1024) return textResult('File is over 12 MB.', true);
  if (!args.scan_only && !args.parent) return textResult('parent is required unless scan_only is true.', true);
  const selector = [args.studio ? String(args.studio) : '', 'edit'].filter(Boolean).join(' ');
  const outcome = await runHandlerOn(
    'import_rbxm',
    {
      base64: bytes.toString('base64'),
      parent: args.parent,
      scan_only: args.scan_only === true,
      block_high: args.block_high,
      max_findings: args.max_findings,
    },
    selector,
    120,
  );
  if (outcome.error) return textResult(outcome.error, true);
  return textResult(render(outcome.result, outcome.studio, true), !outcome.result.ok);
}

async function docsTool(args) {
  try {
    const text = args.mode === 'read' ? await readDocs(args) : await searchDocs(args);
    return textResult(text, false);
  } catch (err) {
    return textResult('Documentation lookup failed: ' + err.message, true);
  }
}

async function inputTool(name, args) {
  const picked = pickStudio([args.studio ? String(args.studio) : '', 'edit'].filter(Boolean).join(' '));
  if (picked.error) return textResult(picked.error, true);
  await focusStudio(picked.studio.placeName);
  let code;
  try {
    code = buildHandlerCode(name, args);
  } catch (err) {
    return textResult(err.message, true);
  }
  const result = await dispatch(picked.studio, code, DEFAULT_TIMEOUT_S);
  return textResult(render(result, picked.studio, true), !result.ok);
}

async function assetSearchTool(args) {
  try {
    return textResult(formatSearch(await searchAssets(args)), false);
  } catch (err) {
    return textResult(`Asset search failed: ${err.message}`, true);
  }
}

async function assetAudit(args) {
  let scanPath = args.scan_file ? String(args.scan_file) : '';
  let scanText = '';

  if (!scanPath) {
    const selector = [args.studio ? String(args.studio) : '', 'edit'].filter(Boolean).join(' ');
    const scanned = await runHandlerOn('asset_scan', { root: args.root, include_weak: args.include_weak === true }, selector, 180);
    if (scanned.error) return textResult(scanned.error, true);
    if (!scanned.result.ok) return textResult(render({ ...scanned.result, files: [] }, scanned.studio, true), true);
    const saved = saveFilesDetailed(scanned.result);
    if (saved.length === 0) return textResult('The scan returned no data.', true);
    scanPath = saved[0].path;
    scanText = (scanned.result.returned || []).join('\n');
  }

  let scan;
  try {
    scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  } catch {
    return textResult(`Could not read the scan file: ${scanPath}`, true);
  }

  const requested = Number(args.time_budget_seconds);
  const timeBudgetS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 600) : 100;
  try {
    const audit = await runAudit({
      records: scan.records || [],
      meta: { place: scan.placeName, placeId: scan.placeId, root: scan.root, scanFile: scanPath },
      ownGroupId: args.own_group_id,
      ownUserId: args.own_user_id,
      timeBudgetS,
      includeWeak: args.include_weak === true,
    });
    return textResult([scanText, audit.text, `scan file: ${scanPath}`].filter(Boolean).join('\n'));
  } catch (err) {
    return textResult(`Audit failed: ${err.message}`, true);
  }
}

async function publishInstances(args) {
  const base = args.studio ? String(args.studio) : '';
  const selector = [base, 'edit'].filter(Boolean).join(' ');
  let paths = Array.isArray(args.paths) ? args.paths.map(String) : [];

  if (paths.length === 0 && args.parent) {
    const listed = await runHandlerOn('instance_paths', { parent: args.parent, class: args.class || 'KeyframeSequence' }, selector);
    if (listed.error) return textResult(listed.error, true);
    if (!listed.result.ok) return textResult(render(listed.result, listed.studio, true), true);
    try {
      paths = JSON.parse(listed.result.returned[0]);
    } catch {
      return textResult('Could not read the instance list from Studio.', true);
    }
  }
  if (paths.length === 0) return textResult('Nothing to publish: pass paths, or a parent that has children of the requested class.', true);
  if (paths.length > 500) return textResult('At most 500 instances per call; split the list.', true);

  const items = [];
  for (let index = 0; index < paths.length; index++) {
    const leaf = leafName(paths[index]);
    const displayName = [leaf, args.suffix].filter(Boolean).join(' ');
    const fileName = `${String(index + 1).padStart(3, '0')}-${leaf}.rbxm`;
    const exported = await runHandlerOn('export_rbxm', { paths: [paths[index]], file_name: fileName }, selector);
    if (exported.error) return textResult(exported.error, true);
    const saved = exported.result.ok ? saveFilesDetailed(exported.result) : [];
    if (saved.length === 0) {
      items.push({ file: '', display_name: displayName, label: paths[index], error: `export failed: ${exported.result.error || 'no file returned'}` });
      continue;
    }
    items.push({ file: saved[0].path, display_name: displayName, label: paths[index] });
  }

  return uploadBatch({
    items,
    asset_type: args.asset_type || 'Animation',
    creator_type: args.creator_type,
    creator_id: args.creator_id,
    description: args.description,
    wait_seconds: args.wait_seconds,
  });
}

async function viewportScreenshot(args) {
  const base = args.studio ? String(args.studio) : '';
  const frameFirst = Array.isArray(args.frame_paths) && args.frame_paths.length > 0;
  const requestedWidth = Number(args.max_width);
  const maxWidth = Number.isFinite(requestedWidth) && requestedWidth >= 0 ? Math.floor(requestedWidth) : 1000;

  if (frameFirst) {
    const framed = await runHandlerOn(
      'camera_frame',
      { paths: args.frame_paths, yaw: args.yaw, pitch: args.pitch, margin: args.margin, fov: args.fov },
      [base, 'edit'].filter(Boolean).join(' '),
    );
    if (framed.error) return textResult(framed.error, true);
    if (!framed.result.ok) return textResult(render(framed.result, framed.studio, true), true);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const shot = await runHandlerOn('viewport_screenshot', { max_width: maxWidth }, [base, 'edit'].filter(Boolean).join(' '), 90);
  if (shot.error) return textResult(shot.error, true);

  if (frameFirst && args.restore !== false) {
    await runHandlerOn('camera_set', { restore: true }, [base, 'edit'].filter(Boolean).join(' '));
  }

  if (!shot.result.ok) return textResult(render({ ...shot.result, files: [] }, shot.studio, true), true);
  const file = (Array.isArray(shot.result.files) ? shot.result.files : []).find((entry) => /^viewport-\d+x\d+\.rgba$/.test(entry.name));
  if (!file) return textResult('The viewport capture returned no image data.', true);

  const [, width, height] = file.name.match(/^viewport-(\d+)x(\d+)\.rgba$/).map(Number);
  try {
    const scaled = downscaleRgba(Buffer.from(file.base64, 'base64'), width, height, maxWidth);
    const png = rgbaToPng(scaled.width, scaled.height, scaled.rgba);
    return {
      content: [
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `${scaled.width}x${scaled.height} viewport${frameFirst ? ' (framed)' : ''}` },
      ],
    };
  } catch (err) {
    return textResult(`Could not build the image: ${err.message}`, true);
  }
}

async function callTool(name, args) {
  if (allTools.some((tool) => tool.name === name) && !isVisible(name)) return textResult(hiddenToolMessage(name), true);
  if (name === 'studio_list') {
    const active = activeStudios();
    const listing = active.length ? active.map(describeStudio).join('\n') : 'No Studio window is connected.';
    const notice = updateNotice();
    return { content: [{ type: 'text', text: notice ? `${listing}\n\n${notice}` : listing }] };
  }
  if (name === 'screenshot') {
    const picked = pickStudio(args.studio);
    const requestedWidth = Number(args.max_width);
    const maxWidth = Number.isFinite(requestedWidth) && requestedWidth >= 0 ? Math.floor(requestedWidth) : 1280;
    return takeScreenshot(picked.studio ? picked.studio.placeName : '', maxWidth);
  }
  if (name === 'run_luau') {
    if (typeof args.code !== 'string' || args.code.trim() === '') {
      return { content: [{ type: 'text', text: 'code is required' }], isError: true };
    }
    const { selector, target } = splitTarget(args.studio);
    const picked = pickStudio(selector);
    if (picked.error) return { content: [{ type: 'text', text: picked.error }], isError: true };
    const requested = Number(args.timeout_seconds);
    const timeoutS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
    const result = await dispatch(picked.studio, args.code, timeoutS, target);
    return { content: [{ type: 'text', text: render(result, picked.studio) }], isError: !result.ok };
  }
  if (name === 'asset_upload') return uploadAsset(args);
  if (name === 'asset_status') return assetStatus(args);
  if (name === 'asset_key_check') return keyCheck();
  if (name === 'asset_audit') return assetAudit(args);
  if (name === 'asset_search') return assetSearchTool(args);
  if (name === 'roblox_docs') return docsTool(args);
  if (name === 'input_keyboard' || name === 'input_mouse') return inputTool(name, args);
  if (name === 'import_rbxm') return importRbxm(args);
  if (name === 'asset_upload_batch') return uploadBatch(args);
  if (name === 'asset_batch_status') return batchStatus(args);
  if (name === 'asset_publish_instances') return publishInstances(args);
  if (name === 'gui_click') return guiClick(args);
  if (name === 'batch') return runBatch(args);
  if (name === 'bridge_update') return runBridgeUpdate(args);
  if (name === 'viewport_screenshot') return viewportScreenshot(args);
  if (handlerToolNames.has(name)) {
    const forcedRole = (toolMeta[name] && toolMeta[name].role) || null;
    const base = forcedRole ? [args.studio, forcedRole].filter(Boolean).join(' ') : args.studio;
    const { selector, target } = splitTarget(base);
    const picked = pickStudio(selector);
    if (picked.error) return { content: [{ type: 'text', text: picked.error }], isError: true };
    let code;
    try {
      code = buildHandlerCode(name, args);
    } catch (err) {
      return { content: [{ type: 'text', text: `Could not load handler ${name}: ${err.message}` }], isError: true };
    }
    const requestedTimeout = Number(args.timeout_seconds);
    const longRun = { run_test: 60, generate_model: 180 }[name];
    const handlerTimeout = longRun ? Math.min(300, Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : longRun) + 60 : DEFAULT_TIMEOUT_S;
    const result = await dispatch(picked.studio, code, handlerTimeout, target);
    return { content: [{ type: 'text', text: render(result, picked.studio, true) }], isError: !result.ok };
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'studio-bridge', version: currentVersion() },
          instructions: checkLicense().ok ? SERVER_INSTRUCTIONS : TAMPER_MESSAGE,
        },
      });
    }
    if (method === 'ping' && isRequest) return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: listedTools() } });
    if (method === 'tools/call') {
      if (!checkLicense().ok) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: TAMPER_MESSAGE }], isError: true } });
      const result = await callTool(params?.name, params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result });
    }
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err?.message || err) } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handle(message);
});
rl.on('close', () => {
  server.close();
  process.exit(0);
});
