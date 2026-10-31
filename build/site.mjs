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
const TOOLS = catalog.tools.length;

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAV = [
  ['index.html', 'Home'],
  ['install.html', 'Install'],
  ['tools.html', 'Tools'],
  ['compare.html', 'Compare'],
  ['pro.html', 'Pro'],
  ['changelog.html', 'Changelog'],
  ['license.html', 'License'],
];

const GITHUB_MARK =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

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
<script src="script.js"></script>
</head>
<body>
<div class="ambient" aria-hidden="true"><div class="orb a"></div><div class="orb b"></div><div class="wash"></div></div>
<div class="progress" aria-hidden="true"><i></i></div>
<button class="totop" type="button" aria-label="Back to top">&uarr;</button>
<header class="site">
<div class="wrap">
<a class="brand" href="index.html"><img src="logo-128.png" alt="" width="34" height="34">Studio Bridge <span class="ver">v${version}</span></a>
<nav class="main" aria-label="Main">${nav}<a class="gh" href="${REPO}">${GITHUB_MARK}GitHub</a></nav>
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

const ticker = ['Roblox Studio', 'Luau', 'MCP', 'Batch edits', 'Terrain', 'UI checks', 'Playtests', 'Animation', 'Audio', 'Publishing', 'Tool groups', 'Snapshots'];
const tickerRun = ticker.map((word) => `<span>${word}</span>`).join('');

const index = page({
  file: 'index.html',
  title: 'Studio Bridge: AI tools for Roblox Studio',
  description: `An MCP server and Roblox Studio plugin that lets an AI assistant read and edit your place, run Luau, drive playtests and publish assets. ${TOOLS} tools, free for commercial games.`,
  body: `<div class="wrap">
<div class="hero">
<div class="hero-grid">
<div data-reveal>
<p class="eyebrow">Free for commercial games &middot; Runs on your PC &middot; MCP</p>
<h1>Let your AI work inside Roblox Studio</h1>
<p class="lead">Studio Bridge is an MCP server and Studio plugin. It lets an AI coding assistant read and edit your place, run Luau, drive playtests, take screenshots and publish assets. ${TOOLS} tools, one install.</p>
<div class="cta">
<a class="btn" href="install.html">Get started</a>
<a class="btn secondary" href="${REPO}">View on GitHub</a>
</div>
<p class="chips"><span>Windows</span><span>&middot;</span><span>Linux via Wine</span><span>&middot;</span><span>Claude Code and other MCP clients</span></p>
<div class="pills">
<a class="pill" href="${REPO}/releases"><span class="dot"></span>latest <b>v${version}</b></a>
<a class="pill" href="tools.html"><b>${TOOLS}</b> tools</a>
<a class="pill" href="license.html">free for commercial games</a>
</div>
</div>

<div class="widget" data-reveal data-delay="120" data-widget>
<div class="bar"><span>HOW A REQUEST TRAVELS &middot; DEMO</span><span class="live"><i></i>running</span></div>
<div class="pipe" aria-label="Your AI, MCP, the bridge, the plugin, then Studio">
<div class="rail"><i></i></div>
<div class="node"><b>1</b><span>Your AI</span></div>
<div class="node"><b>2</b><span>MCP</span></div>
<div class="node"><b>3</b><span>Bridge</span></div>
<div class="node"><b>4</b><span>Plugin</span></div>
<div class="node"><b>5</b><span>Studio</span></div>
</div>
<div class="log" data-log aria-label="Example tool calls"><div><span class="p">&gt; </span>batch  12 edits, one undo step<span class="ok">  ok</span></div></div>
<div class="meter" style="--fill:25%"><div class="row"><span>CORE TOOLS &middot; 28</span><em>about 5,700 tokens</em></div><div class="track"><i data-fill="25"></i></div></div>
<div class="meter gold" style="--fill:100%"><div class="row"><span>ALL TOOLS &middot; ${TOOLS}</span><em>about 23,000 tokens</em></div><div class="track"><i data-fill="100"></i></div></div>
<div class="foot"><span>127.0.0.1 only</span><span>no telemetry</span></div>
</div>
</div>
</div>

<div class="ticker" aria-hidden="true"><div class="run">${tickerRun}${tickerRun}</div></div>
</div>

<section>
<div class="wrap">
<div class="section-head" data-reveal>
<p class="eyebrow">What it does</p>
<h2>Not a dashboard. A toolbox.</h2>
<p>These are the jobs that take the most clicking by hand and the least time with Studio Bridge.</p>
</div>

<div class="feat-row" data-reveal>
<div>
<div class="num">01 &middot; BULK EDITING</div>
<h3>Edit hundreds of things in one step</h3>
<p><code>batch</code> runs up to 50 edits as a single undo step. <code>instance_bulk</code> sets, adjusts or deletes everything that matches a filter, with dry runs first.</p>
<ul><li>Rename, duplicate in rows, grids and circles</li><li>Snap to a grid and change pivots</li></ul>
</div>
<div class="mock">
<div class="title"><span>batch</span><span>1 call</span></div>
<div class="line"><span class="t">instance_rename</span><span>40 parts</span></div>
<div class="line"><span class="t">instance_duplicate</span><span>a circle of copies</span></div>
<div class="line"><span class="t">snap_grid</span><span>align to the grid</span></div>
<div class="line"><span class="t">instance_bulk</span><span>dry run, then apply</span></div>
<div class="total">one undo step</div>
</div>
</div>

<div class="feat-row flip" data-reveal>
<div>
<div class="num">02 &middot; WORLD BUILDING</div>
<h3>Build a world quickly</h3>
<p><code>terrain</code> generates hills with a biome, water level and seed. <code>environment</code> switches lighting between day, sunset, night and fog. <code>scatter</code> drops props with spacing and slope alignment.</p>
<ul><li><code>spatial_find</code> finds flat spots, free space and spawn points</li><li><code>spatial_check</code> tells you what floats or overlaps</li></ul>
</div>
<div class="mock">
<div class="title"><span>world</span><span>one prompt</span></div>
<div class="tags"><span>terrain</span><span>hills</span><span>water level</span><span class="g">sunset</span><span class="g">night</span><span class="g">fog</span><span>scatter</span><span>spatial_find</span></div>
<div class="rule">Lighting presets</div>
<div class="tags"><span class="g">day</span><span class="g">sunset</span><span class="g">night</span><span class="g">fog</span></div>
</div>
</div>

<div class="feat-row" data-reveal>
<div>
<div class="num">03 &middot; UI</div>
<h3>UI that fits every device</h3>
<p><code>ui_build</code> makes a whole GUI from one description. <code>ui_autoscale</code> turns a pixel-based GUI into responsive Scale. <code>ui_responsive_check</code> lays it out on real phones, tablets and consoles.</p>
<ul><li>Reports what runs off the screen</li><li>What is too small to tap, and text that is too tiny</li></ul>
</div>
<div class="mock">
<div class="title"><span>ui_responsive_check</span><span>device emulator</span></div>
<div class="tags"><span>iPhone</span><span>iPad</span><span>Xbox</span></div>
<div class="rule">It checks for</div>
<div class="line"><span class="t">off screen</span><span>parts that run out of view</span></div>
<div class="line"><span class="t">tap size</span><span>buttons too small to press</span></div>
<div class="line"><span class="t">text</span><span>tiny or unreadable text</span></div>
</div>
</div>

<div class="feat-row flip" data-reveal>
<div>
<div class="num">04 &middot; PLAYTESTS</div>
<h3>Playtest without touching the keyboard</h3>
<p><code>character_move</code> walks the character to a spot with pathfinding. <code>input_keyboard</code> and <code>input_mouse</code> send real input, <code>gui_click</code> presses buttons by path, and <code>run_test</code> reports what happened.</p>
</div>
<div class="mock">
<div class="title"><span>playtest</span><span>hands off</span></div>
<div class="line"><span class="t">character_move</span><span>walk to the shop door</span></div>
<div class="line"><span class="t">gui_click</span><span>press Buy</span></div>
<div class="line"><span class="t">run_test</span><span>report the errors</span></div>
<div class="total">no keyboard needed</div>
</div>
</div>
</div>
</section>

<section>
<div class="wrap">
<div class="section-head" data-reveal>
<p class="eyebrow">Local by design</p>
<h2>Easy to trust</h2>
<p>The bridge runs on your computer and talks only to your own Studio.</p>
</div>
<div class="grid" data-reveal>
<div class="card"><h3>127.0.0.1 only</h3><p>It listens only on your own machine and needs a secret on every request.</p></div>
<div class="card"><h3>Signed plugin</h3><p>The plugin's signature is verified, and releases ship with build provenance.</p></div>
<div class="card"><h3>No telemetry</h3><p>Nothing about you or your places is collected.</p></div>
<div class="card"><h3>No forced restarts</h3><p>Every command has a deadline and can be cancelled, and results survive a reconnect.</p></div>
</div>
</div>
</section>

<section>
<div class="wrap">
<div class="section-head" data-reveal>
<p class="eyebrow">Side by side</p>
<h2>How it compares</h2>
<p>Roblox's built-in MCP server and the community projects each have strengths. See what each one says about itself, next to Studio Bridge.</p>
</div>
<p data-reveal><a class="btn secondary" href="compare.html">Compare Studio Bridge</a> <a class="btn secondary" href="tools.html">Search the tools</a></p>
</div>
</section>

<section>
<div class="wrap">
<div class="section-head" data-reveal>
<p class="eyebrow gold">Free and Pro</p>
<h2>The free program stays free</h2>
<p>Pro adds extra packs on top. Nothing in the free program moves behind a paywall.</p>
</div>
<div class="compare" data-reveal>
<div class="h"></div><div class="h">Free</div><div class="h pro">Pro</div>
<div class="l">Studio Bridge tools</div><div class="yes">All ${TOOLS}</div><div class="yes pro-col">All ${TOOLS} plus pack tools</div>
<div class="l">Plugin and Studio window</div><div class="yes">Included</div><div class="yes pro-col">Included</div>
<div class="l">Pack system for your own packs</div><div class="yes">Included</div><div class="yes pro-col">Included</div>
<div class="l">Snapshots and diffs</div><div class="no">Not included</div><div class="yes pro-col">Included</div>
<div class="l">Future Pro packs</div><div class="no">Not included</div><div class="yes pro-col">Included, lifetime covers all</div>
<div class="l">License</div><div>Studio Bridge License</div><div class="pro-col">Separate Pro license</div>
<div class="l">Cost</div><div>Free, even for commercial games</div><div class="pro-col">Paid plans or lifetime</div>
</div>
<p style="margin-top:20px" data-reveal><a class="btn gold" href="pro.html">See Pro</a></p>
</div>
</section>

<section>
<div class="wrap">
<div class="section-head" data-reveal>
<p class="eyebrow">Roadmap</p>
<h2>What works, and what is coming</h2>
</div>
<div class="roadmap" data-reveal>
<div class="card">
<h3>Shipped</h3>
<ul class="road-list">
<li><b>Tool groups</b>Load only the tools you need.</li>
<li><b>Linux and Hyprland</b>Studio under Wine, with Vinegar or Grapejuice.</li>
<li><b>Studio Bridge Pro</b>Paid packs, starting with Snapshots and diffs.</li>
<li><b>This website</b>Install guide, searchable tool list, comparison and changelog.</li>
</ul>
</div>
<div class="card pro">
<h3>Planned</h3>
<ul class="road-list planned">
<li><b>Dead-code finder</b>Find scripts, modules and remotes nothing uses.</li>
<li><b>Audit pack</b>A broader sweep of a place with a written report.</li>
<li><b>QA playtests</b>Scripted playtests that report what broke.</li>
<li><b>Localization</b>Move hard-coded text into translation tables.</li>
</ul>
</div>
</div>
<p style="color:var(--faint);font-size:14.5px;margin-top:14px">Planned packs have no dates and are not promised until they ship.</p>
</div>
</section>

<section>
<div class="wrap">
<div class="cta-band" data-reveal>
<p class="eyebrow">Ready when you are</p>
<h2>Install it in two commands</h2>
<pre><code>npm install -g @zrob407/studio-bridge
studio-bridge install</code></pre>
<div class="cta">
<a class="btn" href="install.html">Full install guide</a>
<a class="btn secondary" href="changelog.html">What is new</a>
</div>
</div>
</div>
</section>`,
});

const install = page({
  file: 'install.html',
  title: 'Install Studio Bridge',
  description: 'Install Studio Bridge on Windows or Linux in a few minutes: one npm command, one install command, and you are ready.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow">Get started</p>
<h1>Install</h1>
<p class="lead">You need Roblox Studio, Node 22 or newer and an MCP-ready AI tool such as Claude Code.</p>
</div>

<section class="tight" data-reveal>
<h2>Windows</h2>
<ol class="steps">
<li><h3>Install the program</h3><pre><code>npm install -g @zrob407/studio-bridge</code></pre><p>It runs on Node, which is signed by the OpenJS Foundation, so Windows protections such as Smart App Control do not block it the way they can block an unsigned exe.</p></li>
<li><h3>Set it up</h3><pre><code>studio-bridge install</code></pre><p>This creates a secret token, writes the Studio plugin and registers Studio Bridge with Claude Code.</p></li>
<li><h3>Restart</h3><p>Restart your AI tool and Roblox Studio. If Studio asks, allow HTTP requests and Script Injection for "Studio Bridge".</p></li>
<li><h3>Check it</h3><pre><code>studio-bridge doctor</code></pre><p>Doctor lists what is installed and tells you if something looks wrong. The Studio Bridge window in Studio should show Connected.</p></li>
</ol>
<div class="note">Prefer no Node? Download <code>studio-bridge-&lt;version&gt;.exe</code> from the <a href="${REPO}/releases">releases page</a> and double-click it. The exe is not code-signed, so Windows may warn about it. If it is blocked, use npm.</div>
</section>

<section class="tight" data-reveal>
<h2>Linux</h2>
<p>Roblox has no native Linux Studio, so this is for Studio running under Wine through <a href="https://github.com/vinegarhq/vinegar">Vinegar</a> or Grapejuice. The bridge and your AI tool run natively on Linux, and Studio reaches the bridge on 127.0.0.1.</p>
<ol class="steps">
<li><h3>Install and set up</h3><pre><code>npm install -g @zrob407/studio-bridge
studio-bridge install</code></pre><p>The installer finds where Studio reads plugins, including Vinegar's app data folder and the Wine prefix.</p></li>
<li><h3>Start Studio from your launcher</h3><p>Allow HTTP requests and Script Injection for "Studio Bridge" if it asks, then run <code>studio-bridge doctor</code>.</p></li>
</ol>
<div class="note">The <code>screenshot</code> tool needs Windows, or Hyprland with <code>grim</code>. <code>viewport_screenshot</code> works everywhere. Input tools need Studio to be the focused window, which Studio Bridge arranges with <code>hyprctl</code> on Hyprland and <code>xdotool</code> on other X11 desktops. The packaged exe is Windows only, so use npm on Linux.</div>
</section>

<section class="tight" data-reveal>
<h2>Keeping it up to date</h2>
<pre><code>studio-bridge update</code></pre>
<p>Checking for updates is on by default and can be turned off in settings. New versions are announced on the <a href="${REPO}/releases">releases page</a>.</p>
</section>

<section class="tight" data-reveal>
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
    return `<section class="tight" id="${id}" data-reveal data-group>
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
  title: `All ${TOOLS} Studio Bridge tools`,
  description: 'Every tool Studio Bridge gives your AI assistant, grouped by what it does, with a one-line description of each.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow">Reference</p>
<h1>${TOOLS} tools</h1>
<p class="lead">All tools are offered by default. To save context, <code>studio-bridge settings tools core</code> offers only the 28 everyday tools, and you can add groups such as <code>building</code> or <code>ui</code> on top.</p>
</div>
<div class="search-bar" data-reveal>
<label for="tool-search">Search the ${TOOLS} tools</label>
<input id="tool-search" class="search" type="search" placeholder="Try terrain, undo, playtest, animation, ui" autocomplete="off" spellcheck="false" data-tool-search>
<p class="search-count" data-tool-count aria-live="polite"></p>
</div>
<p class="group-chips">${groups.map(([id, title]) => `<a href="#${id}" class="badge soon" style="margin-right:6px">${title}</a>`).join('')}</p>
<p class="search-none" data-tool-none hidden>No tool matches that. Try a shorter word.</p>
${toolSections}
<div class="note gold">Paid packs add their own tools. They appear only after a license is activated. See <a href="pro.html">Studio Bridge Pro</a>.</div>
</div>`,
});

const SRC = {
  builtin: 'https://create.roblox.com/docs/studio/mcp',
  announce: 'https://devforum.roblox.com/t/assistant-updates-studio-built-in-mcp-server-and-playtest-automation/4474643',
  rust: 'https://github.com/Roblox/studio-rust-mcp-server',
  boshyxd: 'https://github.com/boshyxd/robloxstudio-mcp',
  chrrxs: 'https://github.com/Chrrxs/robloxstudio-mcp',
  sixvl: 'https://github.com/6xvl/robloxstudio-mcp',
  weppy: 'https://github.com/hope1026/weppy-roblox-mcp',
  weppyPost: 'https://devforum.roblox.com/t/weppy-roblox-ai-toolkit-roblox-studio-mcp-with-sync-playtest-and-ui-studio/4588907',
  kolvian: 'https://github.com/kolvian/roblox-mcp-server',
};

const COMPARE_ROWS = [
  ['Tools', `${TOOLS} (28 everyday tools, the rest in groups)`, '26, listed in Roblox\'s docs', 'Number not stated; it dispatches by action instead of one tool per function','43 in v2.7.0-next.6, 31 in its read-only edition', '"96+" across scripts, instances, terrain, lighting and more'],
  ['Setup', 'One npm command, then <code>studio-bridge install</code> writes the plugin and registers your AI tool', 'Turn on "Enable Studio as MCP server" in the Assistant. Nothing else to install', 'A one-line install script for Windows or macOS/Linux, or <code>npx</code>. Then restart your AI app and Studio','<code>npx</code> plus a Studio plugin from its Releases page', '<code>npx</code> plus a Studio plugin from its Releases page'],
  ['Status', `Under active development, version ${version}`, 'Part of Roblox Studio', 'Active: 342 commits and 70 GitHub stars. The author calls it a work in progress','Archived by its owner on June 6, 2026; it points to a fork', 'Not stated'],
  ['Plugin', 'Source is in the repository; the signature is verified', 'No separate plugin; built into Studio', 'Repository is public and the author says the source is on GitHub. The license is not called open source','Not stated', 'Compiled and obfuscated; its README says the plugin source is private'],
  ['Platforms', 'Windows, and Linux through Wine with Vinegar or Grapejuice', 'Windows and macOS setup shown in the docs', 'Windows 10+ and macOS 12+ in its requirements; Linux is not listed','Not stated for macOS or Linux', 'Only Windows paths shown'],
  ['Local security', '127.0.0.1 only, a secret on every request, signed plugin, no telemetry', 'Docs advise connecting only clients you trust', 'Localhost only and rate limited. Authentication not stated. Anonymous Google Analytics telemetry, which can be turned off','README says it works "locally and safely"; authentication not described', 'Authentication not described'],
  ['License', `Source-available. All ${TOOLS} tools are free, including for commercial games. Optional paid Pro packs add snapshots and diffs and more`, 'Not stated on the docs page', 'Its own license: Basic is free; Pro needs a paid license and includes bidirectional sync, UI Studio, bulk operations, terrain, spatial analysis, and audio and animation control','MIT', 'MIT (repository page)'],
];

const compareHead = ['', 'Studio Bridge', 'Roblox built-in server', 'WEPPY', 'robloxstudio-mcp (boshyxd)', 'robloxstudio-mcp (6xvl)'];
const compareTable = `<div class="cmp-wrap" data-reveal><table class="cmp">
<thead><tr>${compareHead.map((cell, index) => `<th scope="col"${index === 1 ? ' class="us"' : ''}>${cell}</th>`).join('')}</tr></thead>
<tbody>
${COMPARE_ROWS.map((row) => `<tr><th scope="row">${row[0]}</th>${row.slice(1).map((cell, index) => `<td${index === 0 ? ' class="us"' : ''}>${cell}</td>`).join('')}</tr>`).join('\n')}
</tbody>
</table></div>`;

const compare = page({
  file: 'compare.html',
  title: 'Studio Bridge compared with other Roblox Studio MCP tools',
  description: 'How Studio Bridge compares with Roblox\'s built-in MCP server, WEPPY and the community robloxstudio-mcp projects, checked against each project\'s own documentation.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow">Compare</p>
<h1>How it compares</h1>
<p class="lead">Several tools connect an AI assistant to Roblox Studio. Here is how Studio Bridge sits next to the main ones, using only what each project says about itself.</p>
</div>

${compareTable}
<p class="cmp-note" data-reveal>Checked on October 31, 2026 against each project's own page: <a href="${SRC.builtin}">Roblox's docs</a>, <a href="${SRC.weppy}">WEPPY's README</a> and <a href="${SRC.weppyPost}">DevForum post</a>, <a href="${SRC.boshyxd}">boshyxd</a> and <a href="${SRC.sixvl}">6xvl</a>. "Not stated" means the page does not say, not that the answer is no. Projects change, so check theirs before you decide, and <a href="${REPO}/issues">tell us</a> if something here is out of date.</p>

<section class="tight" data-reveal>
<div class="grid">
<div class="card"><h3>Where Studio Bridge helps most</h3>
<ul class="plain"><li><code>batch</code> runs up to 50 edits as one undo step.</li><li>Tool groups keep your AI's tool list small: the 28 everyday tools cost about 5,700 tokens.</li><li><code>ui_responsive_check</code> and the device emulator check a GUI on phones, tablets and consoles, and none of the 26 tools in Roblox's list does that.</li><li>Terrain, lighting, scatter, animation, audio and publishing tools.</li><li>Linux through Wine, and an optional Pro pack for snapshots and diffs.</li></ul></div>
<div class="card"><h3>Where WEPPY helps most</h3>
<ul class="plain"><li>Two-way sync between Studio and local files, with a history (a Pro feature).</li><li>UI Studio for building in-game UI, a web dashboard, and a VS Code explorer extension.</li><li>Works with up to five open Studio windows.</li></ul>
<p class="small">If you want that sync workflow, it is built for it. Its terrain, bulk and animation tools sit behind its Pro license.</p></div>
<div class="card"><h3>Where Roblox's built-in server helps most</h3>
<ul class="plain"><li>Nothing to install: it is part of Studio.</li><li>Tools for generating meshes and materials, and explore and playtest subagents.</li><li>Maintained by Roblox and kept in step with the Assistant.</li><li>Connects to several open Studio windows at once, which Roblox calls experimental.</li></ul>
<p class="small">If its tools cover what you do, it is a fine place to start. You can run both side by side.</p></div>
</div>
</section>

<section class="tight" data-reveal>
<h2>Other things worth knowing</h2>
<ul class="plain">
<li>Roblox's open-source <a href="${SRC.rust}">studio-rust-mcp-server</a> was archived on April 3, 2026, and its README recommends the built-in server.</li>
<li><a href="${SRC.kolvian}">kolvian/roblox-mcp-server</a>, a fork of Roblox's Rust server, lists 9 tools and Windows and macOS downloads. It states no authentication.</li>
<li>boshyxd's README recommends the actively maintained fork <a href="${SRC.chrrxs}">Chrrxs/robloxstudio-mcp</a>. Its README lists 24 tools by name, an MIT license and Linux through Wine. It is left out of the table to keep it readable.</li>
<li>Roblox's <a href="${SRC.announce}">announcement</a> and <a href="${SRC.builtin}">docs</a> list the built-in server's tools.</li>
</ul>
</section>

<section class="tight" data-reveal>
<h2>Questions</h2>
<div class="faq">
<details><summary>Is Studio Bridge free?</summary><p>Yes. All ${TOOLS} tools are free, including for commercial games. <a href="pro.html">Pro</a> is an optional paid add-on with extra packs.</p></details>
<details><summary>Does it work with my AI tool?</summary><p>It speaks standard MCP, so any MCP-ready AI tool can use it. Claude Code is the one it is tested with, and <code>studio-bridge install</code> registers it for you.</p></details>
<details><summary>Does it send my places anywhere?</summary><p>No. The bridge listens only on 127.0.0.1 and collects no telemetry. Tools that reach Roblox, such as asset upload and publishing, run only when you ask your AI to use them.</p></details>
<details><summary>Can I use it with the built-in Roblox server?</summary><p>Yes, they are separate MCP servers, so you can connect both and let your AI use whichever tool suits the job.</p></details>
<details><summary>How do I get it?</summary><p>Follow the <a href="install.html">install guide</a>. It takes two commands.</p></details>
</div>
<p style="margin-top:22px"><a class="btn" href="install.html">Install Studio Bridge</a> <a class="btn secondary" href="tools.html">Browse the tools</a></p>
</section>
</div>`,
});

const pro = page({
  file: 'pro.html',
  title: 'Studio Bridge Pro',
  description: 'Paid add-on packs for Studio Bridge. Snapshots and diffs is available now, with more planned. The free program is unchanged.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow gold">Add-on packs</p>
<h1>Studio Bridge <span class="badge pro" style="font-size:0.4em">Pro</span></h1>
<p class="lead">Paid add-on packs for any MCP-ready AI tool. The free program, with all ${TOOLS} tools, is not going behind a paywall. Pro adds extra packs on top.</p>
<div class="cta">
<a class="btn gold" href="${esc(PRO_PURCHASE_URL)}">Buy a license</a>
<a class="btn secondary" href="#how">How it works</a>
</div>
</div>

<section class="tight" data-reveal>
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

<section class="tight" data-reveal>
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

<section class="tight" id="how" data-reveal>
<h2>How it works</h2>
<ol class="steps">
<li><h3>Buy a license</h3><p>Checkout is handled by Polar, the seller of record. You get a license key by email.</p></li>
<li><h3>Activate it</h3><p>Open the <strong>Pro</strong> tab in the Studio Bridge window, paste the key and press <strong>Activate</strong>. Or run <code>studio-bridge pro activate</code>, which asks for the key with the typing hidden. Pro needs Studio Bridge 0.6.7 or newer.</p></li>
<li><h3>Use the tools</h3><p>The packs download automatically and their tools appear in your AI tool. <code>studio-bridge pro status</code> shows what is installed, and <code>studio-bridge pro remove</code> takes the license off this computer and frees its device slot.</p></li>
</ol>
</section>

<section class="tight" data-reveal>
<h2>What is sent, and what is not</h2>
<div class="grid">
<div class="card"><h3>Sent to the license server</h3><p>Your license key, a random device id the program creates, your computer's name (shown as the device label on your Polar purchases page) and your internet address.</p></div>
<div class="card"><h3>Never sent</h3><p>Your places, scripts, file names or anything else you work on.</p></div>
<div class="card"><h3>Works offline</h3><p>After activating, packs keep working offline for up to three days. They check in again every so often.</p></div>
</div>
</section>

<section class="tight" data-reveal>
<h2>A separate license</h2>
<p>Pro has its own license, apart from the free program's. It covers devices, what you may and may not share, plan length, privacy and refunds. Read it in plain terms on the <a href="license.html">license page</a>, or the full <a href="${REPO}/blob/main/PRO-LICENSE.txt">Pro license text</a>.</p>
<p style="margin-top:22px"><a class="btn gold" href="${esc(PRO_PURCHASE_URL)}">Buy a license</a></p>
</section>
</div>`,
});

const inline = (text) =>
  esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

function parseChangelog(markdown) {
  const releases = [];
  let current = null;
  let group = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const match = /^(\d+\.\d+\.\d+)(?: - (\d{4}-\d{2}-\d{2}))?$/.exec(heading[1]);
      current = { version: match ? match[1] : null, date: match ? match[2] || '' : '', title: heading[1], blocks: [] };
      releases.push(current);
      group = null;
      continue;
    }
    if (!current) continue;
    const sub = /^### (.+)$/.exec(line);
    if (sub) {
      group = { heading: sub[1], items: [] };
      current.blocks.push(group);
      continue;
    }
    const item = /^- (.+)$/.exec(line);
    if (item) {
      if (!group) {
        group = { heading: '', items: [] };
        current.blocks.push(group);
      }
      group.items.push(item[1]);
      continue;
    }
    if (line.trim() !== '') {
      current.blocks.push({ heading: '', paragraph: line.trim() });
      group = null;
    }
  }
  return releases;
}

const releases = parseChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
const releaseHtml = releases
  .map((release) => {
    const id = release.version ? `v${release.version.replace(/\./g, '-')}` : 'unreleased';
    const head = release.version
      ? `<h2>${release.version} <span style="color:var(--dim);font-size:0.6em;font-weight:600">${release.date}</span>${release.version === version ? ' <span class="badge live">Latest</span>' : ''}</h2>`
      : `<h2>Unreleased <span class="badge soon">Next</span></h2>`;
    const blocks = release.blocks
      .map((block) => {
        if (block.paragraph) return `<p style="color:var(--dim)">${inline(block.paragraph)}</p>`;
        const list = `<ul class="changes">${block.items.map((entry) => `<li>${inline(entry)}</li>`).join('')}</ul>`;
        return block.heading ? `<h3>${esc(block.heading)}</h3>${list}` : list;
      })
      .join('\n');
    return `<section class="tight release" id="${id}" data-reveal>\n${head}\n${blocks}\n</section>`;
  })
  .join('\n');

const changelog = page({
  file: 'changelog.html',
  title: 'Studio Bridge changelog',
  description: 'Every Studio Bridge release, newest first, with what was added, changed and fixed.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow">Releases</p>
<h1>Changelog</h1>
<p class="lead">Every release, newest first. The same list is in <a href="${REPO}/blob/main/CHANGELOG.md">CHANGELOG.md</a> in the repository, and each release has downloads on the <a href="${REPO}/releases">releases page</a>.</p>
</div>
${releaseHtml}
</div>`,
});

const license = page({
  file: 'license.html',
  title: 'Studio Bridge licenses',
  description: 'Studio Bridge has two licenses: the free program is source-available and free for commercial games, and Studio Bridge Pro packs have their own separate license.',
  body: `<div class="wrap">
<div class="page-hero" data-reveal>
<p class="eyebrow">Terms</p>
<h1>Licenses</h1>
<p class="lead">There are two, and they are separate. These are plain-language summaries. The full texts are what count.</p>
</div>

<section class="tight" data-reveal>
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

<section class="tight" data-reveal>
<h2>Third-party components</h2>
<p>Components that ship with releases, such as the Node.js runtime embedded in the exe, are licensed under their own terms. See <a href="${REPO}/blob/main/THIRD_PARTY_NOTICES.txt">THIRD_PARTY_NOTICES.txt</a>.</p>
</section>
</div>`,
});

fs.mkdirSync(docs, { recursive: true });
for (const [name, html] of [['index.html', index], ['install.html', install], ['tools.html', tools], ['compare.html', compare], ['pro.html', pro], ['changelog.html', changelog], ['license.html', license]]) fs.writeFileSync(path.join(docs, name), html);
for (const asset of ['logo.png', 'logo-128.png', 'product-pro.png', 'social-preview.png']) fs.copyFileSync(path.join(root, 'assets', asset), path.join(docs, asset));
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('written', fs.readdirSync(docs).join(', '));
