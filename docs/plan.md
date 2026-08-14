# aec-assistant-ncc-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the grep-optimized NCC corpus repo — normalized per-clause markdown for NCC 2022 + 2025 with a reproducible toolchain — and publish it as `vove-ai/aec-assistant-ncc-data` for Claude Managed Agents consumption.

**Architecture:** A fetch → read → normalize → emit → index pipeline. `fetch.mjs` downloads pinned ABCB zips from `alvar-ncc-data`'s public release and verifies SHA-256; two readers (`read-2025.mjs` monolithic-XML walker, `read-2022.mjs` per-file DITA reader) produce a common Unit shape; `normalize.mjs` turns DOM nodes into grep-friendly markdown (xrefs inlined, one paragraph per line); `emit.mjs` derives filenames + fixed-order frontmatter; `build.mjs` orchestrates, asserts global filename uniqueness, and writes `corpus/`. CI regenerates and diffs.

**Tech Stack:** Node ≥24 (ESM), `node --test`, single runtime dep `@xmldom/xmldom`. No other dependencies — zip extraction is a small pure-Node module using `node:zlib`.

**Spec:** `docs/design.md` (this repo, commit 685e013). Verified content model: `docs/content-model-2025.md`. The plan argues from the spec; executors read both.

## Global Constraints

- Working directory for ALL tasks: `C:\dev\aec-assistant-ncc-data` (Git Bash paths: `/c/dev/aec-assistant-ncc-data`). Never touch the aec-assistant repo.
- Node ≥ 24, ESM only (`"type": "module"`), tests via `node --test tools/test/`. Zero test deps.
- Exactly one runtime dependency: `@xmldom/xmldom`. `package-lock.json` is committed.
- Deterministic output: iterate in sorted order (codepoint sort — never `localeCompare`), no timestamps/environment data in emitted files, all output written with `\n` line endings. `.gitattributes` forces LF.
- Fail-loud: unknown XML elements, unresolvable references, filename collisions, and checksum mismatches throw with a report. Ignorable elements live in one explicit allowlist per reader.
- `corpus/` contains only generated files. Nothing outside `corpus/` is agent-searchable content.
- Frontmatter key order (fixed): `clause`|`term`, `title`, `citation`, `web_url`, `edition`, `volume`, `jurisdiction`, `supersedes`, `building_classes_excluded`, `defined_terms`. Omit keys with no value. (A spec addendum: both sources carry `building` values on clauses — 2025 as `clause/@building`, 2022 as `<meta><facet building>` — and dropping data would violate fail-loud. It was `building_classes` until the Task 11 gate; the owner ruled it renamed, because the value is the set of classes the clause does NOT apply to and the old name stated the opposite. Evidence: A1G1 "Scope of NCC Volume One" carries `Class 1a, Class 10c` while its own text says Volume One covers Class 2–9.)
- Citation prefixes (verbatim, matching the vector-store corpus): `NCC {year} V1`, `NCC {year} V2`, `NCC {year} V3`, `NCC {year} HP`, `NCC 2025 LHD`.
- Figure CDN base: `https://cdn.aecassistant.com.au/images/ncc/{year}/{cdnKey}/{filename}` with cdnKey ∈ `volume1|volume2|volume3|housing|livable_housing` (2022 uses the same scheme under `/2022/`).
- Prose is never hard-wrapped: one paragraph = one line.
- Commit after every task (message prefix `feat:`/`test:`/`docs:`/`chore:` as fits). Do not push `corpus/` bulk commits until their acceptance step passes.

## Verified source facts (do not re-derive; measured 2026-08-13)

- Release: `https://github.com/vove-ai/alvar-ncc-data/releases/download/ncc-2026-07/<asset>`; SHA-256 list in Task 2.
- **2025 XML shapes:** `<ncc-section id type num>`; `<part id num>`; `<specification id num>`; `<subtopic id subtopic-type>`; `<clause id building="Class 2,...">` with child `<sptc>A1G1</sptc>` (894 sptc in vol-one); `<clause-variation id type="REPLACE" state="NSW" sptc="A2G2" num="">`; self-closing pointer `<variation tag reference num sptc type/>` inside jurisdiction schedules; `<glossentry category id>` (556 in vol-one); figures are `<img src="image-A2G1-ncc-compliance-structure.svg">` (380 in vol-one, src = filename in the package's `images/` dir); `<table-reference id num sptc>`; `<math>` ×220 in vol-one. Element names ≠ XSD type names (element `section` = type `ncc-content-section`).
- **2025 unit counts by immediate parent** (parity targets, full table): see `docs/content-model-2025.md` § Measured containment.
- **2022 package shapes:** per-file DITA; roots observed: `<clause outputclass="ncc-clause">` (with `<sptc>`, `<archive-num>2019: A5.6</archive-num>`), `<specification>`, `<part outputclass="ncc-part">`, `outputclass="standard-part"`. Figures via separate image-reference wrapper files (`<image-reference conref=...>` in prose; wrapper file carries `<image alt href width>` — join measured in Task 9). Glossary = per-term files (~549 glossary-named files in vol-one).
- **2022 package overlap (measured):** 3,973 distinct filenames across the four packages; 2,387 present in all four but only 615 byte-identical; 1,447 unique to one package (vol-one 480, vol-two 190, vol-three 274, HP 503). Consequence: each package is read as its own publication (volume attribution = package membership); cross-volume dedupe only where bytes are identical, decided per kind in Tasks 13–14.
- Pilot slice: **Volume One, Sections A + C, both editions** (covers figures, AS references, state variations `a5g4-vic`/`a2g2-nsw`, and the A5G7 xref-phrase defect).

## File structure (final)

```
├── README.md  AGENTS.md  LICENSE  package.json  package-lock.json
├── .node-version  .gitignore  .gitattributes
├── corpus/                      # generated only
│   ├── INDEX.md
│   ├── 2022/{INDEX.md, volume-one/, volume-two/, volume-three/, housing-provisions/, glossary/}
│   └── 2025/{INDEX.md, volume-one/, volume-two/, volume-three/, housing-provisions/, livable-housing/, glossary/}
├── docs/{design.md, plan.md, content-model-2025.md, content-model-2022.md}
├── tools/
│   ├── checksums.json
│   ├── data/{weblinks-2022.json, weblinks-2025.json}
│   ├── src/{fetch.mjs, zip.mjs, read-2025.mjs, read-2022.mjs, normalize.mjs, emit.mjs,
│   │        weblinks.mjs, fetch-weblinks.mjs, index.mjs, build.mjs, sync-figures.mjs, verify-agent.mjs}
│   └── test/{*.test.mjs}
└── .github/workflows/ci.yml
```

Module responsibilities: `zip.mjs` extraction only; `fetch.mjs` download+verify+extract; readers produce `RawUnit`s; `normalize.mjs` DOM→markdown (pure); `emit.mjs` identity+frontmatter (pure); `weblinks.mjs` URL keying (pure) with `fetch-weblinks.mjs` as its one-off crawler; `index.mjs` INDEX generation (pure); `build.mjs` orchestration + assertions + reporting; `sync-figures.mjs` and `verify-agent.mjs` are operator CLIs.

---

### Task 1: Scaffold, GitHub repo, CI (tests only)

**Files:**
- Create: `package.json`, `.node-version`, `.gitignore`, `.gitattributes`, `LICENSE`, `README.md`, `.github/workflows/ci.yml`, `tools/test/smoke.test.mjs`

**Interfaces:**
- Produces: repo skeleton every later task builds in; `npm test` green; remote `origin` = `vove-ai/aec-assistant-ncc-data`.

- [ ] **Step 1: Write files**

`package.json`:
```json
{
  "name": "aec-assistant-ncc-data",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "fetch": "node tools/src/fetch.mjs",
    "fetch-weblinks": "node tools/src/fetch-weblinks.mjs",
    "build": "node tools/src/build.mjs",
    "test": "node --test tools/test/",
    "sync-figures": "node tools/src/sync-figures.mjs"
  },
  "dependencies": { "@xmldom/xmldom": "^0.9.0" }
}
```

`.node-version`: `24` — `.gitignore`: `.cache/` and `node_modules/` — `.gitattributes`: `* text=auto eol=lf`

`LICENSE`: MIT text, `Copyright (c) 2026 vove.ai`, with this line prepended above the licence body: `This licence covers the toolchain and repository scaffolding (everything outside corpus/). For corpus/ content licensing, see README.md.`

`README.md` (full content — mirror of alvar-ncc-data's structure with the changes notice inverted):
```markdown
# aec-assistant-ncc-data

National Construction Code (NCC) 2022 and 2025, normalized to one markdown file per clause for
exact text search (grep) with clause-level citations. Consumed by AEC Assistant's agents as a
mounted repository. Derived from the verbatim ABCB XML datasets redistributed by
[alvar-ncc-data](https://github.com/vove-ai/alvar-ncc-data) (release `ncc-2026-07`, SHA-256
verified — see `tools/checksums.json`).

Both NCC editions are concurrently in force in Australia; the applicable edition follows a
project's permit application lodgement date.

## Layout

Everything under `corpus/` is generated by the toolchain in `tools/` and searched by agents —
see `AGENTS.md` for the search contract and `corpus/INDEX.md` for the map. Regenerate with
`npm ci && npm run fetch && npm run build`; CI fails if the committed corpus and the toolchain
disagree.

## Source and licence

Code (everything outside `corpus/`): MIT, see `LICENSE`.

`corpus/` content: © Commonwealth of Australia and the States and Territories of Australia
2022, 2025, published by the Australian Building Codes Board, licensed under the
[Creative Commons Attribution 4.0 International licence](https://creativecommons.org/licenses/by/4.0/)
(with the exception of third-party material, trade marks, and images/photographs as noted in
each publication's licence notice). Required attribution: **"The National Construction Code
2022 was provided by the Australian Building Codes Board under the CC BY 4.0 licence"** (and
correspondingly for NCC 2025).

**Changes: yes — this is a derivative.** Relative to the ABCB XML publications: content is
split to one file per clause/definition/page; markup is normalized to markdown; glossary
cross-references are inlined as plain prose; figure references are rewritten to CDN URLs;
citation metadata is added as YAML frontmatter. This repository is not affiliated with, and
its contents are not endorsed by, the ABCB. The NCC as published at
[ncc.abcb.gov.au](https://ncc.abcb.gov.au/) remains the authoritative source — verify anything
safety-critical there.
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - run: npm test
```

`tools/test/smoke.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('node >= 24', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
});
```

- [ ] **Step 2: Install and test** — Run `npm install` then `npm test`. Expected: 1 pass. `package-lock.json` now exists.

- [ ] **Step 3: Commit, create repo, push**

```bash
git add -A && git commit -m "chore: scaffold — package, licence, README, CI (tests only)"
gh repo create vove-ai/aec-assistant-ncc-data --public --source . --push \
  --description "NCC 2022 + 2025 normalized to per-clause markdown for exact-text (grep) retrieval. CC BY 4.0 derivative of ABCB data."
```

Verify: `gh run watch` → CI green.

---

### Task 2: checksums.json, zip.mjs, fetch.mjs

**Files:**
- Create: `tools/checksums.json`, `tools/src/zip.mjs`, `tools/src/fetch.mjs`
- Test: `tools/test/zip.test.mjs`, `tools/test/fetch.test.mjs`

**Interfaces:**
- Produces: `extractZip(buffer) -> Array<{name: string, data: Buffer}>` (zip.mjs); `fetchAll({cacheDir = '.cache'}) -> Promise<Map<assetStem, extractedDirPath>>` and CLI `npm run fetch` (fetch.mjs). Later tasks read sources from `.cache/extracted/<asset-stem>/`.

- [ ] **Step 1: Write `tools/checksums.json`** (verbatim from release `ncc-2026-07`'s SHA256SUMS.txt):

```json
{
  "release": "ncc-2026-07",
  "baseUrl": "https://github.com/vove-ai/alvar-ncc-data/releases/download/ncc-2026-07/",
  "assets": {
    "ncc-2022-volume-one.zip": "15735c77abac5ea1f73b52987a747aa4071ad5c81053bb6947ac163f12e63d2e",
    "ncc-2022-volume-two.zip": "a48e5fc3221c289dbce7aa3440e653e033e24d985a9b24315710dd3adfba7b1d",
    "ncc-2022-volume-three.zip": "6210b426547cea9364448d7cac6f563a69107a43db03de8984fb52ff334c1541",
    "ncc-2022-housing-provisions.zip": "89edfd63123c87163d28232108e20a33a22fb18f97ebab2471821e88d1dfd357",
    "ncc-2025-volume-one-v1.2.zip": "fbeca8078d2bfdc28142d10b4092a36f90516da983e0e12b37b041abc08c5bc1",
    "ncc-2025-volume-two-v1.2.zip": "3260b5b5c9a0f548a296f9cb512c1a4103e0b74724c273f88b315f42adb93bb4",
    "ncc-2025-volume-three-v1.2.zip": "7c9c0d59af9b4dfc37c11a6578a5475908260ba2c4de4a5c240d173e0b881112",
    "ncc-2025-housing-provisions-v1.2.zip": "7634dbba51404d2ac530f74cbffcba0a119e1c84ed29ec0c161931031028b643",
    "ncc-2025-livable-housing-design-v1.2.zip": "13cfcb8200539f991525e740dfb167455a05443431ddc324d45545946bd9801f",
    "ncc-2025-schema-v1.2.zip": "321e99182603fcd94dffa35993e674c562358f61f58296789904f6ebf01804f2"
  }
}
```

- [ ] **Step 2: Write failing zip tests** (`tools/test/zip.test.mjs`). Build a stored-method zip buffer by hand in a helper (local file header `PK\x03\x04`, central directory `PK\x01\x02`, EOCD `PK\x05\x06`) and a deflate-method entry via `zlib.deflateRawSync`:

```js
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
```

- [ ] **Step 3: Run — verify fail** — `node --test tools/test/zip.test.mjs` → FAIL (module not found).

- [ ] **Step 4: Implement `tools/src/zip.mjs`**

```js
import zlib from 'node:zlib';

/** Minimal zip reader: central-directory driven, stored + deflate only, no zip64. */
export function extractZip(buf) {
  // EOCD: scan backwards for signature (comment can follow, max 64KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('zip: zip64 not supported');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip: bad central header at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (!name.endsWith('/')) {
      let data;
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
      if (data.length !== usize) throw new Error(`zip: size mismatch for ${name}`);
      out.push({ name, data });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
```

- [ ] **Step 5: zip tests pass** — `node --test tools/test/zip.test.mjs` → PASS.

- [ ] **Step 6: Write `tools/test/fetch.test.mjs`** — unit-level: checksum verification logic (no network):

```js
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
```

- [ ] **Step 7: Implement `tools/src/fetch.mjs`**

```js
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
```

- [ ] **Step 8: All tests pass, then live fetch** — `npm test` → PASS. Run `npm run fetch` → 10 × `ok`, `.cache/extracted/` populated. Spot-check: `ls .cache/extracted/ncc-2025-volume-one-v1.2/` shows `contents.xml`, `images/`, `schema/`.

- [ ] **Step 9: Commit** — `git add tools/ && git commit -m "feat: pinned fetch with sha-256 verification and pure-node zip extraction"`

---

### Task 3: read-2025.mjs — the XSD-derived walker

**Files:**
- Create: `tools/src/read-2025.mjs`
- Test: `tools/test/read-2025.test.mjs`

**Interfaces:**
- Consumes: `.cache/extracted/ncc-2025-*/contents.xml`.
- Produces:
  ```js
  export const DOCUMENTS_2025 = [ // ordering fixed
    { key: 'volume-one',        pkg: 'ncc-2025-volume-one-v1.2',        cdnKey: 'volume1',         citationPrefix: 'NCC 2025 V1',  volumeLabel: 'Volume One' },
    { key: 'volume-two',        pkg: 'ncc-2025-volume-two-v1.2',        cdnKey: 'volume2',         citationPrefix: 'NCC 2025 V2',  volumeLabel: 'Volume Two' },
    { key: 'volume-three',      pkg: 'ncc-2025-volume-three-v1.2',      cdnKey: 'volume3',         citationPrefix: 'NCC 2025 V3',  volumeLabel: 'Volume Three' },
    { key: 'housing-provisions',pkg: 'ncc-2025-housing-provisions-v1.2',cdnKey: 'housing',         citationPrefix: 'NCC 2025 HP',  volumeLabel: 'Housing Provisions' },
    { key: 'livable-housing',   pkg: 'ncc-2025-livable-housing-design-v1.2', cdnKey: 'livable_housing', citationPrefix: 'NCC 2025 LHD', volumeLabel: 'Livable Housing Design' },
  ];
  // RawUnit — the shape all later stages consume:
  // { edition:'2025', volume:key, kind:'clause'|'glossary'|'page',
  //   id:string|null, term:string|null, title:string, state:string|null,
  //   supersedes:string|null, buildingClasses:string|null,
  //   sectionNum, sectionType, containerKind, containerNum, containerTitle,
  //   node /* DOM element */ }
  export function readDocument2025(xmlString, doc, { sections = null } = {}) // -> RawUnit[]
  ```
  `sections: ['A','C']` filters to those `ncc-section num` values (slice mode).

- [ ] **Step 1: Write failing tests.** Two groups. (a) Fixture tests encoding every measured trap — hand-written mini documents:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readDocument2025, DOCUMENTS_2025 } from '../src/read-2025.mjs';
const VOL1 = DOCUMENTS_2025[0];

const wrap = inner => `<?xml version="1.0"?><ncc-volume publishing-id="vol1">${inner}</ncc-volume>`;

test('finds clauses under subtopic (the vol1-3 dominant container)', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <part id="p" num="A1"><title>Interp</title><subtopic id="st" subtopic-type="governance">
    <clause id="c1"><sptc>A1G1</sptc><title>Scope</title><p>Body.</p></clause></subtopic></part>
    </ncc-section>`), VOL1);
  const c = units.find(u => u.id === 'A1G1');
  assert.ok(c, 'clause under subtopic must be found');
  assert.equal(c.sectionNum, 'A');
  assert.equal(c.containerNum, 'A1');
});

test('finds clauses under specification (sibling of part, not child)', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <specification id="sp" num="1"><title>Fire-resistance</title>
    <clause id="c"><sptc>S1C1</sptc><title>Scope</title><p>B.</p></clause></specification></ncc-section>`), VOL1);
  assert.ok(units.find(u => u.id === 'S1C1'), 'specification clauses must be walked');
  assert.equal(units.find(u => u.id === 'S1C1').containerKind, 'specification');
});

test('clause-variation carries its own state; sptc from attribute', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A2"><title>P</title>
    <clause id="c"><sptc>A2G2</sptc><title>T</title><p>National.</p>
      <clause-variation id="v" type="REPLACE" state="NSW" sptc="A2G2" num=""><title>T</title><p>NSW text.</p></clause-variation>
    </clause></part></ncc-section>`), VOL1);
  const v = units.find(u => u.state === 'NSW');
  assert.ok(v, 'clause-variation nested in clause must be emitted (XSD ⊕ correction)');
  assert.equal(v.id, 'A2G2');
  const nat = units.find(u => u.id === 'A2G2' && u.state === null);
  assert.ok(nat, 'national clause still emitted');
});

test('state inherits downward but own attribute wins', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part-variation id="pv" state="VIC" num="A5"><title>PV</title>
    <clause id="c1"><sptc>A5G4</sptc><title>T1</title><p>x</p></clause>
    <clause-variation id="c2" state="NT" sptc="A5G5" type="REPLACE" num=""><title>T2</title><p>y</p></clause-variation>
    </part-variation></ncc-section>`), VOL1);
  assert.equal(units.find(u => u.id === 'A5G4').state, 'VIC', 'inherited');
  assert.equal(units.find(u => u.id === 'A5G5').state, 'NT', 'own attribute wins');
});

test('glossary entries become glossary units; section num+type both kept', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="other" num=""><title>G</title>
    <ncc-glossary id="g"><glossentry category="term" id="e1"><title>Accessway</title>
    <glossdef><p>A continuous accessible path of travel.</p></glossdef></glossentry></ncc-glossary></ncc-section>`), VOL1);
  const g = units.find(u => u.kind === 'glossary');
  assert.ok(g); assert.equal(g.term, 'Accessway'); assert.equal(g.sectionType, 'other');
});

test('unknown element outside allowlist throws (fail-loud)', () => {
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <mystery-tag><clause id="c"><sptc>A9G9</sptc><title>T</title></clause></mystery-tag></ncc-section>`), VOL1),
    /mystery-tag/);
});
```

(b) Integration parity against the real corpus (auto-skip when `.cache` absent, always run in CI):

```js
const CACHE = '.cache/extracted/ncc-2025-volume-one-v1.2/contents.xml';
test('volume-one full-walk parity with content-model-2025.md', { skip: !fs.existsSync(CACHE) }, () => {
  const units = readDocument2025(fs.readFileSync(CACHE, 'utf8'), VOL1);
  const clauses = units.filter(u => u.kind === 'clause');
  const glossary = units.filter(u => u.kind === 'glossary');
  // From the re-measured table: clause-kind units reachable in vol-one =
  // 868 (subtopic) + 336 (clause) + 251 (specification) + 63 (spec-topic) + 2 (clause-variation)
  // minus table-references (counted separately in build). Assert lower bounds + exact glossary:
  assert.ok(clauses.length >= 1500, `got ${clauses.length}`);
  assert.equal(glossary.length, 537 + 19); // entries + variations
  assert.ok(units.find(u => u.id === 'A5G7'), 'A5G7 present');
  assert.ok(units.find(u => u.id === 'A5G4' && u.state === 'VIC'), 'A5G4 VIC variation present');
});
test('slice mode filters to sections', { skip: !fs.existsSync(CACHE) }, () => {
  const units = readDocument2025(fs.readFileSync(CACHE, 'utf8'), VOL1, { sections: ['A', 'C'] });
  assert.ok(units.every(u => ['A', 'C', ''].includes(u.sectionNum ?? '')));
  assert.ok(units.find(u => u.id === 'A5G7'));
});
```

Note for implementer: the first integration run REPLACES the `>= 1500` bound with the exact measured number (then assert equality) and records the exact per-kind totals in the test as the canonical parity constants. The glossary `title`-vs-other term-element question is settled here too: implement term extraction as "text of the entry's first `<title>` child; if absent, fail loud" and verify against the real corpus (assert the `Accredited Testing Laboratory` entry exists by term).

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.** Core walker (complete logic — recursion, no container whitelist):

```js
import { DOMParser } from '@xmldom/xmldom';

const UNIT_TAGS = new Set(['clause', 'clause-variation', 'standard-clause', 'glossentry', 'glossentry-variation']);
// Elements that are pure structure/content we descend through or normalize later.
// Anything not listed here, not a unit, and not in NORMALIZE_TAGS → throw.
const DESCEND_TAGS = new Set(['ncc-volume', 'ncc-standard', 'ncc-section', 'part', 'part-variation',
  'schedule-part', 'schedule-part-variation', 'schedule-spec', 'schedule-referenced-document',
  'specification', 'spec-topic', 'subtopic', 'ncc-glossary', 'page', 'variation', 'section',
  'tracked-content', 'callout', 'glossdef', 'title', 'introduction']);
// Prose-level tags are NOT walked for units here; they belong to normalize.mjs. The walker
// only descends structure. A unit's own subtree is handed over whole via `node`.

export function readDocument2025(xmlString, doc, { sections = null } = {}) {
  const dom = new DOMParser().parseFromString(xmlString, 'text/xml');
  const units = [];
  const ctx0 = { sectionNum: null, sectionType: null, containerKind: null, containerNum: null, containerTitle: null, state: null };
  walk(dom.documentElement, ctx0);
  return units;

  function childTitle(el) {
    for (let n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 1 && n.nodeName === 'title') return text(n).trim();
    return '';
  }
  function text(n) { return n.textContent ?? ''; }

  function emitUnit(el, ctx, kind) {
    const state = el.getAttribute?.('state') || ctx.state || null;
    if (kind === 'glossary') {
      units.push({ edition: '2025', volume: doc.key, kind, id: null,
        term: childTitle(el) || failLoud(el, 'glossentry without title'), title: childTitle(el),
        state, supersedes: null, buildingClasses: null, ...pickCtx(ctx), node: el });
    } else {
      const sptcChild = childText(el, 'sptc');
      const id = el.getAttribute('sptc') || sptcChild || null;
      units.push({ edition: '2025', volume: doc.key, kind: 'clause', id,
        term: null, title: childTitle(el), state,
        supersedes: childText(el, 'archive-num') || null,
        buildingClasses: el.getAttribute('building') || null,
        ...pickCtx(ctx), node: el });
    }
  }
  function childText(el, tag) {
    for (let n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 1 && n.nodeName === tag) return text(n).trim();
    return '';
  }
  function pickCtx(c) { return { sectionNum: c.sectionNum, sectionType: c.sectionType,
    containerKind: c.containerKind, containerNum: c.containerNum, containerTitle: c.containerTitle }; }
  function failLoud(el, msg) { throw new Error(`read-2025 [${doc.key}]: ${msg} (element <${el.nodeName}>)`); }

  function walk(el, ctx) {
    if (el.nodeType !== 1) return;
    const tag = el.nodeName;
    let next = ctx;

    if (tag === 'ncc-section') {
      const num = el.getAttribute('num') ?? '';
      if (sections && el.getAttribute('type') === 'section' && !sections.includes(num)) return;
      next = { ...ctx, sectionNum: num, sectionType: el.getAttribute('type') };
    } else if (['part', 'part-variation', 'specification', 'spec-topic', 'schedule-part', 'schedule-spec', 'schedule-part-variation'].includes(tag)) {
      next = { ...ctx, containerKind: tag, containerNum: el.getAttribute('num') || '', containerTitle: childTitle(el),
        state: el.getAttribute('state') || ctx.state };
    } else if (tag === 'page') {
      const state = el.getAttribute('state') || ctx.state || null; // ⊕ trap 3: own state, pages included
      units.push({ edition: '2025', volume: doc.key, kind: 'page', id: null, term: null,
        title: childTitle(el), state, supersedes: null, buildingClasses: null, ...pickCtx(ctx), node: el });
      return; // page subtree normalized later, not walked for units
    } else if (UNIT_TAGS.has(tag)) {
      emitUnit(el, ctx, tag.startsWith('gloss') ? 'glossary' : 'clause');
      // ⊕ XSD correction: a clause may nest clause-variation — keep walking its element children
      for (let n = el.firstChild; n; n = n.nextSibling)
        if (n.nodeType === 1 && (UNIT_TAGS.has(n.nodeName))) walk(n, { ...ctx, state: el.getAttribute('state') || ctx.state });
      return;
    } else if (tag === 'variation') {
      next = { ...ctx, state: el.getAttribute('state') || ctx.state };
    } else if (!DESCEND_TAGS.has(tag)) {
      failLoud(el, `unknown structural element — add to DESCEND_TAGS only after checking it holds no units`);
    }
    for (let n = el.firstChild; n; n = n.nextSibling) walk(n, next);
  }
}
```

The implementer adjusts `DESCEND_TAGS` strictly by running against the real corpus and inspecting each element the fail-loud check surfaces (jurisdiction schedules will surface a handful — verify each against the XSD before adding). `variation` pointer elements (`<variation tag reference .../>` self-closing) resolve to content already present at the reference target; they are context markers, not units.

- [ ] **Step 4: Fixture tests pass; run integration; freeze exact parity constants; tests pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: 2025 walker — XSD-derived, fail-loud, trap regression tests"`

---

### Task 4: normalize.mjs — DOM → grep-friendly markdown

**Files:**
- Create: `tools/src/normalize.mjs`
- Test: `tools/test/normalize.test.mjs`

**Interfaces:**
- Consumes: a `RawUnit.node` DOM element + its document descriptor `{ cdnKey }` and edition year.
- Produces:
  ```js
  export function normalizeUnit(unit, { cdnBase = 'https://cdn.aecassistant.com.au/images/ncc', year, cdnKey }) 
  // -> { bodyMd: string, definedTerms: string[], figures: string[], warnings: string[] }
  ```

**Normalization rules (the format contract — from spec § Corpus conventions):**

| Source | Output |
|---|---|
| `<p>` | one line, no hard wraps; blank line between paragraphs |
| `<xref type="abcb-glossentry">term</xref>` (2022) / glossary refs (2025) | inline text content, collected into `definedTerms` (deduped, document order) |
| `<subclause><num>1</num>…` | `**(1)** ` prefix on the subclause's first paragraph line |
| `<ol>` | `(a)`/`(b)` items — alpha default; `class`/`outputclass="numbered"` → `(1)`; `"roman"` → `(i)`; nested lists indent 2 spaces per level |
| `<table>` | GFM table; cell text flattened (`\n+` → space); a table too irregular for GFM (rowspan/colspan) → GFM with cells duplicated + warning |
| `<table-reference id num sptc><title>T</title><table>…` | `### Table {num} — {T}` heading then the table, emitted inline in the owning unit's body |
| `<callout>` / notes / explanatory content | `> ` blockquote, one line per paragraph |
| `<img src="X.svg">` (2025) | `![Figure {caption}]({cdnBase}/{year}/{cdnKey}/X.svg)` — caption from the nearest preceding title/num context; `X.svg` recorded in `figures` |
| `<math>` (MathML) | text content flattened inline + warning counted (`warnings`) |
| `<b>/<strong>` `<i>/<em>` | `**x**`, `*x*` |
| `<sup>/<sub>` | text as-is (no markup) |
| unknown inline element | throw, listing the element and its unit — extend the explicit `INLINE_ALLOWLIST` only after inspection |

- [ ] **Step 1: Write failing tests** — the phrase-grep test is the heart:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { normalizeUnit } from '../src/normalize.mjs';

const el = s => new DOMParser().parseFromString(s, 'text/xml').documentElement;
const opts = { year: '2025', cdnKey: 'volume1' };
const unit = node => ({ node, kind: 'clause', id: 'T1', title: 'T' });

test('xrefs inline as plain prose — phrase grep works across the boundary', () => {
  const n = el(`<clause><title>T</title><subclause><num>1</num><p>A ceiling is deemed to have a <xref type="abcb-glossentry">resistance to the incipient spread of fire</xref> to the space above itself if—</p></subclause></clause>`);
  const { bodyMd, definedTerms } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /deemed to have a resistance to the incipient spread of fire to the space above itself/);
  assert.deepEqual(definedTerms, ['resistance to the incipient spread of fire']);
  assert.ok(!bodyMd.split('\n').some(l => /deemed to have a\s*$/.test(l)), 'no line break at xref boundary');
});

test('subclause numbering and alpha-default lists', () => {
  const n = el(`<clause><title>T</title><subclause><num>1</num><p>Intro—</p>
    <ol><li><p>first;</p></li><li><p>second.</p><ol><li><p>inner.</p></li></ol></li></ol></subclause></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /\*\*\(1\)\*\* Intro—/);
  assert.match(bodyMd, /^\(a\) first;/m);
  assert.match(bodyMd, /^  \(a\) inner\./m, 'nested list indents and restarts');
});

test('explicit numbered list style honored', () => {
  const n = el(`<clause><title>T</title><ol class="numbered"><li><p>one</p></li></ol></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^\(1\) one/m);
});

test('img becomes CDN figure link and is recorded', () => {
  const n = el(`<clause><title>T</title><p>See figure.</p><img src="image-A2G1-ncc-compliance-structure.svg"/></clause>`);
  const { bodyMd, figures } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /!\[[^\]]*\]\(https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/volume1\/image-A2G1-ncc-compliance-structure\.svg\)/);
  assert.deepEqual(figures, ['image-A2G1-ncc-compliance-structure.svg']);
});

test('tables render as GFM with flattened cells', () => {
  const n = el(`<clause><title>T</title><table><tr><th>FRL</th><th>Min</th></tr><tr><td>90/90/90</td><td>Yes\n really</td></tr></table></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /\| FRL \| Min \|/);
  assert.match(bodyMd, /\| 90\/90\/90 \| Yes really \|/);
});

test('unknown inline element throws with unit identity', () => {
  const n = el(`<clause><title>T</title><p>x <wat>y</wat></p></clause>`);
  assert.throws(() => normalizeUnit(unit(n), opts), /wat.*T1/s);
});

test('paragraphs are single lines (never hard-wrapped)', () => {
  const long = 'word '.repeat(120).trim();
  const n = el(`<clause><title>T</title><p>${long}</p></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.ok(bodyMd.split('\n').includes(long));
});
```

- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement `normalize.mjs`.** Structure: a recursive `renderBlock(node, state)` for block-level elements (p, subclause, ol, table, table-reference, callout, img, math) and `renderInline(node, state)` for text/inline (xref, b, i, sup, sub, text nodes). `state` carries `{ definedTerms:Set, figures:[], warnings:[], listDepth, listStyle }`. Every text emission collapses internal whitespace (`/\s+/g → ' '`) so single-line DITA never leaks layout newlines into prose. Blocks join with `\n\n`; list items with `\n`. Inline allowlist starts as `xref, b, strong, i, em, sup, sub, sptc, num, title` and grows only via corpus runs. The 2022/2025 element-name differences (both use `p`, `ol`, `li`, `table`) are handled by tag name, not edition branches; `img` (2025) and `image-reference` (2022, resolved by Task 10 into an `img`-equivalent before normalize) converge on the same figure rule.
- [ ] **Step 4: Tests pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat: normalizer — inline xrefs, single-line prose, GFM tables, CDN figures"`

---

### Task 5: emit.mjs — identity, frontmatter, file body

**Files:**
- Create: `tools/src/emit.mjs`
- Test: `tools/test/emit.test.mjs`

**Interfaces:**
- Consumes: `RawUnit` + `normalizeUnit` output + `{ citationPrefix, webUrl }`.
- Produces:
  ```js
  export function slugify(s)                    // ascii slug; '' when nothing survives
  export function unitFilename(unit)            // e.g. 'a5g7-resistance-to-the-incipient-spread-of-fire.md'
  export function emitUnit(unit, normalized, { citationPrefix, webUrl }) // -> { relPath, content }
  ```
  `relPath` is corpus-relative: `2025/volume-one/a5g7-….md`, glossary → `2025/glossary/….md` (Tasks 13–14 may re-route glossary per dedupe decision — emit takes a `glossaryDir` option, default `'glossary'`).

**Identity rules (from spec + ⊕ traps):**
- clause: `{id lower}{-state lower}?-{slug(title)}.md`; slug capped at 60 chars on a word boundary.
- glossary: `{slug(term)}.md`; if slug is `''` **or** term contains non-ASCII → `{slug || 'term'}-{sha1(term) first 8 hex}.md` (⊕ trap 2). Variation: `-{state lower}` before `.md`.
- page: `page-{slug(title)}.md`; overview units (part/section/spec/schedule intro prose, emitted as `kind:'page'` with container context): `{containerKind map: part→part, specification→spec, schedule-part→schedule}-{num lower}{-state lower}?-{slug}.md` (⊕ trap 1: state threads into container filenames).
- Citation: `{citationPrefix} {id}` for clauses (state variations append ` ({STATE})`); pages: `{citationPrefix} {title}`; glossary: `{citationPrefix} Glossary: {term}` — with year-correct prefix (2022 uses `NCC 2022 V1` etc.).
- Frontmatter: fixed key order per Global Constraints; YAML strings quoted only when needed (colon, leading digit, quote); `defined_terms` as block list; `edition` always quoted (`"2025"`).
- H1: `# {id} — {title}` (clauses), `# {title}` (pages), `# {term}` (glossary). Body follows after one blank line. File ends with exactly one `\n`.

- [ ] **Step 1: Write failing tests:**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, unitFilename, emitUnit } from '../src/emit.mjs';

test('slugify basics + cap', () => {
  assert.equal(slugify('Resistance to the incipient spread of fire'), 'resistance-to-the-incipient-spread-of-fire');
  assert.equal(slugify('Fire-resistance of building elements!'), 'fire-resistance-of-building-elements');
  assert.equal(slugify('≥'), '');
});

test('glossary hash fallback for symbol and non-ascii terms (⊕ trap 2)', () => {
  const f1 = unitFilename({ kind: 'glossary', term: '≥', state: null });
  const f2 = unitFilename({ kind: 'glossary', term: '≤', state: null });
  assert.notEqual(f1, f2, 'symbol terms must not collide');
  assert.match(f1, /^term-[0-9a-f]{8}\.md$/);
  const um = unitFilename({ kind: 'glossary', term: 'µm', state: null });
  const m = unitFilename({ kind: 'glossary', term: 'm', state: null });
  assert.notEqual(um, m, 'µm must not collide with m');
});

test('state threads into clause AND container filenames (⊕ trap 1)', () => {
  assert.equal(unitFilename({ kind: 'clause', id: 'A5G4', state: 'VIC', title: 'WaterMark scheme' }),
    'a5g4-vic-watermark-scheme.md');
  assert.equal(unitFilename({ kind: 'page', containerKind: 'part', containerNum: 'H6', state: 'NSW', title: 'Energy efficiency' }),
    'part-h6-nsw-energy-efficiency.md');
});

test('emit: frontmatter key order fixes grep -A window; golden file', () => {
  const unit = { edition: '2025', volume: 'volume-one', kind: 'clause', id: 'A5G7', term: null,
    title: 'Resistance to the incipient spread of fire', state: null, supersedes: '2019: A5.6',
    buildingClasses: 'Class 2,Class 3' };
  const normalized = { bodyMd: '**(1)** A ceiling is deemed…', definedTerms: ['Standard Fire Test'], figures: [], warnings: [] };
  const { relPath, content } = emitUnit(unit, normalized,
    { citationPrefix: 'NCC 2025 V1', webUrl: 'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/5-documents-adopted-by-reference' });
  assert.equal(relPath, '2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md');
  const lines = content.split('\n');
  assert.equal(lines[0], '---');
  assert.equal(lines[1], 'clause: A5G7');
  assert.equal(lines[2], 'title: Resistance to the incipient spread of fire');
  assert.equal(lines[3], 'citation: NCC 2025 V1 A5G7');
  assert.match(lines[4], /^web_url: https:/);
  assert.match(content, /\nsupersedes: "2019: A5\.6"\n/);
  assert.match(content, /\n# A5G7 — Resistance to the incipient spread of fire\n/);
  assert.ok(content.endsWith('…\n'));
});
```

- [ ] **Step 2: Run — verify fail.** — **Step 3: Implement** (slugify: lowercase → strip diacritics via NFKD + `[\u0300-\u036f]` removal → `[^a-z0-9]+` → `-` → trim/collapse → 60-char word-boundary cap; sha1 via `node:crypto`). — **Step 4: Tests pass.** — **Step 5: Commit** — `git commit -m "feat: emitter — injective filenames, fixed-order frontmatter, golden test"`

---

### Task 6: weblinks — crawl once, key deterministically

**Files:**
- Create: `tools/src/fetch-weblinks.mjs`, `tools/src/weblinks.mjs`, `tools/data/weblinks-2025.json`, `tools/data/weblinks-2022.json`
- Test: `tools/test/weblinks.test.mjs`

**Interfaces:**
- `fetch-weblinks.mjs` (operator CLI, network): BFS crawl of `https://ncc.abcb.gov.au/editions/{ncc-2022,ncc-2025}/adopted/…` — start at each volume root (`volume-one`, `volume-two`, `volume-three`, `housing-provisions`, and for 2025 `livable-housing-design`), collect `href="/editions/{ed}/adopted/…"` matches (regex on the HTML — link discovery only, no content ingestion), max depth 3, 200 ms delay, dedupe, sort, write `tools/data/weblinks-{ed}.json` as a sorted string array. LHD may 404 — record whatever resolves (v12 shipped LHD without web_urls).
- `weblinks.mjs` (pure):
  ```js
  export function buildLinkIndex(urls)              // -> Map<'{volume}|{sectionTok}|{leadTok}', url>
  export function resolveWebUrl(unit, index)        // -> string | null
  ```
  Keying per `content-model-2025.md` § web_url: a depth-2 page's key is the leading token of its second path segment after stripping an optional `part-` prefix, **scoped to its parent section and volume** (`volume-one|a|a1`); slug-tokens-⊂-title check disambiguates collisions. Clause/glossary units resolve to their container's page URL; unresolved → `null` (build reports counts; clauses must reach 100%, pages/glossary best-effort).

- [ ] **Step 1: Write failing tests** — fixture URL list encoding the measured traps:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLinkIndex, resolveWebUrl } from '../src/weblinks.mjs';

const urls = [
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/part-a5-documentation-of-design-and-construction',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/1-fire-resistance-building-elements',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/housing-provisions/5-new-south-wales/31-scope-and-application-section-3',
];
test('keys are per-section — specification "1" and part "a5" both resolve', () => {
  const idx = buildLinkIndex(urls);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' }, idx), urls[1]);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-one', sectionNum: 'A', containerKind: 'specification', containerNum: '1' }, idx), urls[2]);
});
test('unresolved returns null, never throws', () => {
  const idx = buildLinkIndex(urls);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-two', sectionNum: 'B', containerKind: 'part', containerNum: 'B9' }, idx), null);
});
```

- [ ] **Step 2: fail → implement → pass.**
- [ ] **Step 3: Run the crawler for both editions** — `npm run fetch-weblinks`. Sanity: `node -e` count per file — expect several hundred URLs for 2025 (the content-model doc measured 665 in the v12 link file) and a comparable count for 2022. If the 2022 edition pages 404 entirely, stop and surface — do not ship 2022 without resolving the URL scheme (spec open item 2).
- [ ] **Step 4: Commit** — `git add tools/ && git commit -m "feat: weblinks — one-shot crawl, per-section deterministic keying"`

---

### Task 7: build.mjs + index.mjs + acceptance suite

**Files:**
- Create: `tools/src/build.mjs`, `tools/src/index.mjs`
- Test: `tools/test/acceptance.test.mjs`

**Interfaces:**
- `node tools/src/build.mjs [--edition 2025|2022] [--sections A,C] [--volumes volume-one,...]` → regenerates the selected slice of `corpus/` (deletes + rewrites only the directories it owns this run), prints a report: units by kind/volume, unit counts by parent (parity), unresolved web_urls, normalize warnings, figure count.
- Global assertions (throw): duplicate relPath; clause unit with `web_url: null`; any normalize error.
- `index.mjs`: `buildIndexes(unitsByEdition) -> [{relPath, content}]` — root `corpus/INDEX.md` (tree, counts, source release, amendment note placeholder filled in Task 9) + per-edition `INDEX.md` (`{id or term} → {path} — {title}`, sorted).
- Acceptance suite (auto-skip per edition until its corpus dir exists):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const editions = ['2022', '2025'].filter(e => fs.existsSync(`corpus/${e}`));
const files = ed => walk(`corpus/${ed}`).filter(f => f.endsWith('.md') && !f.endsWith('INDEX.md'));
function walk(d) { return fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
const read = f => fs.readFileSync(f, 'utf8');

for (const ed of editions) {
  test(`[${ed}] #1 clause-ID glob is exact`, () => {
    const hits = files(ed).filter(f => path.basename(f).startsWith(ed === '2022' ? 'c2d2-' : 'c2d2-'));
    if (fs.existsSync(`corpus/${ed}/volume-one`)) assert.equal(hits.length >= 1, true);
  });
  test(`[${ed}] #2 phrase grep across former xref boundary (THE defect)`, () => {
    const hit = files(ed).some(f => read(f).includes('resistance to the incipient spread of fire to the space above'));
    assert.ok(hit, 'A5G7 phrase must match on one line');
  });
  test(`[${ed}] #3 standard references greppable`, () => {
    assert.ok(files(ed).some(f => read(f).includes('AS 1530.4')));
  });
  test(`[${ed}] #4 figure links live in the citing file`, () => {
    for (const f of files(ed)) {
      const c = read(f);
      for (const m of c.matchAll(/see Figure ([A-Za-z0-9.]+)/gi)) {
        const ok = c.includes(`![Figure ${m[1]}`) || c.includes(`# Figure ${m[1]}`) || c.match(new RegExp(`!\\[[^\\]]*${m[1].replace('.', '\\.')}`));
        assert.ok(ok, `${f}: cites Figure ${m[1]} without carrying it`);
      }
    }
  });
  test(`[${ed}] #5 grep -A window self-citing: citation+web_url in first 6 lines`, () => {
    for (const f of files(ed)) {
      const head = read(f).split('\n').slice(0, 7).join('\n');
      assert.match(head, /citation: /, f);
      if (/^clause: /m.test(head)) assert.match(head, /web_url: /, f);
    }
  });
  test(`[${ed}] #6 every file readable whole (≤128KB), report top sizes`, () => {
    const big = files(ed).map(f => [f, fs.statSync(f).size]).filter(([, s]) => s > 128 * 1024);
    assert.deepEqual(big, []);
  });
}
```

- [ ] **Step 1: Write acceptance suite (skips green — no corpus yet).**
- [ ] **Step 2: Implement `index.mjs` with a unit test** (fixture units → INDEX lines sorted, deterministic).
- [ ] **Step 3: Implement `build.mjs`** wiring: `fetchAll` (cache) → per document `readDocument*` → `normalizeUnit` → `resolveWebUrl` → `emitUnit` → uniqueness assert → write files (LF) → indexes → report. `--sections`/`--volumes`/`--edition` filter which document dirs are rebuilt.
- [ ] **Step 4: `npm test` green (acceptance skipping), commit** — `git commit -m "feat: build orchestration, indexes, executable acceptance gate"`

---

### Task 8: Pilot — 2025 Volume One, Sections A + C

- [ ] **Step 1:** `npm run build -- --edition 2025 --volumes volume-one --sections A,C`
- [ ] **Step 2:** Fix everything the fail-loud walker/normalizer surfaces (unknown elements → inspect against XSD → extend allowlists; each addition gets a one-line comment saying what the element is). Re-run until the build completes with a clean report.
- [ ] **Step 3:** `npm test` — 2025 acceptance tests now RUN (not skip) and must pass. The phrase test (#2) failing means xref inlining is wrong — that is the defect this repo exists to fix; do not weaken the test.
- [ ] **Step 4:** Eyeball three files against ncc.abcb.gov.au: `a5g7-*`, `a5g4-vic-*`, one Section C clause with a table. Confirm content parity and that `web_url` opens the right page.
- [ ] **Step 5: Commit** — `git add corpus/ && git commit -m "feat(corpus): pilot slice — NCC 2025 vol-one sections A+C"` and push.

---

### Task 9: content-model-2022.md — measure, then write

**Files:**
- Create: `docs/content-model-2022.md`
- Modify: `README.md` (amendment note), `tools/src/index.mjs` (amendment string constant)

This is a measurement task: every claim in the doc comes from a command run against `.cache/extracted/ncc-2022-*`. Required sections, each with its method shown:

- [ ] **Step 1: Root-element census** — for all four packages: root tag × `outputclass` counts across every `XMLs/*.xml` (DOM parse root only). Known so far: `clause/ncc-clause`, `specification`, `part/ncc-part`, `standard-part`; the census completes the list (expect glossary/page/image-reference roots).
- [ ] **Step 2: Package-overlap table** — reproduce and commit the measured numbers: 3,973 distinct filenames; 2,387 in all four (615 byte-identical); 1,447 unique (480/190/274/503). Per-kind overlap: which kinds are shared (glossary? images?) vs volume-specific.
- [ ] **Step 3: Identity + context rules** — sptc coverage (which files have `<sptc>`, format by volume: `A5G7` vs HP `10.2.8` vs spec `S1C1`); derivation rule for section/part from sptc (`/^([A-Z])(\d+)/` for volumes; `/^(\d+)\.(\d+)/` for HP); `<archive-num>` coverage; state-variation encoding in 2022 (filename suffixes like `-NSW.xml` — census the suffix convention against in-file state markers).
- [ ] **Step 4: Figure join** — pick 5 clauses containing `<image-reference conref=…>`; locate their wrapper image-reference files; document the join key (conref path ↔ wrapper file identity ↔ `<image href>` SVG name ↔ `Images/` filename). Verify all 5 resolve; state the rule.
- [ ] **Step 5: Glossary shape** — root element of term files, term source element, count per package, byte-identity across packages (the 2022 analog of the 2025 dedupe question).
- [ ] **Step 6: Amendment state** — `grep -l "all-gender" .cache/extracted/ncc-2022-volume-one/XMLs/*.xml | wc -l` (F4D4 all-gender provisions entered at Amendment 2). Non-zero ⇒ record "NCC 2022 Amendment 2" in README + `corpus/INDEX.md` constant; zero ⇒ investigate which amendment before proceeding (check for `livable housing` adoption markers, `H8` section presence in vol-two).
- [ ] **Step 7: Write the doc** in the same style as `content-model-2025.md` (traps → consequences for the reader), commit — `git commit -m "docs: measured 2022 content model — roots, overlap, identity, figure join, amendment"`

---

### Task 10: read-2022.mjs

**Files:**
- Create: `tools/src/read-2022.mjs`
- Test: `tools/test/read-2022.test.mjs`

**Interfaces:**
- ```js
  export const DOCUMENTS_2022 = [
    { key: 'volume-one',         pkg: 'ncc-2022-volume-one',         cdnKey: 'volume1', citationPrefix: 'NCC 2022 V1', volumeLabel: 'Volume One' },
    { key: 'volume-two',         pkg: 'ncc-2022-volume-two',         cdnKey: 'volume2', citationPrefix: 'NCC 2022 V2', volumeLabel: 'Volume Two' },
    { key: 'volume-three',       pkg: 'ncc-2022-volume-three',       cdnKey: 'volume3', citationPrefix: 'NCC 2022 V3', volumeLabel: 'Volume Three' },
    { key: 'housing-provisions', pkg: 'ncc-2022-housing-provisions', cdnKey: 'housing', citationPrefix: 'NCC 2022 HP', volumeLabel: 'Housing Provisions' },
  ];
  export function readPackage2022(pkgDir, doc, { sections = null } = {}) // -> RawUnit[] (same shape as 2025)
  ```
- Reads every `XMLs/*.xml` in sorted order; routes by root element per the Task 9 census; resolves `image-reference` conrefs to an `img`-equivalent node (or records the SVG name on the unit) using the Task 9 join rule; derives `sectionNum`/`containerNum` from sptc patterns; state from the measured convention (filename suffix and/or in-file marker — whichever Task 9 proved authoritative, with the other asserted consistent, fail-loud on disagreement).

- [ ] **Step 1: Failing tests** — fixtures: a real-shape clause file (A5G7 with archive-num + glossary xrefs), a specification root, a state-variation file, an image-reference wrapper + citing clause pair (join resolves to the SVG name); integration parity: per-package totals against Task 9's census, `A5G7` present with `supersedes: '2019: A5.6'`, and the glossary count matches Task 9.
- [ ] **Step 2: fail → implement → pass.** Reuse `normalize.mjs` unchanged — if 2022 markup surfaces new inline elements, extend the shared allowlist with comments; the 2025 corpus rebuild in CI proves no regression.
- [ ] **Step 3: Commit** — `git commit -m "feat: 2022 reader — per-file DITA, census-driven routing, figure join"`

---

### Task 11: Pilot — 2022 Volume One, Sections A + C — then GATE

- [ ] **Step 1:** `npm run build -- --edition 2022 --volumes volume-one --sections A,C`; fix fail-louds as in Task 8.
- [ ] **Step 2:** `npm test` — acceptance now runs for BOTH editions; all green. #2 must pass on the 2022 A5G7 file too.
- [ ] **Step 3:** Cross-edition check: open `corpus/2022/volume-one/a5g7-*` and `corpus/2025/volume-one/a5g7-*` side by side — same format, correct per-edition citations/web_urls.
- [ ] **Step 4: Commit + push** — `git commit -m "feat(corpus): pilot slice — NCC 2022 vol-one sections A+C"`
- [ ] **Step 5: GATE — STOP. Human review.** Present the pilot to the owner: 3–4 sample files, the acceptance run output, the build report. **The format is locked on their approval; do not start Tasks 12+ without it.** Format changes after this point regenerate everything.

---

### Task 12: sync-figures.mjs — verify + upload CDN assets

**Files:**
- Create: `tools/src/sync-figures.mjs`

**Interfaces:**
- `node tools/src/sync-figures.mjs [--upload]` — scans `corpus/**/*.md` for `https://cdn.aecassistant.com.au/images/ncc/...` links; HEADs each distinct URL (10 concurrent); prints present/missing counts and writes `.cache/figures-missing.json` (url → local source path in `.cache/extracted/{pkg}/{images|Images}/{filename}`). With `--upload`: for each missing object, shell `npx -y wrangler r2 object put aecassistant-cdn/<key> --file <local> --remote` (key = URL path after the host). Requires `CLOUDFLARE_API_TOKEN` in env — **operator step, run by the owner; not CI**.

- [ ] **Step 1:** Implement (no unit tests beyond a URL→key mapping test; this is an operator CLI whose verification is the re-run itself).
- [ ] **Step 2:** Run check mode on the pilot corpus. Expected: 2025 figures ~100% present (v12 synced them); 2022 figures ~0% (new `/images/ncc/2022/...` scheme).
- [ ] **Step 3 (operator):** Owner runs `--upload` with `CLOUDFLARE_API_TOKEN` set. Re-run check → 100% present. Any figure whose local source is missing from the zips → listed and investigated, never skipped silently.
- [ ] **Step 4: Commit** — `git commit -m "feat: figure CDN verification and wrangler-backed sync"`

---

### Task 13: Bulk 2025 — all five documents

- [ ] **Step 1: Glossary dedupe decision (spec open item 4)** — script inline (in the task, not committed): extract each package's glossary entries as `(term → normalized bodyMd)` maps; compare across volume-one/two/three/housing-provisions. **If identical:** emit once to `corpus/2025/glossary/`. **If not:** emit the union to `corpus/2025/glossary/`, entries that differ get one file per variant body with a `sources: [volume-one, …]` frontmatter list-key appended after `volume`; record the finding in `content-model-2025.md`. Livable-housing has no glossary (measured).
- [ ] **Step 2:** `npm run build -- --edition 2025` (full). Fix new fail-louds (Sections B–J, specifications, schedules will surface allowlist gaps). Parity: build report's by-parent counts must equal `content-model-2025.md`'s re-measured table exactly — any delta is data loss; find it, don't tolerance it.
- [ ] **Step 3:** `npm test` all green (acceptance now covers the full 2025 corpus — #4 and #5 are corpus-wide invariants).
- [ ] **Step 4:** `sync-figures` check → operator upload for any new figures → 100%.
- [ ] **Step 5: Commit + push** — `git commit -m "feat(corpus): NCC 2025 complete — five documents"`

---

### Task 14: Bulk 2022 — all four packages

- [ ] **Step 1:** Apply the same glossary policy measured in Task 9 Step 5 (identical → `corpus/2022/glossary/`; else union with `sources:`).
- [ ] **Step 2:** `npm run build -- --edition 2022` (full). Parity against Task 9's census per package. The 2,387-shared-filename overlap lands as per-volume files (each package emits under its own volume dir) — byte-identical duplicates across volume dirs are correct and expected (mirrors the NCC's own publication structure).
- [ ] **Step 3:** `npm test` all green; `sync-figures` → 100%.
- [ ] **Step 4:** Sanity totals in `corpus/INDEX.md` (counts per directory, source release `ncc-2026-07`, amendment note from Task 9).
- [ ] **Step 5: Commit + push** — `git commit -m "feat(corpus): NCC 2022 complete — four packages"`

---

### Task 15: AGENTS.md, README final, CI drift guard

**Files:**
- Create: `AGENTS.md` — full content:

```markdown
# Searching this corpus

Everything searchable lives under `corpus/`. It is generated — never edit it; two editions of
the National Construction Code, both in force in Australia. The applicable edition follows the
project's permit application lodgement date. `corpus/2022/` = NCC 2022; `corpus/2025/` = NCC 2025.

## Lookups

- **By clause ID** — filenames lead with the lowercased clause designation:
  `glob corpus/2025/**/c2d2-*` → the clause file. State variations carry the state after the
  ID: `a5g4-vic-*`. Housing Provisions clauses are decimal: `corpus/2022/housing-provisions/11.2.2-*`.
- **By phrase** — prose is one paragraph per line and glossary terms are inlined, so exact
  phrase grep works: `grep -rn "resistance to the incipient spread of fire to the space" corpus/2025/`.
- **By referenced standard** — `grep -rl "AS 1530.4" corpus/2025/` lists every citing clause.
- **By defined term** — `grep -rl "defined_terms:" -A20 …` or grep the term directly; glossary
  definitions live in `corpus/{edition}/glossary/`.
- **Browse** — `corpus/INDEX.md` (tree + counts) and `corpus/{edition}/INDEX.md` (clause → path).

## Reading a hit

Every file is self-citing: frontmatter carries `citation:` (quote this in answers) and
`web_url:` (the authoritative page) within the first six lines — `grep -A6` on a clause ID
returns both. Figures appear as image links inline in the clause that cites them.

## Cautions

- Always confirm which edition the question needs before citing; do not mix editions in one answer.
- `jurisdiction:` other than `aus` means a state variation — check whether it applies before
  relying on it, and check whether a state variation exists for any national clause you cite.
- MathML formulas are flattened to text; consult `web_url` for complex formulas.
- Do not search outside `corpus/` (tooling and docs live there).
```

- Modify: `.github/workflows/ci.yml` — append after `npm test`:

```yaml
      - uses: actions/cache@v4
        with: { path: .cache/zips, key: ncc-zips-${{ hashFiles('tools/checksums.json') }} }
      - run: npm run fetch
      - run: npm run build
      - run: git diff --exit-code -- corpus/
```

- [ ] **Step 1:** Write both; also add the corpus counts + amendment note to README's Layout section (two sentences).
- [ ] **Step 2:** Full local rerun: `npm run fetch && npm run build && npm test && git diff --exit-code -- corpus/` → clean.
- [ ] **Step 3: Commit + push; watch CI green** — `git commit -m "docs: agent search contract; ci: regeneration drift guard"`

---

### Task 16: Managed Agents live verification (operator)

**Files:**
- Create: `tools/src/verify-agent.mjs`

Spec build-order step 5: a real Managed Agents session mounts the repo and runs the acceptance greps. Requires `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` (fine-grained PAT, Contents: Read on `vove-ai/aec-assistant-ncc-data`) in env. Raw HTTP (no SDK dep), beta header `anthropic-beta: managed-agents-2026-04-01`:

- [ ] **Step 1: Implement** — the script: ① `POST /v1/environments` `{name:'ncc-corpus-verify', config:{type:'cloud', networking:{type:'unrestricted'}}}` (reuse by name if listed); ② `POST /v1/agents` `{name:'ncc-corpus-verify', model:'claude-sonnet-5', tools:[{type:'agent_toolset_20260401'}]}` — created once, ID cached in `.cache/verify-agent.json`; ③ `POST /v1/sessions` with `resources:[{type:'github_repository', url:'https://github.com/vove-ai/aec-assistant-ncc-data', authorization_token: env.GITHUB_TOKEN, checkout:{type:'branch', name:'main'}}]` and `initial_events` carrying one user message: *"In /workspace/aec-assistant-ncc-data run exactly: (1) `ls corpus/2022 corpus/2025 | head -30`; (2) `grep -rln 'resistance to the incipient spread of fire to the space' corpus/ | head`; (3) `grep -rl 'AS 1530.4' corpus/2025 | wc -l`; (4) glob for corpus/2025/volume-one/a5g4-vic-*. Report raw outputs, then quote the `citation:` line of one file from (2)."*; ④ poll `GET /v1/sessions/{id}/events` until `session.status_idle` with `stop_reason.type !== 'requires_action'` (30 s interval, 15 min cap); ⑤ print the final `agent.message` text; ⑥ `POST /v1/sessions/{id}/archive`. Print the Console trace URL (`https://platform.claude.com/workspaces/{workspace}/sessions/{id}`) right after create.
- [ ] **Step 2 (operator):** Owner runs it. PASS = phrase grep returns both editions' `a5g7` files, the AS 1530.4 count is > 50, the VIC variation globs, and the quoted citation reads `NCC 2025 V1 A5G7` (or 2022 equivalent).
- [ ] **Step 3:** Record the run's outputs in the task notes; commit the script — `git commit -m "feat: managed-agents live verification harness"`. Project complete.

---

## Self-review notes (performed at plan time)

- **Spec coverage:** layout→T1; sourcing/checksums→T2; readers→T3/T10; format contract→T4/T5; web_url→T6; INDEX/AGENTS→T7/T15; acceptance 6 tests→T7 (run in T8/11/13/14); pilot-then-gate→T8/T11; open items 1→T12, 2→T6, 3→T9, 4→T13, 5→T9; licensing/README→T1/T15; CI drift→T1/T15; MA verification→T16. Deviations from spec, both deliberate: `zip.mjs` added (zero-dep extraction); `building_classes_excluded` frontmatter key added (source carries it; renamed from `building_classes` by owner ruling at the T11 gate) — both noted in Global Constraints.
- **Type consistency:** `RawUnit` defined in T3, consumed by T4/T5/T7/T10 with identical field names; `DOCUMENTS_*` descriptors carry `cdnKey`/`citationPrefix` used by T4/T5; `extractZip`/`fetchAll`/`verifySha256`/`normalizeUnit`/`slugify`/`unitFilename`/`emitUnit`/`buildLinkIndex`/`resolveWebUrl` names match across tasks.
- **Placeholders:** none — all constants (checksums, prefixes, CDN keys, URLs, counts) are measured values; the two deliberately deferred numbers (exact vol-one clause total in T3; 2022 census in T9) are *measurement outputs* with the measuring step specified.
