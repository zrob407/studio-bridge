import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const recordsPath = path.join(dir, 'uploads.json');
const KEY_FILE = path.join(os.homedir(), '.roblox-key.txt');
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const DEFAULT_WAIT_S = 20;
const MAX_WAIT_S = 180;

const CONTENT_TYPES = {
  '.rbxm': 'model/x-rbxm',
  '.rbxmx': 'model/x-rbxm',
  '.fbx': 'model/fbx',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.tga': 'image/tga',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

const ASSET_TYPES = new Set(['Animation', 'Model', 'Decal', 'Audio', 'Mesh', 'Video']);

let queue = Promise.resolve();

function baseUrl() {
  return process.env.STUDIO_BRIDGE_ASSET_BASE || 'https://apis.roblox.com';
}

function readKey() {
  const fromEnv = process.env.ROBLOX_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (fs.existsSync(KEY_FILE)) {
    const fromFile = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (fromFile) return fromFile;
  }
  return null;
}

function loadRecords() {
  try {
    return JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveRecords(records) {
  fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2));
}

function updateRecord(operationId, patch) {
  const records = loadRecords();
  const record = records.find((entry) => entry.operationId === operationId);
  if (record) {
    Object.assign(record, patch);
    saveRecords(records);
  }
}

function fail(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

function missingKeyMessage() {
  return `No Roblox Open Cloud API key found. Put the key in ${KEY_FILE} (run in your own terminal: Set-Content "$env:USERPROFILE\\.roblox-key.txt" -Value 'YOUR_KEY' -NoNewline) or set ROBLOX_API_KEY for the MCP server. The key needs the Assets read and write permissions for the target creator.`;
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, ok: response.ok, body };
}

function describeHttpFailure(step, result) {
  const detail = result.body?.message || result.body?.error || result.body?.raw || JSON.stringify(result.body).slice(0, 300);
  const hint = result.status === 401 || result.status === 403 ? ' (check the API key, its Assets permissions, and that it is allowed for this creator and IP)' : '';
  return `${step} failed: HTTP ${result.status} ${detail}${hint}`;
}

function operationIdOf(operation) {
  const raw = operation?.operationId || operation?.path || '';
  return String(raw).replace(/^operations\//, '');
}

function summarizeOperation(operation) {
  const id = operationIdOf(operation);
  if (!operation.done) return `still processing. operation id: ${id}`;
  if (operation.error) return `failed. operation id: ${id}. ${operation.error.message || JSON.stringify(operation.error)}`;
  const response = operation.response || {};
  const assetId = response.assetId || response.id;
  const lines = [`done. operation id: ${id}`, `asset id: ${assetId}`];
  if (response.moderationResult?.moderationState) lines.push(`moderation: ${response.moderationResult.moderationState}`);
  if (response.displayName) lines.push(`name: ${response.displayName}`);
  return lines.join('\n');
}

async function pollOperation(key, id, waitS) {
  const deadline = Date.now() + waitS * 1000;
  let last;
  while (true) {
    const result = await requestJson(`${baseUrl()}/assets/v1/operations/${encodeURIComponent(id)}`, { headers: { 'x-api-key': key } });
    if (!result.ok) return { error: describeHttpFailure('Checking the upload', result) };
    last = result.body;
    if (last.done || Date.now() >= deadline) return { operation: last };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function performUpload(args) {
  const key = readKey();
  if (!key) return fail(missingKeyMessage());

  const filePath = String(args.file || '');
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return fail(`File not found: ${filePath}`);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return fail(`Unsupported file type "${extension}". Allowed: ${Object.keys(CONTENT_TYPES).join(' ')}`);

  const assetType = String(args.asset_type || '');
  if (!ASSET_TYPES.has(assetType)) return fail(`asset_type must be one of: ${[...ASSET_TYPES].join(', ')}`);
  const creatorType = String(args.creator_type || '');
  const creatorId = String(args.creator_id || '');
  if (!['user', 'group'].includes(creatorType) || !/^\d+$/.test(creatorId)) {
    return fail('creator_type ("user" or "group") and a numeric creator_id are required, so assets are never uploaded to the wrong owner.');
  }
  const displayName = String(args.display_name || path.basename(filePath, extension)).slice(0, 50);
  const description = String(args.description || '').slice(0, 1000);

  const bytes = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const records = loadRecords();
  const duplicate = records.find(
    (entry) => entry.sha256 === hash && entry.creatorType === creatorType && entry.creatorId === creatorId && entry.assetType === assetType && Date.now() - entry.at < DUPLICATE_WINDOW_MS,
  );
  if (duplicate && args.force !== true) {
    return fail(
      `This exact file was already uploaded in the last 24 hours as "${duplicate.displayName}" (operation ${duplicate.operationId}${duplicate.assetId ? `, asset ${duplicate.assetId}` : ''}). Use asset_status to check it, or pass force: true to upload again.`,
    );
  }

  const request = {
    assetType,
    displayName,
    description,
    creationContext: { creator: creatorType === 'group' ? { groupId: creatorId } : { userId: creatorId } },
  };
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('fileContent', new Blob([bytes], { type: contentType }), path.basename(filePath));

  const created = await requestJson(`${baseUrl()}/assets/v1/assets`, { method: 'POST', headers: { 'x-api-key': key }, body: form });
  if (!created.ok) return fail(describeHttpFailure('Upload', created));

  const operationId = operationIdOf(created.body);
  if (!operationId) return fail(`Upload returned no operation id: ${JSON.stringify(created.body).slice(0, 300)}`);

  records.push({ sha256: hash, file: filePath, displayName, assetType, creatorType, creatorId, operationId, at: Date.now() });
  saveRecords(records);

  const requestedWait = Number(args.wait_seconds);
  const waitS = Number.isFinite(requestedWait) && requestedWait >= 0 ? Math.min(requestedWait, MAX_WAIT_S) : DEFAULT_WAIT_S;
  const polled = await pollOperation(key, operationId, waitS);
  if (polled.error) return fail(`${polled.error}\nThe upload was accepted. operation id: ${operationId}. Do not upload again; use asset_status.`);

  const assetId = polled.operation.response?.assetId;
  if (assetId) updateRecord(operationId, { assetId: String(assetId) });
  const summary = summarizeOperation(polled.operation);
  return polled.operation.done
    ? { content: [{ type: 'text', text: summary }], isError: Boolean(polled.operation.error) }
    : ok(`${summary}\nDo not upload again. Check progress with asset_status (animations can take 80-120 seconds).`);
}

const BATCH_DELAY_MS = Number(process.env.STUDIO_BRIDGE_BATCH_DELAY_MS || 250);
const MAX_RATE_RETRIES = 3;
const MAX_BATCH_ITEMS = 2000;
const LISTED_RESULTS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commonProblem(args) {
  const assetType = String(args.asset_type || '');
  if (!ASSET_TYPES.has(assetType)) return `asset_type must be one of: ${[...ASSET_TYPES].join(', ')}`;
  const creatorType = String(args.creator_type || '');
  const creatorId = String(args.creator_id || '');
  if (!['user', 'group'].includes(creatorType) || !/^\d+$/.test(creatorId)) {
    return 'creator_type ("user" or "group") and a numeric creator_id are required, so assets are never uploaded to the wrong owner.';
  }
  return null;
}

function buildForm(common, item, bytes, contentType) {
  const request = {
    assetType: common.assetType,
    displayName: item.displayName,
    description: item.description,
    creationContext: { creator: common.creatorType === 'group' ? { groupId: common.creatorId } : { userId: common.creatorId } },
  };
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('fileContent', new Blob([bytes], { type: contentType }), path.basename(item.file));
  return form;
}

async function postWithRateRetry(key, makeForm) {
  let attempt = 0;
  while (true) {
    const result = await requestJson(`${baseUrl()}/assets/v1/assets`, { method: 'POST', headers: { 'x-api-key': key }, body: makeForm() });
    if (result.status !== 429 || attempt >= MAX_RATE_RETRIES) return result;
    attempt++;
    await sleep(2000 * attempt);
  }
}

function describeEntryOutcome(entry) {
  if (entry.status === 'failed') return `FAILED ${entry.error}`;
  if (entry.operationError) return `FAILED ${entry.operationError}`;
  if (entry.assetId) return `asset ${entry.assetId}${entry.moderation ? ` (${entry.moderation})` : ''}`;
  return `processing (operation ${entry.operationId})`;
}

function summarizeBatch(results, aborted, resultsFile) {
  const failed = results.filter((entry) => entry.status === 'failed' || entry.operationError);
  const done = results.filter((entry) => entry.assetId);
  const reused = results.filter((entry) => entry.status === 'reused');
  const pending = results.filter((entry) => !entry.assetId && entry.status !== 'failed' && !entry.operationError);
  const lines = [`${results.length} item(s): ${done.length} with asset ids (${reused.length} reused from earlier uploads), ${pending.length} still processing, ${failed.length} failed`];
  if (aborted) lines.push(`BATCH STOPPED EARLY: ${aborted}`);
  for (const entry of failed.slice(0, 10)) lines.push(`  failed: ${entry.label} -> ${describeEntryOutcome(entry)}`);
  if (failed.length > 10) lines.push(`  ...and ${failed.length - 10} more failures (see the results file)`);
  if (pending.length > 0) lines.push(`Do not upload the pending ones again; run asset_batch_status with the results file to finish checking them.`);
  const listed = results.filter((entry) => entry.assetId).slice(0, LISTED_RESULTS);
  for (const entry of listed) lines.push(`  ${entry.displayName} = ${entry.assetId}`);
  if (done.length > listed.length) lines.push(`  ...${done.length - listed.length} more in the results file`);
  lines.push(`results file: ${resultsFile}`);
  return lines.join('\n');
}

function writeResultsFile(results, meta, existingPath) {
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const target = existingPath || path.join(exportsDir, `batch-${Date.now()}.json`);
  fs.writeFileSync(target, JSON.stringify({ meta, results }, null, 2));
  return target;
}

async function pollEntries(key, entries, waitS) {
  const deadline = Date.now() + waitS * 1000;
  while (true) {
    const open = entries.filter((entry) => entry.operationId && !entry.assetId && !entry.operationError && entry.status !== 'failed');
    if (open.length === 0) return;
    for (const entry of open) {
      const polled = await requestJson(`${baseUrl()}/assets/v1/operations/${encodeURIComponent(entry.operationId)}`, { headers: { 'x-api-key': key } });
      if (polled.ok && polled.body.done) {
        if (polled.body.error) {
          entry.operationError = polled.body.error.message || JSON.stringify(polled.body.error);
        } else {
          entry.assetId = String(polled.body.response?.assetId || polled.body.response?.id || '');
          entry.moderation = polled.body.response?.moderationResult?.moderationState;
          if (entry.assetId) updateRecord(entry.operationId, { assetId: entry.assetId });
        }
      }
      await sleep(80);
    }
    if (Date.now() >= deadline) return;
    await sleep(POLL_INTERVAL_MS);
  }
}

async function performBatch(args) {
  const key = readKey();
  if (!key) return fail(missingKeyMessage());
  const problem = commonProblem(args);
  if (problem) return fail(problem);
  if (!Array.isArray(args.items) || args.items.length === 0) return fail('items is required (a list of {file, display_name, description, label}).');
  if (args.items.length > MAX_BATCH_ITEMS) return fail(`At most ${MAX_BATCH_ITEMS} items per batch.`);

  const common = { assetType: String(args.asset_type), creatorType: String(args.creator_type), creatorId: String(args.creator_id) };
  const records = loadRecords();
  const results = [];
  let aborted = null;

  for (const raw of args.items) {
    const filePath = String(raw.file || '');
    const extension = path.extname(filePath).toLowerCase();
    const displayName = String(raw.display_name || path.basename(filePath, extension)).slice(0, 50);
    const entry = { label: String(raw.label || filePath), file: filePath, displayName, status: 'pending' };
    results.push(entry);

    if (aborted) {
      entry.status = 'failed';
      entry.error = 'skipped because the batch stopped early';
      continue;
    }
    if (raw.error) {
      entry.status = 'failed';
      entry.error = String(raw.error);
      continue;
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      entry.status = 'failed';
      entry.error = 'file not found';
      continue;
    }
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      entry.status = 'failed';
      entry.error = `unsupported file type ${extension}`;
      continue;
    }

    const bytes = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const duplicate = records.find(
      (record) => record.sha256 === hash && record.creatorType === common.creatorType && record.creatorId === common.creatorId && record.assetType === common.assetType && Date.now() - record.at < DUPLICATE_WINDOW_MS,
    );
    if (duplicate && args.force !== true) {
      entry.status = 'reused';
      entry.operationId = duplicate.operationId;
      if (duplicate.assetId) entry.assetId = duplicate.assetId;
      continue;
    }

    const item = { file: filePath, displayName, description: String(raw.description || args.description || '').slice(0, 1000) };
    let created;
    try {
      created = await postWithRateRetry(key, () => buildForm(common, item, bytes, contentType));
    } catch (err) {
      entry.status = 'failed';
      entry.error = `request error: ${err.message}. It may or may not have been created, so check the dashboard before retrying.`;
      continue;
    }
    if (!created.ok) {
      entry.status = 'failed';
      entry.error = describeHttpFailure('Upload', created);
      if (created.status === 401 || created.status === 403) aborted = entry.error;
      continue;
    }
    const operationId = operationIdOf(created.body);
    if (!operationId) {
      entry.status = 'failed';
      entry.error = `no operation id in the response: ${JSON.stringify(created.body).slice(0, 200)}`;
      continue;
    }
    entry.status = 'uploaded';
    entry.operationId = operationId;
    records.push({ sha256: hash, file: filePath, displayName, assetType: common.assetType, creatorType: common.creatorType, creatorId: common.creatorId, operationId, at: Date.now() });
    saveRecords(records);
    await sleep(BATCH_DELAY_MS);
  }

  const requestedWait = Number(args.wait_seconds);
  const waitS = Number.isFinite(requestedWait) && requestedWait >= 0 ? Math.min(requestedWait, 600) : 60;
  try {
    await pollEntries(key, results, waitS);
  } catch (err) {
    aborted = aborted || `polling error: ${err.message}`;
  }

  const resultsFile = writeResultsFile(results, { ...common, createdAt: new Date().toISOString() });
  return { content: [{ type: 'text', text: summarizeBatch(results, aborted, resultsFile) }], isError: results.every((entry) => entry.status === 'failed') };
}

export function uploadBatch(args) {
  const run = queue.then(() => performBatch(args));
  queue = run.catch(() => {});
  return run.catch((err) => fail(`Batch error: ${err.message}`));
}

export async function batchStatus(args) {
  const key = readKey();
  if (!key) return fail(missingKeyMessage());
  const file = String(args.results_file || '');
  if (!file || !fs.existsSync(file)) return fail(`Results file not found: ${file}`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fail('Could not read the results file.');
  }
  const requestedWait = Number(args.wait_seconds);
  const waitS = Number.isFinite(requestedWait) && requestedWait >= 0 ? Math.min(requestedWait, 600) : 30;
  try {
    await pollEntries(key, data.results, waitS);
  } catch (err) {
    return fail(`Polling error: ${err.message}`);
  }
  writeResultsFile(data.results, data.meta, file);
  return ok(summarizeBatch(data.results, null, file));
}

export function uploadAsset(args) {
  const run = queue.then(() => performUpload(args));
  queue = run.catch(() => {});
  return run.catch((err) => fail(`Upload error: ${err.message}`));
}

export async function assetStatus(args) {
  const key = readKey();
  if (!key) return fail(missingKeyMessage());
  const id = String(args.operation_id || '').replace(/^operations\//, '');
  if (!id) return fail('operation_id is required');
  try {
    const result = await requestJson(`${baseUrl()}/assets/v1/operations/${encodeURIComponent(id)}`, { headers: { 'x-api-key': key } });
    if (!result.ok) return fail(describeHttpFailure('Status check', result));
    const assetId = result.body.response?.assetId;
    if (result.body.done && assetId) updateRecord(id, { assetId: String(assetId) });
    return { content: [{ type: 'text', text: summarizeOperation(result.body) }], isError: Boolean(result.body.error) };
  } catch (err) {
    return fail(`Status check error: ${err.message}`);
  }
}

export async function keyCheck() {
  const key = readKey();
  if (!key) return fail(missingKeyMessage());
  const source = process.env.ROBLOX_API_KEY && process.env.ROBLOX_API_KEY.trim() ? 'ROBLOX_API_KEY' : KEY_FILE;
  try {
    const result = await requestJson(`${baseUrl()}/assets/v1/operations/key-check`, { headers: { 'x-api-key': key } });
    if (result.status === 401) return fail(`Key found in ${source} (${key.length} characters) but Roblox rejected it (401). It is wrong, revoked or expired.`);
    if (result.status === 403) return fail(`Key found in ${source} but it has no access to Assets (403). Add the Assets read and write permissions and the right creator, and check the IP allowlist.`);
    return ok(`Key found in ${source} (${key.length} characters) and Roblox accepted it (HTTP ${result.status}). Whether it may write for a given creator is only known on a real upload.`);
  } catch (err) {
    return fail(`Key check error: ${err.message}`);
  }
}
