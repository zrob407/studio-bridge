import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uploadAsset, assetStatus, keyCheck, uploadBatch, batchStatus } from './assets.mjs';
import { rgbaToPng, downscaleRgba } from './png.mjs';
import { runAudit } from './audit.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const token = fs.readFileSync(path.join(dir, 'token.txt'), 'utf8').trim();
const PORT = Number(process.env.STUDIO_BRIDGE_PORT || 3010);
const HOLD_MS = 15000;
const STALE_MS = 40000;
const TRANSIENT_STALE_MS = 25000;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const GRACE_MS = Number(process.env.STUDIO_BRIDGE_GRACE_MS || 10000);
const QUEUE_WAIT_MS = Number(process.env.STUDIO_BRIDGE_QUEUE_WAIT_MS || 120000);

const studios = new Map();
const pending = new Map();

function log(...parts) {
  process.stderr.write(parts.join(' ') + '\n');
}

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function touch(info) {
  const existing = studios.get(info.id);
  const studio = existing || { id: info.id, queue: [], waiter: null, inflight: new Set(), connectedAt: Date.now() };
  studio.role = info.role || 'edit';
  studio.placeId = info.placeId;
  studio.placeName = info.placeName;
  studio.gameId = info.gameId;
  studio.lastSeen = Date.now();
  studios.set(info.id, studio);
  return studio;
}

function isActive(studio) {
  const limit = studio.role === 'edit' ? STALE_MS : TRANSIENT_STALE_MS;
  return studio.inflight.size > 0 || Date.now() - studio.lastSeen < limit;
}

function activeStudios() {
  for (const [id, studio] of studios) {
    if (!isActive(studio) && Date.now() - studio.lastSeen > STALE_MS * 6) studios.delete(id);
  }
  return [...studios.values()].filter(isActive).sort((a, b) => b.connectedAt - a.connectedAt);
}

function describeStudio(studio) {
  return `${studio.id.slice(0, 8)}  ${studio.placeName} [${studio.role}] (placeId ${studio.placeId})${studio.inflight.size > 0 ? '  [busy]' : ''}`;
}

function pickStudio(selector) {
  const active = activeStudios();
  if (active.length === 0) return { error: 'No Studio window is connected. Open Studio with the bridge plugin installed and allow localhost HTTP when prompted.' };
  const tokens = selector === undefined || selector === null ? [] : String(selector).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    const editWindows = active.filter((s) => s.role === 'edit');
    if (editWindows.length === 1) return { studio: editWindows[0] };
    if (active.length === 1) return { studio: active[0] };
    return { error: 'Several Studio windows are connected, so pass "studio":\n' + active.map(describeStudio).join('\n') };
  }
  const matches = active.filter((s) =>
    tokens.every(
      (token) =>
        s.id.toLowerCase().startsWith(token) ||
        String(s.placeId) === token ||
        String(s.placeName).toLowerCase().includes(token) ||
        s.role === token,
    ),
  );
  if (matches.length === 1) return { studio: matches[0] };
  if (matches.length > 1 && matches[0].role !== 'edit' && matches.every((s) => s.role === matches[0].role)) return { studio: matches[0] };
  if (matches.length === 0) return { error: `No connected Studio matches "${selector}". Connected:\n` + active.map(describeStudio).join('\n') };
  return { error: `"${selector}" matches several windows:\n` + matches.map(describeStudio).join('\n') };
}

function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function release(studio, command) {
  if (studio.waiter) {
    clearTimeout(studio.waiter.timer);
    respond(studio.waiter.res, 200, command || {});
    studio.waiter = null;
  }
}

function splitTarget(selector) {
  const tokens = selector === undefined || selector === null ? [] : String(selector).split(/\s+/).filter(Boolean);
  if (!tokens.some((token) => token.toLowerCase() === 'client')) return { selector, target: undefined };
  const rest = tokens.filter((token) => token.toLowerCase() !== 'client');
  rest.push('server');
  return { selector: rest.join(' '), target: 'client' };
}

function finish(requestId, result) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.studio.inflight.delete(requestId);
  entry.resolve(result);
  pump(entry.studio);
  return true;
}

function takeNext(studio) {
  while (studio.queue.length > 0) {
    const command = studio.queue.shift();
    const entry = pending.get(command.requestId);
    if (!entry) continue;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      finish(command.requestId, {
        ok: false,
        error: `Timed out after ${entry.timeoutS}s and the plugin did not answer. The code may still be running in Studio.`,
        output: [],
      });
    }, entry.timeoutS * 1000 + GRACE_MS);
    studio.inflight.add(command.requestId);
    return command;
  }
  return null;
}

function pump(studio) {
  if (!studio.waiter || studio.inflight.size > 0) return;
  const command = takeNext(studio);
  if (command) release(studio, command);
}

function dispatch(studio, code, timeoutS, target) {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      studio.queue = studio.queue.filter((command) => command.requestId !== requestId);
      finish(requestId, {
        ok: false,
        error: `Studio did not start this within ${Math.round(QUEUE_WAIT_MS / 1000)}s. Another command may still be running, or the plugin is not polling.`,
        output: [],
      });
    }, QUEUE_WAIT_MS);
    pending.set(requestId, { resolve, timer, studio, timeoutS });
    studio.queue.push({ requestId, code, target, timeout: timeoutS });
    pump(studio);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 40 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '');
  if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) return respond(res, 403, { error: 'forbidden' });
  if (req.method !== 'POST') return respond(res, 405, { error: 'method not allowed' });
  if (!tokenMatches(req.headers['x-bridge-token'])) return respond(res, 401, { error: 'unauthorized' });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return respond(res, 400, { error: 'bad request' });
  }

  if (req.url === '/poll') {
    if (typeof body.id !== 'string' || body.id === '') return respond(res, 400, { error: 'missing id' });
    const studio = touch(body);
    if (studio.waiter) release(studio, {});
    if (studio.inflight.size === 0) {
      const command = takeNext(studio);
      if (command) return respond(res, 200, command);
    }
    const timer = setTimeout(() => {
      if (studio.waiter && studio.waiter.res === res) {
        studio.waiter = null;
        respond(res, 200, {});
      }
    }, HOLD_MS);
    studio.waiter = { res, timer };
    res.on('close', () => {
      if (studio.waiter && studio.waiter.res === res) {
        clearTimeout(timer);
        studio.waiter = null;
        if (!res.writableEnded) studio.lastSeen = 0;
      }
    });
    return;
  }

  if (req.url === '/result') {
    const entry = pending.get(body.requestId);
    if (!entry) return respond(res, 200, { ok: true, ignored: true });
    entry.studio.lastSeen = Date.now();
    finish(body.requestId, body);
    return respond(res, 200, { ok: true });
  }

  respond(res, 404, { error: 'not found' });
});

server.on('error', (err) => {
  log(`[studio-bridge] HTTP server error: ${err.message}`);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`[studio-bridge] listening on 127.0.0.1:${PORT}`);
});

const tools = [
  {
    name: 'studio_list',
    description: 'List the Roblox Studio windows currently connected to the bridge plugin.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'screenshot',
    description:
      'Capture the Roblox Studio window as an image (brings the window to the front first). Pass "studio" to choose the window by place name when several Studio windows are open.',
    inputSchema: {
      type: 'object',
      properties: {
        studio: { type: 'string', description: 'Place name fragment (or other selector) to choose the Studio window.' },
        max_width: { type: 'number', description: 'Downscale to this width in pixels (default 1280, 0 keeps full size).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'asset_upload',
    description:
      'Upload a local file to Roblox through Open Cloud (animations as .rbxm exported with export_rbxm, models, images, audio, meshes). Needs an API key in ~/.roblox-key.txt or ROBLOX_API_KEY. Uploads run one at a time; the same file is refused for 24 hours unless force is true. If it does not finish within wait_seconds you get an operation id: poll it with asset_status and NEVER upload again (a repeat creates a duplicate asset).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the file (.rbxm .rbxmx .fbx .png .jpg .jpeg .bmp .tga .mp3 .ogg .wav .mp4).' },
        asset_type: { type: 'string', enum: ['Animation', 'Model', 'Decal', 'Audio', 'Mesh', 'Video'] },
        creator_type: { type: 'string', enum: ['user', 'group'], description: 'Who owns the asset.' },
        creator_id: { type: 'string', description: 'Numeric user or group id.' },
        display_name: { type: 'string', description: 'Asset name (max 50 chars).' },
        description: { type: 'string' },
        wait_seconds: { type: 'number', description: 'How long to wait for processing (default 20, max 180).' },
        force: { type: 'boolean', description: 'Upload even if the identical file was uploaded in the last 24 hours.' },
      },
      required: ['file', 'asset_type', 'creator_type', 'creator_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'asset_audit',
    description:
      'Find every asset id a game references (mesh, texture, sound, animation and other asset properties, string attributes, and ids written in script source) in the open Studio place, then look up who owns each one and report which are yours, Roblox\'s, someone else\'s, or unavailable. Open the .rbxl in Studio first (File > Open from File). Owner lookups are keyless and cached; big games may need a second call, passing the scan_file from the first. Results go to a report file.',
    inputSchema: {
      type: 'object',
      properties: {
        own_group_id: { type: 'string', description: 'Your group id (assets owned by it count as yours).' },
        own_user_id: { type: 'string', description: 'Your user id.' },
        studio: { type: 'string', description: 'Which Studio window (the edit window by default).' },
        root: { type: 'string', description: 'Only scan under this path (default the whole game).' },
        include_weak: { type: 'boolean', description: 'Also report bare long numbers inside scripts that might be asset ids (noisy).' },
        scan_file: { type: 'string', description: 'Skip scanning and reuse a scan file from an earlier call (to continue lookups).' },
        time_budget_seconds: { type: 'number', description: 'How long to spend on owner lookups per call (default 100, max 600).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'import_rbxm',
    description:
      'Load a .rbxm or .rbxmx file from this computer (for example one saved by export_rbxm in another place) into the open Studio place. The contents are first unpacked into a hidden holder and scanned for risky script code; if anything high-risk is found nothing is imported unless block_high is false. Use scan_only to just inspect a file. Max 12 MB. Use this to move models, rigs and animations between places.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Full path to the .rbxm or .rbxmx file.' },
        parent: { type: 'string', description: 'Where to put the contents, e.g. game.Workspace.' },
        scan_only: { type: 'boolean', description: 'Only list the contents and the scan result; import nothing.' },
        block_high: { type: 'boolean', description: 'Refuse to import when high-risk code is found (default true).' },
        max_findings: { type: 'number', description: 'Default 100.' },
        studio: { type: 'string', description: 'Which Studio window (the edit window by default).' },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
  {
    name: 'asset_upload_batch',
    description:
      'Upload many local files to Roblox through Open Cloud, one at a time, without waiting on each, then check them all in one polling pass. Results (label, display name, operation id, asset id, errors) go to a JSON results file instead of the conversation. Identical files already uploaded in the last 24 hours are reused, so re-running a batch after an interruption resumes instead of duplicating. If some are still processing when it returns, finish checking with asset_batch_status and NEVER upload them again.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Files to upload.',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Absolute path.' },
              display_name: { type: 'string', description: 'Asset name (max 50 chars).' },
              description: { type: 'string' },
              label: { type: 'string', description: 'Your own key for this item (shown in results).' },
            },
            required: ['file'],
          },
        },
        asset_type: { type: 'string', enum: ['Animation', 'Model', 'Decal', 'Audio', 'Mesh', 'Video'] },
        creator_type: { type: 'string', enum: ['user', 'group'] },
        creator_id: { type: 'string', description: 'Numeric user or group id.' },
        description: { type: 'string', description: 'Default description for items without their own.' },
        wait_seconds: { type: 'number', description: 'How long to poll for processing afterwards (default 60, max 600).' },
        force: { type: 'boolean', description: 'Upload even identical files uploaded in the last 24 hours.' },
      },
      required: ['items', 'asset_type', 'creator_type', 'creator_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'asset_batch_status',
    description: 'Finish checking a batch: re-polls every unfinished item of a results file written by asset_upload_batch or asset_publish_instances, updates the file, and summarizes it. Never uploads anything.',
    inputSchema: {
      type: 'object',
      properties: {
        results_file: { type: 'string', description: 'Path of the results JSON file.' },
        wait_seconds: { type: 'number', description: 'How long to keep polling (default 30, max 600).' },
      },
      required: ['results_file'],
      additionalProperties: false,
    },
  },
  {
    name: 'asset_publish_instances',
    description:
      'Export instances from Studio (for example KeyframeSequences from a rig\'s AnimSaves folder) as separate .rbxm files and upload them all to Roblox. Each asset is named "{instance name} {suffix}" (put the rig name in suffix so it comes last). Results go to a results file; see asset_batch_status for unfinished items. Needs the same key and creator settings as asset_upload_batch.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Instance paths to publish, each as its own asset.' },
        parent: { type: 'string', description: 'Alternative to paths: publish every child of this instance of the given class.' },
        class: { type: 'string', description: 'With parent: only children of this class (default KeyframeSequence).' },
        suffix: { type: 'string', description: 'Added after the name, e.g. the rig name.' },
        asset_type: { type: 'string', enum: ['Animation', 'Model', 'Decal', 'Audio', 'Mesh', 'Video'], description: 'Default Animation.' },
        creator_type: { type: 'string', enum: ['user', 'group'] },
        creator_id: { type: 'string' },
        description: { type: 'string' },
        wait_seconds: { type: 'number' },
        studio: { type: 'string', description: 'Which Studio window (the edit window by default).' },
      },
      required: ['creator_type', 'creator_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'asset_key_check',
    description: 'Check that an Open Cloud API key is set up (in ~/.roblox-key.txt or ROBLOX_API_KEY) and accepted by Roblox, without printing it or uploading anything. Run this before the first upload.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'asset_status',
    description: 'Check an Open Cloud upload by operation id (returns the asset id when done, plus the moderation state).',
    inputSchema: {
      type: 'object',
      properties: { operation_id: { type: 'string' } },
      required: ['operation_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_luau',
    description:
      'Run Luau code inside a connected Roblox Studio window (plugin context). print/warn output and returned values come back. Changes are grouped into one undo step. Windows: the edit window (default), "server" (the running game server during a play session), and "client" (the player client, reached through a relay). If several windows are connected, pass "studio" (id prefix, placeId, part of the place name, or the role).',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Luau source to run.' },
        studio: { type: 'string', description: 'Which Studio window: id prefix, placeId, or place name fragment.' },
        timeout_seconds: { type: 'number', description: `Max seconds to wait (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}).` },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
];

const handlersDir = path.join(dir, 'handlers');

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const map = (description) => ({ type: 'object', additionalProperties: true, description });

const VALUE_FORMS =
  'Values: plain string/number/boolean, or typed objects such as {"Vector3":[x,y,z]}, {"Vector2":[x,y]}, {"Color3":[r,g,b]} (0-255), {"CFrame":[12 numbers]}, {"UDim2":[xs,xo,ys,yo]}, {"UDim":[s,o]}, {"Enum":"Enum.Material.Plastic"}, {"BrickColor":"Bright red"}, {"NumberRange":[min,max]}, {"Instance":"game.Workspace.Part"}, {"Number":"inf"}.';
const PATH_FORMS = 'Paths look like game.Workspace.Model["Name With Spaces"].Part.';

function handlerTool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        ...properties,
        studio: str('Which Studio window when several are connected: id prefix, placeId, or place name fragment.'),
      },
      required,
      additionalProperties: false,
    },
  };
}

const handlerTools = [
  handlerTool(
    'script_get',
    `Read a script's source with line numbers, optionally a line range. ${PATH_FORMS}`,
    {
      path: str('Script path.'),
      start_line: num('First line (1-based).'),
      end_line: num('Last line (inclusive).'),
      numbered: bool('Prefix lines with numbers (default true).'),
    },
    ['path'],
  ),
  handlerTool(
    'script_set',
    'Replace the whole source of an existing script. Reports a syntax error if the new source does not compile.',
    { path: str('Script path.'), source: str('New full source.') },
    ['path', 'source'],
  ),
  handlerTool(
    'script_edit',
    'Apply line edits to a script. All line numbers refer to the script as it is BEFORE the edits, so several edits in one call never drift. ops: replace (start_line, end_line, text), delete (start_line, end_line), insert (after_line, text; after_line 0 inserts at the top).',
    {
      path: str('Script path.'),
      edits: {
        type: 'array',
        description: 'Edits to apply together.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['replace', 'delete', 'insert'] },
            start_line: num('For replace/delete.'),
            end_line: num('For replace/delete; defaults to start_line.'),
            after_line: num('For insert.'),
            text: str('New text for replace/insert (may be multi-line).'),
          },
          required: ['op'],
        },
      },
    },
    ['path', 'edits'],
  ),
  handlerTool(
    'script_search',
    'Search script sources (default whole game) for text. Returns script paths with matching line numbers.',
    {
      pattern: str('Text to find.'),
      root: str('Only search under this path.'),
      plain: bool('Plain text match (default true). False uses a Lua pattern.'),
      case_sensitive: bool('Default false.'),
      context_lines: num('Lines of context around each match.'),
      max_results: num('Default 100.'),
    },
    ['pattern'],
  ),
  handlerTool(
    'script_validate',
    'Check Luau syntax of a script (by path) or of a source string, without running it.',
    { path: str('Script path.'), source: str('Source to check instead of a path.') },
  ),
  handlerTool(
    'instance_find',
    'Find instances under a root by name (substring, or * and ? wildcards), class, tag or property value.',
    {
      root: str('Search root (default game).'),
      name: str('Name fragment or wildcard pattern.'),
      exact: bool('Require the whole name to match.'),
      class: str('Class name; subclasses match unless exact_class.'),
      exact_class: bool('Match the class exactly.'),
      tag: str('CollectionService tag.'),
      property: str('Property name to compare.'),
      value: { description: `Value for property. ${VALUE_FORMS}` },
      max_results: num('Default 100.'),
    },
  ),
  handlerTool(
    'instance_children',
    `List children of an instance, optionally as a tree. ${PATH_FORMS}`,
    {
      path: str('Instance path.'),
      recursive: bool('Show descendants too.'),
      max_depth: num('Tree depth when recursive (default 3).'),
      max_results: num('Default 300.'),
    },
    ['path'],
  ),
  handlerTool(
    'instance_get',
    `Get properties, attributes, tags and child count of an instance. Without "properties" every readable property is returned (Source omitted). ${VALUE_FORMS}`,
    {
      path: str('Instance path.'),
      properties: strList('Only these properties.'),
      include_source: bool('Include Source for scripts.'),
    },
    ['path'],
  ),
  handlerTool(
    'instance_set',
    `Set properties, attributes and tags on one or many instances. ${VALUE_FORMS}`,
    {
      path: str('Single instance path.'),
      paths: strList('Several instance paths.'),
      properties: map('Property name to value.'),
      attributes: map('Attribute name to value.'),
      remove_attributes: strList('Attribute names to remove.'),
      add_tags: strList('Tags to add.'),
      remove_tags: strList('Tags to remove.'),
    },
  ),
  handlerTool(
    'instance_create',
    `Create instances of a class under a parent. ${VALUE_FORMS}`,
    {
      class: str('Class name, e.g. Part, Folder, Script.'),
      parent: str('Parent path.'),
      name: str('Name.'),
      count: num('How many (default 1).'),
      properties: map('Property name to value.'),
      attributes: map('Attribute name to value.'),
      tags: strList('Tags to add.'),
      source: str('Source for script classes.'),
    },
    ['class', 'parent'],
  ),
  handlerTool(
    'camera_set',
    'Move the Studio editor camera (not the player camera). The first move remembers the original view; call again with restore true to put it back.',
    {
      position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] camera position.' },
      target: { type: 'array', items: { type: 'number' }, description: '[x, y, z] point to look at.' },
      fov: num('Field of view in degrees.'),
      restore: bool('Restore the view saved before the first camera change.'),
    },
  ),
  handlerTool(
    'camera_frame',
    `Point the Studio editor camera at instances so they fill the view, from a chosen angle. The first move remembers the original view (camera_set with restore true brings it back). ${PATH_FORMS}`,
    {
      paths: strList('Instances (models, parts or folders of parts) to frame.'),
      yaw: num('Horizontal angle in degrees around the object (default 35).'),
      pitch: num('Height angle in degrees (default 20).'),
      margin: num('Extra distance multiplier (default 1.15).'),
      fov: num('Field of view in degrees.'),
    },
    ['paths'],
  ),
  handlerTool(
    'viewport_screenshot',
    'Capture only the 3D viewport of Studio (no panels) as an image. With frame_paths it first frames those instances from the given angle, takes the picture, then restores your camera (unless restore is false). Works without focusing the window.',
    {
      max_width: num('Downscale to this width (default 1000, 0 keeps the full size).'),
      frame_paths: strList('Optional: frame these instances before capturing.'),
      yaw: num('Angle for frame_paths (default 35).'),
      pitch: num('Angle for frame_paths (default 20).'),
      margin: num('Distance multiplier for frame_paths (default 1.15).'),
      fov: num('Field of view for frame_paths.'),
      restore: bool('Restore the camera after framing (default true).'),
    },
  ),
  handlerTool('selection_get', 'List what is currently selected in Studio (use it when the user says "this" or "the selected one").', {
    max_results: num('Default 100.'),
  }),
  handlerTool(
    'selection_set',
    `Select instances in Studio so the user can see them (an empty list clears the selection). ${PATH_FORMS}`,
    { paths: strList('Instances to select.') },
    ['paths'],
  ),
  handlerTool(
    'export_rbxm',
    `Serialize instances (for example a KeyframeSequence or a model) to a binary .rbxm file saved on this computer. The reply gives the saved path; pass it to asset_upload. ${PATH_FORMS}`,
    {
      paths: strList('Instances to export together.'),
      file_name: str('File name (default: the instance name + .rbxm).'),
    },
    ['paths'],
  ),
  handlerTool(
    'script_scan',
    `Scan scripts for risky code: require by asset id, loadstring, LoadAsset, getfenv/setfenv, obfuscated strings, HTTP calls, teleports, kicks, DataStore access. Findings are ranked high, medium, low with path and line. Use it on any model taken from the Creator Store or another place before trusting it. ${PATH_FORMS}`,
    {
      root: str('Scan under this path (default the whole place).'),
      max_findings: num('Default 100.'),
    },
  ),
  handlerTool(
    'logs_get',
    'Read the Output log of a Studio window. In a play session pass studio "server" or "client" to read that side (use studio_list to see which windows exist).',
    {
      count: num('Last N lines (default 50).'),
      types: strList('Only these types: output, info, warning, error.'),
      pattern: str('Only lines containing this text (case-insensitive).'),
    },
  ),
  handlerTool(
    'ui_build',
    `Build a whole GUI (or any instance tree) from one nested description. A node is {"class": "Frame", "name": "Menu", "properties": {...}, "attributes": {...}, "tags": [...], "source": "...", "children": [nodes]}. ${VALUE_FORMS} Example: {"class":"ScreenGui","name":"Menu","children":[{"class":"Frame","properties":{"Size":{"UDim2":[0,300,0,200]},"BackgroundColor3":{"Color3":[30,30,40]}},"children":[{"class":"UICorner","properties":{"CornerRadius":{"UDim":[0,8]}}}]}]}. ${PATH_FORMS}`,
    {
      parent: str('Where to build it, e.g. game.StarterGui.'),
      tree: { type: 'object', additionalProperties: true, description: 'The root node of the tree.' },
      replace: bool('Delete an existing sibling with the same name as the root first.'),
    },
    ['parent', 'tree'],
  ),
  handlerTool(
    'ui_check',
    'Check the on-screen GUI of a running play session for layout problems: off-screen or clipped elements, overlapping buttons and text, text that does not fit, small text, small touch targets, zero-size elements and low text contrast. Runs in the player client automatically, at the current viewport size (so start a play session first).',
    {
      root: str('Only check under this path (default the whole PlayerGui).'),
      min_text_size: num('Smallest allowed text size (default 12).'),
      min_touch_size: num('Smallest allowed button size in pixels (default 40).'),
      max_findings: num('Default 100.'),
    },
  ),
  handlerTool(
    'gui_snapshot',
    'List the on-screen GUI of the player in a running play session (runs in the client window automatically): path, class, text, whether it is a button or input, and its center and size in screen pixels. Use it to find what to click.',
    {
      root: str('Only under this path (default PlayerGui).'),
      visible_only: bool('Skip hidden objects (default true).'),
      max_results: num('Default 200.'),
    },
  ),
  handlerTool(
    'gui_click',
    'Click a GUI object (by path) or a screen position in the player client of a running play session, using virtual input.',
    {
      path: str('GUI object path; its center is clicked.'),
      x: num('Screen x when no path is given.'),
      y: num('Screen y when no path is given.'),
      button: { type: 'string', enum: ['left', 'right'], description: 'Default left.' },
    },
  ),
  handlerTool(
    'play_start',
    'Start a play session from the edit window. mode "play" is Play Solo (server plus client); "run" is Run mode. Warning: the game runs for real, so scripts that touch live services (DataStores with API access on, HTTP) can have real effects.',
    { mode: { type: 'string', enum: ['play', 'run'], description: 'Default play.' } },
  ),
  handlerTool(
    'run_test',
    'Run a test in a fresh play session and return the result. Your Luau runs inside a temporary server script (deleted afterwards) with a "test" table: test.signal(name, data) records a named result, test.fail(message) fails the test. An error fails the test, a normal finish passes it, the return value is reported, task.wait is allowed. Returns PASS/FAIL, duration, error, signals and the log lines produced during the session. The game runs for real, so scripts that touch live services have real effects.',
    {
      script: str('Luau test body.'),
      test_name: str('Label for the result.'),
      mode: { type: 'string', enum: ['play', 'run'], description: 'Default play (server plus a client character).' },
      timeout_seconds: num('Fail the test after this long (default 60, max 300).'),
      log_lines: num('How many trailing log lines to include (default 40).'),
    },
    ['script'],
  ),
  handlerTool(
    'play_stop',
    'Stop the running play session (targets the server window automatically).',
    { result: str('Optional text recorded as the test result.') },
  ),
  handlerTool('instance_delete', 'Delete instances (services and top-level children of game are refused).', { paths: strList('Paths to delete.') }, ['paths']),
  handlerTool('instance_move', 'Reparent instances.', { paths: strList('Paths to move.'), parent: str('New parent path.') }, ['paths', 'parent']),
  handlerTool(
    'instance_clone',
    'Clone an instance.',
    { path: str('Instance to clone.'), parent: str('Parent for the clone (default same parent).'), name: str('Name for the clone.'), count: num('Copies (default 1).') },
    ['path'],
  ),
];

const handlerToolNames = new Set(handlerTools.map((tool) => tool.name));
const allTools = [...tools, ...handlerTools];

const SCANNER_HANDLERS = new Set(['script_scan', 'import_rbxm']);

function buildHandlerCode(name, args) {
  const prelude = fs.readFileSync(path.join(handlersDir, '_prelude.luau'), 'utf8');
  const body = fs.readFileSync(path.join(handlersDir, `${name}.luau`), 'utf8');
  const scanner = SCANNER_HANDLERS.has(name) ? fs.readFileSync(path.join(handlersDir, '_scan.luau'), 'utf8') : '';
  const { studio, ...params } = args;
  const json = JSON.stringify(params);
  let level = 0;
  while (json.includes(']' + '='.repeat(level) + ']')) level++;
  const equals = '='.repeat(level);
  return `${prelude}\n${scanner}\nlocal params = HttpService:JSONDecode([${equals}[${json}]${equals}])\n${body}`;
}

function saveFilesDetailed(result) {
  const files = Array.isArray(result.files) ? result.files : [];
  if (files.length === 0) return [];
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  const saved = [];
  for (const file of files) {
    const safeName = String(file.name || 'export.bin').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) || 'export.bin';
    const target = path.join(exportsDir, `${Date.now()}-${safeName}`);
    const bytes = Buffer.from(String(file.base64 || ''), 'base64');
    fs.writeFileSync(target, bytes);
    saved.push({ path: target, bytes: bytes.length });
  }
  return saved;
}

function saveFiles(result) {
  return saveFilesDetailed(result).map((file) => `saved ${file.bytes} bytes to ${file.path}`);
}

function leafName(instancePath) {
  const quoted = String(instancePath).match(/\["([^"]+)"\]$/);
  if (quoted) return quoted[1];
  return String(instancePath).split('.').pop();
}

function render(result, studio, handler = false) {
  const parts = [];
  if (!handler || activeStudios().length > 1) {
    parts.push(`[${studio.placeName} | placeId ${studio.placeId} | ${studio.id.slice(0, 8)}]`);
  }
  const output = Array.isArray(result.output) ? result.output : [];
  if (output.length) parts.push(output.join('\n'));
  if (result.ok) {
    const returned = Array.isArray(result.returned) ? result.returned : [];
    if (returned.length) parts.push(handler ? returned.join('\n') : 'Returned: ' + returned.join(', '));
    else if (!output.length) parts.push('(no output)');
  } else {
    parts.push('Error: ' + (result.error || 'unknown error'));
  }
  parts.push(...saveFiles(result));
  return parts.join('\n');
}

function takeScreenshot(titleLike, maxWidth) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `studio-bridge-${crypto.randomUUID()}.jpg`);
    const script = path.join(dir, 'screenshot.ps1');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TitleLike', titleLike, '-MaxWidth', String(maxWidth), '-OutPath', file];
    execFile('powershell.exe', args, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      const summary = String(stdout || '').trim();
      if (err || !summary.startsWith('OK') || !fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        const detail = summary || String(stderr || '').trim() || (err && err.message) || 'unknown error';
        return resolve({ content: [{ type: 'text', text: `Screenshot failed: ${detail}` }], isError: true });
      }
      const data = fs.readFileSync(file).toString('base64');
      fs.rmSync(file, { force: true });
      resolve({
        content: [
          { type: 'image', data, mimeType: 'image/jpeg' },
          { type: 'text', text: summary.slice(3).trim() },
        ],
      });
    });
  });
}

function focusStudio(titleLike) {
  return new Promise((resolve) => {
    const script = path.join(dir, 'screenshot.ps1');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-TitleLike', titleLike, '-FocusOnly'];
    execFile('powershell.exe', args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout || '').trim().startsWith('OK'));
    });
  });
}

async function runHandlerOn(handler, params, base, timeoutS = DEFAULT_TIMEOUT_S) {
  const { selector, target } = splitTarget(base);
  const picked = pickStudio(selector);
  if (picked.error) return { error: picked.error };
  let code;
  try {
    code = buildHandlerCode(handler, params);
  } catch (err) {
    return { error: `Could not load handler ${handler}: ${err.message}` };
  }
  const result = await dispatch(picked.studio, code, timeoutS, target);
  return { result, studio: picked.studio };
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function guiClick(args) {
  const userSelector = args.studio ? String(args.studio) : '';
  let x = Number(args.x);
  let y = Number(args.y);
  let locatedStudio;

  if (args.path) {
    const located = await runHandlerOn('gui_locate', { path: args.path }, [userSelector, 'client'].filter(Boolean).join(' '));
    if (located.error) return textResult(located.error, true);
    if (!located.result.ok) return textResult(render(located.result, located.studio, true), true);
    locatedStudio = located.studio;
    try {
      const point = JSON.parse(located.result.returned[0]);
      x = point.x;
      y = point.y;
    } catch {
      return textResult('Could not read the button position from the client.', true);
    }
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return textResult('Pass either path, or both x and y.', true);

  const editWindows = activeStudios().filter((s) => s.role === 'edit');
  let edit = editWindows.length === 1 ? editWindows[0] : undefined;
  if (!edit && editWindows.length > 1) {
    const sameGame = locatedStudio ? editWindows.filter((s) => s.placeId !== 0 && s.placeId === locatedStudio.placeId) : [];
    edit = sameGame.length === 1 ? sameGame[0] : undefined;
  }
  if (!edit) {
    const picked = pickStudio([userSelector, 'edit'].filter(Boolean).join(' '));
    if (picked.error) return textResult(picked.error, true);
    edit = picked.studio;
  }
  await focusStudio(edit.placeName);

  const code = buildHandlerCode('gui_input', { x, y, button: args.button });
  const result = await dispatch(edit, code, DEFAULT_TIMEOUT_S);
  return textResult(render(result, edit, true), !result.ok);
}

async function importRbxm(args) {
  const file = String(args.file || '');
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return textResult(`Could not read ${file}`, true);
  }
  if (bytes.length > 12 * 1024 * 1024) return textResult('File is over 12 MB.', true);
  if (!args.scan_only && !args.parent) return textResult('parent is required unless scan_only is true.', true);
  const selector = [args.studio ? String(args.studio) : '', 'edit'].filter(Boolean).join(' ');
  const outcome = await runHandlerOn(
    'import_rbxm',
    {
      base64: bytes.toString('base64'),
      parent: args.parent,
      scan_only: args.scan_only === true,
      block_high: args.block_high,
      max_findings: args.max_findings,
    },
    selector,
    120,
  );
  if (outcome.error) return textResult(outcome.error, true);
  return textResult(render(outcome.result, outcome.studio, true), !outcome.result.ok);
}

async function assetAudit(args) {
  let scanPath = args.scan_file ? String(args.scan_file) : '';
  let scanText = '';

  if (!scanPath) {
    const selector = [args.studio ? String(args.studio) : '', 'edit'].filter(Boolean).join(' ');
    const scanned = await runHandlerOn('asset_scan', { root: args.root, include_weak: args.include_weak === true }, selector, 180);
    if (scanned.error) return textResult(scanned.error, true);
    if (!scanned.result.ok) return textResult(render({ ...scanned.result, files: [] }, scanned.studio, true), true);
    const saved = saveFilesDetailed(scanned.result);
    if (saved.length === 0) return textResult('The scan returned no data.', true);
    scanPath = saved[0].path;
    scanText = (scanned.result.returned || []).join('\n');
  }

  let scan;
  try {
    scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  } catch {
    return textResult(`Could not read the scan file: ${scanPath}`, true);
  }

  const requested = Number(args.time_budget_seconds);
  const timeBudgetS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 600) : 100;
  try {
    const audit = await runAudit({
      records: scan.records || [],
      meta: { place: scan.placeName, placeId: scan.placeId, root: scan.root, scanFile: scanPath },
      ownGroupId: args.own_group_id,
      ownUserId: args.own_user_id,
      timeBudgetS,
      includeWeak: args.include_weak === true,
    });
    return textResult([scanText, audit.text, `scan file: ${scanPath}`].filter(Boolean).join('\n'));
  } catch (err) {
    return textResult(`Audit failed: ${err.message}`, true);
  }
}

async function publishInstances(args) {
  const base = args.studio ? String(args.studio) : '';
  const selector = [base, 'edit'].filter(Boolean).join(' ');
  let paths = Array.isArray(args.paths) ? args.paths.map(String) : [];

  if (paths.length === 0 && args.parent) {
    const listed = await runHandlerOn('instance_paths', { parent: args.parent, class: args.class || 'KeyframeSequence' }, selector);
    if (listed.error) return textResult(listed.error, true);
    if (!listed.result.ok) return textResult(render(listed.result, listed.studio, true), true);
    try {
      paths = JSON.parse(listed.result.returned[0]);
    } catch {
      return textResult('Could not read the instance list from Studio.', true);
    }
  }
  if (paths.length === 0) return textResult('Nothing to publish: pass paths, or a parent that has children of the requested class.', true);
  if (paths.length > 500) return textResult('At most 500 instances per call; split the list.', true);

  const items = [];
  for (let index = 0; index < paths.length; index++) {
    const leaf = leafName(paths[index]);
    const displayName = [leaf, args.suffix].filter(Boolean).join(' ');
    const fileName = `${String(index + 1).padStart(3, '0')}-${leaf}.rbxm`;
    const exported = await runHandlerOn('export_rbxm', { paths: [paths[index]], file_name: fileName }, selector);
    if (exported.error) return textResult(exported.error, true);
    const saved = exported.result.ok ? saveFilesDetailed(exported.result) : [];
    if (saved.length === 0) {
      items.push({ file: '', display_name: displayName, label: paths[index], error: `export failed: ${exported.result.error || 'no file returned'}` });
      continue;
    }
    items.push({ file: saved[0].path, display_name: displayName, label: paths[index] });
  }

  return uploadBatch({
    items,
    asset_type: args.asset_type || 'Animation',
    creator_type: args.creator_type,
    creator_id: args.creator_id,
    description: args.description,
    wait_seconds: args.wait_seconds,
  });
}

async function viewportScreenshot(args) {
  const base = args.studio ? String(args.studio) : '';
  const frameFirst = Array.isArray(args.frame_paths) && args.frame_paths.length > 0;
  const requestedWidth = Number(args.max_width);
  const maxWidth = Number.isFinite(requestedWidth) && requestedWidth >= 0 ? Math.floor(requestedWidth) : 1000;

  if (frameFirst) {
    const framed = await runHandlerOn(
      'camera_frame',
      { paths: args.frame_paths, yaw: args.yaw, pitch: args.pitch, margin: args.margin, fov: args.fov },
      [base, 'edit'].filter(Boolean).join(' '),
    );
    if (framed.error) return textResult(framed.error, true);
    if (!framed.result.ok) return textResult(render(framed.result, framed.studio, true), true);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const shot = await runHandlerOn('viewport_screenshot', { max_width: maxWidth }, [base, 'edit'].filter(Boolean).join(' '), 90);
  if (shot.error) return textResult(shot.error, true);

  if (frameFirst && args.restore !== false) {
    await runHandlerOn('camera_set', { restore: true }, [base, 'edit'].filter(Boolean).join(' '));
  }

  if (!shot.result.ok) return textResult(render({ ...shot.result, files: [] }, shot.studio, true), true);
  const file = (Array.isArray(shot.result.files) ? shot.result.files : []).find((entry) => /^viewport-\d+x\d+\.rgba$/.test(entry.name));
  if (!file) return textResult('The viewport capture returned no image data.', true);

  const [, width, height] = file.name.match(/^viewport-(\d+)x(\d+)\.rgba$/).map(Number);
  try {
    const scaled = downscaleRgba(Buffer.from(file.base64, 'base64'), width, height, maxWidth);
    const png = rgbaToPng(scaled.width, scaled.height, scaled.rgba);
    return {
      content: [
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: `${scaled.width}x${scaled.height} viewport${frameFirst ? ' (framed)' : ''}` },
      ],
    };
  } catch (err) {
    return textResult(`Could not build the image: ${err.message}`, true);
  }
}

async function callTool(name, args) {
  if (name === 'studio_list') {
    const active = activeStudios();
    const text = active.length ? active.map(describeStudio).join('\n') : 'No Studio window is connected.';
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'screenshot') {
    const picked = pickStudio(args.studio);
    const requestedWidth = Number(args.max_width);
    const maxWidth = Number.isFinite(requestedWidth) && requestedWidth >= 0 ? Math.floor(requestedWidth) : 1280;
    return takeScreenshot(picked.studio ? picked.studio.placeName : '', maxWidth);
  }
  if (name === 'run_luau') {
    if (typeof args.code !== 'string' || args.code.trim() === '') {
      return { content: [{ type: 'text', text: 'code is required' }], isError: true };
    }
    const { selector, target } = splitTarget(args.studio);
    const picked = pickStudio(selector);
    if (picked.error) return { content: [{ type: 'text', text: picked.error }], isError: true };
    const requested = Number(args.timeout_seconds);
    const timeoutS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
    const result = await dispatch(picked.studio, args.code, timeoutS, target);
    return { content: [{ type: 'text', text: render(result, picked.studio) }], isError: !result.ok };
  }
  if (name === 'asset_upload') return uploadAsset(args);
  if (name === 'asset_status') return assetStatus(args);
  if (name === 'asset_key_check') return keyCheck();
  if (name === 'asset_audit') return assetAudit(args);
  if (name === 'import_rbxm') return importRbxm(args);
  if (name === 'asset_upload_batch') return uploadBatch(args);
  if (name === 'asset_batch_status') return batchStatus(args);
  if (name === 'asset_publish_instances') return publishInstances(args);
  if (name === 'gui_click') return guiClick(args);
  if (name === 'viewport_screenshot') return viewportScreenshot(args);
  if (handlerToolNames.has(name)) {
    const forcedRole = name === 'play_stop' ? 'server' : name.startsWith('gui_') || name === 'ui_check' ? 'client' : null;
    const base = forcedRole ? [args.studio, forcedRole].filter(Boolean).join(' ') : args.studio;
    const { selector, target } = splitTarget(base);
    const picked = pickStudio(selector);
    if (picked.error) return { content: [{ type: 'text', text: picked.error }], isError: true };
    let code;
    try {
      code = buildHandlerCode(name, args);
    } catch (err) {
      return { content: [{ type: 'text', text: `Could not load handler ${name}: ${err.message}` }], isError: true };
    }
    const requestedTimeout = Number(args.timeout_seconds);
    const handlerTimeout = name === 'run_test' ? Math.min(300, Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 60) + 60 : DEFAULT_TIMEOUT_S;
    const result = await dispatch(picked.studio, code, handlerTimeout, target);
    return { content: [{ type: 'text', text: render(result, picked.studio, true) }], isError: !result.ok };
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'studio-bridge', version: '0.1.0' },
        },
      });
    }
    if (method === 'ping' && isRequest) return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: allTools } });
    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result });
    }
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err?.message || err) } });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handle(message);
});
rl.on('close', () => {
  server.close();
  process.exit(0);
});
