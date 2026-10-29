import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const tokenPath = path.join(dir, 'token.txt');
const port = process.env.STUDIO_BRIDGE_PORT || '3010';

if (!fs.existsSync(tokenPath)) {
  fs.writeFileSync(tokenPath, crypto.randomBytes(32).toString('hex'));
}

const token = fs.readFileSync(tokenPath, 'utf8').trim();
const template = fs.readFileSync(path.join(dir, 'plugin.template.lua'), 'utf8');
const source = template.replace('__PORT__', port).replace('__TOKEN__', token);

if (source.includes(']]>')) {
  throw new Error('plugin source contains a CDATA terminator');
}

const model = `<roblox version="4">
\t<Item class="Script" referent="RBX0">
\t\t<Properties>
\t\t\t<string name="Name">ClaudeStudioBridge</string>
\t\t\t<ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString>
\t\t</Properties>
\t</Item>
</roblox>
`;

const pluginsDir = path.join(process.env.LOCALAPPDATA, 'Roblox', 'Plugins');
fs.mkdirSync(pluginsDir, { recursive: true });

const target = path.join(pluginsDir, 'ClaudeStudioBridge.rbxmx');
fs.writeFileSync(target, model);

const legacy = path.join(pluginsDir, 'ClaudeStudioBridge.lua');
if (fs.existsSync(legacy)) {
  fs.unlinkSync(legacy);
}

console.log(`Plugin written to ${target}`);
console.log('Restart Roblox Studio, then open Plugins > Manage Plugins and allow HTTP requests and Script Injection for ClaudeStudioBridge.');
console.log(`Register with Claude Code:  claude mcp add --scope user studio-bridge -- node "${path.join(dir, 'server.mjs')}"`);
