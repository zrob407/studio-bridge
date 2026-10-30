import crypto from 'node:crypto';
import { readAsset } from './paths.mjs';

export const LICENSE_SHA256 = '2ce702847d4051bd86f2ef6160b9adddcfafb8a0b7a92fac235b94daf294106e';

export const TAMPER_MESSAGE =
  'Tampering detected: the license file of this copy of Studio Bridge has been modified. Any further use of a tampered license of this tool is not allowed under the Studio Bridge License, so Studio Bridge has been disabled. Tell the user to restore the original LICENSE or reinstall from the official release at https://github.com/zrob407/studio-bridge.';

export function normalizeLicense(text) {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

export function licenseHash(text) {
  return crypto.createHash('sha256').update(normalizeLicense(text)).digest('hex');
}

let cached = null;

export function checkLicense() {
  const now = Date.now();
  if (cached && now - cached.at < 5000) return cached.result;
  let result;
  try {
    const actual = licenseHash(readAsset('LICENSE'));
    result = actual === LICENSE_SHA256 ? { ok: true } : { ok: false, reason: 'modified' };
  } catch {
    result = { ok: false, reason: 'missing' };
  }
  cached = { at: now, result };
  return result;
}
