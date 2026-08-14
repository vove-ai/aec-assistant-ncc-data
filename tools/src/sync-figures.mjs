// sync-figures.mjs — verify every figure URL the corpus publishes, and upload the ones that are
// not live yet.
//
// Every figure in the corpus is an inline markdown image pointing at
// `https://cdn.aecassistant.com.au/images/ncc/{year}/{cdnKey}/{filename}`. That URL is how an
// agent sees a figure without leaving the corpus, so a dead one is a visible failure inside an
// answer. This tool answers two questions and nothing else:
//
//   1. which of those URLs are live?                     — HEAD, 10 at a time (check mode)
//   2. for the ones that are not, which local file        — the resolution below
//      should be uploaded?
//
// TWO MODES, DELIBERATELY ASYMMETRIC:
//
//   check (default)  READ-ONLY and safe for anyone to run at any time: HEAD requests plus one
//                    JSON write under `.cache/`. No credentials, no CDN writes, no corpus writes.
//   --upload         Publishes to a PRODUCTION CDN. Refuses without CLOUDFLARE_API_TOKEN, prints
//                    the complete plan before it writes anything, uploads ONLY objects this run
//                    saw return 404, reports every object individually, and exits non-zero if any
//                    single object fails.
//
// THE FAILURE THAT MATTERS is not a missed upload — it is uploading the WRONG file under a
// right-looking key, because that is invisible afterwards: the URL resolves, the answer renders,
// and the figure is simply the wrong figure. Everything in `resolveLocalSource` exists to make
// that impossible:
//
//   * The published filename IS the resolved disk basename. read-2022.mjs writes
//     `src = basename(<the file the §6 five-rule join resolved>)`, and read-2025.mjs carries the
//     package's own `src`. So the join has ALREADY happened at build time and is not invertible
//     from a URL — the honest primary rule here is a byte-exact filename match, not a re-run of
//     the join.
//   * The only fallback is §6's fold, imported from read-2022.mjs rather than re-written, and it
//     must additionally agree on the EXTENSION. §6 rule 1 deliberately takes the extension from
//     disk because it is matching an XML wrapper stem; here both sides are real filenames, and
//     folding the extension away would let a `.png` be published under a `.svg` key.
//   * Two disk files folding to one URL is an error, never a codepoint-order pick.
//   * A fold match never uploads without `--allow-folded`. An exact match is the only thing that
//     publishes unattended.
//
// Determinism: `.cache/figures-missing.json` is a pure function of the corpus and the extracted
// packages — codepoint-sorted throughout, repo-relative POSIX paths, no timestamps, no hostnames,
// no absolute paths, no counts of anything environmental.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCUMENTS_2022, normStem } from './read-2022.mjs';
import { DOCUMENTS_2025 } from './read-2025.mjs';

export const CDN_ORIGIN = 'https://cdn.aecassistant.com.au';
export const CDN_PATH_PREFIX = 'images/ncc';
export const BUCKET = 'aecassistant-cdn';
export const CORPUS_DIR = 'corpus';
export const CACHE_DIR = '.cache';
export const MISSING_JSON = `${CACHE_DIR}/figures-missing.json`;
export const USER_AGENT = 'aec-assistant-ncc-data/sync-figures (corpus figure verification; HEAD only)';

const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const toPosix = p => p.split(path.sep).join('/');

/* ============================================================================
 * The URL model
 * ========================================================================= */

/**
 * `{year}/{cdnKey}` -> the extracted package directory that holds its `Images/`.
 *
 * Built from the two readers' own DOCUMENTS tables rather than restated, so an edition or volume
 * added there cannot be silently unknown here.
 */
export function figurePackages() {
  const out = new Map();
  for (const [year, docs] of [['2022', DOCUMENTS_2022], ['2025', DOCUMENTS_2025]]) {
    for (const d of docs) out.set(`${year}/${d.cdnKey}`, d.pkg);
  }
  return out;
}

/**
 * Every `.svg`/`.pdf`/… extension the corpus actually publishes, mapped to the MIME type the CDN
 * must serve it as. wrangler does NOT infer a content type — an object put without one is served
 * `application/octet-stream`, which makes a browser download an SVG instead of drawing it. The
 * 2025 objects already live were uploaded with `image/svg+xml`, so this also keeps the two
 * generations consistent.
 *
 * An unknown extension throws: guessing `application/octet-stream` would publish a figure that
 * silently never renders.
 */
export const CONTENT_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
  ['.eps', 'application/postscript'],
]);

export function contentTypeFor(filename) {
  const ext = path.posix.extname(String(filename)).toLowerCase();
  const ct = CONTENT_TYPES.get(ext);
  if (!ct) {
    throw new Error(`sync-figures: no content type known for ${JSON.stringify(filename)} `
      + `(extension ${JSON.stringify(ext)}) — add it to CONTENT_TYPES rather than letting the CDN `
      + 'serve it as application/octet-stream, which never renders');
  }
  return ct;
}

/**
 * The R2 key is the URL path after the host, PERCENT-DECODED: a custom-domain request decodes the
 * path before looking the object up, so `image-cc-by%20NCC%202025.svg` is the object
 * `images/ncc/2025/volume1/image-cc-by NCC 2025.svg`. Encoding it would publish a key containing
 * a literal `%20` that the live URL can never reach. (Verified against the live 2025 objects,
 * which carry the space.)
 *
 * @param {string} url
 * @param {string} [where]  the corpus file it was found in, for the error message
 * @returns {{url: string, key: string, year: string, cdnKey: string, filename: string}}
 * @throws on anything under the CDN host that is not a well-formed figure URL. A near-miss is a
 *   corpus defect worth seeing, and skipping it is how a dead figure ships.
 */
export function parseFigureUrl(url, where = '') {
  const at = where ? ` (in ${where})` : '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`sync-figures: ${JSON.stringify(url)} is not a URL${at}`);
  }
  if (`${parsed.protocol}//${parsed.host}` !== CDN_ORIGIN) {
    throw new Error(`sync-figures: ${url} is not on ${CDN_ORIGIN}${at}`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`sync-figures: ${url} carries a query or fragment${at} — a figure URL is a bare object path`);
  }
  const segments = parsed.pathname.split('/').slice(1).map(s => decodeURIComponent(s));
  const [images, ncc, year, cdnKey, filename, ...rest] = segments;
  if (`${images}/${ncc}` !== CDN_PATH_PREFIX || !year || !cdnKey || !filename || rest.length) {
    throw new Error(`sync-figures: ${url}${at} is not ${CDN_ORIGIN}/${CDN_PATH_PREFIX}/{year}/{cdnKey}/{filename}`);
  }
  const packages = figurePackages();
  if (!packages.has(`${year}/${cdnKey}`)) {
    throw new Error(`sync-figures: ${url}${at} names edition/volume ${year}/${cdnKey}, which no reader ships — `
      + `known: ${[...packages.keys()].sort(byCodepoint).join(', ')}`);
  }
  return { url, key: segments.join('/'), year, cdnKey, filename };
}

/**
 * A key may only ever address one figure object. Mirrors the discipline of the sibling repo's
 * `assertDeletableKey`: the guard is cheap, and it is the last thing standing between a
 * mis-parsed URL and a PUT somewhere else in a bucket that also serves the rest of the product.
 */
export function assertFigureKey(key) {
  const k = String(key);
  const parts = k.split('/');
  if (parts.length !== 5 || `${parts[0]}/${parts[1]}` !== CDN_PATH_PREFIX || !parts[4]) {
    throw new Error(`sync-figures: refusing to write ${JSON.stringify(k)} — not a ${CDN_PATH_PREFIX}/{year}/{cdnKey}/{file} key`);
  }
  if (!figurePackages().has(`${parts[2]}/${parts[3]}`)) {
    throw new Error(`sync-figures: refusing to write ${JSON.stringify(k)} — ${parts[2]}/${parts[3]} is not a known edition/volume`);
  }
  return k;
}

/**
 * Every distinct figure URL in a set of markdown files, with the files that reference it.
 *
 * The character class stops at whitespace and at the delimiters markdown puts around a URL. It is
 * safe to stop at `)` because normalize.mjs percent-encodes `(`, `)` and space in the filename
 * before building the link — precisely so a raw `)` cannot close the markdown destination early.
 *
 * @param {Array<{path: string, text: string}>} files  `path` repo-relative POSIX
 */
export function collectFigureUrls(files) {
  const re = /https:\/\/cdn\.aecassistant\.com\.au\/[^\s)"'<>\]]+/g;
  const seen = new Map();
  for (const f of [...files].sort((a, b) => byCodepoint(a.path, b.path))) {
    for (const m of String(f.text).matchAll(re)) {
      const fig = parseFigureUrl(m[0], f.path);
      if (!seen.has(fig.url)) seen.set(fig.url, { ...fig, referencedBy: [] });
      const entry = seen.get(fig.url);
      if (!entry.referencedBy.includes(f.path)) entry.referencedBy.push(f.path);
    }
  }
  for (const e of seen.values()) e.referencedBy.sort(byCodepoint);
  return [...seen.values()].sort((a, b) => byCodepoint(a.url, b.url));
}

/* ============================================================================
 * URL -> local source
 * ========================================================================= */

/**
 * The one file on disk that a published figure URL was made from.
 *
 * @param {{filename: string, year: string, cdnKey: string}} fig
 * @param {{dir: string, names: string[]}|{dir: string, absent: true}} listing
 *   `dir` repo-relative POSIX; `names` the directory's entries EXACTLY as spelled on disk.
 *   A case-insensitive filesystem is why the listing is compared rather than `fs.existsSync`:
 *   on Windows `existsSync` says yes to a name whose case differs from the real file, and the
 *   same upload then fails — or worse, silently is not run — on a Linux runner.
 * @returns {{match: 'exact'|'folded', localPath: string, note?: string}
 *          |{match: 'unresolved', reason: string, candidates: string[]}}
 */
export function resolveLocalSource(fig, listing) {
  const { filename } = fig;
  if (listing.absent) {
    return {
      match: 'unresolved',
      reason: `${listing.dir} does not exist — the package is not extracted (run \`npm run fetch\`)`,
      candidates: [],
    };
  }
  const names = listing.names;
  if (names.includes(filename)) {
    return { match: 'exact', localPath: `${listing.dir}/${filename}` };
  }
  // Fallback: §6's fold (imported, not re-implemented), plus an extension that must still agree.
  const wantStem = normStem(filename);
  const wantExt = path.posix.extname(filename).toLowerCase();
  const sameStem = names.filter(n => normStem(n) === wantStem).sort(byCodepoint);
  const sameBoth = sameStem.filter(n => path.posix.extname(n).toLowerCase() === wantExt);
  if (sameBoth.length === 1) {
    return {
      match: 'folded',
      localPath: `${listing.dir}/${sameBoth[0]}`,
      note: `published as ${JSON.stringify(filename)}, on disk as ${JSON.stringify(sameBoth[0])} — `
        + 'same name once case and . - _ and space are folded',
    };
  }
  if (sameBoth.length > 1) {
    return {
      match: 'unresolved',
      reason: `${sameBoth.length} files in ${listing.dir} fold to the same name — one of them would be `
        + 'published as this figure by codepoint order alone',
      candidates: sameBoth,
    };
  }
  return {
    match: 'unresolved',
    reason: sameStem.length
      ? `no file in ${listing.dir} has this name; ${sameStem.length} share the folded stem but not the `
        + `${JSON.stringify(wantExt)} extension, and publishing one of those would serve a different format `
        + 'under this key'
      : `no file in ${listing.dir} has this name, and none folds to it`,
    candidates: sameStem,
  };
}

/**
 * The report written to `.cache/figures-missing.json`, and the thing `--upload` acts on.
 * Pure: values in, plain data out.
 *
 * @param {Array<object>} missing   figure records the CDN answered 404 for
 * @param {Map<string,object>} listings  `${year}/${cdnKey}` -> listing for resolveLocalSource
 */
export function buildMissingReport(missing, listings) {
  const resolved = [];
  const unresolved = [];
  for (const fig of [...missing].sort((a, b) => byCodepoint(a.url, b.url))) {
    const listing = listings.get(`${fig.year}/${fig.cdnKey}`);
    if (!listing) throw new Error(`sync-figures: no image listing for ${fig.year}/${fig.cdnKey}`);
    const r = resolveLocalSource(fig, listing);
    const base = {
      url: fig.url,
      key: assertFigureKey(fig.key),
      edition: fig.year,
      volume: fig.cdnKey,
      filename: fig.filename,
      referencedBy: [...(fig.referencedBy ?? [])].sort(byCodepoint),
    };
    if (r.match === 'unresolved') unresolved.push({ ...base, reason: r.reason, candidates: r.candidates });
    else {
      resolved.push({
        ...base,
        localPath: r.localPath,
        match: r.match,
        contentType: contentTypeFor(fig.filename),
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }
  return { bucket: BUCKET, upload: resolved, unresolved };
}

/* ============================================================================
 * I/O: the corpus and the extracted packages
 * ========================================================================= */

function walkMarkdown(dir, rel = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkMarkdown(path.join(dir, e.name), child));
    else if (e.name.toLowerCase().endsWith('.md')) out.push(child);
  }
  return out.sort(byCodepoint);
}

export function scanCorpus(corpusDir = CORPUS_DIR) {
  const rel = walkMarkdown(corpusDir);
  if (!rel.length) throw new Error(`sync-figures: no markdown under ${corpusDir}/ — nothing to verify`);
  const files = rel.map(r => ({
    path: `${toPosix(corpusDir)}/${r}`,
    text: fs.readFileSync(path.join(corpusDir, ...r.split('/')), 'utf8'),
  }));
  return { fileCount: files.length, figures: collectFigureUrls(files) };
}

/**
 * The `Images/` directory of one package — found case-insensitively rather than hardcoded per
 * edition (2025 ships `images/`, 2022 ships `Images/`), so a third spelling in a future edition
 * is handled, and an ambiguous one is an error rather than a coin toss.
 */
export function imageListing(pkg, cacheDir = CACHE_DIR) {
  const pkgDir = path.join(cacheDir, 'extracted', pkg);
  const nominal = `${toPosix(cacheDir)}/extracted/${pkg}/Images`;
  if (!fs.existsSync(pkgDir)) return { dir: nominal, absent: true };
  const hits = fs.readdirSync(pkgDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.toLowerCase() === 'images')
    .map(e => e.name).sort(byCodepoint);
  if (hits.length > 1) {
    throw new Error(`sync-figures: ${pkgDir} holds ${hits.length} image directories (${hits.join(', ')}) — `
      + 'which one a figure came from cannot be guessed');
  }
  if (!hits.length) return { dir: nominal, absent: true };
  const dir = `${toPosix(cacheDir)}/extracted/${pkg}/${hits[0]}`;
  // Files only: a directory whose name matched would resolve as a figure and then fail at the
  // upload, one object into a run that had already printed a plan claiming otherwise.
  const names = fs.readdirSync(path.join(pkgDir, hits[0]), { withFileTypes: true })
    .filter(e => e.isFile()).map(e => e.name).sort(byCodepoint);
  return { dir, names };
}

export function readImageListings(cacheDir = CACHE_DIR) {
  const out = new Map();
  for (const [slot, pkg] of [...figurePackages()].sort((a, b) => byCodepoint(a[0], b[0]))) {
    out.set(slot, imageListing(pkg, cacheDir));
  }
  return out;
}

/* ============================================================================
 * The CDN check
 * ========================================================================= */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * HEAD every URL, `concurrency` at a time.
 *
 * 200 is present, 404 is missing, and ANYTHING else is `error` — never quietly folded into
 * "missing", because uploading over an object the CDN merely failed to answer for is exactly the
 * overwrite this tool promises not to do. One retry absorbs a blip; five server errors abort the
 * whole run rather than keep hammering a CDN that is already unwell.
 */
export async function headCheck(urls, {
  concurrency = 10, fetchImpl = fetch, retryDelayMs = 750, abortAfterServerErrors = 5,
} = {}) {
  const results = new Map();
  const queue = [...urls];
  let serverErrors = 0;
  let aborted = null;

  const probe = async (url) => {
    try {
      const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': USER_AGENT } });
      return { status: res.status };
    } catch (e) {
      return { status: 0, detail: e?.message ?? String(e) };
    }
  };

  const worker = async () => {
    for (;;) {
      if (aborted) return;
      const url = queue.shift();
      if (url === undefined) return;
      let r = await probe(url);
      if (r.status !== 200 && r.status !== 404) {
        await sleep(retryDelayMs);
        r = await probe(url);
      }
      if (r.status === 200) results.set(url, { state: 'present' });
      else if (r.status === 404) results.set(url, { state: 'missing' });
      else {
        results.set(url, { state: 'error', status: r.status, detail: r.detail ?? '' });
        // Report the FIRST trip, not the last: workers already in flight when the threshold is
        // crossed would otherwise rewrite the message with a count that depends on concurrency.
        if (++serverErrors >= abortAfterServerErrors && !aborted) {
          aborted = new Error(`sync-figures: stopping — ${serverErrors} URLs gave neither 200 nor 404 `
            + `(last: ${url} -> ${r.status || 'network error'} ${r.detail ?? ''}). The CDN is not answering `
            + 'reliably; nothing has been written. Try again later.');
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length || 1)) }, worker));
  if (aborted) throw aborted;
  return results;
}

/* ============================================================================
 * Upload (operator step)
 * ========================================================================= */

/** The argv AFTER the npx entry point. Never a command string: a key and a path both contain
 *  spaces and parentheses, and joining them into one is how the wrong file gets uploaded. */
export function uploadArgs({ key, localPath, contentType }) {
  return [
    '-y', 'wrangler', 'r2', 'object', 'put', `${BUCKET}/${assertFigureKey(key)}`,
    '--file', localPath,
    '--content-type', contentType,
    '--remote',
  ];
}

/**
 * `npx` is a `.cmd` shim on Windows, and since the CVE-2024-27980 fix Node refuses to spawn one
 * without `shell: true` — which would put an unquoted command line, built from filenames that
 * contain spaces and parentheses, in front of cmd.exe. So the JS entry point is located and run
 * through `process.execPath` instead, keeping a real argv array on every platform.
 */
export function resolveNpx() {
  const dir = path.dirname(process.execPath);
  for (const rel of ['node_modules/npm/bin/npx-cli.js', '../lib/node_modules/npm/bin/npx-cli.js']) {
    const cli = path.join(dir, ...rel.split('/'));
    if (fs.existsSync(cli)) return { command: process.execPath, prefix: [cli] };
  }
  if (process.platform !== 'win32') return { command: 'npx', prefix: [] };
  throw new Error('sync-figures: could not locate npm\'s npx-cli.js next to this Node, and on Windows a '
    + '.cmd shim cannot be spawned without a shell. Install wrangler and run the printed commands by hand.');
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // CI silences wrangler's prompts: a scripted upload that stops to ask a question in a
      // non-interactive shell hangs forever instead of failing.
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ code: -1, out, err: `${err}${e.message}` }));
    child.on('close', code => resolve({ code, out, err }));
  });
}

const tail = (s, n = 6) => String(s).split(/\r?\n/).filter(Boolean).slice(-n).map(l => `      ${l}`).join('\n');

/**
 * @param {Array<object>} plan  entries of `buildMissingReport().upload`
 * @returns {Promise<{ok: number, failed: Array<{key: string, code: number, err: string}>}>}
 */
export async function uploadAll(plan, { runner = run } = {}) {
  const { command, prefix } = resolveNpx();
  let ok = 0;
  const failed = [];
  for (const [i, item] of plan.entries()) {
    const args = [...prefix, ...uploadArgs(item)];
    process.stdout.write(`  [${i + 1}/${plan.length}] ${item.key} … `);
    const r = await runner(command, args);
    if (r.code === 0) { ok++; console.log('ok'); }
    else {
      failed.push({ key: item.key, code: r.code, err: r.err || r.out });
      console.log(`FAILED (exit ${r.code})`);
      const detail = tail(r.err || r.out);
      if (detail) console.log(detail);
    }
  }
  return { ok, failed };
}

/* ============================================================================
 * CLI
 * ========================================================================= */

const FLAGS = new Set(['--upload', '--allow-folded']);
const USAGE = 'usage: node tools/src/sync-figures.mjs [--upload] [--allow-folded]';

export function parseArgs(argv = []) {
  const opts = { upload: false, allowFolded: false };
  for (const raw of argv) {
    const arg = String(raw);
    if (!FLAGS.has(arg)) throw new Error(`sync-figures: unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    if (arg === '--upload') opts.upload = true;
    if (arg === '--allow-folded') opts.allowFolded = true;
  }
  return opts;
}

const bytes = n => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export async function main(argv = []) {
  const opts = parseArgs(argv);

  // Fail on the missing credential BEFORE spending a few hundred HEAD requests to discover it.
  if (opts.upload && !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('sync-figures: --upload needs CLOUDFLARE_API_TOKEN in the environment (a token with '
      + `R2 write access to the ${BUCKET} bucket). Set it and re-run; if the token reaches more than one `
      + 'account, set CLOUDFLARE_ACCOUNT_ID too. A cached `wrangler login` is deliberately not accepted — '
      + 'publishing to the production CDN is an explicit act, not something ambient credentials should '
      + 'enable. Nothing has been checked or written.');
  }

  const { fileCount, figures } = scanCorpus();
  const editions = [...new Set(figures.map(f => f.year))].sort(byCodepoint);
  console.log(`sync-figures: ${figures.length} distinct figure URLs in ${fileCount} markdown files under ${CORPUS_DIR}/`);
  if (!figures.length) {
    // Distinct from "everything is live" — say which one it is rather than print a reassurance.
    console.log('  nothing to verify: this corpus publishes no figures.');
    return;
  }
  console.log(`  HEAD ${CDN_ORIGIN}/${CDN_PATH_PREFIX}/… — 10 concurrent, read-only\n`);

  const results = await headCheck(figures.map(f => f.url));
  const state = f => results.get(f.url)?.state ?? 'error';

  for (const year of editions) {
    const mine = figures.filter(f => f.year === year);
    const n = s => mine.filter(f => state(f) === s).length;
    console.log(`  ${year}   present ${n('present')}   missing ${n('missing')}`
      + (n('error') ? `   indeterminate ${n('error')}` : ''));
  }

  const errored = figures.filter(f => state(f) === 'error');
  const missing = figures.filter(f => state(f) === 'missing');
  const report = buildMissingReport(missing, readImageListings());

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(MISSING_JSON, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${MISSING_JSON} — ${report.upload.length} uploadable, ${report.unresolved.length} unresolved`);

  if (report.upload.length) {
    console.log('\nmissing, with the local file each would be uploaded from:');
    for (const u of report.upload) {
      let size = null;
      try { size = fs.statSync(u.localPath).size; } catch { /* reported as unreadable below */ }
      console.log(`  ${u.key}`);
      console.log(`      <- ${u.localPath}  [${u.match}${size === null ? ', UNREADABLE' : `, ${bytes(size)}`}, ${u.contentType}]`);
      if (u.note) console.log(`      note: ${u.note}`);
      console.log(`      referenced by ${u.referencedBy.join(', ')}`);
    }
  }

  const folded = report.upload.filter(u => u.match === 'folded');
  if (folded.length) {
    console.log(`\n${folded.length} figure(s) resolve only by name folding, not by an exact filename match. `
      + 'Check each one before publishing it.');
  }
  if (report.unresolved.length) {
    console.log(`\nUNRESOLVED — ${report.unresolved.length} figure URL(s) have no local source:`);
    for (const u of report.unresolved) {
      console.log(`  ${u.key}\n      ${u.reason}`);
      if (u.candidates.length) console.log(`      near names on disk: ${u.candidates.join(', ')}`);
      console.log(`      referenced by ${u.referencedBy.join(', ')}`);
    }
  }
  if (errored.length) {
    console.log(`\nINDETERMINATE — ${errored.length} URL(s) answered neither 200 nor 404:`);
    for (const f of errored) {
      const r = results.get(f.url);
      console.log(`  ${f.key} -> ${r.status || 'network error'} ${r.detail ?? ''}`.trimEnd());
    }
  }

  if (!opts.upload) {
    if (report.upload.length) {
      console.log('\nTo publish these (operator step, needs CLOUDFLARE_API_TOKEN):'
        + '\n  node tools/src/sync-figures.mjs --upload');
    } else if (!report.unresolved.length && !errored.length) {
      console.log('\nEvery figure URL in the corpus is live.');
    }
  }

  // Both conditions mean the tool does not know the truth, so neither may be papered over by a
  // zero exit — and neither may be uploaded through.
  if (report.unresolved.length || errored.length) {
    throw new Error(`sync-figures: ${report.unresolved.length} unresolved local source(s) and `
      + `${errored.length} indeterminate CDN answer(s) — investigate before uploading. `
      + `Details above and in ${MISSING_JSON}.`);
  }

  if (!opts.upload) return;

  if (folded.length && !opts.allowFolded) {
    throw new Error(`sync-figures: refusing to upload — ${folded.length} figure(s) resolve only by name `
      + 'folding. Confirm each is the intended image, then re-run with --allow-folded. Nothing was written.');
  }
  if (!report.upload.length) {
    console.log('\nNothing to upload.');
    return;
  }

  console.log(`\nUPLOADING ${report.upload.length} object(s) to r2://${BUCKET} — only keys this run saw return 404:`);
  for (const u of report.upload) console.log(`  put ${BUCKET}/${u.key}  <- ${u.localPath}  (${u.contentType})`);
  console.log('');

  const { ok, failed } = await uploadAll(report.upload);
  console.log(`\nuploaded ${ok}/${report.upload.length}` + (failed.length ? `, ${failed.length} failed` : ''));
  if (failed.length) {
    throw new Error(`sync-figures: ${failed.length} object(s) failed to upload — ${failed.map(f => f.key).join(', ')}`);
  }
  console.log('Re-run without --upload to verify: every URL should now report present.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(`\n${e.message}\n`); process.exit(1); });
}
