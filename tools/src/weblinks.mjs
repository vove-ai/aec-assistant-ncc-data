// weblinks.mjs — turning a crawled list of URLs into `web_url:` for a unit. Pure: URLs and a
// unit in, a string or null out. No filesystem, no network, no module state.
//
// WHY THIS IS NOT STRING FORMATTING. ncc.abcb.gov.au drops stopwords from its slugs
// ("Interpreting the NCC" -> `interpreting-ncc`, "Documentation of design and construction" ->
// `documentation-design-and-construction`), so a URL cannot be computed from a title. It is
// crawled once into tools/data/weblinks-{edition}.json and keyed here, offline and
// deterministically.
//
// THE FAILURE THAT MATTERS IS A WRONG URL, NOT A MISSING ONE. `web_url:` sits in the first six
// lines of every corpus file precisely so an agent can follow it to verify a citation. A URL
// that opens a real, plausible, WRONG page is a citation an agent will report as verified. So
// every rule below is written to fail closed: where the data does not identify one page, the
// answer is null and the build reports it.
//
// KEY: `{volume}|{scope}|{lead}` (R6 — both tokens lowercased, non-alphanumerics stripped).
//
//   volume  the URL's own path segment, which matches the reader's `unit.volume`.
//   scope   the SECTION token for a national page (`a`, `11`), or `state:{jurisdiction}` for a
//           jurisdiction-schedule page. Two namespaces are needed because the XML files every
//           state variation under the BODY section it varies (Part A5, section A) while the site
//           publishes it under the jurisdiction schedule (`/5-new-south-wales/nsw-a5-…`): a
//           unit simply does not know the schedule number, and the state is the only thing the
//           two representations share. Keying jurisdiction pages by their schedule number
//           instead would also make Housing Provisions collide with itself, since its body
//           sections are numbered 2–13 and its schedules 1–11.
//   lead    the leading token of the container slug, after an optional `part-` prefix and an
//           optional jurisdiction prefix. Empty for a section page, so `volume-one|a|` is
//           section A's own page. Indexing only `part-`-prefixed slugs would drop every
//           specification and every state variation (454 of 665 URLs, measured).

/** The corpus jurisdiction vocabulary — the same eight values `jurisdiction:` can take. */
const JURISDICTIONS = new Set(['act', 'nsw', 'nt', 'qld', 'sa', 'tas', 'vic', 'wa']);

/**
 * Jurisdiction schedule section slugs, so a state can be recovered when the container slug does
 * not carry one. The two editions disagree on that: 2025 writes
 * `/5-new-south-wales/nsw-a6-building-classification`, 2022 writes
 * `/5-new-south-wales/a6-building-classification` for the same page (measured 2026-08-14).
 * Reading the state off the slug alone would therefore send every 2022 state variation to the
 * NATIONAL Part page, which does not contain the variation.
 */
const JURISDICTION_SECTIONS = new Map([
  ['australian-capital-territory', 'act'], ['new-south-wales', 'nsw'], ['northern-territory', 'nt'],
  ['queensland', 'qld'], ['south-australia', 'sa'], ['tasmania', 'tas'], ['victoria', 'vic'],
  ['western-australia', 'wa'],
]);

/** The jurisdiction a section slug names, or null. `5-new-south-wales` -> `nsw`. */
function sectionJurisdiction(sectionSlug) {
  const words = String(sectionSlug).split('-').filter(Boolean);
  return JURISDICTION_SECTIONS.get((/^\d+$/.test(words[0]) ? words.slice(1) : words).join('-')) ?? null;
}

const URL_SHAPE = /^https:\/\/ncc\.abcb\.gov\.au\/editions\/ncc-(\d{4})\/adopted\/(.+)$/;

/** Codepoint sort. Never localeCompare — locale-dependent output is not reproducible. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** R6: lowercase, fold diacritics, drop everything that is not [a-z0-9]. `3.1` -> `31`. */
function tok(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Lowercased word tokens of a title, for the slug-tokens-⊆-title check. */
function titleWords(s) {
  return new Set(
    String(s ?? '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/**
 * A container slug split into the parts the key and the tiebreak need.
 * `part-a5-documentation-design-and-construction` -> { state: null, lead: 'a5', rest: [...] }
 * `nsw-a5-documentation-design-and-construction`  -> { state: 'nsw', lead: 'a5', rest: [...] }
 */
function splitContainerSlug(slug) {
  let words = String(slug).split('-').filter(Boolean);
  let state = null;
  // Both prefixes are optional and appear in EITHER order on the live site:
  // `/h-class-1-and-10-buildings/part-h1-structure` but `/8-south-australia/sa-part-h9`.
  // Stripping in one fixed order keys the South Australia page under lead `part` and loses it.
  for (let i = 0; i < 2 && words.length > 1; i++) {
    if (words[0] === 'part') words = words.slice(1);
    else if (state === null && JURISDICTIONS.has(words[0])) { state = words[0]; words = words.slice(1); }
    else break;
  }
  return { state, lead: tok(words[0] ?? ''), rest: words.slice(1) };
}

/** A container num as the site writes it: `Part H9` -> `h9`, `11.2` -> `112`. */
function numTok(num) {
  return tok(String(num ?? '').trim().replace(/^part[\s-]+/i, ''));
}

/**
 * Index a crawled URL list.
 *
 * @param {string[]} urls  one edition's crawl output
 * @returns {Map<string, string>} key -> url, carrying two extra documented properties:
 *   `.collisions`  Map<key, url[]>  keys claimed by more than one URL. They are deliberately
 *                  absent from the Map itself: picking one by insertion order would make the
 *                  corpus depend on crawl order and could emit a wrong citation silently.
 *                  resolveWebUrl consults these only with title evidence to decide between them.
 *   `.byVolumeLead` Map<'{volume}|{lead}', url[]>  national container pages, for a document
 *                  whose single section carries no num (Livable Housing Design).
 * @throws if a URL is not an adopted-edition page, or if the list mixes editions — both mean a
 *   caller bug, and an index built from a mixed list would answer with the wrong edition's URL.
 */
export function buildLinkIndex(urls) {
  const index = new Map();
  const collisions = new Map();
  const byVolumeLead = new Map();
  const seen = new Map();       // key -> Set<url>
  const editions = new Set();

  for (const raw of urls ?? []) {
    const url = String(raw).replace(/\/+$/, '');
    const m = URL_SHAPE.exec(url);
    if (!m) {
      throw new Error(
        `weblinks: ${JSON.stringify(String(raw))} is not an adopted-edition page URL — the link `
        + 'index must be built from a crawl of https://ncc.abcb.gov.au/editions/ncc-{year}/adopted/',
      );
    }
    editions.add(m[1]);
    if (editions.size > 1) {
      throw new Error(
        `weblinks: link list mixes editions (${[...editions].sort(byCodepoint).join(', ')}). `
        + 'Build one index per edition, or a 2022 URL will be cited in the 2025 corpus.',
      );
    }

    const segs = m[2].split('/').filter(Boolean);
    const [volume, sectionSlug, containerSlug] = segs;
    if (segs.length === 1 || segs.length > 3) continue;   // volume root / deeper than a container

    let key;
    let rank = 0;
    if (segs.length === 2) {
      key = `${volume}|${tok(sectionSlug.split('-')[0])}|`;
    } else {
      const { state: slugState, lead } = splitContainerSlug(containerSlug);
      if (!lead) continue;
      // The section page itself stays section-scoped even when it names a jurisdiction: scoping
      // it by state would resolve a schedule page and the body section of the same number to
      // each other's URLs, and a Schedule 1 glossary variation to the state schedule.
      const sectionState = sectionJurisdiction(sectionSlug);
      const state = slugState ?? sectionState;
      // NCC 2022 serves some state variations at TWO URLs — under the jurisdiction schedule and
      // under the body section — with an identical clause set (verified live). They are aliases,
      // so dropping both as "contested" would turn two correct URLs into a missing one. The
      // schedule placement outranks the body-section one because it is the form NCC 2025 uses
      // uniformly, which keeps both editions citing the same way.
      if (state) rank = sectionState === state ? 0 : 1;
      key = `${volume}|${state ? `state:${state}` : tok(sectionSlug.split('-')[0])}|${lead}`;
      if (!state) {
        const vk = `${volume}|${lead}`;
        if (!byVolumeLead.has(vk)) byVolumeLead.set(vk, []);
        if (!byVolumeLead.get(vk).includes(url)) byVolumeLead.get(vk).push(url);
      }
    }

    if (!seen.has(key)) seen.set(key, new Map());
    seen.get(key).set(url, Math.min(rank, seen.get(key).get(url) ?? rank));
  }

  for (const [key, ranked] of seen) {
    const best = Math.min(...ranked.values());
    const winners = [...ranked].filter(([, r]) => r === best).map(([url]) => url).sort(byCodepoint);
    if (winners.length === 1) index.set(key, winners[0]);
    else collisions.set(key, winners);
  }
  for (const list of byVolumeLead.values()) list.sort(byCodepoint);

  index.collisions = collisions;
  index.byVolumeLead = byVolumeLead;
  index.edition = [...editions][0] ?? null;
  return index;
}

/**
 * The authoritative ncc.abcb.gov.au page for a unit, or null.
 *
 * Never throws: an unresolved unit is an outcome the build reports and rules on, not a crash.
 *
 * @param {object} unit  a RawUnit (volume, sectionNum, containerNum, containerTitle, state, kind, id, title)
 * @param {Map} index    buildLinkIndex output
 * @returns {string|null}
 */
export function resolveWebUrl(unit, index) {
  if (!unit || typeof unit !== 'object' || !index || typeof index.get !== 'function') return null;

  const volume = typeof unit.volume === 'string' ? unit.volume : '';
  if (!volume) return null;

  // The two editions publish the SAME slugs, so an index handed the wrong edition's units would
  // answer every one of them — with a URL for the other edition of the Code. Fail closed: the
  // build's "no clause may have a null web_url" assertion then reports it, loudly and in bulk.
  if (unit.edition && index.edition && String(unit.edition) !== String(index.edition)) return null;

  const sectionTok = tok(typeof unit.sectionNum === 'string' || typeof unit.sectionNum === 'number' ? unit.sectionNum : '');
  const lead = typeof unit.containerNum === 'string' || typeof unit.containerNum === 'number'
    ? numTok(unit.containerNum)
    : '';

  // No container: the unit belongs to the section page itself. This is the primary path for
  // glossary entries (Schedule 1 Definitions), not a fallback.
  if (!lead) return lookup(index, `${volume}|${sectionTok}|`, titleWords(unit.title));

  const containerTitle = titleWords(unit.containerTitle);
  const state = tok(unit.state);

  // A state-varied unit prefers its jurisdiction page: measured, the national Part page does NOT
  // carry the variation's text, only a link to it and a client-side state filter.
  if (state && JURISDICTIONS.has(state)) {
    const hit = lookup(index, `${volume}|state:${state}|${lead}`, containerTitle);
    // Jurisdiction pages carry no clause anchors (measured), so no fragment here.
    if (hit) return hit;
  }

  if (sectionTok) {
    const hit = lookup(index, `${volume}|${sectionTok}|${lead}`, containerTitle);
    if (hit) return withFragment(hit, unit);
    // Deliberately NO fallback to the section page: a section page is a table of contents and
    // does not contain the clause, so it would be a wrong citation rather than a missing one.
    return null;
  }

  // A document whose only section carries no num (Livable Housing Design) cannot be scoped by
  // section at all. Resolve on the leading token alone, and only when it is unique in the volume.
  const candidates = index.byVolumeLead?.get(`${volume}|${lead}`) ?? [];
  return candidates.length === 1 ? withFragment(candidates[0], unit) : null;
}

/**
 * One key's URL. A key claimed by exactly one URL answers outright; a contested key answers only
 * when the unit's title corroborates exactly one candidate (the site's slug drops stopwords, so
 * its tokens are a subset of the title's, never a superset).
 */
function lookup(index, key, titleTokens) {
  const direct = index.get(key);
  if (direct) return direct;

  const candidates = index.collisions?.get(key);
  if (!candidates || !titleTokens.size) return null;

  const fits = candidates.filter(url => {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    const slug = segs.length >= 6 ? segs[5] : segs[4];          // container slug, else section slug
    const { rest } = segs.length >= 6
      ? splitContainerSlug(slug)
      : { rest: String(slug).split('-').filter(Boolean).slice(1) };
    return rest.length > 0 && rest.every(w => titleTokens.has(w));
  });
  return fits.length === 1 ? fits[0] : null;
}

/**
 * Land the reader on the clause, not the top of a 280 KB Part page. Measured on three page
 * shapes (volume Part, Specification, Housing Provisions Part): the clause designation IS the
 * heading's HTML id — `#A5G7`, `#S1C1`, `#11.2.2`. A fragment that ever failed to match would
 * simply show the top of the correct page, so this cannot turn a right URL into a wrong one.
 */
function withFragment(url, unit) {
  if (unit.kind !== 'clause') return url;
  const id = String(unit.id ?? '').trim();
  if (!id) return url;
  // No `+`-for-space substitution: that is query-string encoding, and in a fragment `+` is a
  // literal plus, which would name an element that does not exist.
  return `${url}#${encodeURIComponent(id)}`;
}
