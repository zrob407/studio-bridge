import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const command = target ? target : process.execPath;
const commandArgs = target ? ['serve'] : [path.join(bridgeDir, 'cli.mjs'), 'serve'];
const expected = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8')).tools;
const packageVersion = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'package.json'), 'utf8')).version;

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-sdk-'));
const token = crypto.randomBytes(16).toString('hex');
const port = 3978;

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const client = new Client({ name: 'conformance-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command,
  args: commandArgs,
  stderr: 'ignore',
  env: { STUDIO_BRIDGE_HOME: sandbox, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_OFFLINE: '1', LOCALAPPDATA: sandbox },
});

await client.connect(transport);
check('the official MCP client connects and completes the handshake', true);
const info = client.getServerVersion();
check('the server identifies itself with the real version', info && info.name === 'studio-bridge' && info.version === packageVersion, `${info && info.name} ${info && info.version}`);
const instructions = client.getInstructions() || '';
check('the server instructions reach the client', /studio_list/.test(instructions) && /batch/.test(instructions), `${instructions.length} characters`);
const capabilities = client.getServerCapabilities() || {};
check('tool list changes are advertised', capabilities.tools && capabilities.tools.listChanged === true);
await client.ping();
check('ping is answered', true);

const listed = await client.listTools();
const names = listed.tools.map((tool) => tool.name);
check('every tool is listed', listed.tools.length === expected.length, `${listed.tools.length} tools`);
check('tool names are unique and use only letters, digits, underscores and hyphens', new Set(names).size === names.length && names.every((name) => /^[a-zA-Z0-9_-]{1,64}$/.test(name)));
check('every tool has a description and an object schema', listed.tools.every((tool) => typeof tool.description === 'string' && tool.description.length > 0 && tool.inputSchema && tool.inputSchema.type === 'object'));
const noProperties = listed.tools.filter((tool) => tool.inputSchema.properties === undefined).map((tool) => tool.name);
check('every schema lists its properties', noProperties.length === 0, noProperties.join(', '));

const empty = await client.callTool({ name: 'studio_list', arguments: {} });
check('a tool call returns text content', empty.content[0].type === 'text' && /No Studio window/.test(empty.content[0].text));
const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} });
check('an unknown tool is an error result, not a crash', unknown.isError === true);
const badBatch = await client.callTool({ name: 'batch', arguments: { operations: [{ tool: 'play_start' }] } });
check('invalid arguments come back as readable errors', badBatch.isError === true && /cannot be batched/.test(badBatch.content[0].text));

let polling = true;
(async () => {
  try {
    while (polling) {
      const response = await fetch(`http://127.0.0.1:${port}/poll`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: JSON.stringify({ id: 'sdk-plugin-0001', role: 'edit', placeId: 3, placeName: 'SdkTest' }) });
      const next = await response.json();
      if (next.requestId) {
        await fetch(`http://127.0.0.1:${port}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token }, body: JSON.stringify({ requestId: next.requestId, ok: true, returned: ['ran through the sdk client'], output: [] }) });
      }
    }
  } catch {
    polling = false;
  }
})();
await new Promise((resolve) => setTimeout(resolve, 400));
const ran = await client.callTool({ name: 'run_luau', arguments: { code: 'return 1' } });
check('a call that reaches a Studio window returns its result', !ran.isError && /ran through the sdk client/.test(ran.content[0].text), ran.content[0].text.replace(/\n/g, ' | '));

polling = false;
await client.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
