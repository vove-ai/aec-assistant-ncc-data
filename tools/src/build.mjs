// build.mjs — the orchestration, and the four assertions that decide whether the corpus is
// trustworthy.
//
// Everything upstream of here is a pure function with unit tests. This module is the first thing
// that writes the artifact agents actually search, so it owns the checks that no downstream test
// can make on its behalf:
//
//  1. GLOBAL FILENAME UNIQUENESS (⊕ trap 4). Two separate identity bugs in a prior implementation
//     surfaced as SILENT OVERWRITES — last-write-wins, no warning, a state-specific clause lost
//     under the national filename. A uniqueness check turns that whole defect class from data
//     loss into a build failure. The policy's branches are not interchangeable; see
//     resolveUniqueness. The ONE path deliberately claimed by several documents is the glossary,
//     which every volume embeds in full; foldGlossary decides what that single file says (R33).
//  2. NO CLAUSE MAY SHIP WITHOUT A web_url. `web_url:` is in the first six lines so an agent can
//     verify a citation. weblinks.mjs is written to fail CLOSED — where the data does not
//     identify one page it answers null rather than a plausible wrong page — and this assertion
//     is the control that turns those nulls into a human ruling instead of a quiet omission.
//     Rulings that have been MADE are enumerated in NULL_WEB_URL_CLAUSES, one entry per
//     edition+volume+clause+state with its evidence, and are printed in the report; a null that
//     is not on that list still fails.
//  3. PARITY MUST RECONCILE. Content units by immediate parent, summed with the table-references
//     rendered inline, must equal docs/content-model-2025.md's measured table exactly. A delta is
//     units lost between the XML and the corpus, so it FAILS the build rather than printing a
//     warning into a scrollback nobody reads. Whole documents only — a slice has nothing to
//     compare against. See parityCheck. An edition whose source document has no transcribable
//     equivalent of that table says so by name in PARITY_UNAVAILABLE, with the measurement and
//     with where its parity IS checked instead; an edition in neither still fails on every unit.
//  4. ANY NORMALIZE ERROR STOPS THE BUILD, naming the unit. Silently dropping content from a
//     compliance corpus is the worst outcome available here.
//
// NOTHING IS WRITTEN UNTIL ALL FOUR PASS. Every document is read, normalized and emitted into
// memory first, so a failing build leaves the previous corpus intact rather than half-rewritten.
// The first three are GATHERED and reported together, and the whole report — parity census
// included — prints BEFORE the throw: one run yields one ruling, with the evidence needed to make
// it. A normalize error is the exception and throws immediately, because there are no meaningful
// statistics to report after one.
//
// DELETION IS PART OF CORRECTNESS, not housekeeping. A file left behind by an earlier slice or an
// earlier naming rule is invisible to every test in this repo — nothing walks the corpus looking
// for files that should not exist — so it would ship as if it were current. See planReconcile.
//
// DETERMINISM: CI regenerates the corpus and runs `git diff --exit-code -- corpus/`. Documents are
// iterated in their declared order, everything else in codepoint order, and no timestamp,
// hostname, path or duration is ever written into a file. The report on stdout is the only place
// environment-dependent text is allowed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENTS_2025, readDocument2025 } from './read-2025.mjs';
import { DOCUMENTS_2022, readPackage2022 } from './read-2022.mjs';
import { normalizeUnit, figureUrlPrefix } from './normalize.mjs';
import { emitUnit, unitRelPath } from './emit.mjs';
import { buildLinkIndex, resolveWebUrl } from './weblinks.mjs';
import { buildIndexes } from './index.mjs';
import { fetchAll } from './fetch.mjs';

const CORPUS = 'corpus';

/** Both editions this repo covers. An edition here but not in EDITIONS has no reader yet. */
export const KNOWN_EDITIONS = ['2022', '2025'];

/**
 * Editions with a reader. NCC 2022 is one entry plus `read-2022.mjs`: its per-file DITA layout
 * (11,331 files, a publication map, state variations in separate files) differs completely from
 * 2025's single contents.xml, which is exactly why `readUnits` owns its own IO instead of taking
 * an XML string — the orchestration below never learns how an edition is stored, only that it
 * yields RawUnits carrying `sectionNum`, `volume` and `kind`.
 *
 * `readUnits(doc, {diagnostics})` is handed an object to FILL IN. 2025 ignores it; 2022 records
 * what the source itself loses (see droppedCitations in the report). It is passed rather than
 * returned so the reader contract stays "RawUnits in, nothing else out" for both editions.
 *
 * Neither reader is given `sections`: the build slices with its own `inScope`, because it needs
 * the FULL producible set to know which files on disk are stale (see planReconcile).
 */
export const EDITIONS = new Map([
  ['2022', {
    year: '2022',
    documents: DOCUMENTS_2022,
    readUnits: (doc, opts = {}) => readPackage2022(`.cache/extracted/${doc.pkg}`, doc, opts),
  }],
  ['2025', {
    year: '2025',
    documents: DOCUMENTS_2025,
    readUnits: doc => readDocument2025(fs.readFileSync(`.cache/extracted/${doc.pkg}/contents.xml`, 'utf8'), doc),
  }],
]);

/**
 * Parity targets: content units by immediate parent element, transcribed from
 * `docs/content-model-2025.md` § Measured containment (a tag-stack pass over the raw XML, exact
 * because the sources carry no comments or CDATA).
 *
 * R5: that table counts `table-reference` as a content unit, but normalize.mjs renders those
 * INLINE rather than emitting a file for each — so emitted units alone can never equal it. The
 * report prints two columns, emitted units and rendered table-references, and it is their SUM
 * that must equal these numbers. A delta is data loss, not a tolerance.
 */
export const PARITY = new Map([['2025', new Map([
  ['volume-one', new Map([['subtopic', 868], ['ncc-glossary', 537], ['clause', 336], ['specification', 251],
    ['spec-topic', 63], ['glossentry', 19], ['page', 4], ['glossdef', 4], ['li', 3], ['clause-variation', 2], ['callout', 2]])],
  ['volume-two', new Map([['ncc-glossary', 537], ['subtopic', 193], ['clause', 68], ['specification', 42],
    ['glossentry', 19], ['spec-topic', 5], ['glossdef', 4], ['page', 3], ['li', 3], ['section', 1], ['callout', 1], ['clause-variation', 1]])],
  ['volume-three', new Map([['ncc-glossary', 537], ['subtopic', 290], ['clause', 98], ['specification', 34],
    ['glossentry', 19], ['callout', 6], ['spec-topic', 5], ['page', 4], ['glossdef', 4], ['clause-variation', 1]])],
  ['housing-provisions', new Map([['ncc-glossary', 537], ['part', 319], ['clause', 246], ['glossentry', 19],
    ['callout', 6], ['li', 5], ['glossdef', 4], ['clause-variation', 3], ['page', 2], ['section', 1]])],
  ['livable-housing', new Map([['part', 15], ['section', 1], ['page', 1]])],
])]]);

/**
 * Editions for which assertion 3 has no transcribable target, each with the measurement that says
 * why — never a label. An edition that is in NEITHER `PARITY` nor here still fails on every unit
 * it produces (`expected` defaults to an empty Map, so each row is a positive delta), which is the
 * right answer for "nobody has transcribed the table yet".
 *
 * The exemption does not weaken the corpus: it moves the check, and names where to.
 */
export const PARITY_UNAVAILABLE = new Map([
  ['2022',
    'docs/content-model-2022.md publishes no equivalent of the 2025 table. Its §9.2 containment '
    + 'census counts parent->child ELEMENTS across all four packages COMBINED and over the raw '
    + 'dual-state view, so it is neither per-document nor NCC 2022. And the metric itself does not '
    + 'transfer: a 2022 unit is the ROOT of its own DITA file, so its immediate parent is the XML '
    + 'document node — measured on volume-one, the three rows this build would print are '
    + '`#document 1250`, `clause 24` (the nested state DELETE variations) and `abcb-map 513` (the '
    + 'map-inlined glossary), which reconciles against nothing anyone measured independently. '
    + 'Parity for 2022 is enforced instead in tools/test/read-2022.test.mjs, which checks the '
    + "reader's census against §1.3 / §4.1 / §5.3 / §5.4 / §6.1 / §7 per package, and its emission "
    + 'against that census — a stronger check than this one, because those numbers were measured '
    + 'from the XML by a document that had not seen this pipeline.'],
]);

/** The unit kinds the parity table counts. `page` units (overviews, front matter) are not units
 *  in content-model-2025.md's sense and are deliberately excluded from the parity column. */
const PARITY_KINDS = new Set(['clause', 'glossary']);

/**
 * R50 — the enumerated exceptions to assertion 2 (no clause ships without a `web_url`).
 *
 * The assertion stays absolute: a null clause `web_url` that is NOT on this list fails the build.
 * What the list adds is the ability to record a null that has been RULED ON — a clause the ABCB
 * publishes no page for — instead of choosing between failing every future build and weakening the
 * assertion for all clauses at once.
 *
 * Each entry is keyed on all four identifying attributes and carries the evidence that was checked.
 * That is deliberate: an exception whose evidence is a shrug is indistinguishable from a bug, and
 * an exception keyed loosely (on the clause id alone, say) would silently exempt every other
 * jurisdiction's copy of the same clause the moment one of THEM stopped resolving.
 */
export const NULL_WEB_URL_CLAUSES = [
  {
    edition: '2022',
    volume: 'volume-three',
    clause: 'E1D1',
    state: 'TAS',
    evidence:
      'ncc.abcb.gov.au publishes no Tasmania-scoped page for Volume Three Part E1. Measured in '
      + 'tools/data/weblinks-2022.json: the crawl holds twelve TAS volume-three part pages — a1, '
      + 'a4, a5, b1, b2, b7, c2, c3, c4, e2, e3, e4 — and none for e1; and '
      + '.../volume-three/9-tasmania/e1-facilities returns HTTP 404 (checked 2026-08-14). '
      + 'weblinks.mjs refuses the national Part E1 page on purpose — it carries a link and a '
      + 'client-side state filter, not the Tasmanian text — so a URL here would be a wrong '
      + 'citation rather than a missing one.',
  },
];

// A malformed entry is refused at import, not at the moment it would have exempted something: an
// exception missing its evidence must never be usable, and a build is the wrong place to find out.
for (const e of NULL_WEB_URL_CLAUSES) {
  for (const k of ['edition', 'volume', 'clause', 'evidence']) {
    if (typeof e[k] === 'string' && e[k].trim()) continue;
    throw new Error(`build: NULL_WEB_URL_CLAUSES entry ${JSON.stringify(e)} has no ${k} — an exception `
      + 'to the web_url assertion must name the edition, volume and clause it covers and state the evidence for it');
  }
  if (!('state' in e)) {
    throw new Error(`build: NULL_WEB_URL_CLAUSES entry for ${e.clause} does not state a state — write `
      + 'null for a national clause; an omitted key would exempt every jurisdiction at once');
  }
}

/**
 * The R50 entry covering this unit's null `web_url`, or null.
 *
 * @param {string} editionKey
 * @param {object} unit  a RawUnit
 * @returns {?object} the matching NULL_WEB_URL_CLAUSES entry
 */
export function nullWebUrlException(editionKey, unit) {
  const state = unit?.state ? String(unit.state).toUpperCase() : null;
  return NULL_WEB_URL_CLAUSES.find(e => e.edition === String(editionKey)
    && e.volume === unit?.volume
    && e.clause === unit?.id
    && (e.state ? e.state.toUpperCase() : null) === state) ?? null;
}

/**
 * A parity delta, as a build FAILURE rather than a printed advisory.
 *
 * Every content unit in `content-model-2025.md`'s table must reach a file or be rendered inline,
 * so a delta means units went missing between the XML and the corpus — data loss, and the exact
 * thing a bulk run must stop for. An advisory prints into a scrollback nobody reads.
 *
 * Only whole documents are checked: the target counts a complete document, so a `--sections` slice
 * has nothing to compare against and is skipped rather than reported as a phantom delta.
 *
 * @param {string} editionKey
 * @param {Map<string, {units: Map, tableRefs: Map, full: boolean}>} parityByDoc
 * @returns {?string} a report naming every disagreeing row, or null when everything reconciles.
 */
export function parityCheck(editionKey, parityByDoc) {
  if (PARITY_UNAVAILABLE.has(editionKey)) return null;
  const expectedAll = PARITY.get(editionKey) ?? new Map();
  const rows = [];
  for (const [docKey, p] of parityByDoc) {
    if (!p.full) continue;
    const expected = expectedAll.get(docKey) ?? new Map();
    const parents = [...new Set([...p.units.keys(), ...p.tableRefs.keys(), ...expected.keys()])].sort(byCodepoint);
    for (const parent of parents) {
      const u = p.units.get(parent) ?? 0;
      const t = p.tableRefs.get(parent) ?? 0;
      const e = expected.get(parent) ?? 0;
      const delta = u + t - e;
      if (delta !== 0) {
        rows.push(`  ${docKey}  ${parent}: ${u} units + ${t} table-refs = ${u + t}, expected ${e} (delta ${delta > 0 ? '+' : ''}${delta})`);
      }
    }
  }
  if (!rows.length) return null;
  return [
    `build: parity delta in edition ${editionKey} — ${rows.length} row(s) disagree with `
    + 'docs/content-model-2025.md. Every content unit in that table must reach a file or be '
    + 'rendered inline, so a delta is units lost between the XML and the corpus. Find it; do not '
    + 'tolerance it. A negative delta is content that vanished; a positive one is content counted '
    + 'twice or a parent the content model does not record.',
    ...rows,
  ].join('\n');
}

/**
 * A warning's category — the token before its first colon (normalize.mjs emits `category: detail`).
 *
 * A warning carrying no colon at all keeps its WHOLE name: `indexOf` returns -1 there, and
 * `slice(0, -1)` would silently drop the last character, printing `mathml-flattene` as a category
 * that looks like a typo in the source. Only an empty or colon-led string has no name to use.
 */
export function warningCategory(warning) {
  const s = String(warning ?? '').trim();
  const i = s.indexOf(':');
  if (i > 0) return s.slice(0, i);
  return i === 0 || !s ? 'uncategorised' : s;
}

/** Codepoint sort. Never localeCompare — locale-dependent order is not reproducible. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Literal text as a regex fragment. */
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ============================================================================
 * Arguments
 * ========================================================================= */

const FLAGS = new Set(['--edition', '--volumes', '--sections']);
const USAGE = 'usage: node tools/src/build.mjs [--edition 2025] [--volumes volume-one,…] [--sections A,C]';

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{editions: string[], volumes: ?string[], sections: ?string[]}}
 * @throws on anything it does not understand. A silently-ignored flag is the worst outcome here:
 *   `--slice A` typed instead of `--sections A` would rebuild the ENTIRE corpus while its author
 *   believed they were building one section, and the run would look completely successful.
 */
export function parseArgs(argv = []) {
  const raw = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--')) throw new Error(`build: unexpected argument ${JSON.stringify(arg)}\n${USAGE}`);
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    if (!FLAGS.has(key)) throw new Error(`build: unknown flag ${key}\n${USAGE}`);
    if (raw.has(key)) throw new Error(`build: ${key} given twice\n${USAGE}`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    const list = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length || String(value).startsWith('--')) throw new Error(`build: ${key} needs a comma-separated value\n${USAGE}`);
    raw.set(key, list);
  }

  const editions = raw.get('--edition') ?? [...EDITIONS.keys()].sort(byCodepoint);
  for (const e of editions) {
    if (EDITIONS.has(e)) continue;
    if (KNOWN_EDITIONS.includes(e)) {
      throw new Error(`build: NCC ${e} has no reader yet — add read-2022.mjs and an EDITIONS entry for it first`);
    }
    throw new Error(`build: unknown edition ${JSON.stringify(e)} — known editions are ${KNOWN_EDITIONS.join(', ')}`);
  }

  const volumes = raw.get('--volumes') ?? null;
  if (volumes) {
    const known = new Set(editions.flatMap(e => EDITIONS.get(e).documents.map(d => d.key)));
    for (const v of volumes) {
      if (!known.has(v)) {
        throw new Error(`build: unknown volume ${JSON.stringify(v)} — known volumes are ${[...known].sort(byCodepoint).join(', ')}`);
      }
    }
  }
  // --sections cannot be validated here: which section nums exist is a property of the data, so
  // a section that matches nothing is caught after reading, where it can say so precisely.
  return { editions: [...editions].sort(byCodepoint), volumes, sections: raw.get('--sections') ?? null };
}

/**
 * Mirrors read-2025.mjs's own slice rule exactly, including its "a section with an empty num is
 * always kept" clause. The two must agree: if the reader and the build disagreed about what a
 * slice contains, the build's producible set would not match what it emits and the deletion plan
 * would remove live files.
 */
export function inScope(unit, sections) {
  if (!sections) return true;
  const num = String(unit?.sectionNum ?? '');
  return num === '' || sections.includes(num);
}

/* ============================================================================
 * Uniqueness — the policy, in three branches
 * ========================================================================= */

/**
 * @param {Array<{relPath: string, content: string, docKey: string, docLabel: string,
 *                figurePrefix: string, unit: object, normalized: object,
 *                emitOpts: object}>} records  in emission order, which IS document order
 * @returns {{write: Map<string,string>, duplicates: number,
 *            merges: Array<{relPath, docKey, senses}>, glossary: Array<object>}}
 * @throws when one path is claimed by two units with different content and no rule covers it.
 *
 * The branches, and why each is not the others:
 *
 *  * SAME PATH, IDENTICAL BYTES -> written once. Calling that a collision would fail correct
 *    builds; two documents can legitimately produce the same file.
 *  * SAME PATH, DIFFERENT BYTES, SAME DOCUMENT, EVERY UNIT A GLOSSARY ENTRY -> merged under
 *    `## Definition n` headings in document order (R23). The NCC genuinely defines "Appropriate
 *    authority" twice with different meanings — one scoped to the Fire Safety Verification Method,
 *    one general. An agent grepping the term must see BOTH; missing the FSVM-scoped one is a
 *    compliance error. A hash or counter suffix would hide one sense behind a filename nobody
 *    globs for, and a counter would make the name depend on document order, breaking
 *    byte-identical regeneration.
 *  * SAME PATH, DIFFERENT BYTES, SAME DOCUMENT, ANY OTHER KIND -> throws. The merge is scoped to
 *    the glossary deliberately. R23's justification is a *glossary term carrying two senses*; it
 *    has no application to a clause or a page, where one filename claimed by two units means the
 *    naming rule lost a distinguishing attribute. That is ⊕ trap 1 exactly — Volume Two Part H6's
 *    NSW overview colliding with the national body inside one document — and absorbing it into a
 *    `## Definition n` file would report the corpus's worst defect class as an informational line.
 *  * ANY GLOSSARY PATH, ACROSS DOCUMENTS -> folded to one file. See foldGlossary (R33).
 *  * SAME PATH, DIFFERENT BYTES, DIFFERENT DOCUMENTS, ANY OTHER KIND -> throws. Merging would
 *    fabricate text the source does not publish; picking one would silently drop the other. No
 *    non-glossary kind can reach this today — `unitRelPath` files every other unit under its own
 *    volume directory, so two documents cannot claim one path — which is exactly why it stays: it
 *    is the guard for the day a naming rule changes and they can.
 *
 * Documents are grouped BEFORE contents are compared across them. Folding record by record
 * instead would compare a second volume's first sense against an already-merged file and report a
 * false cross-document conflict — the answer would depend on the order documents were read in.
 */
export function resolveUniqueness(records) {
  const byPath = new Map();
  for (const r of records) {
    if (!byPath.has(r.relPath)) byPath.set(r.relPath, new Map());
    const perDoc = byPath.get(r.relPath);
    if (!perDoc.has(r.docKey)) perDoc.set(r.docKey, []);
    perDoc.get(r.docKey).push(r);
  }

  const write = new Map();
  const mergesByPath = new Map();
  const glossary = [];
  const sameDoc = [];
  const crossDoc = [];
  let duplicates = 0;

  for (const relPath of [...byPath.keys()].sort(byCodepoint)) {
    // One resolved record per document, in DOCUMENT order — `byPath`'s inner Map preserves the
    // insertion order of `records`, which the build fills document by document. Everything below
    // that speaks of "the first document" means the first entry of this array.
    const perDocument = [];
    let collided = false;
    for (const [docKey, recs] of byPath.get(relPath)) {
      const distinct = [];
      for (const r of recs) if (!distinct.some(d => d.content === r.content)) distinct.push(r);
      duplicates += recs.length - distinct.length;
      if (distinct.length === 1) { perDocument.push(distinct[0]); continue; }
      if (!distinct.every(r => r.unit?.kind === 'glossary')) {
        sameDoc.push({ relPath, docKey, variants: distinct });
        collided = true;
        continue;
      }
      // Reported once per path, not once per document: the same two senses recur in every volume
      // that embeds the glossary, and four identical report lines would read like four problems.
      if (!mergesByPath.has(relPath)) mergesByPath.set(relPath, { relPath, docKey, senses: distinct.length });
      perDocument.push(mergeSenses(distinct));
    }
    // A path that already failed inside one document is not also compared across documents: the
    // build is failing either way, and the second report would be noise on top of the real one.
    if (collided) continue;

    if (perDocument.length && perDocument.every(r => r.unit?.kind === 'glossary')) {
      const folded = foldGlossary(relPath, perDocument);
      write.set(relPath, folded.content);
      glossary.push(folded.census);
      continue;
    }

    const variants = [];
    for (const c of perDocument) if (!variants.some(v => v.content === c.content)) variants.push(c);
    duplicates += perDocument.length - variants.length;
    if (variants.length === 1) write.set(relPath, variants[0].content);
    else crossDoc.push({ relPath, variants });
  }

  if (sameDoc.length || crossDoc.length) throw conflictError({ sameDoc, crossDoc });
  return { write, duplicates, merges: [...mergesByPath.values()], glossary };
}

/* ============================================================================
 * The glossary: one file per edition, however many volumes embed it (R33)
 * ========================================================================= */

/** What a neutralised figure URL reads as. Never emitted; it exists only to be compared. */
const FIGURE_CDN_PLACEHOLDER = '{figure-cdn}';

/**
 * One document's copy of a glossary entry with its figure URLs re-pointed at `target`.
 *
 * Every volume embeds the whole glossary, and each embeds its own copy of the figures, so this
 * pipeline hands the same entry a different `cdnKey` per volume: `…/2025/volume1/x.svg` from
 * Volume One and `…/2025/volume2/x.svg` from Volume Two. It has TWO callers, and they are the two
 * halves of one idea:
 *
 *  * COMPARING — target is a placeholder. Nine 2025 entries differ across the four documents in
 *    nothing but that key. Comparing raw bodies would classify those nine as text the NCC
 *    publishes differently per volume, which is false, and would put nine spurious "as published
 *    in …" merges in front of a reader as if the Code disagreed with itself.
 *  * EMITTING — target is the CANONICAL document's prefix. A folded file is cited to one document,
 *    so every figure in it must be addressed under that document's key: one directory, one cdnKey.
 *    Without this a merged entry would carry a `volume2` URL inside a file cited to Volume One.
 *
 * Only the emitting document's OWN prefix is rewritten, never a volume name wherever it appears,
 * so two entries citing genuinely different files still differ.
 */
function rewriteFigureCdn(record, target) {
  const prefix = record.figurePrefix;
  if (!prefix) {
    throw new Error(
      `build: glossary record ${record.relPath} from ${record.docKey} carries no figurePrefix. The `
      + 'glossary fold has to tell "the same figure, addressed under this volume\'s CDN key" from '
      + '"a different figure", and without the prefix it cannot — it would report every '
      + 'figure-bearing entry as text the volumes disagree on.',
    );
  }
  return record.normalized.bodyMd.split(`${prefix}/`).join(`${target}/`);
}

const neutralizeFigureCdn = record => rewriteFigureCdn(record, FIGURE_CDN_PLACEHOLDER);

/**
 * Group in first-seen order, so the result never depends on Map iteration or on a sort.
 * @returns {Array<{key: string, members: Array}>}
 */
function classify(items, keyOf) {
  const out = [];
  for (const item of items) {
    const key = keyOf(item);
    let cls = out.find(c => c.key === key);
    if (!cls) out.push(cls = { key, members: [] });
    cls.members.push(item);
  }
  return out;
}

/** `Volume One`, `Volume One and Housing Provisions`, `Volume One, Volume Two and Volume Three`. */
function listDocuments(records) {
  const names = records.map(r => r.docLabel || r.docKey);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * R33 — the glossary is ONE file per edition, and this decides what that file says.
 *
 * `unitRelPath` already routes every glossary entry to `{edition}/glossary/`, so up to four
 * documents' copies land on one path. They are never byte-identical (`citation:`, `web_url:` and
 * `sources:` are per-document by construction), so the question is only ever about the BODY:
 *
 *  * ONE body, once our own per-volume figure CDN key is neutralised -> the file is the FIRST
 *    document's copy, cited to that document, with `sources:` naming all of them. Measured across
 *    NCC 2025: 545 of the 555 shared paths are identical outright and 9 more are identical once
 *    the figure key is neutralised.
 *  * MORE THAN ONE body -> one file carrying every variant under a `## ` heading that names the
 *    documents publishing it. Measured: exactly one entry, "Hours of operation", where Volumes Two
 *    and Three carry an ABCB typo ("is greater thanat least 20%") that Volume One and the Housing
 *    Provisions do not. Emitting one volume's wording would silently drop the other's, and one
 *    file per variant would hide the discrepancy behind a filename nobody globs for. An agent
 *    grepping the term sees that the Code disagrees with itself, which is the fact it needs.
 *
 * The two cases are ONE rule with one and several classes, not a special case bolted onto a
 * general one: a new divergence in a future edition lands in the second branch automatically
 * rather than failing a build that has to be re-ruled.
 */
function foldGlossary(relPath, perDocument) {
  const sources = perDocument.map(r => r.docKey);
  const canonical = perDocument[0];
  const raw = classify(perDocument, r => r.normalized.bodyMd);
  const classes = classify(perDocument, neutralizeFigureCdn);
  const census = {
    relPath,
    sources,
    variants: classes.length,
    // True when neutralising OUR cdnKey is what collapsed them — the nine figure-bearing entries.
    figureNormalised: raw.length > classes.length,
    documents: classes.map(c => c.members.map(m => m.docKey)),
  };

  if (classes.length === 1) {
    return { content: emitUnit(canonical.unit, canonical.normalized, { ...canonical.emitOpts, sources }).content, census };
  }
  // Each class is represented by its own first document, so the heading and the text under it come
  // from the same place. Flat `## ` headings, deliberately: an entry that is BOTH multi-sense and
  // multi-document would otherwise need a heading level per axis, and every sense would still be
  // visible here — losing content is the failure mode this guards against, not untidy nesting.
  //
  // Every part's figure URLs are re-pointed at the CANONICAL document, not left on the volume the
  // wording came from. The file is cited to one document and lives in one directory, so a `volume2`
  // URL inside a file cited to Volume One would break the one-directory-one-cdnKey invariant the
  // corpus is checked on. No 2025 entry is both multi-variant and figure-bearing, so this changes
  // no byte of the current corpus — it is the shape a future edition would arrive in.
  const parts = classes.map(c => ({
    ...c.members[0],
    normalized: { ...c.members[0].normalized, bodyMd: rewriteFigureCdn(c.members[0], canonical.figurePrefix) },
  }));
  return {
    content: mergedRecord(canonical, parts, classes.map(c => `As published in ${listDocuments(c.members)}`), { sources }).content,
    census,
  };
}

/** R23: one file, both senses, each under its own heading, in document order. */
function mergeSenses(recs) {
  return mergedRecord(recs[0], recs, recs.map((_, i) => `Definition ${i + 1}`));
}

/**
 * One record standing for several, their bodies stacked under `## ` headings.
 *
 * Returns a RECORD rather than a string so a merge can be merged again — the glossary fold stacks
 * per-document copies that may themselves already be per-document sense merges — and so the result
 * carries the `unit`, `normalized` and `emitOpts` the next stage needs.
 */
function mergedRecord(canonical, parts, headings, emitExtra = {}) {
  const bodyMd = parts
    .map((p, i) => [`## ${headings[i]}`, p.normalized.bodyMd].filter(Boolean).join('\n\n'))
    .join('\n\n');
  const definedTerms = [];
  for (const p of parts) for (const t of p.normalized.definedTerms ?? []) if (!definedTerms.includes(t)) definedTerms.push(t);
  const normalized = { ...canonical.normalized, bodyMd, definedTerms };
  const emitOpts = { ...canonical.emitOpts, ...emitExtra };
  return { ...canonical, normalized, emitOpts, content: emitUnit(canonical.unit, normalized, emitOpts).content };
}

/**
 * Everything after a file's frontmatter. Used to split a cross-document conflict into the two
 * classes below, which need completely different rulings.
 */
function bodyOf(content) {
  const end = content.indexOf('\n---\n', 4);
  return end === -1 ? content : content.slice(end + 5);
}

function conflictError({ sameDoc, crossDoc }) {
  // Cross-document conflicts are split on whether the BODIES agree, because the two classes need
  // completely different rulings: identical bodies mean one file has to be given one provenance,
  // while differing bodies mean the sources genuinely publish different text under one name.
  // The measured instance was the 2025 glossary — 555 shared paths, 545 differing only in
  // provenance, 10 in body text — and it is now resolved BY RULE in foldGlossary rather than
  // reported here. The split stays because the distinction is what makes any such report
  // actionable, and because a naming change that let two documents claim one non-glossary path
  // would land here with no measurement behind it at all.
  const provenance = crossDoc.filter(c => c.variants.every(v => bodyOf(v.content) === bodyOf(c.variants[0].content)));
  const substantive = crossDoc.filter(c => !provenance.includes(c));
  const total = sameDoc.length + crossDoc.length;
  const lines = [
    `build: ${total} path${total === 1 ? '' : 's'} claimed by more than one unit with DIFFERENT `
    + 'content. Neither merging nor picking one is safe: merging fabricates text the NCC does not '
    + 'publish, and picking silently drops the other. Rule on each class below.',
  ];

  if (sameDoc.length) {
    // The worst class, so it is reported first. It means two units in ONE document derived the
    // same filename — the identity failure ⊕ trap 4 exists to catch, whose measured instance was
    // a state attribute missing from a filename derivation (⊕ trap 1).
    lines.push('', `  [S] ${sameDoc.length} path(s) collide INSIDE one document — two units derived one filename.`,
      '      Without this check the second silently overwrites the first. The filename rule has lost',
      '      an attribute that distinguishes them; `state` is the measured culprit. Merging is only',
      '      ever right for a glossary term that genuinely carries two senses (R23).');
    for (const { relPath, docKey, variants } of sameDoc) {
      lines.push(`      ${relPath}  (${docKey})`);
      const named = variants.map(v => ({ docKey: labelOf(v), content: v.content }));
      for (const v of named) lines.push(`        ${v.docKey} — ${v.content.length} bytes`);
      lines.push(...diffSummary(named).map(l => `    ${l}`));
    }
  }

  if (provenance.length) {
    lines.push('', `  [A] ${provenance.length} path(s) differ ONLY in provenance frontmatter — the body text is identical.`,
      '      Several documents publish the same text and one file has to be given ONE citation prefix',
      '      and web_url. That is a corpus-shape decision rather than something this build can infer.',
      '      The glossary makes it by rule (foldGlossary); anything else reaching here does not.');
    for (const { relPath, variants } of provenance.slice(0, 5)) {
      lines.push(`      ${relPath}  (${variants.map(v => v.docKey).join(' vs ')})`);
    }
    if (provenance.length > 5) lines.push(`      … and ${provenance.length - 5} more`);
  }

  if (substantive.length) {
    lines.push('', `  [B] ${substantive.length} path(s) differ in BODY TEXT across documents — genuinely different published text under one name.`,
      '      Each needs its own reading of the source; there is no blanket rule.');
    for (const { relPath, variants } of substantive) {
      lines.push(`      ${relPath}`);
      for (const v of variants) lines.push(`        ${v.docKey}: ${v.content.length} bytes`);
      lines.push(...diffSummary(variants).map(l => `    ${l}`));
    }
  }
  return new Error(lines.join('\n'));
}

/** How a colliding unit is named in a same-document conflict report. */
function labelOf(record) {
  const u = record.unit ?? {};
  return [u.kind, u.id ?? u.term ?? u.title, u.state ? `[${u.state}]` : ''].filter(Boolean).join(' ');
}

/**
 * The first BODY line where two variants disagree, so the ruling does not need the whole file.
 *
 * Deliberately over the body rather than the whole file: every cross-document variant differs in
 * its provenance frontmatter first (`volume:` is line 3 of a glossary file), so diffing the file
 * would report that line every single time and never show the text difference the reader is being
 * asked to rule on — burying the finding inside the report meant to surface it.
 */
function diffSummary(variants) {
  const out = [];
  const a = variants[0];
  for (const b of variants.slice(1)) {
    const la = bodyOf(a.content).split('\n');
    const lb = bodyOf(b.content).split('\n');
    let i = 0;
    while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
    out.push(`    first difference at body line ${i + 1}:`);
    out.push(`      ${a.docKey}: ${JSON.stringify((la[i] ?? '(end of body)').slice(0, 160))}`);
    out.push(`      ${b.docKey}: ${JSON.stringify((lb[i] ?? '(end of body)').slice(0, 160))}`);
  }
  return out;
}

/**
 * A run that cannot see the whole glossary does not rewrite ANY of it.
 *
 * The glossary is the one part of the corpus assembled from several documents at once, and
 * `foldGlossary` takes each entry's wording from the documents this run READ. A `--volumes
 * volume-two` run therefore rewrites all 555 files from a one-document view — and for an entry the
 * documents publish differently that is a SILENT DROP of published NCC text. Measured on the real
 * corpus before this guard: `--volumes volume-two` rewrote `hours-of-operation.md` with only the
 * Volume Two wording, both `## As published in …` headings gone, Volume One's sentence deleted, no
 * assertion firing anywhere. Nothing else in the repo catches it — CI never runs a build, and the
 * acceptance suite passes on the corrupted file, because #5 still holds and #1 is clause-only.
 *
 * So the rule is `planReconcile`'s, applied to the one directory that rule cannot express: a run
 * only audits what it fully covers. Withheld files are left EXACTLY as they are, and the glossary
 * directory drops out of `ownedDirs`, which puts it on the report's `not audited` line for free.
 *
 * Ownership is exact set equality against the edition's documents, not `opts.volumes == null`, so
 * naming every document explicitly is not punished. It is deliberately not "every document that
 * HAS a glossary": which those are is a property of data this run did not read, and a declared list
 * would be a claim to keep in sync with the source.
 *
 * @param {{selected: string[], all: string[], write: Map<string,string>,
 *          ownedDirs: Set<string>, glossaryDirs: Set<string>}} args
 * @returns {{write: Map<string,string>, ownedDirs: Set<string>, withheld: string[], owned: boolean}}
 *   Fresh collections; the inputs are not mutated.
 */
export function withholdPartialGlossary({ selected, all, write, ownedDirs, glossaryDirs }) {
  const owned = selected.length === all.length && all.every(k => selected.includes(k));
  if (owned || !glossaryDirs.size) {
    return { write, ownedDirs, withheld: [], owned };
  }
  const kept = new Map();
  const withheld = [];
  for (const [relPath, content] of write) {
    if (glossaryDirs.has(relPath.split('/')[1])) withheld.push(relPath);
    else kept.set(relPath, content);
  }
  return {
    write: kept,
    ownedDirs: new Set([...ownedDirs].filter(d => !glossaryDirs.has(d))),
    withheld: withheld.sort(byCodepoint),
    owned,
  };
}

/* ============================================================================
 * Deletion — what a run owns
 * ========================================================================= */

/**
 * @param {{edition: string, editionDirs: Set<string>, ownedDirs: Set<string>,
 *          producible: Set<string>, present: string[]}} args
 *   `producible` is every corpus path the SELECTED documents could produce — the FULL unit set,
 *   not this run's slice. `present` is what is on disk under `corpus/{edition}`, corpus-relative,
 *   directories marked with a trailing `/`.
 * @returns {{removePaths: string[], keepPaths: string[]}} both codepoint-sorted.
 *
 * The rule, stated precisely, because "delete the directories it owns" is ambiguous for a
 * `--sections` slice where a run owns PART of a directory:
 *
 *   * a directory no document of this edition can produce -> removed whole, whatever the filters.
 *     It cannot be another slice's output; nothing in this toolchain can make it.
 *   * a directory belonging to a document this run did not select -> untouched entirely.
 *   * inside an owned directory, a file the SELECTED documents cannot produce -> removed. This is
 *     the case the rule exists for: a renamed unit, or output from an older naming rule, that no
 *     test in this repo would ever look for.
 *   * inside an owned directory, a file that is producible but out of scope -> KEPT. `--sections A`
 *     must not destroy the Section C files an earlier run wrote; incremental slices are how the
 *     pilot tasks work.
 *   * `corpus/{edition}/INDEX.md` survives (it is rewritten); any other loose file there does not.
 */
export function planReconcile({ edition, editionDirs, ownedDirs, producible, present = [] }) {
  const removePaths = [];
  const keepPaths = [];
  const prefix = `${edition}/`;
  for (const raw of present) {
    const p = String(raw);
    if (!p.startsWith(prefix)) {
      throw new Error(`build: the reconcile plan for edition ${edition} was handed ${JSON.stringify(p)}, which is outside it`);
    }
    const isDir = p.endsWith('/');
    const segs = p.slice(prefix.length).replace(/\/$/, '').split('/');
    if (isDir) {
      // Corpus directories are flat: one level of volume/glossary directories under the edition.
      if (segs.length > 1 || !editionDirs.has(segs[0])) removePaths.push(p);
      continue;
    }
    if (segs.length === 1) { (segs[0] === 'INDEX.md' ? keepPaths : removePaths).push(p); continue; }
    if (segs.length > 2) continue;             // its directory is already scheduled for removal
    if (!editionDirs.has(segs[0])) continue;   // ditto
    if (!ownedDirs.has(segs[0])) { keepPaths.push(p); continue; }
    (producible.has(p) ? keepPaths : removePaths).push(p);
  }
  return { removePaths: removePaths.sort(byCodepoint), keepPaths: keepPaths.sort(byCodepoint) };
}

/* ============================================================================
 * The pipeline
 * ========================================================================= */

function buildEdition(editionKey, opts) {
  const ed = EDITIONS.get(editionKey);
  const linkIndex = buildLinkIndex(JSON.parse(fs.readFileSync(`tools/data/weblinks-${editionKey}.json`, 'utf8')));
  if (linkIndex.edition !== editionKey) {
    throw new Error(`build: tools/data/weblinks-${editionKey}.json indexes edition ${linkIndex.edition} — every URL in it would cite the wrong edition of the Code`);
  }
  const docs = ed.documents.filter(d => !opts.volumes || opts.volumes.includes(d.key));
  if (!docs.length) throw new Error(`build: --volumes selected no document of edition ${editionKey}`);

  const records = [];
  const producible = new Set();
  const glossaryDirs = new Set();
  const unresolvedClauses = [];
  const unresolvedOther = [];
  const permittedNullClauses = [];
  const droppedCitations = [];
  const sectionsSeen = new Set();
  const stats = {
    editionKey,
    perDoc: [],
    kinds: new Map(),
    warnings: new Map(),
    figures: new Set(),         // every {year}/{cdnKey}/{src} the documents READ contain
    webUrl: new Map(),          // kind -> {resolved, total}
    parity: new Map(),          // docKey -> {units: Map, tableRefs: Map, full: boolean}
  };

  for (const doc of docs) {
    // The reader is handed the WHOLE document and an out-parameter for what the source loses. Both
    // are read before the slice filter, so `droppedCitations` reports what this DOCUMENT loses,
    // not what this run happened to emit — which is the honest scope for a loss the citing clause
    // cannot detect.
    const diagnostics = {};
    const all = ed.readUnits(doc, { diagnostics });
    for (const d of diagnostics.droppedCitations ?? []) droppedCitations.push({ doc: doc.key, ...d });
    for (const u of all) {
      const rel = unitRelPath(u);
      producible.add(rel);
      // Derived from the units themselves rather than from `emit.mjs`'s default, so the guard below
      // still finds the directory if `glossaryDir` is ever configured differently.
      if (u.kind === 'glossary') glossaryDirs.add(rel.split('/')[1]);
      sectionsSeen.add(String(u.sectionNum ?? ''));
    }
    const scoped = all.filter(u => inScope(u, opts.sections));
    const units = new Map();
    const tableRefs = new Map();
    let figures = 0;
    let warnings = 0;

    for (const unit of scoped) {
      let normalized;
      try {
        normalized = normalizeUnit(unit, { year: ed.year, cdnKey: doc.cdnKey });
      } catch (cause) {
        throw new Error(
          `build: normalize failed in ${editionKey}/${doc.key}, section ${unit.sectionNum || '(front matter)'}, `
          + `${unit.kind} ${unit.id ?? unit.term ?? unit.title ?? '(untitled)'}${unit.state ? ` [${unit.state}]` : ''}\n`
          + `  ${cause.message}`,
          { cause },
        );
      }

      const webUrl = resolveWebUrl(unit, linkIndex);
      const seen = stats.webUrl.get(unit.kind) ?? { resolved: 0, total: 0 };
      seen.total++;
      if (webUrl) seen.resolved++;
      stats.webUrl.set(unit.kind, seen);
      if (!webUrl) {
        // R50: a clause null is a build failure UNLESS it is one of the enumerated, evidenced
        // exceptions — and a permitted one is still printed, because an exception nobody can see
        // in the report is a hole rather than a ruling.
        const exception = unit.kind === 'clause' ? nullWebUrlException(editionKey, unit) : null;
        if (exception) permittedNullClauses.push({ doc: doc.key, unit, exception });
        else (unit.kind === 'clause' ? unresolvedClauses : unresolvedOther).push({ doc: doc.key, unit });
      }

      const emitOpts = { citationPrefix: doc.citationPrefix, webUrl };
      const { relPath, content } = emitUnit(unit, normalized, emitOpts);
      // `docLabel` and `figurePrefix` are carried for the glossary fold alone: it names the
      // documents behind each variant in prose, and it has to recognise this document's own figure
      // CDN prefix to tell our per-volume artefact from text the Code publishes differently.
      records.push({
        relPath, content, docKey: doc.key, docLabel: doc.volumeLabel ?? doc.key,
        figurePrefix: figureUrlPrefix({ year: ed.year, cdnKey: doc.cdnKey }),
        unit, normalized, emitOpts,
      });

      const kindKey = unit.kind === 'page' && unit.overview ? 'page (overview)' : unit.kind;
      stats.kinds.set(kindKey, (stats.kinds.get(kindKey) ?? 0) + 1);
      if (PARITY_KINDS.has(unit.kind)) {
        const parent = unit.node?.parentNode?.nodeName ?? '(no parent)';
        units.set(parent, (units.get(parent) ?? 0) + 1);
      }
      for (const parent of normalized.tableRefs) tableRefs.set(parent, (tableRefs.get(parent) ?? 0) + 1);
      for (const src of normalized.figures) stats.figures.add(`${ed.year}/${doc.cdnKey}/${src}`);
      figures += normalized.figures.length;
      for (const w of normalized.warnings) {
        const cat = warningCategory(w);
        stats.warnings.set(cat, (stats.warnings.get(cat) ?? 0) + 1);
        warnings++;
      }
    }

    stats.perDoc.push({ key: doc.key, read: all.length, scoped: scoped.length, figures, warnings });
    stats.parity.set(doc.key, { units, tableRefs, full: !opts.sections });
  }

  if (opts.sections) {
    const missed = opts.sections.filter(s => !sectionsSeen.has(s));
    if (missed.length) {
      throw new Error(
        `build: --sections ${missed.join(',')} matched no section of ${docs.map(d => d.key).join(', ')} — `
        + `available: ${[...sectionsSeen].filter(Boolean).sort(byCodepoint).join(', ')}`,
      );
    }
  }

  // Both assertions are GATHERED rather than thrown, for two reasons. One run then yields one
  // ruling instead of a sequence of builds each surfacing the next problem. And main() can print
  // the full report — parity census included — before it fails: the parity table is the most
  // useful diagnostic there is, and throwing here would withhold it at exactly the moment
  // somebody needs it to work out what went wrong.
  const failures = [];
  let resolved = { write: new Map(), duplicates: 0, merges: [], glossary: [] };
  try {
    resolved = resolveUniqueness(records);
  } catch (e) { failures.push(e.message); }
  if (unresolvedClauses.length) failures.push(unresolvedClauseError(editionKey, unresolvedClauses));
  const parityFailure = parityCheck(editionKey, stats.parity);
  if (parityFailure) failures.push(parityFailure);

  // A run that did not read every document must not rewrite the glossary from a partial view.
  // Applied AFTER the assertions, so a partial run is still told about a conflict it would have
  // caused, and before anything is counted or written, so no report line describes a file this run
  // is not going to produce.
  const glossaryGuard = withholdPartialGlossary({
    selected: docs.map(d => d.key),
    all: ed.documents.map(d => d.key),
    write: resolved.write,
    ownedDirs: new Set([...producible].map(p => p.split('/')[1])),
    glossaryDirs,
  });

  // The figures the corpus PUBLISHES, read back off the bytes about to be written rather than
  // accumulated from the units. The two differ, and only this one is actionable: every volume
  // embeds the glossary, so a shared entry's figure is counted once per volume in `stats.figures`
  // while the folded file publishes exactly one URL for it. Measured on NCC 2025: 456 against 426.
  // `sync-figures` scans the same bytes, so a build report and a figure sweep now agree by
  // construction instead of disagreeing by 30 and costing somebody an afternoon.
  const figureUrl = new RegExp(
    `(?:${docs.map(d => escapeRe(figureUrlPrefix({ year: ed.year, cdnKey: d.cdnKey }))).join('|')})/[^)\\s]+`, 'g');
  const publishedFigures = new Set();
  for (const content of glossaryGuard.write.values()) for (const m of content.matchAll(figureUrl)) publishedFigures.add(m[0]);

  const firstByPath = new Map();
  for (const r of records) if (!firstByPath.has(r.relPath)) firstByPath.set(r.relPath, r.unit);
  const indexEntries = [...glossaryGuard.write.keys()].map(relPath => {
    const u = firstByPath.get(relPath);
    return { relPath, kind: u.kind, id: u.id ?? null, term: u.term ?? null, title: u.title ?? '', state: u.state ?? null };
  });

  return {
    editionKey,
    failures,
    write: glossaryGuard.write,
    producible,
    editionDirs: new Set([...ed.documents.map(d => d.key), 'glossary']),
    ownedDirs: glossaryGuard.ownedDirs,
    indexEntries,
    unresolvedOther,
    permittedNullClauses,
    droppedCitations,
    stats: {
      ...stats,
      duplicates: resolved.duplicates,
      merges: resolved.merges,
      glossary: resolved.glossary,
      glossaryWithheld: glossaryGuard.withheld,
      documentsSelected: docs.length,
      documentsInEdition: ed.documents.length,
      publishedFigures,
      paths: glossaryGuard.write.size,
    },
  };
}

function unresolvedClauseError(editionKey, unresolved) {
  const lines = [
    `build: ${unresolved.length} clause unit${unresolved.length === 1 ? '' : 's'} in edition ${editionKey} `
    + 'resolved to NO web_url. weblinks.mjs fails closed on purpose — it answers null rather than a '
    + 'plausible wrong page — so this is either a gap in tools/data/weblinks-' + editionKey
    + '.json (re-run `npm run fetch-weblinks`) or a keying rule that does not fit these units.',
  ];
  for (const { doc, unit } of unresolved.slice(0, 20)) {
    lines.push(`  ${doc}  section ${unit.sectionNum || '-'}  ${unit.id ?? unit.title}${unit.state ? ` [${unit.state}]` : ''}`);
  }
  if (unresolved.length > 20) lines.push(`  … and ${unresolved.length - 20} more`);
  return lines.join('\n');
}

/* ============================================================================
 * Filesystem
 * ========================================================================= */

const toFsPath = relPath => path.join(CORPUS, ...relPath.split('/'));

/** Everything under `corpus/{edition}`, corpus-relative, directories marked with a trailing `/`. */
function census(editionKey) {
  const out = [];
  const root = path.join(CORPUS, editionKey);
  if (!fs.existsSync(root)) return out;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodepoint(a.name, b.name))) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) { out.push(`${child}/`); walk(path.join(dir, e.name), child); } else out.push(child);
    }
  };
  walk(root, editionKey);
  return out;
}

function applyPlan(built) {
  const plan = planReconcile({
    edition: built.editionKey,
    editionDirs: built.editionDirs,
    ownedDirs: built.ownedDirs,
    producible: built.producible,
    present: census(built.editionKey),
  });
  const removedDirs = plan.removePaths.filter(p => p.endsWith('/'));
  for (const p of plan.removePaths) fs.rmSync(toFsPath(p.replace(/\/$/, '')), { recursive: true, force: true });
  for (const relPath of [...built.write.keys()].sort(byCodepoint)) {
    const file = toFsPath(relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, built.write.get(relPath));   // content is LF throughout; never os.EOL
  }
  return {
    written: built.write.size,
    removedFiles: plan.removePaths.length - removedDirs.length,
    removedDirs: removedDirs.length,
    kept: plan.keepPaths.length,
  };
}

/** `.md` files per `{edition}/{directory}`, for the root index's census. Excludes INDEX.md. */
function corpusTree() {
  const tree = [];
  if (!fs.existsSync(CORPUS)) return tree;
  for (const ed of fs.readdirSync(CORPUS, { withFileTypes: true }).filter(e => e.isDirectory())) {
    for (const dir of fs.readdirSync(path.join(CORPUS, ed.name), { withFileTypes: true }).filter(e => e.isDirectory())) {
      const files = fs.readdirSync(path.join(CORPUS, ed.name, dir.name))
        .filter(f => f.endsWith('.md') && f !== 'INDEX.md').length;
      tree.push({ dir: `${ed.name}/${dir.name}`, files });
    }
  }
  return tree.sort((a, b) => byCodepoint(a.dir, b.dir));
}

/* ============================================================================
 * The report
 * ========================================================================= */

const RULE = '='.repeat(78);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/** Greedy word wrap, for the two blocks that print a prose ruling rather than a table. Splits on
 *  spaces only, so it is deterministic and never breaks a filename or a URL. */
function wrap(text, indent = '  ', width = 78) {
  const lines = [];
  let line = indent;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line !== indent && line.length + 1 + word.length > width) { lines.push(line); line = indent; }
    line += line === indent ? word : ` ${word}`;
  }
  if (line !== indent) lines.push(line);
  return lines;
}

/**
 * @param {object} built  a buildEdition result
 * @param {?{written, removedFiles, removedDirs, kept}} io  null when nothing was written — either
 *   because THIS edition failed its assertions or because another edition in the same run did.
 *   Both cases must render; reading `io.written` on a passing edition inside a failing run is a
 *   null deref that would replace the whole report with a TypeError.
 * @param {object} opts   parseArgs output
 */
export function report(built, io, opts) {
  const s = built.stats;
  const banner = built.failures.length ? '   *** FAILED — NOTHING WRITTEN ***'
    : io ? '' : '   *** NOT WRITTEN — another edition in this run failed ***';
  const out = [RULE, `NCC corpus build — edition ${built.editionKey}${banner}`];
  out.push(`scope: volumes = ${opts.volumes ? opts.volumes.join(',') : 'all'}`
    + ` · sections = ${opts.sections ? opts.sections.join(',') : 'all'}`);
  out.push('-'.repeat(78));
  out.push(`${pad('document', 22)}${padL('read', 8)}${padL('in scope', 10)}${padL('figures', 9)}${padL('warnings', 10)}`);
  for (const d of s.perDoc) out.push(`${pad(d.key, 22)}${padL(d.read, 8)}${padL(d.scoped, 10)}${padL(d.figures, 9)}${padL(d.warnings, 10)}`);
  out.push('-'.repeat(78));

  out.push(`${pad('units by kind', 22)}${[...s.kinds.keys()].sort(byCodepoint).map(k => `${k} ${s.kinds.get(k)}`).join(' · ') || '(none)'}`);
  out.push(`${pad('web_url', 22)}${[...s.webUrl.keys()].sort(byCodepoint)
    .map(k => `${k} ${s.webUrl.get(k).resolved}/${s.webUrl.get(k).total} (${pct(s.webUrl.get(k).resolved, s.webUrl.get(k).total)})`).join(' · ') || '(none)'}`);
  // Two numbers because they answer two questions, and printing only the first invites an operator
  // to chase a discrepancy against `sync-figures` that is not one. The gap has two possible
  // causes and the line names the one that applies, rather than asserting the usual one.
  const published = s.publishedFigures?.size ?? s.figures.size;
  const unpublished = s.figures.size - published;
  const why = s.glossaryWithheld?.length
    ? 'the glossary was withheld, so this run publishes none of its figures'
    : "a shared glossary entry's figure is published once, not once per volume";
  out.push(`${pad('figures', 22)}${published} distinct URLs published`
    + ` · ${s.figures.size} distinct in the documents as read`
    + (unpublished > 0 ? ` (${unpublished} not published — ${why})` : ''));
  const warnTotal = [...s.warnings.values()].reduce((a, b) => a + b, 0);
  out.push(`${pad('warnings', 22)}${warnTotal}${warnTotal ? ` — ${[...s.warnings.keys()].sort(byCodepoint).map(k => `${k} ${s.warnings.get(k)}`).join(' · ')}` : ''}`);
  out.push(`${pad('uniqueness', 22)}${s.paths} paths · ${s.duplicates} identical duplicate${s.duplicates === 1 ? '' : 's'} · ${s.merges.length} merged`);
  for (const m of s.merges) out.push(`${pad('', 22)}merged ${m.senses} senses into ${m.relPath} (first seen in ${m.docKey})`);
  out.push(...glossaryLines(s));
  out.push(io
    ? `${pad('files', 22)}written ${io.written} · deleted ${io.removedFiles} · directories removed ${io.removedDirs} · left in place ${io.kept}`
    : `${pad('files', 22)}NOTHING WRITTEN — this run failed its assertions, so the previous corpus is untouched`);
  // A run only audits the directories of the documents it selected. Saying which ones it did NOT
  // look at is the difference between "the corpus is clean" and "the part of it I rebuilt is
  // clean" — and only the second is true after a --volumes slice.
  const unaudited = [...built.editionDirs].filter(d => !built.ownedDirs.has(d)).sort(byCodepoint);
  if (unaudited.length) {
    out.push(`${pad('not audited', 22)}${unaudited.join(', ')} — no document of this run owns these directories, so a stale file in one survives until it is rebuilt`);
  }

  out.push('', parityBlock(built));
  out.push(droppedCitationsBlock(built));
  out.push(unresolvedBlock(built));
  out.push(...permittedNullBlock(built));
  if (built.failures.length) out.push('', `ASSERTIONS FAILED (${built.failures.length}):`, '', ...built.failures);
  out.push(RULE);
  return out.join('\n');
}

/**
 * The glossary fold (R33), as a census rather than a claim.
 *
 * Printed only when the run produced glossary files, but then ALWAYS — including the zero cases.
 * The three classes are the whole decision: how many entries every document agreed on, how many
 * agreed once our own per-volume figure CDN key was neutralised, and how many the documents
 * genuinely publish differently. The last class is named path by path with the documents behind
 * each variant, because it is a discrepancy in the published Code and a count alone would hide it.
 */
function glossaryLines(s) {
  const list = s.glossary ?? [];
  // A withheld glossary REPLACES the census rather than appearing beside it. On a one-document run
  // the census reads `555 paths · 0 shared across documents · 0 published differently`, which is
  // true of what the run saw and useless as a signal — and it was the only signal there was.
  if (s.glossaryWithheld?.length) {
    return [`${pad('glossary', 22)}NOT WRITTEN — ${s.glossaryWithheld.length} file(s) withheld, `
      + `this run selected ${s.documentsSelected} of ${s.documentsInEdition} documents`,
    ...wrap('Every volume embeds the whole glossary, so a partial run would rewrite all of it from '
      + 'a partial view: an entry the unselected documents publish differently would lose their '
      + 'wording with no assertion firing. The existing files are left exactly as they are — '
      + 'rebuild the whole edition to refresh them.', ' '.repeat(22))];
  }
  if (!list.length) return [];
  const shared = list.filter(g => g.sources.length > 1);
  const variants = shared.filter(g => g.variants > 1);
  // Counted on the remainder, not on the whole list, so the classes partition `shared` exactly
  // even if an entry ever both needed neutralising AND still disagreed.
  const collapsed = shared.filter(g => g.variants === 1);
  const figures = collapsed.filter(g => g.figureNormalised);
  const lines = [`${pad('glossary', 22)}${list.length} path${list.length === 1 ? '' : 's'}`
    + ` · ${shared.length} shared across documents`
    + ` · ${collapsed.length - figures.length} body-identical`
    + ` · ${figures.length} figure-URL normalised`
    + ` · ${variants.length} published differently`];
  for (const g of variants) {
    lines.push(`${pad('', 22)}${g.relPath}: ${g.variants} variants — `
      + g.documents.map(d => `[${d.join(', ')}]`).join(' / '));
  }
  return lines;
}

/**
 * What the SOURCE loses: a citation whose cited wrapper holds no content of this edition.
 *
 * Printed unconditionally, including the zero. A block that appeared only when something was lost
 * would make "this build has no such losses" and "this build does not look for them" render
 * identically — and the whole reason this is here is that the losses were previously recorded in a
 * diagnostics object nothing consumed, i.e. invisible to everyone running a build.
 */
function droppedCitationsBlock(built) {
  const list = built.droppedCitations ?? [];
  const byKind = new Map();
  for (const d of list) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
  const lines = ['', `DROPPED CITATIONS — ${list.length}`
    + (list.length ? ` — ${[...byKind.keys()].sort(byCodepoint).map(k => `${k} ${byKind.get(k)}`).join(' · ')}` : '')];
  if (!list.length) {
    lines.push('  none — no clause cites a wrapper that is empty in this edition');
    return lines.join('\n');
  }
  lines.push('  A clause cites a table or figure whose wrapper file holds nothing in this edition:',
    '  every <table>/<image> in it belongs to the OTHER edition, so the citing clause ships without',
    '  it. This is the source\'s own condition, not a normalizer defect — but it is content the',
    '  published clause has and the corpus file does not, and the reader cannot tell.',
    '  Counted over each document as READ (whole), not over the slice that was emitted.');
  for (const d of list.slice(0, 20)) {
    lines.push(`  ${pad(d.doc, 20)}${pad(d.kind, 7)}${d.host}`, `${' '.repeat(29)}-> ${d.wrapper}`);
  }
  if (list.length > 20) lines.push(`  … and ${list.length - 20} more`);
  return lines.join('\n');
}

/** R50: clause nulls that were ruled on rather than left to fail. */
function permittedNullBlock(built) {
  const list = built.permittedNullClauses ?? [];
  if (!list.length) return [];
  const lines = ['', `PERMITTED null web_url — ${list.length} clause unit${list.length === 1 ? '' : 's'} `
    + '(NULL_WEB_URL_CLAUSES; every other clause null FAILS the build)'];
  for (const { doc, unit, exception } of list) {
    lines.push(`  ${pad(doc, 20)}${unit.id}${unit.state ? ` [${unit.state}]` : ''}`, ...wrap(exception.evidence, '    '));
  }
  return [lines.join('\n')];
}

function parityBlock(built) {
  const unavailable = PARITY_UNAVAILABLE.get(built.editionKey);
  if (unavailable) {
    return [`PARITY — not checked for edition ${built.editionKey}`, ...wrap(unavailable)].join('\n');
  }
  const expectedAll = PARITY.get(built.editionKey) ?? new Map();
  const lines = ['PARITY — content units by immediate parent (docs/content-model-2025.md)'];
  let deltas = 0;
  for (const [docKey, p] of built.stats.parity) {
    const expected = expectedAll.get(docKey) ?? new Map();
    const parents = [...new Set([...p.units.keys(), ...p.tableRefs.keys(), ...(p.full ? expected.keys() : [])])].sort(byCodepoint);
    lines.push('', p.full
      ? `  ${docKey} — full document`
      : `  ${docKey} — SLICE: parity is not checked (the target counts whole documents)`);
    lines.push(`    ${pad('parent', 22)}${padL('units', 8)}${padL('+table-refs', 13)}${padL('= sum', 8)}${p.full ? `${padL('expected', 10)}${padL('delta', 8)}` : ''}`);
    let tu = 0; let tt = 0; let te = 0;
    for (const parent of parents) {
      const u = p.units.get(parent) ?? 0;
      const t = p.tableRefs.get(parent) ?? 0;
      const e = expected.get(parent) ?? 0;
      tu += u; tt += t; te += e;
      const delta = u + t - e;
      if (p.full && delta !== 0) deltas++;
      lines.push(`    ${pad(parent, 22)}${padL(u, 8)}${padL(t, 13)}${padL(u + t, 8)}`
        + (p.full ? `${padL(e, 10)}${padL(delta === 0 ? '0' : `${delta > 0 ? '+' : ''}${delta}  <<`, 8)}` : ''));
    }
    lines.push(`    ${pad('TOTAL', 22)}${padL(tu, 8)}${padL(tt, 13)}${padL(tu + tt, 8)}`
      + (p.full ? `${padL(te, 10)}${padL(tu + tt - te, 8)}` : ''));
  }
  // A delta is data loss, so it gets its own banner rather than a number in a column of numbers —
  // and parityCheck has already turned it into a build failure, so this is a pointer to the
  // detail, not the whole story.
  lines.push('', deltas
    ? `  !! PARITY DELTA on ${deltas} row(s) — the build FAILS on this; see the assertion detail below.`
    : '  parity: no full-document deltas');
  return lines.join('\n');
}

/**
 * A unit's SHAPE, for the unresolved list. `kind` alone does not separate the classes a ruling has
 * to be made on: 2022's Section overviews (`topicset/@summary`, a unit shape 2025 has no
 * equivalent of, so weblinks.mjs has no keying rule for one) and its front matter are both `page`,
 * and a list that called them the same thing would hide a whole new class inside a known one.
 */
function shapeOf(unit) {
  if (unit.kind !== 'page') return unit.kind;
  if (!unit.overview) return 'page';
  return unit.containerKind === 'ncc-section' ? 'section overview' : 'container overview';
}

function unresolvedBlock(built) {
  const list = built.unresolvedOther;
  const byShape = new Map();
  for (const { unit } of list) { const s = shapeOf(unit); byShape.set(s, (byShape.get(s) ?? 0) + 1); }
  const lines = ['', `UNRESOLVED web_url — ${list.length} non-clause unit${list.length === 1 ? '' : 's'} `
    + '(the build fails outright on a clause, so this list is pages and glossary entries only)'
    + (list.length ? `\n  by shape: ${[...byShape.keys()].sort(byCodepoint).map(s => `${s} ${byShape.get(s)}`).join(' · ')}` : '')];
  for (const { doc, unit } of list.slice(0, 20)) {
    lines.push(`  ${pad(doc, 20)}${pad(shapeOf(unit), 19)}${unit.title || unit.term || unit.id}${unit.state ? ` [${unit.state}]` : ''}`);
  }
  if (list.length > 20) lines.push(`  … and ${list.length - 20} more`);
  return lines.join('\n');
}

/* ============================================================================
 * Entry point
 * ========================================================================= */

export async function main(argv) {
  const opts = parseArgs(argv);
  await fetchAll();                       // cache-warm: verifies the pinned SHA-256s, fetches nothing

  // Read, normalize, emit and assert EVERYTHING before a single byte is written or deleted, so a
  // failing build leaves the previous corpus intact instead of half-rewritten.
  const built = opts.editions.map(e => buildEdition(e, opts));

  const failures = built.flatMap(b => b.failures);
  if (failures.length) {
    // Report first, throw second: the parity census and the counts are how somebody works out
    // what the failure means, and they are computed by now.
    console.log(built.map(b => report(b, null, opts)).join('\n\n'));
    throw new Error(`build: ${failures.length} assertion failure(s) — see the report above. Nothing was written.`);
  }

  const reports = built.map(b => report(b, applyPlan(b), opts));
  const unitsByEdition = new Map(built.map(b => [b.editionKey, b.indexEntries]));
  for (const { relPath, content } of buildIndexes(unitsByEdition, { tree: corpusTree() })) {
    const file = toFsPath(relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  console.log(reports.join('\n\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(`\n${e.message}\n`); process.exit(1); });
}
