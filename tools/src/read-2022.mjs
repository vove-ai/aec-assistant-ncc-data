// read-2022.mjs — the NCC 2022 walker.
//
// Same output as read-2025.mjs (a flat, ordered list of RawUnits) from a source that shares
// almost no structural assumption with it: 11,331 per-file DITA topics instead of one
// contents.xml, CALS tables instead of HTML ones, a publication map instead of an enclosing
// <ncc-section>, state variations in separate FILES instead of inline, and figures joined by @id.
//
// THE ONE FACT THAT DECIDES WHETHER THIS CORPUS STATES THE LAW (docs/content-model-2022.md §1):
// the four 2022 packages are DUAL-STATE EDITORIAL FILES. They carry NCC 2022 as their base layer
// with the NCC 2025 draft on top as tracked changes, by three separate mechanisms. `textContent`
// yields a document that is NEITHER edition — clause IDs like `B1P43` (base `B1P4` + accepted
// `B1P3`) that exist nowhere. Everything below is read in the BASE view, and `applyBaseView`
// materialises it in the DOM once per file so that nothing downstream — membership, the figure
// join, the renderer — has to remember to ask.
//
// A reader that gets this wrong produces a corpus that is wrong SELF-CONSISTENTLY. No internal
// test catches that, which is why the base view has its own regression tests against markup
// copied out of the source, and why the parity numbers in read-2022.test.mjs are transcribed from
// a document that measured them rather than derived from this module's own output.
//
// Design rules, in priority order:
//  1. Recursion, not a container whitelist (read-2025.mjs rule 1 — it cost that walker three
//     corrections and the lesson transfers unchanged).
//  2. Fail loud. Every element the walker reaches is classified by one of the sets below; an
//     element in none of them throws, naming the element and its path.
//  3. Prose is never walked into. A unit's subtree is handed over whole via `node`.
//  4. Where the source ships something broken — four ERROR_IN_RESOLVING_URI conrefs, one figure
//     pointer whose id joins nothing — it is RECORDED in `diagnostics`, never silently dropped
//     and never confused with a defect of ours.
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';

export const DOCUMENTS_2022 = [
  { key: 'volume-one', pkg: 'ncc-2022-volume-one', cdnKey: 'volume1', citationPrefix: 'NCC 2022 V1', volumeLabel: 'Volume One' },
  { key: 'volume-two', pkg: 'ncc-2022-volume-two', cdnKey: 'volume2', citationPrefix: 'NCC 2022 V2', volumeLabel: 'Volume Two' },
  { key: 'volume-three', pkg: 'ncc-2022-volume-three', cdnKey: 'volume3', citationPrefix: 'NCC 2022 V3', volumeLabel: 'Volume Three' },
  { key: 'housing-provisions', pkg: 'ncc-2022-housing-provisions', cdnKey: 'housing', citationPrefix: 'NCC 2022 HP', volumeLabel: 'Housing Provisions' },
];

/* ===========================================================================
 * The base view (§1.1) — three tracked-change mechanisms, not one.
 * ======================================================================== */

const TRACKCHANGES_NS = 'urn:xpressauthor:trackchanges';
const localName = n => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n);

/**
 * The tracked-change mark on ONE element, or null.
 *
 * The complete predicate, and every clause of it is load-bearing (§11):
 *
 *   local name `type`, in the trackchanges namespace OR IN NO NAMESPACE, AND value in
 *   {insert, delete}.
 *
 *  * `xt:` and `ns0:` both bind to the trackchanges namespace in the SAME package, so matching a
 *    prefix misses one of them.
 *  * The BARE `type=` form has `namespaceURI === null` — XML attributes do not inherit a default
 *    namespace — so "in the trackchanges namespace" misses 355/301/358/476 per package, and they
 *    sit on `table-reference`, `clause` and `image-reference`, i.e. on WHOLE UNITS.
 *  * Without the value clause the predicate matches 25,714 attributes in volume-one of which only
 *    8,299 are marks: 17,415 false positives, every one an `xref/@type` — which would delete
 *    every cross-reference in the volume from the base view.
 */
function marksOf(el) {
  const attrs = el.attributes;
  if (!attrs) return [];
  // Paired by PREFIX, not by document order: 1-2 elements per package carry the mark under two
  // spellings at once, and volume-one's `10-8-3-Ventilation-…` carries a bare
  // `type="insert" dateTime="2022-01-13"` beside an `xt:type="insert" xt:dateTime="2024-03-12"`.
  // Taking "the last type" with "the last dateTime" would pair one spelling's direction with the
  // other's date the moment the source writes them the other way round.
  const byPrefix = new Map();
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    const ln = localName(a.nodeName);
    if (ln !== 'type' && ln !== 'dateTime') continue;
    const prefix = a.nodeName.includes(':') ? a.nodeName.slice(0, a.nodeName.indexOf(':')) : '';
    if (ln === 'type') {
      if ((a.namespaceURI !== TRACKCHANGES_NS && a.namespaceURI !== null)
        || (a.value !== 'insert' && a.value !== 'delete')) continue;
      byPrefix.set(prefix, { ...(byPrefix.get(prefix) ?? {}), type: a.value });
    } else {
      byPrefix.set(prefix, { ...(byPrefix.get(prefix) ?? {}), dateTime: a.value });
    }
  }
  return [...byPrefix.values()].filter(m => m.type)
    .map(m => ({ type: m.type, year: editYear(m.dateTime ?? '', el) }));
}

/**
 * Which editorial cycle an edit belongs to. Measured across all four packages: 2020, 2021, 2022,
 * 2024, 2025 — the two cycles are cleanly separated and nothing lands between them. A date that
 * does land between them, or a mark with no date at all, is an edit this rule cannot classify;
 * guessing which edition it belongs to is exactly the silent corruption this module exists to
 * prevent, so it throws.
 */
function editYear(dateTime, el) {
  const y = Number(String(dateTime).slice(0, 4));
  if (!Number.isFinite(y) || y === 0) {
    throw new Error(`read-2022: tracked-change mark on <${el.nodeName}> carries no dateTime — `
      + 'its editorial cycle cannot be determined, and guessing decides which edition the text belongs to');
  }
  if (y >= 2023 && y < 2024) {
    throw new Error(`read-2022: tracked-change mark on <${el.nodeName}> dated ${y} falls between the `
      + 'NCC 2022 cycle (<=2022) and the NCC 2025 draft cycle (>=2024) — classify it before reading it');
  }
  return y;
}

const DRAFT_CYCLE_FROM = 2024;

/**
 * Does this element survive into the NCC 2022 base view?
 *
 * The rule is PER DIRECTION, not "keep everything dated <= 2022" (§1.1):
 *
 *   | mark   | dated <=2022 (NCC 2022 cycle)          | dated >=2024 (NCC 2025 draft) |
 *   | insert | KEEP — already accepted into NCC 2022  | DROP                          |
 *   | delete | DROP — removed before NCC 2022 shipped | KEEP                          |
 *
 * <=2022 deletes are vanishingly rare (1-2 per package) so getting this wrong costs almost
 * nothing — but a reader implementing "<=2022 = keep" in both directions has written the wrong
 * rule, and would go on writing it as the source changes.
 */
export function baseViewKeeps(el) {
  // EVERY mark must say keep. An element marked inserted in the 2022 cycle AND again in the 2025
  // cycle is 2025-draft content; requiring unanimity decides that without depending on which
  // spelling the source happened to write last.
  return marksOf(el).every(m => (m.type === 'insert' ? m.year < DRAFT_CYCLE_FROM : m.year >= DRAFT_CYCLE_FROM));
}

/**
 * Is this element rejected specifically as a CONTAINER THE 2025 DRAFT ADDED?
 *
 * R73's retention applies to that case and to no other, because the restructuring story is true
 * only of it: the draft created a container and moved existing text into it. The other rejection —
 * `delete` dated <=2022 — is text removed from the document BEFORE NCC 2022 shipped, and its
 * content being untracked is not evidence of anything, since a pre-2022 deletion is recorded at
 * element level by design. Retaining on that would republish words the Code had already dropped.
 */
function rejectedAsDraftInsert(el) {
  const marks = marksOf(el);
  return marks.length > 0 && marks.every(m => m.type === 'insert' && m.year >= DRAFT_CYCLE_FROM);
}

/**
 * Text in this subtree that belongs to the NCC 2022 base cycle, or '' — computed by the TEXT-level
 * mechanisms alone (1 and 2), deliberately ignoring every element-level mark inside it.
 *
 * It answers one question: "if this element were not dropped, would anything of the 2022 Code
 * remain under it?" Element-level marks are exactly what is in question at the call site, so they
 * must not filter here — the recursion in `applyBaseView` re-asks the same question of every
 * descendant, and a descendant that answers no is dropped there.
 *
 * Base-cycle text is text outside every `insText` range and outside every container-form
 * `insText`, INCLUDING text inside a `delText` range dated >=2024 — which §1.1's table says is
 * NCC 2022 text to KEEP.
 *
 * INLINE-ONLY text does not count, and the exclusion is measured rather than defensive. A
 * milestone range brackets TEXT; an inline element sitting between the end of one range and the
 * start of the next is not covered by either, so its text survives this computation while being
 * 2025-draft content — `A5G6`'s `<xref>non-combustible</xref>` and `volume-two H6D2`'s
 * `<xref type="insert">required</xref>` are the two instances in all four packages, and both are a
 * single glossary word inside a sentence that is otherwise wholly inserted. A bare text node under
 * a block element is the opposite case: the editor did not author it in this cycle.
 */
export function baseCycleText(el) {
  let out = '';
  let inserted = 0;
  const visit = (node, inInline) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (inserted === 0 && !inInline) out += c.data; continue; }
      if (c.nodeType !== 1) continue;
      const ln = localName(c.nodeName);
      if (ln === 'insText' || ln === 'delText') {
        const action = c.getAttribute('xt:action') || c.getAttribute('action') || '';
        if (action === 'start') { if (ln === 'insText') inserted++; continue; }
        if (action === 'end') { if (ln === 'insText') inserted = Math.max(0, inserted - 1); continue; }
        if (ln === 'delText') visit(c, inInline);   // container form: the NCC 2022 words
        continue;                                   // container-form insText: the 2025 draft's
      }
      visit(c, inInline || INLINE_TEXT_TAGS.has(ln));
    }
  };
  visit(el, INLINE_TEXT_TAGS.has(localName(el.nodeName)));
  return collapse(out);
}

/**
 * Markup whose text `baseCycleText` does not read, because the tracking mechanism cannot reach
 * inside it — so its survival proves nothing about which edition it belongs to.
 *
 *  * INLINE elements. A milestone range brackets sibling TEXT; an inline element between the end
 *    of one range and the start of the next is covered by neither.
 *  * MATHML and the MathType payload beside it. Measured across all four packages: 1,918 `<math>`
 *    elements, `0` carrying a milestone and `0` carrying an element-level mark anywhere inside.
 *    An equation is opaque to tracked changes, so its content can never be base-cycle evidence —
 *    and `<image>` here is the GIF fallback's base64, not prose.
 */
const INLINE_TEXT_TAGS = new Set(['xref', 'a', 'b', 'i', 'u', 'em', 'strong', 'span', 'ph', 'link',
  'sub', 'sup', 'glossref', 'equation-inline', 'placeholder', 'clauseref-inline',
  'math', 'mathML', 'image']);

/**
 * R73 — the enumerated exceptions to "base-cycle text is retained".
 *
 * A milestone range brackets a RUN of text, and the runs are not contiguous: XPress splits one
 * whenever an inline element or a second-round edit interrupts it, and it does not always close
 * over the punctuation between two runs. So a handful of characters can sit outside every range
 * inside prose that is wholly a 2025-draft insertion. Retaining on that evidence publishes 2025
 * text as NCC 2022 — the one failure this module exists to prevent — so those sites are named
 * here, with the published NCC 2022 that proves what the retained text is not.
 *
 * `text` is the EXACT base-cycle text `baseCycleText` computes (whitespace collapsed, inline and
 * MathML content excluded), which is why the shorter entries read as fragments: an entry is a
 * measurement of the source, not a quotation of the Code. `file` is the source file's basename —
 * these packages ship the same file in up to four zips, byte-identically, so the fact is a
 * property of the FILE and applies wherever it appears. An entry that matches nothing during a
 * full read FAILS THE BUILD: a ruling that stops firing has silently gone stale, and this one
 * stands between the draft and the corpus.
 *
 * Anything NOT on this list is retained. That is the safe direction: the cost of a wrong
 * retention is a visible fragment in one file; the cost of a wrong drop is published Code that is
 * simply not there, which is invisible to every guard in this repository.
 */
export const NOT_BASE_CYCLE_TEXT = [
  {
    file: '10-8-1-external-wall-construction.xml', tag: 'subclause', text: ';',
    evidence:
      'The whole subclause is a 2024-02-26 insertion — "Subject to (5), for the purposes of (2) and (3), '
      + 'a drained and ventilated cavity…" — and every word of it sits inside an xt:insText range. The one '
      + 'character outside them is a semicolon between two ranges. NCC 2022 HP 10.8.1 has no such '
      + 'subclause (the published clause ends at (3)), and a corpus paragraph reading ";" states nothing.',
  },
  {
    file: 'B1P1-structural-reliability.xml', tag: 'callout', text: 's',
    evidence:
      'The callout is a 2024-03-11 insertion whose three list items are each one xt:insText range '
      + '("Annual probability of failure (P_F) can be derived from the reliability index (β)…"). The '
      + 'surviving "s" is the plural left outside a range when a 2025-01 edit re-bracketed the run. '
      + 'Published NCC 2022 V1 B1P1 carries one explanatory box, about the 1 October 2023 solar '
      + 'photovoltaic load, which this corpus already emits; a blockquote reading "> s" is not the other.',
  },
  {
    file: 'J6D5-fan-systems.xml', tag: 'subclause', text: ',',
    evidence:
      'A 2024-04-10 inserted subclause whose prose is one xt:insText range and whose only untracked '
      + 'characters are a comma between two ranges. Retaining it emits the formula '
      + 'n_(minroof)=0.062xIn(P)+0.35; ncc.abcb.gov.au publishes NCC 2022 V1 J6D5(2) with exactly two '
      + 'formulas, "ηmin = 0.13×ln(p)−0.3" at (a) and "ηmin = 0.85×(a×ln(P)−b+N)/100" at (c), and no '
      + 'roof-fan grade. (Fetched 2026-08-15 from the clause file\'s own web_url.)',
  },
  {
    file: 'B1V1-structural-reliability.xml', tag: 'ol', text: ': :',
    evidence:
      'Two colons, the punctuation between three inserted equation ranges. Retaining the list emits a '
      + 'second copy of the reliability-index equation β=ln[(R/S)√(C_S/C_R)]/√(ln(C_R.C_S)) — which this '
      + 'corpus already publishes at B1V1(3)(b), from untracked source — under a duplicate "(a)" label, '
      + 'plus two summation equations for S̄ and σ²_S that NCC 2022 V1 B1V1 does not contain.',
  },
  {
    file: 'B1V1-Determination-of-velocity.xml', tag: 'callout', text: '.',
    evidence:
      'A single full stop between two inserted ranges, in the Volume Three clause that '
      + 'OMITTED_2022_CLAUSES already omits as clause-is-2025-only (every body range is a 2024 '
      + 'xt:insText insertion). Nothing from this file reaches the corpus, and a retention here would '
      + 'contradict the omission ruling rather than add anything to it.',
  },
  {
    file: '10-2-14-acceptable-shower-area.xml', tag: 'subclause',
    text: 'to include a with falls complying with ; and',
    evidence:
      'The 2025 draft split HP 10.2.14 into subclauses; this inserted one is a copy of the requirement '
      + 'the corpus ALREADY emits from the untracked list as 10.2.14(a) — "to include a floor waste with '
      + 'falls complying with 10.2.12; and". Published NCC 2022 HP 10.2.14 states it once. Retaining it '
      + 'prints the same requirement twice in one file, the second time with no label.',
  },
  {
    file: '10-2-14-acceptable-shower-area.xml', tag: 'subclause',
    text: 'with a—stepdown complying with ; or complying with ; orlevel threshold complying with .',
    evidence:
      'The same split, for 10.2.14(b) and its (i)/(ii)/(iii) — stepdown 10.2.15, hob 10.2.16, level '
      + 'threshold 10.2.17 — which the corpus already emits from the untracked list. Published NCC 2022 '
      + 'HP 10.2.14 states them once, as sub-paragraphs of (b).',
  },
  {
    file: 'C1P6-contamination.xml', tag: 'subclause',
    text: 'entry of foul gases from the system into buildings, such that—at pressures of up to ±375 Pa, '
      + 'water trap seals will not be reduced to depths less than 70 mm for trap seals in pressurised '
      + 'rooms and25 mm for all other applications; oran level of safety to human health is achieved as '
      + 'a system complying to (i); and',
    evidence:
      'A 2025-draft restatement of V3 C1P6(1)(a), which the corpus already emits verbatim from the '
      + 'untracked list, including its (i) and (ii). The inserted copy also re-splits "70 mm … and 25 mm '
      + '…" into two sub-items, so retaining it prints the requirement twice with two different '
      + 'sub-numberings in one file.',
  },
  {
    file: 'C1P6-contamination.xml', tag: 'subclause',
    text: 'entry of and stormwater into the system.',
    evidence:
      'The draft\'s replacement for V3 C1P6(1)(b). The published NCC 2022 text — which this corpus '
      + 'already emits at (b) — reads "entry of surface water, subsurface water and stormwater into the '
      + 'system"; the inserted copy drops "subsurface water". Retaining it would print a narrower '
      + 'requirement beside the wider published one, in the same clause.',
  },
  {
    file: 'F1F1-protection-from-redirected-surface-water.xml', tag: 'li',
    text: 'from damage caused by redirected surface .',
    evidence:
      'ncc.abcb.gov.au publishes NCC 2022 V1 F1F1 in full as one sentence: "A building, including any '
      + 'associated sitework, is to be constructed in a way that protects people and other property from '
      + 'the adverse effects of redirected surface water." There is no second limb, and the Part\'s other '
      + 'Functional Statement, F1F2, is about resistance to rain, surface water and ground water. '
      + '(Fetched 2026-08-15 from the file\'s own web_url.)',
  },
];

const rulingKey = e => `${e.file}|${e.tag}|${e.text}`;

/**
 * How `applyBaseView` tells `splice` that a surviving pointer carries a 2025 insert mark.
 *
 * An attribute rather than a side list because the pointer is resolved in another pass, from a
 * DOM that is parsed on demand and cloned — anything held beside the tree would not survive the
 * round trip. It never reaches the corpus: `splice` either replaces the pointer with the wrapper
 * or removes it, and no attribute is emitted into markdown in either case.
 */
const DRAFT_POINTER_ATTR = 'xt-base-view-draft-pointer';

/**
 * R73 — the UNIT a retention sits in, and how `applyBaseView` tells the rest of the pipeline.
 *
 * The retention record used to carry the source FILE alone, and that is too coarse to act on. One
 * of the 27 files carrying retentions is `FlattenedFile.xml`, the publication's SPINE: a whole-file
 * attribution there would tag every page, glossary entry and Part overview in the volume with a
 * caveat that belongs to one element of it.
 *
 * `UNIT_ELEMENT_TAGS` is exactly the set of elements this reader hands `emit` as a unit's `node` —
 * a clause file's root, a DELETE clause-variation, a glossary entry, a map `page`, a container
 * whose own prose becomes its overview, a part-variation, and the `topicset` whose `@summary` is a
 * Section overview. Every other element is walked THROUGH on the way up.
 *
 * The count rides on the DOM as an ATTRIBUTE, for the same reason `DRAFT_POINTER_ATTR` does: the
 * unit is emitted from a DOM parsed in a LATER pass, so nothing held beside pass 1's tree survives
 * to the point where the decision is needed. It never reaches the corpus — normalize.mjs renders
 * text, and no attribute is written into markdown.
 */
const UNIT_ELEMENT_TAGS = new Set([
  'clause',            // a clause file's root — what emitClauseFile hands over
  'clause-variation',  // a DELETE jurisdiction variation is a unit in its own right
  'abcb-glossentry',
  'page',
  'part', 'specification',   // a container's own prose becomes its overview unit
  'part-variation',
  'topicset',          // §11: @summary is the Section's published abstract, emitted as an overview
]);

const RETENTION_ATTR = 'xt-base-view-retention';

/** The unit element enclosing this one, or null when the retention sits outside every unit. */
function enclosingUnit(el) {
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
    if (UNIT_ELEMENT_TAGS.has(p.nodeName)) return p;
  }
  return null;
}

/**
 * How many base-view retentions this unit's subtree holds — 0 for every unit that has none.
 *
 * Read off the mark `applyBaseView` left, and read from the unit node DOWNWARDS as well as on the
 * node itself: a `<table-reference>`/`<image-reference>` wrapper is a FILE of its own, so a
 * retention inside one is attributed to the wrapper root (no unit encloses it there) and only
 * becomes part of a unit when `splice` clones it into the citing clause.
 *
 * Exported because build.mjs decides from it whether a file carries the in-body disclosure, and a
 * second hand-rolled reader of the same attribute could disagree with this one.
 */
export function baseViewRetentionCount(node) {
  if (!node || node.nodeType !== 1) return 0;
  let n = Number(node.getAttribute?.(RETENTION_ATTR) ?? 0) || 0;
  for (const el of node.getElementsByTagName?.('*') ?? []) {
    // A nested unit answers for itself. Its retentions belong to ITS file, and this unit's body
    // does not render it — BODY_TAGS_2022 skips `clause-variation` inside a clause — so counting
    // them here would put a caveat on a file that carries none of the text it warns about.
    if (UNIT_ELEMENT_TAGS.has(el.nodeName)) continue;
    n += Number(el.getAttribute(RETENTION_ATTR) ?? 0) || 0;
  }
  return n;
}

// Refused at import, on the same terms as OMITTED_2022_CLAUSES: an exception whose evidence is a
// shrug is indistinguishable from a bug, and a build is the wrong place to find that out.
for (const e of NOT_BASE_CYCLE_TEXT) {
  for (const k of ['file', 'tag', 'text', 'evidence']) {
    if (typeof e[k] === 'string' && e[k].trim()) continue;
    throw new Error(`read-2022: NOT_BASE_CYCLE_TEXT entry ${JSON.stringify(e)} has no ${k} — an exception `
      + 'must name the source file, the element and the exact surviving text, and state its evidence');
  }
  if (e.evidence.length < 80) {
    throw new Error(`read-2022: NOT_BASE_CYCLE_TEXT entry for ${e.file} states ${e.evidence.length} characters `
      + 'of evidence — dropping text the base view kept needs a measurement a reader can check, not a label');
  }
}

/** The R73 entry covering this surviving text, or null. */
function notBaseCycle(file, tag, text) {
  if (!file) return null;
  const base = file.slice(file.lastIndexOf('/') + 1);
  return NOT_BASE_CYCLE_TEXT.find(e => e.file === base && e.tag === tag && e.text === text) ?? null;
}

/**
 * R75 — the enumerated transcription divergences in retained text.
 *
 * THE CLASS. A retention keeps text the 2025 draft moved inside a container it marked as NEW. The
 * mark says the container is new; it does not say where the text under it came from — and where
 * the draft's author RE-TYPED an NCC 2022 requirement into that container rather than moving the
 * marked-up original, what the base view retains is the author's transcription. A transcription
 * can diverge from the published Code, and nothing in the source records that it has: the words
 * carry no tracked change, so no transform can tell a faithful copy from a slip. The only way to
 * find one is to read the retained text against the published clause.
 *
 * WHAT THIS TABLE IS, AND WHAT IT IS NOT. It holds the divergences FOUND BY INSPECTION — one, at
 * the time of writing. Every other retention site in the corpus is UNAUDITED: no one has compared
 * it word by word with ncc.abcb.gov.au. So this table is emphatically NOT a clean bill of health
 * for the rest, and must never be read as one; the in-file note R76 puts on every affected unit
 * says exactly that to the reader, in open terms, because the set of divergences is not known.
 *
 * THE DISCIPLINE, which is NOT_BASE_CYCLE_TEXT's. `file` is the source file's basename (these
 * packages ship the same file in up to four zips, byte-identically, so the fact is a property of
 * the FILE); `find` is matched against text nodes AFTER the base view is materialised, and must
 * match EXACTLY ONCE in the file — a correction that matches nothing, or twice, means the source
 * changed underneath it and FAILS THE BUILD rather than being quietly dropped; `evidence` states
 * the published text it was checked against, in at least 80 characters; `url` is the page it was
 * read from. `find` is matched WITHIN one text node — the base view leaves the retained run whole,
 * and a correction that would have to span two nodes is a different problem, which this refuses
 * loudly rather than half-applying.
 */
export const RETAINED_TEXT_CORRECTIONS = [
  {
    file: 'J9D4-facilities-for-electric-vehicle-charging-equipment.xml',
    find: 'per outgoing circuit for individual sub-circuit for individual sub-circuit electricity metering',
    replace: 'per outgoing circuit for individual sub-circuit electricity metering',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/j-energy-efficiency/'
      + 'part-j9-energy-monitoring-and-site-distributed-energy-resources',
    evidence:
      'The <li> is inside an <ol xt:type="insert"> the 2025 draft added and its text is bare, so the base '
      + 'view retains it — and what it retains is the draft author\'s re-typing, with the phrase "for '
      + 'individual sub-circuit" typed twice. The published national text, on '
      + 'part-j9-energy-monitoring-and-site-distributed-energy-resources inside the container '
      + 'id="_73065437-b0a4-4784-a4fa-fdfc648f7cc9" — which is character-for-character the <clause id> of '
      + 'this source file — reads "…per outgoing circuit for individual sub-circuit electricity metering…", '
      + 'the phrase appearing ONCE. There is no state-variation container for J9D4 on that page, so there '
      + 'is no other candidate reading to confuse it with. (Read 2026-08-15 from the clause\'s own web_url.)',
  },
];

const correctionKey = e => `${e.file}|${e.find}`;

// Refused at import, on the same terms as the tables above: a correction to published Code with no
// checkable measurement behind it is indistinguishable from a typo, and a build is the wrong place
// to discover which one it is.
for (const e of RETAINED_TEXT_CORRECTIONS) {
  for (const k of ['file', 'find', 'replace', 'evidence', 'url']) {
    if (typeof e[k] === 'string' && e[k].trim()) continue;
    throw new Error(`read-2022: RETAINED_TEXT_CORRECTIONS entry ${JSON.stringify(e)} has no ${k} — a correction `
      + 'must name the source file, the exact text it replaces and what it replaces it with, and state its evidence');
  }
  if (e.find === e.replace) {
    throw new Error(`read-2022: RETAINED_TEXT_CORRECTIONS entry for ${e.file} replaces its text with itself — `
      + 'a correction that changes nothing would still have to fire, and would assert something untrue');
  }
  if (e.evidence.length < 80) {
    throw new Error(`read-2022: RETAINED_TEXT_CORRECTIONS entry for ${e.file} states ${e.evidence.length} characters `
      + 'of evidence — rewriting text the corpus publishes as law needs a measurement a reader can check, not a label');
  }
}
{
  const keys = RETAINED_TEXT_CORRECTIONS.map(correctionKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error('read-2022: two RETAINED_TEXT_CORRECTIONS entries key the same site — the second could never '
      + 'fire on its own, and the staleness check would then fail every build for a reason nobody can act on');
  }
}

/**
 * Apply R75 to a materialised base view, in place. One text node at a time, and EXACTLY ONCE.
 *
 * Run after all three tracked-change mechanisms, so what it sees is what the corpus will print.
 * A count other than 1 throws: 0 means the source no longer says what the ruling was written
 * against, and 2 means the phrase is no longer the single site it was measured at — either way the
 * evidence has gone stale, and a correction to published Code must not apply itself on a guess.
 */
function applyRetainedTextCorrections(doc, sourceFile, fired) {
  if (!sourceFile) return;
  const base = sourceFile.slice(sourceFile.lastIndexOf('/') + 1);
  const entries = RETAINED_TEXT_CORRECTIONS.filter(e => e.file === base);
  if (!entries.length) return;
  const texts = [];
  (function collect(node) {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) texts.push(c);
      else if (c.nodeType === 1) collect(c);
    }
  })(doc.documentElement);
  for (const e of entries) {
    let hits = 0;
    for (const t of texts) {
      const n = t.data.split(e.find).length - 1;
      if (!n) continue;
      hits += n;
      t.data = t.data.split(e.find).join(e.replace);
    }
    if (hits !== 1) {
      throw new Error(`read-2022: the RETAINED_TEXT_CORRECTIONS entry for ${e.file} matched ${hits} times in the `
        + `base view of ${sourceFile}, not once. It corrects a transcription divergence measured against the `
        + `published Code (${e.url}); a count of 0 means the source no longer carries the text the ruling was `
        + 'written against, and more than 1 means it is no longer the single site it was measured at. '
        + 'Re-establish what the source says before this build is trusted.');
    }
    fired?.add(correctionKey(e));
  }
}

/**
 * R76 — the in-file disclosure every unit carrying a base-view retention prints.
 *
 * ONE LINE, and it leads with a fixed token, because the corpus's contract with the agent reading
 * it is one paragraph per line and one grep to find every affected file. It is placed straight
 * after the H1 so the caveat is met BEFORE the text it qualifies.
 *
 * It is deliberately OPEN. The source does not record which passages were re-typed or where a
 * letter came from, so the set of divergences is unknown — and this repository has been burned
 * before by a closed rule asserted over open evidence. The note therefore says what is true of the
 * class, names both consequences (the sub-numbering and the wording), and sends the reader to
 * `web_url`; it names no clause, because a specific example read as a boundary is exactly the
 * false closure it is written to avoid. The build report and corpus/2022/INDEX.md carry the
 * specifics.
 */
export const BASE_VIEW_NOTE_TOKEN = 'BASE-VIEW RETENTION:';

export const BASE_VIEW_NOTE = `${BASE_VIEW_NOTE_TOKEN} part of the text below was kept from a container the `
  + 'NCC 2025 draft marked as new, and the source records only that the container is new — never where its '
  + 'text sat before. Two things follow, and the source cannot settle either: the SUB-NUMBERING here is the '
  + "draft's rather than the Code's, so a letter may restart, be missing, or sit at a different level than "
  + "the published clause prints it; and the WORDING is the draft author's re-typing of the NCC 2022 text, "
  + 'which is not guaranteed to match the published Code word for word. Which passages are affected is not '
  + 'recorded anywhere in the packages and has not been established, so treat nothing here as verified: '
  + 'quote the words and the clause rather than a sub-paragraph letter, and check anything you rely on '
  + 'against the published clause at `web_url`.';

if (/\n/.test(BASE_VIEW_NOTE)) {
  throw new Error('read-2022: BASE_VIEW_NOTE spans more than one line — the corpus\'s grep contract is one '
    + 'paragraph per line, and a wrapped note breaks the retrieval it exists to protect');
}

/**
 * Rewrite a parsed document IN PLACE into its NCC 2022 base view.
 *
 * Doing it as a DOM transform, once per file, rather than as a filter at each read site, is what
 * makes the rest of this module — and the whole of normalize.mjs — safe by construction: after
 * this call there is no 2025 draft text left to accidentally read, and `xt:insText`/`xt:delText`
 * never reach the renderer (§9.1).
 *
 * Three mechanisms, in the order they must be applied:
 *
 *  1. ELEMENT-LEVEL MARKS (§1.1 mechanism 3). Drop what `baseViewKeeps` rejects — but the mark is
 *     on the ELEMENT, and it says nothing about the text underneath it. The 2025 editing
 *     restructured clauses by wrapping, promoting and re-homing NCC 2022 text inside NEW
 *     containers, and XPress marks the new container inserted while leaving the carried-over text
 *     untracked (or bracketed by a `delText`, which §1.1 says is 2022 text to KEEP). Deleting such
 *     a container with its subtree discards published Code that carries no mark of its own.
 *     Verified against ncc.abcb.gov.au: `J6D5`'s subclauses 8/9/10 in the draft are NCC 2022
 *     J6D5(3)(b), (c) and (d) verbatim; `J5D2`'s inserted `<ol>` holds the 2022 stem "elements
 *     forming the envelope of a Class 2 to 9 building, other than—" inside a `delText`.
 *     So: an element the mark rejects is dropped ONLY IF `baseCycleText` finds nothing under it.
 *     Where it finds something the element is RETAINED and the recursion re-asks the same question
 *     of each child, so the 2025-only parts inside it are still dropped, one level down. A label
 *     left over a subtree that renders nothing is then removed by normalize.mjs (R61/R72), not
 *     here — this transform decides membership, never presentation.
 *     Sibling-pair selection (§6.1) is unaffected: where a `table-reference` holds an inserted and
 *     a deleted `<table>`, the inserted one is wholly inside `insText` ranges, so nothing is
 *     retained and removing it leaves the 2022 table — and DOCUMENT ORDER IS NOT THE SELECTOR,
 *     the insert being first in 5 of the 9 multi-table wrappers.
 *  2. MILESTONE PAIRS (§1.1 mechanism 1). `xt:insText`/`xt:delText` as EMPTY, self-closing
 *     elements bracketing a run of sibling text. The ranges CROSS ELEMENT BOUNDARIES, so they are
 *     tracked with a depth counter over a document-order traversal, never by recursing into the
 *     element. Treating them as containers is the trap that makes the whole file look like clean
 *     2022: they have no text content, so base and accepted come out identical.
 *  3. CONTAINER FORM (§1.1 mechanism 2). The same element names WITH text content and no action:
 *     `delText` is unwrapped (it is the 2022 text), `insText` is removed.
 *
 * One start/end id per package is unbalanced, so the counters clamp at zero rather than assert.
 */
export function applyBaseView(doc, {
  sourceFile = '', retained = null, ruledFired = null, correctionsFired = null,
} = {}) {
  const root = doc.documentElement;
  if (!root) return doc;

  const drop = [];
  const visit = el => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (baseViewKeeps(c)) { visit(c); continue; }
      if (!rejectedAsDraftInsert(c)) { drop.push(c); continue; }
      // A POINTER's own emptiness is not its TARGET's. `<table-reference conref>` and
      // `<image-reference conref>` carry no content — the table or figure lives in another file —
      // so `baseCycleText` is empty for every one of them and mechanism 1 would delete the pointer
      // on evidence about the wrong document. Measured in volume-one: 27 pointers carry a 2025
      // insert mark and 4 of them name a wrapper that still holds NCC 2022 content, two of those
      // being V3 C2V3's Tables C2V3a and C2V3b — the frequency factor and the discharge units its
      // own base-view formula needs, cited by name in untracked 2022 prose. So the pointer is
      // MARKED instead of dropped, and `splice` decides on the target: it is restored where the
      // wrapper has 2022 content and dropped where it does not.
      if ((c.nodeName === 'table-reference' || c.nodeName === 'image-reference') && c.getAttribute('conref')) {
        c.setAttribute(DRAFT_POINTER_ATTR, '1');
        continue;
      }
      const kept = baseCycleText(c);
      if (!kept) { drop.push(c); continue; }
      const ruled = notBaseCycle(sourceFile, c.nodeName, kept);
      if (ruled) { ruledFired?.add(rulingKey(ruled)); drop.push(c); continue; }
      // Retained, and RECORDED: a retention is the reader deciding that a container the 2025 draft
      // marked inserted is carrying NCC 2022 text. That judgement must be countable — the build
      // prints the total and the source-file breakdown — so a source change that starts or stops
      // producing them is visible rather than absorbed.
      //
      // ATTRIBUTED, too: the record names the enclosing unit and the unit itself is marked, so the
      // disclosure can be put in the file a reader actually opens instead of only in a report that
      // ships nowhere. Where no unit encloses it the mark goes on the document's ROOT — a
      // `table-reference`/`image-reference` wrapper is a file of its own, and its content joins a
      // unit only when `splice` clones it into the citing clause, which carries the mark with it.
      const unit = enclosingUnit(c) ?? root;
      unit.setAttribute(RETENTION_ATTR, String((Number(unit.getAttribute(RETENTION_ATTR) ?? 0) || 0) + 1));
      retained?.push({
        file: sourceFile,
        tag: c.nodeName,
        text: kept,
        unitTag: unit.nodeName,
        unitId: attr(unit, 'id'),
      });
      visit(c);
    }
  };
  visit(root);
  for (const el of drop) el.parentNode?.removeChild(el);

  let inserted = 0;
  const remove = [];
  const unwrap = [];
  const walk = node => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (inserted > 0) remove.push(c); continue; }
      if (c.nodeType !== 1) continue;
      const ln = localName(c.nodeName);
      if (ln !== 'insText' && ln !== 'delText') { walk(c); continue; }
      const action = c.getAttribute('xt:action') || c.getAttribute('action') || '';
      if (action === 'start') {
        if (ln === 'insText') inserted++;
        remove.push(c);
      } else if (action === 'end') {
        if (ln === 'insText') inserted = Math.max(0, inserted - 1);
        remove.push(c);
      } else if (ln === 'insText') {
        remove.push(c);                       // container form: the 2025 draft's words
      } else {
        unwrap.push(c); walk(c);              // container form: the NCC 2022 words
      }
    }
  };
  walk(root);
  for (const n of remove) n.parentNode?.removeChild(n);
  for (const el of unwrap) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  // R75, LAST: a correction is measured against what the corpus will print, so it is applied to
  // the finished base view rather than to a tree that still holds the draft's markup.
  applyRetainedTextCorrections(doc, sourceFile, correctionsFired);
  return doc;
}

/**
 * The ACCEPTED (NCC 2025 draft) reading of one element's text, taken BEFORE `applyBaseView`.
 *
 * Needed for exactly two jobs, both of them joins rather than content: the state-variation
 * identity join, which matches on the host's base-OR-accepted designation (§5.3.1), and the
 * membership census that reproduces §1.3. No accepted text ever reaches a unit.
 */
function acceptedText(el) {
  let out = '';
  let deleted = 0;
  const visit = node => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (deleted === 0) out += c.data; continue; }
      if (c.nodeType !== 1) continue;
      const ln = localName(c.nodeName);
      if (ln === 'insText' || ln === 'delText') {
        const action = c.getAttribute('xt:action') || c.getAttribute('action') || '';
        if (action === 'start') { if (ln === 'delText') deleted++; continue; }
        if (action === 'end') { if (ln === 'delText') deleted = Math.max(0, deleted - 1); continue; }
        if (ln === 'insText') visit(c);
        continue;
      }
      if (ln === 'placeholder') continue;
      if (marksOf(c).some(m => m.type === 'delete' && m.year >= DRAFT_CYCLE_FROM)) continue;
      visit(c);
    }
  };
  visit(el);
  return collapse(out);
}

/* ===========================================================================
 * Element classification for the map walk.
 * ======================================================================== */

const ROOT_TAGS = new Set(['abcb-map']);          // FlattenedFile.xml, and the 3 nested glossary maps
const SECTION_TAGS = new Set([
  'topicset',      // 37 — the Section: @section-num, @navtitle and (17 of them) @summary
  'topichead',     // 11 — the untitled front-matter grouping (Preface, Introduction, Footnote)
]);
const CONTAINER_TAGS = new Set([
  'part',          // 339 — ncc-part and standard-part; num and title are CHILD ELEMENTS
  'specification', // 174 — a sibling of part, not a child of it
]);
const TRANSPARENT_TAGS = new Set([
  'subtopic',      // 904 — groups clauserefs inside a part, exactly as in 2025
]);
// 66 under specification. Neither transparent nor purely prose: it is the Specification's OWN
// overview text AND the home of 310 clauserefs, so it is rendered by the overview unit and walked
// for its clauserefs — and for nothing else, since everything else in it is that same prose.
const SECTION_TAG = 'section';
const UNIT_TAGS = new Set([
  'page',              //  78 — carried INLINE in the map, not conref'd
  'abcb-glossentry',   // 543 per package, inline in the three nested glossary maps
]);
const CLAUSE_POINTER_TAG = 'clauseref';   // 881 + 4514 + 310 — its <clause conref> names the file
const OWN_PROSE_TAGS = new Set([
  'intro-part',    // 353 under part
  'callout',       // 182 under part, 44 under subtopic — explanatory boxes attached to the Part
]);
const METADATA_TAGS = new Set([
  'title',         // read via childTitle()
  'num',           // a container's designation; read as a child element, never an attribute
]);
const POINTER_TAGS = new Set([
  'glossref',      // 2188 — a map-only pointer at a glossary entry that is ALSO inlined beside it
]);
const VARIATION_TAG = 'part-variation';   // 114 elements / 73 identities, handled by its container
// The two elements that hold a MathType equation. Their <image> child is a raster fallback with no
// href, never a figure.
const EQUATION_TAGS = new Set(['equation-inline', 'equation-block']);

/**
 * Children of a unit's `node` that its BODY does not render: the ones belonging to another unit,
 * plus this unit's own identity (which emit.mjs already puts in the frontmatter and the H1).
 *
 * normalize.mjs takes this off the unit rather than importing one edition's vocabulary, because
 * the two editions do not share it: 2022's `clauseref`, `subtopic` and `meta` mean nothing in
 * 2025, and 2025's `content` and `spec-topic` mean nothing here.
 */
export const BODY_TAGS_2022 = {
  skip: new Set([
    'clause', 'clause-variation', 'clauseref',   // other units, or pointers at them
    'part', 'part-variation', 'specification',   // containers
    'subtopic', 'topicset', 'topichead', 'abcb-map', 'abcb-glossentry', 'page', 'glossref',
    'num', 'archive-num', 'meta',                // this unit's identity and applicability metadata
  ]),
  // A container's own prose. `section` is NOT here: a specification's <section> holds clauserefs
  // as well as prose, so it is rendered as a block (which skips them) rather than flattened.
  ownProse: new Set(['intro-part', 'callout', 'section']),
  transparent: new Set(['subtopic']),
};

/** The eight jurisdictions the corpus uses. */
const STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

/**
 * State files that carry a jurisdiction suffix in their NAME and no root `@variation` (§5.1).
 *
 * Enumerated rather than inferred, and enumerated for ALL FOUR packages rather than for the one
 * that surfaced them: the list is not the same in every package (volume-one and Housing
 * Provisions have four, volume-two five, volume-three seven), so building it from volume-one
 * alone mis-files four clauses as national elsewhere. The walker derives the state from the
 * filename anyway and uses this list as the GUARD: a file that gains a state suffix without
 * appearing here is a new case to look at, not something to trust silently.
 */
const STATE_FILES_WITHOUT_VARIATION = new Set([
  'B1D4-determination-structural-resistance-materials-forms-construction-WA.xml',
  'B1P5-pressure-TAS.xml',
  'J8D4-spa-pool-heating-and-pumping-NSW.xml',
  'table-10-7-1-required-rw-and-sound-impact-levels-for-separating-walls-NT.xml',
  'H3D5-fire-separation-of-garage-top-dwellings-NSW.xml',
  'B2D6-temperature-control-devices-TAS.xml',
  'B2D9-general-requirements-SA.xml',
  'B2P9-pressure-TAS.xml',
]);

/** `document-type` on a nested glossary map -> the `category` weblinks.mjs routes web_url on. */
const GLOSSARY_CATEGORIES = new Map([
  ['Glossary', 'glossary'],
  ['Abbreviation', 'abbreviation'],
  ['Symbols', 'symbols'],
]);

/* ===========================================================================
 * Small helpers.
 * ======================================================================== */

const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const collapse = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const elementChildren = el => { const o = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) o.push(c); return o; };
const childEl = (el, tag) => { for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.nodeName === tag) return c; return null; };
const childText = (el, tag) => collapse(childEl(el, tag)?.textContent ?? '');
const attr = (el, name) => { const v = el.getAttribute?.(name); return v === null || v === undefined || v === '' ? null : v; };
/** `attr` on an element that may be absent. R51 reads `<title @id>`, and a clause without a
 *  `<title>` is a shape the source does not have — but "no title" and "a title with no @id" must
 *  answer the same null rather than one of them throwing from inside a join. */
const attrOf = (el, name) => (el ? attr(el, name) : null);

/** Recursive enumeration — `XMLs/` is NOT flat. Three glossary terms contain a literal `/` and
 *  ship as DIRECTORIES (`XMLs/glossary-CO2-e/m2.hr.xml`), so a flat readdir loses three entries
 *  per package and throws EISDIR if it does not filter. Sorted by codepoint, never localeCompare. */
function walkFiles(dir, rel = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(path.join(dir, e.name), child));
    else out.push(child);
  }
  return out.sort(byCodepoint);
}

/**
 * The parser policy, and it is FAIL LOUD like everything else here.
 *
 * `{ onError: () => {} }` — what this was — silences recoverable XML errors, which in a repository
 * whose stated rule is fail-loud means a malformed source file parses to a partial tree and the
 * corpus is built from whatever survived. Measured across all 11,331 files of the four packages
 * and the five 2025 documents: ZERO diagnostics at any level, so refusing them costs nothing today
 * and names the file the day it stops being true. (@xmldom/xmldom 0.9 rejects the old
 * `errorHandler` option object; the option is `onError`.)
 */
const XML_PARSER = {
  onError: (level, message) => {
    throw new Error(`read-2022: the XML parser reported ${level} — ${String(message).trim()}. `
      + 'A recoverable parse error yields a PARTIAL tree, and a partial tree here is a clause with '
      + 'content missing that nothing downstream can detect.');
  },
};

/**
 * R51 — the enumerated clauses NCC 2022 does not publish from this package.
 *
 * Two source conditions produce a clauseref this reader must NOT emit, and both were found at
 * bulk scale in Task 14 after the pilot passed clean. Neither is repairable from this dataset,
 * so the disposition is OMIT, never a stub: an absent clause makes an agent fall back to
 * `web_url` and the live Code, which is recoverable. A present clause carrying another volume's
 * provisions is not — and a corpus that sometimes puts our own notices where Code text belongs
 * teaches an agent to expect them.
 *
 *  * `map-identity-unresolved` — the map's clauseref states its target's identity twice, and
 *    BOTH statements disagree with the file the `conref` names. Measured: 9 such clauserefs, and
 *    every one of them was emitting another volume's law under this volume's citation and
 *    `web_url` (`volume-three/c1o1-objective.md` published Volume One's fire Objective on the
 *    Plumbing Code's Part C1 page). Verified against ncc.abcb.gov.au in both directions.
 *  * `clause-is-2025-only` — the clause file's `<sptc>` and `<title>` were authored WITHOUT
 *    tracked-change marks while every one of its body ranges is a 2024 `xt:insText` insertion.
 *    §1.3's membership rule (non-empty base `sptc`) therefore admits it and §4.1's map signal
 *    agrees, but the base view is empty or a husk. All three carry `<archive-num>[ARCHIVE]` (no
 *    2019 predecessor) and all three exist in full in the NCC 2025 corpus.
 *
 * Keyed on volume + the `conref` the map names, which is the string the map actually states and
 * which a reader can check in the source. An entry that matches nothing during a full read
 * THROWS: an omission that omits nothing is a ruling that has silently gone stale.
 *
 * A disagreement that is NOT on this list still fails the build, exactly as R50 works.
 */
export const OMITTED_2022_CLAUSES = [



  {
    volume: 'volume-three', conref: 'C1O1-objective.xml', clause: 'C1O1',
    reason: 'map-identity-unresolved',
    evidence:
      "volume-three's map wants @id _13c6eb96…, which is in NO package. The file of that name here "
      + 'publishes Volume One\'s Section C Objective ("safeguard people from illness or injury due to '
      + 'a fire in a building"). The published NCC 2022 Volume Three C1O1 reads "…due to the failure '
      + 'of a sanitary plumbing installation" (fetched from the file\'s own web_url, 2026-08-14).',
  },

  {
    volume: 'volume-three', conref: 'C3D1-deemed-to-satisfy-provisions.xml', clause: 'C3D1',
    reason: 'map-identity-unresolved',
    evidence:
      "volume-three's map wants @id _6928fe33…, which is in NO package. The file of that name here "
      + "publishes Volume One's fire-resistance DTS list (Jaccard 0.85 against "
      + 'corpus/2025/volume-one/c3d1, 0.48 against its own volume).',
  },
  {
    volume: 'volume-three', conref: 'D1O1-objective.xml', clause: 'D1O1',
    reason: 'map-identity-unresolved',
    evidence:
      "volume-three's map wants @id _45439b74…, which is in NO package. The file of that name here "
      + 'publishes Volume One\'s access-and-egress Objective ("safe, equitable and dignified access '
      + 'to a building"), identical to corpus/2025/volume-one/d1o1; Volume Three D1O1 is about '
      + 'excessive noise of a plumbing and drainage system.',
  },
  {
    volume: 'volume-three', conref: 'E1O1-objective.xml', clause: 'E1O1',
    reason: 'map-identity-unresolved',
    evidence:
      "volume-three's map wants @id _3e56fca3…, which is in NO package. The file of that name here "
      + "publishes Volume One's services-and-equipment Objective (fire brigade, fire-fighting "
      + 'operations), identical to corpus/2025/volume-one/e1o1.',
  },
  {
    volume: 'volume-three', conref: 'E1D1-deemed-to-satisfy-provisions.xml', clause: 'E1D1',
    reason: 'map-identity-unresolved',
    evidence:
      "volume-three's map wants @id _86d790ed…, which is in NO package. The file of that name here "
      + "publishes Volume One's E1D1 (\"E1D2 to E1D17; … atrium, Part G3; … alpine area, Part G4\"), "
      + 'Jaccard 0.86 against corpus/2025/volume-one/e1d1.',
  },
  {
    volume: 'volume-one', conref: 'D3D31-Wayfinding-signage.xml', clause: 'D3D31',
    reason: 'clause-is-2025-only',
    evidence:
      'Every <num> and every <p> in the file sits inside an xt:insText range authored 2024-03-14 — '
      + 'after NCC 2022 was published — so the base view is EMPTY; only <sptc>D3D31</sptc> and '
      + '<title>Wayfinding signage</title> are untracked. archive-num is <placeholder>[ARCHIVE]</placeholder> '
      + '(no 2019 predecessor), and the clause exists in full at corpus/2025/volume-one/d3d31-wayfinding-signage.md. '
      + 'NCC 2022 Volume One Part D3 has no D3D31, so the emitted file carried a #D3D31 anchor that does not resolve.',
  },
  {
    volume: 'volume-three', conref: 'B5D7 Cross-connection-hazards.xml', clause: 'B5D7',
    reason: 'clause-is-2025-only',
    evidence:
      'Same shape as D3D31: untracked <sptc>B5D7</sptc>/<title>, every body range an xt:insText '
      + 'insertion dated 2024-03/2024-04, archive-num [ARCHIVE], base view EMPTY, and the clause '
      + 'exists in full at corpus/2025/volume-three/b5d7-cross-connection-hazards.md.',
  },
  {
    volume: 'volume-three', conref: 'B1V1-Determination-of-velocity.xml', clause: 'B1V1',
    reason: 'clause-is-2025-only',
    evidence:
      'Same shape, and the reason an emptiness test is not the rule: one <equation-inline> sits '
      + 'BETWEEN two xt:insText milestone ranges rather than inside one, so mechanism 1 has nothing '
      + 'to drop and the base view rendered "**(1)** D_(min)" followed by six empty subclause '
      + 'numbers. archive-num [ARCHIVE]; every text range dated 2024-03-04 or later; the clause '
      + 'exists in full (eight subclauses) at corpus/2025/volume-three/b1v1-determination-of-velocity.md.',
  },
];

/** The reasons an R51/R56 omission may carry. Exported because build.mjs decides whether a
 *  permitted-null exception was SUPERSEDED by an omission, and a hand-copied pair would silently
 *  under-match the day a third reason is added. */
export const OMISSION_REASONS = new Set(['map-identity-unresolved', 'clause-is-2025-only']);

// Refused at import, not at the moment an entry would have omitted something: an omission whose
// evidence is a shrug is indistinguishable from a bug, and a build is the wrong place to find out.
for (const e of OMITTED_2022_CLAUSES) {
  for (const k of ['volume', 'conref', 'clause', 'evidence']) {
    if (typeof e[k] === 'string' && e[k].trim()) continue;
    throw new Error(`read-2022: OMITTED_2022_CLAUSES entry ${JSON.stringify(e)} has no ${k} — an omission `
      + 'must name the volume, the conref the map states and the clause it covers, and state its evidence');
  }
  if (!OMISSION_REASONS.has(e.reason)) {
    throw new Error(`read-2022: OMITTED_2022_CLAUSES entry for ${e.clause} has reason ${JSON.stringify(e.reason)} — `
      + `expected one of ${[...OMISSION_REASONS].join(', ')}`);
  }
  if (e.evidence.length < 80) {
    throw new Error(`read-2022: OMITTED_2022_CLAUSES entry for ${e.clause} states ${e.evidence.length} characters of `
      + 'evidence — an omission of published Code needs a measurement a reader can check, not a label');
  }
}

/** The R51 entry covering this clauseref, or null. */
export function omittedClause(volume, conref) {
  return OMITTED_2022_CLAUSES.find(e => e.volume === volume && e.conref === conref) ?? null;
}

/**
 * R60 — cross-package identity resolution, as an enumerated exception and never as a rule.
 *
 * R56 said: do not read across packages, because a shared UUID is an inference. That holds as the
 * default and still governs the five clauses in `OMITTED_2022_CLAUSES` whose identity resolves
 * nowhere. These four are different: the inference has been removed. For each, the direction was
 * proved from the CONTENT (both candidate files' base views are identical across every package
 * that holds them, and the two texts are plainly a structural clause and a plumbing clause) and
 * from the PUBLISHED CODE on both sides — every `published` string below was fetched from
 * ncc.abcb.gov.au on 2026-08-14 from the page the emitted file's own `web_url` names.
 *
 * The ABCB shipped these two files in each other's zips. The `@id` its own map states is the
 * truth, the published Code corroborates it, and the text is in this repository at exactly that
 * id. Leaving substantive Deemed-to-Satisfy provisions out when the correct text is on disk would
 * be a worse answer than reading one file from a sibling package under a ruling.
 *
 * `from` names the sibling to read. Where several packages hold the identity their base views are
 * byte-identical (measured), so the choice cannot change the output — but it is stated rather than
 * derived, so nobody has to re-derive it, and `siblingClause` re-checks the identity on load.
 */
export const RECOVERED_2022_CLAUSES = [
  {
    volume: 'volume-one', conref: 'B1D1-deemed-to-satisfy-provisions.xml', clause: 'B1D1',
    from: 'volume-three', wantedId: '_00602d3a-be90-4fa0-9215-2a79f954937c',
    published:
      'Where a Deemed-to-Satisfy Solution is proposed, Performance Requirements B1P1 to B1P4 are '
      + 'satisfied by complying with B1D2 to B1D6.',
    evidence:
      'ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/b-structure/part-b1-structural-provisions '
      + 'publishes the sentence above as V1 B1D1(1). The volume-one package does not contain it — its '
      + 'file of that name is the cold-water clause (archive-num 2019: B1.1). The wanted @id is held by '
      + 'volume-two and volume-three, whose base views are identical, and carries archive-num 2019: B1.0.',
  },
  {
    volume: 'volume-one', conref: 'C2D1-deemed-to-satisfy-provisions.xml', clause: 'C2D1',
    from: 'volume-three', wantedId: '_7a8c0fbb-653f-4b21-8668-b085635216de',
    published:
      'Where a Deemed-to-Satisfy Solution is proposed, Performance Requirements C1P1 to C1P9 are '
      + 'satisfied by complying with— C2D2 to C2D15, C3D2 to C3D15 and C4D2 to C4D17; and in a building '
      + 'containing an atrium, Part G3; and for a building containing an occupiable outdoor area, Part '
      + 'G6; and for additional requirements for Class 9b buildings, Part I1; and for farm sheds, Part I3.',
    evidence:
      'ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/c-fire-resistance/part-c2-fire-resistance-and-stability '
      + 'publishes the sentence above as V1 C2D1(1). The volume-one package holds the sanitary-drainage '
      + 'clause under that filename instead (2019: C2.1). The wanted @id is in volume-three only, with '
      + 'archive-num 2019: C1.0, and no clause-variation to resolve.',
  },
  {
    volume: 'volume-three', conref: 'B1D1-deemed-to-satisfy-provisions.xml', clause: 'B1D1',
    from: 'volume-one', wantedId: '_36029f3d-0e57-48dc-9219-b416cd90fb52',
    published:
      'Performance Requirement B1P1 is satisfied if the cold water service is connected to— the '
      + 'Network Utility Operator’s drinking water supply; or an alternative drinking water supply.',
    evidence:
      'ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-three/b-water-services/part-b1-cold-water-services '
      + 'publishes the sentence above as V3 B1D1(1). The volume-three package holds the structural clause '
      + 'under that filename (2019: B1.0). The wanted @id is held by volume-one and housing-provisions, '
      + 'base views identical, archive-num 2019: B1.1. NOTE: the recovered text reads "B1P2 to B1P7" '
      + 'where the published page reads "B1P2 to B1P6" — the untracked forward-reference class, recorded '
      + 'in SOURCE_FORWARD_REFS rather than rewritten.',
  },
  {
    volume: 'volume-three', conref: 'C2D1-deemed-to-satisfy-provisions.xml', clause: 'C2D1',
    from: 'volume-one', wantedId: '_e75ed91c-c566-49bb-ab5d-dc0aebf0819b',
    published:
      'Where a Deemed-to-Satisfy Solution is proposed, Performance Requirements C2P1 to C2P7 are '
      + 'satisfied by complying with C2D2 to C2D5.',
    evidence:
      'ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-three/c-sanitary-plumbing-and-drainage-systems/'
      + 'part-c2-sanitary-drainage-systems publishes the sentence above as V3 C2D1(1). The volume-three '
      + 'package holds Volume One’s fire-resistance C2D1 under that filename. The wanted @id is held '
      + 'by volume-one, volume-two and housing-provisions, base views identical, archive-num 2019: C2.1.',
  },
];

/**
 * R52 — a clauseref whose `<clause @id>` is stale while its conref and `<title @id>` agree.
 *
 * Enumerated rather than tolerated as a class, because `<title @id>` is not an identity: 33 title
 * ids are shared across different filenames in these packages, including same-package pairs whose
 * designations differ. A wrong file that happened to share the wanted title id would present in
 * exactly this shape and publish without a word.
 */
export const STALE_ROOT_ID_CLAUSEREFS = [
  {
    volume: 'volume-three', conref: 'B3F1-non-drinking-water-supply.xml', clause: 'B3F1',
    evidence:
      'The B3F1 clauseref carries clause @id _023df21f…, which is the SAME id the B2F1 clauseref two '
      + 'subtopics earlier carries — an authoring copy-paste, not a different target. Its <title @id> '
      + '_db29932b… and its conref both name B3F1, and the emitted body ("Sanitary fixtures, sanitary '
      + 'appliances and supply outlets provided with non-drinking water must be adequate") matches '
      + 'corpus/2025/volume-three/b3f1 exactly. Following the @id would publish B2F1’s heated-water '
      + 'text as B3F1, or — B2F1 being emitted first — drop B3F1 as a duplicate.',
  },
];

const validateRulings = (list, name, extra = []) => {
  for (const e of list) {
    for (const k of ['volume', 'conref', 'clause', 'evidence', ...extra]) {
      if (typeof e[k] === 'string' && e[k].trim()) continue;
      throw new Error(`read-2022: ${name} entry ${JSON.stringify(e)} has no ${k}`);
    }
    if (e.evidence.length < 80) {
      throw new Error(`read-2022: ${name} entry for ${e.clause} states ${e.evidence.length} characters of `
        + 'evidence — a ruling about published Code needs a measurement a reader can check, not a label');
    }
  }
};
validateRulings(RECOVERED_2022_CLAUSES, 'RECOVERED_2022_CLAUSES', ['from', 'wantedId', 'published']);
validateRulings(STALE_ROOT_ID_CLAUSEREFS, 'STALE_ROOT_ID_CLAUSEREFS');
for (const e of RECOVERED_2022_CLAUSES) {
  if (e.from === e.volume) {
    throw new Error(`read-2022: RECOVERED_2022_CLAUSES entry for ${e.clause} names its own volume as the `
      + 'source — a recovery reads a SIBLING package, and reading itself is what the join already does');
  }
  if (omittedClause(e.volume, e.conref)) {
    throw new Error(`read-2022: ${e.volume}/${e.conref} is both recovered and omitted — one clauseref, `
      + 'one disposition');
  }
}

/** The R60 entry covering this clauseref, or null. */
export function recoveredClause(volume, conref) {
  return RECOVERED_2022_CLAUSES.find(e => e.volume === volume && e.conref === conref) ?? null;
}

/** The R52 entry covering this clauseref, or null. */
export function staleRootId(volume, conref) {
  return STALE_ROOT_ID_CLAUSEREFS.find(e => e.volume === volume && e.conref === conref) ?? null;
}

/** Filenames carry spaces, dots, commas, en-dashes and parentheses. Fold them all, and case, so
 *  the state-variation and figure joins compare designations rather than typography (§5.3.1, §6).
 *
 *  Exported because sync-figures.mjs re-resolves a published CDN filename back to its file in
 *  `Images/`, and that is the SAME fold as §6 rule 1 + rule 4. A second, hand-rolled copy of it
 *  there could drift from this one and pick a different disk file — under a key that still looks
 *  correct. One fold, one place. */
export const normStem = s => String(s).replace(/\.[^.]*$/, '').toLowerCase().replace(/[.\-_ ]+/g, '-').replace(/^-+|-+$/g, '');
const normId = s => String(s).trim().toLowerCase().replace(/[.\-_ ]+/g, '-').replace(/^-+|-+$/g, '');

/** `Section A` -> A (section) · `Schedule 1` -> 1 (schedule) · `2` -> 2 (other), matching the
 *  site's own path tokens (`/a-governing-requirements`, `/1-definitions`, `/2-structure`). */
function sectionOf(sectionNum) {
  const raw = collapse(sectionNum ?? '');
  if (!raw) return { num: '', type: 'other' };
  const m = /^(Section|Schedule)\s+(.+)$/i.exec(raw);
  if (!m) return { num: raw, type: 'other' };
  return { num: m[2], type: m[1].toLowerCase() === 'schedule' ? 'schedule' : 'section' };
}

/** The jurisdiction a filename declares, or null. Deliberately strict: a separator is required,
 *  because a rule loose enough to catch `…premisesTAS.xml` also catches
 *  `table-SA-1-farm-building-categories….xml`, whose "SA" is part of the table number. */
function stateFromFilename(file) {
  const m = /[-_ ]([A-Za-z]{2,3})$/.exec(file.replace(/\.[^.]*$/, ''));
  const tok = m ? m[1].toUpperCase() : null;
  return tok && STATES.has(tok) ? tok : null;
}

/* ===========================================================================
 * The reader.
 * ======================================================================== */

/**
 * @param {string} pkgDir  an extracted package root, holding `XMLs/` and `Images/` (both
 *   capitalised — 2025 uses lowercase, and a Linux CI runner does not forgive the difference)
 * @param {object} doc     one entry of DOCUMENTS_2022
 * @param {{sections?: string[]|null, diagnostics?: object|null}} [opts]
 *   `sections` slices on the derived section num, exactly as read-2025.mjs does.
 *   `diagnostics`, when an object is passed, is FILLED IN with the censuses this reader's parity
 *   tests check against docs/content-model-2022.md, plus the source's own broken references. It
 *   is an out-parameter rather than part of the return value so the RawUnit[] contract stays
 *   identical to read-2025.mjs's.
 * @returns {Array<object>} RawUnits in document order
 */
export function readPackage2022(pkgDir, doc, { sections = null, diagnostics = null } = {}) {
  const xmlDir = path.join(pkgDir, 'XMLs');
  const imgDir = path.join(pkgDir, 'Images');
  const files = walkFiles(xmlDir).filter(f => f.toLowerCase().endsWith('.xml'));
  const images = walkFiles(imgDir);
  if (!files.includes('FlattenedFile.xml')) {
    throw new Error(`read-2022 [${doc.key}]: ${xmlDir}/FlattenedFile.xml is missing — it is the publication's spine`);
  }

  const dg = {
    roots: {}, membership: { clauses: 0, unchanged: 0, renumbered: 0, only2022: 0, only2025: 0 },
    map: {
      mapped: 0, insertOnly: 0, insertOnlyDuplicates: 0, mappedNo2022: 0, duplicateConrefs: 0,
      // R55's precondition. A clauseref that states neither identity cannot be judged, and none
      // does — but nothing enforced that until this counter, so a release that stopped emitting an
      // attribute would turn every disagreement into a silent pass. build.mjs asserts it is 0.
      identityUnstated: 0,
    },
    clauseVariations: { del: 0, delText: 0, repl: 0, target2025: 0 },
    partVariations: { elements: 0, identities: 0 },
    figures: { distinct: 0, baseEmptyWrappers: 0 },
    glossary: { entries: 0, only2025: 0, national: 0 },
    // Emission, as opposed to the censuses above: what this reader actually produced. The two
    // populations differ on purpose — the censuses cover the whole package, which is what
    // docs/content-model-2022.md measured, while emission covers only what the map reaches.
    stateClauseUnits: { del: 0, repl: 0 },
    brokenConrefs: [], unjoinedPointers: [], uncategorisedGlossary: [], droppedCitations: [],
    unreferencedImages: 0,
    pages: 0, overviews: 0, glossrefs: 0,
    // R51. `omittedClauses` is what this run actually left out, one record per clauseref, each
    // carrying the ruling's evidence; `identityRedirects` counts the clauserefs whose stated
    // identity resolved to a DIFFERENT file in this package and was followed there.
    omittedClauses: [], identityRedirects: 0, renumbered: [],
    // R73. One record per element the base view retained because its subtree carried NCC 2022
    // text under a mark that would otherwise have deleted the lot; plus the pointer arm, where the
    // decision is made against the TARGET rather than the pointer's own (always empty) subtree.
    baseViewRetentions: [], draftPointersRestored: [], draftPointersDropped: 0,
    // R75. One record per transcription correction this read actually applied, so the edition
    // index can state what was rewritten and against which published page, without either the
    // index or the report re-deriving it from the table and drifting from what fired.
    retainedTextCorrections: [],
    // R60. One record per clause read from a sibling package, so the report and the edition index
    // can name a provision whose text did not come out of this publication's own zip.
    recoveredClauses: [],
  };

  // R73. Declared here rather than beside the other fired-sets because pass 1 fires it, and a
  // ruling nobody can see stop firing is how 2025-draft text would creep back in unnoticed.
  const ruledFired = new Set();
  // R75, on the same terms.
  const correctionsFired = new Set();
  const xmlBasenames = new Set(files.map(f => f.slice(f.lastIndexOf('/') + 1)));

  /* -- pass 1: one parse per file, facts kept, DOM discarded ---------------- */

  const facts = new Map();
  const wrapperById = new Map();
  const clauseFileById = new Map();     // R51: root @id -> clause file, for the map's identity join
  const byStem = new Map();
  const partsByNum = new Map();
  const clauseVariationSites = [];
  const partVariationSites = [];
  for (const file of files) {
    const dom = new DOMParser(XML_PARSER).parseFromString(fs.readFileSync(path.join(xmlDir, file), 'utf8'), 'text/xml');
    const root = dom?.documentElement;
    if (!root) throw new Error(`read-2022 [${doc.key}]: ${file} did not parse to a document element`);
    const kind = root.nodeName === 'part' ? `part/${root.getAttribute('outputclass') ?? ''}` : root.nodeName;
    dg.roots[kind] = (dg.roots[kind] ?? 0) + 1;

    const idEl = childEl(root, 'sptc') ?? childEl(root, 'num');
    const accepted = idEl ? acceptedText(idEl) : '';
    // R73. Recorded in pass 1 because pass 1 is the only pass that visits EVERY file, which makes
    // this a census of the package rather than of what the map happened to reach — the same
    // distinction the variation census draws, and for the same reason: the number is evidence
    // about the source, and the build prints it.
    applyBaseView(dom, { sourceFile: file, retained: dg.baseViewRetentions, ruledFired, correctionsFired });
    const baseIdEl = childEl(root, 'sptc') ?? childEl(root, 'num');
    const f = {
      file,
      root: root.nodeName,
      id: attr(root, 'id'),
      // The SECOND identity the map states for a clause (R51). Read before the base view is
      // applied would make no difference — an element's @id carries no tracked change — but it is
      // read here so `facts` holds both halves of the join in one place.
      titleId: attrOf(childEl(root, 'title'), 'id'),
      variation: attr(root, 'variation'),
      baseId: baseIdEl ? collapse(baseIdEl.textContent) : '',
      acceptedId: accepted,
      baseTerm: collapse(childEl(root, 'glossterm')?.textContent ?? ''),
    };
    facts.set(file, f);
    // R62 — every designation the 2025 draft renumbers. A cross-reference in the base text that
    // names one of these is the ABCB's own forward reference: it is untracked in the source, so no
    // base-view transform can recover the 2022 string. build.mjs reconciles what actually SURVIVES
    // into the corpus against index.mjs's SOURCE_FORWARD_REFS, so a sixth cannot appear unnoticed
    // and a listed one that stops appearing cannot rot.
    if (f.baseId && f.acceptedId && f.baseId !== f.acceptedId && /^[A-Za-z0-9.]+$/.test(f.acceptedId)) {
      dg.renumbered.push({ base: f.baseId, accepted: f.acceptedId, file });
    }

    if (root.nodeName === 'clause') {
      const m = dg.membership;
      m.clauses++;
      if (f.id) {
        // A package that reused a root @id across two clause files would make the R51 join
        // ambiguous, and picking either would be a guess. Measured: 0 collisions in all four.
        if (clauseFileById.has(f.id)) {
          throw new Error(`read-2022 [${doc.key}]: clause @id ${f.id} is on two files — `
            + `${clauseFileById.get(f.id)} and ${file}. The map's clauseref identity join (R51) `
            + 'cannot choose between them; establish which file the publication means before proceeding.');
        }
        clauseFileById.set(f.id, file);
      }
      if (!f.baseId) m.only2025++;
      else if (!f.acceptedId) m.only2022++;
      else if (f.baseId === f.acceptedId) m.unchanged++;
      else m.renumbered++;
    }
    if (root.nodeName === 'image-reference' || root.nodeName === 'table-reference') {
      if (f.id) wrapperById.set(f.id, file);
    }
    if (root.nodeName === 'part' || root.nodeName === 'specification') {
      if (f.baseId) { if (!partsByNum.has(f.baseId)) partsByNum.set(f.baseId, []); partsByNum.get(f.baseId).push(file); }
    }
    const stem = normStem(file);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(file);

    // The variation CENSUS is taken over the whole package, which is what
    // docs/content-model-2022.md §5.3/§5.4 measured; EMISSION visits only the clauses and Parts
    // the publication map reaches. The two populations are deliberately different numbers, and
    // keeping both is what lets the parity tests check this reader against that document rather
    // than against itself.
    (function census(el, partNum) {
      const num = (el.nodeName === 'part' || el.nodeName === 'specification')
        ? collapse(childEl(el, 'num')?.textContent ?? '') : partNum;
      for (const c of elementChildren(el)) {
        if (c.nodeName === 'clause-variation') { clauseVariationSites.push({ file, el: c }); continue; }
        if (c.nodeName === VARIATION_TAG) { partVariationSites.push({ num, el: c }); continue; }
        census(c, num);
      }
    })(root, null);

    // §5.1: `@variation` is authoritative where present and never disagrees with the filename
    // (584/584 in volume-one). Where it is absent the filename is trusted only for the enumerated
    // exceptions; anything else is a new shape and must be looked at rather than guessed.
    const named = stateFromFilename(file);
    if (named && f.variation && named !== f.variation.toUpperCase()) {
      throw new Error(`read-2022 [${doc.key}]: ${file} declares variation="${f.variation}" but its name says ${named}`);
    }
    if (named && !f.variation && !STATE_FILES_WITHOUT_VARIATION.has(path.posix.basename(file))) {
      throw new Error(`read-2022 [${doc.key}]: ${file} has a ${named} filename suffix and no root @variation. `
        + 'Add it to STATE_FILES_WITHOUT_VARIATION only after establishing that it really is state text.');
    }
  }
  const stemKeys = [...byStem.keys()].sort(byCodepoint);

  /* -- pass 2: parse on demand, base-viewed, and keep what a unit points at -- */

  const loaded = new Map();
  const load = file => {
    if (!loaded.has(file)) {
      const dom = new DOMParser(XML_PARSER).parseFromString(fs.readFileSync(path.join(xmlDir, file), 'utf8'), 'text/xml');
      applyBaseView(dom, { sourceFile: file, ruledFired, correctionsFired });
      loaded.set(file, dom);
    }
    return loaded.get(file);
  };

  /* -- the figure join (§6) ------------------------------------------------- */

  const imageByLowerName = new Map();
  const imageByLowerStem = new Map();
  const imageByNormStem = new Map();
  for (const im of images) {
    imageByLowerName.set(im.toLowerCase(), im);
    const stem = im.replace(/\.[^.]*$/, '').toLowerCase();
    if (!imageByLowerStem.has(stem)) imageByLowerStem.set(stem, im);
    const n = normStem(im);
    if (!imageByNormStem.has(n)) imageByNormStem.set(n, im);
  }
  const usedImages = new Set();

  /**
   * `Images/` filename for one wrapper. The `<image href>` is a publishing-session path, an
   * `ERROR_IN_RESOLVING_URI:` string, or an absolute `C:\Users\…\Quark\…` authoring path leaked
   * into the published XML — so the join is on NAMES, in five rules applied in order (§6, §6.1).
   * All five are needed: without rule 1 folding the case of the WHOLE stem the counts come out
   * one short in every package, rule 4 exists for exactly one file, and rule 5 for exactly one.
   */
  function resolveImageFile(wrapperFile, href) {
    const basename = String(href).split(/[\\/]/).pop();
    // An image-reference carried INLINE in the map (the four cover pages) has no wrapper file to
    // take a stem from, and its href really is a relative path — `../Images/cover-front-vol1.pdf`.
    if (!wrapperFile) {
      return imageByLowerName.get(basename.toLowerCase())
        ?? imageByLowerName.get(`image-${basename}`.toLowerCase())
        ?? null;
    }
    const stem = path.posix.basename(wrapperFile).replace(/\.[^.]*$/, '');
    const hit = imageByLowerStem.get(stem.toLowerCase())                                     // 1
      ?? imageByLowerName.get(`image-${basename}`.toLowerCase())                              // 2
      ?? imageByLowerStem.get(stem.replace(/^image-/, '').toLowerCase())                      // 3
      ?? imageByNormStem.get(normStem(stem));                                                 // 4
    if (hit) return hit;
    // 5. The leading spec-clause token. One wrapper per package needs it
    // (`image-S46C2-explanatory-calculation-of-fan-performance-ratio.xml`, whose href is
    // `10145_0.2.0.png`), and it is the only rule here that could match on something as short as
    // `10`. Taking the codepoint-first of several candidates would attach a WRONG figure silently,
    // which is fail-open in a fail-loud module — so an ambiguous token is an error, not a guess.
    const token = stem.replace(/^image-/, '').split('-')[0];
    const prefix = `${normId(`image-${token}`)}-`;
    const byToken = images.filter(im => normStem(im).startsWith(prefix)).sort(byCodepoint);
    if (byToken.length > 1) {
      throw new Error(`read-2022 [${doc.key}]: ${wrapperFile} falls through to the leading-token rule `
        + `and token ${JSON.stringify(token)} matches ${byToken.length} files in Images/ `
        + `(${byToken.slice(0, 4).join(', ')}) — one of them would be attached as this figure by `
        + 'codepoint order alone');
    }
    return byToken[0] ?? null;
  }

  /**
   * normalize.mjs reads `src`, which 2022 does not use: `href` is a publishing-session path, an
   * `ERROR_IN_RESOLVING_URI:` string or a leaked absolute `C:\Users\…\Quark\…` authoring path.
   * The CDN key is the DISK name the rules above resolve, so it is written here.
   */
  function setImageSrc(img, wrapperFile) {
    if (img.getAttribute('src')) return;
    const disk = resolveImageFile(wrapperFile, img.getAttribute('href') ?? '');
    if (!disk) {
      throw new Error(`read-2022 [${doc.key}]: <image href=${JSON.stringify(img.getAttribute('href'))}>`
        + `${wrapperFile ? ` in ${wrapperFile}` : ' carried inline in the map'} names no file in Images/ — `
        + 'the name rules in resolveImageFile did not reach it');
    }
    usedImages.add(disk);
    img.setAttribute('src', path.posix.basename(disk));
  }

  /**
   * Replace every `<image-reference conref>` / `<table-reference conref>` pointer inside a unit's
   * subtree with the wrapper it names, so the renderer sees one tree.
   *
   * The `conref` is NOT the join key — it is a publishing-session document path that matches
   * nothing on disk, and resolving on it yields 0 of 231. THE JOIN KEY IS `@id`: the inline
   * pointer's id equals the wrapper file's ROOT id (§6).
   *
   * A wrapper with no base-view `<image>`/`<table>` is not an error: 11 figure wrappers and 32-34
   * table wrappers per package are 2025 additions whose only child is an insert, and 10 of the
   * table ones are cited by live 2022 clauses (§6.2). The citation is dropped and recorded — the
   * alternative is publishing a 2025 draft table as NCC 2022 law.
   */
  function splice(node, homeFile = null, host = null) {
    for (const el of elementChildren(node)) {
      // Take the OUTER of a nested `image > image` pair (260 of them): an outer vector reference
      // with a raster fallback inside it. Descending would resolve — and count — the fallback too.
      if (el.nodeName === 'image') {
        // An <image> with NO href is not a figure at all: it is MathType's raster fallback,
        // carried as base64 in the element's own text, and it sits only inside an equation (230 in
        // volume-one, every one under equation-inline or equation-block). normalize.mjs drops it,
        // exactly as it drops 2025's <img src="">. Anywhere else, a figure with no href is a real
        // unresolved reference and setImageSrc throws.
        if (!attr(el, 'href') && EQUATION_TAGS.has(node.nodeName)) continue;
        setImageSrc(el, homeFile);
        continue;
      }
      const isPointer = (el.nodeName === 'image-reference' || el.nodeName === 'table-reference') && attr(el, 'conref');
      if (!isPointer) { splice(el, homeFile, host); continue; }
      const conref = el.getAttribute('conref');
      const target = wrapperById.get(attr(el, 'id') ?? '') ?? (facts.has(conref) ? conref : null);
      if (!target) {
        // Shipped broken: one Housing Provisions figure pointer carries an
        // `ERROR_IN_RESOLVING_URI:` conref whose @id matches no wrapper (§6).
        dg.unjoinedPointers.push(`${el.nodeName} conref=${conref}`);
        node.removeChild(el);
        continue;
      }
      const wrapper = load(target).documentElement;
      const payload = el.nodeName === 'image-reference' ? 'image' : 'table';
      // The pointer the 2025 draft inserted, kept by `applyBaseView` so that the decision could be
      // made HERE, against the target. No 2022 content in the wrapper means the draft added both
      // the pointer and the thing it points at: that is a 2025 citation of a 2025 table, not a
      // citation this edition loses, so it is removed WITHOUT a droppedCitations record — which
      // exists to name what the published 2022 clause has and the corpus file does not.
      if (!childEl(wrapper, payload) && el.getAttribute(DRAFT_POINTER_ATTR)) {
        dg.draftPointersDropped++;
        node.removeChild(el);
        continue;
      }
      if (el.getAttribute(DRAFT_POINTER_ATTR)) dg.draftPointersRestored.push({ host: host ?? homeFile ?? '', wrapper: target, kind: payload });
      if (!childEl(wrapper, payload)) {
        // §6.2: the wrapper has no NCC 2022 content, so the citation is dropped — AND the citing
        // clause is reported. 14 live citations per package land here (10 tables, 4 figures):
        // B1P1 loses all three minimum-annual-reliability-index tables, J3D14 its heated-water
        // load-factor tables. The markdown gives a reader no signal that a cited table had no 2022
        // content, which is exactly the "the reader cannot tell anything is missing" failure §5.3
        // calls the worst class there is — so the record is the only place it can be seen.
        dg.droppedCitations.push({ host: host ?? homeFile ?? 'FlattenedFile.xml', wrapper: target, kind: payload });
        node.removeChild(el);
        continue;
      }
      const clone = wrapper.cloneNode(true);
      splice(clone, target, host);
      node.replaceChild(clone, el);
    }
  }

  /* -- the state-variation join (§5.3.1) ------------------------------------ */

  /**
   * The file holding a REPLACE variation's text, or null.
   *
   * Two stages, and both are needed to reach 432/432 and 47/47:
   *  (a) the case-folded sibling stem, with `.`/`-`/`_`/SPACE all normalised — `13-2-3-roofs and
   *      ceilings.xml` -> `13-2-3-Roofs-and-ceilings-NSW.xml`;
   *  (b) an identity join on the host's BASE-or-accepted designation, because a renumbered
   *      clause's state file is named with the BASE (2022) number even when the national file's
   *      name carries the 2025 one — `B1P6-pressure.xml` (base sptc B1P5) -> `B1P5-pressure-TAS.xml`.
   * `@variation` is deliberately NOT part of the join: it is absent on 4-7 state files per package.
   */
  function resolveStateFile(hostFile, identities, state) {
    const suffix = `-${state.toLowerCase()}`;
    if (hostFile) {
      const direct = byStem.get(normStem(path.posix.basename(hostFile)) + suffix);
      if (direct) return direct[0];
    }
    for (const identity of identities) {
      if (!identity) continue;
      const prefix = `${normId(identity)}-`;
      const hits = stemKeys.filter(k => k.startsWith(prefix) && k.endsWith(suffix));
      if (hits.length) return byStem.get(hits[0])[0];
    }
    return null;
  }

  /** A state file whose own base designation is empty is a 2025-only file: the provision is not in
   *  NCC 2022 even though the file exists. 11 pointers corpus-wide land here (§5.3.2). */
  const targetIsNcc2022 = file => Boolean(facts.get(file)?.baseId);

  /* -- the whole-package variation census (§5.3, §5.3.2, §5.4) --------------- */

  for (const { file, el } of clauseVariationSites) {
    const state = (attr(el, 'variation') ?? '').toUpperCase();
    if (attr(el, 'variation-type') === 'DELETE') {
      dg.clauseVariations.del++;
      if (attr(el, 'deleted-text')) dg.clauseVariations.delText++;
      continue;
    }
    dg.clauseVariations.repl++;
    const host = facts.get(file);
    const target = resolveStateFile(file, [host?.baseId, host?.acceptedId], state);
    if (!target) {
      throw new Error(`read-2022 [${doc.key}]: ${file} declares a ${state} REPLACE whose file cannot be found. `
        + 'Measured: 432/432 clause-variation pointers resolve, so this is a join that no longer fits the data.');
    }
    if (!targetIsNcc2022(target)) dg.clauseVariations.target2025++;
  }
  {
    const identities = new Set();
    for (const { num, el } of partVariationSites) {
      dg.partVariations.elements++;
      identities.add(`${num}|${attr(el, 'variation')}|${attr(el, 'variation-type')}`);
    }
    dg.partVariations.identities = identities.size;
  }

  /* -- units ---------------------------------------------------------------- */

  const units = [];
  const emit = u => { units.push({ edition: '2022', volume: doc.key, bodyTags: BODY_TAGS_2022, ...u }); };
  const inScope = ctx => !sections || ctx.sectionNum === '' || sections.includes(ctx.sectionNum);

  const pickCtx = c => ({
    sectionNum: c.sectionNum, sectionType: c.sectionType,
    containerKind: c.containerKind, containerNum: c.containerNum, containerTitle: c.containerTitle,
  });

  function stateOf(file) {
    const f = facts.get(file);
    return f?.variation ? f.variation.toUpperCase() : stateFromFilename(file);
  }

  /** Building classes and climate zones live in `<meta><facet …/></meta>`, one facet per value.
   *  `clause/@building` — the 2025 spelling — is absent from every 2022 clause (0 occurrences),
   *  so a 2025-shaped read returns null on all of them (§10). */
  function facetsOf(root) {
    const meta = childEl(root, 'meta');
    const building = [];
    const climate = [];
    if (meta) {
      for (const f of elementChildren(meta)) {
        if (f.nodeName !== 'facet') continue;
        const b = attr(f, 'building'); if (b && !building.includes(b)) building.push(b);
        const c = attr(f, 'climate'); if (c && !climate.includes(c)) climate.push(c);
      }
    }
    return { building: building.join(', ') || null, climate: climate.join(', ') || null };
  }

  /** `<archive-num><placeholder outputclass="placeholder">[ARCHIVE]</placeholder></archive-num>`
   *  is an authoring stub, not a superseded reference — and `applyBaseView` leaves it in place, so
   *  it is dropped here rather than shipped as `supersedes: "[ARCHIVE]"` on 16 clauses (§10). */
  function supersedesOf(root) {
    const el = childEl(root, 'archive-num');
    if (!el || childEl(el, 'placeholder')) return null;
    return collapse(el.textContent) || null;
  }

  const emittedClauseFiles = new Set();
  // R51: which enumerated omissions this read actually used. An entry that fires nothing is a
  // ruling that has gone stale against the source, and is a build failure — see the check below.
  const omissionsFired = new Set();
  const recoveriesFired = new Set();
  const staleFired = new Set();
  const seenGlossaryIds = new Set();
  const categoryByTerm = new Map();
  let glossaryCtx = null;

  function emitGlossentry(el, ctx, category) {
    dg.glossary.entries++;
    const term = childText(el, 'glossterm');
    const state = (attr(el, 'variation') ?? '').toUpperCase() || ctx.state || null;
    if (!state) dg.glossary.national++;
    else dg.glossary[state] = (dg.glossary[state] ?? 0) + 1;
    if (!term) { dg.glossary.only2025++; return; }
    if (!state) categoryByTerm.set(term, category);
    if (!inScope(ctx)) return;
    splice(el, null, `glossary: ${term}`);
    emit({
      kind: 'glossary',
      id: null, term, title: term,
      // Which Schedule 1 sub-page defines the term. weblinks.mjs routes every glossary web_url on
      // it, because Schedule 1's own page is a three-link index holding no terms at all — a reader
      // sent there would not find the term it cites. In 2022 it is the `document-type` of the
      // nested map the entry is inlined into, not an attribute on the entry.
      category,
      state,
      supersedes: null, buildingClasses: null, climateZones: null,
      ...pickCtx(ctx), node: el,
    });
  }

  function emitClauseFile(file, ctx, { state = null, node = null } = {}) {
    const root = node ?? load(file).documentElement;
    if (root.nodeName !== 'clause') {
      throw new Error(`read-2022 [${doc.key}]: ${file} is a <${root.nodeName}>, not a clause — a clauseref points at it`);
    }
    splice(root, null, file);
    const { building, climate } = facetsOf(root);
    emit({
      kind: 'clause',
      id: childText(root, 'sptc') || null,
      term: null,
      title: childText(root, 'title'),
      state: state ?? stateOf(file) ?? ctx.state ?? null,
      supersedes: supersedesOf(root),
      buildingClasses: building,
      climateZones: climate,
      ...pickCtx(ctx),
      node: root,
    });
  }

  /**
   * The jurisdictions whose variations are declared ON this clause file. A state variation is
   * emitted from the national clause, so omitting that clause removes the variations with it —
   * and a reader looking for "E1D1 [TAS]" would otherwise find no trace of why it is gone.
   */
  function variationStatesOf(file) {
    const root = load(file).documentElement;
    const states = new Set();
    for (let c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.nodeName === 'clause-variation') {
        const v = (attr(c, 'variation') ?? '').toUpperCase();
        if (v) states.add(v);
      }
    }
    return [...states].sort(byCodepoint);
  }

  /**
   * R60 — load a recovered clause from the sibling package the ruling names.
   *
   * Deliberately narrow. It parses ONE file, base-views it, and re-checks BOTH identities the map
   * stated before handing the node back: the ruling says which package, and this says whether that
   * package still agrees. It refuses a clause carrying a `<clause-variation>`, because resolving a
   * state variation means resolving a sibling FILE, and doing that across packages would be the
   * general cross-package read the ruling declined. Measured: all four recoveries carry none.
   */
  function siblingClause(recovery, wantId, wantTitleId, at) {
    const sibling = DOCUMENTS_2022.find(d => d.key === recovery.from);
    if (!sibling) failLoud(`R60 recovery for ${recovery.clause} names ${recovery.from}, not a document of this edition`, at);
    const abs = path.join(path.dirname(pkgDir), sibling.pkg, 'XMLs', recovery.conref);
    if (!fs.existsSync(abs)) {
      failLoud(`R60 recovery for ${recovery.clause} expects ${recovery.from}/${recovery.conref}, which does not exist`, at);
    }
    const dom = new DOMParser(XML_PARSER).parseFromString(fs.readFileSync(abs, 'utf8'), 'text/xml');
    const root = dom?.documentElement;
    if (!root || root.nodeName !== 'clause') failLoud(`R60 recovery for ${recovery.clause}: ${abs} is not a clause`, at);
    const gotId = attr(root, 'id');
    const gotTitleId = attrOf(childEl(root, 'title'), 'id');
    if (gotId !== wantId || (wantTitleId && gotTitleId !== wantTitleId)) {
      failLoud(`R60 recovery for ${recovery.clause}: ${recovery.from}/${recovery.conref} is @id ${gotId} / `
        + `title ${gotTitleId}, but the map wants ${wantId} / ${wantTitleId}. The sibling no longer holds the `
        + 'clause the ruling was written against — re-establish it before trusting this build.', at);
    }
    if (gotId !== recovery.wantedId) {
      failLoud(`R60 recovery for ${recovery.clause}: the ruling records wantedId ${recovery.wantedId} but the `
        + `map asks for ${wantId} — the ruling and the source have diverged`, at);
    }
    if (childEl(root, 'clause-variation')) {
      failLoud(`R60 recovery for ${recovery.clause} carries a <clause-variation>. Resolving one means resolving `
        + 'a sibling FILE, and doing that across packages is the general cross-package read this ruling '
        + 'declined. Establish where the variation target lives before recovering this clause.', at);
    }
    // The same reasoning one level down. A recovered clause is emitted under THIS package's
    // filename, so `spliceWrappers` would resolve any <image-reference>/<table-reference> conref
    // against THIS package's wrapper index instead of the supplying one — attaching the wrong
    // figure or table, or dropping one, without a word. All four recoveries carry only <xref>, so
    // this costs nothing today; the next one might not, and a wrong table of numeric limits is the
    // defect class this pipeline exists to prevent.
    for (const el of root.getElementsByTagName('*')) {
      const tag = el.nodeName;
      if ((tag === 'image-reference' || tag === 'table-reference') && attr(el, 'conref')) {
        failLoud(`R60 recovery for ${recovery.clause} cites a <${tag}>. Its conref would be resolved against `
          + `${doc.key}'s wrapper index rather than ${recovery.from}'s, which can attach the wrong figure `
          + 'or table, or drop one silently. Resolve wrappers against the supplying package before '
          + 'recovering a clause that cites any.', at);
      }
    }
    applyBaseView(dom, { sourceFile: recovery.conref, ruledFired, correctionsFired });
    return root;
  }

  /**
   * The state variations declared ON a national clause. Both kinds are units (§5.3):
   *
   *  * DELETE is a jurisdiction DISAPPLICATION, not a dangling reference. There is no target file
   *    and none is needed — the provision IS the disapplication, and where the source spells it
   *    out it is in `@deleted-text`. 129 of them exist and 96 carry text. Dropping them is the
   *    worst class of omission a compliance corpus has: a reader greps F4D10, gets the national
   *    clause, and is never told it does not apply in NSW.
   *  * REPLACE resolves to a sibling file by `resolveStateFile`, then that file's OWN edition
   *    membership is checked (§5.3.2) — 11 pointers corpus-wide survive the base view while their
   *    target does not.
   */
  function emitClauseVariations(hostFile, hostRoot, ctx) {
    for (const el of elementChildren(hostRoot)) {
      if (el.nodeName !== 'clause-variation') continue;
      const state = (attr(el, 'variation') ?? '').toUpperCase();
      const type = attr(el, 'variation-type');
      if (!STATES.has(state)) {
        throw new Error(`read-2022 [${doc.key}]: ${hostFile} declares clause-variation variation="${attr(el, 'variation')}"`);
      }
      if (type === 'DELETE') {
        dg.stateClauseUnits.del++;
        emit({
          kind: 'clause',
          id: childText(hostRoot, 'sptc') || null,
          term: null,
          title: childText(hostRoot, 'title'),
          state,
          supersedes: null, buildingClasses: null, climateZones: null,
          ...pickCtx(ctx),
          node: el,
        });
        continue;
      }
      if (type !== 'REPLACE') {
        throw new Error(`read-2022 [${doc.key}]: ${hostFile} declares variation-type="${type}" on a clause-variation`);
      }
      const host = facts.get(hostFile);
      const target = resolveStateFile(hostFile, [host?.baseId, host?.acceptedId], state);
      if (!target) {
        throw new Error(`read-2022 [${doc.key}]: ${hostFile} declares a ${state} REPLACE whose file cannot be found. `
          + 'Measured: 432/432 clause-variation pointers resolve, so this is a join that no longer fits the data.');
      }
      if (!targetIsNcc2022(target)) continue;
      if (emittedClauseFiles.has(target)) continue;
      emittedClauseFiles.add(target);
      dg.stateClauseUnits.repl++;
      emitClauseFile(target, ctx, { state });
    }
  }

  /* -- part-level state variations (§5.4) ----------------------------------- */

  /**
   * `part-variation` is the Part-level twin of `clause-variation`, and it needs reading from BOTH
   * sources: 0 identities are FlattenedFile-only but 32 are STANDALONE-ONLY, so reading only the
   * map loses the whole `J4`-`J9 | NT | DELETE` run ("Section J is replaced with Section J of BCA
   * 2009"). 114 elements are 73 distinct `(num, state, variation-type)` identities, so a reader
   * that does not dedupe over-emits by 41.
   */
  // Package-level, not per-container: a Part number can be claimed by several <part> elements in
  // one map (volume-one's I4 four times over), and each of them would otherwise merge the SAME
  // standalone file's variations and emit every identity again.
  const emittedPartVariations = new Set();

  function partVariationsFor(containerNum, mapElements, standaloneFile) {
    const out = [];
    const add = (el, sourceFile) => {
      const key = `${containerNum}|${attr(el, 'variation')}|${attr(el, 'variation-type')}`;
      if (emittedPartVariations.has(key)) return;
      emittedPartVariations.add(key);
      out.push({ el, sourceFile });
    };
    for (const el of mapElements) add(el, null);
    if (standaloneFile) {
      const root = load(standaloneFile).documentElement;
      for (const el of elementChildren(root)) if (el.nodeName === VARIATION_TAG) add(el, standaloneFile);
    }
    return out;
  }

  function emitPartVariations(ctx, mapElements, standaloneFile) {
    for (const { el, sourceFile } of partVariationsFor(ctx.containerNum, mapElements, standaloneFile)) {
      const state = (attr(el, 'variation') ?? '').toUpperCase();
      const type = attr(el, 'variation-type');
      if (!STATES.has(state)) {
        throw new Error(`read-2022 [${doc.key}]: part-variation on ${ctx.containerNum} declares variation="${attr(el, 'variation')}"`);
      }
      // The clean "href on exactly REPLACE, deleted-text on exactly DELETE" split does NOT
      // generalise — 2 Housing Provisions REPLACE pointers carry both — so `variation-type`
      // decides and the attributes are never used to infer the kind.
      if (type === 'DELETE') {
        dg.overviews++;
        emit({
          kind: 'page', overview: true,
          id: null, term: null, title: ctx.containerTitle ?? '', state,
          supersedes: null, buildingClasses: null, climateZones: null,
          ...pickCtx(ctx), node: el,
        });
        continue;
      }
      if (type !== 'REPLACE') {
        throw new Error(`read-2022 [${doc.key}]: part-variation on ${ctx.containerNum} declares variation-type="${type}"`);
      }
      const host = sourceFile ?? (partsByNum.get(ctx.containerNum) ?? [])[0] ?? null;
      const target = resolveStateFile(host, [ctx.containerNum], state);
      if (!target) {
        throw new Error(`read-2022 [${doc.key}]: Part ${ctx.containerNum} declares a ${state} REPLACE whose file cannot be found. `
          + 'Measured: 47/47 part-variation pointers resolve.');
      }
      if (!targetIsNcc2022(target)) continue;
      const root = load(target).documentElement;
      splice(root, null, target);
      dg.overviews++;
      emit({
        kind: 'page', overview: true,
        id: null, term: null,
        title: childText(root, 'title') || ctx.containerTitle || '',
        state,
        supersedes: null, buildingClasses: null, climateZones: null,
        ...pickCtx(ctx), node: root,
      });
    }
  }

  /* -- the map walk --------------------------------------------------------- */

  const mapSrc = fs.readFileSync(path.join(xmlDir, 'FlattenedFile.xml'), 'utf8');
  const mapDom = new DOMParser(XML_PARSER).parseFromString(mapSrc, 'text/xml');
  // No `retained` here: pass 1 already walked this file, and the census counts each site once.
  applyBaseView(mapDom, { sourceFile: 'FlattenedFile.xml', ruledFired, correctionsFired });
  loaded.set('FlattenedFile.xml', mapDom);

  const ctx0 = {
    sectionNum: '', sectionType: 'other',
    containerKind: null, containerNum: null, containerTitle: null,
    category: null, overviewOwner: false, state: null,
  };

  const failLoud = (msg, trail) => {
    throw new Error(`read-2022 [${doc.key}]: ${msg} — at ${trail.join('/')}`);
  };

  const ownProse = el => {
    const out = [];
    for (const c of elementChildren(el)) {
      if (OWN_PROSE_TAGS.has(c.nodeName) || c.nodeName === SECTION_TAG) out.push(c);
      else if (TRANSPARENT_TAGS.has(c.nodeName)) out.push(...ownProse(c));
    }
    return out;
  };

  function walk(el, ctx, trail) {
    const tag = el.nodeName;
    const path2 = trail.concat(tag);

    if (ROOT_TAGS.has(tag)) {
      // The three nested maps are Schedule 1: `document-type` is where a glossary entry's
      // category comes from, and weblinks.mjs routes every glossary web_url on it.
      const next = { ...ctx, category: GLOSSARY_CATEGORIES.get(attr(el, 'document-type') ?? '') ?? ctx.category };
      for (const c of elementChildren(el)) walk(c, next, path2);
      return;
    }

    if (SECTION_TAGS.has(tag)) {
      const { num, type } = sectionOf(attr(el, 'section-num'));
      const next = {
        ...ctx, sectionNum: num, sectionType: type,
        containerKind: null, containerNum: null, containerTitle: null,
      };
      // §11: `topicset/@summary` is CONTENT, not metadata — the Section's published abstract, 17
      // of them, present in no 2025 package and nowhere else in this one. A walker that reads
      // @section-num and @navtitle and stops loses it.
      if (attr(el, 'summary') && inScope(next)) {
        dg.overviews++;
        emit({
          kind: 'page', overview: true,
          id: null, term: null, title: collapse(attr(el, 'navtitle') ?? ''), state: null,
          supersedes: null, buildingClasses: null, climateZones: null,
          sectionNum: next.sectionNum, sectionType: next.sectionType,
          containerKind: 'ncc-section', containerNum: num || null, containerTitle: collapse(attr(el, 'navtitle') ?? ''),
          node: el,
        });
      }
      for (const c of elementChildren(el)) walk(c, next, path2);
      return;
    }

    if (CONTAINER_TAGS.has(tag)) {
      const num = childText(el, 'num');
      const next = {
        ...ctx, containerKind: tag, containerNum: num || ctx.containerNum,
        containerTitle: childText(el, 'title') || ctx.containerTitle,
        // A PART CAN BE A JURISDICTION'S OWN. Measured: 9 Part numbers are claimed by more than
        // one <part> in a single map -- volume-one's I4 by NSW, TAS, VIC and WA, volume-three's
        // E4 by TAS and VIC -- each carrying `variation` and holding only that state's clauses.
        // Reading the attribute only on clauses would derive four Victorian, Tasmanian, New South
        // Wales and Western Australian Part overviews onto ONE national filename and keep the
        // last: exactly the silent overwrite emit.mjs's trap 1 records, in a second edition.
        state: attr(el, 'variation') ?? ctx.state ?? null,
      };
      // Only a NATIONAL container merges the standalone file's part-variations. A jurisdiction's
      // own Part (`variation="TAS"`) is not what that file varies, and merging would file the
      // national Part's NSW disapplication under Tasmania.
      const standalone = next.state ? null
        : (partsByNum.get(num) ?? []).find(f => facts.get(f).root === tag && !facts.get(f).variation) ?? null;
      const prose = ownProse(el);
      next.overviewOwner = prose.length > 0;
      if (inScope(next)) {
        if (prose.length) {
          for (const p of prose) splice(p, null, `${tag} ${num || '(no num)'}`);
          dg.overviews++;
          emit({
            kind: 'page', overview: true,
            id: null, term: null, title: next.containerTitle ?? '', state: next.state,
            supersedes: null, buildingClasses: null, climateZones: null,
            ...pickCtx(next), node: el,
          });
        }
        emitPartVariations(next, elementChildren(el).filter(c => c.nodeName === VARIATION_TAG), standalone);
      }
      for (const c of elementChildren(el)) walk(c, next, path2);
      return;
    }

    if (TRANSPARENT_TAGS.has(tag)) {
      for (const c of elementChildren(el)) walk(c, ctx, path2);
      return;
    }

    if (tag === SECTION_TAG) {
      // Everything here except the clauserefs is the enclosing container's own prose, already
      // handed to its overview unit whole. If no container claimed it, emitting nothing would
      // drop the text without a sound — the same guard read-2025.mjs puts on its own-prose tags.
      if (!ctx.overviewOwner) failLoud('<section> holds prose but no container owns it', path2);
      for (const c of elementChildren(el)) {
        if (c.nodeName === CLAUSE_POINTER_TAG || c.nodeName === SECTION_TAG) walk(c, ctx, path2);
      }
      return;
    }

    if (tag === CLAUSE_POINTER_TAG) {
      for (const c of elementChildren(el)) {
        if (c.nodeName === 'title') continue;      // "NT INSERT Clause" — restates the target's own @variation
        if (c.nodeName !== 'clause') failLoud(`<${c.nodeName}> inside a clauseref`, path2);
        const conref = attr(c, 'conref');
        if (!conref) failLoud('a clauseref whose clause carries no conref', path2);
        dg.map.mapped++;
        let file = facts.has(conref) ? conref : null;
        if (!file) {
          // Shipped broken in the source: 4 conrefs in volume-three carry a literal
          // `ERROR_IN_RESOLVING_URI:` prefix. Anything else that fails to resolve is ours.
          if (!conref.startsWith('ERROR_IN_RESOLVING_URI:')) {
            failLoud(`clauseref conref ${JSON.stringify(conref)} names no file in XMLs/`, path2);
          }
          dg.brokenConrefs.push(conref);
          continue;
        }

        /* -- R51: the clauseref names its target THREE ways; they must agree ------------------
         *
         * `conref` is a filename, and a filename is not an identity: `XMLs/` is a shared
         * authoring pool and two packages ship different clauses under the SAME name. The map
         * also flattens the target's own `<clause @id>` and `<title @id>` into the clauseref, and
         * those are identities. Where all three agree the join is confirmed; where the two ids
         * BOTH disagree with the file, the file is not the clause the map means.
         *
         * Why BOTH and not the `<clause @id>` alone. Measured over 2,061 clause conrefs in the
         * four packages: `@id` disagrees on 10, `<title @id>` on 9, both together on 9, title
         * alone on 0. The nine are the real ones — each was emitting another volume's law, and
         * two were checked verbatim against ncc.abcb.gov.au. The tenth is volume-three's B3F1,
         * whose clauseref carries the SAME `<clause @id>` as the B2F1 clauseref two subtopics
         * earlier while its `<title @id>` and `conref` both correctly name B3F1 — an authoring
         * copy-paste, not a different target. Redirecting it on the `@id` alone would have
         * published heated-water text as B3F1, or (since B2F1's file is already emitted by then)
         * dropped B3F1 entirely. One contradicted attribute does not overturn two agreeing ones.
         *
         * `title-only` is the shape nothing in this corpus exhibits, so nothing is known about
         * it: it FAILS rather than guessing which signal to believe.
         *
         * `root-only` is B3F1 and nothing else, and it is ENUMERATED rather than tolerated as a
         * class. `<title @id>` is not a clause identity — 33 title ids are shared across different
         * filenames, including same-package pairs with different designations (`F1D12`/`F3D2`,
         * `F1V1`/`F3V1`, HP's `B4P4` against the other packages' `B4P3`) — so a wrong file that
         * happens to share the wanted title id would present as root-only and publish silently.
         * One ruling with its evidence closes that, at no cost to today's output.
         *
         * A clauseref that states only ONE of the two identities cannot be judged at all. None
         * exists (measured: 0 of 2,061), and `identityUnstated` below is what keeps that true: if
         * a future release stops emitting an attribute, every disagreement would otherwise become
         * a silent pass and this whole check would evaporate without a word.
         */
        const wantId = attr(c, 'id');
        const wantTitleId = attrOf(childEl(c, 'title'), 'id');
        if (!wantId || !wantTitleId) dg.map.identityUnstated++;
        const got = facts.get(file);
        const idBad = Boolean(wantId) && got.id !== wantId;
        const titleBad = Boolean(wantTitleId) && got.titleId !== wantTitleId;
        if (titleBad && !idBad) {
          failLoud(`clauseref conref ${JSON.stringify(conref)} states title @id ${wantTitleId} but the file's `
            + `title is ${got.titleId}, while its clause @id ${wantId} matches. No clauseref in any package `
            + 'has this shape, so which identity to believe has never been established — establish it '
            + 'before this build is trusted.', path2);
        }
        if (idBad && !titleBad) {
          const stale = staleRootId(doc.key, conref);
          if (!stale) {
            failLoud(`clauseref conref ${JSON.stringify(conref)} states clause @id ${wantId} but the file is `
              + `@id ${got.id}, while its title @id ${wantTitleId} matches. A shared title @id is NOT proof `
              + 'of identity — 33 of them are reused across different filenames, some with different clause '
              + 'designations — so this may be a wrong file that happens to share one. Establish which clause '
              + 'the map means and add it to STALE_ROOT_ID_CLAUSEREFS with the evidence.', path2);
          }
          staleFired.add(`${doc.key}|${conref}`);
        }
        if (idBad && titleBad) {
          // Both identities disagree: this file is not the target. Follow the identity if this
          // package holds it (R51); else recover it from the sibling package a ruling names (R60);
          // else the clause is not publishable from this package (R56).
          const byId = clauseFileById.get(wantId);
          const recovery = byId ? null : recoveredClause(doc.key, conref);
          if (byId && facts.get(byId).titleId === wantTitleId) {
            dg.identityRedirects++;
            file = byId;
          } else if (recovery) {
            // R60 — cross-package recovery, ONLY for an enumerated clause whose direction was
            // proved from content AND from the published Code on both sides. Not a general rule:
            // a shared UUID alone is an inference, and this corpus does not publish inferences.
            const node = siblingClause(recovery, wantId, wantTitleId, path2);
            recoveriesFired.add(`${doc.key}|${conref}`);
            dg.recoveredClauses.push({
              conref, clause: recovery.clause, from: recovery.from, published: recovery.published,
            });
            emittedClauseFiles.add(file);
            if (!inScope(ctx)) continue;
            emitClauseFile(file, ctx, { node });
            continue;
          } else {
            const ruling = omittedClause(doc.key, conref);
            if (!ruling) {
              failLoud(`clauseref conref ${JSON.stringify(conref)} states clause @id ${wantId} / title @id `
                + `${wantTitleId}, but that file is @id ${got.id} / ${got.titleId} and no file in this package `
                + 'carries the stated identity. The file named is a DIFFERENT clause, so emitting it would '
                + "publish another publication's provisions under this one's citation. Establish which clause "
                + 'the map means and add it to OMITTED_2022_CLAUSES with the evidence, or — if the text is in '
                + 'a sibling package AND the published Code confirms the direction — to RECOVERED_2022_CLAUSES.', path2);
            }
            dg.omittedClauses.push({ conref, clause: ruling.clause, reason: ruling.reason,
              evidence: ruling.evidence, variations: variationStatesOf(file) });
            omissionsFired.add(`${doc.key}|${conref}`);
            continue;
          }
        }

        if (emittedClauseFiles.has(file)) { dg.map.duplicateConrefs++; continue; }
        if (!facts.get(file).baseId) { dg.map.mappedNo2022++; continue; }

        // R51's second condition: identity agrees, but the clause itself is NCC 2025 only —
        // untracked <sptc>/<title> over a body that is entirely a 2024 insertion, which §1.3's
        // membership rule cannot see. Ruled and enumerated, never inferred.
        const only2025 = omittedClause(doc.key, conref);
        if (only2025) {
          if (only2025.reason !== 'clause-is-2025-only') {
            failLoud(`clauseref conref ${JSON.stringify(conref)} resolved cleanly but is listed in `
              + `OMITTED_2022_CLAUSES as ${only2025.reason} — the ruling no longer describes the source`, path2);
          }
          dg.omittedClauses.push({ conref, clause: only2025.clause, reason: only2025.reason,
            evidence: only2025.evidence, variations: variationStatesOf(file) });
          omissionsFired.add(`${doc.key}|${conref}`);
          continue;
        }

        emittedClauseFiles.add(file);
        if (!inScope(ctx)) continue;
        emitClauseFile(file, ctx);
        emitClauseVariations(file, loaded.get(file).documentElement, ctx);
      }
      return;
    }

    if (UNIT_TAGS.has(tag)) {
      if (tag === 'page') {
        if (!inScope(ctx)) return;
        splice(el, null, `page: ${childText(el, 'title')}`);
        dg.pages++;
        emit({
          kind: 'page',
          id: null, term: null, title: childText(el, 'title'),
          state: (attr(el, 'variation') ?? '').toUpperCase() || ctx.state || null,
          supersedes: null, buildingClasses: null, climateZones: null,
          ...pickCtx(ctx), node: el,
        });
        return;
      }
      // abcb-glossentry. §1.3 applies here too: 30 entries per package are 2025-only, and a
      // walker that base-views clauses but not glossary entries publishes 30 phantom definitions.
      glossaryCtx = ctx;
      seenGlossaryIds.add(attr(el, 'id'));
      emitGlossentry(el, ctx, ctx.category);
      return;
    }

    if (tag === VARIATION_TAG) return;             // claimed by its container above
    if (OWN_PROSE_TAGS.has(tag)) return;           // claimed by its container's overview above
    if (METADATA_TAGS.has(tag)) return;
    if (POINTER_TAGS.has(tag)) { dg.glossrefs++; return; }

    failLoud(
      `unknown element <${tag}> — classify it (root / section / container / transparent / unit / `
      + 'own-prose / metadata / pointer); never add a prose tag to a structural set',
      path2,
    );
  }

  walk(mapDom.documentElement, ctx0, []);

  /**
   * The clauses the base map does NOT reach (§4.1's "A says 2025, B says 2022").
   *
   * ⊕ docs/content-model-2022.md §4.1 concludes that the map UNDER-COUNTS here, and that
   * volume-one's five `F1D12`/`F1D13`/`F1D14`/`F1D15`/`F1V1` files are NCC 2022 Part F3 clauses the
   * map's base view loses. Measured against the packages, the premise of that conclusion does not
   * hold: `F3D2-roof-coverings.xml` also exists, the base map DOES reach it, and its base view is
   * byte-identical to `F1D12-roof-coverings.xml`'s (452 chars, character for character; same for
   * all five). The five are DUPLICATE COPIES made under the 2025 numbering, not lost clauses — so
   * emitting them produces five duplicate files, not five recovered ones. That is what a first
   * implementation of §4.1's advice did here, and the filename-uniqueness check is what caught it.
   *
   * What survives of §4.1 is the reconciliation itself, kept as an ASSERTION rather than a rescue:
   * a clause reachable only through a 2025 insertion is fine IF its designation is already in the
   * corpus. One that is not would be a clause genuinely lost between the two membership signals,
   * and there is no safe default for it — the map files these five under the DRAFT's Part F1
   * ("Surface water management…"), not under NCC 2022's Part F3 ("Roof and wall cladding"), so
   * even the container the map offers would be wrong. It throws.
   */
  {
    // Derived from the files the walk RESOLVED, not from the units it emitted: `units` is the
    // in-scope set, and `emittedClauseFiles` is populated before the `inScope` gate, so reading
    // this off `units` makes the assertion depend on the slice. Measured before the fix:
    // `--sections A` and `--sections C` both threw on volume-one because F3V1's twin lives in
    // Section F — and Task 11's pilot slice is A,C.
    const emittedIds = new Set([...emittedClauseFiles].map(f => facts.get(f)?.baseId).filter(Boolean));
    const mapAccepted = new DOMParser(XML_PARSER).parseFromString(mapSrc, 'text/xml');
    (function scan(el) {
      for (const c of elementChildren(el)) {
        if (c.nodeName === 'clause' && attr(c, 'conref')) {
          const file = attr(c, 'conref');
          if (!facts.has(file) || emittedClauseFiles.has(file) || !facts.get(file).baseId) continue;
          // An R51 omission is a THIRD category, not a membership failure: the clauseref was
          // refused because the map's own stated identity does not match this file, or because the
          // clause is 2025-only. It is unemitted by ruling, so it is neither "reached only through
          // a 2025 insertion" nor a clause lost between §1.3's and §4.1's signals — and counting it
          // here would both throw and move §4.1's measured `insertOnly` census.
          if (omittedClause(doc.key, file)) continue;
          dg.map.insertOnly++;
          const id = facts.get(file).baseId;
          if (emittedIds.has(id)) { dg.map.insertOnlyDuplicates++; continue; }
          throw new Error(`read-2022 [${doc.key}]: ${file} is NCC 2022 (base sptc ${id}) but the map reaches `
            + 'it only through a 2025 insertion and no mapped clause supplies that designation. Neither '
            + 'membership signal covers it, and the container the map offers belongs to the 2025 draft.');
        }
        scan(c);
      }
    })(mapAccepted.documentElement);
  }

  /**
   * The glossary's own rescue. The three nested maps inline 543 entries per package, which is the
   * whole glossary in three of the four — but volume-two ships 544 `abcb-glossentry` FILES, and
   * `glossary-Existing-building-WA.xml` is inlined nowhere. It is a Western Australian definition
   * of a term the Code uses, its base `glossterm` is non-empty, and nothing else in the package
   * would ever reach it.
   *
   * The one thing the map cannot supply for it is `category` — which of Schedule 1's three
   * sub-pages defines it — and that is not decorative: weblinks.mjs routes every glossary web_url
   * on it. A state sense of a term belongs on the same sub-page as the national sense, so it takes
   * that entry's category, and fails loud rather than guessing when there is no national sense.
   */
  for (const [file, f] of facts) {
    if (f.root !== 'abcb-glossentry' || seenGlossaryIds.has(f.id)) continue;
    const term = f.baseTerm;
    const category = term ? categoryByTerm.get(term) ?? null : null;
    // Volume Two's `glossary-Existing-building-WA.xml` is the corpus's one case: a WA-only
    // definition with no national sense in any of the four maps, so which Schedule 1 sub-page
    // publishes it cannot be established. It is emitted WITHOUT a category, which resolves
    // `web_url` to null — fail closed, the way weblinks.mjs is built to fail — and recorded here.
    // Dropping the definition instead would lose a jurisdiction's law to a missing hyperlink.
    if (term && !category) dg.uncategorisedGlossary.push(file);
    emitGlossentry(load(file).documentElement, glossaryCtx ?? ctx0, category);
  }

  /* -- figure census (§6.1) -------------------------------------------------- */

  for (const [file, f] of facts) {
    if (f.root !== 'image-reference') continue;
    const wrapper = load(file).documentElement;
    if (!childEl(wrapper, 'image')) { dg.figures.baseEmptyWrappers++; continue; }
    const disk = resolveImageFile(file, childEl(wrapper, 'image').getAttribute('href') ?? '');
    if (disk) usedImages.add(disk);
  }
  dg.figures.distinct = usedImages.size;
  dg.unreferencedImages = images.length - usedImages.size;

  /* -- R51: no ruling may go stale ------------------------------------------
   * The whole package is always read (the build slices with its own `inScope`, never the reader),
   * so every clauseref is walked on every run and an entry for THIS volume must have fired. One
   * that did not is describing a source that has changed — and an omission nobody can see stop
   * omitting is how published Code disappears quietly.
   *
   * RECORDED here, ASSERTED in build.mjs, for the same reason parity and the web_url nulls are: a
   * fixture package in the test suite carries a real document key and none of the real clauserefs,
   * so a throw here would fail on synthetic input that is not claiming to be the publication. The
   * build only ever reads the real packages. */
  dg.unfiredRulings = [
    ...unfired(OMITTED_2022_CLAUSES, 'OMITTED_2022_CLAUSES', omissionsFired),
    ...unfired(RECOVERED_2022_CLAUSES, 'RECOVERED_2022_CLAUSES', recoveriesFired),
    ...unfired(STALE_ROOT_ID_CLAUSEREFS, 'STALE_ROOT_ID_CLAUSEREFS', staleFired),
    // R73's entries are keyed on a SOURCE FILE, not on a volume, because the packages ship the
    // same file in up to four zips. So an entry is only owed a firing by the packages that
    // actually contain that file — `xmlFiles` is what this package holds, and asking any other
    // package for it would fail every build on a fact about a different zip.
    ...NOT_BASE_CYCLE_TEXT
      .filter(e => xmlBasenames.has(e.file) && !ruledFired.has(rulingKey(e)))
      .map(e => ({ list: 'NOT_BASE_CYCLE_TEXT', volume: doc.key, clause: e.file, conref: `<${e.tag}> ${e.text}` })),
    // R75, keyed on a source file for the same reason. A correction whose file this package holds
    // but whose text it no longer carries throws inside applyBaseView, where the count is known;
    // what reaches here is the other staleness — an entry naming a file no package contains at all,
    // which nothing else would ever notice.
    ...RETAINED_TEXT_CORRECTIONS
      .filter(e => xmlBasenames.has(e.file) && !correctionsFired.has(correctionKey(e)))
      .map(e => ({ list: 'RETAINED_TEXT_CORRECTIONS', volume: doc.key, clause: e.file, conref: e.find })),
  ];
  // What actually fired, in table order, for the edition index to disclose.
  dg.retainedTextCorrections = RETAINED_TEXT_CORRECTIONS
    .filter(e => correctionsFired.has(correctionKey(e)))
    .map(e => ({ file: e.file, find: e.find, replace: e.replace, url: e.url }));
  function unfired(list, name, fired) {
    return list.filter(e => e.volume === doc.key && !fired.has(`${doc.key}|${e.conref}`))
      .map(e => ({ list: name, volume: e.volume, clause: e.clause, conref: e.conref }));
  }

  if (diagnostics && typeof diagnostics === 'object') Object.assign(diagnostics, dg);
  return units;
}
