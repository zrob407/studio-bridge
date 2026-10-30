const TYPES = { model: 10, decal: 13, audio: 3, image: 1, mesh: 4, meshpart: 40, video: 62, plugin: 38 };
const TYPE_NAMES = { 1: 'Image', 3: 'Audio', 4: 'Mesh', 10: 'Model', 13: 'Decal', 38: 'Plugin', 40: 'MeshPart', 62: 'Video' };
const MAX_LIMIT = 50;
const DETAIL_PARALLEL = 5;

function toolboxBase() {
  return process.env.STUDIO_BRIDGE_TOOLBOX_BASE || 'https://apis.roblox.com';
}

function economyBase() {
  return process.env.STUDIO_BRIDGE_ECONOMY_BASE || 'https://economy.roblox.com';
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

async function detailsOf(id) {
  try {
    const found = await fetchJson(`${economyBase()}/v2/assets/${id}/details`);
    return {
      name: String(found.Name || ''),
      creator: found.Creator ? String(found.Creator.Name || '') : '',
      creatorType: found.Creator ? String(found.Creator.CreatorType || '') : '',
      price: found.PriceInRobux,
      typeId: found.AssetTypeId,
    };
  } catch {
    return null;
  }
}

export function assetTypeNames() {
  return Object.keys(TYPES);
}

export async function searchAssets({ query, type = 'model', limit = 20, cursor }) {
  const typeId = TYPES[String(type).toLowerCase()];
  if (!typeId) throw new Error(`type must be one of ${assetTypeNames().join(', ')}`);
  if (typeof query !== 'string' || query.trim() === '') throw new Error('query is required');
  const count = Math.max(1, Math.min(Number(limit) || 20, MAX_LIMIT));
  const url = new URL(`${toolboxBase()}/toolbox-service/v1/marketplace/${typeId}`);
  url.searchParams.set('keyword', query.trim());
  url.searchParams.set('limit', String(count));
  if (cursor) url.searchParams.set('cursor', String(cursor));
  const found = await fetchJson(url.toString());
  const ids = (found.data || []).map((entry) => entry.id).filter((id) => Number.isFinite(Number(id)));
  const rows = new Array(ids.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(DETAIL_PARALLEL, ids.length) }, async () => {
      while (next < ids.length) {
        const index = next++;
        rows[index] = { id: ids[index], details: await detailsOf(ids[index]) };
      }
    }),
  );
  return { rows, total: found.totalResults, nextCursor: found.nextPageCursor || null, typeId };
}

export function formatSearch(result) {
  if (result.rows.length === 0) return 'no assets found';
  const lines = result.rows.map(({ id, details }) => {
    if (!details) return `${id}`;
    const price = typeof details.price === 'number' && details.price > 0 ? `, ${details.price} Robux` : '';
    const by = details.creator ? ` by ${details.creator}` : '';
    return `${id}  ${details.name}${by} (${TYPE_NAMES[details.typeId] || TYPE_NAMES[result.typeId] || 'asset'}${price})`;
  });
  if (result.nextCursor) lines.push(`more results: pass cursor "${result.nextCursor}"`);
  return lines.join('\n');
}
