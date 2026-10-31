import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_PURCHASE_URL } from '../pro.mjs';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(bridgeDir, 'docs');
const catalog = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'tools.json'), 'utf8'));
const packageVersion = JSON.parse(fs.readFileSync(path.join(bridgeDir, 'package.json'), 'utf8')).version;
const readme = fs.readFileSync(path.join(bridgeDir, 'README.md'), 'utf8');

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const pages = fs.readdirSync(docs).filter((name) => name.endsWith('.html'));
const text = Object.fromEntries(pages.map((name) => [name, fs.readFileSync(path.join(docs, name), 'utf8')]));

check('the site has all seven pages', ['index.html', 'install.html', 'tools.html', 'compare.html', 'pro.html', 'changelog.html', 'license.html'].every((name) => pages.includes(name)), pages.join(', '));
check('Pages will not run the files through Jekyll', fs.existsSync(path.join(docs, '.nojekyll')));

for (const [name, html] of Object.entries(text)) {
  check(`${name} is a complete page with a title, description and viewport`, /^<!doctype html>/i.test(html) && /<title>[^<]{5,}<\/title>/.test(html) && /<meta name="description" content="[^"]{20,}"/.test(html) && /name="viewport"/.test(html) && /<html lang="en">/.test(html));
  check(`${name} has no leftover template holes`, !/undefined|\[object|\$\{/.test(html));
  const targets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  const local = targets.filter((target) => !/^(https?:|mailto:|#)/.test(target));
  const missing = local.map((target) => target.split('#')[0]).filter((target) => target && !fs.existsSync(path.join(docs, target)));
  check(`${name} links only to files that exist`, missing.length === 0, missing.join(', '));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  const lost = anchors.filter((anchor) => !html.includes(`id="${anchor}"`));
  check(`${name} anchors all land somewhere`, lost.length === 0, lost.join(', '));
  check(`${name} loads nothing from other websites except links`, !/(<script[^>]+src="https?:|<script(?![^>]*\bsrc=)|<link[^>]+href="https?:|<img[^>]+src="https?:|@import|url\(\s*["']?https?:)/i.test(html));
  check(`${name} loads only the site's own script`, [...html.matchAll(/<script[^>]*>/g)].every((match) => match[0] === '<script src="script.js">'));
  check(`${name} marks the current page in the menu`, (html.match(/aria-current="page"/g) || []).length === 1);
}

const styleText = fs.readFileSync(path.join(docs, 'style.css'), 'utf8');
const scriptText = fs.readFileSync(path.join(docs, 'script.js'), 'utf8');
check('the stylesheet loads no fonts, images or files from other sites', !/@import|url\(\s*["']?https?:|https?:\/\//i.test(styleText));
check('the script makes no network requests and touches no storage', !/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\/|localStorage|sessionStorage|document\.cookie/.test(scriptText));
check('motion respects the reduced-motion setting in both the style and the script', /prefers-reduced-motion: reduce/.test(styleText) && /prefers-reduced-motion: reduce/.test(scriptText));
check('the page works without the script: reveal and meters are only hidden once it runs', /html\.js \[data-reveal\]/.test(styleText) && /html:not\(\.js\) \.meter/.test(styleText));
check('the checkout link on the Pro page is the real one', text['pro.html'].includes(`href="${PRO_PURCHASE_URL}"`));
check('and it matches the link in the README', readme.includes(PRO_PURCHASE_URL));
check('no other page invents a different checkout address', Object.values(text).every((html) => [...html.matchAll(/https:\/\/buy\.polar\.sh\/[^"<\s]+/g)].every((match) => match[0] === PRO_PURCHASE_URL)));

check('the tools page has a search box that the script drives', text['tools.html'].includes('data-tool-search') && /data-tool-search/.test(scriptText) && /data-tool-none/.test(text['tools.html']));
check('every tool section can be hidden by the search', (text['tools.html'].match(/data-group>/g) || []).length === 7);
check('the compare page covers the built-in server and both community projects', ['Roblox built-in server', 'WEPPY', 'boshyxd', '6xvl'].every((name) => text['compare.html'].includes(name)));
check('the compare page cites each project it describes', ['create.roblox.com/docs/studio/mcp', 'github.com/boshyxd/robloxstudio-mcp', 'github.com/6xvl/robloxstudio-mcp', 'github.com/hope1026/weppy-roblox-mcp'].every((url) => text['compare.html'].includes(url)));
check('the compare page says what "not stated" means and is dated', /does not say, not that the answer is no/.test(text['compare.html']) && /Checked on October 31, 2026/.test(text['compare.html']));
check('the compare page claims the right tool count for this program', text['compare.html'].includes(catalog.tools.length + ' (28 everyday tools'));
check('the home page links to the comparison', text['index.html'].includes('href="compare.html"'));

const listed = [...text['tools.html'].matchAll(/<li><code>([a-z_]+)<\/code>/g)].map((match) => match[1]);
check('the tools page lists every tool once', listed.length === catalog.tools.length && new Set(listed).size === listed.length && catalog.tools.every((tool) => listed.includes(tool.name)), `${listed.length} of ${catalog.tools.length}`);
check('the tool count on the pages matches the program', text['tools.html'].includes(`<h1>${catalog.tools.length} tools</h1>`) && text['index.html'].includes(`${catalog.tools.length} tools`));
check('the footer shows the current version', Object.values(text).every((html) => html.includes(`Studio Bridge ${packageVersion}`)), packageVersion);

check('the two licenses are linked and kept apart', text['license.html'].includes('/blob/main/LICENSE"') && text['license.html'].includes('/blob/main/PRO-LICENSE.txt"') && text['pro.html'].includes('A separate license'));
check('planned packs are marked as planned and available ones as available', /Snapshots and diffs <span class="badge live">Available<\/span>/.test(text['pro.html']) && ['Dead-code finder', 'Audit pack', 'QA playtests', 'Localization'].every((title) => new RegExp(`${title} <span class="badge soon">Planned</span>`).test(text['pro.html'])));
check('the Pro page promises no dates for planned packs', /no dates/.test(text['pro.html']));
check('nothing on the site names the internal checks', !/tamper|integrity check|license check/i.test(Object.values(text).join(' ')));

const changelogFile = fs.readFileSync(path.join(bridgeDir, 'CHANGELOG.md'), 'utf8');
const fileVersions = [...changelogFile.matchAll(/^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})$/gm)].map((match) => match[1]);
const pageVersions = [...text['changelog.html'].matchAll(/<h2>(\d+\.\d+\.\d+) /g)].map((match) => match[1]);
check('the changelog file lists the current version first', fileVersions[0] === packageVersion, `${fileVersions[0]} vs ${packageVersion}`);
check('every version in the changelog file is on the website, in the same order', fileVersions.length >= 19 && fileVersions.join() === pageVersions.join(), `${fileVersions.length} vs ${pageVersions.length}`);
check('every release has a real date', [...changelogFile.matchAll(/^## \d+\.\d+\.\d+ - (\d{4}-\d{2}-\d{2})$/gm)].every((match) => !Number.isNaN(Date.parse(match[1]))));
const dates = [...changelogFile.matchAll(/^## \d+\.\d+\.\d+ - (\d{4}-\d{2}-\d{2})$/gm)].map((match) => match[1]);
check('dates never go forward as you read down', dates.every((date, index) => index === 0 || date <= dates[index - 1]));
const numeric = fileVersions.map((version) => version.split('.').map(Number));
check('version numbers always go down as you read down', numeric.every((parts, index) => index === 0 || parts[0] < numeric[index - 1][0] || (parts[0] === numeric[index - 1][0] && (parts[1] < numeric[index - 1][1] || (parts[1] === numeric[index - 1][1] && parts[2] < numeric[index - 1][2])))));
const currentSection = (text['changelog.html'].match(new RegExp('<section[^>]*id="v' + packageVersion.split('.').join('-') + '"[^>]*>[\\s\\S]*?</section>')) || [''])[0];
check('the website marks only the current version as latest', (text['changelog.html'].match(/badge live">Latest/g) || []).length === 1 && currentSection.includes('Latest'), currentSection.slice(0, 60));
check('the changelog says nothing about the internal checks', !/tamper|integrity|license check/i.test(changelogFile));
check('the README and the package point to the changelog', readme.includes('CHANGELOG.md') && JSON.parse(fs.readFileSync(path.join(bridgeDir, 'package.json'), 'utf8')).files.includes('CHANGELOG.md'));

console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
