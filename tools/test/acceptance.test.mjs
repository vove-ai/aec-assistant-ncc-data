// acceptance.test.mjs — the six promises this corpus makes to the agent that greps it.
//
// These are not unit tests. Every other test file checks a function; these check the CORPUS —
// the artifact a Claude Managed Agents session mounts and searches. Each one is an executable
// version of a sentence in docs/design.md, and #2 is the defect the whole repo exists to fix:
// a glossary cross-reference splits a sentence in the source XML, so an exact phrase typed by a
// human finds nothing. If #2 fails, the fix belongs in normalize.mjs. NEVER in this file.
//
// Same for #4: a clause that cites "see Figure X" must carry that figure's link in its own file,
// or an agent has to go chasing it. When it fails, the fix is the figure's alt text in
// normalize.mjs — the test states the promise and does not bend.
//
// Slice tolerance: the corpus is built up over several tasks (2025 pilot, 2022 pilot, then the
// bulk runs), so each edition's tests register only once `corpus/{edition}/` exists. An absent
// corpus reports as ONE skipped test rather than as silence — a suite that says nothing about a
// missing corpus looks identical to a suite that passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const editions = ['2022', '2025'].filter(e => fs.existsSync(`corpus/${e}`));
const files = ed => walk(`corpus/${ed}`).filter(f => f.endsWith('.md') && !f.endsWith('INDEX.md'));
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}
const read = f => fs.readFileSync(f, 'utf8');

/** Codepoint sort. Never localeCompare — locale-dependent order is not reproducible. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The `clause:` value from a file's frontmatter, or null. Deliberately a hand-rolled reader over
 * the first lines rather than an import from emit.mjs: this suite is the corpus's second opinion,
 * so it must not share code with the thing that produced it.
 */
function clauseOf(content) {
  const m = /^clause: (.*)$/m.exec(content.split('\n---', 1)[0]);
  if (!m) return null;
  const v = m[1].trim();
  return v.startsWith('"') ? JSON.parse(v) : v;
}

/**
 * An independent reimplementation of emit.mjs's clause-id → filename-token rule (lowercase, fold
 * diacritics, keep dots, everything else to '-'). Reimplemented rather than imported for the same
 * reason as above — importing it would make #1 assert that emit.mjs agrees with itself.
 */
function idToken(id) {
  return String(id).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * The worked example from the design doc, and the one ID both editions share: NCC 2022 and NCC
 * 2025 both publish C2D2 in Volume One (measured in .cache/extracted/ncc-20{22,25}-volume-one*).
 * It sits in Section C, so it is out of scope for a Section-A-only slice — in which case #1 skips
 * the example and still enforces the corpus-wide invariant, which needs no probe.
 */
const PROBE = 'C2D2';

/**
 * A prose figure reference. Both details are measured, not defensive:
 *
 *  * the optional jurisdiction prefix — `see Figure NT 10.7.1a` appears 3 times, and the figure it
 *    names is embedded with num `10.7.1a`, so a pattern without it captures `NT` and looks for a
 *    figure called NT;
 *  * `[A-Za-z0-9.]*` runs into the sentence's punctuation — 149 references are followed directly
 *    by `.`, `,` or `)`, so `see Figure H1D4a.` yields the designation `H1D4a.`. figKey strips it.
 */
const FIGURE_REF = /\bsee Figure (?:(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+)?([A-Za-z0-9][A-Za-z0-9.]*)/gi;

/**
 * One figure designation, canonical, from either side: a prose reference (`H1D4a.`) or an embed's
 * alt text (`H1D4a (explanatory): Footing details`). Measured shapes: 33 embeds carry a
 * ` (explanatory)` qualifier and one carries a bare ` explanatory`; every embed with a caption
 * separates it with `: `.
 */
function figKey(raw) {
  return String(raw).split(':')[0].trim()
    .replace(/\s*\(.*$/, '')                                    // " (explanatory)" and anything after
    .replace(/\s+explanatory$/i, '')
    .replace(/[.,;:)\]]+$/, '')                                 // sentence punctuation
    .replace(/^(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+/i, '')       // prose carries it, the embed does not
    .toLowerCase();
}

if (!editions.length) {
  test('acceptance suite is idle — no corpus/ built yet', (t) => {
    t.skip('corpus/2022 and corpus/2025 are both absent; run `npm run build` first');
  });
}

for (const ed of editions) {
  test(`[${ed}] #1 clause-ID glob is exact`, async (t) => {
    // The promise: `glob corpus/{ed}/**/{id}-*` returns that clause's files and NOTHING else.
    // Checked BOTH ways over every clause ID in the corpus, so it cannot pass on an empty set and
    // cannot be satisfied by a naming scheme that merely avoids false positives:
    //   * a file the glob finds whose frontmatter names a different clause = a wrong hit
    //   * a file whose frontmatter names the clause but which the glob misses = a lost variation
    const byLead = new Map();     // leading filename token -> files
    const byClause = new Map();   // frontmatter clause id  -> files
    for (const f of files(ed)) {
      const lead = path.basename(f).replace(/\.md$/, '').split('-')[0];
      byLead.set(lead, [...(byLead.get(lead) ?? []), f]);
      const id = clauseOf(read(f));
      if (id) byClause.set(id, [...(byClause.get(id) ?? []), f]);
    }
    assert.ok(byClause.size > 0, `${ed}: no clause files at all — nothing to glob`);

    for (const id of [...byClause.keys()].sort(byCodepoint)) {
      const tok = idToken(id);
      assert.deepEqual(
        (byLead.get(tok) ?? []).sort(byCodepoint),
        byClause.get(id).sort(byCodepoint),
        `${ed}: glob ${tok}-* does not equal the files whose clause: is ${id}`,
      );
    }

    // The documented worked example is a SUBTEST so that a slice which does not contain it skips
    // the example alone. Skipping the whole test would report "not checked" for the invariant
    // above, which did run and did pass — an inaccuracy in the direction of looking safe.
    await t.test(`the ${PROBE} worked example`, (probe) => {
      if (!byClause.has(PROBE)) return probe.skip(`${PROBE} is outside the built slice`);
      const hits = byClause.get(PROBE);
      assert.ok(hits.length >= 1);
      for (const f of hits) {
        assert.ok(path.basename(f).startsWith(`${idToken(PROBE)}-`), `${f}: not named for ${PROBE}`);
        assert.ok(f.includes('volume-one'), `${f}: ${PROBE} is a Volume One clause`);
      }
    });
  });

  test(`[${ed}] #2 phrase grep across former xref boundary (THE defect)`, () => {
    // In the source XML this sentence is broken by a glossary cross-reference element, so the
    // phrase does not exist as contiguous text (verified: zero hits in contents.xml). It exists
    // here only because normalize.mjs inlines the reference as prose. `includes` on the whole
    // file is the test: a line break anywhere inside the phrase makes it fail.
    const hit = files(ed).some(f => read(f).includes('resistance to the incipient spread of fire to the space above'));
    assert.ok(hit, 'A5G7 phrase must match on one line');
  });

  test(`[${ed}] #3 standard references greppable`, () => {
    assert.ok(files(ed).some(f => read(f).includes('AS 1530.4')));
  });

  test(`[${ed}] #4 a cited figure is always reachable in one grep`, (t) => {
    // The promise an agent depends on: it never has to hunt for a figure. Two ways to keep it,
    // and the corpus must do one of them for EVERY reference:
    //   * the citing file embeds the figure itself — normalize.mjs writes the designation into
    //     the alt text, so the prose and the figure match the same grep; or
    //   * exactly ONE file in the corpus embeds it, so one `grep -rl` lands on it.
    //
    // Deliberately weaker than "every citing file embeds every figure it cites", which was the
    // first formulation and is FALSE OF THE NCC ITSELF. Measured over the whole 2025 corpus: 131
    // references split 114 embedded in the citing file / 17 genuine cross-file references in the
    // published source (a clause citing a neighbouring clause's figure — 9.2.3 cites Figure
    // 9.2.2e; a glossary entry cites a Housing Provisions figure). A test demanding what the
    // source does not do gets "fixed" by mangling the normalizer, which is the opposite of what
    // it is for. It stays strong where it counts — measured 0 references resolving to no file and
    // 0 resolving ambiguously — so a figure the normalizer actually dropped still fails here.
    const contents = new Map(files(ed).map(f => [f, read(f)]));
    const embedders = new Map();          // figure designation -> files embedding it
    for (const [f, c] of contents) {
      for (const m of c.matchAll(/!\[Figure([^\]]*)\]/g)) {
        const k = figKey(m[1]);
        if (!k) continue;                 // an untitled figure carries no designation to cite
        if (!embedders.has(k)) embedders.set(k, new Set());
        embedders.get(k).add(f);
      }
    }
    let refs = 0;
    for (const [f, c] of contents) {
      for (const m of c.matchAll(FIGURE_REF)) {
        refs++;
        const k = figKey(m[1]);
        const who = embedders.get(k) ?? new Set();
        if (who.has(f)) continue;
        assert.ok(who.size > 0,
          `${f}: cites Figure ${m[1]}, which NO file in corpus/${ed} embeds — the normalizer dropped the figure`);
        assert.equal(who.size, 1,
          `${f}: cites Figure ${m[1]}, embedded by ${who.size} files, so one grep does not reach it — ${[...who].join(', ')}`);
      }
    }
    // Say so out loud when a slice contains no reference at all: this test then asserted nothing,
    // and a silent pass is indistinguishable from a real one. (Measured: Sections A+C of Volume
    // One contain 10 figures and zero `see Figure` references, so the pilot slice is exactly this
    // case; the full corpus has 131.)
    if (!refs) t.diagnostic(`no figure references in corpus/${ed} — this slice does not exercise #4`);
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
