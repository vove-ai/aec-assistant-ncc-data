// normalize.mjs — one RawUnit's DOM subtree → grep-friendly markdown.
//
// The defect this repo exists to fix: a glossary cross-reference splits a sentence, so an exact
// phrase typed by a human finds nothing. Every rule below serves the same goal — prose a human
// phrase matches as typed:
//
//  1. ONE PARAGRAPH = ONE LINE. The source XML is pretty-printed across 66,667 lines, so every
//     text emission collapses /\s+/ to a single space. Nothing is ever hard-wrapped.
//  2. CROSS-REFERENCES INLINE AS PROSE. <a>/<xref> contribute their text and nothing else; the
//     term is recorded in `definedTerms` instead of interrupting the sentence.
//  3. FAIL LOUD. Every element is in an explicit allowlist with a comment saying what it is. An
//     element in none of them throws, naming the element and the unit. Silently dropping content
//     from a compliance corpus is the worst outcome available here — worse than crashing.
//
// Pure: DOM in, strings out. No filesystem, no network, no module state — and, since the second
// reader landed, no import from a reader either. Which child tags belong to another unit is a
// property of the EDITION, not of this module: 2022's `clauseref`, `subtopic` and `meta` mean
// nothing in 2025, and 2025's `content` and `spec-topic` mean nothing in 2022. Each reader
// therefore declares its own vocabulary on every unit as `bodyTags`, and this module refuses a
// unit that does not carry one rather than falling back to an edition's set that may not fit.

const DEFAULT_CDN_BASE = 'https://cdn.aecassistant.com.au/images/ncc';

/**
 * The `{cdnBase}/{year}/{cdnKey}` prefix every figure URL of ONE document is built on.
 *
 * Exported because a second caller has to RECOGNISE that prefix rather than construct one of its
 * own. The glossary is embedded once per volume, so the same entry emits `…/2025/volume1/x.svg`
 * from Volume One and `…/2025/volume2/x.svg` from Volume Two — an artefact of our own per-document
 * `cdnKey`, not a difference the NCC publishes. build.mjs neutralises exactly this prefix before
 * asking whether two documents' copies of a glossary entry say the same thing, and a second copy
 * of the format string is how the two drift apart and the comparison silently stops matching.
 */
export function figureUrlPrefix({ cdnBase = DEFAULT_CDN_BASE, year, cdnKey } = {}) {
  return `${cdnBase}/${year}/${cdnKey}`;
}

/* ---------------------------------------------------------------------------
 * Allowlists. Every entry is justified; counts are across all five 2025
 * documents unless noted. Nothing is added without inspecting what it holds.
 * ------------------------------------------------------------------------ */

// Rendered inline, inside a line of prose. Anything else in an inline position throws.
const INLINE_TAGS = new Set([
  'a',                // 27076 — the 2025 cross-reference; glossary, clause, table, figure, URL
  'xref',             //     0 in 2025; the 2022 DITA cross-reference. Same rule, keyed on tag.
  'strong', 'b',      //    36 — emphasis; `b` is the 2022 spelling
  'i', 'em',          //   2+2 — leftover roman-numeral markers in list items
  'sup', 'sub',       // 1040/641 — "300 m2", "H2O": text as-is, markers would break phrase grep
  'ins',              //     2 — tracked insertion; it IS the current text, so no marker
  'signage',          //    12 — literal sign wording ("FIRE SAFETY DOOR"); verbatim, 9 of 12 in <li>
  'equation-inline',  //   494 — MathType equation embedded in a sentence
  'glossterm',        //  2224 — the glossary term; skipped at a unit's top level, inline elsewhere
]);

// Carry nothing, ever, and are dropped wherever they are met. Each was inspected before it was
// put here; a childless element is not automatically empty of meaning, and two of these three
// would have been if their attributes were not read elsewhere.
const EMPTY_2022_TAGS = new Set([
  'placeholder',                //  87 — <placeholder>[ARCHIVE]</placeholder> / [NUMBER]: an
                                //       authoring stub. read-2022.mjs treats it as an ABSENT
                                //       archive-num rather than shipping "[ARCHIVE]" as one.
  'common-cellChildTextNode',   //  10 — an empty authoring artefact inside <entry>
  'related-links',              //   2 — always empty
]);

// Rendered as blocks. Every entry has a case in renderBlock's switch, and renderListItem gates on
// this set — so a tag missing from here throws rather than being waved through as some unmodelled
// block. Four elements are deliberately absent because a parent rule consumes them and they are
// never dispatched on their own: `title` (taken by section / callout / table-reference /
// image-reference / the variations), `li` (taken by renderList), `link` (taken by resources), and
// `annotation` (dropped inside MathML). Any of them reaching here is an unmodelled shape.
const BLOCK_TAGS = new Set([
  'content',                    // 8467 — transparent wrapper around a subclause's prose
  'subclause',                  // 4324 — transparent; its <content> carries num + p
  'subclause-variation',        //  145 — state variation BELOW unit level; renders inline, labelled
  'p',                          // 10710 — one paragraph, one line
  'num',                        // 3108 — "(1) "; becomes the **(1)** prefix on the next paragraph
  'ol', 'ul',                   // 4831/328 — ordered and unordered lists
  'section',                    // 1010 — a titled block inside a page or callout
  'h2', 'h3',                   //  422/604 — heading; always a verbatim duplicate of <title>
  'table', 'table-reference',   //  651/587
  'table-reference-variation',  //   62 — state-varied table
  'table-variation',            //    3 — state-varied table nested inside a table-reference
  'image-reference',            //  395 — the figure container: title + img + desc-note
  'image-reference-variation',  //   68 — state-varied figure
  'img',                        //  981 — 463 real figures; 518 empty MathType rasters
  'desc-note',                  //  507 — a note under a table or figure
  'callout',                    // 1141 — explanatory box
  'notice',                     //    3 — "This specification has been deliberately left blank…"
  'equation-block',             //   24 — display equation
  'resources',                  //    1 — a list of external handbook links
  'glossdef',                   // 2224 — transparent; the definition body
  'glossBody', 'glossAlt',      //   72 — transparent wrappers around the acronym
  'glossAcronym',               //   72 — the term's acronym ("ACP")
  'glossAbbreviation',          //    8 — 2022; the sibling of glossAcronym, same job
  'intro-part',                 //  124 — a Part's own overview prose
  'signage',                    // block form: 3 of 12 sit directly under <content>
  // --- 2022 spellings (docs/content-model-2022.md §9.1) ---------------------------------
  'image',                      // 3446 — the 2022 <img>. `href` is a publishing-session path, so
                                //        read-2022.mjs resolves the disk name onto `src` (§6).
  'clauseref',                  // 6957 — a pointer at a clause emitted as its own unit. Reached
                                //        nested inside a Specification's <section>, which is that
                                //        Specification's own prose AND holds 310 of them.
  'callout-type',               // 2613 — always empty; the box's kind is @ncc-info-type
  ...EMPTY_2022_TAGS,
]);

// A unit's identity, already carried in frontmatter and the H1 by emit.mjs. Skipped at the top
// level of a body only — nested <title> (a section's, a table's) is content and is rendered.
const UNIT_IDENTITY_TAGS = new Set(['title', 'sptc', 'glossterm']);

// Carry no content and never can: verified childless in all five documents.
const EMPTY_TABLE_METADATA = new Set([
  'col',       //  2439 — always <col/>
  'colgroup',  //   190 — always <colgroup span=""/>
  'colspec',   // 12688 — 2022 CALS column metadata; childless, the same job as col/colgroup
]);

// A table cell. `entry` is CALS's td/th rolled into one — 140,385 of them, the single commonest
// element in the 2022 corpus.
const TABLE_CELL_TAGS = new Set(['td', 'th', 'entry']);

// Presentation MathML. See flattenMath for the linear form each produces.
const MATHML_TAGS = new Set([
  'mathML', 'math', 'semantics', 'mrow', 'mstyle',
  'mi', 'mn', 'mo', 'mtext',
  'msub', 'msup', 'msubsup', 'munderover', 'mover', 'mfrac', 'msqrt', 'mfenced',
  'mtable', 'mtr', 'mtd',   // 8/16/16 — 2022 only; a matrix inside an equation
]);

// <a>/<xref> types that point at a glossary entry — the only ones that are defined terms.
// Measured: abcb-glossentry resolves to <glossentry>/<glossentry-variation> 15553 times,
// glossterm to <glossterm> 772 times. Every other type is a clause/table/part cross-reference.
const GLOSSARY_LINK_TYPES = new Set(['abcb-glossentry', 'glossterm']);

// An undeclared <ol> takes the style that FOLLOWS its parent list's — not one fixed by absolute
// depth. Evidence, all from the corpus's own cross-references:
//   * 180 prose references of the form "(a)(i)" / "S1C2(d)(iv)", and ZERO of "(a)(a)"
//   * 18 of the form "(i)(A)" / "(iii)(B)", and ZERO of "(i)(a)"
//   * livable-housing runs numbered -> alpha and then cites "(a)(v)" and "(b)(ii)" — roman at its
//     THIRD level, where an absolute-depth ladder would have produced "(A)". That document is why
//     this is keyed on the parent's style.
// A top-level list with nothing declared defaults to alpha (the NCC cites "C2D2(a)").
const STYLE_SUCCESSOR = {
  numbered: 'alpha', alpha: 'roman', roman: 'upper-alpha', 'upper-alpha': 'upper-roman',
};
const LIST_STYLES = {
  alpha: 'alpha', numbered: 'numbered', 'lower-roman': 'roman', roman: 'roman',
  'upper-alpha': 'upper-alpha', 'upper-roman': 'upper-roman',
};

/**
 * Some content is carried in ATTRIBUTES, where a child-element walker cannot see it (2022 §11).
 * On `clause-variation` and `part-variation` there are no children at all, so nothing signals the
 * omission — and what is being omitted is 169 whole provisions, 96 of them substantive. These are
 * the four measured carriers; `image/@alt` and `@longdescref` are read at the figure instead.
 */
const UNIT_PROSE_ATTRIBUTES = new Map([
  // `fallbackToText` is the CHILDLESS pointers only. The 33 DELETE pointers with no
  // `deleted-text` still assert that the clause does not apply in that jurisdiction, and their
  // element text — "NT DELETE Clause" — states the fact, so it is the fallback rather than an
  // empty file. It must never apply to `subclause`, whose text is the whole sub-clause: falling
  // back there would print every 2025 subclause's body twice, unlabelled, MathType base64 and all.
  ['clause-variation', { attr: 'deleted-text', fallbackToText: true }],   //  96
  ['part-variation', { attr: 'deleted-text', fallbackToText: true }],     //  69
  ['subclause', { attr: 'deleted-text', fallbackToText: false }],         //   4
  ['topicset', { attr: 'summary', fallbackToText: false }],               //  17
]);

/** A unit's body, when the unit's own element carries it as an attribute. */
function unitProseAttribute(node) {
  const rule = UNIT_PROSE_ATTRIBUTES.get(node?.nodeName);
  if (!rule) return '';
  const value = (node.getAttribute(rule.attr) ?? '').replace(/\s+/g, ' ').trim();
  if (value) return value;
  // The fallback is for a CHILDLESS pointer only. 2022's DELETE pointers have no children at all
  // (559 of 561 clause-variation, all 114 part-variation), so their element text is the whole of
  // what they say. 2025 spells `clause-variation` as a full container with the varied text
  // inline, and falling back there would print that text a second time, unlabelled and with the
  // MathType base64 that `flattenMath` exists to strip.
  if (!rule.fallbackToText || elementChildren(node).length) return '';
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The prose a container holds in its own right, in document order — exactly what a
 * container-overview unit renders, and nothing else. Descends through the edition's transparent
 * grouping elements so a callout parked under a subtopic still belongs to its Part.
 */
export function overviewChildren(el, bodyTags) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (bodyTags.ownProse.has(n.nodeName)) out.push(n);
    else if (bodyTags.transparent.has(n.nodeName)) out.push(...overviewChildren(n, bodyTags));
  }
  return out;
}

/**
 * @param {object} unit  a RawUnit from read-2025.mjs / read-2022.mjs
 * @param {{cdnBase?: string, year: string, cdnKey: string}} opts
 * @returns {{bodyMd: string, definedTerms: string[], figures: string[], warnings: string[],
 *           tableRefs: string[]}}
 *   `tableRefs` is the immediate-parent element name of every `<table-reference>` this call
 *   RENDERED, one per occurrence. `docs/content-model-2025.md` counts table-reference as a
 *   content unit alongside clause and glossentry, but this module renders it inline instead of
 *   emitting a file — so emitted units alone can never reconcile with that table. The build adds
 *   this column to close the gap (R5), and counting at render time rather than by a second DOM
 *   pass is what makes it evidence: it proves each table-reference reached the markdown, not
 *   merely that it exists in the XML.
 */
export function normalizeUnit(unit, { cdnBase = DEFAULT_CDN_BASE, year, cdnKey } = {}) {
  const st = {
    unit, cdnBase, year, cdnKey,
    definedTerms: new Set(), figures: new Set(), warnings: [], tableRefs: [],
    pendingNum: null,
  };
  const bodyTags = unit?.bodyTags;
  if (!bodyTags?.skip || !bodyTags?.ownProse || !bodyTags?.transparent) {
    throw new Error(
      `normalize: ${unitLabel(unit)} carries no bodyTags — the READER declares which child tags `
      + 'belong to another unit, which are a container\'s own prose, and which are transparent, '
      + 'because the two editions do not share that vocabulary. Falling back to one edition\'s set '
      + 'would silently render another edition\'s nested units into their parent.',
    );
  }

  // R19: an overview unit's node is a *container*; its body is the container's own prose, not
  // the clauses beneath it. Branch structurally on the flag, never on node.nodeName.
  const children = unit.overview ? overviewChildren(unit.node, bodyTags) : ownChildren(unit.node, bodyTags);

  const sink = makeSink();
  const lead = unitProseAttribute(unit.node);
  if (lead) sink.block(lead);
  for (const child of children) renderBlock(child, sink, st, 0);
  flushPendingNum(sink, st);

  return {
    bodyMd: sink.done().join('\n\n'),
    definedTerms: [...st.definedTerms],
    figures: [...st.figures],
    warnings: st.warnings,
    tableRefs: st.tableRefs,
  };
}

/* -- unit body selection ---------------------------------------------------- */

// R1: a unit's body is its own content only. A clause nests a clause-variation 227 times across
// the corpus and the walker emits both; without this the national clause would contain the NSW
// text and a phrase grep would return the wrong jurisdiction.
function ownChildren(node, bodyTags) {
  const out = [];
  for (const c of elementChildren(node)) {
    if (bodyTags.skip.has(c.nodeName)) continue;
    if (UNIT_IDENTITY_TAGS.has(c.nodeName)) continue;
    out.push(c);
  }
  return out;
}

/* -- block sink ------------------------------------------------------------- */

// Blocks join with a blank line; list lines join with a single newline inside one block. A block
// arriving mid-list flushes the pending lines first, so document order always survives.
function makeSink() {
  const blocks = [];
  let buf = [];
  const flush = () => { if (buf.length) { blocks.push(buf.join('\n')); buf = []; } };
  return {
    line(s) { buf.push(s); },
    block(s) { flush(); if (s) blocks.push(s); },
    /** How much has been produced so far. R61 compares it either side of a subclause to ask
     *  whether that subclause rendered anything at all. */
    size() { return blocks.length + buf.length; },
    done() { flush(); return blocks; },
  };
}

/* -- blocks ----------------------------------------------------------------- */

function renderBlock(node, sink, st, depth) {
  const tag = node.nodeName;
  switch (tag) {
    /* transparent wrappers — their children are the blocks */
    case 'content': case 'glossBody': case 'glossAlt':
    case 'intro-part':
      for (const c of elementChildren(node)) renderBlock(c, sink, st, depth);
      return;

    // Transparent too, but 30 of 2022's definitions open with a boilerplate <title> that restates
    // the entry's own attributes — "NSW REPLACE Definition", the glossary twin of the
    // <title>SubClause</title> of §5.2. The jurisdiction is read from `@variation` on the entry
    // and already reaches the reader in `citation:` and `jurisdiction:`, so rendering the label
    // would put "REPLACE Definition" into the corpus as though it were part of the definition.
    case 'glossdef': {
      const { rest } = partition(node, ['title']);
      for (const c of rest) renderBlock(c, sink, st, depth);
      return;
    }

    // Transparent too, but with two 2022-only rules. Its <title> is BOILERPLATE that restates the
    // element's own attributes — "SubClause" 11,520 times, "NSW REPLACE SubClause" 94 — and
    // rendering it would put the word "SubClause" into the corpus eleven thousand times. The
    // attributes are read instead (measured: the rebuilt string equals the title in 98 of 98),
    // and one subclause per package carries a whole VIC disapplication in @deleted-text.
    case 'subclause': {
      const { rest } = partition(node, ['title']);
      // Labelled only when the sub-clause DECLARES a variation of its own — 2022 spells that as
      // `variation` + `variation-type` together (§5.2). 2025's `subclause@state` is INHERITED
      // context inside an already state-scoped unit, so labelling on `state` alone would stamp a
      // redundant "SA variation" into the middle of a file whose every line is South Australian.
      if (node.getAttribute('variation-type')) sink.block(`**${variationLabel(node)}**`);
      const deleted = unitProseAttribute(node);
      if (deleted) sink.block(deleted);
      // R61 — a subclause that renders NOTHING has no number either. NCC 2022's packages carry
      // subclause shells whose every <p> is a 2024 insertion: the base view empties them correctly
      // and the `<num>` survives, so the file ended with `**(2)** **(3)** **(4)**` and nothing
      // beneath them — subclause numbers for provisions the Code does not have. Measured: 9 such
      // labels across J6D12, J6D13, J8D2 and C2P5, and 0 comparable lines in corpus/2025.
      //
      // The test is "this subclause produced no block", NOT "the number is solitary" and NOT "the
      // paragraph is empty". B6P4's `<num>1</num>` is followed by an inserted <p> that vanishes
      // and a DELETED <ol> that the base view RESTORES: it produces blocks, its `(1)` labels them,
      // and it must survive. A number is only dropped when there is demonstrably nothing under it.
      const numBefore = st.pendingNum;
      const sizeBefore = sink.size();
      for (const c of rest) renderBlock(c, sink, st, depth);
      if (sink.size() === sizeBefore && st.pendingNum && st.pendingNum !== numBefore) {
        st.warnings.push(`empty-subclause: ${st.pendingNum} labels nothing in this edition — dropped`);
        st.pendingNum = null;
      }
      return;
    }

    // A pointer at a clause that is emitted as its own unit. Reached nested, inside a
    // Specification's <section> — which is that Specification's own prose AND holds 310 of these.
    // Its optional <title> ("NT INSERT Clause") restates the target's own @variation, which the
    // target carries; the <clause> stub's sptc/title/archive-num are empty placeholders.
    case 'clauseref':
      for (const c of elementChildren(node)) {
        if (c.nodeName !== 'title' && c.nodeName !== 'clause') {
          throw fail(`<${c.nodeName}>`, st, 'inside a clauseref, which holds only a title and a conref stub');
        }
      }
      return;

    // Empty in all 2613 measured instances; the box's kind is @ncc-info-type, read by `callout`.
    case 'callout-type':
      if (elementChildren(node).length || (node.textContent ?? '').trim()) {
        throw fail('<callout-type> carrying content', st, 'where it is empty in every measured instance');
      }
      return;

    // Verified childless / empty — see EMPTY_2022_TAGS for what each one is.
    case 'placeholder': case 'common-cellChildTextNode': case 'related-links':
      return;

    case 'p': {
      const text = inlineChildren(node, st);
      if (!text) return;                       // 4 empty <p/> in the corpus
      const prefix = takePendingNum(st);
      sink.block(prefix + text);
      return;
    }

    // "(1) " — a sibling of <p> inside <content> (R16), not a child of <subclause>. Both shapes
    // land here and both produce "**(1)** " on the next paragraph.
    case 'num':
      flushPendingNum(sink, st);
      st.pendingNum = normalizeNum(inlineChildren(node, st));
      return;

    case 'ol': case 'ul':
      flushPendingNum(sink, st);
      renderList(node, sink, st, depth, null);
      return;

    case 'section': {
      flushPendingNum(sink, st);
      const { title, heading, rest } = splitSection(node);
      // Measured: <section>'s h2/h3 is a verbatim duplicate of its <title> in all 1010 instances.
      // Emitting both would double every heading in the corpus.
      const level = heading?.nodeName === 'h3' ? '###' : '##';
      const titleText = title ? inlineChildren(title, st) : '';
      const headText = heading ? inlineChildren(heading, st) : '';
      if (titleText) sink.block(`${level} ${titleText}`);
      if (headText && headText !== titleText) sink.block(`${level} ${headText}`);
      for (const c of rest) renderBlock(c, sink, st, depth);
      return;
    }

    case 'h2': case 'h3':   // reached only when not paired with an identical <title>
      sink.block(`${tag === 'h3' ? '###' : '##'} ${inlineChildren(node, st)}`);
      return;

    case 'table': {
      flushPendingNum(sink, st);
      // 4 corpus tables carry a <title> of their own, inside the table rather than on its wrapper.
      const caption = partition(node, ['title']).taken.title;
      if (caption) sink.block(`**${inlineChildren(caption, st)}**`);
      sink.block(renderTable(node, st));
      return;
    }

    case 'table-reference': case 'table-reference-variation':
    case 'table-variation':
      flushPendingNum(sink, st);
      renderTableReference(node, sink, st, depth);
      return;

    case 'image-reference': case 'image-reference-variation':
      flushPendingNum(sink, st);
      renderImageReference(node, sink, st, depth);
      return;

    case 'img': case 'image':
      flushPendingNum(sink, st);
      sink.block(figureLine(node, '', '', st));
      return;

    // Notes and explanatory boxes are blockquotes — the design's signal for "not the provision".
    case 'callout': {
      flushPendingNum(sink, st);
      const { taken, rest } = partition(node, ['title', 'callout-type']);
      const inner = makeSink();
      // 2022's @ncc-info-type says whether the box is an exemption, a limitation, an application
      // note or plain explanatory information — a distinction with compliance consequences that
      // 2025 does not record at all. The label is the source's own token, capitalised, never a
      // phrase invented for it.
      const kind = (taken['callout-type']?.getAttribute('ncc-info-type') ?? '').trim();
      const t = taken.title ? inlineChildren(taken.title, st) : '';
      const label = [kind ? kind[0].toUpperCase() + kind.slice(1) : '', t].filter(Boolean).join(' — ');
      if (label) inner.block(`**${label}**`);
      for (const c of rest) renderBlock(c, inner, st, depth);
      sink.block(blockquote(inner.done()));
      return;
    }

    case 'desc-note': {
      flushPendingNum(sink, st);
      const inner = makeSink();
      for (const c of elementChildren(node)) renderBlock(c, inner, st, depth);
      sink.block(blockquote(inner.done()));
      return;
    }

    // State variation below unit level (Task 3 leaves it inline in its parent clause). Labelled
    // so varied text is never read as national text; NOT blockquoted, because in its jurisdiction
    // it is the provision, and a blockquote would signal non-normative guidance.
    case 'subclause-variation': {
      flushPendingNum(sink, st);
      const { taken, rest } = partition(node, ['title']);
      const t = taken.title ? inlineChildren(taken.title, st) : '';
      sink.block(`**${variationLabel(node)}${t ? ` — ${t}` : ''}**`);
      for (const c of rest) renderBlock(c, sink, st, depth);
      return;
    }

    case 'equation-block':
      flushPendingNum(sink, st);
      sink.block(renderEquation(node, st));
      return;

    case 'notice': case 'signage': {   // literal published text; must survive verbatim
      flushPendingNum(sink, st);
      sink.block(inlineChildren(node, st));
      return;
    }

    case 'resources': {
      flushPendingNum(sink, st);
      for (const c of elementChildren(node)) {
        if (c.nodeName !== 'link') throw fail(`<${c.nodeName}>`, st, 'inside <resources>');
        const href = c.getAttribute('href') ?? '';
        const label = (c.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim() || href;
        sink.line(/^https?:\/\//i.test(href) ? `- [${label}](${href})` : `- ${label}`);
      }
      return;
    }

    // The acronym of the entry's term, carried in its own element rather than in the definition.
    case 'glossAcronym': case 'glossAbbreviation':
      sink.block(`Acronym: ${inlineChildren(node, st)}`);
      return;

    default:
      // Unreached in the 2025 corpus (every inline element sits inside a p, li, td, th or title).
      // Kept as the safe direction for the 2022 reader: an inline element standing where a block
      // is expected is still prose, so emit it as its own paragraph rather than lose it.
      if (INLINE_TAGS.has(tag)) { sink.block(inlineChildren(node, st)); return; }
      throw fail(`<${tag}>`, st, 'in a block position');
  }
}

// A <section>'s title and its h2/h3 duplicate; both are consumed by the section rule.
function splitSection(node) {
  const { taken, rest } = partition(node, ['title', 'h2', 'h3']);
  return { title: taken.title ?? null, heading: taken.h2 ?? taken.h3 ?? null, rest };
}

function partition(node, tags) {
  const taken = Object.create(null);
  const rest = [];
  for (const c of elementChildren(node)) {
    if (tags.includes(c.nodeName) && !(c.nodeName in taken)) taken[c.nodeName] = c;
    else rest.push(c);
  }
  return { taken, rest };
}

function blockquote(blocks) {
  return blocks.join('\n\n').split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');
}

/* -- sub-clause numbering --------------------------------------------------- */

// Source is "(1) " in 2025 and "1" in the 2022 fixture shape; both must render "**(1)** ".
function normalizeNum(text) {
  const inner = text.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim();
  return inner ? `(${inner})` : null;
}

function takePendingNum(st) {
  if (!st.pendingNum) return '';
  const p = `**${st.pendingNum}** `;
  st.pendingNum = null;
  return p;
}

// A <num> is followed by a <p> in all 3108 corpus instances. If anything else intervenes the
// label is emitted on its own rather than silently attached to the wrong paragraph.
function flushPendingNum(sink, st) {
  if (!st.pendingNum) return;
  sink.block(`**${st.pendingNum}**`);
  st.warnings.push(`orphan-num: ${st.pendingNum} had no paragraph to label`);
  st.pendingNum = null;
}

/* -- lists ------------------------------------------------------------------ */

function renderList(list, sink, st, depth, parentStyle) {
  const ordered = list.nodeName === 'ol';
  const style = ordered ? listStyle(list, parentStyle, st) : null;
  let i = 0;
  for (const li of elementChildren(list)) {
    if (li.nodeName !== 'li') throw fail(`<${li.nodeName}>`, st, `as a child of <${list.nodeName}>`);
    const label = ordered ? `(${listLabel(style, i)})` : '-';
    // A <ul> is transparent to numbering: an <ol> below it still follows the enclosing <ol>.
    renderListItem(li, label, sink, st, depth, ordered ? style : parentStyle);
    i++;
  }
}

function listStyle(ol, parentStyle, st) {
  const declared = (ol.getAttribute('class') || ol.getAttribute('outputclass') || '').trim();
  if (declared) {
    const mapped = LIST_STYLES[declared];
    if (!mapped) throw fail(`an <ol> with class="${declared}"`, st, 'as a list style');
    return mapped;
  }
  if (!parentStyle) {
    // Table notes are cited as "Note 1" … "Note 10" (47 numeric references in the corpus, and one
    // desc-note list runs to 13 items), so they are numbered, not lettered.
    return ol.parentNode?.nodeName === 'desc-note' ? 'numbered' : 'alpha';
  }
  const next = STYLE_SUCCESSOR[parentStyle];
  if (next) return next;
  st.warnings.push(`list-depth: no successor style for "${parentStyle}"; reusing it`);
  return parentStyle;
}

function renderListItem(li, label, sink, st, depth, ownStyle) {
  const indent = '  '.repeat(depth);
  const contIndent = '  '.repeat(depth + 1);
  let buf = '';
  let first = true;
  const flushText = () => {
    const s = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (!s) return;
    sink.line(first ? `${indent}${label} ${s}` : `${contIndent}${s}`);
    first = false;
  };

  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) { buf += c.data.replace(/\s+/g, ' '); continue; }
    if (c.nodeType !== 1) continue;
    if (INLINE_TAGS.has(c.nodeName)) { buf += renderInline(c, st); continue; }
    if (c.nodeName === 'p') {
      // The first <p> of an item with no text of its own IS the item; later ones (up to 6 in one
      // corpus item) each get their own line, indented under the label.
      flushText();
      buf = inlineChildren(c, st);
      flushText();
      continue;
    }
    if (c.nodeName === 'ol' || c.nodeName === 'ul') {
      flushText();
      if (first) { sink.line(`${indent}${label}`); first = false; }
      renderList(c, sink, st, depth + 1, ownStyle);
      continue;
    }
    if (!BLOCK_TAGS.has(c.nodeName)) throw fail(`<${c.nodeName}>`, st, 'inside a list item');
    flushText();
    if (first) { sink.line(`${indent}${label}`); first = false; }
    renderBlock(c, sink, st, depth);   // a table or figure inside an item becomes its own block
  }
  flushText();
  if (first) sink.line(`${indent}${label}`);   // never drop a label, even for an empty item
}

function listLabel(style, i) {
  switch (style) {
    case 'alpha': return alphaLabel(i);
    case 'upper-alpha': return alphaLabel(i).toUpperCase();
    case 'roman': return romanLabel(i);
    case 'upper-roman': return romanLabel(i).toUpperCase();
    case 'numbered': return String(i + 1);
    default: throw new Error(`normalize: unmapped list style ${style}`);
  }
}

function alphaLabel(i) {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function romanLabel(i) {
  let n = i + 1, s = '';
  for (const [v, sym] of ROMAN) while (n >= v) { s += sym; n -= v; }
  return s;
}

/* -- tables ----------------------------------------------------------------- */

function renderTableReference(node, sink, st, depth) {
  const { taken, rest } = partition(node, ['title', 'num']);
  // Only the plain element is counted: content-model-2025.md's unit table counts
  // `table-reference` and not `table-reference-variation` / `table-variation`, so counting those
  // too would inflate the parity column past the number it is checked against.
  if (node.nodeName === 'table-reference') st.tableRefs.push(node.parentNode?.nodeName ?? '(no parent)');
  if (node.nodeName !== 'table-reference') sink.block(`**${variationLabel(node)}**`);
  const num = designation(node, taken.num);
  const title = taken.title ? inlineChildren(taken.title, st) : '';
  // "Table B1P1a" is exactly how the corpus's own <a type="table-reference"> cites it, so a grep
  // on the citation lands on this heading.
  sink.block(`### ${['Table', num].filter(Boolean).join(' ')}${title ? ` — ${title}` : ''}`);
  for (const c of rest) renderBlock(c, sink, st, depth);
}

function renderTable(table, st) {
  const rows = [];
  collectRows(table, rows, st, false);
  if (!rows.length) return '';

  // Place every cell in the first free column, duplicating across colspan and reserving down
  // rowspan. Verified against all 651 corpus tables: the result is rectangular with no holes,
  // which is what makes "GFM with cells duplicated" the right call rather than a fallback.
  const grid = [];
  let irregular = 0;
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let col = 0;
    for (const cell of row.cells) {
      const { cs, rs, startCol } = spansOf(cell, row.cols, st);
      if (cs > 1 || rs > 1) irregular++;
      while (grid[r][col] !== undefined) col++;
      // CALS names an ABSOLUTE start column; the loop above computes the next free one. The two
      // agree in every entry of all four 2022 packages (measured: 0 disagreements in 1,337) — but
      // agreement by luck of the source is not agreement by construction, and a row that starts
      // part-way across (CALS permits it) would shift a numeric limit under the wrong heading with
      // nothing in the output to show for it. Asserted rather than assumed.
      if (startCol !== null && startCol !== col) {
        throw spanFail(
          `<${cell.nodeName} namest="${cell.getAttribute('namest')}"> names column ${startCol + 1} `
          + `but the row is filled only to column ${col} — a cell before it is missing, and placing `
          + 'this one at the next free column would shift the rest of the row', st,
        );
      }
      for (let dr = 0; dr < rs; dr++) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < cs; dc++) grid[r + dr][col + dc] = cell;
      }
      col += cs;
    }
  });

  const width = Math.max(...grid.map(r => r.length));
  if (!width) return '';
  // Render each cell element once. A spanning cell occupies several grid positions, and
  // re-rendering it would push its warnings (a flattened equation, say) once per position.
  const rendered = new Map();
  const textOf = cell => {
    if (!cell) return '';
    if (!rendered.has(cell)) rendered.set(cell, cellText(cell, st));
    return rendered.get(cell);
  };
  const text = grid.map(r => Array.from({ length: width }, (_, i) => textOf(r[i])));
  const headerRows = Math.max(1, rows.filter(r => r.inHead).length);
  if (irregular) {
    st.warnings.push(`table-irregular: ${irregular} spanning cell(s) duplicated to keep the GFM grid square`);
  }
  if (headerRows > 1) {
    // GFM has exactly one header row. Extra header rows become leading body rows: nothing is
    // invented and nothing is lost, which merging them into one row could not promise.
    st.warnings.push(`table-multirow-header: ${headerRows} header rows; rows 2+ render as body rows`);
  }

  const out = [`| ${text[0].join(' | ')} |`, `| ${text[0].map(() => '---').join(' | ')} |`];
  for (let i = 1; i < text.length; i++) out.push(`| ${text[i].join(' | ')} |`);
  return out.join('\n');
}

// Both table vocabularies land here. 2025 is HTML — table > thead|tbody > tr > td|th. 2022 is
// CALS — table > tgroup > colspec|thead|tbody > row > entry — with `tgroup` transparent between
// the table and its head/body, and `colspec` the column metadata `col`/`colgroup` are in 2025.
function collectRows(node, rows, st, inHead, cols = null) {
  for (const c of elementChildren(node)) {
    switch (c.nodeName) {
      // A tgroup's colspecs are what a CALS horizontal span NAMES, and colnames are scoped to
      // their own tgroup — so they are collected here and travel with the rows they describe,
      // rather than being looked up from the table (where a second tgroup would overwrite them).
      case 'tgroup': collectRows(c, rows, st, inHead, colsOf(c)); break;
      // Consumed by the `table` rule as the caption, before the grid is built. 4 corpus tables.
      case 'title': break;
      case 'thead': collectRows(c, rows, st, true, cols); break;
      case 'tbody': case 'tfoot': collectRows(c, rows, st, false, cols); break;
      case 'tr': case 'row': {
        const cells = [];
        for (const cell of elementChildren(c)) {
          if (!TABLE_CELL_TAGS.has(cell.nodeName)) throw fail(`<${cell.nodeName}>`, st, `inside <${c.nodeName}>`);
          cells.push(cell);
        }
        // A <tr> of <th> with no <thead> is still the header row.
        rows.push({ cells, cols, inHead: inHead || (!rows.length && cells.every(x => x.nodeName === 'th')) });
        break;
      }
      default:
        if (EMPTY_TABLE_METADATA.has(c.nodeName)) break;   // column metadata: always childless
        throw fail(`<${c.nodeName}>`, st, `inside <${node.nodeName}>`);
    }
  }
}

/**
 * `colname` -> zero-based column index, in colspec DOCUMENT ORDER.
 *
 * A colname is a key, not a number, and the corpus proves it: Table S1C2a's six colspecs are named
 * 001, 002, 006, 005, 004, 003 in that order, and its header spans `namest="002" nameend="003"` —
 * five columns by position, two if the names are read as numbers. The published table merges that
 * header across all five FRL columns, so position is the reading that matches the Code.
 *
 * Measured over all four 2022 packages: 2,715 tgroups / 12,688 colspecs, every one carrying both
 * `colname` and `colnum`; 767 tgroups have colnames out of ascending order; 8 have a `colnum`
 * sequence that does not start at 1 (one table — 4.2.15c — replicated per package), and none of
 * those 8 contains a span, so document order and colnum cannot disagree anywhere in this corpus.
 */
function colsOf(tgroup) {
  const cols = new Map();
  for (const c of elementChildren(tgroup)) {
    if (c.nodeName !== 'colspec') continue;
    const name = c.getAttribute('colname');
    if (name) cols.set(name, cols.size);
  }
  return cols;
}

/**
 * A cell's (colspan, rowspan) in EITHER table vocabulary, plus the column CALS says it starts at.
 *
 * 2025's HTML says `colspan`/`rowspan`; 2022's CALS says `nameend`/`namest` (two colspec NAMES,
 * so the width is a property of the tgroup, not of the cell) and `morerows` (the count of
 * ADDITIONAL rows, so rowspan is one more). Measured in the four 2022 packages: 2,620 `morerows`
 * and 1,337 `namest`/`nameend` pairs, no `spanspec` anywhere.
 *
 * Reading only the HTML spelling does not degrade — it MISPLACES. Every cell of a spanned-over row
 * shifts one column left, so Table C3D3 publishes Type B's 33 000 m3 volume limit under Type A,
 * with nothing in the output to show for it. Hence the throws: a span that cannot be resolved is
 * never approximated.
 *
 * `startCol` is returned rather than acted on here, because whether it is right depends on where
 * the row has got to — which only `renderTable` knows. Null when the cell names no start column.
 */
function spansOf(cell, cols, st) {
  const num = (attr, dflt) => {
    const raw = cell.getAttribute(attr);
    if (raw === null || raw === undefined || raw === '') return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw spanFail(`<${cell.nodeName} ${attr}="${raw}"> is not a whole number of rows`, st);
    }
    return n;
  };
  const colIndex = (attr) => {
    const name = cell.getAttribute(attr);
    if (!name) return null;
    const i = cols?.get(name);
    if (i === undefined) {
      throw spanFail(`<${cell.nodeName} ${attr}="${name}"> names no <colspec colname="${name}"> in its tgroup`, st);
    }
    return i;
  };

  // HTML first: the 2025 vocabulary, where both attributes are counts and are always present when
  // a cell spans. `spanOf`'s old tolerance of junk is kept for it — an HTML colspan is a hint.
  const html = attr => { const n = parseInt(cell.getAttribute(attr) ?? '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; };
  let cs = html('colspan');
  let rs = html('rowspan');

  // An entry may also carry a bare `colname`, which places it at ONE absolute column — the same
  // instruction as namest/nameend without a span, and one this renderer does not implement.
  // Measured: 0 entries carry it in any of the four packages, so refusing it costs nothing and
  // closes the misplacement hole from the other side rather than ignoring an attribute that moves
  // cells.
  if (cell.getAttribute('colname')) {
    throw spanFail(`<${cell.nodeName} colname="${cell.getAttribute('colname')}"> places a cell at an `
      + 'absolute column, which this renderer does not implement (measured: no entry in any package carries one)', st);
  }

  let startCol = null;
  if (cs === 1) {
    const st0 = colIndex('namest');
    const en = colIndex('nameend');
    if (st0 !== null && en !== null) {
      if (en < st0) throw spanFail(`<${cell.nodeName}> has nameend before namest`, st);
      cs = en - st0 + 1;
      startCol = st0;
    } else if (st0 !== null || en !== null) {
      throw spanFail(`<${cell.nodeName}> carries one of namest/nameend; they name a span together`, st);
    }
  }
  if (rs === 1) rs = num('morerows', 0) + 1;
  return { cs, rs, startCol };
}

/** A span that cannot be resolved gets its OWN error: `fail`'s "add it to the allowlist" advice is
 *  right for an unclassified element and wrong here — there is nothing to classify, and the cell
 *  must not be placed approximately. */
function spanFail(msg, st) {
  return new Error(
    `normalize: ${msg}, in ${unitLabel(st.unit)} — a table span is never approximated: a cell put `
    + 'in the wrong column publishes a numeric limit under the wrong heading, silently',
  );
}

function cellText(cell, st) {
  // Cells are inline-only in the corpus (a, sup, sub, strong, equation-inline). \n+ -> space is
  // required by the GFM row format; the pipe escape is defensive (measured: zero pipes in cells).
  return inlineChildren(cell, st).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/* -- figures ---------------------------------------------------------------- */

function renderImageReference(node, sink, st, depth) {
  // `img` is the 2025 element and `image` the 2022 one; `num` is an ATTRIBUTE in 2025 and a CHILD
  // ELEMENT in 2022, so both are taken here and `designation` picks whichever is present.
  const { taken, rest } = partition(node, ['title', 'num', 'img', 'image']);
  if (node.nodeName !== 'image-reference') sink.block(`**${variationLabel(node)}**`);
  const img = taken.img ?? taken.image;
  if (!img) throw fail('an <image-reference> with no <img>/<image> child', st, 'as a figure');
  const num = designation(node, taken.num);
  const title = taken.title ? inlineChildren(taken.title, st) : '';
  sink.block(figureLine(img, num, title, st));
  // 2022 §11: @longdescref is NOT a reference despite the DITA-conventional name — it holds the
  // figure's sub-part legend ("(a) quarter landings - 2 flights. (b) continuous stairway …").
  // A figure whose legend is dropped loses which panel is which.
  const legend = (img.getAttribute('longdescref') ?? '').replace(/\s+/g, ' ').trim();
  if (legend) sink.block(legend);
  for (const c of rest) renderBlock(c, sink, st, depth);
}

/**
 * The formats a markdown renderer actually draws from `![](…)`.
 *
 * An ALLOWLIST, not a denylist, and the direction is the point: an unrecognised format degrades to
 * a link, which always works, rather than to an image tag that may render as nothing. The corpus
 * ships 12 assets outside this set — 8 cover `.pdf` and 4 `.eps`, all in 2022.
 */
const INLINE_RENDERABLE = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

function figureLine(img, num, title, st) {
  // 2022's own `href` is a publishing-session path, an ERROR_IN_RESOLVING_URI string or a leaked
  // absolute Windows authoring path — never a filename. read-2022.mjs resolves the real Images/
  // name by its four name rules and writes it onto `src`, which is what both editions read.
  const src = (img.getAttribute('src') ?? '').trim();
  if (!src) throw fail(`an <${img.nodeName}> with no src attribute`, st, 'as a figure');
  st.figures.add(src);
  // "Figure A2G1" is the corpus's own citation form, so a clause citing the figure and the figure
  // itself both match one grep — acceptance test #4 holds by construction.
  const alt = `Figure${num ? ` ${num}` : ''}${title ? `: ${title}` : ''}`;
  // `![](…)` around a .pdf or .eps renders as NOTHING in every markdown renderer: the citing clause
  // silently loses its figure, while a CDN check still reports the URL live — the same invisible
  // failure one layer up. A link keeps the promise the image syntax was making. The caption is
  // unchanged, so one grep still reaches it, and the agent still gets the URL. Four of the twelve
  // are real clause figures rather than front matter (HP 7.4.4's valley gutter profile, plus the
  // NT wall-shading and SA eaves-encroachment variations).
  const dot = src.lastIndexOf('.');
  const bang = dot > 0 && INLINE_RENDERABLE.has(src.slice(dot).toLowerCase()) ? '!' : '';
  return `${bang}[${alt}](${figureUrl(src, st)})`;
}

/** A wrapper's number: the 2025 `@num` attribute or the 2022 `<num>` child element. */
function designation(node, numChild) {
  const attrNum = (node.getAttribute('num') ?? '').replace(/\s+/g, ' ').trim();
  if (attrNum) return attrNum;
  // `<num><placeholder outputclass="placeholder">[NUMBER]</placeholder></num>` is an authoring stub
  // on 8 cover-page figures, not a designation — read.mjs's `supersedesOf` guards `archive-num`
  // against the same element for the same reason. Without this the corpus ships
  // `![Figure [NUMBER]: Front Cover - Volume Two](…)`.
  if (!numChild || elementChildren(numChild).some(c => c.nodeName === 'placeholder')) return '';
  return (numChild.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function figureUrl(src, st) {
  // encodeURIComponent leaves ( and ) alone, and 4 corpus filenames contain them — unescaped they
  // close the markdown destination early. One filename contains spaces.
  const file = encodeURIComponent(src).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `${figureUrlPrefix(st)}/${file}`;
}

/* -- inline ----------------------------------------------------------------- */

function inlineChildren(node, st) {
  let out = '';
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) out += c.data.replace(/\s+/g, ' ');
    else if (c.nodeType === 1) out += renderInline(c, st);
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Same as inlineChildren but keeps edge whitespace, so "x <b>y</b> z" does not lose its spaces.
function inlineRun(node, st) {
  let out = '';
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) out += c.data.replace(/\s+/g, ' ');
    else if (c.nodeType === 1) out += renderInline(c, st);
  }
  return out;
}

function renderInline(node, st) {
  const tag = node.nodeName;
  switch (tag) {
    case 'a': case 'xref': return renderLink(node, st);

    case 'strong': case 'b': return mark(inlineRun(node, st), '**');
    case 'i': case 'em': return mark(inlineRun(node, st), '*');

    // Superscripts and subscripts render as text ("300 m2", "H2O"). A ^ or ~ marker would put a
    // character inside a phrase that a human never types.
    case 'sup': case 'sub': return inlineRun(node, st);

    case 'ins': return inlineRun(node, st);        // tracked insertion: it is the current text
    case 'signage': return inlineRun(node, st);    // literal sign wording, verbatim
    case 'glossterm': return inlineRun(node, st);  // reached only when not a unit's own identity

    case 'equation-inline': return renderEquation(node, st);

    default:
      if (MATHML_TAGS.has(tag)) return flattenMath(node, st);
      throw fail(`<${tag}>`, st, 'in an inline position');
  }
}

function mark(raw, marker) {
  const s = raw.replace(/\s+/g, ' ');
  const inner = s.trim();
  if (!inner) return s;
  return `${/^\s/.test(s) ? ' ' : ''}${marker}${inner}${marker}${/\s$/.test(s) ? ' ' : ''}`;
}

function renderLink(node, st) {
  const type = node.getAttribute('type') ?? '';
  const href = (node.getAttribute('href') ?? '').trim();
  const raw = inlineRun(node, st);
  const text = raw.trim();
  if (GLOSSARY_LINK_TYPES.has(type) && text) st.definedTerms.add(text);

  // Internal targets are UUID fragments that mean nothing outside the source XML, and the display
  // text ("A5G6", "Table B1P1a") is itself the greppable citation — so they inline as plain prose.
  // That is the whole point of this module. External URLs keep their link: the URL is real,
  // irrecoverable information, there are only 103 of them, and 22 sit in clause prose.
  if (!/^https?:\/\//i.test(href) || !text) return raw;
  const lead = /^\s/.test(raw) ? ' ' : '';
  const trail = /\s$/.test(raw) ? ' ' : '';
  return `${lead}[${text}](${href})${trail}`;
}

/* -- equations and MathML --------------------------------------------------- */

function renderEquation(node, st) {
  let out = '';
  for (const c of elementChildren(node)) {
    if (c.nodeName === 'mathML') out += flattenMath(c, st);
    // Every equation carries a raster fallback: 2025 writes <img src="">, 2022 writes <image
    // content-type="gif"> with the bitmap base64'd into the element's own text and no href at all
    // (230 in volume-one). Neither is a figure, and neither must become a CDN link.
    else if ((c.nodeName === 'img' || c.nodeName === 'image')
      && !(c.getAttribute('src') ?? '').trim() && !(c.getAttribute('href') ?? '').trim()) continue;
    else throw fail(`<${c.nodeName}>`, st, `inside <${node.nodeName}>`);
  }
  return out;
}

// MathML is flattened to a linear, greppable form rather than kept as markup: the corpus is read
// by grep, and neither raw MathML nor LaTeX is something an engineer types into a search box.
// The structure operators keep the formula unambiguous — a fraction stays a fraction.
function flattenMath(node, st) {
  const tag = node.nodeName;
  const kids = elementChildren(node);
  const parts = () => kids.map(k => flattenMath(k, st)).join('');
  const at = i => (kids[i] ? flattenMath(kids[i], st) : '');

  switch (tag) {
    case 'mathML': return parts();
    case 'math': {
      const s = parts();
      st.warnings.push(`mathml-flattened: ${s}`);
      return s;
    }
    // <semantics> holds one presentation child plus alternate encodings. The MathType-MTEF
    // <annotation> is ~500 characters of base64 per equation (518 of them, ~260 KB) encoding the
    // SAME expression — emitting it would bury the corpus in noise, so it is dropped by rule.
    case 'semantics': return kids.filter(k => k.nodeName !== 'annotation').map(k => flattenMath(k, st)).join('');
    case 'annotation': return '';
    case 'mrow': case 'mstyle': return parts();
    // A stacked pair of equations, not a matrix (measured: 8 tables, every one a single column —
    // B1V1's is `C_R = 1+V_R^2` over `C_S = 1+V_S^2`). Rows separated by `;` keeps them readable
    // on the one line this corpus renders a formula on, and distinguishable from each other.
    case 'mtable': return kids.map(k => flattenMath(k, st)).join('; ');
    case 'mtr': return kids.map(k => flattenMath(k, st)).join(', ');
    case 'mtd': return parts();
    case 'mi': case 'mn': case 'mo': case 'mtext': return (node.textContent ?? '').replace(/\s+/g, ' ').trim();

    case 'msub': return `${wrapMath(at(0))}_${wrapMath(at(1))}`;
    case 'msup': return `${wrapMath(at(0))}^${wrapMath(at(1))}`;
    case 'msubsup': return `${wrapMath(at(0))}_${wrapMath(at(1))}^${wrapMath(at(2))}`;
    case 'munderover': return `${wrapMath(at(0))}_${wrapMath(at(1))}^${wrapMath(at(2))}`;
    case 'mover': return `${at(0)}${at(1)}`;               // an accent follows its base: R¯
    case 'mfrac': return `${wrapMath(at(0))}/${wrapMath(at(1))}`;
    case 'msqrt': return `√${wrapMath(parts())}`;
    case 'mfenced': {
      const open = node.getAttribute('open') ?? '(';
      const close = node.getAttribute('close') ?? ')';
      const sep = node.getAttribute('separators') || ',';
      return `${open}${kids.map(k => flattenMath(k, st)).join(sep[0] ?? ',')}${close}`;
    }
    default: throw fail(`<${tag}>`, st, 'inside MathML');
  }
}

const wrapMath = s => (s.length > 1 ? `(${s})` : s);

/* -- helpers ---------------------------------------------------------------- */

function elementChildren(node) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c);
  return out;
}

// 2025 spells the jurisdiction `state`/`type`; 2022 spells the same two things
// `variation`/`variation-type` (§10). One label, both vocabularies.
function variationLabel(node) {
  const state = (node.getAttribute('state') || node.getAttribute('variation') || '').trim() || 'State';
  const type = (node.getAttribute('type') || node.getAttribute('variation-type') || '').trim();
  return `${state} variation${type ? ` (${type})` : ''}`;
}

function unitLabel(unit) {
  return `${unit?.kind ?? 'unit'} ${unit?.id ?? unit?.term ?? unit?.title ?? '(untitled)'}`;
}

function fail(what, st, where) {
  return new Error(
    `normalize: ${what} ${where}, in ${unitLabel(st.unit)} — classify it and add it to the `
    + 'allowlist in normalize.mjs with a comment saying what it is; never let content fall '
    + 'through silently',
  );
}
