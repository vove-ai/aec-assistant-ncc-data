# Searching this corpus

`corpus/` is the National Construction Code of Australia as one markdown file per unit — a clause,
a clause's state variation, a glossary entry or a page — with the citation in the first six lines of
every file. It is generated from the ABCB's own XML — never edit it. Nothing else in this repository is search material: `tools/` is the generator and `docs/` is
about the generator, so search `corpus/` and nowhere else.

Two editions are here and **both are currently in force**. The applicable one follows the project's
permit / building approval application lodgement date, so establish which edition the question is
about before you search, and never mix the two in one answer.

| | files | documents |
|---|---|---|
| `corpus/2022/` | 2,997 — clause 2,225 · glossary 513 · page 259 | Volumes One, Two, Three, Housing Provisions |
| `corpus/2025/` | 3,101 — clause 2,312 · glossary 555 · page 234 | the same four, plus Livable Housing Design |

**NCC 2022 here is the edition as first published — no amendment.** Amendment 1 (adopted 1 May
2025) and Amendment 2 (29 July 2025) are *not* in this corpus. If the question turns on an
amendment, say so and cite the live Code at `web_url`. NCC 2025 is the ABCB v1.2 dataset, as
published.

## Layout

```
corpus/INDEX.md              file counts per directory
corpus/2025/INDEX.md         every unit: designation → path — title   (grep this)
corpus/2025/volume-one/      BCA Volume One    — Class 2 to 9 buildings (A1G1)
corpus/2025/volume-two/      BCA Volume Two    — Class 1 and 10 buildings (A1G2)
corpus/2025/volume-three/    PCA Volume Three  — plumbing and drainage, all classes (A1G3)
corpus/2025/housing-provisions/   the ABCB Housing Provisions: the Deemed-to-Satisfy Provisions
                                  for Parts H1–H8 of Volume Two
corpus/2025/livable-housing/      Livable Housing Design, an ABCB Standard (2025 only)
corpus/2025/glossary/        one file per defined term, for the whole edition
corpus/2022/…                the same, without livable-housing
```

Everything is flat inside those directories. Files are ≤ 128 KB, so any hit can be read whole.

## Finding a clause

Filenames lead with the lowercased clause designation, so a glob is the primary lookup:

```bash
ls corpus/2025/*/c2d2-*          # → volume-one/c2d2-type-of-construction-required.md
                                 #   volume-three/c2d2-invert-levels.md
ls corpus/2025/*/a5g4-*          # national + state variations, six files across three volumes
ls corpus/2022/housing-provisions/11.2.2-*   # Housing Provisions clauses are decimal; dots are kept
ls corpus/2025/volume-one/c2*    # every clause in Part C2 — 16 files
```

A designation encodes its Section, its Part and what kind of provision it is, which makes a glob a
filter as well as a lookup. `C2D2` is Section C, Part C2; the letter before the last number is the
type, and the Code's own text names them — `G` governing (`A1G1`), `P` a Performance Requirement
("Performance Requirements C1P1 to C1P9 are satisfied by…"), `V` a Verification Method, `D` a
Deemed-to-Satisfy provision. So `ls corpus/2025/volume-one/c1p*` is Section C's Performance
Requirements and `ls corpus/2025/volume-one/c1v*` its Verification Methods. A Specification's
clauses carry its number (`s44c2-…` = S44C2, clause 2 of Specification 44); the Specification's own
overview page is `spec-44-…` and a Part's is `part-c2-…`. The Housing Provisions and Livable
Housing Design number clauses decimally instead (`10.2.1`, `1.1`).

Glob; do not construct a filename. A state token always precedes the title slug even when the
ABCB's own title already names the state, which gives `corpus/2025/` 43 names of the
`page-act-act-introduction.md` shape (`corpus/2022/` has none — its titles are plain). The edition
index carries the real path for every file.

When you know the designation but not the wording, grep the edition index instead — one line per
file, `designation → path — title`:

```bash
grep -n "^C2D2 " corpus/2025/INDEX.md
# 1065:C2D2 → volume-one/c2d2-type-of-construction-required.md — Type of construction required
# 2583:C2D2 → volume-three/c2d2-invert-levels.md — Invert levels
```

That two-hit result is normal, not an error — see the traps below.

## Finding text

Prose is one paragraph per line and glossary cross-references are inlined as plain words, so an
exact phrase typed by a human matches. This is the whole reason the corpus exists; in the source
XML that phrase is split by a cross-reference element and matches nothing.

**Scope every search to one edition directory** — `corpus/2025/`, not `corpus/` — so a hit can
never be from the edition you are not answering about.

```bash
grep -rln "resistance to the incipient spread of fire to the space above" corpus/2025/
grep -rl "AS 1530.4" corpus/2025/            # every clause citing a standard — 23 files
grep -rl "### Table D2D18" corpus/2025/      # a table, by its designation — one file
grep -rl "Figure D3D14" corpus/2025/         # a figure: the prose reference and the image's alt
                                             #   text carry the same designation, so one grep gets both
```

That figure grep can return more than one file, and both reasons are the Code's own. `![Figure X`
is the image itself and `see Figure X` is a reference to it, so tell them apart by the leading `!`:
of 131 `see Figure` references in `corpus/2025/`, 114 point at a figure in their own file and **17
at one in another clause's file** (2022: 129, 110, 18). And 14 designations in `corpus/2025/` (15 in
`corpus/2022/`) are embedded by more than one file, because a state's republication of a clause
republishes its figure. Read the frontmatter of each hit before deciding which provision the figure
belongs to.

To define a term, go straight to the glossary file, or find its filename in the index — 14 terms
per edition are symbols or carry non-ASCII characters (`%`, `°C`, `µm`, `f'c`) and are named with an
8-character hash, so look those up rather than guessing (`%` → `glossary/term-4345cb1f.md`):

```bash
cat corpus/2025/glossary/fire-resisting-construction.md
grep -n "^Accessway " corpus/2025/INDEX.md
```

To find which clauses *use* a term, grep the body text. Do not use the `defined_terms:` list for
this: it records only the occurrences the ABCB marked up as cross-references, so it is not a
concordance ("fire-resisting construction" appears in 29 files of `corpus/2025/` and is listed in
`defined_terms:` in 3).

## Reading a hit

Every file is self-citing, and `citation:` plus `web_url:` are always inside a `grep -A6` window:

```yaml
---
clause: C2D2                                  # or `term:` for a glossary entry; absent on a page
title: Type of construction required
citation: NCC 2025 V1 C2D2                    # quote this
web_url: https://ncc.abcb.gov.au/…#C2D2       # the authoritative page; link this
edition: "2025"
volume: volume-one                            # glossary files carry `sources:` instead
jurisdiction: aus                             # anything else is a state variation
building_classes_excluded: Class 1a,Class 1b,Class 10a,Class 10b,Class 10c
defined_terms:                                # a BLOCK list, one `  - term` per line, so
  - fire-resisting construction               #   grep 'defined_terms:.*storey' matches nothing —
  - storey                                    #   grep '^  - storey$' does
---
```

Other keys you may see: `supersedes:` (the NCC 2019 designation this clause replaced, or "New for
2022" — `corpus/2022/` only, 2,179 files). Every clause file in both editions has a `web_url:`;
116 non-clause files — front matter and section overviews — have none, because the ABCB publishes
no page for them.

In the body: `**(1)**` is a sub-clause number, `### Table X — …` a table, `![Figure X: …](…)` a
figure, and `> ` a blockquote — see the traps.

## Traps

Each of these has been measured on the corpus, and each one changes the answer.

**`building_classes_excluded:` lists the classes the clause does NOT apply to.** Read it as
"applies to" and you conclude the exact opposite of the law. `A6G3 "Class 2 buildings"` carries
`Class 1a,Class 1b,Class 3,Class 4,…,Class 10c` — every class *except* Class 2, because it is the
clause about Class 2 buildings. The value is the ABCB's own list, transcribed verbatim; the key
name is what tells you which way it points. It is on 3,289 clause files and it is the single most
misreadable field here.

**A file with `jurisdiction: aus` can still contain state-specific text.** A variation of a whole
clause becomes its own file, with the state in the filename and in the citation
(`a5g4-vic-….md`, `citation: NCC 2025 V1 A5G4 (VIC)`). A variation of part of a clause stays inline
in the national file under a bold label — `**SA variation (REPLACE) — …**`, `(INSERT)` or
`(DELETE)` — and everything under that label until the next block is that state's law, not the
national provision. 98 files in `corpus/2025/` and 96 in `corpus/2022/` are national files carrying
such a block. Before relying on a national clause, check whether a variation exists for your
jurisdiction: `ls corpus/2025/*/c2d2-*`.

**And state law also arrives with no variation marker at all, in a blockquote, on a Part's overview
page.** 24 of them, across 14 files that all carry `jurisdiction: aus`: 21 name a *different edition
of the Code* as the one that applies in that state, 2 defer a Part's commencement, 1 points at a
state instrument. Eighteen are labelled `**Notes — …**`.

```
> **Notes — Tasmania Section J Energy Efficiency**
> In Tasmania, for a Class 2 building and Class 4 part of a building, Section J is replaced
> with Section J of BCA 2019 Amendment 1.
                            — corpus/2022/volume-one/part-j4-building-fabric.md
```

Neither route above finds that. It carries no `variation (…)` marker, and
`ls corpus/2022/volume-one/part-j4-*` returns the national page and an NT one — **no Tasmanian
file**, and no New South Wales file either, though `part-j4-building-fabric.md` carries a note for
both. There is no `j…-tas-…` file anywhere in the corpus, so this blockquote is the only record of
the Tasmanian position that exists here. An agent answering "Section J, Class 2 building, Tasmania"
from the clause files alone gets it wrong with nothing to warn it.

So when jurisdiction matters, **read the Part's overview page as well as the clause**, and grep the
state by full name and by abbreviation — both spellings are used:

```bash
ls corpus/2022/volume-one/part-j4-*                    # the Part page, alongside the clause file
grep -rn "^> \*\*.*Tasmania" corpus/2022/volume-one/   # 9 files, all Part pages
grep -rln "^> \*\*.*NSW" corpus/2025/volume-one/       # part-f1-water-management.md
```

Several of these send you to an edition this corpus does not contain — `NCC 2022 Amendment 2` for
NSW Part F1, `BCA 2019 Amendment 1` for Tasmania's Section J, `NCC 2019 Volume Two Amendment 1` for
Western Australia's Part H6. Follow `web_url` and say which edition governs; do not answer from the
national Part.

**A `> ` blockquote is a boxed passage, and its `(1)` is not a sub-clause.** Blockquotes are the
Code's callout boxes and the notes attached to a table or figure — never the clause's own numbered
text, which renders as bold `**(1)**` at the left margin. Inside a blockquote `(1)` is that box's
own numbering. Quoting `> (2) Going and riser dimensions must be measured…` from
`d3d14-goings-and-risers.md` as "D3D14(2)" cites a table note as a sub-clause; the clause's real
(2) is elsewhere in the file. Measured: 2,746 blockquotes, 599 of them starting with a plain `(1)`.

**Whether a blockquote binds is decided by its text, not by its label.** The labels are an open set,
not a taxonomy: 251 distinct ones over 1,035 labelled callouts. The six commonest — `Info`, `Notes`,
`Application`, `Exemption`, `Limitation`, `Example`, alone or as `Kind — Title` — account for 847,
and the remaining 188 use 136 other labels, several of them plainly binding. `**Additional
requirements**` in `corpus/2025/housing-provisions/11.3.1-application.md` reads *"a barrier and
handrail **must** comply with the structural requirements of Part 2.2"*. `**Exemptions**`, `**NSW
Part F1**`, `**Intent**` and `**Explanatory Information**` are all outside the six as well, and the
first two of those change what applies. So read the box for obligation language — "must", "is
required to", "does not apply", "may apply instead of", a named edition or jurisdiction — and treat
the label as the ABCB's name for the box rather than as a verdict on it.

An unlabelled blockquote following a table or figure is that table's or figure's notes, and those
are part of it: Table D3D14's notes are what define "Private" stairways and how the dimensions are
measured.

**One clause designation, several volumes.** Each volume has its own Sections A–J, so 165
designations in each edition are published in more than one volume: `C2D2` is "Type of construction
required" in Volume One and "Invert levels" in Volume Three. A glob on a designation legitimately
returns several files; the volume is in the path, in `volume:` and in `citation:`. Resolve which
one you want before quoting.

**`m²` is usually written `m2`.** Superscripts and subscripts in prose are flattened to plain text
(`m2`, `H2O`), but where the source used the literal character it survives — 372 files carry a
word-bounded `m2` and 40 carry `m²`, 11 of them both. Search both forms, or search neither and grep
the surrounding words.

**Formulas are flattened to linear text.** MathML becomes one greppable line:

```
Q=C_dA√(2gh)                                  subscript `_`, and `√` for a square root
D_(min)=√((4Q_(99)×(10)^3)/(πv))              superscript `^`, fraction `/`
```

Parentheses group anything longer than one character, so a subscript "min" is `_(min)`. Two
consequences. Spaces *inside* a formula are dropped, and a formula inline in a sentence can absorb
the spaces around it — `the reliability indexβis calculated`, `Capacityweightedaverage=…`; 17 files,
24 places. So a phrase grep that spans a formula can miss: grep a phrase from one side of it.
And for anything load-bearing, **read the formula at `web_url` before relying on it** — the linear
form is unambiguous but it is a transcription.

**The glossary is one file per term per edition, and some carry more than one definition.** The
volumes each republish the whole glossary, so the corpus folds them into one file naming its
sources (`sources: [volume-one, volume-two, volume-three, housing-provisions]`). Three files hold
more than one wording under `## ` headings, and you must read all of them:

- `corpus/2025/glossary/appropriate-authority.md` and `corpus/2022/glossary/appropriate-authority.md`
  — `## Definition 1` / `## Definition 2`. The NCC genuinely defines the term twice, one sense
  scoped to the Fire Safety Verification Method. Quoting the general sense in an FSVM question is a
  compliance error.
- `corpus/2025/glossary/hours-of-operation.md` — `## As published in Volume One and Housing
  Provisions` / `## As published in Volume Two and Volume Three`. The volumes disagree; the second
  contains an ABCB typo ("greater thanat least 20%"). Reproduced as published, both of them.

**Ten figures in `corpus/2022/` are links, not images.** Assets in a format no renderer draws
inline (`.pdf`, `.eps`) ship as `[Figure …](…)` rather than `![Figure …](…)` — eight covers and two
diagrams. Same caption, same one-grep reachability; only the leading `!` differs.

## NCC 2022: what is missing and what looks wrong

Both lists are reproduced in full at the top of `corpus/2022/INDEX.md`, with evidence. Read it
before concluding that a 2022 clause does not exist.

**Eight clauses are not published here** — nine files counting jurisdiction variations — because
the ABCB source packages do not contain their text: `volume-one D3D31`; `volume-three B1V1, B5D7,
C1O1, C3D1, D1O1, E1D1 (and its TAS variation), E1O1`. They are omitted rather than stubbed, so
they are simply absent. If you cannot find a 2022 clause, check that list, then cite the live Code.

**Six cross-references print an NCC 2025 designation.** `F1D11`, `B1P7`, `B2P12`, `B3P8`, `B6D7`
and `B7P5` appear in NCC 2022 text that the ABCB itself publishes that way — the source carries no
tracked change at those points, so the corpus reproduces what the Code prints rather than inventing
a correction. They are not corpus errors. The 2022 form of each is given in the index (e.g. printed
`F1D11` → this edition's clause is `F1D8`).

## Citing

- Quote `citation:` verbatim and link `web_url:`. Never construct a citation yourself, and never
  cite a clause you have not opened.
- Name the edition in the answer. Two editions are in force and they renumber: NCC 2022's `F1D8` is
  NCC 2025's `F1D11`. There is no mapping table in the corpus — `supersedes:` maps 2022 back to
  2019, not 2022 to 2025 — so match on title and text, and say when you are unsure.
- State the jurisdiction when a variation applies, and say when you have checked and found none.
- The NCC at [ncc.abcb.gov.au](https://ncc.abcb.gov.au/) is authoritative. This corpus is a
  transcription for search; for anything safety-critical, or any formula, table or figure you are
  relying on, verify at `web_url` and say that you did.
