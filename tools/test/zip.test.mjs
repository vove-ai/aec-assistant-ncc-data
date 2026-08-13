import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractZip } from '../src/zip.mjs';

function crc32(buf) { // standard table-less bitwise CRC-32
  let c = ~0 >>> 0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function buildZip(entries) { // entries: [{name, data, method: 0|8}]
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

test('extracts stored and deflated entries', () => {
  const zip = buildZip([
    { name: 'a.txt', data: 'hello', method: 0 },
    { name: 'dir/b.xml', data: '<x>y</x>'.repeat(100), method: 8 },
  ]);
  const out = extractZip(zip);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'a.txt');
  assert.equal(out[0].data.toString(), 'hello');
  assert.equal(out[1].name, 'dir/b.xml');
  assert.equal(out[1].data.toString(), '<x>y</x>'.repeat(100));
});

test('rejects unsupported compression method', () => {
  const zip = buildZip([{ name: 'a', data: 'x', method: 0 }]);
  zip.writeUInt16LE(12, zip.indexOf('PK\x01\x02') + 10); // patch method in CD
  assert.throws(() => extractZip(zip), /unsupported compression/i);
});
