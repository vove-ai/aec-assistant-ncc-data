import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySha256 } from '../src/fetch.mjs';

test('verifySha256 accepts matching digest', () => {
  // sha256 of "abc"
  assert.doesNotThrow(() => verifySha256(Buffer.from('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'x.zip'));
});
test('verifySha256 throws on mismatch, names the asset', () => {
  assert.throws(() => verifySha256(Buffer.from('abd'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'x.zip'),
    /x\.zip.*checksum/i);
});
