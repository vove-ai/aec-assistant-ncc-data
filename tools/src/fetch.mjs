import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractZip } from './zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKSUMS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'checksums.json'), 'utf8'));

export function verifySha256(buf, expected, name) {
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== expected) throw new Error(`${name}: checksum mismatch\n  expected ${expected}\n  got      ${got}`);
}

/** True when `markerPath` exists and its content equals the asset's current expected digest. */
export function isExtractionCurrent(markerPath, expectedSha) {
  if (!fs.existsSync(markerPath)) return false;
  return fs.readFileSync(markerPath, 'utf8') === expectedSha;
}

function safeEntryPath(dest, name) {
  if (path.isAbsolute(name)) throw new Error(`zip path escape: ${name}`);
  const p = path.join(dest, name);
  const rel = path.relative(dest, p);
  if (rel === '..' || rel.startsWith('..' + path.sep)) throw new Error(`zip path escape: ${name}`);
  return p;
}

/** Extracts every entry of a zip buffer into `dest`, rejecting any entry that would escape it. */
export function extractToDir(buf, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const { name, data } of extractZip(buf)) {
    const p = safeEntryPath(dest, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
}

export async function fetchAll({ cacheDir = '.cache' } = {}) {
  const zipsDir = path.join(cacheDir, 'zips');
  const extractedDir = path.join(cacheDir, 'extracted');
  fs.mkdirSync(zipsDir, { recursive: true });
  const result = new Map();
  for (const [asset, sha] of Object.entries(CHECKSUMS.assets).sort()) {
    const zipPath = path.join(zipsDir, asset);
    let buf;
    if (fs.existsSync(zipPath)) {
      buf = fs.readFileSync(zipPath);
      try { verifySha256(buf, sha, asset); } catch { fs.rmSync(zipPath); buf = null; }
    }
    if (!buf) {
      const res = await fetch(CHECKSUMS.baseUrl + asset);
      if (!res.ok) throw new Error(`${asset}: HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      verifySha256(buf, sha, asset);
      fs.writeFileSync(zipPath, buf);
    }
    const stem = asset.replace(/\.zip$/, '');
    const dest = path.join(extractedDir, stem);
    const marker = path.join(dest, '.extracted-ok');
    if (!isExtractionCurrent(marker, sha)) {
      fs.rmSync(dest, { recursive: true, force: true });
      extractToDir(buf, dest);
      fs.writeFileSync(marker, sha);
    }
    result.set(stem, dest);
    console.log(`ok ${asset}`);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAll().catch(e => { console.error(e.message); process.exit(1); });
}
