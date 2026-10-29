import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
const command = target ? [target] : [process.execPath, path.join(bridgeDir, 'cli.mjs')];
const port = 3987;
const origin = `http://127.0.0.1:${port}`;

const exeBytes = target ? fs.readFileSync(target) : Buffer.from('not an exe');
const exeHash = crypto.createHash('sha256').update(exeBytes).digest('hex');
const exeName = 'studio-bridge-v9.9.9.exe';

let feed = { status: 200, body: {} };
let sums = `${exeHash}  ${exeName}\n`;
const requests = [];

const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/releases/latest') {
    res.writeHead(feed.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(feed.body));
  } else if (req.url === '/files/SHA256SUMS.txt') {
    res.end(sums);
  } else if (req.url === `/files/${exeName}`) {
    res.end(exeBytes);
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const release = (tag, assetOrigin = origin, withSums = true) => ({
  tag_name: tag,
  assets: [
    { name: `studio-bridge-${tag}.exe`, browser_download_url: `${assetOrigin}/files/${exeName}` },
    ...(withSums ? [{ name: 'SHA256SUMS.txt', browser_download_url: `${assetOrigin}/files/SHA256SUMS.txt` }] : []),
  ],
});

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bridge-update-'));
const localAppData = path.join(sandbox, 'LocalAppData');
const home = path.join(sandbox, 'home');
const env = { ...process.env, LOCALAPPDATA: localAppData, STUDIO_BRIDGE_HOME: home, STUDIO_BRIDGE_RELEASES_URL: `${origin}/releases/latest` };
const run = (...args) =>
  new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), ...args], { env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

feed = { status: 200, body: release('v0.0.1') };
const older = await run('update', '--check');
check('an older release is reported as up to date', older.status === 0 && /is up to date/.test(older.out), older.out.trim().split('\n').pop());

feed = { status: 200, body: release('v9.9.9') };
const newer = await run('update', '--check');
check('--check reports a newer release and changes nothing', newer.status === 0 && /newer version is available: v9\.9\.9/.test(newer.out) && !requests.some((url) => url.startsWith('/files/')));

const doctor = await run('doctor');
check('doctor mentions the available update', /update available: v9\.9\.9/.test(doctor.out), (doctor.out.match(/update available[^\n]*/) || [''])[0]);
const offline = await run('doctor', '--offline');
check('doctor --offline does not ask the feed', !/update available|up to date|could not check/.test(offline.out));

feed = { status: 404, body: {} };
const none = await run('update', '--check');
check('a feed with no releases says so', none.status === 0 && /No release has been published yet/.test(none.out));

feed = { status: 500, body: {} };
const broken = await run('update', '--check');
check('a failing feed is an error, not a crash', broken.status === 1 && /Update failed: the release feed answered HTTP 500/.test(broken.out));

if (!target) {
  feed = { status: 200, body: release('v9.9.9') };
  requests.length = 0;
  const source = await run('update');
  check('a source checkout is told to use git instead of downloading', source.status === 0 && /source checkout/.test(source.out) && !requests.some((url) => url.startsWith('/files/')));
  console.log('SKIP  packaged update scenarios (pass the exe path to run them)');
} else {
  feed = { status: 200, body: release('v9.9.9') };
  requests.length = 0;
  const ok = await run('update', '--no-register');
  const installedExe = path.join(home, 'studio-bridge.exe');
  const installedHash = fs.existsSync(installedExe) ? crypto.createHash('sha256').update(fs.readFileSync(installedExe)).digest('hex') : null;
  check('a verified update downloads and installs', ok.status === 0 && /Checksum matches/.test(ok.out) && installedHash === exeHash, ok.out.trim().split('\n').slice(-3).join(' | '));
  check('the update also writes the plugin loader', fs.existsSync(path.join(localAppData, 'Roblox', 'Plugins', 'Studio Bridge.rbxmx')));
  check('the temporary download is cleaned up', !fs.existsSync(path.join(home, 'update')));

  fs.rmSync(home, { recursive: true, force: true });
  sums = `${'0'.repeat(64)}  ${exeName}\n`;
  const bad = await run('update', '--no-register');
  check('a download that does not match its checksum is refused', bad.status === 1 && /does not match its published checksum/.test(bad.out) && !fs.existsSync(path.join(home, 'studio-bridge.exe')));

  sums = `${exeHash}  some-other-file.exe\n`;
  const missingEntry = await run('update', '--no-register');
  check('a checksum file without the exe is refused', missingEntry.status === 1 && /has no entry for/.test(missingEntry.out));

  sums = `${exeHash}  ${exeName}\n`;
  feed = { status: 200, body: release('v9.9.9', origin, false) };
  const noSums = await run('update', '--no-register');
  check('a release without a checksum file is refused', noSums.status === 1 && /does not include both the exe and SHA256SUMS.txt/.test(noSums.out));

  feed = { status: 200, body: release('v9.9.9', 'http://localhost:1') };
  const elsewhere = await run('update', '--no-register');
  check('a download from another origin than the feed is refused', elsewhere.status === 1 && /refusing to download from/.test(elsewhere.out), elsewhere.out.trim().split('\n').pop());
}

server.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
