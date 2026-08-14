// index.test.mjs — the two browsable maps.
//
// INDEX.md is the fallback for the search an agent cannot phrase: it knows a clause ID or a term
// but not the wording. So the per-edition index is asserted line by line, and the root index is
// asserted to be a pure function of counts and constants — anything environment-dependent in it
// (a timestamp, a machine path) would make CI's `git diff --exit-code -- corpus/` fail on a
// machine that is not the one that last built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMENDMENTS, SOURCE_RELEASE, buildIndexes } from '../src/index.mjs';

const entry = o => ({ kind: 'clause', id: null, term: null, title: '', state: null, ...o });

const A5G7 = entry({
  relPath: '2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md',
  id: 'A5G7', title: 'Resistance to the incipient spread of fire',
});
const A5G4_VIC = entry({
  relPath: '2025/volume-one/a5g4-vic-watermark-certification-scheme.md',
  id: 'A5G4', title: 'WaterMark Certification Scheme', state: 'VIC',
});
const TERM = entry({
  relPath: '2025/glossary/abcb.md', kind: 'glossary', term: 'ABCB', title: 'ABCB',
});
const PAGE = entry({
  relPath: '2025/volume-one/part-a1-interpreting-the-ncc.md', kind: 'page',
  title: 'Interpreting the NCC',
});

const TREE = [
  { dir: '2025/glossary', files: 1 },
  { dir: '2025/volume-one', files: 3 },
];

const build = (entries, opts = {}) =>
  buildIndexes(new Map([['2025', entries]]), { tree: TREE, ...opts });

const byPath = out => new Map(out.map(f => [f.relPath, f.content]));

/* ============================================================ *
 * 1. Shape of the return value                                  *
 * ============================================================ */

const A5G7_2022 = entry({ ...A5G7, relPath: A5G7.relPath.replace('2025/', '2022/') });

test('returns the root index first, then one index per edition, corpus-relative with / separators', () => {
  const out = buildIndexes(new Map([['2025', [A5G7]], ['2022', [A5G7_2022]]]), { tree: TREE });
  assert.deepEqual(out.map(f => f.relPath), ['INDEX.md', '2022/INDEX.md', '2025/INDEX.md']);
  for (const f of out) {
    assert.ok(!f.relPath.includes('\\'), `${f.relPath}: backslash in a corpus path`);
    assert.equal(f.content.at(-1), '\n', `${f.relPath}: must end with exactly one newline`);
    assert.ok(!f.content.includes('\r'), `${f.relPath}: CR byte`);
    assert.ok(!f.content.endsWith('\n\n'), `${f.relPath}: trailing blank line`);
  }
});

test('editions are emitted in codepoint order regardless of insertion order', () => {
  const out = buildIndexes(new Map([['2025', [A5G7]], ['2022', [A5G7_2022]]]), { tree: TREE });
  const out2 = buildIndexes(new Map([['2022', [A5G7_2022]], ['2025', [A5G7]]]), { tree: TREE });
  assert.deepEqual(out.map(f => f.relPath), out2.map(f => f.relPath));
  assert.deepEqual(out.map(f => f.content), out2.map(f => f.content));
});

/* ============================================================ *
 * 2. The per-edition map — one line per unit                    *
 * ============================================================ */

test('one line per unit: {id or term} -> {edition-relative path} -- {title}', () => {
  const md = byPath(build([A5G7])).get('2025/INDEX.md');
  assert.ok(
    md.includes('A5G7 → volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md — Resistance to the incipient spread of fire'),
    md,
  );
  // The path is relative to the index's own directory, so it resolves as a link from corpus/2025/.
  assert.ok(!md.includes('2025/volume-one/a5g7'), 'path must not repeat the edition segment');
});

test('a state variation carries its jurisdiction in the label, so the two lines are distinguishable', () => {
  const md = byPath(build([A5G7, A5G4_VIC])).get('2025/INDEX.md');
  assert.ok(md.includes('A5G4 (VIC) → volume-one/a5g4-vic-watermark-certification-scheme.md — WaterMark Certification Scheme'), md);
  // Still greppable by the bare clause ID.
  assert.equal(md.split('\n').filter(l => l.startsWith('A5G4')).length, 1);
});

test('the national clause is listed before its state variations, not after', () => {
  // Sorting the rendered line would put `A5G4 (VIC)` first, because `(` is a lower codepoint than
  // the arrow. Deterministic either way, but backwards to read.
  const nat = entry({ relPath: '2025/volume-one/a5g4-x.md', id: 'A5G4', title: 'X' });
  const vic = entry({ relPath: '2025/volume-one/a5g4-vic-x.md', id: 'A5G4', title: 'X', state: 'VIC' });
  const nsw = entry({ relPath: '2025/volume-one/a5g4-nsw-x.md', id: 'A5G4', title: 'X', state: 'NSW' });
  const md = byPath(build([vic, nat, nsw])).get('2025/INDEX.md');
  const lines = md.split('\n').filter(l => l.startsWith('A5G4'));
  assert.deepEqual(lines.map(l => l.slice(0, l.indexOf(' →'))), ['A5G4', 'A5G4 (NSW)', 'A5G4 (VIC)']);
});

test('a glossary entry is labelled by its term and a page by its title', () => {
  const md = byPath(build([TERM, PAGE])).get('2025/INDEX.md');
  assert.ok(md.includes('ABCB → glossary/abcb.md — ABCB'), md);
  assert.ok(md.includes('Interpreting the NCC → volume-one/part-a1-interpreting-the-ncc.md — Interpreting the NCC'), md);
});

test('a unit with no title at all still gets a line — the label and path alone', () => {
  const bare = entry({ relPath: '2025/volume-one/j3d6.md', id: 'J3D6', title: '' });
  const md = byPath(build([bare])).get('2025/INDEX.md');
  assert.ok(md.includes('J3D6 → volume-one/j3d6.md\n'), md);
  assert.ok(!md.includes('J3D6 → volume-one/j3d6.md —'), 'no dangling em dash for an empty title');
});

test('lines are grouped by directory and sorted by codepoint, never by locale', () => {
  const mk = (dir, id) => entry({ relPath: `2025/${dir}/${id.toLowerCase()}.md`, id, title: id });
  // 'Z' < 'a' by codepoint; localeCompare would order these a, B, Z.
  const md = byPath(build([mk('volume-one', 'a1'), mk('volume-one', 'Z1'), mk('volume-one', 'B1'), mk('glossary', 'Q1')]))
    .get('2025/INDEX.md');
  const lines = md.split('\n').filter(l => l.includes(' → '));
  assert.deepEqual(lines.map(l => l.split(' ')[0]), ['Q1', 'B1', 'Z1', 'a1']);
  assert.ok(md.indexOf('## glossary') < md.indexOf('## volume-one'), 'directory sections are sorted too');
});

test('the per-edition header states the counts by kind, so a truncated build is visible at the top', () => {
  const md = byPath(build([A5G7, A5G4_VIC, TERM, PAGE])).get('2025/INDEX.md');
  assert.match(md, /^Units: 4 — clause 2 · glossary 1 · page 1$/m);
  assert.match(md, /^## volume-one \(3\)$/m);
  assert.match(md, /^## glossary \(1\)$/m);
});

test('an entry filed outside its own edition throws rather than emitting a broken link', () => {
  assert.throws(
    () => buildIndexes(new Map([['2025', [entry({ relPath: '2022/volume-one/x.md', id: 'X' })]]]), { tree: TREE }),
    /index: .*2022\/volume-one\/x\.md.*edition 2025/,
  );
});

test('a duplicate relPath throws — the index must not claim two units live in one file', () => {
  assert.throws(() => build([A5G7, { ...A5G7, id: 'OTHER' }]), /index: duplicate/);
});

/* ============================================================ *
 * 3. The root index — tree, counts, provenance, amendment seam  *
 * ============================================================ */

test('the root index reports every directory and the total, from the tree census', () => {
  const md = byPath(build([A5G7, A5G4_VIC, TERM, PAGE])).get('INDEX.md');
  assert.match(md, /^\| 2025\/glossary \| 1 \|$/m);
  assert.match(md, /^\| 2025\/volume-one \| 3 \|$/m);
  assert.match(md, /^\| \*\*total\*\* \| \*\*4\*\* \|$/m);
});

test('the root index names the pinned source release', () => {
  const md = byPath(build([A5G7])).get('INDEX.md');
  assert.ok(md.includes(SOURCE_RELEASE), md);
  assert.equal(SOURCE_RELEASE, 'ncc-2026-07');
});

// The seam is exercised through an edition nobody has measured yet, rather than by pinning a
// real one to null: both shipped editions now have measured values, and a test that asserted
// otherwise would have to be deleted the moment the next edition is measured.
test('an edition with no measured amendment state gets a marked seam, never an invented value', () => {
  const md = byPath(buildIndexes(new Map([['2028', []]]), { tree: [{ dir: '2028/volume-one', files: 0 }] })).get('INDEX.md');
  assert.equal(AMENDMENTS.get('2028'), undefined, 'a hypothetical unmeasured edition');
  assert.match(md, /not yet determined/i);
  assert.ok(!/Amendment \d/.test(md), 'the seam must not name an amendment nobody measured');
});

test('a measured amendment state is stated with its provenance', () => {
  const md = byPath(build([A5G7])).get('INDEX.md');
  assert.ok(AMENDMENTS.get('2025'), '2025 has a measured dataset version');
  assert.ok(md.includes(AMENDMENTS.get('2025')), md);
});

// Measured by the 2022 content-model task (docs/content-model-2022.md §8). Pinned because the
// naive reading of the source — grep for the all-gender provisions, find a hit, conclude
// "Amendment 2" — is wrong, and stating the wrong amendment is a compliance error, not a typo.
test('the 2022 amendment state is the measured one, and is not an amendment', () => {
  assert.equal(AMENDMENTS.get('2022'), 'NCC 2022 — as first published, no amendment');
  const md = byPath(buildIndexes(new Map([['2022', []]]), { tree: [{ dir: '2022/volume-one', files: 0 }] })).get('INDEX.md');
  assert.ok(md.includes(AMENDMENTS.get('2022')), md);
  assert.ok(!/not yet determined/i.test(md), 'the seam must be gone now that 2022 is measured');
});

test('every edition directory present in the tree is listed, even if this run did not build it', () => {
  const md = byPath(buildIndexes(new Map([['2025', [A5G7]]]), {
    tree: [{ dir: '2022/volume-one', files: 9 }, { dir: '2025/volume-one', files: 1 }],
  })).get('INDEX.md');
  assert.match(md, /^\| 2022 \| 9 \|/m, '2022 was built by an earlier run and must not vanish');
  assert.match(md, /^\| 2025 \| 1 \|/m);
});

/* ============================================================ *
 * 4. Determinism — CI regenerates and diffs                     *
 * ============================================================ */

test('the same input produces byte-identical output, and the input is not mutated', () => {
  const entries = [A5G4_VIC, A5G7, TERM];
  const snapshot = JSON.stringify(entries);
  const a = build(entries);
  const b = build(entries);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(entries), snapshot, 'inputs mutated');
  // A constant output is byte-identical too, so require the output to actually carry the input.
  const ed = byPath(a).get('2025/INDEX.md');
  for (const e of entries) assert.ok(ed.includes(e.relPath.slice('2025/'.length)), `${e.relPath} missing`);
  assert.equal(ed.split('\n').filter(l => l.includes(' → ')).length, entries.length);
});

test('nothing environment-dependent reaches an index: no timestamps, no host paths, no durations', () => {
  const out = build([A5G7, A5G4_VIC, TERM, PAGE]);
  // Guard against the vacuous reading of this test: an empty file also has no timestamps.
  assert.ok(byPath(out).get('INDEX.md').includes('| **total** |'), 'root index carries the census');
  assert.ok(byPath(out).get('2025/INDEX.md').includes('A5G7 → '), 'edition index carries its units');
  for (const { relPath, content } of out) {
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(content), `${relPath}: ISO timestamp`);
    assert.ok(!/[A-Za-z]:\\/.test(content), `${relPath}: Windows absolute path`);
    assert.ok(!/\/(home|Users)\//.test(content), `${relPath}: home directory path`);
    assert.ok(!/\bms\b|\bseconds\b/.test(content), `${relPath}: a duration`);
  }
});

/* -- R51: what the edition does NOT contain ---------------------------------- */

test('the edition index states the clauses the source cannot supply', () => {
  // The corpus OMITS rather than stubs, so nothing under corpus/ would otherwise say a clause is
  // deliberately absent — the build report says it, and nothing searching the corpus reads a
  // build report. This section is the only trace an agent can find.
  const out = buildIndexes(new Map([['2022', [A5G7_2022]]]), {
    tree: TREE,
    omissions: new Map([['2022', [
      { doc: 'volume-three', clause: 'C1O1', reason: 'map-identity-unresolved', variations: ['TAS'] },
      { doc: 'volume-one', clause: 'D3D31', reason: 'clause-is-2025-only' },
    ]]]),
  });
  const idx = out.find(o => o.relPath === '2022/INDEX.md').content;
  assert.match(idx, /Not published here: 2 clauses — 3 files counting jurisdiction variations/);
  assert.match(idx, /^ {2}volume-one D3D31 — clause-is-2025-only$/m);

  // Document order is not the reader's order: the list sorts, so the index is a pure function of
  // its input and CI's byte-diff cannot fail on the order two documents happened to be read in.
  assert.ok(idx.indexOf('volume-one D3D31') < idx.indexOf('volume-three C1O1'));
  // A state variation is emitted FROM its national clause, so omitting the clause takes the
  // variation with it. Named here because it is the only place "C1O1 [TAS]" is discoverable at all.
  assert.match(idx, /^ {2}volume-three C1O1 \(and its TAS variation\) — map-identity-unresolved$/m);
  // The intro is hard-wrapped as one note, so no sentence breaks mid-clause across a line.
  assert.match(idx, /Cite the live Code for these; nothing here stands in for them\./);
});

test('an edition with nothing omitted carries no gap boilerplate', () => {
  const idx = buildIndexes(new Map([['2025', [A5G7]]]), { tree: TREE })
    .find(o => o.relPath === '2025/INDEX.md').content;
  assert.doesNotMatch(idx, /Not published here/);
  // …and 2025 has no forward-reference note either, because its source has none.
  assert.doesNotMatch(idx, /cross-references in the NCC/);
});

test('the 2022 index records the forward references its source prints', () => {
  // Five untracked NCC 2025 designations survive in NCC 2022 base text. They are reproduced as the
  // Code prints them — inventing a 2022 designation would be worse — so the index has to say so,
  // and has to give the reader the designation this edition actually uses.
  const idx = buildIndexes(new Map([['2022', [A5G7_2022]]]), { tree: TREE })
    .find(o => o.relPath === '2022/INDEX.md').content;
  assert.match(idx, /Six cross-references in the NCC 2022 base text/);
  assert.match(idx, /prints F1D11 — this edition's clause is F1D8 —/);
  for (const t of ['B1P7', 'B2P12', 'B3P8', 'B6D7', 'B7P5']) assert.match(idx, new RegExp(`prints ${t} — `));
  // B1P7 vanished when R51 omitted the only file it appeared in and came back when R60 recovered
  // volume-three/b1d1. forwardRefCheck in build.mjs is what noticed; a hand-kept list did not.
  assert.match(idx, /prints B1P7 — this edition's clause is B1P6 — volume-three/);
});

test('omissions must be a Map — a plain object has no guaranteed key order', () => {
  assert.throws(() => buildIndexes(new Map([['2025', [A5G7]]]), { tree: TREE, omissions: {} }),
    /omissions must be a Map/);
});
