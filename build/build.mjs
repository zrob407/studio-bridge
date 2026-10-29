import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';
import rcedit from 'rcedit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const exePath = path.join(dist, 'studio-bridge.exe');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

if (process.platform !== 'win32') throw new Error('The exe build only runs on Windows.');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'cli.mjs')],
  outfile: path.join(dist, 'studio-bridge.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
});

const assets = {
  'package.json': path.join(root, 'package.json'),
  LICENSE: path.join(root, 'LICENSE'),
  'THIRD_PARTY_NOTICES.txt': path.join(root, 'THIRD_PARTY_NOTICES.txt'),
  'tools.json': path.join(root, 'tools.json'),
  'plugin.template.lua': path.join(root, 'plugin.template.lua'),
  'plugin.stub.lua': path.join(root, 'plugin.stub.lua'),
  'screenshot.ps1': path.join(root, 'screenshot.ps1'),
};
for (const name of fs.readdirSync(path.join(root, 'handlers'))) {
  if (name.endsWith('.luau')) assets[`handlers/${name}`] = path.join(root, 'handlers', name);
}

const configPath = path.join(dist, 'sea-config.json');
const blobPath = path.join(dist, 'sea-prep.blob');
fs.writeFileSync(
  configPath,
  JSON.stringify({ main: path.join(dist, 'studio-bridge.cjs'), output: blobPath, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2),
);

const prepared = spawnSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' });
if (prepared.status !== 0) throw new Error('Node could not prepare the single-executable blob.');

fs.copyFileSync(process.execPath, exePath);

function stripSignature(file) {
  const bytes = fs.readFileSync(file);
  const peOffset = bytes.readUInt32LE(0x3c);
  const optional = peOffset + 24;
  const magic = bytes.readUInt16LE(optional);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const securityEntry = directories + 4 * 8;
  const certOffset = bytes.readUInt32LE(securityEntry);
  const certSize = bytes.readUInt32LE(securityEntry + 4);
  if (certOffset === 0 || certSize === 0) return false;
  bytes.writeUInt32LE(0, securityEntry);
  bytes.writeUInt32LE(0, securityEntry + 4);
  fs.writeFileSync(file, bytes.subarray(0, certOffset));
  return true;
}

if (stripSignature(exePath)) console.log("Removed node.exe's code signature (the copy is modified, so it would no longer be valid).");

await rcedit(exePath, {
  'version-string': {
    ProductName: 'Studio Bridge',
    FileDescription: 'Studio Bridge: MCP server and installer for Roblox Studio',
    InternalName: 'studio-bridge',
    OriginalFilename: 'studio-bridge.exe',
    LegalCopyright: 'Copyright (c) 2026 zrob407. Studio Bridge License.',
  },
  'file-version': `${pkg.version}.0`,
  'product-version': `${pkg.version}.0`,
});

await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), { sentinelFuse: SENTINEL });

fs.rmSync(blobPath);
const hash = crypto.createHash('sha256').update(fs.readFileSync(exePath)).digest('hex');
const size = (fs.statSync(exePath).size / 1048576).toFixed(1);
console.log(`Built ${exePath} (${size} MB, version ${pkg.version})`);
console.log(`sha256 ${hash}`);
