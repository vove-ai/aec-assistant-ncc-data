// fetch-weblinks.mjs — the one-off crawler behind `web_url:`.
//
// The site's slugs drop stopwords ("Interpreting the NCC" -> `interpreting-ncc`), so a page URL
// can never be COMPUTED from a title. It has to be learned once, committed as data, and then
// keyed offline by weblinks.mjs. This CLI is the "learned once" half; it runs by hand, not in
// the build, and its output (tools/data/weblinks-{edition}.json) is a sorted string array.
//
// LINK DISCOVERY ONLY. The repo's strict-format rule forbids scraped HTML anywhere near the
// corpus, so nothing but `href` values is ever read out of a response, and no response body is
// written to disk. A page fetched here contributes exactly two things: the URLs it links to,
// and whether it existed.
//
// Politeness and blast radius:
//   * a descriptive User-Agent that says who is calling and why;
//   * one request at a time with a delay between them (default 200 ms);
//   * a BFS depth bound, so the crawl cannot wander into the whole site;
//   * consecutive server errors abort the run with a message instead of hammering;
//   * a plausibility floor on the result, so a silently truncated crawl fails here rather than
//     three tasks later as bulk `web_url: null` in the corpus.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://ncc.abcb.gov.au';
const USER_AGENT =
  'aec-assistant-ncc-data/1.0 (one-off URL discovery for NCC clause citations; '
  + 'https://github.com/vove-ai/aec-assistant-ncc-data)';

/**
 * Volume roots to seed each edition with. `livable-housing` is 2025-only, and its site slug is
 * `livable-housing`, NOT the `livable-housing-design` the document is titled — that 404s.
 * A seed that 404s is recorded and skipped, never fatal (an edition may not publish a volume).
 */
export const SEEDS = {
  '2025': ['volume-one', 'volume-two', 'volume-three', 'housing-provisions', 'livable-housing'],
  '2022': ['volume-one', 'volume-two', 'volume-three', 'housing-provisions'],
};

/** Depth of a path, counting segments after `/adopted/`: a volume root is 1, a section 2. */
export function depthOf(pathname) {
  const m = /^\/editions\/ncc-\d{4}\/adopted\/(.+)$/.exec(pathname);
  return m ? m[1].split('/').filter(Boolean).length : 0;
}

/**
 * Every in-edition adopted-page link on an HTML page, fragment- and query-stripped, deduped.
 * Regex, not a parser: we want hrefs, and only hrefs.
 */
export function extractLinks(html, edition) {
  const prefix = `/editions/ncc-${edition}/adopted/`;
  const out = new Set();
  for (const m of String(html).matchAll(/href="([^"]+)"/g)) {
    const href = m[1].split('#')[0].split('?')[0].replace(/\/+$/, '');
    if (href.startsWith(prefix) && href.length > prefix.length) out.add(href);
  }
  return [...out];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Codepoint sort. Never localeCompare — it is locale-dependent and would not be reproducible. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export async function crawlEdition(edition, {
  maxDepth = 3, delayMs = 200, log = console.log, fetchImpl = fetch,
} = {}) {
  const seeds = SEEDS[edition];
  if (!seeds) throw new Error(`fetch-weblinks: no seeds for edition ${edition}`);

  const found = new Set();          // every in-edition path we have seen linked, at any depth
  const visited = new Set();        // pages actually fetched
  const queue = seeds.map(v => `/editions/ncc-${edition}/adopted/${v}`);
  for (const p of queue) found.add(p);

  const notOk = [];
  let consecutiveServerErrors = 0;
  let deepest = 0;

  while (queue.length) {
    const pathname = queue.shift();
    if (visited.has(pathname)) continue;
    visited.add(pathname);

    const depth = depthOf(pathname);
    deepest = Math.max(deepest, depth);

    let res;
    try {
      res = await fetchImpl(ORIGIN + pathname, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    } catch (e) {
      consecutiveServerErrors++;
      notOk.push({ pathname, status: `network: ${e.message}` });
      if (consecutiveServerErrors >= 5) {
        throw new Error(`fetch-weblinks: aborting — 5 consecutive network failures, last at ${pathname}`);
      }
      await sleep(delayMs);
      continue;
    }

    if (!res.ok) {
      notOk.push({ pathname, status: res.status });
      // 4xx is data (a volume that does not exist in this edition). 5xx/429 is the site telling
      // us to stop, and continuing would be hammering.
      if (res.status >= 500 || res.status === 429) {
        consecutiveServerErrors++;
        if (consecutiveServerErrors >= 5) {
          throw new Error(
            `fetch-weblinks: aborting — 5 consecutive ${res.status}-class responses, last at ${pathname}. `
            + 'Wait and re-run; do not increase the rate.',
          );
        }
      } else {
        consecutiveServerErrors = 0;
      }
      await sleep(delayMs);
      continue;
    }
    consecutiveServerErrors = 0;

    for (const href of extractLinks(await res.text(), edition)) {
      const d = depthOf(href);
      if (d > maxDepth) continue;
      found.add(href);
      // A page at the frontier depth is recorded but never expanded. This is a real trade, not a
      // free one: the site is a GRAPH, so a depth-3 page can link SIDEWAYS to another depth-3
      // page that no depth-2 page mentions, and such a URL would be missed. Expanding the
      // frontier costs ~2,000 requests and ~450 MB against ~83 requests, so it was measured
      // instead: a deterministic 5% sample (29 of 562) of 2025's frontier pages yielded 0 links
      // the crawl had not already found. By the rule of three that bounds the miss rate at
      // roughly 10% with 95% confidence — it does not establish zero. What makes the trade
      // acceptable is the failure mode, not the sample: a missed page leaves its units with a
      // null web_url, and Task 7 fails the build on any clause with a null web_url. The loss is
      // loud. Run with `--max-depth 4` to expand the frontier if that ever fires.
      if (d < maxDepth && !visited.has(href)) queue.push(href);
    }

    if (visited.size % 25 === 0) log(`  … ${visited.size} pages fetched, ${found.size} URLs found`);
    await sleep(delayMs);
  }

  return {
    urls: [...found].map(p => ORIGIN + p).sort(byCodepoint),
    fetched: visited.size,
    deepest,
    notOk,
  };
}

/** Guards a thin crawl from being committed as if it were a real one. */
export function assertPlausible(edition, urls) {
  const FLOOR = 100;
  if (urls.length < FLOOR) {
    throw new Error(
      `fetch-weblinks: ${edition} produced only ${urls.length} URLs (floor ${FLOOR}). `
      + 'A truncated link file silently becomes bulk `web_url: null` in the corpus — refusing to '
      + 'write it. Check whether the site changed its URL scheme before re-running.',
    );
  }
}

function parseArgs(argv) {
  const out = { editions: Object.keys(SEEDS).sort(byCodepoint), maxDepth: 3, delayMs: 200, outDir: 'tools/data' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[++i];
    if (flag === '--edition') out.editions = [value];
    else if (flag === '--max-depth') out.maxDepth = Number(value);
    else if (flag === '--delay') out.delayMs = Number(value);
    else if (flag === '--out') out.outDir = value;
    else throw new Error(`fetch-weblinks: unknown argument ${argv[i]}`);
  }
  return out;
}

async function main(argv) {
  const { editions, maxDepth, delayMs, outDir } = parseArgs(argv);
  fs.mkdirSync(outDir, { recursive: true });
  for (const edition of editions) {
    const started = Date.now();
    console.log(`crawling ncc-${edition} (seeds: ${SEEDS[edition].join(', ')}; max depth ${maxDepth})`);
    const { urls, fetched, deepest, notOk } = await crawlEdition(edition, { maxDepth, delayMs });
    assertPlausible(edition, urls);

    const file = path.join(outDir, `weblinks-${edition}.json`);
    fs.writeFileSync(file, `${JSON.stringify(urls, null, 2)}\n`, 'utf8');

    const perVolume = new Map();
    for (const u of urls) {
      const v = new URL(u).pathname.split('/')[4];
      perVolume.set(v, (perVolume.get(v) ?? 0) + 1);
    }
    console.log(`  ${file}: ${urls.length} URLs, ${fetched} pages fetched, deepest ${deepest}, `
      + `${Math.round((Date.now() - started) / 1000)}s`);
    for (const v of [...perVolume.keys()].sort(byCodepoint)) console.log(`    ${v}: ${perVolume.get(v)}`);
    if (notOk.length) {
      console.log(`  non-200 (${notOk.length}):`);
      for (const n of notOk) console.log(`    ${n.status}  ${n.pathname}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
