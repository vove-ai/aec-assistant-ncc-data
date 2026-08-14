# NCC 2022 — XML content model

**Date:** 2026-08-14
**Status:** Reference — measured, not inferred
**Source of truth:** the four `ncc-2022-*.zip` release assets of `vove-ai/alvar-ncc-data`
(tag `ncc-2026-07`, SHA-256 verified in `tools/checksums.json`), extracted by
`tools/src/fetch.mjs` to `.cache/extracted/ncc-2022-{volume-one,volume-two,volume-three,housing-provisions}/`.
There are **no XSDs** in the 2022 packages — unlike 2025, where `content-model-2025.md` could be
derived from a schema. Everything below therefore comes from a command run against the 11,331
XML files themselves. Where a measurement contradicts something previously written down, the
measurement wins and the contradiction is marked ⊕.

This document plays the same role for `read-2022.mjs` that `content-model-2025.md` played for
`read-2025.mjs`: it exists so the walker is written against measured containment instead of
hand-read fragments. The 2025 walker needed three corrections because three of its rules were
guessed. **The 2022 format shares almost no structural assumption with 2025** — different file
layout, different table vocabulary, different variation mechanism, different figure join — so a
walker written by analogy will be wrong in more places than it is right.

> **Read §1 before anything else.** The single most consequential fact about these packages is
> not in the brief, was not known when the plan was written, and changes what "the 2022 corpus"
> means.

---

## 1. ⊕ These are 2022/2025 dual-state editorial files, not a published NCC 2022 snapshot

Every one of the four packages carries the **NCC 2022 text as its base layer and the NCC 2025
draft edits on top as tracked changes**. Taking element text at face value (`textContent`)
produces a document that is neither edition.

Evidence, in the order it was found:

**a. The package manifest says 2025.** Each package's `XMLs/FlattenedFile.xml` has:

```xml
<abcb-map adoption="Adopted by States and Territories from 1 September 2022."
          document-type="NCC" footer-text="NCC 2025 Volume One - Building Code of Australia"
          publishing-id="vol1" publishing-year="2025" short-title="Volume One"
          start-state-based-schedule-at="3">
  <title>NCC 2025 Volume One - Building Code of Australia Class 2 to 9 buildings</title>
```

`publishing-year="2025"` in all four. Housing Provisions reads
`footer-text="ABCB Housing Provisions Standard 2025"`.

**b. The copyright page is mid-edit.** Verbatim from the same file:

```xml
<p>© Commonwealth of Australia … 202<xt:delText …>2</xt:delText><xt:insText …>5</xt:insText>,
   published by the Australian Building Codes Board</p>
…licensed under a Creative Commons Attribution<xt:delText …>-NoDerivatives -</xt:delText>
   4.0 International licence…
```

Reject the insertions and it reads "2022 … Attribution-NoDerivatives 4.0". Accept them and it
reads "2025 … Attribution 4.0".

**c. The tracked edits are all dated after NCC 2022 was published.**

| package | `xt:insText` | `xt:delText` | edit years |
|---|---|---|---|
| volume-one | 12550 | 7295 | 2021 15 · 2024 14523 · 2025 3175 |
| volume-two | 12655 | 6289 | 2021 8 · 2024 13453 · 2025 2633 |
| volume-three | 13280 | 8153 | 2021 9 · 2024 15516 · 2025 2985 |
| housing-provisions | 12555 | 6559 | 2021 14 · 2024 13487 · 2025 2506 |

**d. The accepted view converges on the published 2025 corpus; the base view does not.**
Matching clauses by `sptc` against the verified `ncc-2025-*/contents.xml` already in `.cache/`,
over clauses with a net tracked-text change:

| package | clauses compared | accepted closer to 2025 | base closer | mean Jaccard base → accepted |
|---|---|---|---|---|
| volume-one | 180 | 157 | 17 | 0.4855 → 0.6500 |
| volume-two | 27 | 23 | 3 | 0.5182 → 0.6034 |
| volume-three | 81 | 69 | 9 | 0.2914 → 0.5469 |
| housing-provisions | 27 | 24 | 3 | 0.4669 → 0.5940 |

A worked case — `A4G1-referenced-documents.xml`, similarity 0.361 base vs **0.859** accepted:

- **base:** "A reference in the NCC to a document refers to the edition or issues and any
  amendment listed in Schedule 2."
- **accepted:** "…listed in Schedule 2; **or the register of alternative referenced documents**."
- **published 2025:** identical to accepted.

The register of alternative referenced documents is an NCC 2025 addition. The base text is the
NCC 2022 wording.

**Consequence for Task 10.** The 2022 corpus must be built from the **base view**: drop text
inside `xt:insText` ranges, restore text inside `xt:delText` ranges. This is not a rendering
nicety — it decides which law the corpus states.

**The accepted view is a *draft*, not published NCC 2025.** Zero clauses in any package match
the published 2025 text exactly. `A2G2` accepted reads "Subject to (5), a Performance Solution
is achieved by…"; published 2025 has no such words. Do not use these packages as a 2025 source —
that is what the `ncc-2025-*-v1.2` packages are for.

### 1.1 Three tracked-change mechanisms, not one

A reader who handles only the obvious one will corrupt the corpus in two different ways.

**Mechanism 1 — milestone pairs (dominant).** `xt:insText` / `xt:delText` as **empty,
self-closing** elements bracketing a run of sibling text:

```xml
<li>…<xt:insText xt:action="start" xt:author="Jerome Samuel" xt:dateTime="2024-02-27T10:49:00"
       xt:id="fbd687eb-6b91-43ac-aab2-024fc64a8883"/>except for
     <xref …>threshold ramps</xref>, <xref …>step ramps</xref> and <xref …>kerb ramps</xref>,
     <xt:insText xt:action="end" xt:id="fbd687eb-6b91-43ac-aab2-024fc64a8883"/>be provided with…</li>
```

Volume-one counts: `xt:insText` start 6168 / end 6168; `xt:delText` start 3575 / end 3574.
Ranges are matched by `xt:id` and **cross element boundaries**, so they must be tracked with a
depth counter over a document-order traversal, not by recursing into the element.

> **This is the trap that makes the whole thing look benign.** Treat `xt:insText` as a container
> — the intuitive reading — and it has no text content, so base and accepted views come out
> *identical* and the file looks like clean 2022. That is exactly what happened on the first
> pass here: 180 vol-one clauses compared, 0 differences detected. The one unbalanced
> start/end id per package (1 in each) means the counter must clamp at zero rather than assert.

**Mechanism 2 — container form (rare).** The same element names *with* text content and **no**
`xt:action`: vol-one `xt:insText` 211, `xt:delText` 146. Children observed: `xref` (up to 6),
`sub`, `sup`, and one nested `xt:delText > xt:insText ×6`.

**Mechanism 3 — element-level attributes.** `type="insert"` / `type="delete"` with `author` and
`dateTime`, in namespace `urn:xpressauthor:trackchanges`. **The prefix varies within a single
corpus** — vol-one uses `xt:` 7610 times, `ns0:` 303, and unprefixed 221 — so match on the
namespace URI and local name, never on a literal `xt:type`.

Volume-one: `insert` 4734, `delete` 3400, by year 2020 4 · 2021 214 · 2022 20 · 2024 6391 ·
2025 1505. The year splits the two editorial cycles cleanly: **≤2022 = NCC 2022 cycle (already
accepted into the published 2022 text, keep in the base view); ≥2024 = NCC 2025 draft (drop from
the base view).** Carried by 39 distinct element names, the top being `entry` 2326, `li` 1669,
`row` 688, `p` 524, `ol` 477, `xref` 410, `title` 240, `clause` 129, `subtopic` 10, `topicset` 1.

Section K "Embodied carbon emissions reduction" exists only through this mechanism —
`<topicset … ns0:type="insert" ns0:dateTime="2024-10-25T15:53:30" section-num="Section K">`.
NCC 2022 has no Section K, and a walker ignoring mechanism 3 will publish one.

### 1.2 ⊕ Identity elements are themselves tracked-changed

`sptc`, `title` and `archive-num` carry tracked changes. Reading them with `textContent`
concatenates the 2022 value and its 2025 replacement into a string that is not a clause ID in
any edition:

| file | `textContent` | correct 2022 `sptc` | 2025-draft `sptc` |
|---|---|---|---|
| `B1P4-buildings-in-flood-areas.xml` | `B1P43` | `B1P4` | `B1P3` |
| `B1P3-glass-installations-human-impact.xml` | `B1P32` | `B1P3` | `B1P2` |
| `F1D12-roof-coverings.xml` | `F3D2F1D12` | `F1D12` | `F3D2` |

Root-element counts where base ≠ accepted, per package:

| package | `sptc` | `title` | `archive-num` |
|---|---|---|---|
| volume-one | 79 / 1554 | 159 / 2374 | 66 / 1554 |
| volume-two | 68 / 1341 | 143 / 2098 | 55 / 1341 |
| volume-three | 96 / 1424 | 169 / 2249 | 57 / 1424 |
| housing-provisions | 74 / 1399 | 146 / 2437 | 55 / 1399 |

(`title` is counted over every root that has one — clause, part, specification, page,
image-reference, table-reference — hence the larger denominator.)

### 1.3 The base `sptc` is also the edition-membership signal

Classifying every root `clause` file by its base and accepted `sptc`:

| package | unchanged | renumbered | 2022-only (deleted in the 2025 draft) | **2025-only (base `sptc` empty)** |
|---|---|---|---|---|
| volume-one | 1475 | 20 | 27 | **32** |
| volume-two | 1273 | 20 | 19 | **29** |
| volume-three | 1328 | 34 | 27 | **35** |
| housing-provisions | 1325 | 22 | 19 | **33** |

The 2025-only files are entirely new clauses: base body ≈ **9 characters** (the residue of the
boilerplate `<title>SubClause</title>`) against 100–2000 characters accepted. Examples:
`B1P4-Isolation.xml`, `B7D5 Access.xml`,
`11-2-7-Fixed-platforms-walkways-stairways-and-ladders-for-Class-10b-structures.xml`.
**These clauses do not exist in NCC 2022 and must not be emitted into the 2022 corpus.**
Conversely the 2022-only files (`2-3-1-scope-WA.xml`, base 206 chars / accepted 0) *do* belong.

---

## 2. Root-element census (Step 1)

DOM parse, root element only, across every `XMLs/**/*.xml` in all four packages. **Nine** root
kinds — the brief expected four.

| root / `outputclass` | vol-one | vol-two | vol-three | HP | total |
|---|---|---|---|---|---|
| `abcb-glossentry` / `abcb-glossentry` | 543 | 544 | 543 | 543 | 2173 |
| `abcb-map` / *(none)* | 4 | 4 | 4 | 4 | 16 |
| `clause` / `ncc-clause` | 1554 | 1341 | 1424 | 1399 | 5718 |
| `image-reference` / *(none)* | 229 | 194 | 229 | 336 | 988 |
| `page` / `page` | 26 | 21 | 24 | 7 | 78 |
| `part` / `ncc-part` | 81 | 56 | 61 | 37 | 235 |
| `part` / `standard-part` | 12 | 12 | 16 | 64 | 104 |
| `specification` / `specification` | 49 | 42 | 42 | 41 | 174 |
| `table-reference` / *(none)* | 419 | 428 | 449 | 549 | 1845 |
| **total** | **2917** | **2642** | **2792** | **2980** | **11331** |

0 parse failures. Note `@xmldom/xmldom` 0.9 rejects the old `errorHandler` option object — pass
`{ onError }` or nothing.

**Routing rule for `read-2022.mjs`: branch on root element name + `outputclass`.** It is exact,
and a second independent signal agrees with it perfectly: every file carries a processing
instruction `<?Xpress productLine="…"?>` whose value matches the root kind 1:1 for the six kinds
that have one (`abcb-glossentry` 2173, `ncc-clause` 5718, `page` 78, `ncc-part` 235,
`standard-part` 104, `specification` 174). `abcb-map`, `image-reference` and `table-reference`
carry no PI, which is why the PI cannot be the primary rule.

**Which kinds are units and which are supporting material:**

| category | roots | note |
|---|---|---|
| content units | `clause/ncc-clause`, `abcb-glossentry`, `page/page` | one corpus file each |
| containers (overview + membership) | `part/ncc-part`, `part/standard-part`, `specification/specification` | carry `num`, `title`, `intro-part`, and `clauseref` pointers to their own clauses |
| referenced, not mapped | `table-reference`, `image-reference` | pulled in by `conref` from the unit that cites them; they carry no `sptc` and no `clauseref` points at them, so they are not clause-level members of any publication |
| publication maps | `abcb-map` (`FlattenedFile.xml`, `glossary-map-{glossary,abbreviations,symbols}.xml`) | see §4 |

Root attributes actually observed (`xmlns:*` omitted):

```
clause/ncc-clause         id outputclass variation type author dateTime
part/ncc-part             id outputclass variation Buddy_ElementBookmark
part/standard-part        id outputclass variation
specification             id outputclass variation
page/page                 id outputclass variation frontCoverImagePage backCoverImagePage
abcb-glossentry           id outputclass variation
image-reference           id variation type author dateTime
table-reference           id variation type author dateTime graph orientation
abcb-map                  id publishing-id publishing-year document-type industry short-title
                          footer-text adoption start-state-based-schedule-at
```

`variation` appears on **every** root kind. That is the state marker — see §5.

### 2.1 ⊕ Three files per package are not where a flat `readdir` looks

`XMLs/` is not flat. Each package contains three *directories* whose names are the first half of
a glossary term containing a literal `/`:

```
XMLs/glossary-CO2-e/m2.hr.xml      (term "CO2-e/m2.hr")
XMLs/glossary-Wp/m2.xml            (term "Wp/m2")
XMLs/glossary-µg/N.s.xml           (term "µg/N.s")
```

All three are `abcb-glossentry` roots, present in all four packages and byte-identical across
them. `fs.readdirSync(dir).filter(f => f.endsWith('.xml'))` silently loses three glossary
definitions per package and throws `EISDIR` if it does not filter. **Enumerate recursively.**

(Two of the three — `CO2-e/m2.hr` and `Wp/m2` — turn out to be 2025-only entries anyway, see
§7. That does not make the trap harmless: `µg/N.s` is NCC 2022 content, and the recursion bug
is silent either way.)

Note also that filenames contain spaces (`B6D6 Isolation.xml`), commas and en-dashes
(`image-S37C8-…shading–measurement-of-D,-W-and-H.xml`), parentheses, and one file literally
named `footnote-VIC-other-legislation-affecting-buildings Copy.xml`. Do not drive file handling
from a shell glob.

---

## 3. Package overlap (Step 2)

⊕ **Corrected.** The plan records 3,973 distinct filenames, 2,387 in all four, 615
byte-identical. Measured recursively the figures are **3,976 / 2,390 / 618** — exactly +3 in
each, which is the three nested glossary files of §2.1. The unique-to-one figures are unaffected
and reproduce exactly.

| measure | value |
|---|---|
| distinct filenames across the four packages | **3976** |
| present in 4 packages | **2390** |
| present in 3 | 46 |
| present in 2 | 93 |
| present in 1 | **1447** (vol-one 480 · vol-two 190 · vol-three 274 · HP 503) |
| of the 2390: byte-identical as shipped | **618** |

**⊕ The "differing" 1,772 are almost all an artefact.** Every local `xref`/`conref`/`image`
href embeds a per-package publishing-session UUID:

```
vol-one  /tmp/QppServer/Publishing/5e2c1f63-e589-4ce1-95e8-5c3e286a7aff/…   17559 hrefs
vol-two  /tmp/QppServer/Publishing/4617886e-5039-467a-af01-51c52a632ec7/…   16731
vol-three/tmp/QppServer/Publishing/4006dc0a-bedb-452c-9d00-fd812bcad672/…   17261
HP       /tmp/QppServer/Publishing/741c87ec-bc25-4bea-b810-b822021a9f96/…   18580
```

Canonicalise that UUID and of the 2,390 shared names **2,276 are identical** and only **114**
genuinely differ. Of those 114, the NCC 2022 **base text** is identical across all four in 100
cases; only **14** differ in 2022 content:

```
10-8-1-external-wall-construction.xml · 11-3-5-handrails.xml
B1D1-deemed-to-satisfy-provisions.xml · C2D1-deemed-to-satisfy-provisions.xml
E3D5-emergency-lifts.xml · FlattenedFile.xml
J6D12-unitary-air-conditioning-equipment.xml
S38C3-spandrel-panel-r-value-calculation-method-2.xml
S46C2-calculation-of-fan-performance-ratio-BROKEN.xml
S47C2-calculation-of-climate-specific-part-load-value-for-chillers.xml
S5C24-fire-resistance-of-building-elements-type-c.xml · introduction-WA.xml
table-1-schedule-of-referenced-documents.xml
table-10-8-3-roof-space-ventilation-requirements.xml
```

(Yes, one is shipped with `-BROKEN` in its filename.)

Per-kind overlap, keyed on root element:

| kind | distinct names | in all 4 | byte-identical | unique to one |
|---|---|---|---|---|
| `abcb-glossentry` | 544 | 543 | 324 | 1 |
| `abcb-map` | 4 | 4 | 0 | 0 |
| `clause/ncc-clause` | 2152 | 1166 | 126 | 933 |
| `image-reference` | 405 | 181 | 0 | 193 |
| `page/page` | 49 | 3 | 0 | 29 |
| `part/ncc-part` | 112 | 37 | 2 | 69 |
| `part/standard-part` | 64 | 12 | 0 | 48 |
| `specification` | 51 | 41 | 0 | 10 |
| `table-reference` | 595 | 403 | 166 | 164 |

**Consequence.** Presence of a file in a package's `XMLs/` does **not** mean it belongs to that
publication — `XMLs/` is a shared authoring pool. Volume Two ships 2,642 files but its
publication contains 238 clauses. Volume attribution must come from the map (§4), not from
package membership. The plan's "read each package as its own publication" still holds, but
whoever implements it should know it would emit the same clause up to four times unless
membership is resolved.

---

## 4. Section and container derivation — `FlattenedFile.xml` (Step 3)

2022 has no `<ncc-section>` to inherit from. Section, part and specification context comes from
the package's `FlattenedFile.xml`, an `<abcb-map>` DITA map that is the publication's spine.

```xml
<abcb-map publishing-id="vol1" publishing-year="2025" …>
  <title>NCC 2025 Volume One …</title>
  <topichead format="dita" navtitle="Preface">
    <page frontCoverImagePage="Yes" outputclass="page"><title>Front Cover - Volume One</title>…
  <topicset format="dita" navtitle="Governing requirements" section-num="Section A"
            summary="The Governing Requirements provide the rules and instruction…">
    <part outputclass="ncc-part"><num>A1</num><title>Interpreting the NCC</title>
      <intro-part><p>…</p></intro-part>
      <subtopic subtopic-type="governance">
        <clauseref outputclass="clausref-ncc">
          <clause conref="A1G1-scope-of-ncc-volume-one.xml"
                  id="_d5df8293-6dd2-4b03-ad7d-dfd446a4ef7b" outputclass="ncc-clause">
            <sptc/><title/><archive-num/>
          </clause>
        </clauseref>
```

- **Section** = the nearest `topicset` ancestor's `@section-num` + `@navtitle`
  (`topichead` is the untitled front-matter grouping).
- **Part / specification** = `topicset > part | specification`, with `num` and `title` as
  *child elements*, not attributes.
- **`subtopic`** groups clauserefs inside a part, exactly as in 2025.
- **The clause stub is empty.** `<sptc/><title/><archive-num/>` are placeholders; the real
  values are in the target file. The stub's `@id` does equal the target's root `@id`
  (vol-one 1215/1217, vol-two 267/267, HP 320/320).
- **`conref` here is a bare filename** relative to `XMLs/`. (Everywhere *else* in the corpus
  `conref` is a publishing-session path — see §6.)

Outlines, which is how we know the maps are complete and correct rather than truncated:

| package | sections (clauserefs) | total |
|---|---|---|
| volume-one | A 74 · B 21 · C 139 · D 101 · E 165 · F 160 · G 126 · I 282 · J 117 · **K 4** · Sch 1 0 · Sch 2 0 | 1189 |
| volume-two | A 74 · H 164 · Sch 1 0 · Sch 2 0 | 238 |
| volume-three | A 74 · B 128 · C 85 · D 7 · E 52 · Sch 1 0 · Sch 2 0 | 346 |
| housing-provisions | 2 12 · 3 11 · 4 25 · 5 40 · 6 12 · 7 31 · 8 15 · 9 23 · 10 56 · 11 17 · 12 15 · 13 35 · Sch 1 0 · Sch 2 0 | 292 |

Volume Two really does contain only 238 clauses — its technical detail lives in the Housing
Provisions standard. Section K is the 2024 tracked insertion of §1.1 and is **not** NCC 2022.
Schedules 1 (Definitions) and 2 (Referenced documents) hold no clauserefs: Schedule 1 is the
glossary, carried inline in the map as 543 `abcb-map > abcb-glossentry` elements, and
Schedule 2 is a table.

`part` and `specification` files are **self-contained mini-maps** of their own contents —
`part/standard-part: clauseref+num+title ×91`, `specification: clauseref+num+title ×157` — so a
part's clause list can be had without the map. Only `topicset` (the section) is map-only.

### 4.1 ⊕ Neither membership signal is complete — reconcile both, fail loud

Two independent rules for "does this clause belong to NCC 2022":

- **A** — reachable from `FlattenedFile.xml` walked in base mode (drop `type="insert"` dated ≥2024).
- **B** — the clause file's own base `sptc` is non-empty (§1.3).

| package | A (mapped, 2022 view) | A (marked 2025-insert) | B (non-empty base sptc) | A says 2022, B says no | A says 2025, B says 2022 | conref target absent |
|---|---|---|---|---|---|---|
| volume-one | 1164 | 23 | 1522 | 0 | **5** | 0 |
| volume-two | 238 | 0 | 1312 | 0 | 0 | 0 |
| volume-three | 344 | 0 | 1389 | **9** | 0 | **4** |
| housing-provisions | 288 | 4 | 1366 | 0 | 0 | 0 |

Both exceptions are explicable and both matter:

- **vol-one, 5 files** (`F1D12-roof-coverings.xml`, `F1D13`, `F1D14`, `F1D15`, `F1V1-weatherproofing.xml`).
  Part F1 was re-parented in the 2025 draft, so the map holds only the *new* clauseref, marked
  `ns0:type="insert" ns0:dateTime="2024-03-15"`. The old location was removed outright rather
  than marked deleted, so the map's base view loses a clause that genuinely is in NCC 2022.
  **The map under-counts.**
- **vol-three, 9 files** (`B1P4-Isolation.xml`, `B2P5-Isolation.xml`, … all `*Isolation.xml`).
  Their clauserefs carry no `type="insert"`, but the file's whole `sptc`/`title`/`num`/`p` sit
  inside `xt:insText` ranges dated 2024-08-26. **The map over-counts.**
- **vol-three, 4 conref targets are literally broken:**
  `ERROR_IN_RESOLVING_URI:B7D2-general-requirements.xml`,
  `…:B7D4-access-and-isolation.xml`, `…:B7D6-top-up-lines.xml`,
  `…:C3P10-domestic-on-site-wastewater-treatment-systems-TAS.xml`.

**Recommended rule** (a recommendation, not a measurement): take **membership from B** (it is
derived from the content itself and is the more reliable of the two), take **order and
section/part context from A**, and **assert on every disagreement**. The disagreement set is 14
files out of 2,034 mapped clauserefs — small enough to enumerate in a test fixture, large enough
to lose silently.

---

## 5. State variations (Step 3)

**⊕ The 2022 mechanism is a separate file per state, reached by a pointer. This is nothing like
2025, where `clause-variation` holds the varied text inline.** In 2022 `clause-variation` is an
*empty pointer*:

```xml
<clause id="_4a54b161-…" outputclass="ncc-clause">
  <sptc>13.2.3</sptc><title>Roofs and ceilings</title>…
  <clause-variation href="/tmp/QppServer/Publishing/5e2c1f63-…/8077_0.4.0.xml"
                    variation="NSW" variation-type="REPLACE">NSW REPLACE Clause</clause-variation>
```

Its `href` is an unresolvable publishing-session path and its text is boilerplate. The varied
text lives in `13-2-3-roofs-and-ceilings-NSW.xml`.

**Tables vary the other way.** `table-variation` *is* a container with the full varied table
inline (16 across the four packages):

```xml
<table-reference id="_50139621-…">
  <table-variation graph="None" variation="NSW" variation-type="REPLACE">
    <title>NSW REPLACE Table</title><table …><tgroup cols="2">…
```

That inconsistency is a trap in itself: one rule cannot serve both.

### 5.1 Which signal is authoritative

Censused both ways over every file, with a suffix regex permitting `-`, `_`, or no separator and
an optional trailing digit:

| package | both present, **agree** | filename suffix only | `@variation` only | **disagree** |
|---|---|---|---|---|
| volume-one | 584 | 4 | 9 | **0** |
| volume-two | 365 | 5 | 9 | **0** |
| volume-three | 432 | 7 | 8 | **0** |
| housing-provisions | 375 | 4 | 1 | **0** |

**They never disagree — but neither is complete.**

- **`@variation` misses 4–7 per package.** `B1D4-…-WA.xml`, `B1P5-pressure-TAS.xml`,
  `J8D4-…-NSW.xml`, `table-10-7-1-…-NT.xml` carry no root `@variation` yet are unambiguously
  state text — `B1P5-pressure-TAS.xml` has `<archive-num>2019:BP1.2, TAS Exemption 1</archive-num>`.
- **The filename suffix misses 1–9 per package**, because the state is not always a suffix:
  `footnote-NSW-other-legislation-affecting-buildings.xml` (middle),
  `I10D3-construction-of-body-preparation-room_TAS.xml` (underscore),
  `I15D1-application-of-part-premisesTAS.xml` (no separator at all),
  `table-SA-1-farm-building-categories-and-maximum-floor-area.xml` (the "SA" is part of the
  table number *and* the file carries `variation="SA"`).

**Take `@variation` as authoritative** — it is explicit, typed, and never wrong where present —
**and assert that a filename-derived state, where one is derivable, agrees with it.** That check
passes on 584/584 in vol-one today. The 4–7 attribute-less files must be handled by an explicit,
enumerated exception list, not by silently trusting the filename: a rule loose enough to catch
`I15D1-…premisesTAS.xml` also catches `table-SA-1-…`.

States observed: NSW, VIC, QLD, SA, WA, TAS, NT, ACT. `variation-type` ∈ {REPLACE, INSERT,
DELETE}, and it never appears on a root — only on the pointer and sub-unit elements.

### 5.2 Sub-clause level variation

`subclause` carries `@variation` + `@variation-type`, and its boilerplate `<title>` restates
them. Across all four packages the title values are:

```
"SubClause" 11520 · "NSW REPLACE SubClause" 94 · "SA INSERT SubClause" 74 · "VIC REPLACE SubClause" 53
"SA REPLACE SubClause" 52 · "TAS INSERT SubClause" 24 · "QLD INSERT SubClause" 17
"VIC INSERT SubClause" 17 · "TAS REPLACE SubClause" 17 · "QLD REPLACE SubClause" 16
"NSW INSERT SubClause" 12 · "WA REPLACE SubClause" 12 · "NT REPLACE SubClause" 9
"WA INSERT SubClause" 1 · "VIC DELETE SubClause" 4 · (empty) 35
```

Cross-check: for vol-one, `"<STATE> <TYPE> SubClause"` rebuilt from the attributes equals the
title in **98 of 98** cases, 0 mismatches. Either may be read; read the attributes.

**`<title>SubClause</title>` is boilerplate and must never be rendered.** It is the 2022 analogue
of nothing in 2025 and will otherwise appear 11,520 times in the corpus.

### 5.3 Clause-variation pointers do not fully resolve

Of the `clause-variation` pointers in root clause files:

| package | pointers | resolved by sibling `<stem>-<STATE>.xml` | resolved by `sptc` + `@variation` | **unresolved** |
|---|---|---|---|---|
| volume-one | 149 | 87 | 29 | **33** |
| volume-two | 131 | 76 | 20 | **35** |
| volume-three | 145 | 86 | 22 | **37** |
| housing-provisions | 136 | 73 | 25 | **38** |

**Unresolved — open question.** Examples: `B1D6-construction-buildings-flood-hazard-areas.xml`
declares SA and QLD variations with no SA or QLD file anywhere in the package;
`13-2-4-roof-lights.xml` declares NSW with no `13-2-4-roof-lights-NSW.xml`. Roughly 22–28% of
declared state variations have no locatable content in these packages. I could not resolve this
and did not paper over it: the `href` is a publishing-session path that does not exist on disk
(vol-one: 118 session paths, 30 with no href at all, 1 `ERROR_IN_RESOLVING_URI`), and no
name- or sptc-based join reaches a file.

Two readings are possible and I cannot distinguish them from the packages alone: either the
variation content was never exported, or the pointer is stale. **Task 10 should count these,
report them, and not fail the build on them** — but the corpus will be missing those state
variations and the count belongs in the build output.

---

## 6. The figure join (Step 4)

⊕ The brief describes prose carrying `<image-reference conref=…>` and a wrapper file carrying
`<image alt href width>`. That is right, but **the `conref` is not the join key** — it is a
publishing-session document path (`/tmp/QppServer/Publishing/<uuid>/802_0.8.0.xml`) that matches
nothing on disk. Resolving on it yields 0 of 231.

**The join key is `@id`.** The inline `<image-reference>`'s `id` equals the wrapper file's root
`id`:

| package | inline `image-reference conref=…` | joined by `@id` | not joined |
|---|---|---|---|
| volume-one | 231 | **231** | 0 |
| volume-two | 197 | **197** | 0 |
| volume-three | 232 | **232** | 0 |
| housing-provisions | 341 | **340** | **1** |

The single miss is `10-2-28-installation-of-internal-membranes.xml`, whose `conref` is
`ERROR_IN_RESOLVING_URI:10-2-28-typical-shower-construction.xml` and whose `@id`
(`_d39a8101-913e-4512-b1c6-75e22589d395`) matches no wrapper — another shipped-broken reference.

Five verified chains from volume-one:

```
10-6-2-ventilation-requirements.xml
  <image-reference id="_8c5460ea-4e5c-4974-9493-8eec9c23ee8f" conref="/tmp/QppServer/…">
  → image-10-6-2-method-of-determining-areas-of-openings-for-borrowed-ventilation.xml
  → <image alt="Method of determining areas of openings for borrowed ventilation."
           href="/tmp/QppServer/…/10-6-2-method-of-…-ventilation.svg" width="1200" height="…"/>
  → Images/image-10-6-2-method-of-determining-areas-of-openings-for-borrowed-ventilation.svg

10-6-3-location-of-sanitary-compartments.xml   id=_738d9830-962d-4e65-b21a-c7f902217fba
  → image-10-6-3-acceptable-location-of-non-mechanically-ventilated-sanitary-compartment.xml
  → Images/image-10-6-3-acceptable-location-of-non-mechanically-ventilated-sanitary-compartment.svg

10-7-1-sound-insulation-requirements-NT.xml    id=_c79d3723-a78b-4ec6-a6ff-51a14ee5886a
  → image-10-7-1a-required-rw-plan-view-NT.xml    → Images/image-10-7-1a-required-rw-plan-view-NT.svg
10-7-1-sound-insulation-requirements-NT.xml    id=_c297cf76-4972-46ff-9912-5ab0cdd6b3c7
  → image-10-7-1b-construction-of-walls-50-rw-cavity-brickwork-NT.xml
                                                → Images/image-10-7-1b-…-cavity-brickwork-NT.svg
10-7-1-sound-insulation-requirements-NT.xml    id=_422814a7-8236-4d1e-8929-6bdf3feacaa1
  → image-10-7-1c-construction-of-walls-50-rw-single-leaf-brickwork-NT.xml
                                                → Images/image-10-7-1c-…-single-leaf-brickwork-NT.svg
```

**Wrapper → `Images/` is *not* the `href`.** The `href` basename is `1-alpine-areas.svg` while
the file on disk is `image-1-alpine-areas.svg`. Three rules, applied in order:

| rule | vol-one | vol-two | vol-three | HP |
|---|---|---|---|---|
| 1. `Images/<wrapper filename stem>.<ext>` | 208 | 173 | 207 | 309 |
| 2. `Images/image-<basename of href>` | 17 | 17 | 18 | 22 |
| 3. `Images/<wrapper stem minus leading "image-">.<ext>` (the covers) | 2 | 2 | 2 | 2 |
| **unresolved** | **2** | **2** | **2** | **3** |

The residue is enumerable and stable: `image-S37C8-permanent-external-vertical-shading–measurement-of-D,-W-and-H.xml`
and `image-S46C2-explanatory-calculation-of-fan-performance-ratio.xml` in every package (their
hrefs are opaque asset ids `10158_0.2.0.jpg`, `10145_0.2.0.png`), plus
`image-13-2-5b-measurement-of-a-projection-for-wall-shading-NT.xml` in HP. Media is
`.svg` (225/190/224/329), `.eps` (0/0/1/2) and `.pdf` for covers.

`<image href>` shapes across all wrappers: publishing-session path (the norm),
`ERROR_IN_RESOLVING_URI:<name>` (51–91 per package), and **absolute Windows authoring paths
leaked into the published XML** (55–89 per package) —

```xml
<image alt="Typical subsoil drain configurations" href="ERROR_IN_RESOLVING_URI:3-3-4-….eps" …>
  <image href="C:\Users\bkiem\AppData\Roaming\Quark\XML Author\Temp\media1_fe704f74-….jpg" …/>
</image>
```

Note the **nested `image > image`** (260 occurrences): an outer vector reference with a raster
fallback inside it. Take the outer.

9–14 files per package in `Images/` are never referenced by any wrapper — the `(OLD)` variants,
the two covers, and (in a 2022 package) `image-cc-by NCC 2025.svg`.

---

## 7. Glossary (Step 5)

| package | glossary files | root | national | NSW | SA | TAS | VIC | WA |
|---|---|---|---|---|---|---|---|---|
| volume-one | 543 | `abcb-glossentry/abcb-glossentry` | 499 | 20 | 8 | 6 | 6 | 4 |
| volume-two | 544 | same | 499 | 20 | 8 | 6 | 6 | 5 |
| volume-three | 543 | same | 499 | 20 | 8 | 6 | 6 | 4 |
| housing-provisions | 543 | same | 499 | 20 | 8 | 6 | 6 | 4 |

**The term comes from `<glossterm>`** — the same answer as 2025, and for the same reason: there
is no `<title>` anywhere in a glossary entry. Child sequences (volume-one):

```
glossterm+glossdef                        ×512
glossterm+glossdef+glossBody              ×18
glossterm+glossdef+glossdef               ×11
glossterm+glossdef+glossdef+glossdef      ×2
```

0 entries lack a `glossdef`; 0 have an empty `glossterm`. `glossBody > glossAlt >
glossAcronym | glossAbbreviation` carries the acronym, as in 2025.

**Byte identity across packages:** 545 `glossary-*` names present in all four; **541 identical**
once the publishing-session UUID is canonicalised; 4 differ (`glossary-map-glossary.xml`,
`glossary-threshold-ramp.xml`, `glossary-water-services-overflow.xml`, `glossary-water.xml`).
The glossary is effectively one shared document — the 2022 analogue of the 2025 dedupe question,
and it has the same answer: merge, do not emit four times.

**The edition-membership rule of §1.3 applies here too.** Reading `glossterm` in both views, in
every package: **30 entries are 2025-only** (base term empty), 4 are 2022-only (term deleted in
the 2025 draft), and 3 have a changed term. The 30 include `Control layer`, `DN`,
`Fire-protected steel`, `NABERS Embodied Carbon`, `CO2-e/m2.hr`, `Wp/m2` — none of which are
NCC 2022 definitions. A walker that applies the base-view rule to clauses but not to glossary
entries will publish 30 phantom definitions per edition.

**Collision to handle:** `Appropriate authority` appears twice at national scope
(`glossary-appropriate-authority.xml`, `glossary-appropriate-authority-FSVM.xml`) in every
package. 13 terms per package contain non-ASCII: `"Children’s service"`, `"°south"`, `"°CDB"`,
`"°CWB"`, `"°C"`, `"°"`, plus the three `/`-bearing terms of §2.1. This is the same slug
collision class `content-model-2025.md` trap 2 documents — the same fix applies.

---

## 8. Amendment state (Step 6)

**Finding: these packages are NCC 2022 as first published — no amendment.**

⊕ **The brief's test gives the wrong answer.** Run verbatim:

```
$ grep -l "all-gender" .cache/extracted/ncc-2022-volume-one/XMLs/*.xml | wc -l
1
```

Non-zero, which per the brief means "Amendment 2". **It is not.** The single hit is
`F4D4-facilities-in-class-3-to 9-buildings.xml`, and every occurrence of the phrase there is
inside an `xt:insText` range authored in 2024/2025. Evaluated in both views:

| probe | BASE (2022) | ACCEPTED (2025 draft) |
|---|---|---|
| `all[- ]gender` | **0** | 2 files |
| `register of alternative referenced documents` | **0** | 3 files |
| `New for 2022` (archive-num marker) | 125 | 117 |
| `NCC 2022` literal | 17 | 8 |

The all-gender provisions enter through the 2025 edit layer, not the 2022 base.

**Positive evidence for "no amendment", cross-checked two ways:**

1. **The adoption-history table stops at NCC 2022.** `table-1-history-of-adoption-of-NCC-volume-one.xml`
   carries no tracked changes at all, and its last row in both views is:
   `NCC 2022 | 1 May 2023 | 1 May 2023 | …`
2. **The published NCC 2025 corpus's copy of the same table has three more rows** — read from
   `.cache/extracted/ncc-2025-volume-one-v1.2/contents.xml`:

   ```
   NCC 2022             | 1 May 2023   | …
   NCC 2022 Amendment 1 | 1 May 2025   | …
   NCC 2022 Amendment 2 | 29 July 2025 | …
   NCC 2025             | 1 May 2026   | …
   ```

   Amendment 1 was adopted 1 May 2025 and Amendment 2 on 29 July 2025. Neither appears in the
   2022 packages' own adoption table.
3. **No text anywhere in any package matches `NCC\s*2022\s*Amendment`.** Every base-view
   "Amendment 1" hit refers to **NCC 2019** Amendment 1 in a transitional provision, e.g.
   `F8-condensation-management.xml`: *"From 1 May 2023 to 30 September 2023 Part F6 of NCC 2019
   Volume One Amendment 1 may apply instead of Part F8 of NCC 2022 Volume One."*
4. `archive-num` maps to `2019: <old number>` (1383 in vol-one) or `New for 2022` (125) — the
   NCC 2019 → NCC 2022 renumbering, with no later amendment layer.
5. Section H8 (Livable housing design) **is** present in volume-two and HP in the base view,
   consistent with NCC 2022 as published.

Recorded as `NCC 2022 (as published; no amendment)` in `README.md` and in
`AMENDMENTS` in `tools/src/index.mjs`.

**Carry-forward for someone else:** `README.md` states the `corpus/` licence as CC BY 4.0 for
both editions. The 2022 base text of the copyright page reads **"Creative Commons
Attribution-NoDerivatives 4.0"**, changed to plain Attribution only by a 2024 tracked
insertion. If NCC 2022 was published under CC BY-ND, redistributing a derivative of it is a
licensing question, not a formatting one. I have not changed the licence text — that is an
owner decision, not a measurement.

---

## 9. Complete element inventory (Step 7)

**82 distinct element names** across the four packages (2025 has 88; 56 are shared).

```
abcb-glossentry abcb-map annotation archive-num b callout callout-type clause clause-variation
clauseref colspec common-cellChildTextNode desc-note entry equation-block equation-inline facet
glossAbbreviation glossAcronym glossAlt glossBody glossdef glossref glossterm i image
image-reference intro-part li link math mathML meta mfenced mfrac mi mn mo mover mrow msqrt
mstyle msub msubsup msup mtable mtd mtext mtr munderover num ol p page part part-variation
placeholder related-links resources row section semantics signage specification sptc sub
subclause subtopic sup table table-reference table-variation tbody tgroup thead title topichead
topicset ul xref xt:delText xt:insText
```

Per-package counts are in the census script's output; the totals that matter for allowlists are:
`entry` 140385 · `xref` 69705 · `xt:insText` 51040 · `li` 48277 · `facet` 45185 ·
`row` 30596 · `xt:delText` 28296 · `p` 25029 · `num` 18520 · `ol` 14509 · `colspec` 12688 ·
`archive-num` = `clause` = `sptc` = 12657 · `subclause` 11957 · `title` 34191.

**Only in 2022 (26):**
`abcb-glossentry abcb-map archive-num b callout-type clauseref colspec
common-cellChildTextNode entry facet glossAbbreviation glossref image meta mtable mtd mtr
placeholder related-links row tgroup topichead topicset xref xt:delText xt:insText`

**Only in 2025 (32):**
`a callout-reference col colgroup content em glossentry glossentry-variation h2 h3
image-reference-variation img ins intro-part-reference ncc-glossary ncc-section ncc-standard
ncc-volume notice schedule-part schedule-part-variation schedule-referenced-document
schedule-spec spec-topic standard-clause strong subclause-variation table-reference-variation
td th tr variation`

### 9.1 New to `normalize.mjs`

`normalize.mjs` is shared between editions. **19 elements would reach it and throw** (its
allowlists are fail-loud by design, so these surface as crashes rather than data loss):

| element | count | what it is | suggested handling |
|---|---|---|---|
| `xt:insText`, `xt:delText` | 51040 / 28296 | tracked changes (§1.1) | **resolve before normalization**; never reach the renderer |
| `entry` | 140385 | CALS table cell | = 2025 `td`/`th` |
| `row` | 30596 | CALS table row | = 2025 `tr` |
| `tgroup` | 2715 | CALS table body wrapper | transparent between `table` and `thead`/`tbody` |
| `colspec` | 12688 | CALS column metadata | childless; = 2025 `col`/`colgroup` |
| `facet` | 45185 | `<facet building="Class 2"/>` | metadata; skipped |
| `meta` | 5617 | wrapper around `facet` | metadata; skipped |
| `archive-num` | 12657 | superseded reference | unit identity; skipped in the body |
| `image` | 3446 | figure element | = 2025 `img` (note nested `image > image`) |
| `callout-type` | 2613 | always empty; kind is `@ncc-info-type` | read the attribute, render nothing |
| `placeholder` | 87 | `<placeholder>[ARCHIVE]</placeholder>` | drop; see below |
| `mtable`, `mtr`, `mtd` | 8 / 16 / 16 | MathML tables | extend `MATHML_TAGS` |
| `glossAbbreviation` | 8 | sibling of `glossAcronym` | as `glossAcronym` |
| `glossref` | 2188 | map-only pointer | never reaches a unit subtree |
| `common-cellChildTextNode` | 10 | empty authoring artefact inside `entry` | drop |
| `related-links` | 2 | always empty | drop |
| `b` | 287 | bold | already in `INLINE_TAGS` as the 2022 spelling ✓ |

(`b` is listed for completeness — `normalize.mjs` already carries it. The count of genuinely new
names is **19**.)

A further **12** are new at *walker* level and never reach `normalize.mjs`:
`abcb-glossentry abcb-map clause clause-variation clauseref page part part-variation
specification subtopic topichead topicset`.

`xref` is already allowlisted in `INLINE_TAGS` with the comment "0 in 2025; the 2022 DITA
cross-reference" — that call was correct. Measured `@type` values, which drive the
glossary-term collection:

```
abcb-glossentry 44926 · ncc-clause 7771 · table-reference 3634 · clause 3520 · glossterm 2555
specification 1954 · subclause 1811 · image-reference 1480 · part 1105 · ncc-part 346
standard-part 282 · (none) 186 · title 70 · standard-clause 36 · common-section 16 · oli 6
page 6 · ncc-callout 1
```

`GLOSSARY_LINK_TYPES` = `{abcb-glossentry, glossterm}` transfers unchanged. `@format` is `dita`
69519 / `html` 186, and only the `html` ones have a real external URL — everything else is a
publishing-session path or a `qpp://assets/…` URI and must inline as plain prose, exactly as in
2025. 2234 xrefs have `href="ERROR_IN_RESOLVING_URI…"`.

`callout-type/@ncc-info-type`: `info` 1498 · `notes` 538 · `application` 323 · `limitation` 129 ·
`exemption` 125. 2025 has no equivalent; this is real information about whether a box is an
exemption or a note.

### 9.2 Measured containment

Parent → child, all four packages, from a DOM pass:

```
(root)          > clause 5718 · table-reference 1845 · abcb-glossentry 2173 · image-reference 988
                  · part 339 · specification 174 · page 78 · abcb-map 16
abcb-map        > abcb-glossentry 2172 · glossref 2188 · topicset 37 · title 28 · topichead 11
topicset        > part 173 · specification 55 · abcb-map 12 · page 4
topichead       > page 74
part            > subtopic 904 · clauseref 881 · num 512 · title 512 · intro-part 353
                  · callout 182 · part-variation 114
specification   > clauseref 1252 · num 229 · title 229 · section 66
subtopic        > clauseref 4514 · callout 44
clauseref       > clause 6939 · title 110
clause          > sptc 12657 · title 12657 · archive-num 12657 · subclause 11700 · meta 5617
                  · callout 2025 · table-reference 1711 · image-reference 830
                  · clause-variation 561 · p 73 · resources 6 · related-links 2
subclause       > title 11957 · num 11953 · p 12593 · ol 6597 · subclause 257
                  · equation-block 70 · signage 12
meta            > facet 45185
page            > section 780 · p 282 · title 156 · table-reference 82 · image-reference 24
                  · ul 14 · ol 4
section         > p 2510 · title 2044 · section 1198 · clauseref 310 · ul 164
                  · table-reference 4 · ol 4
callout         > p 3960 · callout-type 2613 · title 532 · ul 392 · ol 377
                  · image-reference 123 · table-reference 43
table-reference > num 3781 · title 3781 · table 2699 · desc-note 1609 · table-variation 16
table           > tgroup 2715 · title 4
tgroup          > colspec 12688 · thead 2715 · tbody 2715
thead           > row 3469          tbody > row 27127          row > entry 140385
entry           > xt:insText 17786 · xt:delText 14756 · xref 9291 · sup 1792 · sub 804
                  · equation-inline 254 · b 179 · common-cellChildTextNode 10
image-reference > num 2045 · title 2045 · image 1276 · desc-note 363
image           > image 260
abcb-glossentry > glossdef 4465 · glossterm 4345 · glossBody 144
glossdef        > p 4489 · ol 768 · callout 352 · title 120 · image-reference 80 · table-reference 48
ol              > li 46016          ul > li 2261
li              > xref 34444 · xt:insText 16814 · xt:delText 7223 · ol 5377 · sup 1349
                  · equation-inline 1303 · sub 765 · table-reference 48 · signage 40 · ul 31
                  · equation-block 25 · b 24 · i 16
p               > xref 25524 · xt:insText 11011 · xt:delText 3739 · sup 337 · sub 317
                  · equation-inline 269 · b 84
desc-note       > ol 1382 · p 701          resources > link 4          num > placeholder 16
```

Container root child sets (what a `part`/`specification`/`page` file actually holds):

```
part/ncc-part        intro-part+num+subtopic+title                                   ×160
part/ncc-part        callout+intro-part+num+part-variation+subtopic+title            ×34
part/ncc-part        callout+intro-part+num+subtopic+title                           ×26
part/ncc-part        intro-part+num+title                                            ×9
part/ncc-part        intro-part+num+part-variation+subtopic+title                    ×6
specification        clauseref+num+title                                             ×157
specification        clauseref+num+section+title                                     ×17
part/standard-part   clauseref+num+title                                             ×91
part/standard-part   clauseref+num+part-variation+title                              ×13
page/page            p+section+title ×24 · p+title ×20 · p+table-reference+title ×12
                     image-reference+title ×8 · section+title ×4 · …
```

---

## 10. The 2022 equivalent of each concept the pipeline already handles

| pipeline concept | 2025 | **2022** |
|---|---|---|
| clause id | `<sptc>` child of `clause` | `<sptc>` child of `clause` — **but tracked-changed; read the base view (§1.2)** |
| title | `<title>` child | `<title>` child — also tracked-changed |
| superseded reference | `<archive-num>2019: A5.6</archive-num>` | same element; values `2019: <n>` 1383 / `New for 2022` 125 / `<placeholder>[ARCHIVE]</placeholder>` 16 / empty 20. **Treat the placeholder as absent** |
| building classes | `building` attribute on `clause` | `<meta><facet building="Class 2"/>…</meta>` — **no `building` attribute exists** (0 occurrences) |
| state for variations | `state` attribute; `variation` / `clause-variation` ancestors | `variation` attribute (+ `variation-type`) on the root, on `subclause`, and on the `clause-variation` pointer. **Varied clause text is in a separate file** (§5) |
| glossary term | `<glossterm>` in `glossentry` | `<glossterm>` in `abcb-glossentry` — same rule, different container |
| cross-reference to inline | `<a>` | `<xref format="dita" type="…" href="…">` — already allowlisted |
| figure | `<image-reference>` wrapping `<img src>` | `<image-reference conref>` in prose + a wrapper file with `<image alt href>`; **join on `@id`** (§6) |
| table | `<table-reference>` wrapping `<table>` with `tr`/`td`/`th` | `<table-reference>` wrapping `<table><tgroup><colspec><thead\|tbody><row><entry>` — **CALS, not HTML** |
| subclause label | `clause > subclause > content > num + p` | **`clause > subclause > num + p`** — there is no `<content>` element in 2022 (0 occurrences); `num` and `p` are direct children, alongside a boilerplate `<title>SubClause</title>` |
| section context | `<ncc-section num type>` ancestor | `<topicset section-num navtitle>` in `FlattenedFile.xml` (§4) |
| part / specification | `part` / `specification` elements with `num` attribute | same element names, but `num` and `title` are **child elements**, not attributes |
| document root | `ncc-volume` / `ncc-standard`, one `contents.xml` | 9 root kinds across 11,331 files (§2) |
| list style | `<ol class="numbered">` | `<ol outputclass="alpha">` — `normalize.mjs` already reads `class \|\| outputclass` ✓ |
| notice | `<notice>` | does not exist |
| `h2` / `h3` | present | do not exist — `section > title` only |
| `spec-topic`, `schedule-*`, `ncc-glossary`, `standard-clause`, `subclause-variation`, `image-reference-variation`, `table-reference-variation` | present | **do not exist in 2022** |

---

## 11. Preconditions and gotchas for the reader

- **Comments exist** — 26–29 files per package contain `<!-- -->`. A raw tag-stack pass over the
  source text (the method `measured-2025-shapes.md` used, valid there) is **not** exact here.
  Parse with a DOM.
- **No CDATA, no BOM, no DOCTYPE** in any of the 11,331 files.
- **Namespace prefixes are not stable.** `urn:xpressauthor:trackchanges` binds to `xt`, `ns0`,
  or the default at different points *in the same package*. Match on namespace URI + local name.
- **`conref` means two different things.** Bare filename inside `FlattenedFile.xml`
  (1,217 in vol-one); publishing-session path everywhere else.
- **Broken references are shipped in the source**, not introduced by us:
  `ERROR_IN_RESOLVING_URI:` on 2,234 xrefs, 4 map conrefs, and 51–91 image hrefs per package;
  absolute `C:\Users\bkiem\AppData\Roaming\Quark\…` paths on 55–89 image hrefs per package.
- **`glossary-map-{glossary,abbreviations,symbols}.xml`** are three further `abcb-map` roots,
  pulled into `FlattenedFile.xml` via `topicset > abcb-map` (12). They route Schedule 1.
- The XML is **not pretty-printed** (unlike 2025's `contents.xml`): vol-one's 2,917 files hold
  10,275 lines between them, a mean of 3.52 lines per file, and every file sampled — including
  the 1.28 MB `FlattenedFile.xml` and the 223 KB `table-1-list-of-amendments.xml` — is a single
  line. Whitespace collapsing is still required, but source indentation is not the reason.

---

## 12. Reproducing every number here

Nothing above is quoted from another document. Each table came from a Node script run against
`.cache/extracted/ncc-2022-*`; the scripts were scratch (`.cache/scratch/task9/`, gitignored) and
are deliberately not committed — the artefact is this document. The measurements are:

1. root census — DOM parse, root element × `outputclass`, cross-checked against `<?Xpress?>`
2. overlap — SHA-256 per file, recursive enumeration, with and without session-UUID canonicalisation
3. identity — `sptc`/`title`/`archive-num` in base and accepted views; `@variation` vs filename suffix
4. figures — `@id` join, then three name rules against a `readdir` of `Images/`
5. glossary — root/child-sequence census plus canonicalised SHA-256 across packages
6. amendment — phrase probes evaluated in **both** tracked-change views, plus the adoption table
   read from the 2022 packages and from `ncc-2025-volume-one-v1.2/contents.xml`
7. inventory — DOM pass recording every element, parent → child edge, and attribute name

Two cross-checks reconcile independently and are worth keeping as build assertions:
the map's 2022 membership against the per-file base `sptc` (§4.1), and the `subclause` variation
attributes against the boilerplate title text (§5.2, 98/98).
