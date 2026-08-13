import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifySha256, extractToDir, isExtractionCurrent } from '../src/fetch.mjs';
import { buildZip } from './helpers/zip-builder.mjs';

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-fetch-test-'));
}

test('extractToDir rejects an entry that escapes the destination via ../', () => {
  const dest = tmpDir();
  try {
    const zip = buildZip([{ name: '../escape.txt', data: 'x', method: 0 }]);
    assert.throws(() => extractToDir(zip, dest), /path escape/i);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('extractToDir accepts a filename that merely starts with two dots', () => {
  const dest = tmpDir();
  try {
    const zip = buildZip([{ name: '..note.xml', data: 'hello', method: 0 }]);
    extractToDir(zip, dest);
    assert.equal(fs.readFileSync(path.join(dest, '..note.xml'), 'utf8'), 'hello');
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('extractToDir rejects an absolute entry name', () => {
  const dest = tmpDir();
  try {
    const zip = buildZip([{ name: '/etc/passwd', data: 'x', method: 0 }]);
    assert.throws(() => extractToDir(zip, dest), /path escape/i);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('isExtractionCurrent is false when the marker is missing', () => {
  const dir = tmpDir();
  try {
    assert.equal(isExtractionCurrent(path.join(dir, '.extracted-ok'), 'abc123'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isExtractionCurrent is false when the marker predates a checksum change', () => {
  const dir = tmpDir();
  try {
    const marker = path.join(dir, '.extracted-ok');
    fs.writeFileSync(marker, 'old-sha-256-digest');
    assert.equal(isExtractionCurrent(marker, 'new-sha-256-digest'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isExtractionCurrent is true when the marker matches the current digest', () => {
  const dir = tmpDir();
  try {
    const marker = path.join(dir, '.extracted-ok');
    const sha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    fs.writeFileSync(marker, sha);
    assert.equal(isExtractionCurrent(marker, sha), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
