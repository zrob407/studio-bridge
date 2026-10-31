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

check('the site has the five pages', ['index.html', 'install.html', 'tools.html', 'pro.html', 'license.html'].every((name) => pages.includes(name)), pages.join(', '));
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
  check(`${name} loads nothing from other websites except links`, !/(<script|<link[^>]+href="https?:|<img[^>]+src="https?:)/i.test(html));
  check(`${name} marks the current page in the menu`, (html.match(/aria-current="page"/g) || []).length === 1);
}

check('the checkout link on the Pro page is the real one', text['pro.html'].includes(`href="${PRO_PURCHASE_URL}"`));
check('and it matches the link in the README', readme.includes(PRO_PURCHASE_URL));
check('no other page invents a different checkout address', Object.values(text).every((html) => [...html.matchAll(/https:\/\/buy\.polar\.sh\/[^"<\s]+/g)].every((match) => match[0] === PRO_PURCHASE_URL)));

const listed = [...text['tools.html'].matchAll(/<li><code>([a-z_]+)<\/code>/g)].map((match) => match[1]);
check('the tools page lists every tool once', listed.length === catalog.tools.length && new Set(listed).size === listed.length && catalog.tools.every((tool) => listed.includes(tool.name)), `${listed.length} of ${catalog.tools.length}`);
check('the tool count on the pages matches the program', text['tools.html'].includes(`<h1>${catalog.tools.length} tools</h1>`) && text['index.html'].includes(`${catalog.tools.length} tools`));
check('the footer shows the current version', Object.values(text).every((html) => html.includes(`Studio Bridge ${packageVersion}`)), packageVersion);

check('the two licenses are linked and kept apart', text['license.html'].includes('/blob/main/LICENSE"') && text['license.html'].includes('/blob/main/PRO-LICENSE.txt"') && text['pro.html'].includes('A separate license'));
check('planned packs are marked as planned and available ones as available', /Snapshots and diffs <span class="badge live">Available<\/span>/.test(text['pro.html']) && ['Dead-code finder', 'Audit pack', 'QA playtests', 'Localization'].every((title) => new RegExp(`${title} <span class="badge soon">Planned</span>`).test(text['pro.html'])));
check('the Pro page promises no dates for planned packs', /no dates/.test(text['pro.html']));
check('nothing on the site names the internal checks', !/tamper|integrity check|license check/i.test(Object.values(text).join(' ')));

console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
