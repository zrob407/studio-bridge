const DEFAULT_CHARS = 12000;
const MAX_CHARS = 40000;
const MAX_RESULTS = 25;

function docsBase() {
  return process.env.STUDIO_BRIDGE_DOCS_BASE || 'https://create.roblox.com';
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (response.status === 404) throw new Error('no such documentation page');
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.text();
}

function pagePath(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('path is required');
  let pathname = text;
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    if (url.host !== new URL(docsBase()).host) throw new Error(`only ${new URL(docsBase()).host} pages can be read`);
    pathname = url.pathname;
  }
  pathname = pathname.split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/^docs\//, '').replace(/^en-us\//, '');
  if (!pathname || pathname.includes('..')) throw new Error('that is not a documentation path');
  if (!pathname.endsWith('.md')) pathname += '.md';
  return pathname;
}

export async function searchDocs({ query, limit = 8 }) {
  if (typeof query !== 'string' || query.trim() === '') throw new Error('query is required');
  const count = Math.max(1, Math.min(Number(limit) || 8, MAX_RESULTS));
  const found = JSON.parse(await fetchText(`${docsBase()}/docs/api/search?q=${encodeURIComponent(query.trim())}`));
  const results = (found.results || []).slice(0, count);
  if (results.length === 0) return 'no documentation found';
  return results
    .map((entry) => {
      const where = String(entry.url || '').replace(/^https?:\/\/[^/]+\/docs\/(en-us\/)?/, '');
      const summary = String(entry.summary || '').replace(/\s+/g, ' ').trim();
      return `${entry.title} [${entry.type || 'page'}]  ${where}${summary ? `\n  ${summary}` : ''}`;
    })
    .join('\n');
}

export async function readDocs({ path, offset = 0, maxChars = DEFAULT_CHARS }) {
  const rel = pagePath(path);
  const text = await fetchText(`${docsBase()}/docs/${rel}`);
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(500, Math.min(Number(maxChars) || DEFAULT_CHARS, MAX_CHARS));
  const slice = text.slice(start, start + size);
  const end = start + slice.length;
  const note = end < text.length ? `\n\n[showing characters ${start} to ${end} of ${text.length}; pass offset ${end} for more]` : '';
  return `${rel}\n\n${slice}${note}`;
}
