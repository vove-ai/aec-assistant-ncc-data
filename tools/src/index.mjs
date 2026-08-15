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
 * `null` remains available as a SEAM for any edition added later: it renders as an explicit
 * "not yet determined" line rather than as a plausible-looking value. Both current entries are
 * measured, because guessing here would put an unverified claim about which law applies into a
 * compliance corpus.
 *
 * 2022 was resolved by the content-model measurement (docs/content-model-2022.md §8). The naive
 * test — grep the packages for the F4D4 all-gender provisions — returns a hit and would have
 * concluded "Amendment 2". It is wrong: the packages are dual-state editorial files carrying the
 * NCC 2025 draft on top of NCC 2022 as tracked changes, and every all-gender occurrence sits
 * inside an `xt:insText` range authored in 2024/2025. In the base (NCC 2022) view the phrase
 * does not occur at all. Positive evidence for "no amendment": the packages' own
 * `table-1-history-of-adoption-*` ends at "NCC 2022 | 1 May 2023", while the published NCC 2025
 * corpus's copy of that table adds "NCC 2022 Amendment 1 | 1 May 2025" and "NCC 2022
 * Amendment 2 | 29 July 2025" — both later than this text, and neither present in it.
 */
export const AMENDMENTS = new Map([
  // Measured, not guessed: every 2025 package in tools/checksums.json is `…-v1.2.zip`.
  ['2025', 'NCC 2025 — ABCB XML dataset v1.2'],
  ['2022', 'NCC 2022 — as first published, no amendment'],
]);

const SEAM = '_Not yet determined — measure this edition before stating an amendment for it._';

/**
 * Characteristics of an edition's SOURCE that a reader of the corpus would otherwise take for our
 * error. Stated in the edition index because that is the one generated file a browsing agent reads
 * before the clauses, and because the alternative — rewriting the Code so it looks consistent —
 * puts an invention where law belongs.
 *
 * The 2022 entry is Task 14's measurement. NCC 2022's packages are dual-state editorial files, and
 * in six places the base text carries a cross-reference whose designation was updated to the NCC
 * 2025 numbering WITHOUT a tracked change, so no base-view transform can recover the 2022 string —
 * it is not in the source. The 2022 form of each was read off the renumbering the target file
 * records in its own `<num>`/`<sptc>` (e.g. base `F1D8`, accepted `F1D11`).
 *
 * This list is NOT maintained by hand. `forwardRefCheck` in build.mjs reconciles it against the
 * designations that actually survive into the emitted bytes and FAILS the build on a difference in
 * either direction. It has already earned that: `B1P7` was removed by hand when R51 omitted the
 * only file it appeared in, and came back when R60 recovered `volume-three/b1d1` — which the check
 * caught and a hand-kept list did not.
 */
export const SOURCE_FORWARD_REFS = new Map([
  ['2022', {
    note: 'Six cross-references in the NCC 2022 base text name the NCC 2025 designation of their '
      + 'target. They are untracked in the source, so they are reproduced as the Code prints them '
      + 'rather than rewritten. The 2022 form of each is given here.',
    refs: [
      ['F1D11', 'F1D8', 'volume-one/f1d8-subfloor-ventilation.md — Table F1D8 column header'],
      ['B1P7', 'B1P6', 'volume-three/b1d1-deemed-to-satisfy-provisions.md'],
      ['B2P12', 'B2P11', 'volume-three/b2d1-deemed-to-satisfy-provisions.md'],
      ['B3P8', 'B3P7', 'volume-three/b3d1-deemed-to-satisfy-provisions.md'],
      ['B6D7', 'B6D6', 'volume-three/b6d1-deemed-to-satisfy-provisions.md'],
      ['B7P5', 'B7P4', 'volume-three/b7d1-deemed-to-satisfy-provisions.md'],
    ],
  }],
]);

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
export function buildIndexes(unitsByEdition, {
  tree = [], sourceRelease = SOURCE_RELEASE, amendments = AMENDMENTS, omissions = new Map(),
  retentions = new Map(),
} = {}) {
  if (!(unitsByEdition instanceof Map)) {
    throw new Error('index: unitsByEdition must be a Map<edition, entries[]> — a plain object has no guaranteed key order');
  }
  if (!(omissions instanceof Map)) {
    throw new Error('index: omissions must be a Map<edition, records[]> — a plain object has no guaranteed key order');
  }
  if (!(retentions instanceof Map)) {
    throw new Error('index: retentions must be a Map<edition, record> — a plain object has no guaranteed key order');
  }
  const editions = [...unitsByEdition.keys()].sort(byCodepoint);
  return [
    { relPath: 'INDEX.md', content: rootIndex(editions, tree, sourceRelease, amendments) },
    ...editions.map(ed => ({
      relPath: `${ed}/INDEX.md`,
      content: editionIndex(ed, unitsByEdition.get(ed) ?? [], sourceRelease, amendments,
        omissions.get(ed) ?? [], retentions.get(ed) ?? null),
    })),
  ];
}

/* -- the per-edition map ------------------------------------------------------ */

function editionIndex(edition, entries, sourceRelease, amendments, omitted = [], retention = null) {
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
    ...knownGaps(edition, omitted, retention),
  ];
  for (const dir of [...groups.keys()].sort(byCodepoint)) {
    const rows = groups.get(dir).sort((a, b) => byTuple(a.key, b.key));
    out.push('', `## ${dir} (${rows.length})`, '', ...rows.map(r => r.line));
  }
  return `${out.join('\n')}\n`;
}

/**
 * What this edition does NOT contain, and what its source prints oddly.
 *
 * The corpus omits rather than stubs, so without this section the only trace of a missing clause
 * is the build report — which an agent searching `corpus/` never sees. Both halves are generated:
 * the omissions come from the run that produced the index, the forward references from the
 * measured constant above. Emitted only when there is something to say, so an edition with a clean
 * source carries no boilerplate.
 */
function knownGaps(edition, omitted, retention = null) {
  const out = [];
  if (omitted.length) {
    // A state variation is emitted FROM its national clause, so omitting the clause removes the
    // variations too. Counting only clauses would under-report the gap and leave "E1D1 [TAS]"
    // discoverable nowhere at all — it is not a heading in this index, and it is not a file.
    const files = omitted.reduce((n, o) => n + 1 + (o.variations?.length ?? 0), 0);
    out.push('', ...wrapNote(
      `Not published here: ${omitted.length} clause${omitted.length === 1 ? '' : 's'} — `
      + `${files} file${files === 1 ? '' : 's'} counting jurisdiction variations — that the source `
      + 'packages cannot supply: the map names a clause the package does not contain, or the clause '
      + 'is NCC 2025 only. Each is ruled on in OMITTED_2022_CLAUSES with its evidence and printed by '
      + 'the build. Cite the live Code for these; nothing here stands in for them.'));
    for (const o of [...omitted].sort((a, b) => byTuple([a.doc, a.clause], [b.doc, b.clause]))) {
      const vars = (o.variations ?? []).length ? ` (and its ${o.variations.join(', ')} variation${o.variations.length === 1 ? '' : 's'})` : '';
      out.push(`  ${o.doc} ${o.clause}${vars} — ${o.reason}`);
    }
  }
  out.push(...baseViewRetentionSection(edition, retention));
  const fwd = SOURCE_FORWARD_REFS.get(edition);
  if (fwd) {
    out.push('', ...wrapNote(fwd.note));
    for (const [printed, actual, where] of fwd.refs) {
      out.push(`  prints ${printed} — this edition's clause is ${actual} — ${where}`);
    }
  }
  return out;
}

/**
 * The third generated disclosure block: the files whose text the base view RETAINED.
 *
 * It exists because the chain used to terminate somewhere a consumer cannot reach. The build
 * report names these sites, and the build report is stdout — an agent that greps `corpus/`, gets a
 * hit and quotes it never sees a line of it. So the fact is stated twice where it can be found:
 * once in each affected file's own body (the token below, on one line after the heading) and once
 * here, as the list.
 *
 * Corpus PATHS, never source XML basenames: a consumer can open `volume-one/j6d4-….md`;
 * `J6D4-mechanical-ventilation-system-control.xml` is not in this repository and is not something
 * they have. Generated by the build from what it emitted — nothing here is hand-written, and the
 * counts move when the source does.
 *
 * @param {?{token: string, sites: number, sourceFiles: number,
 *           files: Array<{relPath: string, count: number}>,
 *           corrections: Array<{file, find, replace, url, files?: string[]}>}} r
 */
function baseViewRetentionSection(edition, r) {
  if (!r || !r.files?.length) return [];
  // Paths are stated exactly as every other line of this index states them: relative to the file
  // the reader is holding. A corpus-relative path would send them to `corpus/2022/2022/…`.
  const prefix = `${edition}/`;
  const inner = p => {
    const s = String(p ?? '');
    if (!s.startsWith(prefix) || s.slice(prefix.length).includes('..')) {
      throw new Error(`index: base-view retention path ${JSON.stringify(s)} is not inside edition ${edition} — `
        + 'the disclosure would point a reader at a file that is not there');
    }
    return s.slice(prefix.length);
  };
  const out = ['', ...wrapNote(
    `Read with care: ${r.files.length} file${r.files.length === 1 ? '' : 's'} below carry text the NCC 2025 `
    + 'draft moved into a container it marked as NEW — measured in the source as '
    + `${r.sites} distinct retention site${r.sites === 1 ? '' : 's'} across ${r.sourceFiles} source `
    + 'file(s). The packages record that a container is new and never where its text sat before, so two '
    + 'things follow and the source settles neither. The SUB-NUMBERING in these files is the draft\'s, not '
    + 'necessarily the Code\'s: a letter can restart, be absent, or sit at a different level than the '
    + 'published clause prints it. And the WORDING is the draft author\'s re-typing of the NCC 2022 text, '
    + 'which is not guaranteed to match the published Code word for word. Each file says so in its own '
    + `body, on one line after the heading, beginning \`${r.token}\` — grep that token to find them all. `
    + 'Quote the words and the clause rather than a sub-paragraph letter, and verify at `web_url`.')];
  for (const f of r.files) {
    out.push(`  ${inner(f.relPath)} — ${f.count} retention site${f.count === 1 ? '' : 's'}`);
  }
  if (r.corrections?.length) {
    out.push('', ...wrapNote(
      `Of those sites, ${r.corrections.length} ha${r.corrections.length === 1 ? 's' : 've'} been found by `
      + 'inspection to diverge from the published Code and corrected here, against the page named. THE REST '
      + 'ARE UNAUDITED — nobody has read them word by word against ncc.abcb.gov.au — so this list is a '
      + 'record of what was found, not a clean bill of health for the others.'));
    for (const c of r.corrections) {
      // The CORPUS path, on the same reasoning as the list above: a consumer can open
      // `volume-one/j9d4-….md`, and `J9D4-….xml` is not in this repository. A correction that
      // reached no emitted file (it can fire in a source file this publication does not publish)
      // is still disclosed, and says which source it was in — silence would be worse than a
      // filename the reader cannot open.
      const where = (c.files ?? []).length
        ? (c.files ?? []).map(inner).join(', ')
        : `${c.file} (no file of this edition publishes it)`;
      out.push(`  ${where}: "${c.find}" corrected to "${c.replace}"`, `    ${c.url}`);
    }
  }
  return out;
}

/** Hard-wrap a note at 96 columns on word boundaries, so the index stays readable in a terminal. */
function wrapNote(text) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > 96) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
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
