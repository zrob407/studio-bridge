import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';
import readline from 'node:readline';

const bridgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = crypto.randomBytes(16).toString('hex');
const port = 3996;
const server = spawn('node', [path.join(bridgeDir, 'server.mjs')], {
  env: { ...process.env, STUDIO_BRIDGE_TOKEN: token, STUDIO_BRIDGE_PORT: String(port), STUDIO_BRIDGE_SOCKET_SILENCE_MS: '1500', STUDIO_BRIDGE_GRACE_MS: '1000', STUDIO_BRIDGE_QUEUE_WAIT_MS: '4000' },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const waiters = new Map();
readline.createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  const entry = waiters.get(message.id);
  if (entry) {
    waiters.delete(message.id);
    entry(message);
  }
});
let nextId = 1;
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiters.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
const tool = async (name, args) => {
  const started = Date.now();
  const response = await rpc('tools/call', { name, arguments: args });
  return { text: response.result.content[0].text, isError: !!response.result.isError, ms: Date.now() - started };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function frame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const length = payload.length;
  let header;
  if (length < 126) header = Buffer.from([0x80 | opcode, 0x80 | length]);
  else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function connectSocket({ withToken = true, origin = false, pathName = '/ws' } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const client = { messages: [], closed: false, status: 0, socket };
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on('connect', () => {
      const lines = [`GET ${pathName} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13'];
      if (withToken) lines.push(`X-Bridge-Token: ${token}`);
      if (origin) lines.push('Origin: http://evil.example');
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end === -1) return;
        client.status = Number(buffer.subarray(0, buffer.indexOf('\r\n')).toString().split(' ')[1]);
        buffer = buffer.subarray(end + 4);
        upgraded = true;
        resolve(client);
      }
      while (upgraded && buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) return;
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        if (opcode === 0x1) client.messages.push(JSON.parse(payload.toString('utf8')));
        if (opcode === 0x8) client.closed = true;
      }
    });
    socket.on('close', () => {
      client.closed = true;
      if (!upgraded) resolve(client);
    });
    socket.on('error', () => {});
    client.send = (object) => socket.write(frame(0x1, Buffer.from(JSON.stringify(object))));
    client.next = async (type, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const index = client.messages.findIndex((message) => message.type === type);
        if (index !== -1) return client.messages.splice(index, 1)[0];
        await sleep(20);
      }
      return null;
    };
  });
}

const identity = { id: 'ws-plugin-0001', role: 'edit', placeId: 7, placeName: 'WsTest' };
async function openPlugin(extra = {}) {
  const client = await connectSocket();
  client.send({ type: 'hello', ...identity, protocol: 1, ...extra });
  const ack = await client.next('hello_ack');
  return { client, ack };
}

let failures = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

await rpc('initialize', {});

const noToken = await connectSocket({ withToken: false });
check('upgrade without a token is refused', noToken.status === 401, `status ${noToken.status}`);
const withOrigin = await connectSocket({ origin: true });
check('upgrade with a browser Origin is refused', withOrigin.status === 401, `status ${withOrigin.status}`);
const wrongPath = await connectSocket({ pathName: '/other' });
check('upgrade on another path is refused', wrongPath.status === 401, `status ${wrongPath.status}`);

const { client: a, ack } = await openPlugin();
check('handshake returns hello_ack', ack && ack.protocol === 1);
a.send({ type: 'ready' });
const list = await tool('studio_list', {});
check('window is listed as websocket', /\[ws\]/.test(list.text), list.text);

const call1 = tool('run_luau', { code: 'one', timeout_seconds: 5 });
const call2 = tool('run_luau', { code: 'two', timeout_seconds: 5 });
const command1 = await a.next('command');
check('command is pushed with its timeout', command1 && command1.code === 'one' && command1.timeout === 5);
await sleep(300);
check('second command is held until the first finishes', a.messages.every((message) => message.type !== 'command'));
a.send({ type: 'ack', requestId: command1.requestId });
a.send({ type: 'result', requestId: command1.requestId, ok: true, returned: ['r1'], output: [] });
const resultAck1 = await a.next('result_ack');
check('result is acknowledged', resultAck1 && resultAck1.requestId === command1.requestId);
const command2 = await a.next('command');
check('second command arrives after the first result', command2 && command2.code === 'two');
a.send({ type: 'ack', requestId: command2.requestId });
a.send({ type: 'result', requestId: command2.requestId, ok: true, returned: ['r2'], output: [] });
const [r1, r2] = await Promise.all([call1, call2]);
check('both tool calls resolve with their results', r1.text.includes('r1') && r2.text.includes('r2'));

const call3 = tool('run_luau', { code: 'three', timeout_seconds: 5 });
const command3 = await a.next('command');
a.socket.destroy();
await sleep(300);
const { client: b } = await openPlugin();
b.send({ type: 'ready' });
const command3again = await b.next('command');
check('command not acknowledged before a drop is delivered again', command3again && command3again.requestId === command3.requestId);
b.send({ type: 'ack', requestId: command3.requestId });
b.send({ type: 'result', requestId: command3.requestId, ok: true, returned: ['r3'], output: [] });
const r3 = await call3;
check('and then completes normally', !r3.isError && r3.text.includes('r3'), r3.text);

const call4 = tool('run_luau', { code: 'four', timeout_seconds: 5 });
const command4 = await b.next('command');
b.send({ type: 'ack', requestId: command4.requestId });
await sleep(100);
b.socket.destroy();
await sleep(300);
const { client: c } = await openPlugin();
c.send({ type: 'resume', finished: [{ type: 'result', requestId: command4.requestId, ok: true, returned: ['r4'], output: [] }] });
c.send({ type: 'ready' });
const r4 = await call4;
check('acknowledged command whose result is replayed after a reconnect completes', !r4.isError && r4.text.includes('r4'), `${r4.ms}ms`);
const resultAck4 = await c.next('result_ack');
check('replayed result is acknowledged', resultAck4 && resultAck4.requestId === command4.requestId);

const call5 = tool('run_luau', { code: 'five', timeout_seconds: 1 });
const command5 = await c.next('command');
c.send({ type: 'ack', requestId: command5.requestId });
const r5 = await call5;
check('silent plugin times out at timeout plus grace', r5.isError && /Timed out after 1s/.test(r5.text), `${r5.ms}ms`);

await sleep(2000);
check('connection with no heartbeat is dropped by the server', c.closed);
const afterDrop = await tool('studio_list', {});
check('window no longer claims a websocket', !/\[ws\]/.test(afterDrop.text), afterDrop.text);

await sleep(3500);
const ghost = await tool('studio_list', {});
check('closed edit window stops being listed after the reconnect grace', /No Studio window/.test(ghost.text), ghost.text.replace(/\n/g, ' | '));

for (let i = 0; i < 20; i++) {
  const rude = net.connect(port, '127.0.0.1');
  rude.on('error', () => {});
  rude.on('connect', () => {
    rude.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nX-Bridge-Token: wrong\r\n\r\n`);
    rude.resetAndDestroy();
  });
}
await sleep(500);
const stillAlive = await tool('studio_list', {});
check('server survives rejected upgrades that reset mid-write', !stillAlive.isError);

const transient = { id: 'ws-transient-0001', role: 'server', placeId: 9, placeName: 'Game' };
const hello = (client) => client.send({ type: 'hello', ...transient, protocol: 1 });
const t1 = await connectSocket();
hello(t1);
await t1.next('hello_ack');
t1.send({ type: 'ready' });
const strandedCall = tool('run_luau', { code: 'stranded', studio: 'server', timeout_seconds: 5 });
const strandedCommand = await t1.next('command');
t1.socket.destroy();
await sleep(400);
const t2 = await connectSocket();
hello(t2);
await t2.next('hello_ack');
t2.send({ type: 'ready' });
const strandedAgain = await t2.next('command');
check('command unacknowledged when a play window drops is kept and delivered after it reconnects', strandedAgain && strandedAgain.requestId === strandedCommand.requestId);
t2.send({ type: 'ack', requestId: strandedAgain.requestId });
t2.send({ type: 'result', requestId: strandedAgain.requestId, ok: true, returned: ['kept'], output: [] });
const strandedResult = await strandedCall;
check('and its call completes', !strandedResult.isError && strandedResult.text.includes('kept'), strandedResult.text.replace(/\n/g, ' | '));
t2.send({ type: 'goodbye' });
await sleep(300);

let flaky = await connectSocket();
hello(flaky);
await flaky.next('hello_ack');
flaky.send({ type: 'ready' });
const loopCall = tool('run_luau', { code: 'loop', studio: 'server', timeout_seconds: 5 });
let lastResult = null;
for (let attempt = 0; attempt < 5; attempt++) {
  const command = await flaky.next('command', 700);
  if (!command) break;
  flaky.socket.destroy();
  await sleep(300);
  flaky = await connectSocket();
  hello(flaky);
  await flaky.next('hello_ack');
  flaky.send({ type: 'ready' });
}
lastResult = await loopCall;
flaky.send({ type: 'goodbye' });
await sleep(300);
const afterFlaky = await tool('studio_list', {});
check('window that said goodbye is gone at once, even if the peer has not closed its side', !/ws-trans/.test(afterFlaky.text), afterFlaky.text.replace(/\n/g, ' | '));
check('a command whose connection keeps dropping before the ack gives up with an error', lastResult.isError && /dropped 3 times/.test(lastResult.text), lastResult.text.replace(/\n/g, ' | '));

const batchPlugin = await connectSocket();
batchPlugin.send({ type: 'hello', id: 'ws-batch-0001', role: 'edit', placeId: 11, placeName: 'Batch', protocol: 1 });
await batchPlugin.next('hello_ack');
batchPlugin.send({ type: 'ready' });
const batchCall = tool('batch', { operations: [{ tool: 'script_get', args: { path: 'game.A' } }, { tool: 'instance_find', args: { name: 'x' } }], studio: 'Batch' });
const batchCommand = await batchPlugin.next('command');
batchPlugin.send({ type: 'ack', requestId: batchCommand.requestId });
batchPlugin.send({ type: 'result', requestId: batchCommand.requestId, ok: true, returned: ['[1] script_get: FAILED: nope', '[stopped: 1 operation(s) not run]', '1'], output: [] });
const batchResult = await batchCall;
check('batch with a failed operation is flagged as an error', batchResult.isError === true);
check('batch text keeps every operation line and drops the trailing count', batchResult.text.includes('FAILED: nope') && batchResult.text.includes('[stopped') && !/\n1$/.test(batchResult.text.trim()), batchResult.text.replace(/\n/g, ' | '));
batchPlugin.send({ type: 'goodbye' });
await sleep(200);

const play = await connectSocket();
play.send({ type: 'hello', id: 'ws-play-server-1', role: 'server', placeId: 7, placeName: 'Game', protocol: 1 });
await play.next('hello_ack');
const duringPlay = await tool('studio_list', {});
check('play server window is listed', /\[server\].*\[ws\]/.test(duringPlay.text), duringPlay.text.replace(/\n/g, ' | '));
play.send({ type: 'goodbye' });
await sleep(300);
const afterGoodbye = await tool('studio_list', {});
check('goodbye removes the window immediately', !/ws-play-/.test(afterGoodbye.text), afterGoodbye.text.replace(/\n/g, ' | '));
await sleep(3500);
const settled = await tool('studio_list', {});
check('no leftover windows once every grace period has passed', /No Studio window/.test(settled.text), settled.text.replace(/\n/g, ' | '));

server.kill();
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
