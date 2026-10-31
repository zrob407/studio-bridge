import fs from 'node:fs';
import path from 'node:path';
import { unsupportedTools } from '../../platform.mjs';

export function offeredCatalog(source) {
  const file = fs.existsSync(source) && fs.statSync(source).isDirectory() ? path.join(source, 'tools.json') : source;
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hidden = unsupportedTools();
  if (hidden.size === 0) return catalog;
  return {
    ...catalog,
    tools: catalog.tools.filter((tool) => !hidden.has(tool.name)),
    groups: Object.fromEntries(Object.entries(catalog.groups || {}).map(([group, list]) => [group, list.filter((name) => !hidden.has(name))])),
  };
}
