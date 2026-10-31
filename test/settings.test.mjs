import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
process.env.STUDIO_BRIDGE_HOME = home;
const { loadSettings, saveSettings } = await import('../updater.mjs');
const file = path.join(home, 'settings.json');

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const brokenCopies = () => fs.readdirSync(home).filter((name) => name.startsWith('settings.json.broken-'));

check('with no settings file the defaults apply and pack trust is all', loadSettings().packTrust === 'all' && loadSettings().unreadable === undefined);

fs.writeFileSync(file, JSON.stringify({ packTrust: 'verified', autoUpdate: true }));
check('a valid file is honored', loadSettings().packTrust === 'verified' && loadSettings().autoUpdate === true);
fs.writeFileSync(file, JSON.stringify({ autoUpdate: true }));
check('a valid file without the setting uses the default', loadSettings().packTrust === 'all');

for (const [label, text] of [['invalid JSON', '{ "packTrust": "verified", '], ['an empty file', ''], ['an array', '[]'], ['null', 'null'], ['a string', '"all"']]) {
  fs.writeFileSync(file, text);
  const loaded = loadSettings();
  check(`${label} fails safe: only verified packs, and it says why`, loaded.packTrust === 'verified' && loaded.unreadable === true);
}

fs.writeFileSync(file, JSON.stringify({ packTrust: 'verifed' }));
check('a misspelled pack trust value fails safe too', loadSettings().packTrust === 'verified');
fs.writeFileSync(file, JSON.stringify({ packTrust: 'ALL' }));
check('so does a wrong-case value', loadSettings().packTrust === 'verified');

fs.rmSync(file, { force: true });
fs.mkdirSync(file);
check('a settings path that cannot be read as a file fails safe', loadSettings().packTrust === 'verified' && loadSettings().unreadable === true);
fs.rmSync(file, { recursive: true, force: true });

const broken = '{ "packTrust": "verified", "checkUpdates": ';
fs.writeFileSync(file, broken);
const saved = saveSettings({ autoUpdate: true });
check('saving over a broken file keeps a copy of it first', brokenCopies().length === 1 && fs.readFileSync(path.join(home, brokenCopies()[0]), 'utf8') === broken);
check('and writes a valid file that keeps the safe pack trust and the change', saved.packTrust === 'verified' && saved.autoUpdate === true && JSON.parse(fs.readFileSync(file, 'utf8')).packTrust === 'verified' && loadSettings().unreadable === undefined);
check('the returned settings never carry the internal unreadable flag', !('unreadable' in saved) && !('unreadable' in JSON.parse(fs.readFileSync(file, 'utf8'))));

saveSettings({ checkUpdates: false });
check('later saves do not make more backups', brokenCopies().length === 1);
saveSettings({ packTrust: 'all' });
check('and the user can still choose all explicitly afterwards', loadSettings().packTrust === 'all' && loadSettings().checkUpdates === false);

fs.writeFileSync(file, JSON.stringify({ toolProfile: 'core', packTrust: 'all' }));
saveSettings({ autoUpdate: false });
check('a normal save keeps every other setting', loadSettings().toolProfile === 'core' && loadSettings().packTrust === 'all' && brokenCopies().length === 1);

fs.rmSync(home, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
