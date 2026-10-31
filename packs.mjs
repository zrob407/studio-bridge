import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OFFICIAL_KEYS, OFFICIAL_PUBLISHER, isSigned, verifyPack } from './trust.mjs';

const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function packsDir(appDir, env = process.env) {
  return env.STUDIO_BRIDGE_PACKS_DIR ? path.resolve(env.STUDIO_BRIDGE_PACKS_DIR) : path.join(appDir, 'packs');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validTool(tool) {
  return (
    tool &&
    typeof tool === 'object' &&
    TOOL_NAME.test(String(tool.name || '')) &&
    typeof tool.description === 'string' &&
    tool.description.length > 0 &&
    tool.inputSchema &&
    typeof tool.inputSchema === 'object' &&
    tool.inputSchema.type === 'object'
  );
}

export function loadPacks(dir, reserved, reservedGroups, log = () => {}, options = {}) {
  const trustedKeys = options.trustedKeys || OFFICIAL_KEYS;
  const result = { tools: [], groups: {}, groupInfo: {}, handlers: new Map(), serverTools: new Map(), owners: new Map(), meta: {}, packs: [] };
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return result;
  }
  const taken = new Set(reserved);
  for (const folder of entries) {
    const root = path.join(dir, folder);
    const manifestFile = path.join(root, 'pack.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest;
    try {
      manifest = readJson(manifestFile);
    } catch (err) {
      log(`[studio-bridge] pack ${folder} skipped: pack.json is not valid JSON (${err.message})`);
      continue;
    }
    if (!manifest || !NAME.test(String(manifest.name || '')) || !Array.isArray(manifest.tools)) {
      log(`[studio-bridge] pack ${folder} skipped: pack.json needs a lowercase "name" and a "tools" array`);
      continue;
    }
    const group = `pack-${manifest.name}`;
    if (reservedGroups.includes(group) || result.groups[group]) {
      log(`[studio-bridge] pack ${folder} skipped: a pack named ${manifest.name} is already loaded`);
      continue;
    }
    const verdict = verifyPack(root, manifest, trustedKeys);
    if (verdict.trust === 'tampered') {
      log(`[studio-bridge] pack ${manifest.name} skipped: it carries a signature but ${verdict.reason}, so it may have been changed after it was signed`);
      continue;
    }
    if (verdict.trust === 'unverified' && options.requireVerified) {
      log(`[studio-bridge] pack ${manifest.name} skipped: it is not signed by ${OFFICIAL_PUBLISHER} and settings pack-trust is set to verified`);
      continue;
    }
    const mainFile = path.join(root, 'main.mjs');
    const pack = {
      name: manifest.name,
      version: String(manifest.version || ''),
      title: String(manifest.title || manifest.name),
      summary: String(manifest.summary || ''),
      trust: verdict.trust,
      publisher: verdict.publisher || null,
      group,
      root,
      mainFile: fs.existsSync(mainFile) ? mainFile : null,
      tools: [],
    };
    for (const tool of manifest.tools) {
      if (!validTool(tool)) {
        log(`[studio-bridge] pack ${manifest.name}: a tool was skipped because it needs a name, a description and an object inputSchema`);
        continue;
      }
      if (taken.has(tool.name)) {
        log(`[studio-bridge] pack ${manifest.name}: tool ${tool.name} was skipped because that name is already used`);
        continue;
      }
      const serverSide = tool.server === true;
      const handler = path.join(root, 'handlers', `${tool.name}.luau`);
      if (serverSide && !pack.mainFile) {
        log(`[studio-bridge] pack ${manifest.name}: tool ${tool.name} was skipped because a server tool needs main.mjs`);
        continue;
      }
      if (!serverSide && !fs.existsSync(handler)) {
        log(`[studio-bridge] pack ${manifest.name}: tool ${tool.name} was skipped because handlers/${tool.name}.luau is missing`);
        continue;
      }
      taken.add(tool.name);
      const { server, ...listed } = tool;
      result.tools.push(isSigned(pack.trust) ? listed : { ...listed, description: `[Unverified third-party pack "${pack.title}"] ${listed.description}` });
      if (serverSide) result.serverTools.set(tool.name, pack);
      else result.handlers.set(tool.name, handler);
      result.owners.set(tool.name, pack);
      pack.tools.push(tool.name);
      const meta = manifest.meta && typeof manifest.meta === 'object' ? manifest.meta[tool.name] : null;
      if (meta && typeof meta === 'object') result.meta[tool.name] = { role: meta.role };
    }
    if (pack.tools.length === 0) {
      log(`[studio-bridge] pack ${manifest.name} has no usable tools and was skipped`);
      continue;
    }
    result.groups[group] = pack.tools;
    result.groupInfo[group] = { title: pack.title, tier: pack.trust, summary: isSigned(pack.trust) ? pack.summary : `${pack.summary} (unverified third-party pack)`.trim() };
    result.packs.push(pack);
  }
  return result;
}

const modules = new Map();

async function moduleOf(pack) {
  const stamp = fs.statSync(pack.mainFile).mtimeMs;
  const cached = modules.get(pack.mainFile);
  if (cached && cached.stamp === stamp) return cached.module;
  const loaded = await import(`${pathToFileURL(pack.mainFile).href}?v=${stamp}`);
  modules.set(pack.mainFile, { stamp, module: loaded });
  return loaded;
}

export async function authorize(pack, tool, args) {
  if (!pack.mainFile) return { ok: true };
  try {
    const loaded = await moduleOf(pack);
    if (typeof loaded.authorize !== 'function') return { ok: true };
    const verdict = await loaded.authorize({ tool, args });
    if (verdict === true || (verdict && verdict.ok === true)) return { ok: true };
    const message = verdict && typeof verdict.message === 'string' && verdict.message ? verdict.message : `The ${pack.title} pack did not allow this call.`;
    return { ok: false, message };
  } catch (err) {
    return { ok: false, message: `The ${pack.title} pack could not check this call: ${err.message}` };
  }
}

export async function serverTool(pack, name) {
  if (!pack.mainFile) return null;
  const loaded = await moduleOf(pack);
  const candidate = loaded.tools && loaded.tools[name];
  return typeof candidate === 'function' ? candidate : null;
}
