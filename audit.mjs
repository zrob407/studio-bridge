import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './paths.mjs';

const dir = appDir;
const CACHE_PATH = path.join(dir, 'asset-owners.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RATE_WAITS = 3;
const NEEDS_ATTENTION_LIMIT = 40;

const TYPE_NAMES = {
  1: 'Image',
  2: 'T-Shirt',
  3: 'Audio',
  4: 'Mesh',
  8: 'Hat',
  9: 'Place',
  10: 'Model',
  11: 'Shirt',
  12: 'Pants',
  13: 'Decal',
  18: 'Face',
  21: 'Badge',
  24: 'Animation',
  38: 'Plugin',
  40: 'MeshPart',
  62: 'Video',
};

const TEMPLATE_IDS = new Set(['6372755229', '6444884337', '6444884785', '6412503613', '6444320592', '6196665106']);

function spacingMs() {
  return Number(process.env.STUDIO_BRIDGE_AUDIT_SPACING_MS || 150);
}

function economyBase() {
  return process.env.STUDIO_BRIDGE_ECONOMY_BASE || 'https://economy.roblox.com';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

function typeName(typeId) {
  return TYPE_NAMES[typeId] || (typeId ? `type ${typeId}` : 'unknown');
}

function classify(info, own, id) {
  if (!info || info.error) return 'unresolved';
  if (info.unavailable) return 'unavailable';
  if (TEMPLATE_IDS.has(String(id))) return 'template';
  const creatorId = String(info.creatorId);
  if (info.creatorType === 'Group' && own.groupId && creatorId === own.groupId) return 'own';
  if (info.creatorType === 'User' && own.userId && creatorId === own.userId) return 'own';
  if (info.creatorType === 'User' && creatorId === '1') return 'roblox';
  return 'other';
}

async function lookup(id) {
  let waits = 0;
  while (true) {
    const response = await fetch(`${economyBase()}/v2/assets/${id}/details`, { signal: AbortSignal.timeout(20000) });
    if (response.status === 429) {
      if (waits >= MAX_RATE_WAITS) return { rateLimited: true };
      waits++;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3 * waits) * 1000);
      continue;
    }
    if (response.status === 400 || response.status === 404 || response.status === 403) {
      return { info: { unavailable: true, status: response.status, fetchedAt: Date.now() } };
    }
    if (!response.ok) return { info: { error: response.status } };
    const body = await response.json();
    return {
      info: {
        name: body.Name,
        typeId: body.AssetTypeId,
        creatorType: body.Creator?.CreatorType,
        creatorId: body.Creator?.CreatorTargetId ?? body.Creator?.Id,
        creatorName: body.Creator?.Name,
        fetchedAt: Date.now(),
      },
    };
  }
}

function aggregate(records, includeWeak) {
  const assets = new Map();
  for (const record of records) {
    const weak = record.kind === 'script-weak';
    if (weak && !includeWeak) continue;
    const entry = assets.get(record.id) || { id: record.id, weakOnly: true, uses: [] };
    if (!weak) entry.weakOnly = false;
    entry.uses.push({ kind: record.kind, path: record.path, detail: record.detail });
    assets.set(record.id, entry);
  }
  return [...assets.values()];
}

export async function runAudit({ records, meta, ownGroupId, ownUserId, timeBudgetS, includeWeak }) {
  const own = { groupId: ownGroupId ? String(ownGroupId) : '', userId: ownUserId ? String(ownUserId) : '' };
  const assets = aggregate(records, includeWeak);
  const cache = loadCache();
  const started = Date.now();
  const deadline = started + timeBudgetS * 1000;
  let fetched = 0;
  let cacheHits = 0;
  let stoppedBy = null;

  for (const asset of assets) {
    const cached = cache[asset.id];
    if (cached && !cached.error && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      cacheHits++;
      continue;
    }
    if (Date.now() >= deadline) {
      stoppedBy = 'time budget';
      break;
    }
    try {
      const result = await lookup(asset.id);
      if (result.rateLimited) {
        stoppedBy = 'Roblox rate limit';
        break;
      }
      cache[asset.id] = result.info;
      fetched++;
    } catch (err) {
      cache[asset.id] = { error: err.message };
    }
    if (fetched % 25 === 0) saveCache(cache);
    await sleep(spacingMs());
  }
  saveCache(cache);

  const counts = { own: 0, roblox: 0, template: 0, other: 0, unavailable: 0, unresolved: 0 };
  const byType = {};
  const owners = new Map();
  const detailed = assets.map((asset) => {
    const info = cache[asset.id];
    const status = classify(info, own, asset.id);
    counts[status]++;
    const type = info && !info.unavailable && !info.error ? typeName(info.typeId) : 'unknown';
    byType[type] = (byType[type] || 0) + 1;
    if (status === 'other') {
      const key = `${info.creatorType}:${info.creatorId}`;
      const owner = owners.get(key) || { name: info.creatorName, type: info.creatorType, id: info.creatorId, count: 0 };
      owner.count++;
      owners.set(key, owner);
    }
    return {
      id: asset.id,
      status,
      type,
      name: info?.name,
      creatorType: info?.creatorType,
      creatorId: info?.creatorId,
      creatorName: info?.creatorName,
      onlyBareNumberInScripts: asset.weakOnly,
      uses: asset.uses,
    };
  });

  const stamp = Date.now();
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const reportPath = path.join(exportsDir, `audit-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ meta, own, counts, assets: detailed }, null, 2));

  const lines = [
    `${assets.length} unique asset ids (${records.length} references). ${assets.length - counts.unresolved} resolved (${cacheHits} from cache, ${fetched} looked up now).`,
    `own: ${counts.own} | roblox: ${counts.roblox} | studio template: ${counts.template} | other owners: ${counts.other} | unavailable: ${counts.unavailable} | unresolved: ${counts.unresolved}`,
    `by type: ${Object.entries(byType).map(([name, count]) => `${name} ${count}`).join(', ') || 'none'}`,
  ];
  if (!own.groupId && !own.userId) lines.push('Note: no own_group_id or own_user_id given, so nothing is classified as "own".');
  const topOwners = [...owners.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  if (topOwners.length) {
    lines.push('top outside owners:');
    for (const owner of topOwners) lines.push(`  ${owner.name} (${owner.type} ${owner.id}): ${owner.count}`);
  }
  const attention = detailed.filter((asset) => asset.status === 'other' || asset.status === 'unavailable');
  if (attention.length) {
    lines.push(`needs attention (${attention.length}):`);
    for (const asset of attention.slice(0, NEEDS_ATTENTION_LIMIT)) {
      const owner = asset.status === 'unavailable' ? 'unavailable or private' : `${asset.creatorName} (${asset.creatorType} ${asset.creatorId})`;
      const firstUse = asset.uses[0];
      lines.push(`  ${asset.id} | ${asset.type} | ${asset.name || '?'} | ${owner} | ${firstUse.path}${firstUse.detail ? '.' + firstUse.detail : ''}${asset.uses.length > 1 ? ` (+${asset.uses.length - 1} more)` : ''}`);
    }
    if (attention.length > NEEDS_ATTENTION_LIMIT) lines.push(`  ...${attention.length - NEEDS_ATTENTION_LIMIT} more in the report file`);
  }
  if (counts.unresolved > 0) {
    lines.push(`${counts.unresolved} not looked up yet (${stoppedBy || 'earlier errors'}). Run asset_audit again with the same scan_file to continue; finished lookups are cached.`);
  }
  lines.push(`report file: ${reportPath}`);
  return { text: lines.join('\n'), reportPath, counts };
}
