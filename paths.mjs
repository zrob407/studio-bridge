import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dataDirName, dataRoot } from './platform.mjs';

const require = createRequire(import.meta.url);

let sea = null;
try {
  const candidate = require('node:sea');
  if (candidate.isSea()) sea = candidate;
} catch {
  sea = null;
}

export const isPackaged = sea !== null;

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export const installedViaNpm = !isPackaged && sourceDir.split(path.sep).includes('node_modules');

export const appDir = process.env.STUDIO_BRIDGE_HOME
  ? path.resolve(process.env.STUDIO_BRIDGE_HOME)
  : isPackaged || installedViaNpm
    ? path.join(dataRoot(), dataDirName())
    : sourceDir;

const overrideDir = path.join(appDir, 'overrides');

function onDisk(relPath) {
  const override = path.join(overrideDir, relPath);
  if (fs.existsSync(override)) return override;
  if (!isPackaged) {
    const source = path.join(sourceDir, relPath);
    if (fs.existsSync(source)) return source;
  }
  return null;
}

export function assetExists(relPath) {
  if (onDisk(relPath)) return true;
  if (!sea) return false;
  try {
    sea.getRawAsset(relPath);
    return true;
  } catch {
    return false;
  }
}

export function readAsset(relPath) {
  const file = onDisk(relPath);
  if (file) return fs.readFileSync(file, 'utf8');
  if (sea) return Buffer.from(sea.getRawAsset(relPath)).toString('utf8');
  throw new Error(`missing asset ${relPath}`);
}

export function assetFile(relPath) {
  const file = onDisk(relPath);
  if (file) return file;
  const content = readAsset(relPath);
  const target = path.join(appDir, 'runtime', relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content);
  return target;
}

export function assetOnDisk(relPath) {
  return onDisk(relPath);
}
