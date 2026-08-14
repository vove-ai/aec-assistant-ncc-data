import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUCKET, USER_AGENT,
  parseFigureUrl, assertFigureKey, collectFigureUrls, contentTypeFor, figurePackages,
  resolveLocalSource, buildMissingReport, imageListing, uploadArgs, uploadAll, headCheck, parseArgs,
} from '../src/sync-figures.mjs';

const U = 'https://cdn.aecassistant.com.au/images/ncc';

/* ---------------------------------------------------------------------------
 * URL -> R2 key. The key is the DECODED path: a custom-domain request decodes
 * before the object lookup, so an encoded key can never be reached by its URL.
 * ------------------------------------------------------------------------ */

test('parseFigureUrl splits a plain figure URL into edition, volume, filename and key', () => {
  const f = parseFigureUrl(`${U}/2022/volume1/image-A2G1-ncc-compliance-structure.svg`);
  assert.equal(f.year, '2022');
  assert.equal(f.cdnKey, 'volume1');
  assert.equal(f.filename, 'image-A2G1-ncc-compliance-structure.svg');
  assert.equal(f.key, 'images/ncc/2022/volume1/image-A2G1-ncc-compliance-structure.svg');
});

test('parseFigureUrl decodes %20 in the key — the live object carries a real space', () => {
  const f = parseFigureUrl(`${U}/2025/volume1/image-cc-by%20NCC%202025.svg`);
  assert.equal(f.filename, 'image-cc-by NCC 2025.svg');
  assert.equal(f.key, 'images/ncc/2025/volume1/image-cc-by NCC 2025.svg');
});

test('parseFigureUrl decodes the %28/%29 normalize.mjs writes for parentheses', () => {
  const f = parseFigureUrl(`${U}/2022/volume1/image-creative-commons-by-nd%20%28OLD%29.svg`);
  assert.equal(f.filename, 'image-creative-commons-by-nd (OLD).svg');
  assert.equal(f.key, 'images/ncc/2022/volume1/image-creative-commons-by-nd (OLD).svg');
});

test('parseFigureUrl never leaves a percent escape in the key', () => {
  for (const url of [`${U}/2025/volume1/image-cc-by%20NCC%202025.svg`,
    `${U}/2022/volume1/image-creative-commons-by-nd%20%28OLD%29.svg`]) {
    assert.ok(!parseFigureUrl(url).key.includes('%'), url);
  }
});

test('parseFigureUrl covers every volume both readers ship', () => {
  for (const [slot] of figurePackages()) {
    const [year, cdnKey] = slot.split('/');
    assert.equal(parseFigureUrl(`${U}/${year}/${cdnKey}/x.svg`).key, `images/ncc/${year}/${cdnKey}/x.svg`);
  }
});

test('parseFigureUrl rejects a foreign host', () => {
  assert.throws(() => parseFigureUrl('https://example.com/images/ncc/2022/volume1/x.svg'), /not on https:\/\/cdn/);
});

test('parseFigureUrl rejects a path that is not images/ncc/{year}/{volume}/{file}', () => {
  assert.throws(() => parseFigureUrl(`${U}/2022/volume1/nested/x.svg`), /is not https/);
  assert.throws(() => parseFigureUrl(`${U}/2022/volume1/`), /is not https/);
  assert.throws(() => parseFigureUrl('https://cdn.aecassistant.com.au/other/2022/volume1/x.svg'), /is not https/);
});

test('parseFigureUrl rejects an unknown edition or volume by name', () => {
  assert.throws(() => parseFigureUrl(`${U}/2019/volume1/x.svg`), /2019\/volume1, which no reader ships/);
  assert.throws(() => parseFigureUrl(`${U}/2022/volume9/x.svg`), /2022\/volume9, which no reader ships/);
});

test('parseFigureUrl rejects a query or fragment', () => {
  assert.throws(() => parseFigureUrl(`${U}/2022/volume1/x.svg?v=2`), /query or fragment/);
});

test('parseFigureUrl names the corpus file it came from', () => {
  assert.throws(() => parseFigureUrl(`${U}/2019/v/x.svg`, 'corpus/2022/volume-one/A2G1.md'),
    /corpus\/2022\/volume-one\/A2G1\.md/);
});

/* ---------------------------------------------------------------------------
 * The write guard
 * ------------------------------------------------------------------------ */

test('assertFigureKey accepts a figure key and returns it', () => {
  const k = 'images/ncc/2022/volume1/image-A2G1-ncc-compliance-structure.svg';
  assert.equal(assertFigureKey(k), k);
});

test('assertFigureKey refuses anything outside images/ncc/{year}/{volume}/{file}', () => {
  for (const bad of [
    'images/ncc/2022/volume1/nested/x.svg',
    'images/ncc/2022/volume1/',
    'images/other/2022/volume1/x.svg',
    'x.svg',
    '/images/ncc/2022/volume1/x.svg',
  ]) assert.throws(() => assertFigureKey(bad), /refusing to write/, bad);
});

test('assertFigureKey refuses a key for an edition/volume no reader ships', () => {
  assert.throws(() => assertFigureKey('images/ncc/2019/volume1/x.svg'), /not a known edition\/volume/);
});

/* ---------------------------------------------------------------------------
 * Corpus scan
 * ------------------------------------------------------------------------ */

test('collectFigureUrls finds markdown image links and dedupes across files, sorted', () => {
  const files = [
    { path: 'corpus/2022/volume-one/B.md', text: `![Figure 2](${U}/2022/volume1/b.svg)` },
    { path: 'corpus/2022/volume-one/A.md', text: `![Figure 1](${U}/2022/volume1/a.svg)\n![again](${U}/2022/volume1/b.svg)` },
  ];
  const figs = collectFigureUrls(files);
  assert.deepEqual(figs.map(f => f.filename), ['a.svg', 'b.svg']);
  assert.deepEqual(figs[1].referencedBy, ['corpus/2022/volume-one/A.md', 'corpus/2022/volume-one/B.md']);
});

test('collectFigureUrls stops at the closing paren without eating an encoded one', () => {
  const url = `${U}/2022/volume1/image-creative-commons-by-nd%20%28OLD%29.svg`;
  const figs = collectFigureUrls([{ path: 'a.md', text: `![cc](${url}) and trailing prose.` }]);
  assert.equal(figs.length, 1);
  assert.equal(figs[0].url, url);
  assert.equal(figs[0].filename, 'image-creative-commons-by-nd (OLD).svg');
});

test('collectFigureUrls ignores links that are not on the figure CDN', () => {
  const figs = collectFigureUrls([{ path: 'a.md', text: '[NCC](https://ncc.abcb.gov.au/editions/ncc-2022)' }]);
  assert.deepEqual(figs, []);
});

test('collectFigureUrls throws rather than skipping a malformed CDN URL', () => {
  assert.throws(() => collectFigureUrls([{ path: 'corpus/x.md', text: `![b](${U}/2022/volume1/a/b.svg)` }]),
    /corpus\/x\.md/);
});

test('collectFigureUrls is order-independent', () => {
  const a = { path: 'a.md', text: `![](${U}/2022/volume1/z.svg)` };
  const b = { path: 'b.md', text: `![](${U}/2022/volume1/a.svg)` };
  assert.deepEqual(collectFigureUrls([a, b]), collectFigureUrls([b, a]));
});

/* ---------------------------------------------------------------------------
 * Content type
 * ------------------------------------------------------------------------ */

test('contentTypeFor covers every extension the corpus publishes', () => {
  assert.equal(contentTypeFor('a.svg'), 'image/svg+xml');
  assert.equal(contentTypeFor('cover-front-vol1.pdf'), 'application/pdf');
  assert.equal(contentTypeFor('a.PNG'), 'image/png');
  assert.equal(contentTypeFor('a.eps'), 'application/postscript');
});

test('contentTypeFor throws on an unknown extension instead of guessing octet-stream', () => {
  assert.throws(() => contentTypeFor('a.tiff'), /no content type known/);
  assert.throws(() => contentTypeFor('noextension'), /no content type known/);
});

/* ---------------------------------------------------------------------------
 * URL -> local source. This is where a wrong answer publishes the wrong image
 * under a correct-looking key, so every branch is pinned.
 * ------------------------------------------------------------------------ */

const listing = names => ({ dir: '.cache/extracted/pkg/Images', names });
const fig = (filename, year = '2022', cdnKey = 'volume1') => ({ filename, year, cdnKey });

test('resolveLocalSource takes the byte-exact filename when it is on disk', () => {
  const r = resolveLocalSource(fig('image-A2G1-x.svg'), listing(['image-A2G1-x.svg', 'other.svg']));
  assert.equal(r.match, 'exact');
  assert.equal(r.localPath, '.cache/extracted/pkg/Images/image-A2G1-x.svg');
});

test('resolveLocalSource keeps a name that differs only in case out of the exact bucket', () => {
  // Windows would answer this yes via existsSync and a Linux runner would then 404.
  const r = resolveLocalSource(fig('image-A2G1-X.svg'), listing(['image-a2g1-x.svg']));
  assert.equal(r.match, 'folded');
  assert.equal(r.localPath, '.cache/extracted/pkg/Images/image-a2g1-x.svg');
});

test('resolveLocalSource folds . - _ and space, as the §6 join does', () => {
  const r = resolveLocalSource(
    fig('image-13-2-5b-measurement-of-a-projection-NT.eps'),
    listing(['image-13.2.5b-measurement-of-a-projection-NT.eps']),
  );
  assert.equal(r.match, 'folded');
  assert.match(r.note, /on disk as/);
});

test('resolveLocalSource will NOT fold across extensions — a .png must never publish as .svg', () => {
  const r = resolveLocalSource(fig('image-S46C2-fan-performance.svg'), listing(['image-S46C2-fan-performance.png']));
  assert.equal(r.match, 'unresolved');
  assert.match(r.reason, /share the folded stem but not the/);
  assert.deepEqual(r.candidates, ['image-S46C2-fan-performance.png']);
});

test('resolveLocalSource refuses to pick between two files that fold to the same name', () => {
  const r = resolveLocalSource(fig('image-cc-by NCC 2025.svg'), listing(['image-cc-by-NCC-2025.svg', 'image-cc.by.NCC.2025.svg']));
  assert.equal(r.match, 'unresolved');
  assert.match(r.reason, /codepoint order alone/);
  assert.deepEqual(r.candidates, ['image-cc-by-NCC-2025.svg', 'image-cc.by.NCC.2025.svg']);
});

test('resolveLocalSource reports a name with nothing like it on disk, with no candidates', () => {
  const r = resolveLocalSource(fig('image-missing.svg'), listing(['image-other.svg']));
  assert.equal(r.match, 'unresolved');
  assert.deepEqual(r.candidates, []);
  assert.match(r.reason, /none folds to it/);
});

test('resolveLocalSource says the package is not extracted rather than "not found"', () => {
  const r = resolveLocalSource(fig('x.svg'), { dir: '.cache/extracted/pkg/Images', absent: true });
  assert.equal(r.match, 'unresolved');
  assert.match(r.reason, /npm run fetch/);
});

/* ---------------------------------------------------------------------------
 * The report
 * ------------------------------------------------------------------------ */

function reportFixture() {
  const listings = new Map([
    ['2022/volume1', listing(['a.svg', 'cover-front-vol1.pdf'])],
    ['2025/volume1', listing(['gone.svg'])],
  ]);
  const missing = [
    { url: `${U}/2025/volume1/absent.svg`, key: 'images/ncc/2025/volume1/absent.svg', year: '2025', cdnKey: 'volume1', filename: 'absent.svg', referencedBy: ['corpus/b.md', 'corpus/a.md'] },
    { url: `${U}/2022/volume1/a.svg`, key: 'images/ncc/2022/volume1/a.svg', year: '2022', cdnKey: 'volume1', filename: 'a.svg', referencedBy: ['corpus/a.md'] },
    { url: `${U}/2022/volume1/cover-front-vol1.pdf`, key: 'images/ncc/2022/volume1/cover-front-vol1.pdf', year: '2022', cdnKey: 'volume1', filename: 'cover-front-vol1.pdf', referencedBy: ['corpus/c.md'] },
  ];
  return { missing, listings };
}

test('buildMissingReport splits uploadable from unresolved and carries the content type', () => {
  const { missing, listings } = reportFixture();
  const r = buildMissingReport(missing, listings);
  assert.deepEqual(r.upload.map(u => u.key), [
    'images/ncc/2022/volume1/a.svg',
    'images/ncc/2022/volume1/cover-front-vol1.pdf',
  ]);
  assert.equal(r.upload[1].contentType, 'application/pdf');
  assert.equal(r.upload[0].match, 'exact');
  assert.deepEqual(r.unresolved.map(u => u.key), ['images/ncc/2025/volume1/absent.svg']);
  assert.equal(r.bucket, BUCKET);
});

test('buildMissingReport is deterministic — sorted, and independent of input order', () => {
  const { missing, listings } = reportFixture();
  const a = buildMissingReport(missing, listings);
  const b = buildMissingReport([...missing].reverse(), listings);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.unresolved[0].referencedBy, ['corpus/a.md', 'corpus/b.md']);
});

test('buildMissingReport writes no absolute path and no timestamp', () => {
  const { missing, listings } = reportFixture();
  const json = JSON.stringify(buildMissingReport(missing, listings));
  assert.ok(!/[A-Za-z]:\\/.test(json), 'a Windows absolute path leaked in');
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(json), 'a timestamp leaked in');
});

/* ---------------------------------------------------------------------------
 * Image directory discovery (2025 ships `images/`, 2022 ships `Images/`)
 * ------------------------------------------------------------------------ */

function tmpCache(dirs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-sync-figures-'));
  for (const [rel, files] of Object.entries(dirs)) {
    const d = path.join(root, 'extracted', ...rel.split('/'));
    fs.mkdirSync(d, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(d, f), 'x');
  }
  return root;
}

test('imageListing finds Images/ and images/ alike, and reports the real spelling in the path', () => {
  const root = tmpCache({ 'pkg-a/Images': ['one.svg'], 'pkg-b/images': ['two.svg'] });
  try {
    const a = imageListing('pkg-a', root);
    const b = imageListing('pkg-b', root);
    assert.deepEqual(a.names, ['one.svg']);
    assert.ok(a.dir.endsWith('/extracted/pkg-a/Images'), a.dir);
    assert.deepEqual(b.names, ['two.svg']);
    assert.ok(b.dir.endsWith('/extracted/pkg-b/images'), b.dir);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('imageListing reports an unextracted package as absent rather than throwing', () => {
  const root = tmpCache({ 'pkg-a/Images': [] });
  try {
    assert.equal(imageListing('pkg-missing', root).absent, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/* ---------------------------------------------------------------------------
 * The upload command line
 * ------------------------------------------------------------------------ */

test('uploadArgs keeps a key with spaces and parentheses as ONE argv element', () => {
  const key = 'images/ncc/2022/volume1/image-creative-commons-by-nd (OLD).svg';
  const args = uploadArgs({ key, localPath: '.cache/extracted/p/Images/image-creative-commons-by-nd (OLD).svg', contentType: 'image/svg+xml' });
  assert.equal(args.filter(a => a.includes('(OLD)')).length, 2);
  assert.equal(args[args.indexOf('put') + 1], `${BUCKET}/${key}`);
  assert.equal(args[args.indexOf('--file') + 1], '.cache/extracted/p/Images/image-creative-commons-by-nd (OLD).svg');
});

test('uploadArgs sets the content type and targets remote storage', () => {
  const args = uploadArgs({ key: 'images/ncc/2022/volume1/a.svg', localPath: 'x.svg', contentType: 'image/svg+xml' });
  assert.deepEqual(args.slice(0, 5), ['-y', 'wrangler', 'r2', 'object', 'put']);
  assert.equal(args[args.indexOf('--content-type') + 1], 'image/svg+xml');
  assert.ok(args.includes('--remote'));
});

test('uploadArgs runs the key guard — a bad key never reaches wrangler', () => {
  assert.throws(() => uploadArgs({ key: 'secrets/prod.env', localPath: 'x', contentType: 'text/plain' }), /refusing to write/);
});

test('uploadAll reports each object separately and does not stop at the first failure', async () => {
  const plan = ['a.svg', 'b.svg', 'c.svg'].map(n => ({
    key: `images/ncc/2022/volume1/${n}`, localPath: `.cache/x/${n}`, contentType: 'image/svg+xml',
  }));
  const seen = [];
  const runner = async (_cmd, args) => {
    seen.push(args);
    return args.some(a => a.endsWith('b.svg')) ? { code: 1, out: '', err: 'Authentication error [code: 10000]' } : { code: 0, out: '', err: '' };
  };
  const r = await uploadAll(plan, { runner });
  assert.equal(r.ok, 2);
  assert.deepEqual(r.failed.map(f => f.key), ['images/ncc/2022/volume1/b.svg']);
  assert.match(r.failed[0].err, /Authentication error/);
  assert.equal(seen.length, 3, 'every planned object is attempted');
  for (const args of seen) assert.ok(args.includes('--remote') && args.includes('put'), args.join(' '));
});

/* ---------------------------------------------------------------------------
 * The CDN check
 * ------------------------------------------------------------------------ */

const urlsFor = names => names.map(n => `${U}/2022/volume1/${n}`);

test('headCheck classifies 200 present, 404 missing, and sends a descriptive User-Agent', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers['User-Agent']);
    assert.equal(init.method, 'HEAD');
    return { status: url.endsWith('a.svg') ? 200 : 404 };
  };
  const r = await headCheck(urlsFor(['a.svg', 'b.svg']), { fetchImpl });
  assert.equal(r.get(`${U}/2022/volume1/a.svg`).state, 'present');
  assert.equal(r.get(`${U}/2022/volume1/b.svg`).state, 'missing');
  assert.deepEqual([...new Set(seen)], [USER_AGENT]);
});

test('headCheck retries once before calling an answer indeterminate', async () => {
  let calls = 0;
  const fetchImpl = async () => ({ status: ++calls === 1 ? 503 : 200 });
  const r = await headCheck(urlsFor(['a.svg']), { fetchImpl, retryDelayMs: 0 });
  assert.equal(r.get(`${U}/2022/volume1/a.svg`).state, 'present');
  assert.equal(calls, 2);
});

test('headCheck never folds a 5xx into "missing"', async () => {
  const r = await headCheck(urlsFor(['a.svg']), { fetchImpl: async () => ({ status: 500 }), retryDelayMs: 0 });
  assert.equal(r.get(`${U}/2022/volume1/a.svg`).state, 'error');
});

test('headCheck treats a thrown fetch as indeterminate, not missing', async () => {
  const r = await headCheck(urlsFor(['a.svg']), {
    fetchImpl: async () => { throw new Error('ECONNRESET'); }, retryDelayMs: 0,
  });
  const got = r.get(`${U}/2022/volume1/a.svg`);
  assert.equal(got.state, 'error');
  assert.match(got.detail, /ECONNRESET/);
});

test('headCheck stops rather than hammering a CDN that keeps erroring', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { status: 502 }; };
  await assert.rejects(
    () => headCheck(urlsFor([...Array(60).keys()].map(i => `f${i}.svg`)), { fetchImpl, retryDelayMs: 0, concurrency: 2 }),
    /stopping — 5 URLs gave neither 200 nor 404/,
  );
  assert.ok(calls < 60, `aborted early, made ${calls} calls`);
});

test('headCheck never exceeds its concurrency', async () => {
  let inFlight = 0, peak = 0;
  const fetchImpl = async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise(r => setTimeout(r, 1));
    inFlight--;
    return { status: 404 };
  };
  await headCheck(urlsFor([...Array(40).keys()].map(i => `f${i}.svg`)), { fetchImpl, concurrency: 10 });
  assert.ok(peak <= 10, `peak ${peak}`);
  assert.ok(peak > 1, 'work should actually run in parallel');
});

/* ---------------------------------------------------------------------------
 * CLI arguments
 * ------------------------------------------------------------------------ */

test('parseArgs defaults to the read-only check', () => {
  assert.deepEqual(parseArgs([]), { upload: false, allowFolded: false });
});

test('parseArgs accepts --upload and --allow-folded, and rejects anything else', () => {
  assert.deepEqual(parseArgs(['--upload', '--allow-folded']), { upload: true, allowFolded: true });
  assert.throws(() => parseArgs(['--uplaod']), /unknown argument/);
  assert.throws(() => parseArgs(['--upload=true']), /unknown argument/);
});

/* ---------------------------------------------------------------------------
 * The committed corpus, against the extracted packages on this machine.
 * ------------------------------------------------------------------------ */

test('corpus: every published figure URL resolves to a file that exists on disk', { skip: !fs.existsSync('.cache/extracted') }, () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push({ path: p.split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
    }
  })('corpus');
  const figures = collectFigureUrls(files);
  assert.ok(figures.length > 0, 'the pilot corpus publishes figures');
  const listings = new Map([...figurePackages()].map(([slot, pkg]) => [slot, imageListing(pkg)]));
  const report = buildMissingReport(figures, listings);
  assert.deepEqual(report.unresolved, []);
  for (const u of report.upload) assert.ok(fs.existsSync(u.localPath), u.localPath);
});
