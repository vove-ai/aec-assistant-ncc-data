# NCC 2025 v1.2 — XML content model

**Date:** 2026-08-12 (carried into this repo 2026-08-13 from the aec-assistant spec of the same
name; claims re-verified against the XSDs and XML on carry-over — corrections marked ⊕ below)
**Status:** Reference — derived from the XSDs shipped in every v1.2 package
**Source of truth:** the `schema/` XSDs inside each `ncc-2025-*-v1.2.zip` release asset of
`vove-ai/alvar-ncc-data` (tag `ncc-2026-07`), fetched into `.cache/` by `tools/src/fetch.mjs`.
Four files per package: `ncc.xsd` is the entry point, including `ncc-common.xsd`,
`ncc-volume.xsd`, and `ncc-standard.xsd`.

This document exists because the first draft of a previous NCC 2025 ingestion plan modelled the
XML from hand-read fragments and got the containment wrong three separate times. **Derive
structure from the XSDs, not from reading samples.** A `grep -c '<clause'` tells you how many
clause elements exist; it tells you nothing about what contains them, and containment is what a
walker needs. `read-2025.mjs` is written against this model, and the unit tests encode each
trap below as a regression test.

## Two schemas

| package | root element | schema |
|---|---|---|
| Volume One / Two / Three | `<ncc-volume publishing-id="vol1\|vol2\|vol3">` | `ncc-volume.xsd` |
| Housing Provisions, Livable Housing Design | `<ncc-standard publishing-id="housing\|livable">` | `ncc-standard.xsd` |

Both include `ncc-common.xsd`.

## Section level

`<ncc-section id type num>` — `type` is `section`, `schedule`, or `other`. Its permitted children:

```
title · page · part · schedule-part · schedule-spec · schedule-part-variation
      · schedule-referenced-document · specification · ncc-glossary · variation
```

`num` is **not** a unique identity: Housing Provisions uses `2`–`13` for its body sections *and*
`1`–`11` for its schedules. Always pair `num` with `type`.

Schedules 3–11 are jurisdictions (3 Commonwealth, 4 ACT, 5 NSW, 6 NT, 7 QLD, 8 SA, 9 TAS,
10 VIC, 11 WA); 1 is Definitions and 2 is Referenced documents.

## Which elements contain content units

A "content unit" is anything we emit as its own markdown file: `clause`, `clause-variation`,
`standard-clause`, `glossentry`, `glossentry-variation`, `table-reference`.

Types that **directly** contain one, per the XSDs:

| XSD type | element name | directly contains |
|---|---|---|
| `ncc-part` / `standard-part` | `part` | `clause`, `clause-variation` (+ `standard-clause` in the standard schema) |
| `ncc-part-variation` | `part-variation` | `clause`, `clause-variation` |
| `ncc-specification` | `specification` | `clause`, `clause-variation` |
| `ncc-specification-topic` | `spec-topic` | `clause`, `clause-variation` |
| `ncc-subtopic` / `standard-subtopic` | `subtopic` | `clause`, `clause-variation` |
| `ncc-glossary` / `standard-glossary` | `ncc-glossary` | `glossentry`, `glossentry-variation` |
| `ncc-glossentry` | `glossentry` | `glossentry-variation` |
| `ncc-clause`, `ncc-clause-variation`, `ncc-page`, `ncc-callout`, `ncc-content-section`, `ncc-glossdef`, ⊕ `ncc-tracked-content` | various | `table-reference` |

⊕ Corrections from re-verification (2026-08-13, against the v1.2 XSDs directly):

- **`ncc-clause` and `standard-clause` also directly contain `clause-variation`** — a clause can
  carry its own state variation as a child, not only receive one as a sibling. (Confirmed in the
  XML: 2–3 units per document have a `clause-variation` parent chain through a clause.)
- `standard-part-variation` contains `standard-clause` too, same as `standard-part`.
- `standard-clause-relaxed` exists in the standard schema (contains `clause-variation`,
  `table-reference`) and appears in no earlier documentation.
- **XSD *type* names are not XML *element* names.** The element `section` has type
  `ncc-content-section`; `spec-topic` has type `ncc-specification-topic`. Match on element names
  when walking; use this table's element-name column, not the type column.

**`specification` is a sibling of `part`, not a child of it.** A walker that recurses only into
`part` and `page` misses every specification clause.

`table-reference` can appear almost anywhere — inside clauses, pages, callouts, glossary
definitions, content sections, tracked content, and ⊕ even list items (`li`). Do not assume it
sits at one level.

## Measured containment, all five documents

Counts are content units (`clause`, `clause-variation`, `standard-clause`, `glossentry`,
`glossentry-variation`, `table-reference`) by their immediate parent element — single forward
pass with a tag stack. ⊕ Re-measured 2026-08-13; the original table's numbers all reproduced
exactly, but it omitted the low-count parents shown here in full (the sources contain no XML
comments or CDATA, so the tag-stack method is exact):

| document | parents holding units |
|---|---|
| volume-one | `subtopic` 868 · `ncc-glossary` 537 · `clause` 336 · `specification` 251 · `spec-topic` 63 · `glossentry` 19 · `page` 4 · `glossdef` 4 · `li` 3 · `clause-variation` 2 · `callout` 2 |
| volume-two | `ncc-glossary` 537 · `subtopic` 193 · `clause` 68 · `specification` 42 · `glossentry` 19 · `spec-topic` 5 · `glossdef` 4 · `page` 3 · `li` 3 · `section` 1 · `callout` 1 · `clause-variation` 1 |
| volume-three | `ncc-glossary` 537 · `subtopic` 290 · `clause` 98 · `specification` 34 · `glossentry` 19 · `callout` 6 · `spec-topic` 5 · `page` 4 · `glossdef` 4 · `clause-variation` 1 |
| housing-provisions | `ncc-glossary` 537 · `part` 319 · `clause` 246 · `glossentry` 19 · `callout` 6 · `li` 5 · `glossdef` 4 · `clause-variation` 3 · `page` 2 · `section` 1 |
| livable-housing-design | `part` 15 · `section` 1 · `page` 1 |

`subtopic` is the dominant container in Volumes One–Three and appears nowhere in the plan's
original design. Housing Provisions and Livable Housing put clauses directly under `part`, which
is why a design validated only against those two looks correct and still loses three volumes.

⊕ The re-measurement is itself an argument for the walker rule below: even the original
*measured* table — made while staring at the data — missed six parent categories. Whitelists
lose; recursion doesn't. Use these full counts as the bulk-run parity targets, and note that
`glossentry` 19 appears in **all four** glossary-bearing documents, not only volume-one.

## Consequence for the walker

Do not whitelist container elements. Walk every element child recursively, carrying context down,
and emit when the element is a content unit. Context to carry:

- **section** — `num`, `type`, `title` (from the nearest `ncc-section` ancestor)
- **part-level container** — the nearest `part` / `part-variation` / `specification` /
  `schedule-part` / `schedule-spec` ancestor, keeping its `num` and `title`. A `specification`
  with `num="1"` is the container for clauses `S1C1`, `S1C2`, …
- **variation state** — `state` from a `variation` / `clause-variation` / `part-variation`
  ancestor, if any

## Consequence for web_url resolution

The website mirrors this structure, so URL depth mirrors XML depth:

| URL | XML |
|---|---|
| `/volume-one/a-governing-requirements` | `<ncc-section type="section" num="A">` |
| `/volume-one/a-governing-requirements/part-a1-interpreting-ncc` | `<part num="A1">` in section A |
| `/volume-one/a-governing-requirements/1-fire-resistance-building-elements` | `<specification num="1">` in section A |
| `/housing-provisions/5-new-south-wales/31-scope-and-application-section-3` | NSW schedule variation of Part 3.1 |

So a depth-2 page's key is the **leading token of its second path segment after stripping an
optional `part-` prefix**, scoped to its parent section — `a\|a1`, `a\|1`, `5\|31`. Keying parts
globally instead of per section makes `a6` (Part A6) collide with the South Australia schedule's
amended `a6`, and indexing only `part-`-prefixed segments drops **454 of the file's 665 URLs**,
including every specification and every state variation.

Slugs drop stopwords ("Interpreting the NCC" → `interpreting-ncc`), so a slug can never be
computed from a title. It can be *checked* against one: the slug's tokens are always a subset of
the title's tokens, which is enough to disambiguate Housing Provisions' colliding section numbers
(`2-structure` vs `2-referenced-documents`).

## The glossary across volumes (measured 2026-08-14, all five documents)

Volumes One–Three and the Housing Provisions each embed the **whole** glossary — 556 `glossentry`
/ `glossentry-variation` units per document, on **555** distinct corpus paths, the odd one out
being "Appropriate authority", which the Code genuinely defines twice (R23). Livable Housing
Design has no glossary at all.

So one file under `{edition}/glossary/` is claimed by four documents, and the question the design
doc left open was whether their copies are identical. **They are not — not one of the 555 is
byte-identical**, and that is a property of this pipeline rather than of the Code: `citation:`
carries the volume prefix and `web_url:` the volume path, so provenance differs by construction.
The question only has an answer on the normalized BODY. On that:

| class | paths | what differs |
|---|---|---|
| identical | **545** | nothing |
| identical once our own figure CDN key is neutralised | **9** | `…/2025/volume1/x.svg` against `…/2025/volume2/x.svg` — the same figure, addressed under the emitting document's `cdnKey`. Each package ships its own copy of the image, so this is our artefact, not a difference the ABCB publishes. The nine: `alpine-area`, `cell-type-silo-sa`, `climate-zone`, `defined-flood-level-dfl`, `flight`, `floor-area`, `foundation`, `sanitary-compartment`, `separating-wall`. |
| genuinely different text | **1** | `hours-of-operation` |

**The one real divergence is an ABCB typo.** Volume One and the Housing Provisions read "The number
of hours when the occupancy of the building **is at least 20%** of the peak occupancy"; Volumes Two
and Three read "**is greater thanat least 20%**" — an unresolved edit, the words "greater than"
left butted against the replacement. Neither wording can be dropped: an agent citing the definition
to a Volume Two matter must see what Volume Two publishes.

**Consequence for the build (R33).** `foldGlossary` in `build.mjs` emits one file per path:

- one body class → the FIRST document's copy in `DOCUMENTS_2025` order, cited and linked to that
  document, with `sources: [volume-one, volume-two, volume-three, housing-provisions]` in place of
  `volume:`;
- more than one → one file carrying every variant under a `## As published in …` heading naming
  the documents behind it, so a term grep shows the discrepancy instead of one arbitrary volume's
  wording.

Verified before pointing the nine at Volume One's CDN key: all 10 figure files those entries embed
exist in `ncc-2025-volume-one-v1.2/images/` (and, as it happens, in all four packages).
`sync-figures` re-checks it over the whole corpus on every run — 0 unresolved local sources.

## ⊕ Identity and naming traps (measured 2026-08-13)

Paid-for lessons from a prior implementation against this same corpus, found and fixed *after*
the sections above were written. Each must hold in `read-2025.mjs` / `emit.mjs` and carry a
regression test:

1. **Variation state must thread into *every* filename derivation — containers and tables, not
   just clauses.** A walker that resolves a `variation` state for descent but derives container
   (part/page overview) and table filenames without it emits the state-specific unit onto the
   national filename. Consequence measured on the real corpus: Volume Two Part H6's NSW
   "does not apply in NSW" overview was silently overwritten by the national body —
   last-write-wins data loss with zero warnings. Every emit path takes the resolved state.
2. **Glossary term slugs are not injective.** Six symbol-only terms (`°`, `%`, `>`, `<`, `≤`,
   `≥`) slugify to the empty string and collapse onto one filename; `µm` collides with `m` once
   the non-ASCII character is dropped. Fix: fall back to a content hash of the full term when the
   slug is empty or the term contains non-ASCII; ordinary ASCII terms keep plain slugs. Even
   then, injectivity holds only for these measured collision classes — terms differing solely by
   case or surrounding whitespace would still collide, so the build asserts filename uniqueness
   rather than trusting the scheme.
3. **Read each element's *own* `state` attribute, with inheritance as fallback**
   (`el.getAttribute('state') || inherited`), on every element type including `page`. No v1.2
   `page` carries one today (0 of 76), but a branch that reads only the inherited state silently
   drops the attribute if a future revision adds it — the same defect class as trap 1.
4. **Assert global filename uniqueness at build time.** Traps 1 and 2 both surfaced as silent
   overwrites; a uniqueness check turns the whole defect class from data loss into a build
   failure.
