// weblinks.test.mjs — the keying rule, and the ways it can be WRONG rather than missing.
//
// A wrong web_url is worse than a missing one: it is a citation an agent will follow, read, and
// report as verified. Every test below either pins a resolution that is right, or pins a null
// where the data does not justify a guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildLinkIndex, resolveWebUrl } from '../src/weblinks.mjs';

const B = 'https://ncc.abcb.gov.au/editions/ncc-2025/adopted';

/* ---------------------------------------------------------------------------
 * The brief's binding fixture — measured traps in four URLs.
 * ------------------------------------------------------------------------ */

const urls = [
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/part-a5-documentation-of-design-and-construction',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/a-governing-requirements/1-fire-resistance-building-elements',
  'https://ncc.abcb.gov.au/editions/ncc-2025/adopted/housing-provisions/5-new-south-wales/31-scope-and-application-section-3',
];

test('keys are per-section — specification "1" and part "a5" both resolve', () => {
  const idx = buildLinkIndex(urls);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' }, idx), urls[1]);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-one', sectionNum: 'A', containerKind: 'specification', containerNum: '1' }, idx), urls[2]);
});

test('unresolved returns null, never throws', () => {
  const idx = buildLinkIndex(urls);
  assert.equal(resolveWebUrl({ edition: '2025', volume: 'volume-two', sectionNum: 'B', containerKind: 'part', containerNum: 'B9' }, idx), null);
});

/* ---------------------------------------------------------------------------
 * Token normalisation (R6) — both key tokens lowercased, non-alphanumerics stripped.
 * ------------------------------------------------------------------------ */

test('R6: key tokens are lowercased and stripped of non-alphanumerics', () => {
  const idx = buildLinkIndex([`${B}/volume-one/a-governing-requirements/part-a5-documentation-design-and-construction`]);
  assert.deepEqual([...idx.keys()], ['volume-one|a|a5']);
});

test('a decimal container num loses its dot, exactly as the site slug does', () => {
  // Housing Provisions Part 11.2 is `part-112-…` on the site (measured 2026-08-14).
  const u = `${B}/housing-provisions/11-safe-movement-and-access/part-112-stairway-and-ramp-construction`;
  const idx = buildLinkIndex([u]);
  assert.equal(idx.get('housing-provisions|11|112'), u);
  assert.equal(resolveWebUrl({ volume: 'housing-provisions', sectionNum: '11', containerKind: 'part', containerNum: '11.2' }, idx), u);
});

test('a container num that repeats its own kind word still resolves', () => {
  // Volume Two carries one <part num="Part H9"> against 104 plain nums.
  const u = `${B}/volume-two/h-class-1-and-class-10-buildings/part-h9-safe-movement-and-access`;
  const idx = buildLinkIndex([u]);
  assert.equal(resolveWebUrl({ volume: 'volume-two', sectionNum: 'H', containerKind: 'part', containerNum: 'Part H9' }, idx), u);
});

test('the `part-` and jurisdiction prefixes appear in BOTH orders on the live site', () => {
  // Measured: `/h-class-1-and-10-buildings/part-h1-structure` but `/8-south-australia/sa-part-h9`.
  // Stripping in one fixed order keys the SA page under lead `part` and loses it.
  const idx = buildLinkIndex([
    `${B}/volume-two/8-south-australia/sa-part-h9`,
    `${B}/volume-two/8-south-australia/sa-h1-structure`,
  ]);
  assert.deepEqual([...idx.keys()].sort(), ['volume-two|state:sa|h1', 'volume-two|state:sa|h9']);
  const unit = { volume: 'volume-two', sectionNum: 'H', containerKind: 'part', containerNum: 'Part H9', state: 'SA' };
  assert.equal(resolveWebUrl(unit, idx), `${B}/volume-two/8-south-australia/sa-part-h9`);
});

/* ---------------------------------------------------------------------------
 * Scope. The middle key field is a SECTION token for national pages and a
 * `state:` token for jurisdiction-schedule pages, because a jurisdiction page's
 * own section number (schedule 5 = NSW) is not recoverable from a unit: the XML
 * files every state variation under the BODY section it varies.
 * ------------------------------------------------------------------------ */

test('a jurisdiction page is keyed by its state, not by its schedule number', () => {
  const u = `${B}/volume-one/5-new-south-wales/nsw-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([u]);
  assert.deepEqual([...idx.keys()], ['volume-one|state:nsw|a5']);
});

test('the state comes from the SECTION NAME when the slug carries no prefix (the 2022 form)', () => {
  // Measured 2026-08-14: 2025 writes `/5-new-south-wales/nsw-a6-building-classification`, but
  // 2022 writes `/5-new-south-wales/a6-building-classification` for the same page. Keying only
  // off the slug prefix would send every 2022 state variation to the NATIONAL Part page — a
  // page that does not contain the variation, i.e. a wrong citation for hundreds of units.
  const u = `${B}/volume-one/5-new-south-wales/a6-building-classification`;
  const idx = buildLinkIndex([u]);
  assert.deepEqual([...idx.keys()], ['volume-one|state:nsw|a6']);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A6', state: 'NSW' };
  assert.equal(resolveWebUrl(unit, idx), u);
});

test('only a section actually NAMED for a jurisdiction confers a state scope', () => {
  const idx = buildLinkIndex([
    `${B}/housing-provisions/5-masonry/part-52-masonry-units`,            // body section
    `${B}/volume-one/3-commonwealth-australia/a6-building-classification`, // not a state
  ]);
  assert.deepEqual([...idx.keys()].sort(), ['housing-provisions|5|52', 'volume-one|3|a6']);
});

test('a jurisdiction SECTION page keeps its section scope', () => {
  // Deliberate: state-scoping the section page too would resolve a WA schedule page and the
  // body section of the same number to each other's URLs, and a glossary variation (Schedule 1,
  // state NSW) to the NSW schedule instead of Definitions.
  const idx = buildLinkIndex([`${B}/volume-one/5-new-south-wales`]);
  assert.deepEqual([...idx.keys()], ['volume-one|5|']);
});

test('a state-varied clause resolves to the STATE page, not the national one', () => {
  const nat = `${B}/volume-one/a-governing-requirements/part-a5-documentation-design-and-construction`;
  const nsw = `${B}/volume-one/5-new-south-wales/nsw-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([nat, nsw]);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', state: 'NSW' };
  assert.equal(resolveWebUrl(unit, idx), nsw);
  // …and the national unit is never captured by the state page.
  assert.equal(resolveWebUrl({ ...unit, state: null }, idx), nat);
});

test('a state-varied clause with no state page falls back to the national container page', () => {
  const nat = `${B}/volume-one/a-governing-requirements/part-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([nat]);
  const got = resolveWebUrl({ volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', state: 'VIC' }, idx);
  assert.equal(got, nat);
});

test('a jurisdiction page never answers for a different state', () => {
  const nsw = `${B}/volume-one/5-new-south-wales/nsw-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([nsw]);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' };
  assert.equal(resolveWebUrl({ ...unit, state: 'NSW' }, idx), nsw);   // the page IS reachable…
  assert.equal(resolveWebUrl({ ...unit, state: 'VIC' }, idx), null);  // …but only by its own state
  assert.equal(resolveWebUrl({ ...unit, state: null }, idx), null);   // and never by a national unit
});

/* ---------------------------------------------------------------------------
 * Anchors. Measured on three page shapes (volume part, specification, HP part):
 * the clause designation IS the heading's HTML id. Jurisdiction pages carry no
 * such ids, so no fragment is appended there.
 * ------------------------------------------------------------------------ */

test('a clause unit lands on its own anchor; a page/glossary unit does not', () => {
  const nat = `${B}/volume-one/a-governing-requirements/part-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([nat]);
  const base = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' };
  assert.equal(resolveWebUrl({ ...base, kind: 'clause', id: 'A5G7' }, idx), `${nat}#A5G7`);
  assert.equal(resolveWebUrl({ ...base, kind: 'page', title: 'Documentation' }, idx), nat);
  assert.equal(resolveWebUrl({ ...base, kind: 'clause', id: null }, idx), nat);
});

test('a decimal clause id keeps its dots in the fragment', () => {
  const u = `${B}/housing-provisions/11-safe-movement-and-access/part-112-stairway-and-ramp-construction`;
  const idx = buildLinkIndex([u]);
  const got = resolveWebUrl({ volume: 'housing-provisions', sectionNum: '11', containerKind: 'part', containerNum: '11.2', kind: 'clause', id: '11.2.2' }, idx);
  assert.equal(got, `${u}#11.2.2`);
});

test('a fragment is percent-encoded, never +-encoded', () => {
  const u = `${B}/volume-one/a-governing-requirements/part-a5-x`;
  const idx = buildLinkIndex([u]);
  const base = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', kind: 'clause' };
  // `+` means a literal plus in a fragment, so a space must stay %20 or the anchor names nothing.
  assert.equal(resolveWebUrl({ ...base, id: 'A5 G7' }, idx), `${u}#A5%20G7`);
  assert.equal(resolveWebUrl({ ...base, id: 'A5#G7' }, idx), `${u}#A5%23G7`);
});

test('no fragment on a jurisdiction page — measured: it carries no clause anchors', () => {
  const nsw = `${B}/volume-one/5-new-south-wales/nsw-a5-documentation-design-and-construction`;
  const idx = buildLinkIndex([nsw]);
  const got = resolveWebUrl({ volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', state: 'NSW', kind: 'clause', id: 'A5G3' }, idx);
  assert.equal(got, nsw);
});

/* ---------------------------------------------------------------------------
 * No container → the section page. WITH a container that has no page → null.
 * ------------------------------------------------------------------------ */

test('a unit with no container resolves to its section page', () => {
  const sec = `${B}/volume-one/1-definitions`;
  const idx = buildLinkIndex([sec, `${B}/volume-one/1-definitions/glossary`]);
  const got = resolveWebUrl({ volume: 'volume-one', sectionNum: '1', sectionType: 'schedule', kind: 'glossary', term: 'Fire source feature', containerNum: null }, idx);
  assert.equal(got, sec);
});

test('a unit WITH a container whose page is missing does NOT fall back to the section page', () => {
  // The section page is a table of contents; it does not contain the clause. A URL that opens
  // the right section but not the cited provision is a wrong citation, not a partial one.
  const sec = `${B}/volume-one/a-governing-requirements`;
  const part = `${sec}/part-a5-documentation-design-and-construction`;
  const clause = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', kind: 'clause', id: 'A5G7' };
  assert.equal(resolveWebUrl(clause, buildLinkIndex([sec])), null);
  // The section page IS in the index and IS reachable — by a unit that has no container.
  const idx = buildLinkIndex([sec, part]);
  assert.equal(resolveWebUrl({ ...clause, containerKind: null, containerNum: null, kind: 'page', id: null }, idx), sec);
  // …and the same clause resolves the moment its own container page exists.
  assert.equal(resolveWebUrl(clause, idx), `${part}#A5G7`);
});

/* ---------------------------------------------------------------------------
 * A document whose single section has no num (Livable Housing Design).
 * ------------------------------------------------------------------------ */

test('an empty sectionNum resolves by a leadTok that is unique within the volume', () => {
  const u = `${B}/livable-housing/livable-housing-design/part-1-dwelling-access`;
  const idx = buildLinkIndex([`${B}/livable-housing`, `${B}/livable-housing/livable-housing-design`, u]);
  const got = resolveWebUrl({ volume: 'livable-housing', sectionNum: '', containerKind: 'part', containerNum: '1', kind: 'clause', id: '1.1' }, idx);
  assert.equal(got, `${u}#1.1`);
});

test('an empty sectionNum does NOT guess when the leadTok is ambiguous within the volume', () => {
  const a = `${B}/volume-one/a-governing-requirements/1-fire-resistance-building-elements`;
  const b = `${B}/volume-one/c-fire-resistance/1-something-else`;
  const c = `${B}/volume-one/c-fire-resistance/2-only-one-of-these`;
  const idx = buildLinkIndex([a, b, c]);
  const unit = { volume: 'volume-one', sectionNum: '', containerKind: 'specification' };
  assert.equal(resolveWebUrl({ ...unit, containerNum: '1' }, idx), null);  // two candidates → no guess
  assert.equal(resolveWebUrl({ ...unit, containerNum: '2' }, idx), c);     // one candidate → resolved
  // A KNOWN section still wins outright — the unscoped path is only for an absent section.
  assert.equal(resolveWebUrl({ ...unit, sectionNum: 'A', containerNum: '1' }, idx), a);
});

/* ---------------------------------------------------------------------------
 * Collisions. Two URLs claiming one key are never silently resolved by insertion
 * order; the slug-tokens-⊆-title check decides, or nothing does.
 * ------------------------------------------------------------------------ */

// The container-level collision below is synthetic: no real container key is contested in
// either edition's crawl (measured — all 16 real collisions are section-level or front matter).
// The shape is real, though: the site writes both `part-a5-…` and bare `a5-…` container slugs,
// so two pages in one section CAN claim one key.
const COLL_A = `${B}/volume-one/a-governing-requirements/part-a5-documentation-design-and-construction`;
const COLL_B = `${B}/volume-one/a-governing-requirements/a5-something-quite-different`;

test('a colliding key is not in the primary map — it is recorded for the tiebreak', () => {
  const idx = buildLinkIndex([COLL_A, COLL_B]);
  assert.equal(idx.get('volume-one|a|a5'), undefined);
  assert.deepEqual(idx.collisions.get('volume-one|a|a5'), [COLL_A, COLL_B].sort());
});

test('the slug-tokens-⊆-title tiebreak picks the URL the title corroborates', () => {
  const idx = buildLinkIndex([COLL_A, COLL_B]);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' };
  assert.equal(resolveWebUrl({ ...unit, containerTitle: 'Documentation of design and construction' }, idx), COLL_A);
  assert.equal(resolveWebUrl({ ...unit, containerTitle: 'Something quite different' }, idx), COLL_B);
});

test('a collision with no title evidence resolves to null, never to the first URL', () => {
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' };
  for (const list of [[COLL_A, COLL_B], [COLL_B, COLL_A]]) {   // insertion order must not decide
    const idx = buildLinkIndex(list);
    assert.equal(resolveWebUrl(unit, idx), null);                                          // no title at all
    assert.equal(resolveWebUrl({ ...unit, containerTitle: 'Fire safety' }, idx), null);     // no candidate matches
    assert.equal(resolveWebUrl({ ...unit, containerTitle: 'Documentation of design and construction' }, idx), COLL_A);
  }
});

test('a collision where BOTH candidates fit the title resolves to null', () => {
  const a = `${B}/volume-one/a-governing-requirements/part-a5-documentation`;
  const b = `${B}/volume-one/a-governing-requirements/a5-construction`;
  const idx = buildLinkIndex([a, b]);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5', containerTitle: 'Documentation of design and construction' };
  assert.equal(resolveWebUrl(unit, idx), null);
  // A title that fits exactly one of them still resolves — the rule is "exactly one", not "none".
  assert.equal(resolveWebUrl({ ...unit, containerTitle: 'Documentation' }, idx), a);
});

test('a state variation published at two URLs prefers the jurisdiction schedule', () => {
  // Measured 2026-08-14 on NCC 2022: the same varied Part is served under the jurisdiction
  // schedule (`/10-victoria/i4-…`) AND under the body section (`/i-special-use-buildings/
  // vic-part-i4-…`). Both return 200 with an IDENTICAL clause set — they are aliases, not an
  // ambiguity, so dropping both would turn two correct URLs into a missing one. The schedule
  // placement wins because it is the one NCC 2025 uses uniformly, so both editions cite alike.
  const schedule = `${B}/volume-one/10-victoria/i4-class-3-and-9a-buildings`;
  const bodySection = `${B}/volume-one/i-special-use-buildings/vic-part-i4-class-3-and-9a-buildings`;
  for (const list of [[schedule, bodySection], [bodySection, schedule]]) {
    const idx = buildLinkIndex(list);
    assert.equal(idx.get('volume-one|state:vic|i4'), schedule);
    assert.equal(idx.collisions.size, 0);
  }
  // Two pages of the SAME rank remain a genuine collision.
  const other = `${B}/volume-one/10-victoria/i4-something-else`;
  assert.equal(buildLinkIndex([schedule, other]).collisions.size, 1);
});

test('a contested SECTION key is decided by the unit title — the real Housing Provisions case', () => {
  // Measured, both editions: HP numbers its body sections 2–13 and its schedules 1–11, so
  // `housing-provisions|2|` is claimed by Section 2 Structure AND Schedule 2 Referenced
  // documents. Letting either win silently would cite a jurisdiction schedule for a body clause.
  const body = `${B}/housing-provisions/2-structure`;
  const sched = `${B}/housing-provisions/2-referenced-documents`;
  const idx = buildLinkIndex([body, sched]);
  assert.equal(idx.get('housing-provisions|2|'), undefined);
  const unit = { volume: 'housing-provisions', sectionNum: '2', kind: 'page', containerNum: null };
  assert.equal(resolveWebUrl({ ...unit, title: 'Referenced documents' }, idx), sched);
  assert.equal(resolveWebUrl({ ...unit, title: 'Structure' }, idx), body);
  assert.equal(resolveWebUrl({ ...unit, title: 'Something else entirely' }, idx), null);
});

test('slug tokens are a SUBSET of the title, not an equality — the site drops stopwords', () => {
  const a = `${B}/volume-one/a-governing-requirements/part-a1-interpreting-ncc`;
  const b = `${B}/volume-one/5-new-south-wales/a1-something-quite-different`;
  const idx = buildLinkIndex([a, b].map(u => u.replace('/5-new-south-wales/', '/a-governing-requirements/')));
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A1', containerTitle: 'Interpreting the NCC' };
  assert.equal(resolveWebUrl(unit, idx), a);
});

/* ---------------------------------------------------------------------------
 * Fail-loud on caller bugs; never throw on unit data.
 * ------------------------------------------------------------------------ */

test('an index never answers for a different edition', () => {
  // Both editions publish the SAME slugs, so handing the 2022 index to 2025 units would cite a
  // 2022 page for every 2025 clause — 4770 wrong citations, all of which resolve and look right.
  const idx = buildLinkIndex(['https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/a-governing-requirements/part-a5-x']);
  const unit = { volume: 'volume-one', sectionNum: 'A', containerKind: 'part', containerNum: 'A5' };
  assert.equal(resolveWebUrl({ ...unit, edition: '2022' }, idx), 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/a-governing-requirements/part-a5-x');
  assert.equal(resolveWebUrl({ ...unit, edition: '2025' }, idx), null);
  assert.equal(resolveWebUrl({ ...unit, edition: 2022 }, idx), 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/a-governing-requirements/part-a5-x');
});

test('buildLinkIndex throws on a mixed-edition list — one index per edition', () => {
  assert.throws(
    () => buildLinkIndex([`${B}/volume-one`, 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one']),
    /edition/i,
  );
});

test('buildLinkIndex throws on a URL that is not an adopted-edition page', () => {
  assert.throws(() => buildLinkIndex(['https://example.com/whatever']), /weblinks/);
  assert.throws(() => buildLinkIndex([`${B.replace('/adopted', '/draft')}/volume-one`]), /weblinks/);
});

test('buildLinkIndex is order-independent and idempotent', () => {
  const list = [
    `${B}/volume-one/a-governing-requirements`,
    `${B}/volume-one/a-governing-requirements/part-a5-x`,
    `${B}/volume-one/a-governing-requirements/1-y`,
  ];
  const a = buildLinkIndex(list);
  const b = buildLinkIndex([...list].reverse());
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  // Pinned, not merely self-consistent: a stub that keys by URL is also order-independent.
  assert.deepEqual([...a.keys()].sort(), ['volume-one|a|', 'volume-one|a|1', 'volume-one|a|a5']);
});

test('resolveWebUrl never throws on junk units', () => {
  const idx = buildLinkIndex(urls);
  for (const u of [null, undefined, {}, { volume: 'nope' }, { volume: 'volume-one', sectionNum: null, containerNum: {} }, 'x', 42]) {
    assert.doesNotThrow(() => resolveWebUrl(u, idx));
    assert.equal(resolveWebUrl(u, idx), null);
  }
});

test('resolveWebUrl tolerates an empty index', () => {
  assert.equal(resolveWebUrl({ volume: 'volume-one', sectionNum: 'A', containerNum: 'A5' }, buildLinkIndex([])), null);
});

test('a volume root and a depth-3 page are collected but not keyed as containers', () => {
  const idx = buildLinkIndex([
    `${B}/volume-one`,
    `${B}/volume-one/preface/copyright-licence-notice-and-acknowledgment-country`,
  ]);
  assert.equal([...idx.keys()].includes('volume-one||'), false);
  assert.equal(idx.get('volume-one|preface|copyright'), `${B}/volume-one/preface/copyright-licence-notice-and-acknowledgment-country`);
});

test('a trailing slash and a duplicate URL do not create phantom keys', () => {
  const u = `${B}/volume-one/a-governing-requirements/part-a5-x`;
  const idx = buildLinkIndex([u, `${u}/`, u]);
  assert.equal(idx.get('volume-one|a|a5'), u);
  assert.equal(idx.collisions.size, 0);
});

/* ---------------------------------------------------------------------------
 * Corpus integration — auto-skips when the crawled data or .cache is absent.
 * Exact rates, measured 2026-08-14, with a non-vacuity floor.
 * ------------------------------------------------------------------------ */

const DATA_2025 = 'tools/data/weblinks-2025.json';
const DATA_2022 = 'tools/data/weblinks-2022.json';
const haveCache = fs.existsSync('.cache/extracted/ncc-2025-volume-one-v1.2/contents.xml');

test('corpus: every 2025 clause unit resolves, and the rates are exactly as measured', { skip: !(fs.existsSync(DATA_2025) && haveCache) && 'no weblinks-2025.json or no .cache' }, async () => {
  const { readDocument2025, DOCUMENTS_2025 } = await import('../src/read-2025.mjs');
  const idx = buildLinkIndex(JSON.parse(fs.readFileSync(DATA_2025, 'utf8')));

  const byDoc = new Map();
  const byKind = new Map();
  let total = 0;
  const stateWithContainer = { schedulePage: 0, elsewhere: 0, unresolved: 0 };
  let fragments = 0;
  for (const doc of DOCUMENTS_2025) {
    const xml = fs.readFileSync(path.join('.cache/extracted', doc.pkg, 'contents.xml'), 'utf8');
    for (const unit of readDocument2025(xml, doc)) {
      const got = resolveWebUrl(unit, idx);
      total++;
      const d = byDoc.get(doc.key) ?? { n: 0, ok: 0 };
      d.n++; if (got) d.ok++; byDoc.set(doc.key, d);
      const k = byKind.get(unit.kind) ?? { n: 0, ok: 0 };
      k.n++; if (got) k.ok++; byKind.set(unit.kind, k);
      if (unit.state && unit.containerNum) {
        if (!got) stateWithContainer.unresolved++;
        else if (new RegExp(`/${unit.volume}/\\d+-[a-z-]+/${unit.state.toLowerCase()}-`).test(got)) stateWithContainer.schedulePage++;
        else stateWithContainer.elsewhere++;
      }
      if (unit.kind === 'clause' && got?.includes('#')) fragments++;
    }
  }

  assert.equal(total, 4770, 'unit count drifted from Task 5s measured corpus');
  // Non-vacuity: a real crawl, not a stub, and a real corpus, not an empty walk.
  assert.ok(idx.size > 400, `link index too small to be a real crawl: ${idx.size}`);
  assert.equal(idx.size, 608);
  assert.equal(idx.collisions.size, 16);

  // CLAUSES: 100%, every document, no exemption. Livable Housing Design resolves too — its site
  // slug is /livable-housing, and only the /livable-housing-design spelling 404s.
  const clause = byKind.get('clause');
  assert.deepEqual([clause.n, clause.ok], [2312, 2312], 'clause units must reach 100%');
  const glossary = byKind.get('glossary');
  assert.deepEqual([glossary.n, glossary.ok], [2224, 2224], 'glossary resolves to its section page');
  const page = byKind.get('page');
  assert.deepEqual([page.n, page.ok], [234, 209], 'page units are best-effort');

  assert.deepEqual(
    [...byDoc].map(([k, v]) => `${k} ${v.ok}/${v.n}`).sort(),
    [
      'housing-provisions 912/916',
      'livable-housing 15/18',
      'volume-one 1947/1953',
      'volume-three 1000/1006',
      'volume-two 871/877',
    ],
  );

  // Every state-varied unit that HAS a container lands on that state's own schedule page — not
  // on the national Part page, which does not carry the variation's text.
  assert.deepEqual(stateWithContainer, { schedulePage: 735, elsewhere: 0, unresolved: 0 });
  // Clause fragments: present on national container pages, absent on jurisdiction pages (which
  // carry no clause anchors). Both populations are non-trivial.
  assert.equal(fragments, 1652);
});

test('corpus: the 2022 link index has the shape the keying expects', { skip: !fs.existsSync(DATA_2022) && 'no weblinks-2022.json' }, () => {
  // Task 10 builds the 2022 reader; until then this is what can be verified — that the same
  // keying produces the same SHAPE of index for 2022, so the 2022 corpus will not discover a
  // different URL scheme after the fact.
  const idx = buildLinkIndex(JSON.parse(fs.readFileSync(DATA_2022, 'utf8')));
  assert.ok(idx.size > 400, `2022 link index too small: ${idx.size}`);
  assert.equal(idx.size, 572);

  const keys = [...idx.keys()];
  assert.ok(keys.some(k => /^volume-one\|a\|a\d+$/.test(k)), 'no volume-one Part keys');
  assert.ok(keys.some(k => /^volume-one\|[a-j]\|\d+$/.test(k)), 'no Specification keys');
  assert.ok(keys.some(k => /^housing-provisions\|\d+\|\d+$/.test(k)), 'no HP Part keys');
  // 2022 writes jurisdiction slugs WITHOUT the state prefix that 2025 uses, so these keys exist
  // only because the state is also read off the section name. If that rule regressed, every
  // 2022 state variation would silently fall back to the national Part page.
  assert.equal(keys.filter(k => k.includes('|state:')).length, 301);
  for (const st of ['act', 'nsw', 'nt', 'qld', 'sa', 'tas', 'vic', 'wa']) {
    assert.ok(keys.some(k => k.includes(`|state:${st}|`)), `no ${st} keys`);
  }

  // The only contested keys are the same 16 as 2025: Housing Provisions' body-vs-schedule
  // section numbers, and front matter. No CONTAINER key is contested in either edition.
  assert.equal(idx.collisions.size, 16);
  assert.deepEqual([...idx.collisions.keys()].filter(k => !k.endsWith('|') && !k.includes('|preface|')), []);
});
