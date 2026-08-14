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
import {
  EDITIONS, KNOWN_EDITIONS, NULL_WEB_URL_CLAUSES, PARITY, PARITY_UNAVAILABLE, inScope,
  nullWebUrlException, parityCheck, parseArgs, planReconcile, report, resolveUniqueness,
  warningCategory, withholdPartialGlossary,
} from '../src/build.mjs';
import { DOCUMENTS_2025, readDocument2025 } from '../src/read-2025.mjs';
import { normalizeUnit, figureUrlPrefix } from '../src/normalize.mjs';
import { emitUnit } from '../src/emit.mjs';

/* ============================================================ *
 * 1. Arguments                                                  *
 * ============================================================ */

test('the bare form selects every edition that has a reader, and no filters', () => {
  const o = parseArgs([]);
  // Compared against EDITIONS *and* pinned to the literal set, so this cannot pass merely by
  // agreeing with an empty or stubbed registry.
  assert.deepEqual(o.editions, [...EDITIONS.keys()].sort());
  assert.deepEqual(o.editions, ['2022', '2025'], 'both readers have landed, so a bare build is both editions');
  assert.equal(o.volumes, null);
  assert.equal(o.sections, null);
});

test('--edition, --volumes and --sections take comma lists, in either --k v or --k=v form', () => {
  const a = parseArgs(['--edition', '2025', '--volumes', 'volume-one,volume-two', '--sections', 'A,C']);
  assert.deepEqual(a, { editions: ['2025'], volumes: ['volume-one', 'volume-two'], sections: ['A', 'C'] });
  assert.deepEqual(parseArgs(['--edition=2025', '--sections=A']), { editions: ['2025'], volumes: null, sections: ['A'] });
});

test('every known edition has a reader — and one without would be refused by name', () => {
  // The `--edition 2022` refusal this test used to assert is now UNREACHABLE, because 2022 has a
  // reader. The branch stays for the next edition to be catalogued before its reader exists (the
  // state read-2022.mjs was in for eight tasks), so what is checked here is the invariant that
  // makes it unreachable, not the dead message.
  assert.deepEqual(KNOWN_EDITIONS.filter(e => !EDITIONS.has(e)), [],
    'a KNOWN_EDITION with no EDITIONS entry is refused by parseArgs — remove it from this list only by adding its reader');
  assert.deepEqual(parseArgs(['--edition', '2022']).editions, ['2022']);
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
const LABELS = new Map([['volume-one', 'Volume One'], ['volume-two', 'Volume Two'],
  ['volume-three', 'Volume Three'], ['housing-provisions', 'Housing Provisions']]);
const CDN = 'https://cdn.aecassistant.com.au/images/ncc/2025';
const CDN_KEYS = new Map([['volume-one', 'volume1'], ['volume-two', 'volume2'],
  ['volume-three', 'volume3'], ['housing-provisions', 'housing']]);

const record = (docKey, term, body, terms = [], volume = docKey) => ({
  docKey,
  // Both are carried for the glossary fold alone: it names the documents behind a variant in
  // prose, and it has to recognise this document's own figure CDN prefix.
  docLabel: LABELS.get(docKey) ?? docKey,
  figurePrefix: `${CDN}/${CDN_KEYS.get(docKey) ?? docKey}`,
  unit: { edition: '2025', volume, kind: 'glossary', term, title: term, state: null },
  normalized: { bodyMd: body, definedTerms: terms, figures: [], warnings: [], tableRefs: [] },
  // Per-document, as the real pipeline's are: the fold has to pick ONE, and a fixture that held
  // them constant could not show which.
  emitOpts: { citationPrefix: `NCC 2025 ${docKey}`, webUrl: `https://ncc.abcb.gov.au/${docKey}` },
});

// The records the build feeds in already carry their emitted path and bytes; only a merge or the
// glossary fold re-emits. Mirroring that here keeps the fixture honest about the real call shape.
function emitted(recs) {
  return recs.map(r => ({
    ...r,
    relPath: `2025/glossary/${r.unit.term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
    content: `---\nterm: ${r.unit.term}\nsources: [${r.docKey}]\n---\n\n# ${r.unit.term}\n\n${r.normalized.bodyMd}\n`,
  }));
}

/** The `sources:` list of a written file, as an array. */
const sourcesOf = md => /^sources: \[(.*)\]$/m.exec(md)?.[1].split(', ');

test('branch 1 — a path only one unit claims is written exactly as it was emitted', () => {
  // The overwhelming majority of the corpus: one unit, one file, no re-emit. Asserted on a page
  // rather than a glossary entry because the glossary always goes through the fold (R33).
  const recs = emitted([record('volume-one', 'Overview', 'Body.')]);
  recs[0].unit = { edition: '2025', volume: 'volume-one', kind: 'page', title: 'Overview', state: null };
  const out = resolveUniqueness(recs);
  assert.equal(out.write.size, 1);
  assert.equal(out.write.get(recs[0].relPath), recs[0].content, 'the emitter\'s bytes, untouched');
  assert.deepEqual(out.glossary, []);
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
  // what makes the answer independent of the order the records ARRIVE in.
  const grouped = ['volume-one', 'volume-two'].flatMap(v => [
    record(v, 'Appropriate authority', 'Sense one.'),
    record(v, 'Appropriate authority', 'Sense two.'),
  ]);
  const out = resolveUniqueness(emitted(grouped));
  assert.equal(out.write.size, 1);
  assert.equal(out.merges.length, 1, 'reported once, not once per document');
  const md = out.write.get('2025/glossary/appropriate-authority.md');
  assert.ok(md.includes('Sense one.') && md.includes('Sense two.'));
  assert.deepEqual(sourcesOf(md), ['volume-one', 'volume-two']);
  assert.equal((md.match(/^## /gm) ?? []).length, 2, 'two senses, not two senses per document');

  // Interleaved — sense 1 of both documents, then sense 2 of both. Same answer: the grouping is
  // by document, not by arrival. (Document ORDER does matter, and deliberately so: it decides
  // which document the file is cited to. That is the next test.)
  const interleaved = [grouped[0], grouped[2], grouped[1], grouped[3]];
  assert.equal(resolveUniqueness(emitted(interleaved)).write.get('2025/glossary/appropriate-authority.md'), md);
});

test('branch 2 is GLOSSARY-ONLY — a same-document collision between two pages throws (⊕ trap 1)', () => {
  // The merge exists because a glossary term can genuinely carry two senses (R23). Applied to any
  // kind it becomes a data-loss absorber, so it is scoped to `kind === 'glossary'`. This fixture
  // IS ⊕ trap 1: Volume Two Part H6's NSW "does not apply in NSW" overview colliding with the
  // national body inside one document, which happened for real when the state token went missing
  // from the filename. Absorbing that into `## Definition 1` / `## Definition 2` and reporting one
  // informational line is precisely the silent overwrite trap 4 exists to turn into a failure.
  const page = (title, body, state) => ({
    docKey: 'volume-two',
    unit: { edition: '2025', volume: 'volume-two', kind: 'page', overview: true, title, state, containerKind: 'part', containerNum: 'H6' },
    normalized: { bodyMd: body, definedTerms: [], figures: [], warnings: [], tableRefs: [] },
    emitOpts: { citationPrefix: 'NCC 2025 V2', webUrl: 'https://ncc.abcb.gov.au/x' },
    relPath: '2025/volume-two/part-h6-energy-efficiency.md',
    content: `---\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`,
  });
  let err;
  try {
    resolveUniqueness([
      page('Energy efficiency', 'The national Part H6 provisions apply.', null),
      page('Energy efficiency', 'This Part been deliberately left blank.', 'NSW'),
    ]);
  } catch (e) { err = e; }
  assert.ok(err, 'a non-glossary same-document collision must throw, not merge');
  assert.ok(!err.message.includes('## Definition'), 'it must not be absorbed into a merged file');
  assert.match(err.message, /2025\/volume-two\/part-h6-energy-efficiency\.md/);
  assert.match(err.message, /volume-two/);
  assert.match(err.message, /NSW/, 'the report names the units, so the lost attribute is visible');
  assert.match(err.message, /deliberately left blank/, 'and shows the differing text');
});

test('a same-document collision mixing a glossary entry with another kind throws too', () => {
  // Merging is scoped to collisions where EVERY colliding unit is a glossary entry. A glossary
  // term sharing a filename with a clause is a naming failure, not a term with two senses.
  const at = (kind, body, extra) => ({
    docKey: 'volume-one',
    unit: { edition: '2025', volume: 'volume-one', kind, title: 'X', state: null, ...extra },
    normalized: { bodyMd: body, definedTerms: [], figures: [], warnings: [], tableRefs: [] },
    emitOpts: { citationPrefix: 'NCC 2025 V1', webUrl: 'https://ncc.abcb.gov.au/x' },
    relPath: '2025/volume-one/x.md',
    content: `---\ntitle: X\n---\n\n# X\n\n${body}\n`,
  });
  assert.throws(
    () => resolveUniqueness([at('glossary', 'a term', { term: 'X' }), at('clause', 'a clause', { id: 'X1' })]),
    /collide INSIDE one document/,
  );
});

/* -- branch 4: the glossary fold (R33) -- */

test('branch 4 — every volume\'s copy of one term folds into ONE file, cited to the first', () => {
  // The glossary is embedded in every volume, so four documents claim one path and none of the
  // four copies is byte-identical to another: `citation:`, `web_url:` and `sources:` are
  // per-document by construction. The body is what decides, and when it agrees the file is the
  // FIRST document's copy — a deterministic choice, not an arbitrary one.
  const out = resolveUniqueness(emitted(['volume-one', 'volume-two', 'volume-three', 'housing-provisions']
    .map(v => record(v, 'ABCB', 'Australian Building Codes Board.'))));
  assert.equal(out.write.size, 1);
  const md = out.write.get('2025/glossary/abcb.md');
  assert.deepEqual(sourcesOf(md), ['volume-one', 'volume-two', 'volume-three', 'housing-provisions']);
  assert.match(md, /citation: "NCC 2025 volume-one Glossary: ABCB"/, 'cited to the first document, deterministically');
  assert.match(md, /web_url: https:\/\/ncc\.abcb\.gov\.au\/volume-one/);
  assert.ok(md.includes('Australian Building Codes Board.'));
  assert.ok(!md.includes('## '), 'one body, so no variant headings');
  assert.deepEqual(out.glossary, [{
    relPath: '2025/glossary/abcb.md',
    sources: ['volume-one', 'volume-two', 'volume-three', 'housing-provisions'],
    variants: 1,
    figureNormalised: false,
    documents: [['volume-one', 'volume-two', 'volume-three', 'housing-provisions']],
  }]);
});

test('branch 4 — a figure URL differing only in OUR per-volume CDN key is not a difference', () => {
  // Each volume ships its own copy of the glossary figures, so this pipeline addresses the same
  // figure as …/volume1/x.svg from Volume One and …/volume2/x.svg from Volume Two. Nine 2025
  // entries differ across the four documents in nothing else. Reading that as text the Code
  // publishes differently would put nine spurious "as published in …" merges in the corpus.
  const body = v => `![Figure 1: Alpine areas](${CDN}/${v}/image-1-alpine-areas.svg)`;
  const out = resolveUniqueness(emitted([
    record('volume-one', 'Alpine area', body('volume1')),
    record('volume-two', 'Alpine area', body('volume2')),
    record('housing-provisions', 'Alpine area', body('housing')),
  ]));
  const md = out.write.get('2025/glossary/alpine-area.md');
  assert.equal(out.glossary[0].variants, 1);
  assert.equal(out.glossary[0].figureNormalised, true, 'reported, because it is our artefact and not the source\'s');
  assert.ok(!md.includes('## '), 'no variant headings');
  // The URL that ships is the FIRST document's, matching citation: and web_url:. It is the only
  // one that can be right: sync-figures uploads each document's images under its own CDN key.
  assert.ok(md.includes(`${CDN}/volume1/image-1-alpine-areas.svg`), md);
  assert.ok(!md.includes('volume2') && !md.includes('housing/'), md);
});

test('branch 4 — a figure with a DIFFERENT filename is still a real difference', () => {
  // The neutralisation removes the emitting document's own prefix and nothing else, so it cannot
  // hide two documents citing two different figures.
  const out = resolveUniqueness(emitted([
    record('volume-one', 'Foundation', `![Figure 5](${CDN}/volume1/image-5-foundation.svg)`),
    record('volume-two', 'Foundation', `![Figure 5](${CDN}/volume2/image-9-something-else.svg)`),
  ]));
  const md = out.write.get('2025/glossary/foundation.md');
  assert.equal(out.glossary[0].variants, 2);
  assert.ok(md.includes('image-5-foundation.svg') && md.includes('image-9-something-else.svg'), md);
  // …and BOTH are addressed under the CANONICAL document's CDN key. The file is cited to Volume One
  // and lives in one directory, so a volume2 URL inside it would break the one-directory-one-cdnKey
  // invariant the corpus is checked on — a figure attributed to a volume the file does not come
  // from. No 2025 entry is both multi-variant and figure-bearing, so this is the shape a future
  // edition would arrive in rather than a live case.
  assert.ok(md.includes(`${CDN}/volume1/image-9-something-else.svg`), md);
  assert.ok(!md.includes(`${CDN}/volume2/`), `a non-canonical CDN key survived the merge:\n${md}`);
});

test('branch 4 — text the documents genuinely publish differently ships as BOTH, labelled', () => {
  // MEASURED across all five 2025 documents: exactly one of the 555 shared paths, "Hours of
  // operation", where Volumes Two and Three carry an ABCB typo the other documents do not.
  // Emitting one volume's wording drops the other's; one file per variant hides the discrepancy
  // behind a filename nobody globs for. An agent grepping the term must see that the Code
  // disagrees with itself.
  const out = resolveUniqueness(emitted([
    record('volume-one', 'Hours of operation', 'the period is at least 20% of the peak occupancy'),
    record('volume-two', 'Hours of operation', 'the period is greater thanat least 20% of the peak occupancy'),
    record('volume-three', 'Hours of operation', 'the period is greater thanat least 20% of the peak occupancy'),
    record('housing-provisions', 'Hours of operation', 'the period is at least 20% of the peak occupancy'),
  ]));
  assert.equal(out.write.size, 1);
  const md = out.write.get('2025/glossary/hours-of-operation.md');
  assert.equal((md.match(/^---$/gm) ?? []).length, 2, 'exactly one frontmatter block');
  assert.equal((md.match(/^# /gm) ?? []).length, 1, 'exactly one H1');
  assert.match(md, /^## As published in Volume One and Housing Provisions$/m);
  assert.match(md, /^## As published in Volume Two and Volume Three$/m);
  assert.ok(md.includes('is at least 20%') && md.includes('greater thanat least 20%'), 'neither wording is dropped');
  assert.ok(md.indexOf('## As published in Volume One') < md.indexOf('## As published in Volume Two'), 'document order');
  assert.deepEqual(sourcesOf(md), ['volume-one', 'volume-two', 'volume-three', 'housing-provisions']);
  assert.deepEqual(out.glossary[0].documents,
    [['volume-one', 'housing-provisions'], ['volume-two', 'volume-three']]);
  assert.equal(out.glossary[0].variants, 2);
});

test('branch 4 — a glossary record with no figurePrefix throws rather than mis-classifying', () => {
  // Without the prefix the fold cannot tell "the same figure under this volume's CDN key" from "a
  // different figure", and would report every figure-bearing entry as a published difference.
  const recs = emitted([
    record('volume-one', 'Alpine area', `![Figure 1](${CDN}/volume1/x.svg)`),
    record('volume-two', 'Alpine area', `![Figure 1](${CDN}/volume2/x.svg)`),
  ]);
  delete recs[1].figurePrefix;
  assert.throws(() => resolveUniqueness(recs), /carries no figurePrefix/);
});

test('the glossary fold is scoped to the glossary — any other cross-document conflict still throws', () => {
  // No non-glossary kind can reach this today: `unitRelPath` files every other unit under its own
  // volume directory, so two documents cannot claim one path. The guard is for the day a naming
  // rule changes and they can — folding a clause would fabricate text the Code does not publish.
  const page = (docKey, body) => ({
    docKey,
    docLabel: LABELS.get(docKey),
    figurePrefix: `${CDN}/${CDN_KEYS.get(docKey)}`,
    unit: { edition: '2025', volume: docKey, kind: 'page', title: 'Introduction', state: null },
    normalized: { bodyMd: body, definedTerms: [], figures: [], warnings: [], tableRefs: [] },
    emitOpts: { citationPrefix: `NCC 2025 ${docKey}`, webUrl: 'https://ncc.abcb.gov.au/x' },
    relPath: '2025/shared/page-introduction.md',
    content: `---\ntitle: Introduction\nvolume: ${docKey}\n---\n\n# Introduction\n\n${body}\n`,
  });
  assert.throws(() => resolveUniqueness([page('volume-one', 'One.'), page('volume-two', 'Two.')]),
    /claimed by more than one unit with DIFFERENT content/);
});

test('a conflict that is only provenance is reported as its own class, not mixed with real text differences', () => {
  // The two classes need different rulings — one provenance decision taken once, versus a reading
  // of the published text per path — so a flat list would bury the ones that matter. Exercised on
  // pages because the glossary, which was the measured instance, is now folded by rule.
  const page = (docKey, title, body) => ({
    docKey,
    docLabel: LABELS.get(docKey),
    unit: { edition: '2025', volume: docKey, kind: 'page', title, state: null },
    normalized: { bodyMd: body, definedTerms: [], figures: [], warnings: [], tableRefs: [] },
    emitOpts: { citationPrefix: `NCC 2025 ${docKey}`, webUrl: 'https://ncc.abcb.gov.au/x' },
    relPath: `2025/shared/page-${title.toLowerCase()}.md`,
    content: `---\ntitle: ${title}\nvolume: ${docKey}\n---\n\n# ${title}\n\n${body}\n`,
  });
  let err;
  try {
    resolveUniqueness([
      page('volume-one', 'abcb', 'Australian Building Codes Board.'),
      page('volume-two', 'abcb', 'Australian Building Codes Board.'),
      page('volume-one', 'hours', 'at least 20% of the peak occupancy'),
      page('volume-two', 'hours', 'greater thanat least 20% of the peak occupancy'),
    ]);
  } catch (e) { err = e; }
  assert.ok(err);
  const [a, b] = [err.message.indexOf('[A]'), err.message.indexOf('[B]')];
  assert.ok(a > -1 && b > a, err.message);
  assert.match(err.message, /\[A\] 1 path\(s\) differ ONLY in provenance frontmatter/);
  assert.match(err.message, /\[B\] 1 path\(s\) differ in BODY TEXT/);
  // The substantive one carries its evidence; the provenance one is named but not diffed.
  assert.ok(err.message.slice(b).includes('greater thanat least'), 'body conflicts show the differing text');
  assert.ok(err.message.slice(a, b).includes('page-abcb.md'), 'provenance conflicts are named');
});

test('every conflict is reported, not just the first — one run, one ruling', () => {
  const page = (docKey, title, body) => ({
    docKey,
    unit: { edition: '2025', volume: docKey, kind: 'page', title, state: null },
    normalized: { bodyMd: body, definedTerms: [], figures: [], warnings: [], tableRefs: [] },
    emitOpts: { citationPrefix: 'NCC 2025 V1', webUrl: 'https://ncc.abcb.gov.au/x' },
    relPath: `2025/shared/${title}.md`,
    content: `---\ntitle: ${title}\nvolume: ${docKey}\n---\n\n${body}\n`,
  });
  let err;
  try {
    resolveUniqueness([
      page('volume-one', 'a', 'x'), page('volume-two', 'a', 'y'),
      page('volume-one', 'b', 'x'), page('volume-two', 'b', 'y'),
    ]);
  } catch (e) { err = e; }
  assert.match(err.message, /2025\/shared\/a\.md/);
  assert.match(err.message, /2025\/shared\/b\.md/);
  assert.match(err.message, /2 path/);
});

test('the write map is ordered by path, so writing is deterministic', () => {
  const out = resolveUniqueness(emitted([record('volume-one', 'Zebra', 'z'), record('volume-one', 'Alpha', 'a')]));
  assert.deepEqual([...out.write.keys()], ['2025/glossary/alpha.md', '2025/glossary/zebra.md']);
});

/* ============================================================ *
 * 4. What a run deletes before it rewrites                      *
 * ============================================================ */

/* -- the fold against the real five documents -- */

test('branch 4 — the fold classifies the REAL 2025 glossary exactly as it was measured',
  { skip: !fs.existsSync('.cache/extracted/ncc-2025-volume-one-v1.2/contents.xml') }, () => {
    // The fixtures above prove the RULE; this proves the rule still meets the DATA. Every number
    // is docs/content-model-2025.md § The glossary across volumes, pinned here so a future change
    // to normalize.mjs that made two volumes' copies of an entry diverge — or that made the nine
    // figure-key entries stop collapsing — goes red with the count rather than quietly reshaping
    // the corpus. It skips where `.cache/` is absent, as every source-reading test here does.
    const records = [];
    for (const doc of DOCUMENTS_2025) {
      const units = readDocument2025(fs.readFileSync(`.cache/extracted/${doc.pkg}/contents.xml`, 'utf8'), doc);
      for (const unit of units.filter(u => u.kind === 'glossary')) {
        const normalized = normalizeUnit(unit, { year: '2025', cdnKey: doc.cdnKey });
        const emitOpts = { citationPrefix: doc.citationPrefix, webUrl: `https://ncc.abcb.gov.au/${doc.key}` };
        records.push({
          ...emitUnit(unit, normalized, emitOpts),
          docKey: doc.key,
          docLabel: doc.volumeLabel,
          figurePrefix: figureUrlPrefix({ year: '2025', cdnKey: doc.cdnKey }),
          unit,
          normalized,
          emitOpts,
        });
      }
    }
    assert.equal(records.length, 2224, '556 entries in each of the four documents that carry a glossary');

    const out = resolveUniqueness(records);
    const g = out.glossary;
    assert.equal(g.length, 555, 'one path per term; "Appropriate authority" is two senses on one path');
    assert.equal(out.write.size, 555);
    assert.ok(g.every(x => x.sources.length === 4), 'every term is published by all four documents');
    assert.equal(g.filter(x => x.variants === 1 && !x.figureNormalised).length, 545, 'body-identical');
    assert.deepEqual(g.filter(x => x.figureNormalised).map(x => x.relPath), [
      '2025/glossary/alpine-area.md', '2025/glossary/cell-type-silo-sa.md', '2025/glossary/climate-zone.md',
      '2025/glossary/defined-flood-level-dfl.md', '2025/glossary/flight.md', '2025/glossary/floor-area.md',
      '2025/glossary/foundation.md', '2025/glossary/sanitary-compartment.md', '2025/glossary/separating-wall.md',
    ], 'differ only in OUR per-volume figure CDN key');

    // The single genuine divergence: an unresolved ABCB edit in Volumes Two and Three.
    const differ = g.filter(x => x.variants > 1);
    assert.equal(differ.length, 1);
    assert.equal(differ[0].relPath, '2025/glossary/hours-of-operation.md');
    assert.deepEqual(differ[0].documents, [['volume-one', 'housing-provisions'], ['volume-two', 'volume-three']]);
    const md = out.write.get('2025/glossary/hours-of-operation.md');
    assert.ok(md.includes('is at least 20% of the peak occupancy'), md);
    assert.ok(md.includes('is greater thanat least 20% of the peak occupancy'), md);
    assert.deepEqual(out.merges.map(m => m.relPath), ['2025/glossary/appropriate-authority.md']);

    // Every figure the folded corpus publishes must exist in the images/ directory of the document
    // it is now attributed to — the fold points nine entries at Volume One's CDN key, and a key
    // with no local file behind it is a figure that can never be uploaded.
    const listing = new Set(fs.readdirSync('.cache/extracted/ncc-2025-volume-one-v1.2/images'));
    const urls = new Set();
    for (const content of out.write.values()) {
      for (const m of content.matchAll(/https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/([^/]+)\/([^)\s]+)/g)) urls.add(`${m[1]}/${m[2]}`);
    }
    assert.ok(urls.size >= 10, `only ${urls.size} figure URLs in the folded glossary`);
    for (const u of [...urls].sort()) {
      const [key, file] = u.split('/');
      assert.equal(key, 'volume1', `${u}: the folded glossary is attributed to Volume One`);
      assert.ok(listing.has(decodeURIComponent(file)), `${u}: no such file in ncc-2025-volume-one-v1.2/images/`);
    }
  });

/* -- a partial run does not rewrite the glossary -- */

const DOCS5 = ['volume-one', 'volume-two', 'volume-three', 'housing-provisions', 'livable-housing'];
const GUARD = () => ({
  all: DOCS5,
  glossaryDirs: new Set(['glossary']),
  ownedDirs: new Set(['volume-two', 'glossary']),
  write: new Map([
    ['2025/volume-two/h6d1-x.md', 'clause'],
    ['2025/glossary/hours-of-operation.md', 'only volume two\'s wording'],
    ['2025/glossary/abcb.md', 'agreed'],
  ]),
});

test('a run that did not read every document withholds the glossary instead of narrowing it', () => {
  // THE MEASURED FAILURE, on the real corpus, before this guard: `--volumes volume-two` rewrote
  // 2025/glossary/hours-of-operation.md with only the Volume Two wording — both
  // `## As published in …` headings gone, Volume One's sentence deleted, nothing asserting. That is
  // the silent drop R33 exists to prevent, from a supported command. `foldGlossary` takes each
  // entry's wording from the documents the run READ, so a run that read one of five must not
  // rewrite a file assembled from four.
  const g = withholdPartialGlossary({ selected: ['volume-two'], ...GUARD() });
  assert.equal(g.owned, false);
  assert.deepEqual(g.withheld, ['2025/glossary/abcb.md', '2025/glossary/hours-of-operation.md']);
  assert.deepEqual([...g.write.keys()], ['2025/volume-two/h6d1-x.md'], 'the volume it DID read is still written');
  // Dropping the directory from ownedDirs is what leaves the files alone: planReconcile keeps
  // everything in a directory this run does not own, and report() prints it under `not audited`.
  assert.deepEqual([...g.ownedDirs], ['volume-two']);
  assert.deepEqual(planReconcile({
    edition: '2025',
    editionDirs: new Set(['glossary', 'volume-two']),
    ownedDirs: g.ownedDirs,
    producible: new Set(['2025/volume-two/h6d1-x.md']),
    present: ['2025/glossary/', '2025/glossary/hours-of-operation.md', '2025/volume-two/', '2025/volume-two/h6d1-x.md'],
  }).removePaths, [], 'and nothing is deleted either');
});

test('ownership is exact set equality, so naming every document explicitly is not punished', () => {
  // `opts.volumes == null` would be the easy test and would make an explicit full list behave like
  // a slice, leaving the glossary permanently stale for anyone who spells the run out.
  const full = withholdPartialGlossary({ selected: [...DOCS5], ...GUARD() });
  assert.equal(full.owned, true);
  assert.deepEqual(full.withheld, []);
  assert.equal(full.write.size, 3);
  assert.deepEqual([...full.ownedDirs].sort(), ['glossary', 'volume-two']);
  // Order must not matter, and four of five is still partial even though it is every document that
  // HAS a glossary — which those are is a property of data a partial run did not read.
  assert.equal(withholdPartialGlossary({ selected: [...DOCS5].reverse(), ...GUARD() }).owned, true);
  assert.equal(withholdPartialGlossary({ selected: DOCS5.slice(0, 4), ...GUARD() }).owned, false);
});

test('a partial run with no glossary units is left alone — nothing to withhold', () => {
  // `--volumes livable-housing` reads a document with no glossary at all, and `--sections A` emits
  // none. Neither must lose its own output to a guard aimed at a directory it never touches.
  const g = withholdPartialGlossary({
    selected: ['livable-housing'], ...GUARD(), glossaryDirs: new Set(), ownedDirs: new Set(['livable-housing']),
  });
  assert.equal(g.owned, false);
  assert.deepEqual(g.withheld, []);
  assert.equal(g.write.size, 3);
});

test('the guard does not mutate what it is handed — a report may still describe the full run', () => {
  const args = { selected: ['volume-two'], ...GUARD() };
  const before = [...args.write.keys()];
  withholdPartialGlossary(args);
  assert.deepEqual([...args.write.keys()], before);
  assert.deepEqual([...args.ownedDirs].sort(), ['glossary', 'volume-two']);
});

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

// A document that reconciles perfectly: every expected row met by units alone. Derived FROM the
// parity table, so these fixtures also prove the check compares against the real transcription.
const reconciling = (docKey = 'volume-one') =>
  new Map([[docKey, { units: new Map(PARITY.get('2025').get(docKey)), tableRefs: new Map(), full: true }]]);

test('a parity delta is an ERROR, not an advisory — data loss must stop a bulk run', () => {
  assert.equal(parityCheck('2025', reconciling()), null, 'a reconciling document must not report');

  const short = reconciling();
  short.get('volume-one').units.set('subtopic', 868 - 8);      // eight units lost
  const err = parityCheck('2025', short);
  assert.ok(err, 'a delta must be reported as a failure');
  assert.equal(err.split('\n').length, 2, 'only the disagreeing row is listed');
  assert.match(err, /volume-one/);
  assert.match(err, /subtopic/);
  assert.match(err, /expected 868/);
  assert.match(err, /delta -8/);
});

test('units and inline table-references are summed before comparing (R5)', () => {
  // volume-one's `clause` row is 103 nested clause-variations + 233 inline table-references = 336.
  // Either column alone is a delta; only the sum reconciles.
  const split = new Map([['volume-one', {
    units: new Map(PARITY.get('2025').get('volume-one')).set('clause', 103),
    tableRefs: new Map([['clause', 233]]),
    full: true,
  }]]);
  assert.equal(parityCheck('2025', split), null);
});

test('a slice is not parity-checked — the target counts whole documents', () => {
  const sliced = new Map([['volume-one', { units: new Map([['subtopic', 35]]), tableRefs: new Map(), full: false }]]);
  assert.equal(parityCheck('2025', sliced), null);
});

test('an edition whose parity target is not transcribable is exempted BY NAME, with a reason', () => {
  // 2022 has no equivalent of the 2025 table (see PARITY_UNAVAILABLE for the measurement). The
  // exemption is enumerated so that a future edition with a missing table still fails loudly:
  // without it, `PARITY.get(ed) ?? new Map()` turns every unit into a positive delta, which is the
  // correct behaviour for "nobody transcribed the table yet".
  const full = new Map([['volume-one', { units: new Map([['#document', 1250]]), tableRefs: new Map(), full: true }]]);
  assert.equal(parityCheck('2022', full), null, '2022 is exempt — its census is checked in read-2022.test.mjs');
  const err = parityCheck('2028', full);
  assert.ok(err, 'an edition that is neither transcribed nor exempted must still fail on its units');
  assert.match(err, /delta \+1250/);
  for (const [ed, why] of PARITY_UNAVAILABLE) {
    assert.ok(EDITIONS.has(ed), `${ed}: exempted from parity but has no reader`);
    assert.ok(!PARITY.has(ed), `${ed}: both transcribed and exempted — one of the two is wrong`);
    assert.ok(String(why).length > 200, `${ed}: an exemption needs the measurement that justifies it, not a label`);
  }
});

test('a parent the content model does not list at all is a delta, not a silent extra', () => {
  const extra = reconciling();
  extra.get('volume-one').units.set('made-up-parent', 3);
  const err = parityCheck('2025', extra);
  assert.match(err, /made-up-parent/);
  assert.match(err, /delta \+3/);
});

/* ============================================================ *
 * 6. R50 — the enumerated null-web_url exceptions               *
 * ============================================================ */

test('every null-web_url exception names an edition, a volume, a clause, a state and its evidence', () => {
  assert.ok(NULL_WEB_URL_CLAUSES.length > 0, 'the list is empty — delete it rather than leaving a stub');
  for (const e of NULL_WEB_URL_CLAUSES) {
    for (const k of ['edition', 'volume', 'clause', 'evidence']) {
      assert.ok(typeof e[k] === 'string' && e[k].trim(), `${JSON.stringify(e)}: no ${k}`);
    }
    // `state` may be null (a national clause the site does not publish), but it must be STATED:
    // an omitted key would silently exempt every jurisdiction's copy of that clause.
    assert.ok('state' in e, `${JSON.stringify(e)}: no state key — write null if the clause is national`);
    assert.ok(EDITIONS.has(e.edition), `${e.clause}: exception for edition ${e.edition}, which has no reader`);
    assert.ok(e.evidence.length > 60, `${e.clause}: the evidence line must say what was checked and what it showed`);
  }
});

test('an exception applies to exactly one edition+volume+clause+state — anything else still fails', () => {
  const entry = NULL_WEB_URL_CLAUSES[0];
  const unit = { volume: entry.volume, id: entry.clause, state: entry.state, kind: 'clause' };
  assert.equal(nullWebUrlException(entry.edition, unit), entry, 'the enumerated case must be recognised');
  // Each of the four keys, varied alone. A matcher loose on any one of them exempts a clause
  // nobody ruled on — which is the whole failure mode R50's list exists to avoid.
  assert.equal(nullWebUrlException('2025', unit), null);
  assert.equal(nullWebUrlException(entry.edition, { ...unit, volume: 'volume-one' }), null);
  assert.equal(nullWebUrlException(entry.edition, { ...unit, id: 'A1G1' }), null);
  assert.equal(nullWebUrlException(entry.edition, { ...unit, state: 'VIC' }), null);
  assert.equal(nullWebUrlException(entry.edition, { ...unit, state: null }), null);
  // Case is the reader's convention, not a distinction: the corpus writes `TAS`, and an entry
  // that matched only one spelling would fail the build the day a reader lowercased it.
  if (entry.state) assert.equal(nullWebUrlException(entry.edition, { ...unit, state: entry.state.toLowerCase() }), entry);
});

test('a warning with no colon keeps its whole name — indexOf(-1) must not eat the last character', () => {
  assert.equal(warningCategory('mathml-flattened: R/S'), 'mathml-flattened');
  assert.equal(warningCategory('mathml-flattened'), 'mathml-flattened');
  assert.equal(warningCategory(': leading colon'), 'uncategorised');
  assert.equal(warningCategory(''), 'uncategorised');
});

test('the report does not deref a null io — an edition that passed inside a failing run', () => {
  // main() reports every edition when ANY of them fails, so a PASSING edition is rendered with
  // io === null. Unreachable while EDITIONS holds one edition; reachable the moment a second
  // reader lands.
  const built = {
    editionKey: '2025',
    failures: [],
    editionDirs: new Set(['volume-one']),
    ownedDirs: new Set(['volume-one']),
    unresolvedOther: [],
    stats: {
      perDoc: [{ key: 'volume-one', read: 10, scoped: 10, figures: 0, warnings: 0 }],
      kinds: new Map([['clause', 10]]),
      warnings: new Map(),
      figures: new Set(),
      webUrl: new Map([['clause', { resolved: 10, total: 10 }]]),
      parity: new Map([['volume-one', { units: new Map(), tableRefs: new Map(), full: false }]]),
      duplicates: 0, merges: [], paths: 10,
    },
  };
  const text = report(built, null, { volumes: null, sections: null });
  assert.match(text, /NOT WRITTEN/);
  assert.match(text, /clause 10\/10/);
});

test('a citation the source itself drops is REPORTED, not merely recorded in a diagnostics object', () => {
  // Task 10 records every citation lost because the cited wrapper holds no NCC 2022 content (its
  // <table>/<image> children are all NCC 2025 draft). Nothing consumed that record, so the loss —
  // B1P1 shipping without all three minimum-annual-reliability-index tables — was invisible to
  // anyone running a build. The report is where it becomes visible.
  const built = {
    editionKey: '2022',
    failures: [],
    editionDirs: new Set(['volume-one']),
    ownedDirs: new Set(['volume-one']),
    unresolvedOther: [],
    droppedCitations: [
      { doc: 'volume-one', host: 'B1P1-structural-reliability.xml', wrapper: 'table-B1P1a-minimum-annual-reliability-indices.xml', kind: 'table' },
      { doc: 'volume-one', host: 'F8D5-ventilation.xml', wrapper: 'image-F8D5c Example of a multi-pitched roof space.xml', kind: 'image' },
    ],
    permittedNullClauses: [],
    stats: {
      perDoc: [{ key: 'volume-one', read: 10, scoped: 10, figures: 0, warnings: 0 }],
      kinds: new Map([['clause', 10]]),
      warnings: new Map(),
      figures: new Set(),
      webUrl: new Map([['clause', { resolved: 10, total: 10 }]]),
      parity: new Map([['volume-one', { units: new Map(), tableRefs: new Map(), full: false }]]),
      duplicates: 0, merges: [], paths: 10,
    },
  };
  const text = report(built, { written: 10, removedFiles: 0, removedDirs: 0, kept: 0 }, { volumes: null, sections: null });
  assert.match(text, /DROPPED CITATIONS — 2/);
  assert.match(text, /image 1 · table 1/);   // codepoint order, never localeCompare
  assert.match(text, /B1P1-structural-reliability\.xml/);
  assert.match(text, /table-B1P1a-minimum-annual-reliability-indices\.xml/);
  // The 2025 reader records none, and a block that vanished when the count was zero would read as
  // "this build has no such losses" and as "this build does not look" in exactly the same way.
  const none = report({ ...built, droppedCitations: [] }, null, { volumes: null, sections: null });
  assert.match(none, /DROPPED CITATIONS — 0/);
});

test('a permitted null web_url is printed — an exception nobody can see is a hole, not a ruling', () => {
  const entry = NULL_WEB_URL_CLAUSES[0];
  const built = {
    editionKey: entry.edition,
    failures: [],
    editionDirs: new Set([entry.volume]),
    ownedDirs: new Set([entry.volume]),
    unresolvedOther: [],
    droppedCitations: [],
    permittedNullClauses: [{ doc: entry.volume, unit: { id: entry.clause, state: entry.state, sectionNum: 'E' }, exception: entry }],
    stats: {
      perDoc: [{ key: entry.volume, read: 1, scoped: 1, figures: 0, warnings: 0 }],
      kinds: new Map([['clause', 1]]),
      warnings: new Map(),
      figures: new Set(),
      webUrl: new Map([['clause', { resolved: 0, total: 1 }]]),
      parity: new Map([[entry.volume, { units: new Map(), tableRefs: new Map(), full: false }]]),
      duplicates: 0, merges: [], paths: 1,
    },
  };
  const text = report(built, null, { volumes: null, sections: null });
  assert.match(text, /PERMITTED null web_url/);
  assert.match(text, new RegExp(entry.clause));
});

test('every edition with a reader has its documents, its parity target and its committed link file', () => {
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
      // Either a transcribed parity table for every document, or a named exemption carrying the
      // measurement that justifies it. Silence is the one thing that is not allowed: it would let
      // a bulk run's data loss pass as a clean build.
      assert.ok(PARITY.get(key)?.get(d.key)?.size > 0 || PARITY_UNAVAILABLE.has(key),
        `${key}/${d.key}: no parity rows and no PARITY_UNAVAILABLE entry`);
    }
    assert.ok(fs.existsSync(`tools/data/weblinks-${key}.json`), `${key}: no committed link file`);
  }
});
