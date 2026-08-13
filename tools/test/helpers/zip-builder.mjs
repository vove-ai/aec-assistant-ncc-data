import zlib from 'node:zlib';

function crc32(buf) { // standard table-less bitwise CRC-32
  let c = ~0 >>> 0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

/** Builds a minimal stored/deflate zip buffer by hand for tests. entries: [{name, data, method: 0|8}] */
export function buildZip(entries) {
  const chunks = []; const central = []; let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const stored = e.method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(e.method, 8); lfh.writeUInt32LE(0, 10);
    lfh.writeUInt32LE(crc32(raw), 14); lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(raw.length, 22); lfh.writeUInt16LE(name.length, 26); lfh.writeUInt16LE(0, 28);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8); cdh.writeUInt16LE(e.method, 10); cdh.writeUInt32LE(0, 12);
    cdh.writeUInt32LE(crc32(raw), 16); cdh.writeUInt32LE(stored.length, 20);
    cdh.writeUInt32LE(raw.length, 24); cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cdh, name]));
    chunks.push(lfh, name, stored); offset += 30 + name.length + stored.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}
