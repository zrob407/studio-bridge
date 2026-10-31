import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPacks } from '../packs.mjs';
import { OFFICIAL_KEYS, executableFiles, hashFile, signedMessage, stableStringify, verifyPack } from '../trust.mjs';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-test-'));
const official = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const pro = crypto.generateKeyPairSync('ed25519');
const spki = (pair) => pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const keys = { 1: spki(official) };
const schema = { type: 'object', properties: {} };

function makePack(folder, { name = folder, signWith = null, keyId = '1', files = null, summary = 'A test pack.', handlers = [] } = {}) {
  const root = path.join(sandbox, 'packs', folder);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'main.mjs'), 'export const tools = { hello: async (args, api) => api.text("hi") };\n');
  fs.writeFileSync(path.join(root, 'extra.mjs'), 'export const extra = 1;\n');
  const manifest = { name, version: '1.0.0', title: `Pack ${folder}`, summary, tools: [{ name: `${name}_hello`, description: 'Says hi.', inputSchema: schema, server: true }] };
  for (const handler of handlers) {
    fs.mkdirSync(path.join(root, 'handlers'), { recursive: true });
    fs.writeFileSync(path.join(root, 'handlers', handler), 'return 1');
  }
  if (signWith) {
    const covered = files || executableFiles(root);
    const hashes = Object.fromEntries(covered.map((file) => [file, hashFile(path.join(root, ...file.split('/')))]));
    manifest.signature = { keyId, files: covered, value: crypto.sign(null, Buffer.from(signedMessage(manifest, hashes)), signWith.privateKey).toString('base64url') };
  }
  fs.writeFileSync(path.join(root, 'pack.json'), JSON.stringify(manifest, null, 2));
  return root;
}

check('key order does not change what is signed', stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }) === stableStringify({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
check('undefined fields are ignored when signing', stableStringify({ a: 1, b: undefined }) === stableStringify({ a: 1 }));

const goodRoot = makePack('good', { signWith: official });
const goodManifest = JSON.parse(fs.readFileSync(path.join(goodRoot, 'pack.json'), 'utf8'));
check('a pack signed with the trusted key is official', verifyPack(goodRoot, goodManifest, keys).trust === 'official');
check('an unsigned pack is unverified', verifyPack(makePack('plain'), JSON.parse(fs.readFileSync(path.join(sandbox, 'packs', 'plain', 'pack.json'), 'utf8')), keys).trust === 'unverified');

fs.appendFileSync(path.join(goodRoot, 'main.mjs'), '// changed after signing\n');
const afterEdit = verifyPack(goodRoot, goodManifest, keys);
check('changing a signed file after signing is detected', afterEdit.trust === 'tampered' && /do not match/.test(afterEdit.reason), afterEdit.reason);

const toolRoot = makePack('toollist', { signWith: official });
const toolManifest = JSON.parse(fs.readFileSync(path.join(toolRoot, 'pack.json'), 'utf8'));
toolManifest.tools[0].description = 'Now says something else.';
check('changing the tool list after signing is detected', verifyPack(toolRoot, toolManifest, keys).trust === 'tampered');

const strangerRoot = makePack('stranger', { signWith: stranger });
check('a signature from some other key is not trusted', verifyPack(strangerRoot, JSON.parse(fs.readFileSync(path.join(strangerRoot, 'pack.json'), 'utf8')), keys).trust === 'tampered');
const unknownKeyRoot = makePack('unknownkey', { signWith: official, keyId: '9' });
const unknownKey = verifyPack(unknownKeyRoot, JSON.parse(fs.readFileSync(path.join(unknownKeyRoot, 'pack.json'), 'utf8')), keys);
check('a key id this version does not know is refused', unknownKey.trust === 'tampered' && /does not know/.test(unknownKey.reason), unknownKey.reason);
const noMainRoot = makePack('nomain', { signWith: official, files: ['extra.mjs'] });
const noMain = verifyPack(noMainRoot, JSON.parse(fs.readFileSync(path.join(noMainRoot, 'pack.json'), 'utf8')), keys);
check('a signature that leaves out main.mjs is refused', noMain.trust === 'tampered' && /main\.mjs/.test(noMain.reason), noMain.reason);

const malformedRoot = makePack('malformed');
const malformed = { ...JSON.parse(fs.readFileSync(path.join(malformedRoot, 'pack.json'), 'utf8')), signature: 'yes' };
check('a malformed signature field is refused', verifyPack(malformedRoot, malformed, keys).trust === 'tampered');
const traversal = JSON.parse(fs.readFileSync(path.join(goodRoot, 'pack.json'), 'utf8'));
traversal.signature = { ...traversal.signature, files: ['main.mjs', '../elsewhere.txt'] };
check('a signature that names a file outside the pack is refused', verifyPack(goodRoot, traversal, keys).trust === 'tampered');

const logs = [];
makePack('fresh', { signWith: official });
const handlerRoot = makePack('withhandlers', { signWith: official, handlers: ['a.luau', 'b.luau'] });
const handlerManifest = JSON.parse(fs.readFileSync(path.join(handlerRoot, 'pack.json'), 'utf8'));
check('a pack whose handler files are signed is official', verifyPack(handlerRoot, handlerManifest, keys).trust === 'official' && handlerManifest.signature.files.includes('handlers/a.luau'));
fs.appendFileSync(path.join(handlerRoot, 'handlers', 'a.luau'), ' error("injected")');
const editedHandler = verifyPack(handlerRoot, handlerManifest, keys);
check('editing a signed handler file is detected', editedHandler.trust === 'tampered' && /do not match/.test(editedHandler.reason), editedHandler.reason);
const addedHandlerRoot = makePack('addedhandler', { signWith: official });
fs.mkdirSync(path.join(addedHandlerRoot, 'handlers'), { recursive: true });
fs.writeFileSync(path.join(addedHandlerRoot, 'handlers', 'planted.luau'), 'return 1');
const addedHandler = verifyPack(addedHandlerRoot, JSON.parse(fs.readFileSync(path.join(addedHandlerRoot, 'pack.json'), 'utf8')), keys);
check('adding an unsigned handler file to a signed pack is detected', addedHandler.trust === 'tampered' && /handlers\/planted\.luau/.test(addedHandler.reason) && /not covered/.test(addedHandler.reason), addedHandler.reason);
const addedModuleRoot = makePack('addedmodule', { signWith: official });
fs.writeFileSync(path.join(addedModuleRoot, 'planted.mjs'), 'export const x = 1;');
check('adding an unsigned script next to a signed pack is detected', verifyPack(addedModuleRoot, JSON.parse(fs.readFileSync(path.join(addedModuleRoot, 'pack.json'), 'utf8')), keys).trust === 'tampered');
const nestedRoot = makePack('nestedmodule', { signWith: official });
fs.mkdirSync(path.join(nestedRoot, 'lib', 'deep'), { recursive: true });
fs.writeFileSync(path.join(nestedRoot, 'lib', 'deep', 'helper.mjs'), 'export const x = 1;');
const nested = verifyPack(nestedRoot, JSON.parse(fs.readFileSync(path.join(nestedRoot, 'pack.json'), 'utf8')), keys);
check('an unsigned script hidden in a subfolder of a signed pack is detected', nested.trust === 'tampered' && /lib\/deep\/helper\.mjs/.test(nested.reason), nested.reason);
check('executableFiles reports scripts in any subfolder', executableFiles(nestedRoot).includes('lib/deep/helper.mjs'));
fs.writeFileSync(path.join(goodRoot, 'license.key'), 'ignored');
check('data files such as license.key do not break a signature', (() => {
  const root = makePack('datafiles', { signWith: official });
  fs.writeFileSync(path.join(root, 'license.key'), 'KEY');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'notes');
  return verifyPack(root, JSON.parse(fs.readFileSync(path.join(root, 'pack.json'), 'utf8')), keys).trust === 'official';
})());
const traversal2 = JSON.parse(fs.readFileSync(path.join(handlerRoot, 'pack.json'), 'utf8'));
traversal2.signature = { ...traversal2.signature, files: ['main.mjs', 'handlers/../x.luau'] };
check('a signature that reaches out of the handlers folder is refused', verifyPack(handlerRoot, traversal2, keys).trust === 'tampered');
const second = loadPacks(path.join(sandbox, 'packs'), [], [], (message) => logs.push(message), { trustedKeys: keys });
const secondByName = Object.fromEntries(second.packs.map((pack) => [pack.name, pack]));
check('a genuine signed pack loads as official, with the publisher name', secondByName.fresh && secondByName.fresh.trust === 'official' && secondByName.fresh.publisher === 'Studio Bridge');
check('an unsigned pack loads as unverified', secondByName.plain && secondByName.plain.trust === 'unverified' && secondByName.plain.publisher === null);
check('a tampered pack is not loaded, even by default, and says why', !secondByName.good && logs.some((line) => /pack good skipped: it carries a signature but/.test(line) && /changed after it was signed/.test(line)));
check('a pack signed by a stranger is not loaded', !secondByName.stranger && logs.some((line) => /pack stranger skipped/.test(line)));

const officialTool = second.tools.find((tool) => tool.name === 'fresh_hello');
const plainTool = second.tools.find((tool) => tool.name === 'plain_hello');
check('official tool descriptions are left alone', officialTool.description === 'Says hi.');
check('unverified tool descriptions are labeled so the user and the AI can see it', plainTool.description === '[Unverified third-party pack "Pack plain"] Says hi.', plainTool.description);
check('the tool group summary is labeled too', second.groupInfo['pack-plain'].summary.includes('unverified third-party pack') && !second.groupInfo['pack-fresh'].summary.includes('unverified'));

const strict = loadPacks(path.join(sandbox, 'packs'), [], [], (message) => logs.push(message), { trustedKeys: keys, requireVerified: true });
const strictNames = strict.packs.map((pack) => pack.name);
check('verified-only mode keeps official packs and drops unsigned ones', strictNames.includes('fresh') && !strictNames.includes('plain'));
check('and tells the user which setting did it', logs.some((line) => /pack plain skipped: it is not signed by Studio Bridge and settings pack-trust is set to verified/.test(line)));

const defaults = loadPacks(path.join(sandbox, 'packs'), [], [], () => {});
const defaultNames = defaults.packs.map((pack) => pack.name);
check('with the built-in key a pack signed by some other key never loads as official', !defaultNames.includes('fresh') && defaultNames.includes('plain'));
const tiered = { 1: { tier: 'official', key: spki(official) }, 'pro-1': { tier: 'pro', key: spki(pro) } };
const readManifest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'pack.json'), 'utf8'));
const freeRoot = makePack('freepack', { signWith: official, keyId: '1' });
const paidRoot = makePack('paidpack', { signWith: pro, keyId: 'pro-1' });
const freeVerdict = verifyPack(freeRoot, readManifest(freeRoot), tiered);
const paidVerdict = verifyPack(paidRoot, readManifest(paidRoot), tiered);
check('a pack signed with the free official key is official', freeVerdict.trust === 'official' && freeVerdict.publisher === 'Studio Bridge');
check('a pack signed with the paid key is pro, with its own publisher name', paidVerdict.trust === 'pro' && paidVerdict.publisher === 'Studio Bridge Pro');
check('the free key cannot pass as the paid tier', verifyPack(makePack('fakepro', { signWith: official, keyId: 'pro-1' }), readManifest(path.join(sandbox, 'packs', 'fakepro')), tiered).trust === 'tampered');
check('the paid key cannot be passed off as the free tier either', verifyPack(makePack('fakefree', { signWith: pro, keyId: '1' }), readManifest(path.join(sandbox, 'packs', 'fakefree')), tiered).trust === 'tampered');
check('a pack cannot declare its own tier', (() => {
  const root = makePack('selfpro', { signWith: official, keyId: '1' });
  const manifest = readManifest(root);
  manifest.tier = 'pro';
  return verifyPack(root, manifest, tiered).trust === 'tampered';
})());

const mixed = loadPacks(path.join(sandbox, 'packs'), [], [], () => {}, { trustedKeys: tiered });
const mixedByName = Object.fromEntries(mixed.packs.map((entry) => [entry.name, entry]));
check('the loader tells free official, paid and unsigned packs apart', mixedByName.freepack.trust === 'official' && mixedByName.paidpack.trust === 'pro' && mixedByName.plain.trust === 'unverified');
check('the group info carries the tier for the Studio window', mixed.groupInfo['pack-freepack'].tier === 'official' && mixed.groupInfo['pack-paidpack'].tier === 'pro' && mixed.groupInfo['pack-plain'].tier === 'unverified');
check('both signed tiers keep their tool descriptions clean', mixed.tools.find((tool) => tool.name === 'paidpack_hello').description === 'Says hi.' && mixed.tools.find((tool) => tool.name === 'freepack_hello').description === 'Says hi.');
const mixedStrict = loadPacks(path.join(sandbox, 'packs'), [], [], () => {}, { trustedKeys: tiered, requireVerified: true }).packs.map((entry) => entry.name);
check('verified-only mode keeps both signed tiers and drops unsigned packs', mixedStrict.includes('freepack') && mixedStrict.includes('paidpack') && !mixedStrict.includes('plain'));
check('unsigned packs load by default, as intended', loadPacks(path.join(sandbox, 'packs'), [], [], () => {}, { trustedKeys: tiered }).packs.some((entry) => entry.name === 'plain'));
check('the built-in keys have two different tiers and two different keys', OFFICIAL_KEYS[1].tier === 'official' && OFFICIAL_KEYS['pro-1'].tier === 'pro' && OFFICIAL_KEYS[1].key !== OFFICIAL_KEYS['pro-1'].key);
check('both built-in keys are valid public keys', ['1', 'pro-1'].every((id) => {
  try {
    crypto.createPublicKey({ key: Buffer.from(OFFICIAL_KEYS[id].key, 'base64'), format: 'der', type: 'spki' });
    return true;
  } catch {
    return false;
  }
}));
check('the built-in key is a valid public key', (() => {
  try {
    crypto.createPublicKey({ key: Buffer.from(OFFICIAL_KEYS[1].key, 'base64'), format: 'der', type: 'spki' });
    return true;
  } catch {
    return false;
  }
})());

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
