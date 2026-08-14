// emit.mjs — what a unit is CALLED and what its first six lines SAY.
//
// Both are retrieval surfaces, not cosmetics:
//
//  1. THE FILENAME IS THE CLAUSE-ID LOOKUP. `glob corpus/2025/**/c2d2-*` must land on exactly
//     one clause and `a5g4-vic-*` on the Victorian variation, so every name leads with the
//     lowercased clause designation and carries the state directly after it.
//  2. THE FIRST SIX LINES ARE THE CITATION. `grep -A6` on a clause ID must return `citation:`
//     and `web_url:`, so the key order is fixed with those two immediately after the identity
//     key and the only variable-length key (`defined_terms`) last.
//
// Two rules keep the corpus honest:
//
//  * INJECTIVE NAMES, OR A THROW. State threads into EVERY derivation — clause, container and
//    glossary alike (⊕ trap 1: Volume Two Part H6's NSW overview was once overwritten by the
//    national body, last-write-wins, no warning). Where a name cannot be derived at all the
//    module throws instead of emitting `-slug.md`. A build counter is deliberately NOT used:
//    it would make a name depend on document order and break byte-identical regeneration.
//  * VALID YAML, OR A THROW LATER. A mis-quoted value makes the head unparseable, and
//    `grep -A6` output is what an agent reads. Quoting is decided by rule (below), not by taste.
//
// Pure: values in, strings out. No filesystem, no network, no module state. Task 7 writes the
// files and asserts uniqueness across everything this module names.
//
// `figures` and `warnings` from normalizeUnit deliberately do NOT reach the file: a figure is
// already inline in the body as `![Figure …](cdn…)`, and a warning is a build diagnostic whose
// text would pollute a phrase grep. Task 7 reports both straight off its own `normalizeUnit`
// result, so nothing is lost by keeping them out of the corpus.
import crypto from 'node:crypto';

/**
 * Frontmatter key order. Fixed, and the only place it is written down.
 *
 * `building_classes_excluded` holds the position `building_classes` used to (after `supersedes`,
 * immediately before the only variable-length key), so the `grep -A6` window promised above is
 * unchanged by the rename.
 */
export const FRONTMATTER_KEYS = [
  'clause', 'term', 'title', 'citation', 'web_url', 'edition', 'volume', 'jurisdiction',
  'supersedes', 'building_classes_excluded', 'defined_terms',
];

/** Longest title/term slug allowed in a filename, cut on a word boundary. */
const SLUG_CAP = 60;

// containerKind → filename prefix. `spec-topic` maps to the same token as `specification`
// (R20): a spec-topic has no num of its own and inherits its Specification's, so mapping it
// separately would split one Specification's files across two filename shapes.
const CONTAINER_TOKENS = {
  part: 'part',
  'part-variation': 'part',                   // ⊕ trap 1: the state, not the kind, distinguishes it
  specification: 'spec',
  'spec-topic': 'spec',                       // R20
  'schedule-part': 'schedule',
  'schedule-part-variation': 'schedule',
  'schedule-spec': 'schedule',
  'schedule-referenced-document': 'schedule',
};

/**
 * ASCII slug: NFKD → drop combining marks → lowercase → non-alphanumerics to `-` → trim.
 * Returns '' when nothing survives (six real glossary terms do this: ° % > < ≤ ≥).
 */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The unit's filename, `.md` included. Throws rather than emitting a name it cannot derive.
 * @param {object} unit a RawUnit (kind/id/term/title/state/containerKind/containerNum/sectionType)
 */
export function unitFilename(unit) {
  const state = unit?.state ? slugify(unit.state) : '';
  switch (unit?.kind) {
    case 'clause':
      return join([idToken(unit), state, capSlug(slugify(unit.title))]);

    case 'glossary': {
      const term = String(unit.term ?? '').trim();
      if (!term) throw identityError('glossary unit has no term to name it', unit);
      const slug = capSlug(slugify(term));
      // ⊕ trap 2: glossary slugs are not injective. Six symbol-only terms slugify to '', and
      // µm collides with m once non-ASCII is dropped. The hash is of the term itself, so it is
      // stable across builds. Injectivity still only holds for the measured collision classes —
      // which is why Task 7 asserts uniqueness rather than trusting this scheme.
      const needsHash = slug === '' || /[^\x00-\x7F]/.test(term);
      return join([needsHash ? `${slug || 'term'}-${sha1_8(term)}` : slug, state]);
    }

    case 'page': {
      // R2: the shape is chosen from the data. A container overview carries its container's
      // num; a standalone page has none. (Measured across all five 2025 documents: this agrees
      // with Task 4's `overview` flag 234/234, and the test suite asserts that agreement.)
      if (!unit.containerNum) return join(['page', state, capSlug(slugify(unit.title))]);
      const tok = containerToken(unit);
      return join([tok, numToken(unit, tok), state, capSlug(slugify(unit.title))]);
    }

    default:
      throw identityError(`unmodelled unit kind "${unit?.kind}"`, unit);
  }
}

/**
 * Where a unit's file lives, corpus-relative and with `/` separators on every platform.
 *
 * Split out of `emitUnit` because the build needs the path of units it is NOT emitting this run:
 * a sliced build has to know every file the current toolchain COULD produce for the documents it
 * selected, so that anything else in those directories can be deleted as stale. Deriving that
 * second answer from a copy of this rule is how a slice ends up deleting a live file.
 *
 * @param {object} unit  a RawUnit
 * @param {{glossaryDir?: string}} [opts]
 * @returns {string} e.g. `2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md`
 */
export function unitRelPath(unit, { glossaryDir = 'glossary' } = {}) {
  if (!unit?.edition) throw identityError('no edition — the corpus path cannot be built', unit);
  const dir = unit.kind === 'glossary' ? glossaryDir : unit.volume;
  if (!dir) throw identityError('no volume to place the file in', unit);
  // The build writes files straight from relPath, so both parts of it this module does not
  // generate character by character are checked before either becomes a path. `edition` gets the
  // same check as `dir` and for the same reason: it is reader-supplied data interpolated into a
  // filesystem path, and a check applied to one of two interpolations is not a check.
  const edition = String(unit.edition);
  for (const [name, value] of [['edition', edition], ['directory', dir]]) {
    if (!unsafePathSegment(value)) continue;
    throw identityError(`${name} ${JSON.stringify(value)} is not a safe corpus-relative path`, unit);
  }
  return `${edition}/${dir}/${unitFilename(unit)}`;
}

/** A path segment the build may not write through: traversal, absolute, or a Windows drive. */
function unsafePathSegment(value) {
  return value === '' || /(^|\/)\.\.(\/|$)|\\|^\/|^[A-Za-z]:/.test(value);
}

/**
 * @param {object} unit        a RawUnit
 * @param {{bodyMd: string, definedTerms: string[]}} normalized  normalizeUnit's output
 * @param {{citationPrefix: string, webUrl?: string|null, glossaryDir?: string}} opts
 * @returns {{relPath: string, content: string}} corpus-relative path and the whole file
 */
export function emitUnit(unit, normalized, { citationPrefix, webUrl = null, glossaryDir = 'glossary' } = {}) {
  if (!citationPrefix) throw identityError('no citationPrefix — a file must never ship uncitable', unit);
  const relPath = unitRelPath(unit, { glossaryDir });

  const isClause = unit.kind === 'clause';
  const rows = [];
  if (unit.kind === 'glossary') rows.push(['term', unit.term]);
  else if (isClause) rows.push(['clause', unit.id]);
  rows.push(['title', unit.title ?? '']);
  rows.push(['citation', citationFor(unit, citationPrefix)]);
  if (webUrl) rows.push(['web_url', webUrl]);
  rows.push(['edition', String(unit.edition)]);
  rows.push(['volume', unit.volume]);
  // Always explicit. AGENTS.md tells agents that a jurisdiction other than `aus` means a state
  // variation to be checked before relying on — which only works if `aus` is stated, not implied
  // by an absent key.
  rows.push(['jurisdiction', unit.state ? String(unit.state).toLowerCase() : 'aus']);
  if (isClause && unit.supersedes) rows.push(['supersedes', unit.supersedes]);
  // The source lists the classes a clause does NOT apply to, and the key says so. Measured on the
  // corpus's own text: A1G1 "Scope of NCC Volume One" carries `Class 1a, Class 10c` while its body
  // states Volume One covers Class 2-9 (plus 1b/10a/10b for access) — and A6G3 "Class 2 buildings"
  // lists every class except Class 2. The value is transcribed verbatim; only the name asserts
  // anything, which is why it must assert the right thing. (Owner ruling, Task 11 gate: rename,
  // do not invert — inverting would put a derived applicability claim where a transcription is.)
  if (isClause && unit.buildingClasses) rows.push(['building_classes_excluded', unit.buildingClasses]);

  assertKeyOrder(rows.map(([k]) => k), unit);
  const frontmatter = rows.map(([k, v]) => `${k}: ${yamlScalar(v)}`);

  // Document order, not sorted: it records where each term is first used, and is deterministic.
  const terms = normalized?.definedTerms ?? [];
  if (terms.length) frontmatter.push('defined_terms:', ...terms.map(t => `  - ${yamlScalar(t)}`));

  const heading = headingFor(unit);
  const blocks = [
    ['---', ...frontmatter, '---'].join('\n'),
    heading ? `# ${heading}` : '',
    normalized?.bodyMd ?? '',
  ].filter(Boolean);

  return { relPath, content: `${blocks.join('\n\n')}\n` };
}

/* -- identity tokens --------------------------------------------------------- */

// Filename parts join with '-', and an empty part disappears rather than leaving `j3d6-.md`
// (volume-one's J3D6 is titled "* * * * *", which slugifies to nothing).
const join = parts => `${parts.filter(Boolean).join('-')}.md`;

// A designation (a clause id or a container num) keeps its dots, because AGENTS.md promises
// Housing Provisions globs as `11.2.2-*` and Part 13.7 as `part-13.7-*`. That is the one way it
// differs from slugify(); everything outside [a-z0-9.] still becomes '-'.
function designationToken(value) {
  return String(value ?? '').trim()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function idToken(unit) {
  const id = String(unit.id ?? '').trim();
  if (!id) throw identityError('clause unit has no id to name it', unit);
  const tok = designationToken(id);
  if (!tok) throw identityError(`clause id ${JSON.stringify(id)} has no usable characters`, unit);
  return tok;
}

function containerToken(unit) {
  // Housing Provisions reuses section numbers — body sections are type="other" num 2–13 while
  // schedules are type="schedule" num 1–11 — so a section's num is only unique when paired with
  // its type. Pairing them in the token keeps `section-5-…` and `schedule-5-…` apart.
  if (unit.containerKind === 'ncc-section') return unit.sectionType === 'schedule' ? 'schedule' : 'section';
  const tok = CONTAINER_TOKENS[unit.containerKind];
  if (!tok) {
    throw identityError(
      `unmodelled containerKind "${unit.containerKind}" — map it to a filename token in `
      + 'CONTAINER_TOKENS; never let a container name itself',
      unit,
    );
  }
  return tok;
}

// One Volume Two part carries num="Part H9" against 104 plain nums. Stripping the repeated kind
// word keeps it shaped like every other Part instead of `part-part-h9`.
function numToken(unit, tok) {
  const n = designationToken(unit.containerNum);
  if (!n) throw identityError(`container num ${JSON.stringify(unit.containerNum)} has no usable characters`, unit);
  const stripped = n.startsWith(`${tok}-`) ? n.slice(tok.length + 1) : '';
  return stripped || n;
}

// Cut on a word boundary. If the first word alone exceeds the cap it is cut mid-word: the cap is
// a hard bound on path length, not a suggestion (measured longest real token: 16 chars, so this
// is a guard, not a working path). A cut landing on a hyphen never leaves it behind.
function capSlug(slug) {
  if (slug.length <= SLUG_CAP) return slug;
  const cut = slug.lastIndexOf('-', SLUG_CAP);
  return (cut > 0 ? slug.slice(0, cut) : slug.slice(0, SLUG_CAP)).replace(/-+$/, '');
}

const sha1_8 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 8);

/* -- citation and heading ---------------------------------------------------- */

// A citation that omits the jurisdiction on a state-varied unit is a wrong citation, so the
// suffix applies to every kind, not only clauses.
function citationFor(unit, prefix) {
  const state = unit.state ? ` (${String(unit.state).toUpperCase()})` : '';
  if (unit.kind === 'clause') return `${prefix} ${unit.id}${state}`;
  if (unit.kind === 'glossary') return `${prefix} Glossary: ${unit.term}${state}`;
  return `${prefix} ${unit.title}${state}`;
}

function headingFor(unit) {
  if (unit.kind === 'glossary') return String(unit.term ?? '').trim();
  if (unit.kind === 'clause') return [unit.id, unit.title].map(x => String(x ?? '').trim()).filter(Boolean).join(' — ');
  return String(unit.title ?? '').trim();
}

/* -- YAML -------------------------------------------------------------------- */

// A plain scalar cannot start with an indicator, cannot contain ": " or " #", cannot have edge
// whitespace, and must not be something the core schema resolves to a non-string. Everything
// else stays plain — including a bare ':' inside a URL, which is why web_url is unquoted.
const YAML_LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_NUMBER = /^[-+]?(\.\d+|\d+(\.\d*)?([eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/;
const YAML_WORD = /^([yYnN]|[Yy]es|YES|[Nn]o|NO|[Tt]rue|TRUE|[Ff]alse|FALSE|[Oo]n|ON|[Oo]ff|OFF|[Nn]ull|NULL|~|\.inf|-\.inf|\.nan)$/;

function needsQuote(s) {
  return s === ''
    || /^\s|\s$/.test(s)
    || YAML_LEADING_INDICATOR.test(s)
    || /: |:$/.test(s)
    || / #/.test(s)
    || /[\u0000-\u001f\u007f]/.test(s)
    || YAML_NUMBER.test(s)
    || YAML_WORD.test(s)
    || /^\d{4}-\d{2}-\d{2}/.test(s);   // YAML 1.1 timestamp
}

/**
 * A YAML double-quoted scalar escapes exactly three control characters by name — and `needsQuote`
 * DETECTS the whole C0 range plus DEL. Escaping only \n\r\t therefore let a VT, FF or DEL through
 * raw inside the quotes, where the YAML spec forbids it: unparseable frontmatter, emitted without
 * a throw, contradicting this module's own promise that a file is either valid YAML or a build
 * failure. Everything the detector flags is now escaped, by the spec's `\xNN` form.
 */
function yamlScalar(value) {
  const s = String(value ?? '');
  if (!needsQuote(s)) return s;
  const escaped = s
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, c => `\\x${c.codePointAt(0).toString(16).padStart(2, '0')}`);
  return `"${escaped}"`;
}

// The key order is what makes `grep -A6` self-citing, so it is enforced here rather than trusted
// to the order of the pushes above.
function assertKeyOrder(keys, unit) {
  let last = -1;
  for (const k of keys) {
    const i = FRONTMATTER_KEYS.indexOf(k);
    if (i <= last) throw identityError(`frontmatter key "${k}" is out of the fixed order`, unit);
    last = i;
  }
}

function identityError(msg, unit) {
  const who = [unit?.kind, unit?.id ?? unit?.term ?? unit?.title, unit?.state].filter(Boolean).join(' ');
  return new Error(`emit: ${msg} — unit: ${who || '(no identity)'}`);
}
