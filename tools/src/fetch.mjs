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
    if (!fs.existsSync(marker)) {
      fs.rmSync(dest, { recursive: true, force: true });
      for (const { name, data } of extractZip(buf)) {
        const p = path.join(dest, name);
        if (path.relative(dest, p).startsWith('..')) throw new Error(`zip path escape: ${name}`);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, data);
      }
      fs.writeFileSync(marker, CHECKSUMS.release);
    }
    result.set(stem, dest);
    console.log(`ok ${asset}`);
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAll().catch(e => { console.error(e.message); process.exit(1); });
}
