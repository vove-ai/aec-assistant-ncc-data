// index.mjs — the two browsable maps an agent falls back to when grep is not enough.
//
// Two files, two different jobs, and they are deliberately built from two different inputs:
//
//  * `corpus/{edition}/INDEX.md` — ONE LINE PER UNIT, built from the units the build just emitted.
//    It answers "I know the clause ID / the defined term, where is the file?" — the search a
//    phrase grep cannot do, because the agent does not know the wording. It is greppable rather
//    than readable: at full 2025 scale it is ~4,800 lines, which no one browses but `grep '^C2D2 '`
//    answers instantly.
//  * `corpus/INDEX.md` — the CENSUS, built from a directory walk of the whole corpus rather than
//    from this run's units. That is what lets a partial run (`--edition 2025`) rewrite it without
//    erasing the other edition: it describes what is on disk, not what was just built.
//
// Pure: values in, strings out. No filesystem, no network, no module state — the directory census
// arrives as `tree`, taken by build.mjs after it has finished writing.
//
// DETERMINISM IS A HARD REQUIREMENT, not a nicety: CI regenerates the corpus and runs
// `git diff --exit-code -- corpus/`. A timestamp, a hostname, a path or a duration in either file
// turns every CI run on a different machine into a failure. Everything below is a function of the
// units, the census and the two constants.

/** The pinned upstream release every corpus file is derived from (tools/checksums.json). */
export const SOURCE_RELEASE = 'ncc-2026-07';

/**
 * Edition -> amendment / dataset state, as printed in `corpus/INDEX.md`.
 *
 * `null` is a SEAM, not a default: it renders as an explicit "not yet determined" line rather
 * than as a plausible-looking value. NCC 2022's amendment state is not stated anywhere in the
 * ABCB read-me and has to be measured from the content (the F4D4 all-gender provisions entered
 * at Amendment 2) — that measurement is the 2022 content-model task's Step 6, and filling this
 * constant is how its answer reaches the corpus. Guessing "Amendment 2" here would put an
 * unverified claim about which law applies into a compliance corpus.
 */
export const AMENDMENTS = new Map([
  // Measured, not guessed: every 2025 package in tools/checksums.json is `…-v1.2.zip`.
  ['2025', 'NCC 2025 — ABCB XML dataset v1.2'],
  ['2022', null],
]);

const SEAM = '_Not yet determined — measured and recorded by the 2022 content-model task._';

/** Codepoint sort. Never localeCompare — locale-dependent order is not reproducible. */
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Codepoint sort over a tuple of strings, element by element. */
const byTuple = (a, b) => {
  for (let i = 0; i < a.length; i++) { const c = byCodepoint(a[i], b[i]); if (c) return c; }
  return 0;
};

/**
 * @param {Map<string, Array<{relPath: string, kind: string, id: ?string, term: ?string,
 *                            title: string, state: ?string}>>} unitsByEdition
 *   The units this run emitted, keyed by edition. One entry per FILE — a merged file (two
 *   glossary senses in one) is one entry, because the index maps files, not source elements.
 * @param {{tree?: Array<{dir: string, files: number}>, sourceRelease?: string,
 *          amendments?: Map<string, ?string>}} [opts]
 *   `tree` is the post-write directory census: corpus-relative `{edition}/{dir}` and its `.md`
 *   file count, for the WHOLE corpus including editions this run did not build.
 * @returns {Array<{relPath: string, content: string}>} root index first, then editions sorted.
 */
export function buildIndexes(unitsByEdition, { tree = [], sourceRelease = SOURCE_RELEASE, amendments = AMENDMENTS } = {}) {
  if (!(unitsByEdition instanceof Map)) {
    throw new Error('index: unitsByEdition must be a Map<edition, entries[]> — a plain object has no guaranteed key order');
  }
  const editions = [...unitsByEdition.keys()].sort(byCodepoint);
  return [
    { relPath: 'INDEX.md', content: rootIndex(editions, tree, sourceRelease, amendments) },
    ...editions.map(ed => ({
      relPath: `${ed}/INDEX.md`,
      content: editionIndex(ed, unitsByEdition.get(ed) ?? [], sourceRelease, amendments),
    })),
  ];
}

/* -- the per-edition map ------------------------------------------------------ */

function editionIndex(edition, entries, sourceRelease, amendments) {
  const seen = new Set();
  const groups = new Map();       // directory -> lines
  const kinds = new Map();

  for (const e of entries) {
    const rel = String(e?.relPath ?? '');
    const prefix = `${edition}/`;
    if (!rel.startsWith(prefix) || rel.slice(prefix.length).includes('..')) {
      throw new Error(`index: entry ${JSON.stringify(rel)} is not inside edition ${edition} — a mis-filed unit would emit a broken link`);
    }
    if (seen.has(rel)) throw new Error(`index: duplicate relPath ${rel} — two units cannot share one file`);
    seen.add(rel);

    const inner = rel.slice(prefix.length);           // volume-one/a5g7-….md
    const dir = inner.includes('/') ? inner.slice(0, inner.indexOf('/')) : '.';
    const title = String(e.title ?? '').trim();
    // The label is what an agent types: a clause designation, a defined term, or a page title.
    // The jurisdiction rides in parentheses exactly as it does in `citation:`, so the national
    // clause and its state variation are two distinguishable lines that a bare-ID grep still
    // finds. The filename stem is the last resort — a line with no label would be unusable.
    const label = [e.id, e.term, title].map(x => String(x ?? '').trim()).find(Boolean)
      ?? inner.slice(inner.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const state = e.state ? String(e.state).toUpperCase() : '';
    const line = `${label}${state ? ` (${state})` : ''} → ${inner}${title ? ` — ${title}` : ''}`;

    if (!groups.has(dir)) groups.set(dir, []);
    // Sorted on a key tuple rather than on the rendered line: sorting the line puts `A5G4 (VIC)`
    // BEFORE `A5G4`, because `(` is a lower codepoint than the arrow. National first, then its
    // variations in jurisdiction order, is the order a reader expects — and relPath as the last
    // element keeps ties resolved by something unique, so the order cannot depend on input order.
    groups.get(dir).push({ key: [label, state, inner], line });
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  }

  const kindSummary = [...kinds.keys()].sort(byCodepoint).map(k => `${k} ${kinds.get(k)}`).join(' · ');
  const out = [
    `# NCC ${edition} — corpus index`,
    '',
    `One line per file in \`corpus/${edition}/\`, as`,
    // The legend spells the arrow in ASCII on purpose: written with the real character it would
    // itself match `grep " → "`, so the one command that lists every unit would return a line
    // that is not a unit.
    '`{clause ID, glossary term, or page title} -> {path} -- {title}`, with a real `->` arrow.',
    'Paths are relative to this file. Grep here when the designation is known but the wording is',
    'not; grep the files themselves when it is the other way round.',
    '',
    `Units: ${entries.length}${kindSummary ? ` — ${kindSummary}` : ''}`,
    `Source dataset: alvar-ncc-data release \`${sourceRelease}\``,
    `Amendment state: ${amendmentLine(edition, amendments)}`,
  ];
  for (const dir of [...groups.keys()].sort(byCodepoint)) {
    const rows = groups.get(dir).sort((a, b) => byTuple(a.key, b.key));
    out.push('', `## ${dir} (${rows.length})`, '', ...rows.map(r => r.line));
  }
  return `${out.join('\n')}\n`;
}

/* -- the root census ---------------------------------------------------------- */

function rootIndex(builtEditions, tree, sourceRelease, amendments) {
  const rows = [...tree].map(t => ({ dir: String(t.dir), files: Number(t.files) || 0 }))
    .sort((a, b) => byCodepoint(a.dir, b.dir));
  const total = rows.reduce((n, r) => n + r.files, 0);

  // Editions come from the census, not from this run: an edition built by an EARLIER run is
  // still in the corpus and must not disappear from the map because this run was a slice.
  const perEdition = new Map();
  for (const r of rows) {
    const ed = r.dir.includes('/') ? r.dir.slice(0, r.dir.indexOf('/')) : r.dir;
    perEdition.set(ed, (perEdition.get(ed) ?? 0) + r.files);
  }
  for (const ed of builtEditions) if (!perEdition.has(ed)) perEdition.set(ed, 0);
  const editions = [...perEdition.keys()].sort(byCodepoint);

  return `${[
    '# NCC corpus',
    '',
    'One markdown file per content unit — clause, clause variation, glossary entry, page — with',
    'citation metadata in YAML frontmatter. Everything under `corpus/` is generated by `tools/`',
    'and nothing here is hand-edited; regenerate with `npm run build`.',
    '',
    `Source dataset: alvar-ncc-data release \`${sourceRelease}\`, SHA-256 verified — see`,
    '`tools/checksums.json`. The NCC as published at https://ncc.abcb.gov.au/ remains the',
    'authoritative source.',
    '',
    '## Editions',
    '',
    '| edition | files | index | amendment state |',
    '|---|---|---|---|',
    ...editions.map(ed => `| ${ed} | ${perEdition.get(ed)} | [${ed}/INDEX.md](${ed}/INDEX.md) | ${amendmentLine(ed, amendments)} |`),
    '',
    '## Directories',
    '',
    '| directory | files |',
    '|---|---|',
    ...rows.map(r => `| ${r.dir} | ${r.files} |`),
    `| **total** | **${total}** |`,
  ].join('\n')}\n`;
}

function amendmentLine(edition, amendments) {
  return amendments.get(edition) ?? SEAM;
}
