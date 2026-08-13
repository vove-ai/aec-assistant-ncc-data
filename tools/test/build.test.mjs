// build.test.mjs — the orchestration's decisions, as pure functions.
//
// build.mjs is mostly IO, but three of its decisions are not, and all three are ones a passing
// corpus would hide:
//
//  1. THE UNIQUENESS POLICY. ⊕ trap 4 exists because two separate identity bugs surfaced as
//     silent overwrites — last-write-wins, no warning, a state-specific clause lost under the
//     national filename. Every branch of the policy is fixtured here, including the ordering
//     trap that turns a legitimate cross-volume duplicate into a false conflict.
//  2. WHAT A SLICE DELETES. A stale file left behind by an earlier slice is invisible to every
//     test in this repo and would ship. A slice that deletes too much destroys a sibling slice.
//     Both directions are fixtured.
//  3. ARGUMENT PARSING. `--sections A` silently building nothing, or `--edition 2020` silently
//     building everything, are both wrong answers that look like successful runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDITIONS, PARITY, inScope, parseArgs, planReconcile, resolveUniqueness } from '../src/build.mjs';

/* ============================================================ *
 * 1. Arguments                                                  *
 * ============================================================ */

test('the bare form selects every edition that has a reader, and no filters', () => {
  const o = parseArgs([]);
  // Compared against EDITIONS *and* pinned to the literal set, so this cannot pass merely by
  // agreeing with an empty or stubbed registry.
  assert.deepEqual(o.editions, [...EDITIONS.keys()].sort());
  assert.deepEqual(o.editions, ['2025'], 'until read-2022.mjs lands, a bare build is 2025 only');
  assert.equal(o.volumes, null);
  assert.equal(o.sections, null);
});

test('--edition, --volumes and --sections take comma lists, in either --k v or --k=v form', () => {
  const a = parseArgs(['--edition', '2025', '--volumes', 'volume-one,volume-two', '--sections', 'A,C']);
  assert.deepEqual(a, { editions: ['2025'], volumes: ['volume-one', 'volume-two'], sections: ['A', 'C'] });
  assert.deepEqual(parseArgs(['--edition=2025', '--sections=A']), { editions: ['2025'], volumes: null, sections: ['A'] });
});

test('an edition with no reader yet is refused by name, pointing at the task that adds it', () => {
  assert.throws(() => parseArgs(['--edition', '2022']), /2022.*read-2022/s);
});

test('an unknown edition, flag, or bare argument is refused rather than silently ignored', () => {
  assert.throws(() => parseArgs(['--edition', '2020']), /2020/);
  assert.throws(() => parseArgs(['--slice', 'A']), /--slice/);
  assert.throws(() => parseArgs(['volume-one']), /volume-one/);
  assert.throws(() => parseArgs(['--sections']), /--sections/);
  assert.throws(() => parseArgs(['--sections', '']), /--sections/);
});

test('an unknown volume is refused — a typo must not build an empty slice that looks successful', () => {
  assert.throws(() => parseArgs(['--volumes', 'volume-1']), /volume-1/);
});

/* ============================================================ *
 * 2. The section filter                                         *
 * ============================================================ */

test('no --sections means everything; front matter (empty section num) is always in scope', () => {
  assert.equal(inScope({ sectionNum: 'C' }, null), true);
  // read-2025.mjs keeps a section with an empty num unconditionally; the build must agree, or a
  // slice would emit a different unit set depending on which of the two applied the filter.
  assert.equal(inScope({ sectionNum: '' }, ['A']), true);
  assert.equal(inScope({ sectionNum: 'A' }, ['A']), true);
  assert.equal(inScope({ sectionNum: 'C' }, ['A']), false);
  // Schedules are numbered, and are as filterable as lettered body sections.
  assert.equal(inScope({ sectionNum: '1' }, ['1']), true);
});

/* ============================================================ *
 * 3. The uniqueness policy — three branches                     *
 * ============================================================ */

// `volume` defaults to the document key because that is what the real pipeline does — a glossary
// unit is stamped with the volume it was read from. It is overridable so a test can isolate the
// ordering question from the provenance question, which are different failures.
const record = (docKey, term, body, terms = [], volume = docKey) => ({
  docKey,
  unit: { edition: '2025', volume, kind: 'glossary', term, title: term, state: null },
  normalized: { bodyMd: body, definedTerms: terms, figures: [], warnings: [], tableRefs: [] },
  emitOpts: { citationPrefix: 'NCC 2025 V1', webUrl: 'https://ncc.abcb.gov.au/x' },
});

// The records the build feeds in already carry their emitted path and bytes; only a merge
// re-emits. Mirroring that here keeps the fixture honest about the real call shape — including
// the `volume:` line, which is what makes two volumes' copies of one glossary term differ.
function emitted(recs) {
  return recs.map(r => ({
    ...r,
    relPath: `2025/glossary/${r.unit.term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
    content: `---\nterm: ${r.unit.term}\nvolume: ${r.unit.volume}\n---\n\n# ${r.unit.term}\n\n${r.normalized.bodyMd}\n`,
  }));
}

test('branch 1 — the same path with byte-identical content is written once, with no error', () => {
  // The 2025 glossary is embedded in every volume, so one path is claimed by up to four
  // documents. Treating that as a collision would fail every correct full build.
  //
  // MEASURED: with today's per-volume provenance NONE of the 555 shared glossary paths is
  // actually byte-identical, so this branch does not currently fire on real 2025 data — the
  // fixture holds `volume` constant to exercise it. It becomes the live path the moment the
  // glossary-dedupe decision gives a deduplicated glossary one provenance.
  const out = resolveUniqueness(emitted([
    record('volume-one', 'ABCB', 'Australian Building Codes Board.', [], 'volume-one'),
    record('volume-two', 'ABCB', 'Australian Building Codes Board.', [], 'volume-one'),
    record('volume-three', 'ABCB', 'Australian Building Codes Board.', [], 'volume-one'),
  ]));
  assert.equal(out.write.size, 1);
  assert.equal(out.duplicates, 2);
  assert.deepEqual(out.merges, []);
  assert.ok(out.write.get('2025/glossary/abcb.md').includes('Australian Building Codes Board.'));
});

test('branch 2 — two senses in ONE document merge into one file, in document order (R23)', () => {
  // The NCC defines "Appropriate authority" twice with different meanings: one scoped to the Fire
  // Safety Verification Method, one general. An agent that greps the term must see BOTH — missing
  // the FSVM-scoped one is a compliance error — and nobody globs for a hash suffix.
  const out = resolveUniqueness(emitted([
    record('volume-one', 'Appropriate authority', 'For the purposes of the Fire Safety Verification Method, means X.', ['Fire Safety Verification Method']),
    record('volume-one', 'Appropriate authority', 'The relevant authority with the statutory responsibility.', ['statutory']),
  ]));
  assert.equal(out.write.size, 1);
  assert.equal(out.duplicates, 0);
  assert.deepEqual(out.merges, [{ relPath: '2025/glossary/appropriate-authority.md', docKey: 'volume-one', senses: 2 }]);

  const md = out.write.get('2025/glossary/appropriate-authority.md');
  assert.equal((md.match(/^---$/gm) ?? []).length, 2, 'exactly one frontmatter block');
  assert.equal((md.match(/^# /gm) ?? []).length, 1, 'exactly one H1');
  assert.ok(md.indexOf('## Definition 1') < md.indexOf('## Definition 2'), md);
  assert.ok(md.indexOf('Fire Safety Verification Method, means X.') < md.indexOf('The relevant authority'), 'document order');
  assert.match(md, /defined_terms:\n  - Fire Safety Verification Method\n  - statutory\n/, 'terms unioned in order');
});

test('branch 2 stays stable when the same in-document merge repeats in another document', () => {
  // The ordering trap: merge volume-one first and you are then comparing volume-two's FIRST sense
  // against an already-merged file. A naive fold reads that as a cross-document conflict and
  // fails a build that is entirely correct. Grouping per document before comparing across is
  // what makes the answer independent of the order documents are read in.
  // Provenance is held constant so this test measures ONE thing: that per-document merging
  // happens before cross-document comparison. The provenance difference is a separate, measured
  // fact with its own test below.
  const recs = ['volume-one', 'volume-two'].flatMap(v => [
    record(v, 'Appropriate authority', 'Sense one.', [], 'volume-one'),
    record(v, 'Appropriate authority', 'Sense two.', [], 'volume-one'),
  ]);
  const out = resolveUniqueness(emitted(recs));
  assert.equal(out.write.size, 1);
  assert.equal(out.merges.length, 1, 'reported once, not once per document');
  assert.equal(out.duplicates, 1, 'the second document produced the same merged bytes');
  const md = out.write.get('2025/glossary/appropriate-authority.md');
  assert.ok(md.includes('Sense one.') && md.includes('Sense two.'));
  assert.equal(resolveUniqueness(emitted(recs.slice(2).concat(recs.slice(0, 2)))).write.get('2025/glossary/appropriate-authority.md'), md);
});

test('branch 3 — the same path with different content from DIFFERENT documents throws', () => {
  // Measured: "Hours of operation" reads differently in Volumes Two/Three (an ABCB typo) than in
  // Volume One. Merging it would fabricate a definition the NCC does not publish; picking one
  // would silently drop the other. It is a human ruling, so the build stops and says so.
  let err;
  try {
    resolveUniqueness(emitted([
      record('volume-one', 'Hours of operation', 'the period is at least 20% of the peak occupancy'),
      record('volume-two', 'Hours of operation', 'the period is greater thanat least 20% of the peak occupancy'),
    ]));
  } catch (e) { err = e; }
  assert.ok(err, 'a cross-document content conflict must throw');
  assert.match(err.message, /2025\/glossary\/hours-of-operation\.md/);
  assert.match(err.message, /volume-one/);
  assert.match(err.message, /volume-two/);
  assert.match(err.message, /greater thanat least/, 'the report shows the differing text');
});

test('a conflict that is only provenance is reported as its own class, not mixed with real text differences', () => {
  // MEASURED over all five 2025 documents: every one of the 555 shared glossary paths differs
  // across volumes, because `volume:`, the `citation:` prefix and `web_url:` are volume-specific.
  // 545 differ ONLY there; 10 differ in body text (9 figure URLs embed the volume, plus one ABCB
  // typo in "Hours of operation"). A single flat list of 555 would bury the ten that need a
  // reading of the Code, so the report splits them.
  let err;
  try {
    resolveUniqueness(emitted([
      record('volume-one', 'ABCB', 'Australian Building Codes Board.'),
      record('volume-two', 'ABCB', 'Australian Building Codes Board.'),
      record('volume-one', 'Hours of operation', 'at least 20% of the peak occupancy'),
      record('volume-two', 'Hours of operation', 'greater thanat least 20% of the peak occupancy'),
    ]));
  } catch (e) { err = e; }
  assert.ok(err);
  const [a, b] = [err.message.indexOf('[A]'), err.message.indexOf('[B]')];
  assert.ok(a > -1 && b > a, err.message);
  assert.match(err.message, /\[A\] 1 path\(s\) differ ONLY in provenance frontmatter/);
  assert.match(err.message, /\[B\] 1 path\(s\) differ in BODY TEXT/);
  // The substantive one carries its evidence; the provenance one is named but not diffed.
  assert.ok(err.message.slice(b).includes('greater thanat least'), 'body conflicts show the differing text');
  assert.ok(err.message.slice(a, b).includes('abcb.md'), 'provenance conflicts are named');
});

test('every conflict is reported, not just the first — one run, one ruling', () => {
  let err;
  try {
    resolveUniqueness(emitted([
      record('volume-one', 'A', 'x'), record('volume-two', 'A', 'y'),
      record('volume-one', 'B', 'x'), record('volume-two', 'B', 'y'),
    ]));
  } catch (e) { err = e; }
  assert.match(err.message, /2025\/glossary\/a\.md/);
  assert.match(err.message, /2025\/glossary\/b\.md/);
  assert.match(err.message, /2 path/);
});

test('the write map is ordered by path, so writing is deterministic', () => {
  const out = resolveUniqueness(emitted([record('volume-one', 'Zebra', 'z'), record('volume-one', 'Alpha', 'a')]));
  assert.deepEqual([...out.write.keys()], ['2025/glossary/alpha.md', '2025/glossary/zebra.md']);
});

/* ============================================================ *
 * 4. What a run deletes before it rewrites                      *
 * ============================================================ */

const RECONCILE = {
  edition: '2025',
  editionDirs: new Set(['glossary', 'volume-one', 'volume-two']),
  ownedDirs: new Set(['glossary', 'volume-one']),
  producible: new Set(['2025/volume-one/a5g7-x.md', '2025/volume-one/c2d2-y.md', '2025/glossary/abcb.md']),
};

test('a file the current toolchain cannot produce is deleted, even inside an owned directory', () => {
  // This is the failure the whole rule exists for: a file left by an earlier slice or an earlier
  // naming rule is invisible to every test in this repo, and would ship as if it were current.
  const p = planReconcile({
    ...RECONCILE,
    present: ['2025/volume-one/', '2025/volume-one/a5g7-x.md', '2025/volume-one/a5g7-old-title.md'],
  });
  assert.deepEqual(p.removePaths, ['2025/volume-one/a5g7-old-title.md']);
  assert.deepEqual(p.keepPaths, ['2025/volume-one/a5g7-x.md']);
});

test('a file this run did not build but COULD build is kept — a slice does not delete its siblings', () => {
  // `--sections A` must not destroy the Section C files a previous `--sections C` run wrote.
  const p = planReconcile({
    ...RECONCILE,
    write: new Set(['2025/volume-one/a5g7-x.md']),
    present: ['2025/volume-one/', '2025/volume-one/a5g7-x.md', '2025/volume-one/c2d2-y.md', '2025/glossary/', '2025/glossary/abcb.md'],
  });
  assert.deepEqual(p.removePaths, []);
  assert.ok(p.keepPaths.includes('2025/volume-one/c2d2-y.md'));
  assert.ok(p.keepPaths.includes('2025/glossary/abcb.md'));
});

test('a directory belonging to a document this run did not select is left entirely alone', () => {
  const p = planReconcile({
    ...RECONCILE,
    present: ['2025/volume-two/', '2025/volume-two/h1d1-z.md'],
  });
  assert.deepEqual(p.removePaths, []);
  assert.deepEqual(p.keepPaths, ['2025/volume-two/h1d1-z.md']);
});

test('a directory no document of this edition can produce is removed whole, whatever the filters', () => {
  const p = planReconcile({
    ...RECONCILE,
    present: ['2025/volume-nine/', '2025/volume-nine/x.md', '2025/volume-one/', '2025/volume-one/nested/', '2025/volume-one/nested/y.md'],
  });
  assert.deepEqual(p.removePaths, ['2025/volume-nine/', '2025/volume-one/nested/']);
  assert.ok(!p.removePaths.some(x => x.endsWith('x.md')), 'children ride along with the directory');
});

test('the edition index survives; any other loose file at the edition root does not', () => {
  const p = planReconcile({ ...RECONCILE, present: ['2025/INDEX.md', '2025/notes.md'] });
  assert.deepEqual(p.removePaths, ['2025/notes.md']);
  assert.deepEqual(p.keepPaths, ['2025/INDEX.md']);
});

test('the plan never names a path outside its own edition', () => {
  assert.throws(() => planReconcile({ ...RECONCILE, present: ['2022/volume-one/x.md'] }), /2022/);
});

test('the plan is sorted, so two runs over the same corpus delete in the same order', () => {
  const present = ['2025/volume-one/', '2025/volume-one/z-stale.md', '2025/volume-one/a-stale.md', '2025/zz/', '2025/aa/'];
  const p = planReconcile({ ...RECONCILE, present });
  assert.deepEqual(p.removePaths, ['2025/aa/', '2025/volume-one/a-stale.md', '2025/volume-one/z-stale.md', '2025/zz/']);
  assert.deepEqual(p, planReconcile({ ...RECONCILE, present: [...present].reverse() }));
});

/* ============================================================ *
 * 5. The parity table transcribed from content-model-2025.md    *
 * ============================================================ */

test('the parity targets are transcribed correctly — independent per-document totals', () => {
  // Every number in PARITY is a transcription of docs/content-model-2025.md's measured table, and
  // a transcription error would show up as a phantom data-loss delta on a full build. These sums
  // are computed from that document's rows a second time, by hand.
  const totals = { 'volume-one': 2089, 'volume-two': 877, 'volume-three': 998, 'housing-provisions': 1142, 'livable-housing': 17 };
  assert.deepEqual([...PARITY.get('2025').keys()].sort(), Object.keys(totals).sort());
  for (const [doc, want] of Object.entries(totals)) {
    const got = [...PARITY.get('2025').get(doc).values()].reduce((a, b) => a + b, 0);
    assert.equal(got, want, `${doc}: parity rows sum to ${got}, not ${want}`);
  }
});

test('every edition with a reader has its documents, its parity table and its committed link file', () => {
  assert.ok(EDITIONS.size > 0, 'no editions registered at all');
  for (const [key, ed] of EDITIONS) {
    assert.equal(ed.year, key);
    assert.ok(Array.isArray(ed.documents) && ed.documents.length > 0, `${key}: no documents`);
    assert.equal(typeof ed.readUnits, 'function', `${key}: no reader`);
    for (const d of ed.documents) {
      // The four fields the pipeline reads off a document descriptor. A missing citationPrefix
      // makes emit.mjs throw halfway through a build; a missing cdnKey silently points every
      // figure in that document at the wrong volume's CDN directory.
      for (const f of ['key', 'cdnKey', 'citationPrefix', 'volumeLabel']) {
        assert.ok(d[f], `${key} ${d.key ?? '?'}: no ${f}`);
      }
      assert.ok(PARITY.get(key)?.get(d.key)?.size > 0, `${key}/${d.key}: no parity rows`);
    }
    assert.ok(fs.existsSync(`tools/data/weblinks-${key}.json`), `${key}: no committed link file`);
  }
});
