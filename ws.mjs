import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export function acceptWebSocket(req, socket, handlers = {}) {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n',
  );
  socket.setNoDelay(true);

  let buffer = Buffer.alloc(0);
  let fragments = [];
  let fragmentBytes = 0;
  let fragmentOpcode = 0;
  let closed = false;

  const connection = {
    send(text) {
      if (closed) return false;
      socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
      return true;
    },
    close(code = 1000) {
      if (closed) return;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      socket.write(encodeFrame(0x8, payload));
      closed = true;
      socket.end();
    },
    terminate() {
      closed = true;
      socket.destroy();
    },
    get isOpen() {
      return !closed;
    },
  };

  function fail(code) {
    connection.close(code);
  }

  function handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      if (!closed) {
        closed = true;
        socket.write(encodeFrame(0x8, payload.subarray(0, 2)));
        socket.end();
      }
      return;
    }
    if (opcode === 0x9) {
      socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode === 0xa) return;
    if (opcode === 0x1 || opcode === 0x2) {
      fragments = [payload];
      fragmentBytes = payload.length;
      fragmentOpcode = opcode;
    } else if (opcode === 0x0) {
      fragments.push(payload);
      fragmentBytes += payload.length;
    } else {
      return fail(1002);
    }
    if (fragmentBytes > MAX_MESSAGE_BYTES) return fail(1009);
    if (!fin) return;
    const message = Buffer.concat(fragments);
    fragments = [];
    fragmentBytes = 0;
    if (handlers.onMessage) handlers.onMessage(fragmentOpcode === 0x1 ? message.toString('utf8') : message);
  }

  function parse() {
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return fail(1009);
        length = Number(big);
        offset = 10;
      }
      if (!masked) return fail(1002);
      if (length > MAX_MESSAGE_BYTES) return fail(1009);
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(offset + 4 + length);
      handleFrame(fin, opcode, payload);
      if (closed && !socket.writable) return;
    }
  }

  socket.on('data', (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    try {
      parse();
    } catch {
      fail(1011);
    }
  });
  socket.on('close', () => {
    const wasClosed = closed;
    closed = true;
    if (handlers.onClose) handlers.onClose(wasClosed);
  });
  socket.on('error', () => {});

  return connection;
}
