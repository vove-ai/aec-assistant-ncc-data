# aec-assistant-ncc-data — Design

**Date:** 2026-08-13
**Status:** Draft — awaiting owner review
**Repo:** `vove-ai/aec-assistant-ncc-data` (public; created only after this spec is approved)
**Local working copy:** `C:\dev\aec-assistant-ncc-data`

## Purpose

A normalized, grep-optimized corpus of the National Construction Code — NCC 2022 and
NCC 2025, both concurrently in force — as one markdown file per clause, generated from
the official ABCB XML.

The primary consumer is a **Claude Managed Agents session**: the repo is mounted as a
`github_repository` resource and searched with the built-in `grep` / `glob` / `read`
tools. Retrieval is exact rather than semantic — clause IDs, phrases, standard
references, and figure designations resolve by text search, and every hit carries its
citation in the same file. A pinned `checkout` commit makes any answer's corpus state
reproducible.

This project is deliberately standalone. It shares knowledge with the `aec-assistant`
vector-store ingestion pipeline (`scripts/ncc-2025-v12/`) but **no code**: overlap is
accepted in exchange for a self-contained, reproducible, cleanly bounded repo (owner
decision, 2026-08-13).

## Non-goals

- **No Australian Standards.** AS/NZS content is copyright-licensed and paid-tier; it
  goes in a separate **private** repo (`standards` corpus, designed later), mounted
  only for paid plans. This repo is core-tier and mounts for every session.
- **No raw XML in the tree.** The XML is single-line DITA/NCC-schema markup full of
  UUIDs and `/tmp/QppServer/...` xref paths — grep-hostile. Provenance lives in
  `alvar-ncc-data` (verbatim zips + checksums), not here.
- **No vector-store ingestion.** The existing OpenAI pipeline is untouched and
  continues independently.
- **No committed images.** Figures are referenced by CDN URL
  (`cdn.aecassistant.com.au`); the SVGs live in R2.

## Source material

Everything derives from the **public release assets of
[`vove-ai/alvar-ncc-data`](https://github.com/vove-ai/alvar-ncc-data), tag
`ncc-2026-07`** — byte-for-byte ABCB publications from data.gov.au with published
SHA-256 checksums. The toolchain downloads these into a gitignored `.cache/` and
verifies every asset against `tools/checksums.json` (a committed copy of the release's
`SHA256SUMS.txt`) before parsing. Local folders such as `C:\dev\_data` are never read.

| Asset (release `ncc-2026-07`) | Shape |
|---|---|
| `ncc-2022-volume-{one,two,three}.zip`, `ncc-2022-housing-provisions.zip` | per-clause DITA XML (~11,300 files) + SVG figures |
| `ncc-2025-{volume-one,volume-two,volume-three,housing-provisions,livable-housing-design}-v1.2.zip` | one monolithic `contents.xml` each + SVG figures + XSDs |
| `ncc-2025-schema-v1.2.zip` | official NCC XSDs |

The two editions have **different source schemas** and get separate readers:

- **2025** — `<ncc-volume>` / `<ncc-standard>` documents governed by the shipped XSDs.
  Structure is derived from the XSDs, never from reading samples; the containment
  model (including the `subtopic` trap and `specification`-as-sibling-of-`part`) is
  documented in [`content-model-2025.md`](./content-model-2025.md).
- **2022** — per-clause DITA files (`<clause outputclass="ncc-clause">` with `<sptc>`
  clause IDs, `<archive-num>` 2019 mappings, glossary `xref`s). Its content model gets
  the same treatment during the pilot: measured from the corpus, written up as
  `content-model-2022.md` before the bulk run.

## Repository layout

```
aec-assistant-ncc-data/
├── README.md                  # humans: provenance, licence, attribution, changes
├── AGENTS.md                  # agents: how to search this corpus
├── LICENSE                    # MIT — code only; corpus licence stated in README
├── package.json               # private; scripts: fetch / build / test / validate
├── .node-version              # Node 24 LTS pin (engines field mirrors it)
├── corpus/                    # ← the ONLY tree agents search; 100% generated
│   ├── INDEX.md               # tree overview + counts + dataset versions
│   ├── 2022/
│   │   ├── INDEX.md           # clause → path map for the edition
│   │   ├── volume-one/  volume-two/  volume-three/
│   │   ├── housing-provisions/
│   │   └── glossary/
│   └── 2025/
│       ├── INDEX.md
│       ├── volume-one/  volume-two/  volume-three/
│       ├── housing-provisions/  livable-housing/
│       └── glossary/
├── docs/
│   ├── design.md              # this document
│   ├── content-model-2025.md  # carried from aec-assistant 2026-08-12; re-verified + corrected on carry-over
│   └── content-model-2022.md  # written during the pilot
├── tools/
│   ├── src/
│   │   ├── fetch.mjs          # release assets → .cache/, SHA-256 verified
│   │   ├── read-2022.mjs      # DITA per-clause files → unit AST
│   │   ├── read-2025.mjs      # monolithic contents.xml → unit AST (XSD-derived walk)
│   │   ├── normalize.mjs      # xrefs inlined, figure URLs, list labels, tables
│   │   ├── emit.mjs           # unit AST → frontmatter + markdown body
│   │   ├── index.mjs          # INDEX.md generation
│   │   └── build.mjs          # orchestration; --edition, --slice for the pilot
│   ├── test/                  # node:test — unit tests + acceptance suite
│   └── checksums.json         # pinned SHA-256s, tag ncc-2026-07
├── .github/workflows/ci.yml
└── .gitignore                 # .cache/, node_modules/
```

`corpus/` is a hard boundary: nothing under it is hand-edited, and nothing outside it
is meant to be searched by agents. Tools, tests, and fixtures can never pollute a
corpus grep.

## Corpus conventions

### Directories and filenames

One file per content unit (clause, clause variation, glossary entry, page). Filenames
are lowercase, lead with the unit's identity, and carry a slugified title:

```
corpus/2025/volume-one/a5g7-resistance-to-the-incipient-spread-of-fire.md
corpus/2025/volume-one/a5g4-vic-watermark-certification-scheme.md   # state variation
corpus/2022/housing-provisions/11.2.2-stair-construction.md
corpus/2025/glossary/accredited-testing-laboratory.md
corpus/2025/volume-one/page-introduction-to-the-ncc.md              # non-clause pages
```

- Clause-ID-first means `glob corpus/2025/**/a5g7-*` is exact.
- State variations keep the state suffix directly after the clause ID.
- The glossary is emitted **once per edition** under `glossary/`, not inside a volume.
  (The 2025 source embeds the same glossary in Volumes One–Three and the Housing
  Provisions — 556 entries on 555 paths, one term carrying two senses. What the four
  copies agree on, and what they do not, is measured in `content-model-2025.md`
  § The glossary across volumes; the fold is R33.)
- Filenames must be unique within their directory; the build fails on collision
  rather than silently overwriting.

### Frontmatter

YAML frontmatter on every file. Keys reuse the vector-store attribute vocabulary so
the two retrieval paths cite identically and can be parity-checked mechanically:

```markdown
---
clause: A5G7
title: Resistance to the incipient spread of fire
citation: NCC 2025 V1 A5G7
web_url: https://ncc.abcb.gov.au/editions/ncc-2025/adopted/volume-one/...
edition: "2025"
volume: volume-one
jurisdiction: aus
supersedes: "2019: A5.6"        # from <archive-num>, when present in source
defined_terms:
  - resistance to the incipient spread of fire
  - Standard Fire Test
  - Accredited Testing Laboratory
---
```

Key order is fixed and deliberate: `citation` and `web_url` sit immediately after
`clause`/`title` so a `grep -A` window on a clause ID always captures them;
variable-length keys (`defined_terms`) come last.

- `citation` strings follow the same per-volume prefix rules as the vector-store
  corpus (`NCC 2025 V1 …`, `NCC 2022 HP …`), so an answer cites the same way
  whichever retrieval path produced it.
- `jurisdiction` is `aus` or a state code (`vic`, `nsw`, …) for variations.
- Non-clause pages omit `clause`/`supersedes`; glossary entries use `term:` in place
  of `clause:`, and `sources:` — a one-line list of the documents that publish the
  entry — in place of `volume:`, because one glossary file speaks for all of them.
- `grep -A` on a clause ID surfaces `citation:` and `web_url:` without a second
  lookup — a hit is self-citing.

### Body

- H1 is `# {clause} — {title}`.
- **One paragraph per line — prose is never hard-wrapped.** This is load-bearing:
  phrase greps must not break across line boundaries, and a `grep -n` hit returns a
  complete sentence with context.
- **Glossary references are inlined as plain prose** (`…deemed to have a resistance
  to the incipient spread of fire to the space above…`). This fixes the known defect
  in the current vector-store output, where each xref breaks the sentence across
  lines and defeats phrase search. The linked terms are preserved in
  `defined_terms:`.
- Sub-clause labels follow the source: `**(1)**` for numbered subclauses; list items
  `(a)` / `(i)` per the source's list style attribute, **defaulting to alpha** when
  the attribute is absent (the 2025 source omits it on ~42% of ordered lists; NCC
  professional usage — "C2D2(a)" — is lettered).
- Tables are GitHub-flavoured markdown tables. Notes and explanatory callouts are
  blockquotes.
- **Figures stay inline where the source places them**, as
  `![Figure {designation}: {caption}]({cdn_url})`. A clause that cites a figure
  carries the figure's link in the same file — the "chase the figure" retrieval
  problem cannot occur by construction.

### INDEX.md and AGENTS.md

- `corpus/INDEX.md` — tree overview, per-directory unit counts, source dataset
  versions and amendment state.
- Per-edition `INDEX.md` — one line per unit: `A5G7 → volume-one/a5g7-….md — title`.
  Gives agents a browsable map and a fallback when a grep term is uncertain.
- `AGENTS.md` (repo root) — the search contract: grep within `corpus/` only; ID
  lookup via `glob`; phrase search examples; how editions relate (both in force,
  applicable edition follows the project's permit lodgement date); how to read
  frontmatter for citations.

## Toolchain

- **Node 24 LTS**, ESM throughout, `node --test` (zero test dependencies).
- **Single runtime dependency: `@xmldom/xmldom`.** NCC prose is mixed content —
  paragraphs with inline `xref`s whose order matters — which object-mapping parsers
  (fast-xml-parser et al.) do not preserve reliably. A DOM walk does. Largest source
  file is 5.5 MB; DOM is comfortably sufficient.
- **Deterministic emission.** Sorted iteration everywhere, no timestamps or
  environment data in output. Same inputs → byte-identical `corpus/`. Regeneration
  diffs are meaningful review artifacts.
- **Fail-loud.** Unknown elements, unresolvable xrefs, filename collisions, and
  missing figure assets fail the build with a report — never a silent skip. (An
  explicit, reviewed allowlist covers genuinely ignorable elements.)
- `build.mjs --slice` generates a bounded subset (the pilot) through the identical
  code path as the full build.

## Validation and CI

Three layers:

1. **Unit tests** on the readers, normalizer, and emitter — including regression
   tests for every content-model trap already paid for once: `subtopic` containment,
   `specification` as sibling of `part`, `num`+`type` section keying, alpha list
   default, per-section URL keying, slug-tokens-⊂-title checking.
2. **Acceptance suite** — executable greps against the generated corpus, the
   definition of "the format works":

   | # | Check | Passes when |
   |---|---|---|
   | 1 | `grep -rl "C2D2" corpus/2022/` | the clause file, no noise |
   | 2 | phrase grep across a former xref boundary | hit lands (the defect this repo exists to fix) |
   | 3 | `grep -rl "AS 1530.4"` | every citing clause |
   | 4 | clause citing "See Figure X" | figure CDN link in the same file |
   | 5 | `grep -A6` on a clause ID | `citation:` + `web_url:` in the hit window |
   | 6 | file-size scan | every unit readable whole in one `read` |

3. **CI drift guard** — GitHub Actions: `npm ci → test → build → git diff
   --exit-code corpus/`. A toolchain change whose regenerated output doesn't match
   the committed corpus cannot merge. Release zips are cached keyed on
   `checksums.json`.

## Build order

1. **Scaffold** — create `vove-ai/aec-assistant-ncc-data` (public) and push the
   skeleton: docs, fetch + checksum verification, CI, empty corpus. Creating the
   repo first means the CI drift guard is active for every subsequent step. GitHub
   is touched only after this spec is approved.
2. **Pilot slice** — Section C (fire) from Volume One, both editions (~80 units):
   figure-heavy, Standards-heavy, state variations, specifications. Written through
   the full pipeline; `content-model-2022.md` written from what the 2022 reader
   reveals.
3. **Gate** — acceptance suite green on the pilot; format locked.
4. **Bulk** — both editions in full; parity checks against the re-measured unit
   counts in the content-model docs.
5. **Verify consumption** — a Managed Agents session mounts the repo and runs the
   acceptance greps live.

Format changes after the gate require regenerating everything — that is the point of
the gate.

## Licensing

- **Code** (`tools/`, workflow files): MIT, in `LICENSE`.
- **Corpus** (`corpus/`): derivative of Commonwealth of Australia / ABCB material
  under **CC BY 4.0**. The README carries, verbatim, the attribution the ABCB
  read-me requires — *"The National Construction Code 2022 was provided by the
  Australian Building Codes Board under the CC BY 4.0 licence"* (and the 2025
  equivalent) — plus the licence carve-outs (third-party material, trade marks,
  images/photographs).
- **Changes are stated explicitly** — the inverse of `alvar-ncc-data`'s "Changes:
  none": split to one file per clause, markup normalized to markdown, glossary
  references inlined as prose, figure references rewritten to CDN URLs, metadata
  added as frontmatter. Not affiliated with or endorsed by the ABCB;
  ncc.abcb.gov.au remains authoritative.
- Public repo: the source material is CC BY 4.0 and already publicly redistributed
  by `alvar-ncc-data`.

## Open items (resolved during pilot, before the gate)

1. **2022 figure CDN coverage** — do all ~1,000 NCC 2022 SVGs already exist in R2
   under `images/ncc/…`? If not, an upload pass from the zips' `Images/` folders is
   added to scope (script in `tools/`, R2 credentials from the aec-assistant
   environment).
2. **2022 `web_url` derivation** — establish the ncc.abcb.gov.au URL rule for the
   2022 edition (the site's 2022 pages mirror structure the way 2025's do);
   uniqueness asserted the same way.
3. **2022 amendment state** — the ABCB read-me doesn't state it; determine from
   content (e.g. presence of known Amdt 2 provisions) and record in README +
   `corpus/INDEX.md`.
4. **2025 glossary byte-identity across volumes** — RESOLVED, and the premise was
   wrong: **zero** of the 555 shared paths are byte-identical, because `citation:`,
   `web_url:` and the provenance key are per-volume by construction. The question only
   ever had an answer on the BODY, and on that the four documents agree on 545 outright,
   on 9 more once this pipeline's own per-volume figure CDN key is neutralised, and
   disagree on exactly 1. See `content-model-2025.md` § The glossary across volumes.
5. **2022 glossary source location** — locate where the DITA set carries glossary
   definitions (dedicated files vs. references only).

## Risks

| Risk | Mitigation |
|---|---|
| Format proves grep-hostile only after bulk generation | Pilot + executable acceptance gate before bulk |
| Committed corpus drifts from toolchain | CI `git diff --exit-code` guard |
| 2022 DITA holds surprises the 2025 model doesn't cover | Same discipline that fixed 2025: measure, write `content-model-2022.md`, then code against it |
| Silent data loss during parse | Fail-loud walker + unit-count parity checks against content-model measurements |
| Licence misstep on derived Crown content | Verbatim required attribution; changes stated; images stay out of the repo |
| Repo mounted but searched poorly by agents | `AGENTS.md` search contract; acceptance suite doubles as its worked examples |
