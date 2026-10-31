import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OFFICIAL_PUBLISHER = 'Studio Bridge';
export const PRO_PUBLISHER = 'Studio Bridge Pro';

export const OFFICIAL_KEYS = {
  1: { tier: 'official', key: 'MCowBQYDK2VwAyEAM+hq5VRSMV+weNytGqkfDRlaxCW17RcSXxmNbvGA5u0=' },
  'pro-1': { tier: 'pro', key: 'MCowBQYDK2VwAyEA2Vjz6Wa8T4hxHXbtaQ4myHdPnV2qLXkCZoks5R1HMow=' },
};

export const isSigned = (trust) => trust === 'official' || trust === 'pro';

const SIGNED_NAME = /^(handlers\/)?[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const EXECUTABLE = /\.(mjs|cjs|js|luau)$/i;

export function executableFiles(root) {
  const found = [];
  const scan = (folder, prefix) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && EXECUTABLE.test(entry.name)) found.push(`${prefix}${entry.name}`);
      else if (entry.isDirectory() && prefix.split('/').length <= 8) scan(path.join(folder, entry.name), `${prefix}${entry.name}/`);
    }
  };
  scan(root, '');
  return found;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signedMessage(manifest, hashes) {
  const { signature, ...rest } = manifest;
  return stableStringify({ manifest: rest, files: hashes });
}

export function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function verifyPack(root, manifest, keys = OFFICIAL_KEYS) {
  const signature = manifest && manifest.signature;
  if (signature === undefined) return { trust: 'unverified' };
  const tampered = (reason) => ({ trust: 'tampered', reason });
  if (!signature || typeof signature !== 'object' || typeof signature.keyId !== 'string' || typeof signature.value !== 'string' || !Array.isArray(signature.files)) return tampered('its signature is malformed');
  const entry = keys[signature.keyId];
  const spki = typeof entry === 'string' ? entry : entry && entry.key;
  const tier = entry && typeof entry === 'object' && entry.tier === 'pro' ? 'pro' : 'official';
  if (!spki) return tampered(`it is signed with a key this version does not know (${signature.keyId})`);
  if (!signature.files.includes('main.mjs')) return tampered('its signature does not cover main.mjs');
  const hashes = {};
  for (const name of signature.files) {
    if (typeof name !== 'string' || !SIGNED_NAME.test(name)) return tampered('its signature lists an unsafe file name');
    try {
      hashes[name] = hashFile(path.join(root, ...name.split('/')));
    } catch {
      return tampered(`${name} is missing`);
    }
  }
  const unsigned = executableFiles(root).filter((name) => !signature.files.includes(name));
  if (unsigned.length > 0) return tampered(`${unsigned[0]} runs as part of the pack but is not covered by its signature`);
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
    const valid = crypto.verify(null, Buffer.from(signedMessage(manifest, hashes)), publicKey, Buffer.from(signature.value, 'base64url'));
    return valid ? { trust: tier, publisher: tier === 'pro' ? PRO_PUBLISHER : OFFICIAL_PUBLISHER } : tampered('its files or tool list do not match its signature');
  } catch {
    return tampered('its signature could not be checked');
  }
}
