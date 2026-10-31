import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_PURCHASE_URL } from '../pro.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const REPO = 'https://github.com/zrob407/studio-bridge';
const SITE = 'https://zrob407.github.io/studio-bridge/';

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAV = [
  ['index.html', 'Home'],
  ['install.html', 'Install'],
  ['tools.html', 'Tools'],
  ['pro.html', 'Pro'],
  ['license.html', 'License'],
];

function page({ file, title, description, body }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}${href === 'pro.html' ? ' class="pro-link"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#12151c">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${file === 'index.html' ? '' : file}">
<meta property="og:image" content="${SITE}social-preview.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="logo-128.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site">
<div class="wrap">
<a class="brand" href="index.html"><img src="logo-128.png" alt="" width="30" height="30">Studio Bridge</a>
<nav class="main" aria-label="Main">${nav}<a href="${REPO}">GitHub</a></nav>
</div>
</header>
<main>
${body}
</main>
<footer class="site">
<div class="wrap">
<div><a href="${REPO}">GitHub</a><a href="${REPO}/releases">Releases</a><a href="https://www.npmjs.com/package/@zrob407/studio-bridge">npm</a><a href="license.html">License</a></div>
<div>Studio Bridge ${version} &middot; by zrob407. Not affiliated with Roblox.</div>
</div>
</footer>
</body>
</html>
`;
}

const index = page({
  file: 'index.html',
  title: 'Studio Bridge: AI tools for Roblox Studio',
  description: 'An MCP server and Roblox Studio plugin that lets an AI assistant read and edit your place, run Luau, drive playtests and publish assets. 79 tools, free for commercial games.',
  body: `<div class="wrap">
<div class="hero">
<img class="logo" src="logo.png" alt="Studio Bridge logo" width="96" height="96">
<h1>Let your AI work inside Roblox Studio</h1>
<p class="lead">Studio Bridge is an MCP server and Studio plugin. It lets an AI coding assistant read and edit your place, run Luau, drive playtests, take screenshots and publish assets. ${catalog.tools.length} tools, free to use for commercial games.</p>
<div class="cta">
<a class="btn" href="install.html">Get started</a>
<a class="btn secondary" href="${REPO}">View on GitHub</a>
</div>
<pre><code>npm install -g @zrob407/studio-bridge
studio-bridge install</code></pre>
</div>
</div>

<section>
<div class="wrap">
<h2>Why Studio Bridge</h2>
<div class="grid">
<div class="card"><h3>No forced restarts</h3><p>Every command has a deadline and can be cancelled. Results survive a reconnect, and the plugin reloads itself when it changes.</p></div>
<div class="card"><h3>Fewer calls and tokens</h3><p>One <code>batch</code> call runs up to 50 edits as a single undo step. Tool groups keep the tool list small: the 28 everyday tools cost about 5,700 tokens.</p></div>
<div class="card"><h3>Easy to trust</h3><p>It listens only on 127.0.0.1, needs a secret on every request, verifies the plugin's signature, collects no telemetry and ships with build provenance.</p></div>
<div class="card"><h3>Free for commercial games</h3><p>Use it to make anything you like, including paid games. The core program stays free.</p></div>
</div>
</div>
</section>

<section>
<div class="wrap">
<h2>What you can ask for</h2>
<div class="grid">
<div class="card"><p>"Generate a rocky island with a beach, scatter palm trees on it, and switch the lighting to sunset."</p></div>
<div class="card"><p>"Build a main menu, make it responsive, and check it on an iPhone, an iPad and an Xbox."</p></div>
<div class="card"><p>"Run a playtest, walk the character to the shop door, click Buy and tell me what errors show up."</p></div>
<div class="card"><p>"Find every script that uses DataStore and list the risky ones."</p></div>
<div class="card"><p>"List every asset this place uses that I do not own."</p></div>
<div class="card"><p>"Export every animation in this rig's AnimSaves folder and publish them to my group."</p></div>
</div>
<p style="margin-top:18px"><a href="tools.html">Browse all ${catalog.tools.length} tools</a></p>
</div>
</section>

<section>
<div class="wrap">
<div class="card pro">
<h2>Studio Bridge <span class="badge pro">Pro</span></h2>
<p style="margin-bottom:16px">Optional paid add-on packs on top of the free program. The first, Snapshots and diffs, saves part of a place, shows exactly what changed and rolls it back. More are planned. Nothing in the free program moves behind a paywall.</p>
<a class="btn gold" href="pro.html">See Pro</a>
</div>
</div>
</section>

<section>
<div class="wrap">
<h2>Works with</h2>
<div class="grid">
<div class="card"><h3>Claude Code</h3><p>Used and tested here. <code>studio-bridge install</code> registers it for you.</p></div>
<div class="card"><h3>Other MCP clients</h3><p>Studio Bridge speaks standard MCP. Setup for OpenAI's Codex CLI is included but has not been tried with Codex itself.</p></div>
<div class="card"><h3>Windows and Linux</h3><p>Windows is the main platform. Linux works through Wine with Vinegar or Grapejuice, including Hyprland. Linux support is new, so reports are welcome.</p></div>
</div>
</div>
</section>`,
});

const install = page({
  file: 'install.html',
  title: 'Install Studio Bridge',
  description: 'Install Studio Bridge on Windows or Linux in a few minutes: one npm command, one install command, and you are ready.',
  body: `<div class="wrap">
<div class="hero" style="text-align:left;padding-bottom:12px">
<h1>Install</h1>
<p class="lead" style="margin-left:0">You need Roblox Studio, Node 22 or newer and an MCP-ready AI tool such as Claude Code.</p>
</div>

<section class="tight">
<h2>Windows</h2>
<ol class="steps">
<li><h3>Install the program</h3><pre><code>npm install -g @zrob407/studio-bridge</code></pre><p>It runs on Node, which is signed by the OpenJS Foundation, so Windows protections such as Smart App Control do not block it the way they can block an unsigned exe.</p></li>
<li><h3>Set it up</h3><pre><code>studio-bridge install</code></pre><p>This creates a secret token, writes the Studio plugin and registers Studio Bridge with Claude Code.</p></li>
<li><h3>Restart</h3><p>Restart your AI tool and Roblox Studio. If Studio asks, allow HTTP requests and Script Injection for "Studio Bridge".</p></li>
<li><h3>Check it</h3><pre><code>studio-bridge doctor</code></pre><p>Doctor lists what is installed and tells you if something looks wrong. The Studio Bridge window in Studio should show Connected.</p></li>
</ol>
<div class="note">Prefer no Node? Download <code>studio-bridge-&lt;version&gt;.exe</code> from the <a href="${REPO}/releases">releases page</a> and double-click it. The exe is not code-signed, so Windows may warn about it. If it is blocked, use npm.</div>
</section>

<section class="tight">
<h2>Linux</h2>
<p>Roblox has no native Linux Studio, so this is for Studio running under Wine through <a href="https://github.com/vinegarhq/vinegar">Vinegar</a> or Grapejuice. The bridge and your AI tool run natively on Linux, and Studio reaches the bridge on 127.0.0.1.</p>
<ol class="steps">
<li><h3>Install and set up</h3><pre><code>npm install -g @zrob407/studio-bridge
studio-bridge install</code></pre><p>The installer finds where Studio reads plugins, including Vinegar's app data folder and the Wine prefix.</p></li>
<li><h3>Start Studio from your launcher</h3><p>Allow HTTP requests and Script Injection for "Studio Bridge" if it asks, then run <code>studio-bridge doctor</code>.</p></li>
</ol>
<div class="note">The <code>screenshot</code> tool needs Windows, or Hyprland with <code>grim</code>. <code>viewport_screenshot</code> works everywhere. Input tools need Studio to be the focused window, which Studio Bridge arranges with <code>hyprctl</code> on Hyprland and <code>xdotool</code> on other X11 desktops. The packaged exe is Windows only, so use npm on Linux.</div>
</section>

<section class="tight">
<h2>Keeping it up to date</h2>
<pre><code>studio-bridge update</code></pre>
<p>Checking for updates is on by default and can be turned off in settings. New versions are announced on the <a href="${REPO}/releases">releases page</a>.</p>
</section>

<section class="tight">
<h2>Help</h2>
<p>Run <code>studio-bridge doctor</code> first. The <a href="${REPO}#readme">README</a> covers every setting, and you can open an issue on <a href="${REPO}/issues">GitHub</a>.</p>
</section>
</div>`,
});

const groups = [
  ['core', 'Core', 'Always on. Scripts, instances, selection, screenshots, camera, starting and stopping playtests, logs, batch and the Roblox docs.'],
  ['building', 'Building', 'Terrain, lighting, scatter, spatial tools, effects, tweens, collision groups, bulk editing, asset search and insert, and model generation.'],
  ['ui', 'UI', 'Building, scaling and checking GUIs, plus the device emulator.'],
  ['playtest', 'Playtest', 'Keyboard, mouse and character control during a playtest.'],
  ['media', 'Media', 'Animation and audio.'],
  ['publishing', 'Publishing', 'Uploads, audits and exports.'],
  ['analysis', 'Analysis', 'Script, physics and audio checks.'],
];

const byName = Object.fromEntries(catalog.tools.map((tool) => [tool.name, tool]));
const firstSentence = (text) => {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  const sentence = match ? match[1] : clean;
  return sentence.length > 170 ? `${sentence.slice(0, 167).trimEnd()}...` : sentence;
};
const toolSections = groups
  .map(([id, title, blurb]) => {
    const names = catalog.groups[id] || [];
    return `<section class="tight" id="${id}">
<h2>${title} <span style="color:var(--dim);font-size:0.6em;font-weight:600">${names.length} tools</span></h2>
<p style="color:var(--dim)">${esc(blurb)}</p>
<ul class="tool-list">
${names.map((name) => `<li><code>${esc(name)}</code><span>${esc(firstSentence(byName[name].description))}</span></li>`).join('\n')}
</ul>
</section>`;
  })
  .join('\n');

const tools = page({
  file: 'tools.html',
  title: `All ${catalog.tools.length} Studio Bridge tools`,
  description: `Every tool Studio Bridge gives your AI assistant, grouped by what it does, with a one-line description of each.`,
  body: `<div class="wrap">
<div class="hero" style="text-align:left;padding-bottom:12px">
<h1>${catalog.tools.length} tools</h1>
<p class="lead" style="margin-left:0">All tools are offered by default. To save context, <code>studio-bridge settings tools core</code> offers only the 28 everyday tools, and you can add groups such as <code>building</code> or <code>ui</code> on top.</p>
</div>
<p>${groups.map(([id, title]) => `<a href="#${id}" class="badge soon" style="margin-right:6px">${title}</a>`).join('')}</p>
${toolSections}
<div class="note gold">Paid packs add their own tools. They appear only after a license is activated. See <a href="pro.html">Studio Bridge Pro</a>.</div>
</div>`,
});

const pro = page({
  file: 'pro.html',
  title: 'Studio Bridge Pro',
  description: 'Paid add-on packs for Studio Bridge. Snapshots and diffs is available now, with more planned. The free program is unchanged.',
  body: `<div class="wrap">
<div class="hero" style="padding-bottom:20px">
<h1>Studio Bridge <span class="badge pro" style="font-size:0.4em">Pro</span></h1>
<p class="lead">Paid add-on packs for any MCP-ready AI tool. The free program, with all ${catalog.tools.length} tools, is not going behind a paywall. Pro adds extra packs on top.</p>
<div class="cta">
<a class="btn gold" href="${esc(PRO_PURCHASE_URL)}">Buy a license</a>
<a class="btn secondary" href="#how">How it works</a>
</div>
</div>

<section class="tight">
<div class="split">
<div>
<h2>Plans</h2>
<table>
<tr><th>Plan</th><th>Length</th></tr>
<tr><td>1 month</td><td>Works until its end date</td></tr>
<tr><td>3 months</td><td>Works until its end date</td></tr>
<tr><td>6 months</td><td>Works until its end date</td></tr>
<tr><td>12 months</td><td>Works until its end date</td></tr>
<tr><td><strong>Lifetime</strong></td><td>Never expires. Covers every current and future version of Studio Bridge Pro, including packs added later.</td></tr>
</table>
<p style="color:var(--dim)">Prices are shown at checkout. One key works on up to three of your devices at a time. Things you made while a key was active stay yours when it ends.</p>
</div>
<div><img class="hero-image" src="product-pro.png" alt="Studio Bridge Pro: add-on packs for any MCP-ready AI" width="800" height="450"></div>
</div>
</section>

<section class="tight">
<h2>Packs</h2>
<div class="grid">
<div class="card pro"><h3>Snapshots and diffs <span class="badge live">Available</span></h3><p>Save part of your place, see exactly what changed since, and roll it back. Restoring takes an automatic safety snapshot first. Five tools: <code>snapshot_create</code>, <code>snapshot_list</code>, <code>snapshot_diff</code>, <code>snapshot_restore</code> and <code>snapshot_delete</code>.</p></div>
<div class="card"><h3>Dead-code finder <span class="badge soon">Planned</span></h3><p>Find scripts, modules and remotes that nothing uses.</p></div>
<div class="card"><h3>Audit pack <span class="badge soon">Planned</span></h3><p>A broader sweep of a place for problems, with a written report.</p></div>
<div class="card"><h3>QA playtests <span class="badge soon">Planned</span></h3><p>Scripted playtests that exercise a game and report what broke.</p></div>
<div class="card"><h3>Localization <span class="badge soon">Planned</span></h3><p>Find hard-coded text and move it into translation tables.</p></div>
</div>
<p class="note gold">Planned packs have no dates, may change or be dropped, and are not promised until they ship. Lifetime licenses include whichever of them are released, and existing licenses pick up new packs automatically.</p>
</section>

<section class="tight" id="how">
<h2>How it works</h2>
<ol class="steps">
<li><h3>Buy a license</h3><p>Checkout is handled by Polar, the seller of record. You get a license key by email.</p></li>
<li><h3>Activate it</h3><p>Open the <strong>Pro</strong> tab in the Studio Bridge window, paste the key and press <strong>Activate</strong>. Or run <code>studio-bridge pro activate</code>, which asks for the key with the typing hidden. Pro needs Studio Bridge 0.6.7 or newer.</p></li>
<li><h3>Use the tools</h3><p>The packs download automatically and their tools appear in your AI tool. <code>studio-bridge pro status</code> shows what is installed, and <code>studio-bridge pro remove</code> takes the license off this computer and frees its device slot.</p></li>
</ol>
</section>

<section class="tight">
<h2>What is sent, and what is not</h2>
<div class="grid">
<div class="card"><h3>Sent to the license server</h3><p>Your license key, a random device id the program creates, your computer's name (shown as the device label on your Polar purchases page) and your internet address.</p></div>
<div class="card"><h3>Never sent</h3><p>Your places, scripts, file names or anything else you work on.</p></div>
<div class="card"><h3>Works offline</h3><p>After activating, packs keep working offline for up to three days. They check in again every so often.</p></div>
</div>
</section>

<section class="tight">
<h2>A separate license</h2>
<p>Pro has its own license, apart from the free program's. It covers devices, what you may and may not share, plan length, privacy and refunds. Read it in plain terms on the <a href="license.html">license page</a>, or the full <a href="${REPO}/blob/main/PRO-LICENSE.txt">Pro license text</a>.</p>
<p style="margin-top:22px"><a class="btn gold" href="${esc(PRO_PURCHASE_URL)}">Buy a license</a></p>
</section>
</div>`,
});

const license = page({
  file: 'license.html',
  title: 'Studio Bridge licenses',
  description: 'Studio Bridge has two licenses: the free program is source-available and free for commercial games, and Studio Bridge Pro packs have their own separate license.',
  body: `<div class="wrap">
<div class="hero" style="text-align:left;padding-bottom:12px">
<h1>Licenses</h1>
<p class="lead" style="margin-left:0">There are two, and they are separate. These are plain-language summaries. The full texts are what count.</p>
</div>

<section class="tight">
<div class="grid">
<div class="card">
<h2>Studio Bridge (free)</h2>
<p style="margin-bottom:10px">Source-available under the Studio Bridge License, not an OSI-approved open-source license. Versions 0.2.3 and earlier were released under the MIT License and stay available under it.</p>
<ul style="color:var(--dim);padding-left:20px;margin:0 0 14px">
<li>Use, copy, modify and share it for free.</li>
<li>Use it to make anything you like, including commercial games. It claims no rights over what you make.</li>
<li>Keep the copyright notice and license, and do not present it or a modified version as your own original work.</li>
<li>You may not sell it, or charge for copies of it or for a product whose value comes mainly from it (a paid fork, a paid hosted version, selling the exe).</li>
<li>Forks should not use the name "Studio Bridge" in a way that suggests they are the original.</li>
</ul>
<a href="${REPO}/blob/main/LICENSE">Read the full license</a>
</div>
<div class="card pro">
<h2>Studio Bridge Pro <span class="badge pro">Pro</span></h2>
<p style="margin-bottom:10px">Covers the Pro packs and your license key only. Buying Pro does not change the license of the free program.</p>
<ul style="color:var(--dim);padding-left:20px;margin:0 0 14px">
<li>Use the packs for personal, educational, business and commercial work, on any number of projects. What you make is yours, with no royalties.</li>
<li>One key can be active on up to 3 devices at a time. You can free a device on your Polar purchases page.</li>
<li>Fixed plans work until their end date. Lifetime never expires and covers every current and future version, including packs added later.</li>
<li>Do not share, sell or give out your key or the packs, and do not copy, resell or publicly redistribute them.</li>
<li>Breaking the terms lets the author revoke your key without a refund. Refunds go through Polar's refund process.</li>
<li>Provided as is. The packs change things in your place, so keep backups.</li>
</ul>
<a href="${REPO}/blob/main/PRO-LICENSE.txt">Read the full Pro license</a>
</div>
</div>
</section>

<section class="tight">
<h2>Third-party components</h2>
<p>Components that ship with releases, such as the Node.js runtime embedded in the exe, are licensed under their own terms. See <a href="${REPO}/blob/main/THIRD_PARTY_NOTICES.txt">THIRD_PARTY_NOTICES.txt</a>.</p>
</section>
</div>`,
});

fs.mkdirSync(docs, { recursive: true });
for (const [name, html] of [['index.html', index], ['install.html', install], ['tools.html', tools], ['pro.html', pro], ['license.html', license]]) fs.writeFileSync(path.join(docs, name), html);
for (const asset of ['logo.png', 'logo-128.png', 'product-pro.png', 'social-preview.png']) fs.copyFileSync(path.join(root, 'assets', asset), path.join(docs, asset));
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('written', fs.readdirSync(docs).join(', '));
