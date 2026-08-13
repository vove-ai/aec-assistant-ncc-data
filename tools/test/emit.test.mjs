// emit.test.mjs — identity and the first six lines.
//
// Two properties are load-bearing and everything here defends one of them:
//   1. A filename is a lookup key. `glob corpus/2025/**/c2d2-*` must land on exactly one clause,
//      and two distinct units must never claim the same name (⊕ trap 4: silent overwrite).
//   2. The first six lines are the citation. `grep -A6` on a clause ID must return `citation:`
//      and `web_url:`, which is why the frontmatter key order is fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emitUnit, slugify, unitFilename } from '../src/emit.mjs';
import { DOCUMENTS_2025, readDocument2025 } from '../src/read-2025.mjs';
import { normalizeUnit } from '../src/normalize.mjs';

const NORM = { bodyMd: 'Body.', definedTerms: [], figures: [], warnings: [] };
const OPTS = { citationPrefix: 'NCC 2025 V1', webUrl: 'https://x.test/p' };
const clause = (extra = {}) => ({
  edition: '2025', volume: 'volume-one', kind: 'clause', id: 'A1G1', term: null,
  title: 'Scope', state: null, supersedes: null, buildingClasses: null, ...extra,
});

/* ============================================================ *
 * 1. The brief's four fixtures, verbatim.                       *
 * ============================================================ */

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

/* ============================================================ *
 * 2. The golden file, whole. Line-by-line above, byte-for-byte  *
 *    here, so a change to any part of the layout is visible.    *
 * ============================================================ */

test('golden file — the complete emitted document, byte for byte', () => {
  const unit = { edition: '2025', volume: 'volume-one', kind: 'clause', id: 'A5G7', term: null,
    title: 'Resistance to the incipient spread of fire', state: null, supersedes: '2019: A5.6',
    buildingClasses: 'Class 2,Class 3' };
  const normalized = { bodyMd: '**(1)** A ceiling is deemed…', definedTerms: ['Standard Fire Test'], figures: [], warnings: [] };
  const { content } = emitUnit(unit, normalized, {
    citationPrefix: 'NCC 2025 V1',
    webUrl: 'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/5-documents-adopted-by-reference',
  });
  assert.equal(content, [
    '---',
    'clause: A5G7',
    'title: Resistance to the incipient spread of fire',
    'citation: NCC 2025 V1 A5G7',
    'web_url: https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/5-documents-adopted-by-reference',
    'edition: "2025"',
    'volume: volume-one',
    'jurisdiction: aus',
    'supersedes: "2019: A5.6"',
    'building_classes: Class 2,Class 3',
    'defined_terms:',
    '  - Standard Fire Test',
    '---',
    '',
    '# A5G7 — Resistance to the incipient spread of fire',
    '',
    '**(1)** A ceiling is deemed…',
    '',
  ].join('\n'));
});

/* ============================================================ *
 * 3. slugify — folding, collapsing, and the 60-char cap.        *
 * ============================================================ */

test('slugify folds diacritics, collapses separators, trims edges', () => {
  assert.equal(slugify('Café — naïve façade'), 'cafe-naive-facade');
  assert.equal(slugify('  Spaces   and---dashes  '), 'spaces-and-dashes');
  assert.equal(slugify('Type A fire-resisting construction — roof: Concession'),
    'type-a-fire-resisting-construction-roof-concession');
  assert.equal(slugify(''), '');
  assert.equal(slugify('* * * * *'), '');
  assert.equal(slugify('13.2.7'), '13-2-7');
});

test('the 60-char cap cuts on a word boundary and never leaves a trailing hyphen', () => {
  // 60 exactly: kept whole.
  const exact = 'a'.repeat(9) + ('-' + 'b'.repeat(9)).repeat(5);   // 9 + 5*10 = 59
  assert.equal(slugify(exact + '-c').length, 61);
  assert.equal(unitFilename({ kind: 'page', title: exact.replace(/-/g, ' ') }), `page-${exact}.md`);

  // Longer than 60: cut back to the last whole word at or before 60.
  const long = 'reinforcing for column and beam protection gypsum blocks and hollow terracotta blocks';
  const capped = 'reinforcing-for-column-and-beam-protection-gypsum-blocks-and';
  assert.equal(capped.length, 60, 'the cut lands exactly on the cap here');
  assert.equal(unitFilename({ kind: 'clause', id: 'S1', title: long }), `s1-${capped}.md`);
  assert.ok(!capped.endsWith('-'));

  // A cut landing exactly on a hyphen must not leave that hyphen behind.
  const boundary = 'x'.repeat(60) + ' y';    // slug: 60 x's, '-', 'y'
  assert.equal(unitFilename({ kind: 'page', title: boundary }), `page-${'x'.repeat(60)}.md`);

  // A single word longer than the cap: the cap is a hard bound on path length, so it is cut.
  const monster = 'z'.repeat(75);
  assert.equal(unitFilename({ kind: 'page', title: monster }), `page-${'z'.repeat(60)}.md`);
});

/* ============================================================ *
 * 4. Glossary identity (⊕ trap 2).                              *
 * ============================================================ */

test('glossary: plain term, state variation, and hash fallback combine in a fixed order', () => {
  assert.equal(unitFilename({ kind: 'glossary', term: 'Accredited testing laboratory', state: null }),
    'accredited-testing-laboratory.md');
  assert.equal(unitFilename({ kind: 'glossary', term: 'Appropriate authority', state: 'NSW' }),
    'appropriate-authority-nsw.md');
  // Non-ASCII: hash first, state last.
  const f = unitFilename({ kind: 'glossary', term: 'µm', state: 'SA' });
  assert.match(f, /^m-[0-9a-f]{8}-sa\.md$/);
});

test('glossary hash is a stable function of the term, not of call order', () => {
  const a = unitFilename({ kind: 'glossary', term: '°C', state: null });
  const b = unitFilename({ kind: 'glossary', term: '°C', state: null });
  assert.equal(a, b);
  assert.notEqual(a, unitFilename({ kind: 'glossary', term: '°CDB', state: null }));
  // All six measured symbol-only terms stay distinct.
  const symbols = ['°', '%', '>', '<', '≤', '≥'];
  const names = symbols.map(t => unitFilename({ kind: 'glossary', term: t, state: null }));
  assert.equal(new Set(names).size, 6, `symbol terms collided: ${names}`);
  for (const n of names) assert.match(n, /^term-[0-9a-f]{8}\.md$/);
});

test('an ASCII term that slugifies non-empty keeps a readable name — no gratuitous hashing', () => {
  assert.equal(unitFilename({ kind: 'glossary', term: '-e/MJ', state: null }), 'e-mj.md');
  assert.equal(unitFilename({ kind: 'glossary', term: 'Fire source feature', state: null }), 'fire-source-feature.md');
});

/* ============================================================ *
 * 5. Page identity — R2, R20, and HP's reused section numbers.  *
 * ============================================================ */

test('R2: a page with no container is page-{slug}; state still threads in', () => {
  assert.equal(unitFilename({ kind: 'page', containerKind: null, containerNum: null, state: null, title: 'Introduction to NCC Volume One' }),
    'page-introduction-to-ncc-volume-one.md');
  assert.equal(unitFilename({ kind: 'page', containerKind: null, containerNum: null, state: 'NSW', title: 'NSW Introduction' }),
    'page-nsw-nsw-introduction.md');
});

test('container kind tokens: a Specification never splits across two filename shapes (R20)', () => {
  const of = (containerKind, extra = {}) => unitFilename({
    kind: 'page', containerKind, containerNum: '44', state: null, title: 'Scope', ...extra,
  });
  assert.equal(of('part'), 'part-44-scope.md');
  assert.equal(of('part-variation'), 'part-44-scope.md');
  assert.equal(of('specification'), 'spec-44-scope.md');
  assert.equal(of('spec-topic'), 'spec-44-scope.md', 'spec-topic and specification must share one prefix');
  assert.equal(of('schedule-part'), 'schedule-44-scope.md');
  assert.equal(of('schedule-part-variation'), 'schedule-44-scope.md');
  assert.equal(of('schedule-spec'), 'schedule-44-scope.md');
  assert.equal(of('schedule-referenced-document'), 'schedule-44-scope.md');
});

test('HP reuses section numbers, so an ncc-section token pairs num with sectionType', () => {
  const body = unitFilename({ kind: 'page', containerKind: 'ncc-section', containerNum: '5', sectionType: 'other', title: 'Fire safety' });
  const sched = unitFilename({ kind: 'page', containerKind: 'ncc-section', containerNum: '5', sectionType: 'schedule', title: 'New South Wales' });
  assert.equal(body, 'section-5-fire-safety.md');
  assert.equal(sched, 'schedule-5-new-south-wales.md');
  assert.notEqual(body, sched);
});

test('a container num that repeats its own kind word is not doubled', () => {
  // Measured: one <part num="Part H9" state="SA"> in volume-two, against 104 plain nums.
  assert.equal(unitFilename({ kind: 'page', containerKind: 'part', containerNum: 'Part H9', state: 'SA', title: '* * * * *' }),
    'part-h9-sa.md');
  assert.equal(unitFilename({ kind: 'page', containerKind: 'part', containerNum: 'H9', state: 'WA', title: 'Water use' }),
    'part-h9-wa-water-use.md');
});

test('a decimal container num keeps its dots, exactly as a decimal clause id does', () => {
  // Housing Provisions Parts are numbered 13.1 … 13.7, and a reader who globs `part-13.7-*`
  // should find them for the same reason `11.2.2-*` finds a clause.
  assert.equal(unitFilename({ kind: 'page', containerKind: 'part', containerNum: '13.7', state: 'NSW', title: 'Services' }),
    'part-13.7-nsw-services.md');
});

test('an unmodelled containerKind throws rather than inventing a prefix', () => {
  assert.throws(() => unitFilename({ kind: 'page', containerKind: 'nonesuch', containerNum: '1', title: 'X' }),
    /nonesuch/);
});

/* ============================================================ *
 * 6. Empty and missing identity — fail loud, never a bad name.  *
 * ============================================================ */

test('an empty title slug leaves no trailing hyphen', () => {
  // Measured: clause J3D6 in volume-one is titled "* * * * *" (a deliberately blank clause).
  assert.equal(unitFilename({ kind: 'clause', id: 'J3D6', state: null, title: '* * * * *' }), 'j3d6.md');
  assert.equal(unitFilename({ kind: 'page', containerKind: null, containerNum: null, state: 'SA', title: '* * * * *' }), 'page-sa.md');
});

test('a clause with no id throws, naming the unit', () => {
  assert.throws(() => unitFilename({ kind: 'clause', id: null, state: 'NSW', title: 'Orphan clause' }),
    /Orphan clause/);
});

test('a glossary unit with no term throws', () => {
  assert.throws(() => unitFilename({ kind: 'glossary', term: '', state: null }), /glossary/);
});

test('an unknown kind throws', () => {
  assert.throws(() => unitFilename({ kind: 'table', title: 'X' }), /table/);
});

test('a decimal Housing Provisions id keeps its dots — AGENTS.md promises 11.2.2-*', () => {
  assert.equal(unitFilename({ kind: 'clause', id: '13.2.7', state: 'WA', title: 'Attached Class 10a buildings' }),
    '13.2.7-wa-attached-class-10a-buildings.md');
});

/* ============================================================ *
 * 7. Citations.                                                 *
 * ============================================================ */

test('citation forms per kind, with the jurisdiction stated when the unit is varied', () => {
  const cite = (unit, prefix = 'NCC 2025 V1') =>
    emitUnit({ edition: '2025', volume: 'volume-one', ...unit }, NORM, { citationPrefix: prefix, webUrl: null })
      .content.split('\n').find(l => l.startsWith('citation: '));
  assert.equal(cite({ kind: 'clause', id: 'A5G7', title: 'T' }), 'citation: NCC 2025 V1 A5G7');
  assert.equal(cite({ kind: 'clause', id: 'A5G4', title: 'T', state: 'VIC' }), 'citation: NCC 2025 V1 A5G4 (VIC)');
  assert.equal(cite({ kind: 'page', title: 'Introduction to NCC Volume One' }),
    'citation: NCC 2025 V1 Introduction to NCC Volume One');
  assert.equal(cite({ kind: 'page', title: 'Energy efficiency', state: 'NSW', containerKind: 'part', containerNum: 'H6' }, 'NCC 2025 V2'),
    'citation: NCC 2025 V2 Energy efficiency (NSW)');
  // A glossary citation carries a ": " of its own, so the quoting rule fires on a value this
  // module generates — not only on values that came in from the source.
  assert.equal(cite({ kind: 'glossary', term: 'Fire source feature', title: 'Fire source feature' }),
    'citation: "NCC 2025 V1 Glossary: Fire source feature"');
  assert.equal(cite({ kind: 'clause', id: '11.2.2', title: 'T' }, 'NCC 2022 HP'), 'citation: NCC 2022 HP 11.2.2');
});

test('a missing citation prefix throws — a file must never ship uncitable', () => {
  assert.throws(() => emitUnit(clause(), NORM, { webUrl: null }), /citationPrefix/);
});

/* ============================================================ *
 * 8. YAML quoting. A mis-quoted value makes the head unparseable *
 *    and grep -A6 output is what an agent reads.                *
 * ============================================================ */

const fm = (unit, normalized = NORM, opts = OPTS) =>
  emitUnit(unit, normalized, opts).content.split('\n---\n')[0].split('\n').slice(1);
const line = (unit, key, normalized, opts) => fm(unit, normalized, opts).find(l => l.startsWith(`${key}:`));

test('quotes a value containing ": " — 133 real titles carry one', () => {
  assert.equal(line(clause({ title: 'Fire-protected timber: Concession' }), 'title'),
    'title: "Fire-protected timber: Concession"');
  assert.equal(line(clause({ title: 'Ends with a colon:' }), 'title'), 'title: "Ends with a colon:"');
});

test('a bare colon inside a URL is NOT quoted — a plain scalar allows it', () => {
  assert.equal(line(clause(), 'web_url', NORM, { ...OPTS, webUrl: 'https://ncc.abcb.gov.au/a/b' }),
    'web_url: https://ncc.abcb.gov.au/a/b');
});

test('quotes a leading YAML indicator character', () => {
  assert.equal(line(clause({ title: '* * * * *' }), 'title'), 'title: "* * * * *"');
  assert.equal(line({ ...clause(), kind: 'glossary', id: null, term: '-e/MJ', title: '-e/MJ' }, 'term'), 'term: "-e/MJ"');
  assert.equal(line({ ...clause(), kind: 'glossary', id: null, term: '%', title: '%' }, 'term'), 'term: "%"');
  assert.equal(line({ ...clause(), kind: 'glossary', id: null, term: '>', title: '>' }, 'term'), 'term: ">"');
  assert.equal(line({ ...clause(), kind: 'glossary', id: null, term: '#hash', title: '#hash' }, 'term'), 'term: "#hash"');
});

test('quotes anything a YAML parser would read as a number, bool or null', () => {
  // Measured: livable-housing clause ids are 1.1 … 6.2, which parse as floats unquoted.
  assert.equal(line(clause({ id: '1.1' }), 'clause'), 'clause: "1.1"');
  assert.equal(line(clause({ title: '2025' }), 'title'), 'title: "2025"');
  assert.equal(line(clause({ title: 'No' }), 'title'), 'title: "No"');
  assert.equal(line(clause({ title: 'null' }), 'title'), 'title: "null"');
  assert.equal(line(clause({ title: '0x1F' }), 'title'), 'title: "0x1F"');
  assert.equal(line(clause({ title: '-3' }), 'title'), 'title: "-3"');
  // …but a decimal id with two dots is not a number, and needs no quotes.
  assert.equal(line(clause({ id: '11.2.2' }), 'clause'), 'clause: 11.2.2');
});

test('edition is always quoted; ordinary prose punctuation is not', () => {
  assert.equal(line(clause(), 'edition'), 'edition: "2025"');
  assert.equal(line(clause({ title: 'Plant rooms, lift machine rooms and substations (Class 8)' }), 'title'),
    'title: Plant rooms, lift machine rooms and substations (Class 8)');
  assert.equal(line(clause({ title: 'Type A construction — roof' }), 'title'), 'title: Type A construction — roof');
  assert.equal(line(clause({ title: 'Children’s room' }), 'title'), 'title: Children’s room');
  assert.equal(line(clause({ buildingClasses: 'Class 2,Class 3' }), 'building_classes'),
    'building_classes: Class 2,Class 3');
});

test('escapes a double quote and a backslash inside a quoted scalar', () => {
  assert.equal(line(clause({ title: 'A "quoted" word: here' }), 'title'), 'title: "A \\"quoted\\" word: here"');
  assert.equal(line(clause({ title: 'back\\slash: x' }), 'title'), 'title: "back\\\\slash: x"');
});

test('defined_terms is a block list in document order, each item quoted only when needed', () => {
  const n = { ...NORM, definedTerms: ['Standard Fire Test', '>', 'fire source feature', '1.5'] };
  const f = fm(clause(), n);
  const i = f.indexOf('defined_terms:');
  assert.ok(i >= 0);
  assert.deepEqual(f.slice(i + 1), [
    '  - Standard Fire Test',
    '  - ">"',
    '  - fire source feature',
    '  - "1.5"',
  ]);
});

/* ============================================================ *
 * 9. Frontmatter shape: fixed key order, omissions, routing.    *
 * ============================================================ */

const FIXED_ORDER = ['clause', 'term', 'title', 'citation', 'web_url', 'edition', 'volume',
  'jurisdiction', 'supersedes', 'building_classes', 'defined_terms'];

test('keys appear in the fixed order, and keys with no value are omitted', () => {
  const keys = fm(clause()).filter(l => /^[a-z_]+:/.test(l)).map(l => l.split(':')[0]);
  assert.deepEqual(keys, ['clause', 'title', 'citation', 'web_url', 'edition', 'volume', 'jurisdiction']);
  const full = fm(clause({ supersedes: '2019: A5.6', buildingClasses: 'Class 2' }),
    { ...NORM, definedTerms: ['t'] }).filter(l => /^[a-z_]+:/.test(l)).map(l => l.split(':')[0]);
  assert.deepEqual(full, FIXED_ORDER.filter(k => k !== 'term'));
});

test('a glossary unit uses term: in place of clause:, and never carries clause metadata', () => {
  const f = fm({ edition: '2025', volume: 'volume-one', kind: 'glossary', id: null, term: 'Fire source feature',
    title: 'Fire source feature', state: null, supersedes: null, buildingClasses: 'Class 2' });
  assert.ok(f.includes('term: Fire source feature'));
  assert.ok(!f.some(l => l.startsWith('clause:')));
  assert.ok(!f.some(l => l.startsWith('building_classes:')), 'building classes belong to clauses');
});

test('a null web_url omits the key entirely rather than emitting an empty value', () => {
  const f = fm(clause(), NORM, { citationPrefix: 'NCC 2025 V1', webUrl: null });
  assert.ok(!f.some(l => l.startsWith('web_url:')));
  assert.ok(f.some(l => l.startsWith('citation:')));
});

test('jurisdiction is always present: aus nationally, the lowercased state otherwise', () => {
  assert.equal(line(clause(), 'jurisdiction'), 'jurisdiction: aus');
  assert.equal(line(clause({ state: 'NSW' }), 'jurisdiction'), 'jurisdiction: nsw');
  assert.equal(line(clause({ state: 'VIC' }), 'jurisdiction'), 'jurisdiction: vic');
});

test('figures and warnings never reach the file', () => {
  const n = { bodyMd: 'See ![Figure 1](https://cdn.test/image-A2G1.svg).', definedTerms: ['t'], figures: ['image-A2G1.svg'], warnings: ['mathml-flattened: x/y'] };
  const { content } = emitUnit(clause(), n, OPTS);
  // Non-vacuity: the file really was emitted, head and body.
  assert.ok(content.includes('citation: NCC 2025 V1 A1G1'), content);
  assert.ok(content.includes('See ![Figure 1](https://cdn.test/image-A2G1.svg).'), content);
  // The figure list and the warning list are build diagnostics, not corpus content: a figure
  // already appears inline in the body, and a warning in a file would match a phrase grep.
  assert.ok(!content.includes('figures:'));
  assert.ok(!content.includes('warnings:'));
  assert.ok(!content.includes('mathml-flattened'));
});

test('relPath routes by kind; glossary is edition-wide and the directory is an option', () => {
  assert.equal(emitUnit(clause(), NORM, OPTS).relPath, '2025/volume-one/a1g1-scope.md');
  const g = { edition: '2025', volume: 'volume-two', kind: 'glossary', id: null, term: 'Flight', title: 'Flight', state: null };
  assert.equal(emitUnit(g, NORM, OPTS).relPath, '2025/glossary/flight.md');
  assert.equal(emitUnit(g, NORM, { ...OPTS, glossaryDir: 'volume-two/glossary' }).relPath,
    '2025/volume-two/glossary/flight.md');
  const p = { edition: '2022', volume: 'housing-provisions', kind: 'page', title: 'Introduction', state: null };
  assert.equal(emitUnit(p, NORM, { ...OPTS, citationPrefix: 'NCC 2022 HP' }).relPath,
    '2022/housing-provisions/page-introduction.md');
});

/* ============================================================ *
 * 10. Body layout.                                              *
 * ============================================================ */

test('H1 per kind, one blank line either side of it, exactly one trailing newline', () => {
  const c = emitUnit(clause({ id: 'A5G7', title: 'Resistance to fire' }), NORM, OPTS).content;
  assert.ok(c.includes('---\n\n# A5G7 — Resistance to fire\n\nBody.\n'));
  assert.ok(c.endsWith('Body.\n') && !c.endsWith('\n\n'));

  const p = emitUnit({ edition: '2025', volume: 'volume-one', kind: 'page', title: 'Introduction' }, NORM, OPTS).content;
  assert.ok(p.includes('\n# Introduction\n'));

  const g = emitUnit({ edition: '2025', volume: 'volume-one', kind: 'glossary', term: 'Flight', title: 'Flight' }, NORM, OPTS).content;
  assert.ok(g.includes('\n# Flight\n'));
});

test('a clause with an empty title still gets a usable H1', () => {
  const c = emitUnit(clause({ id: 'J3D6', title: '' }), NORM, OPTS).content;
  assert.ok(c.includes('\n# J3D6\n'), c);
  assert.ok(!c.includes('J3D6 — \n'));
});

test('a directory that would escape the corpus is refused', () => {
  const g = { edition: '2025', volume: 'volume-one', kind: 'glossary', term: 'Flight', title: 'Flight' };
  assert.throws(() => emitUnit(g, NORM, { ...OPTS, glossaryDir: '../../etc' }), /safe corpus-relative path/);
  assert.throws(() => emitUnit({ ...clause(), volume: 'C:\\windows' }, NORM, OPTS), /safe corpus-relative path/);
});

test('an empty body still ends with exactly one newline', () => {
  const { content } = emitUnit(clause(), { bodyMd: '', definedTerms: [], figures: [], warnings: [] }, OPTS);
  assert.ok(content.endsWith('# A1G1 — Scope\n'), JSON.stringify(content.slice(-40)));
  assert.ok(!content.endsWith('\n\n'));
});

test('emitting is deterministic and does not mutate its inputs', () => {
  const unit = clause({ state: 'NSW', supersedes: '2019: A1.1', buildingClasses: 'Class 2' });
  const normalized = { bodyMd: 'B', definedTerms: ['z term', 'a term'], figures: ['f.svg'], warnings: ['w'] };
  const snapshot = JSON.stringify({ unit, normalized });
  const a = emitUnit(unit, normalized, OPTS);
  const b = emitUnit(unit, normalized, OPTS);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ unit, normalized }), snapshot, 'inputs mutated');
  assert.match(a.content, /defined_terms:\n  - z term\n  - a term\n/, 'document order preserved, not sorted');
});

/* ============================================================ *
 * 11. The corpus. Skipped when .cache is absent.                *
 *     This is where collisions and slug pathologies surface.    *
 * ============================================================ */

const pathOf = d => `.cache/extracted/${d.pkg}/contents.xml`;
const have = DOCUMENTS_2025.every(d => fs.existsSync(pathOf(d)));

// Measured, and expected to stay measured: the ONE relPath in the 2025 corpus claimed by two
// genuinely distinct units. The NCC glossary defines "Appropriate authority" twice — once
// scoped to the Fire Safety Verification Method, once generally — with no attribute
// distinguishing them. Pinned as an exact set so a NEW collision class fails loudly instead of
// joining a growing count. Resolving it is the glossary-dedupe task's call, not the emitter's.
const KNOWN_COLLISIONS = ['2025/glossary/appropriate-authority.md'];

function emitAll(doc) {
  const units = readDocument2025(fs.readFileSync(pathOf(doc), 'utf8'), doc);
  return units.map(u => ({
    unit: u,
    ...emitUnit(u, normalizeUnit(u, { year: '2025', cdnKey: doc.cdnKey }),
      { citationPrefix: doc.citationPrefix, webUrl: `https://ncc.abcb.gov.au/stub/${doc.key}` }),
  }));
}

// A deliberately small hand-rolled reader — no dependency, and it fails on anything it cannot
// account for, which is the point: an unparseable head is a silent citation loss.
function parseFrontmatter(content, file) {
  const lines = content.split('\n');
  assert.equal(lines[0], '---', `${file}: no frontmatter`);
  const end = lines.indexOf('---', 1);
  assert.ok(end > 1, `${file}: frontmatter never closes`);
  const out = {};
  const order = [];
  let list = null;
  for (const l of lines.slice(1, end)) {
    const item = /^ {2}- (.*)$/.exec(l);
    if (item) { assert.ok(list, `${file}: list item with no key: ${l}`); list.push(unquote(item[1], file)); continue; }
    const kv = /^([a-z_]+):(?: (.*))?$/.exec(l);
    assert.ok(kv, `${file}: unparseable frontmatter line: ${JSON.stringify(l)}`);
    order.push(kv[1]);
    if (kv[2] === undefined) { list = []; out[kv[1]] = list; } else { list = null; out[kv[1]] = unquote(kv[2], file); }
  }
  assert.equal(lines[end + 1], '', `${file}: no blank line after frontmatter`);
  return { data: out, order, bodyStart: end + 2 };
}
function unquote(v, file) {
  if (!v.startsWith('"')) {
    // A plain scalar must survive a YAML parser as the string it looks like: no leading
    // indicator, no ": ", no " #", no edge whitespace — and nothing the core schema would
    // resolve to a number, bool or null (this is what catches an unquoted `clause: 1.1`).
    assert.ok(!/^[-?:,[\]{}#&*!|>'"%@`]/.test(v), `${file}: unquoted value starts with an indicator: ${v}`);
    assert.ok(!/: |:$/.test(v), `${file}: unquoted value contains ": ": ${v}`);
    assert.ok(!/ #/.test(v), `${file}: unquoted value contains " #": ${v}`);
    assert.ok(v === v.trim() && v !== '', `${file}: unquoted value has edge whitespace: ${JSON.stringify(v)}`);
    assert.ok(!/^[-+]?(\.\d+|\d+(\.\d*)?([eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/.test(v),
      `${file}: unquoted value would parse as a number: ${v}`);
    assert.ok(!/^([yYnN]|[Yy]es|YES|[Nn]o|NO|[Tt]rue|TRUE|[Ff]alse|FALSE|[Oo]n|ON|[Oo]ff|OFF|[Nn]ull|NULL|~)$/.test(v),
      `${file}: unquoted value would parse as a bool or null: ${v}`);
    assert.ok(!/[\u0000-\u001f]/.test(v), `${file}: control character in a plain scalar`);
    return v;
  }
  assert.ok(v.endsWith('"') && v.length >= 2, `${file}: unterminated quoted scalar: ${v}`);
  return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

for (const doc of DOCUMENTS_2025) {
  test(`${doc.key}: every unit emits a unique, well-formed file`, { skip: !have }, () => {
    const emitted = emitAll(doc);
    assert.ok(emitted.length > 0);

    const byPath = new Map();
    for (const e of emitted) byPath.set(e.relPath, [...(byPath.get(e.relPath) ?? []), e]);
    const collisions = [...byPath].filter(([, v]) => v.length > 1).map(([p]) => p).sort();
    assert.deepEqual(collisions, doc.key === 'livable-housing' ? [] : KNOWN_COLLISIONS,
      'a new filename collision class appeared — two units would overwrite each other');

    for (const { unit, relPath, content } of emitted) {
      assert.match(relPath, /^2025\/[a-z-]+(\/[a-z-]+)?\/[a-z0-9][a-z0-9.-]*\.md$/, relPath);
      assert.ok(!relPath.includes('--') && !relPath.includes('-.'), `ugly filename: ${relPath}`);
      assert.ok(content.endsWith('\n') && !content.endsWith('\n\n'), `${relPath}: trailing newlines`);
      assert.ok(!content.includes('\r'), `${relPath}: CR in output`);

      const { data, order } = parseFrontmatter(content, relPath);
      // Fixed key order: the emitted keys must be a subsequence of the canonical order.
      let i = -1;
      for (const k of order) {
        const j = FIXED_ORDER.indexOf(k);
        assert.ok(j > i, `${relPath}: key out of order: ${k} after ${order.join(',')}`);
        i = j;
      }
      assert.equal(data.edition, '2025');
      assert.equal(data.volume, unit.volume);
      assert.equal(data.jurisdiction, unit.state ? unit.state.toLowerCase() : 'aus');
      assert.ok(data.citation.startsWith(doc.citationPrefix), `${relPath}: ${data.citation}`);
      assert.ok(data.title !== undefined, `${relPath}: no title`);   // uniform across all kinds
      if (unit.kind === 'clause') assert.equal(data.clause, unit.id);
      if (unit.kind === 'glossary') assert.equal(data.term, unit.term);
    }
  });

  test(`${doc.key}: citation and web_url land inside the grep -A6 window`, { skip: !have }, () => {
    for (const { unit, relPath, content } of emitAll(doc)) {
      const head = content.split('\n').slice(0, 7).join('\n');
      assert.match(head, /\ncitation: /, relPath);
      if (unit.kind === 'clause') {
        assert.match(head, /^clause: /m, relPath);
        assert.match(head, /\nweb_url: /, relPath);
      }
    }
  });
}

test('R2 cross-check: overview flag and container context agree on every page unit', { skip: !have }, () => {
  // The filename shape is chosen from containerNum (R2). Task 4 added an `overview` flag for a
  // different purpose; if the two ever disagreed, one of them would be naming files wrong.
  let pages = 0;
  for (const doc of DOCUMENTS_2025) {
    for (const u of readDocument2025(fs.readFileSync(pathOf(doc), 'utf8'), doc)) {
      if (u.kind !== 'page') continue;
      pages++;
      assert.equal(!!u.overview, !!u.containerNum,
        `${doc.key}: page "${u.title}" has overview=${!!u.overview} but containerNum=${JSON.stringify(u.containerNum)}`);
    }
  }
  assert.ok(pages > 200, `only ${pages} page units seen`);
});

test('across all five documents, only the glossary shares filenames — and it shares them by design',
  { skip: !have }, () => {
    const byPath = new Map();
    for (const doc of DOCUMENTS_2025) {
      for (const e of emitAll(doc)) byPath.set(e.relPath, [...(byPath.get(e.relPath) ?? []), { ...e, doc: doc.key }]);
    }
    const shared = [...byPath].filter(([, v]) => v.length > 1);
    for (const [p, v] of shared) {
      assert.ok(v.every(x => x.unit.kind === 'glossary'),
        `${p} is claimed by non-glossary units: ${v.map(x => `${x.doc}/${x.unit.kind}`).join(', ')}`);
    }
    // Every volume ships the same glossary; that is why it is emitted once per edition.
    const glossary = [...byPath].filter(([p]) => p.startsWith('2025/glossary/'));
    assert.ok(glossary.length > 500, `${glossary.length} glossary paths`);
  });

test('the slug cap really bounds every emitted filename', { skip: !have }, () => {
  // The cap rule, reimplemented here from its written description rather than imported, so the
  // test is a second opinion and not a restatement of the implementation.
  const capRule = (s) => {
    if (s.length <= 60) return s;
    const cut = s.lastIndexOf('-', 60);
    return (cut > 0 ? s.slice(0, cut) : s.slice(0, 60)).replace(/-+$/, '');
  };
  let longest = '', count = 0, hitCap = 0;
  for (const doc of DOCUMENTS_2025) {
    for (const { unit, relPath } of emitAll(doc)) {
      count++;
      if (relPath.length > longest.length) longest = relPath;
      const base = relPath.split('/').pop().replace(/\.md$/, '');
      const full = slugify(unit.kind === 'glossary' ? unit.term : unit.title);
      const want = capRule(full);
      if (full.length > 60) hitCap++;
      assert.ok(want.length <= 60, `${relPath}: capped slug is ${want.length} chars`);
      if (!want) continue;
      // The title slug ends a clause/page name and starts a glossary one (state and hash sit
      // on the other side); either way the emitted name must carry exactly the capped slug.
      const ok = unit.kind === 'glossary' ? base.startsWith(want) : base.endsWith(want);
      assert.ok(ok, `${relPath}: does not carry the capped slug ${JSON.stringify(want)}`);
    }
  }
  assert.ok(count > 4000, `only ${count} units seen — the walk collected nothing`);
  assert.ok(hitCap > 50, `only ${hitCap} slugs exceeded the cap — the rule is never exercised`);
  assert.ok(longest.length < 120, `runaway path (${longest.length}): ${longest}`);
});
