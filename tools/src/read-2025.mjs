// read-2025.mjs — the NCC 2025 v1.2 walker.
//
// Turns one monolithic contents.xml into a flat, ordered list of RawUnits: a DOM element plus
// the context needed to name it, cite it and link it. Later stages render (Task 4) and name
// (Task 5) each unit; nothing downstream can recover a unit this walker fails to reach.
//
// Design rules, in priority order:
//  1. Recursion, not a container whitelist. Whitelists lose — the measured containment table in
//     docs/content-model-2025.md missed six parent categories while being written from the data.
//  2. Fail loud. Every element the walker reaches is classified by one of the sets below. An
//     element in none of them throws, naming the element and its path.
//  3. Prose is never walked into. A unit's subtree is handed over whole via `node`. Adding a
//     prose tag (p, ol, li, table, section, num, …) to a structural set would silence a throw by
//     stepping over content — the exact silent-loss failure this walker exists to prevent.
import { DOMParser } from '@xmldom/xmldom';

export const DOCUMENTS_2025 = [
  { key: 'volume-one', pkg: 'ncc-2025-volume-one-v1.2', cdnKey: 'volume1', citationPrefix: 'NCC 2025 V1', volumeLabel: 'Volume One' },
  { key: 'volume-two', pkg: 'ncc-2025-volume-two-v1.2', cdnKey: 'volume2', citationPrefix: 'NCC 2025 V2', volumeLabel: 'Volume Two' },
  { key: 'volume-three', pkg: 'ncc-2025-volume-three-v1.2', cdnKey: 'volume3', citationPrefix: 'NCC 2025 V3', volumeLabel: 'Volume Three' },
  { key: 'housing-provisions', pkg: 'ncc-2025-housing-provisions-v1.2', cdnKey: 'housing', citationPrefix: 'NCC 2025 HP', volumeLabel: 'Housing Provisions' },
  { key: 'livable-housing', pkg: 'ncc-2025-livable-housing-design-v1.2', cdnKey: 'livable_housing', citationPrefix: 'NCC 2025 LHD', volumeLabel: 'Livable Housing Design' },
];

/* ---------------------------------------------------------------------------
 * Element classification. Every element the walker can reach lands in exactly
 * one of these sets; counts in comments are volume-one unless stated.
 * ------------------------------------------------------------------------ */

// Document roots. ncc-volume for Volumes One-Three, ncc-standard for HP and LHD.
const ROOT_TAGS = new Set(['ncc-volume', 'ncc-standard']);

// Named containers: carry num/title/state into their descendants' context, and own the prose
// they hold in their own right (see OWN_PROSE_TAGS).
const CONTAINER_TAGS = new Set([
  'part',                          // 72 — every one carries an intro-part; 26 carry a state
  'part-variation',                // 13 — holds only <content>; the "does not apply in NSW" form
  'specification',                 // 45 — sibling of part, not a child of it
  'spec-topic',                    // 14 — has a title but no num; inherits the specification's
  'schedule-part',                 // 74 — jurisdiction index: title + <variation> pointers
  'schedule-spec',                 //  8 — same shape as schedule-part
  'schedule-part-variation',       // 39 — same, plus intro-part/callout references
  'schedule-referenced-document',  //  7 — title only; a pointer with a state
]);

// Grouping elements with no identity of their own: walked straight through, and any prose they
// hold belongs to the enclosing container's overview.
const TRANSPARENT_TAGS = new Set([
  'subtopic',      // 162 — the dominant clause container in Volumes One-Three; id + type only
  'ncc-glossary',  //   3 — Abbreviations / Symbols / Glossary blocks in schedule 1
]);

// Elements emitted as a unit of their own; their whole subtree is handed to the renderer.
const UNIT_TAGS = new Set([
  'clause',                // 894
  'clause-variation',      // 391 — 285 under subtopic, 103 nested in a clause, 3 under specification
  'standard-clause',       // LHD only (15); ncc-standard's clause element
  'glossentry',            // 493
  'glossentry-variation',  // 63 — 44 under ncc-glossary, 19 nested in a glossentry
]);
const PAGE_TAG = 'page';   // 26 — a standalone content page; a unit, subtree handed over whole

// A container's own prose. Never descended into: handed to that container's overview unit.
const OWN_PROSE_TAGS = new Set([
  'intro-part',  // 72 under part
  'content',     // 13 under part-variation
  'notice',      //  1 under specification ("deliberately left blank … does not apply in NSW")
  'callout',     // 13 under part, 6 under subtopic — explanatory boxes attached to the Part
]);

// Read for their text, never descended into, never emitted.
const METADATA_TAGS = new Set([
  'title',  // read via childTitle()
  'h2',     // spec-topic only; measured identical to its <title> in all 16 instances
]);

// Self-closing pointers into content that is emitted elsewhere. Verified: all 492 <variation>,
// 26 <intro-part-reference> and 2 <callout-reference> references resolve by id, and every
// target sits in a body section (A-J), not in the schedule that points at it.
const POINTER_TAGS = new Set(['variation', 'intro-part-reference', 'callout-reference']);

/**
 * Children of a unit's `node` that belong to some *other* unit and must be skipped when
 * rendering that unit's body (Task 4). Deliberately excludes `subclause-variation` (below unit
 * level, renders inline) and `subtopic` (transparent — descend to reach its callouts).
 */
export const BODY_SKIP_TAGS = new Set([...UNIT_TAGS, ...CONTAINER_TAGS, PAGE_TAG]);

/**
 * The prose a container holds in its own right, in document order — exactly what a
 * container-overview unit renders, and nothing else. Descends through transparent grouping
 * elements so a callout parked under a subtopic still belongs to its Part.
 */
export function overviewChildren(el) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (OWN_PROSE_TAGS.has(n.nodeName)) out.push(n);
    else if (TRANSPARENT_TAGS.has(n.nodeName)) out.push(...overviewChildren(n));
  }
  return out;
}

/**
 * @param {string} xmlString  contents.xml
 * @param {object} doc        one entry of DOCUMENTS_2025
 * @param {{sections?: string[]|null}} [opts]  slice mode: keep only these ncc-section nums
 * @returns {Array<object>} RawUnits in document order
 */
export function readDocument2025(xmlString, doc, { sections = null } = {}) {
  const dom = new DOMParser().parseFromString(xmlString, 'text/xml');
  if (!dom?.documentElement) {
    throw new Error(`read-2025 [${doc.key}]: contents.xml did not parse to a document element`);
  }
  const units = [];
  const ctx0 = {
    sectionNum: '', sectionType: null,
    containerKind: null, containerNum: null, containerTitle: null,
    state: null, overviewOwner: false,
  };
  walk(dom.documentElement, ctx0, []);
  return units;

  /* -- helpers ----------------------------------------------------------- */

  function text(n) { return (n.textContent ?? '').replace(/\s+/g, ' ').trim(); }

  function childTitle(el) { return childText(el, 'title'); }

  function childText(el, tag) {
    for (let n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 1 && n.nodeName === tag) return text(n);
    return '';
  }

  function hasElementChild(el) {
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) return true;
    return false;
  }

  function attr(el, name) {
    const v = el.getAttribute?.(name);
    return v === null || v === undefined || v === '' ? null : v;
  }

  function label(el) {
    const num = attr(el, 'num');
    return num ? `${el.nodeName}[${num}]` : el.nodeName;
  }

  function pickCtx(c) {
    return {
      sectionNum: c.sectionNum, sectionType: c.sectionType,
      containerKind: c.containerKind, containerNum: c.containerNum, containerTitle: c.containerTitle,
    };
  }

  function failLoud(msg, path) {
    throw new Error(`read-2025 [${doc.key}]: ${msg} — at ${path.join('/')}`);
  }

  function descend(el, ctx, path) {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1) walk(n, ctx, path);
      // Structural elements are not mixed content (measured: 0 stray text nodes in all five
      // documents). Text here would be prose the walker steps over without a sound.
      else if (n.nodeType === 3 && (n.data ?? '').trim()) {
        failLoud(`text directly under <${el.nodeName}>: ${JSON.stringify(n.data.trim().slice(0, 60))}`, path);
      }
    }
  }

  /* -- emitters ---------------------------------------------------------- */

  function push(u) { units.push(u); }

  function emitClause(el, ctx) {
    push({
      edition: '2025', volume: doc.key, kind: 'clause',
      // <clause> carries <sptc> as a child, <clause-variation> as an attribute. Null, never ''.
      id: attr(el, 'sptc') ?? (childText(el, 'sptc') || null),
      term: null,
      title: childTitle(el),
      state: attr(el, 'state') ?? ctx.state ?? null,
      supersedes: childText(el, 'archive-num') || null,
      buildingClasses: attr(el, 'building'),
      ...pickCtx(ctx), node: el,
    });
  }

  function emitGlossary(el, ctx, path) {
    // Measured: 493 glossentry > glossterm, 0 glossentry > title. The term is never a <title>.
    const term = childText(el, 'glossterm');
    if (!term) failLoud('glossary entry with no <glossterm> to name it', path);
    push({
      edition: '2025', volume: doc.key, kind: 'glossary',
      id: null, term, title: term,
      state: attr(el, 'state') ?? ctx.state ?? null,
      supersedes: null, buildingClasses: null,
      ...pickCtx(ctx), node: el,
    });
  }

  function emitPage(el, ctx) {
    push({
      edition: '2025', volume: doc.key, kind: 'page',
      id: null, term: null,
      title: childTitle(el),
      // Own attribute first: no v1.2 page carries one, but reading only the inherited state
      // would silently drop it the day one does.
      state: attr(el, 'state') ?? ctx.state ?? null,
      supersedes: null, buildingClasses: null,
      ...pickCtx(ctx), node: el,
    });
  }

  // A container's own prose gets its own file, keyed by container + state. Without it, the
  // state-specific overview of a Part is written onto the national Part's filename and lost.
  function emitOverview(el, ctx) {
    push({
      edition: '2025', volume: doc.key, kind: 'page',
      id: null, term: null,
      title: ctx.containerTitle ?? '',
      state: ctx.state ?? null,
      supersedes: null, buildingClasses: null,
      ...pickCtx(ctx), node: el,
    });
  }

  /* -- the walk ---------------------------------------------------------- */

  function walk(el, ctx, parentPath) {
    const tag = el.nodeName;
    const path = parentPath.concat(label(el));

    if (ROOT_TAGS.has(tag)) return descend(el, ctx, path);

    if (tag === 'ncc-section') {
      const num = el.getAttribute('num') ?? '';
      // Slice mode filters on num alone: schedules 1-11 are as filterable as sections A-J, and
      // a section with an empty num (front matter) is always kept.
      if (sections && num !== '' && !sections.includes(num)) return;
      const next = {
        ...ctx,
        sectionNum: num,
        sectionType: el.getAttribute('type') ?? null,
        containerKind: null, containerNum: null, containerTitle: null,
        // Jurisdiction schedules carry their state here (num 4 = ACT, 5 = NSW, …) and it must
        // reach the pages below them, or eight jurisdictions collide on one filename.
        state: attr(el, 'state') ?? ctx.state ?? null,
        overviewOwner: false,
      };
      if (overviewChildren(el).length) {
        const own = { ...next, containerKind: tag, containerNum: num || null, containerTitle: childTitle(el) };
        emitOverview(el, own);
        next.overviewOwner = true;
      }
      return descend(el, next, path);
    }

    if (CONTAINER_TAGS.has(tag)) {
      const next = {
        ...ctx,
        containerKind: tag,
        // spec-topic and schedule-referenced-document have no num of their own; keeping the
        // enclosing container's means a clause under a spec-topic still cites its Specification.
        containerNum: attr(el, 'num') ?? ctx.containerNum,
        // part-variation carries no title; the Part it varies supplies it.
        containerTitle: childTitle(el) || ctx.containerTitle,
        state: attr(el, 'state') ?? ctx.state ?? null,
        overviewOwner: false,
      };
      if (overviewChildren(el).length) { emitOverview(el, next); next.overviewOwner = true; }
      return descend(el, next, path);
    }

    if (TRANSPARENT_TAGS.has(tag)) return descend(el, ctx, path);

    if (tag === PAGE_TAG) { emitPage(el, ctx); return; } // subtree belongs to the page

    if (UNIT_TAGS.has(tag)) {
      if (tag.startsWith('gloss')) emitGlossary(el, ctx, path); else emitClause(el, ctx);
      // A unit may nest another unit: 103 clause > clause-variation, 19 glossentry >
      // glossentry-variation in volume-one. Both are emitted; both point into the same tree,
      // and the renderer skips BODY_SKIP_TAGS children when rendering either body.
      const inherited = { ...ctx, state: attr(el, 'state') ?? ctx.state ?? null };
      for (let n = el.firstChild; n; n = n.nextSibling)
        if (n.nodeType === 1 && UNIT_TAGS.has(n.nodeName)) walk(n, inherited, path);
      return;
    }

    if (OWN_PROSE_TAGS.has(tag)) {
      // Reached only outside a unit, i.e. as a container's own prose. If no container claimed
      // it, emitting nothing here would drop the text without a sound.
      if (!ctx.overviewOwner) failLoud(`<${tag}> holds prose but no container owns it`, path);
      return;
    }

    if (METADATA_TAGS.has(tag)) return;

    if (POINTER_TAGS.has(tag)) {
      // Verified empty in v1.2. A populated one would be content this walker never emitted.
      if (hasElementChild(el)) failLoud(`<${tag}> pointer has element children — unmodelled shape`, path);
      return;
    }

    failLoud(
      `unknown element <${tag}> — classify it (container / transparent / unit / own-prose / ` +
      'metadata / pointer); never add a prose tag to a structural set',
      path,
    );
  }
}
