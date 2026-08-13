import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractZip } from '../src/zip.mjs';
import { buildZip } from './helpers/zip-builder.mjs';

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
