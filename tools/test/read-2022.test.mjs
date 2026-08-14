// read-2022.test.mjs — the NCC 2022 walker's contract.
//
// Every fixture below is a trap measured in docs/content-model-2022.md, written as a regression
// test. The one that matters most is §1: these packages are DUAL-STATE editorial files carrying
// the NCC 2025 draft on top of NCC 2022 as tracked changes, so a reader that gets the base view
// wrong produces a corpus that is wrong SELF-CONSISTENTLY — no internal check catches it. Hence
// the first block tests the base-view transform directly, on markup copied from the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import {
  DOCUMENTS_2022,
  BODY_TAGS_2022,
  applyBaseView,
  baseViewKeeps,
  readPackage2022,
  OMITTED_2022_CLAUSES,
  RECOVERED_2022_CLAUSES,
  STALE_ROOT_ID_CLAUSEREFS,
  omittedClause,
  recoveredClause,
  staleRootId,
} from '../src/read-2022.mjs';
import { normalizeUnit } from '../src/normalize.mjs';

const VOL1 = DOCUMENTS_2022[0];
const VOL3 = DOCUMENTS_2022.find(d => d.key === 'volume-three');
const HP = DOCUMENTS_2022[3];
const XT = 'xmlns:xt="urn:xpressauthor:trackchanges"';
const parse = s => new DOMParser({ onError: () => {} }).parseFromString(s, 'text/xml');
const base = s => { const d = parse(s); applyBaseView(d); return d; };
const txt = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const child = (el, tag) => { for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.nodeName === tag) return c; return null; };
const childrenNamed = (el, tag) => { const o = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.nodeName === tag) o.push(c); return o; };

/* ================================================================= *
 * 1. The base view — three mechanisms (§1.1), and the value predicate. *
 * ================================================================= */

test('milestone pairs: insText text dropped, delText text restored (§1.1 mechanism 1)', () => {
  // Verbatim shape from A4G1-referenced-documents.xml. Treating xt:insText as a CONTAINER — the
  // intuitive reading — makes base and accepted identical and the file looks like clean 2022.
  const d = base(`<clause ${XT}><sptc>A4G1</sptc><p>listed in`
    + `<xt:insText xt:action="start" xt:dateTime="2024-04-22T13:57:00" xt:id="a"/>—`
    + `<xt:insText xt:action="end" xt:id="a"/>`
    + `<xt:delText xt:action="start" xt:dateTime="2024-04-22T13:57:00" xt:id="b"/> Schedule 2.`
    + `<xt:delText xt:action="end" xt:id="b"/></p></clause>`);
  assert.equal(txt(child(d.documentElement, 'p')), 'listed in Schedule 2.');
});

test('milestone ranges cross element boundaries and are tracked with a depth counter', () => {
  const d = base(`<clause ${XT}><ol><li>keep me`
    + `<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="a"/>draft</li>`
    + `<li>more draft<xt:insText xt:action="end" xt:id="a"/> and 2022 again</li></ol></clause>`);
  assert.equal(txt(d.documentElement), 'keep me and 2022 again');
});

test('an unbalanced end marker clamps at zero rather than throwing (1 per package)', () => {
  const d = base(`<clause ${XT}><p>a<xt:insText xt:action="end" xt:id="orphan"/>b</p></clause>`);
  assert.equal(txt(d.documentElement), 'ab');
});

test('container form: delText is unwrapped, insText is removed (§1.1 mechanism 2)', () => {
  const d = base(`<clause ${XT}><p>x <xt:delText xt:dateTime="2024-01-01T00:00:00">kept 2022</xt:delText>`
    + ` <xt:insText xt:dateTime="2024-01-01T00:00:00">2025 draft</xt:insText> y</p></clause>`);
  assert.equal(txt(child(d.documentElement, 'p')), 'x kept 2022 y');
});

test('element-level marks: the three spellings, including the bare no-namespace one (§1.1 mechanism 3)', () => {
  // 355 bare `type=` attributes in volume-one alone, and they sit on WHOLE UNITS
  // (table-reference 159, clause 148, image-reference 48) — the worst place to miss one.
  const d = base(`<clause ${XT} xmlns:ns0="urn:xpressauthor:trackchanges">`
    + `<p id="a" xt:type="insert" xt:dateTime="2024-01-01T00:00:00">xt draft</p>`
    + `<p id="b" ns0:type="insert" ns0:dateTime="2024-01-01T00:00:00">ns0 draft</p>`
    + `<p id="c" type="insert" dateTime="2024-01-01T00:00:00">bare draft</p>`
    + `<p id="d">2022</p></clause>`);
  assert.deepEqual(childrenNamed(d.documentElement, 'p').map(p => p.getAttribute('id')), ['d']);
});

test('the value predicate: xref/@type is not a tracked-change mark (§11)', () => {
  // Without `value in {insert,delete}` the predicate matches 17,415 xref/@type attributes in
  // volume-one alone — every cross-reference in the volume would be deleted from the base view.
  const d = base(`<clause ${XT}><p><xref type="abcb-glossentry" href="x">accessway</xref> text`
    + `<xref type="ncc-clause" href="y">C2D2</xref></p></clause>`);
  assert.equal(txt(d.documentElement), 'accessway textC2D2');
});

test('direction is per mark, not "keep everything <= 2022" (§1.1)', () => {
  // insert <=2022 KEEP (already accepted into published NCC 2022); delete <=2022 DROP;
  // insert >=2024 DROP; delete >=2024 KEEP.
  const d = base(`<clause ${XT}>`
    + `<p id="i2021" xt:type="insert" xt:dateTime="2021-06-01T00:00:00">accepted into 2022</p>`
    + `<p id="d2021" xt:type="delete" xt:dateTime="2021-06-01T00:00:00">removed before 2022</p>`
    + `<p id="i2024" xt:type="insert" xt:dateTime="2024-06-01T00:00:00">2025 draft</p>`
    + `<p id="d2024" xt:type="delete" xt:dateTime="2024-06-01T00:00:00">2022 text the draft deletes</p>`
    + `</clause>`);
  assert.deepEqual(childrenNamed(d.documentElement, 'p').map(p => p.getAttribute('id')), ['i2021', 'd2024']);
});

test('baseViewKeeps is exported and states the rule for one element', () => {
  const el = t => parse(`<x ${XT} xt:type="${t[0]}" xt:dateTime="${t[1]}-01-01T00:00:00"/>`).documentElement;
  assert.equal(baseViewKeeps(el(['insert', '2021'])), true);
  assert.equal(baseViewKeeps(el(['insert', '2024'])), false);
  assert.equal(baseViewKeeps(el(['delete', '2021'])), false);
  assert.equal(baseViewKeeps(el(['delete', '2024'])), true);
  assert.equal(baseViewKeeps(parse('<x/>').documentElement), true);
});

test('a tracked-change year the two editorial cycles do not cover fails loud', () => {
  assert.throws(() => base(`<clause ${XT}><p xt:type="insert" xt:dateTime="2023-06-01T00:00:00">?</p></clause>`),
    /2023/);
});

/* ================================================================= *
 * 2. Identity elements are themselves tracked-changed (§1.2).        *
 * ================================================================= */

test('sptc: textContent yields an ID that exists in NEITHER edition (§1.2)', () => {
  // F1D12-roof-coverings.xml, verbatim. textContent is "F3D2F1D12"; the 2022 id is F3D2.
  const src = `<clause ${XT}><sptc>`
    + `<xt:delText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="a"/>F3D2<xt:delText xt:action="end" xt:id="a"/>`
    + `<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="b"/>F1D12<xt:insText xt:action="end" xt:id="b"/>`
    + `</sptc></clause>`;
  assert.equal(txt(child(parse(src).documentElement, 'sptc')), 'F3D2F1D12', 'the naive read');
  assert.equal(txt(child(base(src).documentElement, 'sptc')), 'F3D2', 'the base view');
});

test('the deleted run is not always first — read the markup, never document order or the filename', () => {
  const src = `<clause ${XT}><sptc>`
    + `<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="b"/>B1P3<xt:insText xt:action="end" xt:id="b"/>`
    + `<xt:delText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="a"/>B1P4<xt:delText xt:action="end" xt:id="a"/>`
    + `</sptc></clause>`;
  assert.equal(txt(child(base(src).documentElement, 'sptc')), 'B1P4');
});

/* ================================================================= *
 * 3. Sibling-pair selection — a CLASS, not a figure special case (§6.1). *
 * ================================================================= */

test('table-reference > table: the base view SELECTS; the insert is first in 5 of 9 (§6.2)', () => {
  // table-J4D6b-…-solar-admittance-…xml: taking the first table publishes a 2025 draft limit set
  // (0.10/0.09/0.11/0.09) as NCC 2022 law (0.12/0.12/0.12/0.12).
  const d = base(`<table-reference ${XT} id="t"><num>J4D6b</num>`
    + `<table id="draft" xt:type="insert" xt:dateTime="2024-08-30T11:12:31"><tgroup cols="1"/></table>`
    + `<table id="ncc2022" xt:type="delete" xt:dateTime="2024-08-30T11:12:31"><tgroup cols="1"/></table>`
    + `</table-reference>`);
  assert.deepEqual(childrenNamed(d.documentElement, 'table').map(t => t.getAttribute('id')), ['ncc2022']);
});

test('image-reference > image: the figures encode the licence change the text does (§6.1)', () => {
  const d = base(`<image-reference ${XT} id="i"><num/><title/>`
    + `<image alt="Creative Commons" href="a/creative-commons-by-nd (OLD).svg" xt:type="delete" xt:dateTime="2024-10-22T10:02:11"/>`
    + `<image href="a/cc-by NCC 2025.svg" xt:type="insert" xt:dateTime="2024-10-31T12:56:37"/>`
    + `</image-reference>`);
  const imgs = childrenNamed(d.documentElement, 'image');
  assert.equal(imgs.length, 1);
  assert.match(imgs[0].getAttribute('href'), /by-nd \(OLD\)/);
});

/* ================================================================= *
 * 4. The package — routing, membership, variations, joins.            *
 * ================================================================= */

const clause = (sptc, title, body, extra = '') =>
  `<?xml version="1.0"?><?Xpress productLine="ncc-clause" ?><clause ${XT} id="_${sptc}" outputclass="ncc-clause"${extra}>`
  + `<sptc>${sptc}</sptc><title>${title}</title><archive-num/>`
  + `<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>${body}</p></subclause></clause>`;

// States NO identity by default. The real packages always state both (build.mjs asserts it via
// `identityUnstated`), but a fixture spelling a WRONG one would be claiming its clauseref points
// somewhere else — which R51/R52 now correctly refuse. The tests that exercise the join state both
// identities properly, via `identifiedRef` further down.
const clauseref = (conref, id = null) =>
  `<clauseref outputclass="clausref-ncc"><clause conref="${conref}"${id ? ` id="${id}"` : ''} outputclass="ncc-clause">`
  + '<sptc/><title/><archive-num/></clause></clauseref>';

/** A minimal but real-shaped 2022 package, materialised on disk. */
function fixturePackage(overrides = {}, at = null) {
  // `at` places the package at a caller-chosen path, so a test can build TWO of them side by side
  // under one parent — which is the shape R60's cross-package recovery reads.
  const dir = at ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-2022-fixture-'));
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    // ---- the publication spine -------------------------------------------------
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1" publishing-year="2025" short-title="Volume One"><title>NCC 2025 Volume One</title>`
      + '<topichead navtitle="Preface"><page outputclass="page" id="_pg"><title>Front matter</title><p>Preface prose.</p></page></topichead>'
      + '<topicset navtitle="Governing requirements" section-num="Section A" summary="Section A contains the governing requirements.">'
      + '<part outputclass="ncc-part" id="_A1"><num>A1</num><title>Interpreting the NCC</title>'
      + '<intro-part><p>Part overview prose.</p></intro-part>'
      + '<subtopic subtopic-type="governance">'
      + clauseref('A1G1-scope.xml') + clauseref('F1D12-roof-coverings.xml') + clauseref('B1P4-Isolation.xml')
      + clauseref('F4D10-microbial-legionella-control.xml') + clauseref('13-2-3-roofs and ceilings.xml')
      + clauseref('B1P6-pressure.xml') + clauseref('C1D3-general-requirements.xml')
      + clauseref('H2D6-roof-and-wall-cladding.xml') + clauseref('D3D14-stair-construction.xml')
      + '</subtopic></part>'
      + '<part outputclass="ncc-part" id="_A1tas" variation="TAS"><num>A1</num><title>Interpreting the NCC</title>'
      + '<intro-part><p>Tasmanian Part overview prose.</p></intro-part>'
      + '<subtopic>' + clauseref('A1G9-tasmanian-scope.xml') + '</subtopic></part>'
      + '<specification outputclass="specification" id="_S1"><num>1</num><title>Fire-resistance</title>'
      + '<section><title>Scope</title><p>Specification overview prose.</p></section>'
      + clauseref('S1C1-scope.xml') + '</specification>'
      + '</topicset>'
      + '<topicset navtitle="Definitions" section-num="Schedule 1">'
      + '<abcb-map document-type="Glossary" id="_gm"><title>Glossary</title>'
      + '<abcb-glossentry id="_g1" outputclass="abcb-glossentry"><glossterm>Accessway</glossterm><glossdef outputclass="glossdef"><p>A continuous path.</p></glossdef></abcb-glossentry>'
      + `<abcb-glossentry id="_g2" outputclass="abcb-glossentry"><glossterm><xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="g"/>Control layer<xt:insText xt:action="end" xt:id="g"/></glossterm><glossdef outputclass="glossdef"><p>2025 only.</p></glossdef></abcb-glossentry>`
      + '<abcb-glossentry id="_g3" outputclass="abcb-glossentry" variation="NSW"><glossterm>Accessway</glossterm><glossdef outputclass="glossdef"><p>NSW sense.</p></glossdef></abcb-glossentry>'
      + '<abcb-glossentry id="_g5" outputclass="abcb-glossentry"><glossterm>Existing building</glossterm><glossdef outputclass="glossdef"><p>A building in existence.</p></glossdef></abcb-glossentry>'
      + '</abcb-map>'
      + '<abcb-map document-type="Abbreviation" id="_gm2"><title>Abbreviations</title>'
      + '<abcb-glossentry id="_g4" outputclass="abcb-glossentry"><glossterm>ABCB</glossterm><glossdef outputclass="glossdef"><p>Australian Building Codes Board.</p></glossdef></abcb-glossentry>'
      + '</abcb-map></topicset>'
      + '</abcb-map>',

    // ---- clause files ----------------------------------------------------------
    'XMLs/A1G1-scope.xml': `<?xml version="1.0"?><clause ${XT} id="_a1g1" outputclass="ncc-clause">`
      + '<meta><facet building="Class 2"/><facet building="Class 3"/><facet climate="Climate zone 8"/><facet inv:access="external" xmlns:inv="urn:xpressauthor:xpressdocument"/></meta>'
      + '<sptc>A1G1</sptc><title>Scope of NCC Volume One</title><archive-num>2019: A1.0</archive-num>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num>'
      + '<p>This is the scope, illustrated below.</p></subclause>'
      + '<image-reference conref="/tmp/QppServer/x.xml" id="_fig1"/>'
      + '<table-reference conref="/tmp/QppServer/y.xml" id="_tab1"/></clause>',

    // renumbered: base sptc F3D2, filename carries the 2025 number (§1.2)
    'XMLs/F1D12-roof-coverings.xml': `<?xml version="1.0"?><clause ${XT} id="_f1d12" outputclass="ncc-clause"><sptc>`
      + '<xt:delText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="a"/>F3D2<xt:delText xt:action="end" xt:id="a"/>'
      + '<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="b"/>F1D12<xt:insText xt:action="end" xt:id="b"/>'
      + '</sptc><title>Roof coverings</title><archive-num><placeholder outputclass="placeholder">[ARCHIVE]</placeholder></archive-num>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>Roof coverings must.</p></subclause></clause>',

    // 2025-only: base sptc empty, body ~9 chars in the base view (§1.3)
    'XMLs/B1P4-Isolation.xml': `<?xml version="1.0"?><clause ${XT} id="_iso" outputclass="ncc-clause"><sptc>`
      + '<xt:insText xt:action="start" xt:dateTime="2024-08-26T00:00:00" xt:id="c"/>B1P4<xt:insText xt:action="end" xt:id="c"/>'
      + '</sptc><title>Isolation</title><archive-num/>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>'
      + '<xt:insText xt:action="start" xt:dateTime="2024-08-26T00:00:00" xt:id="d"/>New for 2025.<xt:insText xt:action="end" xt:id="d"/>'
      + '</p></subclause></clause>',

    // DELETE pointer WITH deleted-text, and one WITHOUT (§5.3)
    'XMLs/F4D10-microbial-legionella-control.xml': `<?xml version="1.0"?><clause ${XT} id="_f4d10" outputclass="ncc-clause">`
      + '<sptc>F4D10</sptc><title>Microbial (legionella) control</title><archive-num>2019: F2.5</archive-num>'
      + '<clause-variation deleted-text="F4D10 does not apply in NSW as the installation of hot water systems is regulated in the Public Health Regulation 2012." variation="NSW" variation-type="DELETE">NSW DELETE Clause</clause-variation>'
      + '<clause-variation variation="SA" variation-type="DELETE">SA DELETE Clause</clause-variation>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>Hot water systems must.</p></subclause></clause>',

    // REPLACE resolved by case-folded sibling stem, with a literal space and a dot to normalise
    'XMLs/13-2-3-roofs and ceilings.xml': `<?xml version="1.0"?><clause ${XT} id="_1323" outputclass="ncc-clause">`
      + '<sptc>13.2.3</sptc><title>Roofs and ceilings</title><archive-num/>'
      + '<clause-variation href="/tmp/QppServer/8077_0.4.0.xml" variation="NSW" variation-type="REPLACE">NSW REPLACE Clause</clause-variation>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>National roof text.</p></subclause></clause>',
    'XMLs/13-2-3-Roofs-and-ceilings-NSW.xml': clause('13.2.3', 'Roofs and ceilings', 'NSW roof text.', ' variation="NSW"'),

    // REPLACE resolved by the BASE number, not the accepted one (§5.3.1 rule b)
    'XMLs/B1P6-pressure.xml': `<?xml version="1.0"?><clause ${XT} id="_b1p6" outputclass="ncc-clause"><sptc>`
      + '<xt:delText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="e"/>B1P5<xt:delText xt:action="end" xt:id="e"/>'
      + '<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="f"/>B1P6<xt:insText xt:action="end" xt:id="f"/>'
      + '</sptc><title>Pressure</title><archive-num/>'
      + '<clause-variation href="/tmp/QppServer/z.xml" variation="TAS" variation-type="REPLACE">TAS REPLACE Clause</clause-variation>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>National pressure text.</p></subclause></clause>',
    'XMLs/B1P5-pressure-TAS.xml': `<?xml version="1.0"?><clause ${XT} id="_b1p5tas" outputclass="ncc-clause" variation="TAS">`
      + '<sptc>B1P5</sptc><title>Pressure</title><archive-num>2019:BP1.2, TAS Exemption 1</archive-num>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>TAS pressure text.</p></subclause></clause>',

    // REPLACE whose TARGET is itself a 2025-only file (§5.3.2) — the real gap class
    'XMLs/C1D3-general-requirements.xml': `<?xml version="1.0"?><clause ${XT} id="_c1d3" outputclass="ncc-clause">`
      + '<sptc>C1D3</sptc><title>General requirements</title><archive-num/>'
      + '<clause-variation href="/tmp/QppServer/w.xml" variation="WA" variation-type="REPLACE">WA REPLACE Clause</clause-variation>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>National general text.</p></subclause></clause>',
    'XMLs/C1D3-General-requirements-WA.xml': `<?xml version="1.0"?><clause ${XT} id="_c1d3wa" outputclass="ncc-clause" variation="WA"><sptc>`
      + '<xt:insText xt:action="start" xt:dateTime="2025-01-14T00:00:00" xt:id="g"/>C1D3<xt:insText xt:action="end" xt:id="g"/>'
      + '</sptc><title>General requirements</title><archive-num/>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>'
      + '<xt:insText xt:action="start" xt:dateTime="2025-01-14T00:00:00" xt:id="h"/>WA 2025 draft.<xt:insText xt:action="end" xt:id="h"/>'
      + '</p></subclause></clause>',

    // subclause-level @deleted-text (§5.2) — the fourth carrier, below unit level
    'XMLs/H2D6-roof-and-wall-cladding.xml': `<?xml version="1.0"?><clause ${XT} id="_h2d6" outputclass="ncc-clause">`
      + '<sptc>H2D6</sptc><title>Roof and wall cladding</title><archive-num/>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>Cladding must.</p>'
      + '<subclause deleted-text="This subclause is deleted does not apply in VIC." outputclass="state-variation-delete" variation="VIC" variation-type="DELETE"><title>VIC DELETE SubClause</title></subclause>'
      + '</subclause></clause>',

    // signage + equation + a callout, so the renderer meets the 2022 spellings
    'XMLs/D3D14-stair-construction.xml': `<?xml version="1.0"?><clause ${XT} id="_d3d14" outputclass="ncc-clause">`
      + '<sptc>D3D14</sptc><title>Stair construction</title><archive-num>New for 2022</archive-num>'
      + '<callout><callout-type ncc-info-type="exemption"/><p>This does not apply to a Class 10 building.</p></callout>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num>'
      + '<ol outputclass="alpha"><li>a riser; and</li><li>a sign reading <signage>FIRE SAFETY DOOR</signage>.</li></ol>'
      + '</subclause></clause>',

    'XMLs/S1C1-scope.xml': clause('S1C1', 'Scope', 'Specification scope text.'),

    // A Part that is one jurisdiction's own: no @variation on the clause file, only on the Part.
    'XMLs/A1G9-tasmanian-scope.xml': clause('A1G9', 'Tasmanian scope', 'Applies in Tasmania.'),

    // ---- the standalone Part file: 32 part-variation identities are standalone-ONLY (§5.4) ----
    'XMLs/A1-interpreting-the-ncc.xml': `<?xml version="1.0"?><?Xpress productLine="ncc-part" ?><part ${XT} id="_A1" outputclass="ncc-part">`
      + '<num>A1</num><title>Interpreting the NCC</title>'
      + '<intro-part><p>Part overview prose.</p></intro-part>'
      + '<part-variation deleted-text="This Part has deliberately been left blank. Part A1 does not apply in NSW." variation="NSW" variation-type="DELETE">NSW DELETE Part</part-variation>'
      + '<part-variation href="/tmp/QppServer/p.xml" variation="NT" variation-type="REPLACE">NT REPLACE Part</part-variation>'
      + '<subtopic subtopic-type="governance">' + clauseref('/tmp/QppServer/4885_0.7.0.xml', '_a1g1') + '</subtopic></part>',
    'XMLs/A1-Interpreting-the-NCC-NT.xml': `<?xml version="1.0"?><?Xpress productLine="ncc-part" ?><part ${XT} id="_A1nt" outputclass="ncc-part" variation="NT">`
      + '<num>A1</num><title>Interpreting the NCC</title><intro-part><p>NT Part overview.</p></intro-part></part>',

    // ---- referenced material -----------------------------------------------------
    'XMLs/image-a1g1-stairway-terms.xml': '<?xml version="1.0"?><image-reference id="_fig1"><num>A1G1</num>'
      + '<title>Stairway terms</title><image alt="Stairway terms" href="/tmp/QppServer/a1g1-stairway-terms.svg"'
      + ' longdescref="(a) quarter landings - 2 flights. (b) continuous stairway - 1 flight." width="1200"/></image-reference>',
    'XMLs/table-a1g1-limits.xml': '<?xml version="1.0"?><table-reference id="_tab1" graph="None"><num>A1G1a</num>'
      + '<title>Limits</title><table><tgroup cols="2"><colspec colname="c1" colnum="1"/><colspec colname="c2" colnum="2"/>'
      + '<thead><row><entry>Climate zone</entry><entry>Eastern</entry></row></thead>'
      + '<tbody><row><entry>1</entry><entry>0.12</entry></row></tbody></tgroup></table>'
      + '<desc-note><p>Note to the table.</p></desc-note></table-reference>',

    // §2.1: three files per package sit in a DIRECTORY whose name is half a glossary term, and
    // two of the three are 2025-only entries. A flat readdir loses them silently, or throws EISDIR.
    'XMLs/glossary-CO2-e/m2.hr.xml': `<?xml version="1.0"?><?Xpress productLine="abcb-glossentry" ?>`
      + `<abcb-glossentry ${XT} id="_gnested" outputclass="abcb-glossentry"><glossterm>`
      + '<xt:insText xt:action="start" xt:dateTime="2024-01-01T00:00:00" xt:id="n"/>CO2-e/m2.hr<xt:insText xt:action="end" xt:id="n"/>'
      + '</glossterm><glossdef outputclass="glossdef"><p>Nested.</p></glossdef></abcb-glossentry>',

    // §7: volume-two ships one glossary entry the map inlines nowhere. It is real NCC 2022 text
    // and its category has to come from the national sense of the same term.
    'XMLs/glossary-Existing-building-WA.xml': '<?xml version="1.0"?><?Xpress productLine="abcb-glossentry" ?>'
      + '<abcb-glossentry id="_gwa" outputclass="abcb-glossentry" variation="WA"><glossterm>Existing building</glossterm>'
      + '<glossdef outputclass="glossdef"><p>WA sense.</p></glossdef></abcb-glossentry>',

    // ---- Images/ — capitalised, like XMLs/ ---------------------------------------
    'Images/image-a1g1-stairway-terms.svg': '<svg/>',
  };
  for (const [rel, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) continue;
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function withFixture(fn, overrides) {
  const dir = fixturePackage(overrides);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const byId = (units, id, state = null) => units.find(u => u.id === id && (u.state ?? null) === state);

test('the package walks: clause, glossary, page and overview units all reachable', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.ok(units.length, 'units were produced');
    for (const u of units) {
      assert.equal(u.edition, '2022');
      assert.equal(u.volume, 'volume-one');
      assert.ok(u.bodyTags, 'every unit carries the tag vocabulary its renderer needs');
    }
    assert.ok(byId(units, 'A1G1'), 'A1G1 emitted');
    assert.ok(units.some(u => u.kind === 'glossary' && u.term === 'Accessway' && !u.state));
    assert.ok(units.some(u => u.kind === 'page' && u.title === 'Front matter'));
  });
});

test('section context comes from topicset, with the leading kind word stripped (§4)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    const a1g1 = byId(units, 'A1G1');
    assert.equal(a1g1.sectionNum, 'A');
    assert.equal(a1g1.sectionType, 'section');
    assert.equal(a1g1.containerKind, 'part');
    assert.equal(a1g1.containerNum, 'A1');
    assert.equal(a1g1.containerTitle, 'Interpreting the NCC');
    const gl = units.find(u => u.kind === 'glossary' && u.term === 'Accessway' && !u.state);
    assert.equal(gl.sectionNum, '1', 'Schedule 1 keys the site as /1-definitions');
    assert.equal(gl.sectionType, 'schedule');
    const s1c1 = byId(units, 'S1C1');
    assert.equal(s1c1.containerKind, 'specification');
    assert.equal(s1c1.containerNum, '1');
  });
});

test('a clause id is the BASE sptc even when the filename carries the 2025 number (§1.2)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.ok(byId(units, 'F3D2'), 'the NCC 2022 designation F3D2');
    assert.equal(byId(units, 'F1D12'), undefined, 'the 2025 draft designation must not be emitted');
  });
});

test('a 2025-only clause (empty base sptc) is NOT emitted (§1.3)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.equal(units.filter(u => u.title === 'Isolation').length, 0,
      'B1P4-Isolation.xml is a 2025 addition and does not exist in NCC 2022');
  });
});

test('<placeholder>[ARCHIVE]</placeholder> is treated as an absent archive-num (§10)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.equal(byId(units, 'F3D2').supersedes, null);
    assert.equal(byId(units, 'A1G1').supersedes, '2019: A1.0');
  });
});

test('building classes and climate zones come from <meta><facet>, never from the clause (§10)', () => {
  withFixture(dir => {
    const u = byId(readPackage2022(dir, VOL1), 'A1G1');
    assert.equal(u.buildingClasses, 'Class 2, Class 3');
    assert.equal(u.climateZones, 'Climate zone 8');
  });
});

test('a DELETE pointer is a UNIT, and its provision is the @deleted-text attribute (§5.3)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    const nsw = byId(units, 'F4D10', 'NSW');
    assert.ok(nsw, 'a state disapplication is a unit to emit, never a dangling reference');
    assert.equal(nsw.kind, 'clause');
    const { bodyMd } = normalizeUnit(nsw, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /does not apply in NSW as the installation of hot water systems/);
  });
});

test('a DELETE pointer with NO deleted-text is still a unit (33 of them) (§5.3)', () => {
  withFixture(dir => {
    const sa = byId(readPackage2022(dir, VOL1), 'F4D10', 'SA');
    assert.ok(sa, 'the disapplication is the fact even without the explanatory sentence');
    const { bodyMd } = normalizeUnit(sa, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /SA/);
  });
});

test('REPLACE resolves by case-folded stem with space/dot normalisation (§5.3.1 rule a)', () => {
  withFixture(dir => {
    const v = byId(readPackage2022(dir, VOL1), '13.2.3', 'NSW');
    assert.ok(v, '13-2-3-roofs and ceilings.xml -> 13-2-3-Roofs-and-ceilings-NSW.xml');
    assert.match(normalizeUnit(v, { year: '2022', cdnKey: 'volume1' }).bodyMd, /NSW roof text/);
  });
});

test('REPLACE resolves on the BASE number when the host was renumbered (§5.3.1 rule b)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    const v = byId(units, 'B1P5', 'TAS');
    assert.ok(v, 'B1P6-pressure.xml (base sptc B1P5) -> B1P5-pressure-TAS.xml');
    assert.equal(v.supersedes, '2019:BP1.2, TAS Exemption 1');
    assert.ok(byId(units, 'B1P5'), 'the national clause keeps its base designation too');
  });
});

test('a REPLACE whose target is itself 2025-only is skipped (§5.3.2)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.ok(byId(units, 'C1D3'), 'the national clause is NCC 2022');
    assert.equal(byId(units, 'C1D3', 'WA'), undefined,
      'the pointer survives the base view but its target does not — the provision is not in NCC 2022');
  });
});

test('part-variation: DELETE emits a Part-level state unit, REPLACE resolves (§5.4)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    const nsw = units.find(u => u.containerNum === 'A1' && u.state === 'NSW');
    assert.ok(nsw, 'Part-level disapplications are law an agent must not lose');
    assert.match(normalizeUnit(nsw, { year: '2022', cdnKey: 'volume1' }).bodyMd,
      /left blank/);
    const nt = units.find(u => u.containerNum === 'A1' && u.state === 'NT');
    assert.ok(nt, 'the NT REPLACE resolves to A1-Interpreting-the-NCC-NT.xml');
    assert.match(normalizeUnit(nt, { year: '2022', cdnKey: 'volume1' }).bodyMd, /NT Part overview/);
  });
});

test('part-variation identities are deduped across FlattenedFile and the standalone part file (§5.4)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    const a1 = units.filter(u => u.containerNum === 'A1' && u.kind === 'page');
    const keys = a1.map(u => `${u.state ?? ''}|${u.title}`);
    assert.equal(new Set(keys).size, keys.length, '114 elements are 73 identities — dedupe or over-emit');
  });
});

test('subclause @deleted-text survives — an attribute a child walker never sees (§5.0)', () => {
  withFixture(dir => {
    const u = byId(readPackage2022(dir, VOL1), 'H2D6');
    const { bodyMd } = normalizeUnit(u, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /does not apply in VIC/);
    assert.doesNotMatch(bodyMd, /^SubClause$/m, '<title>SubClause</title> is boilerplate (11,520 of them)');
  });
});

test('the figure join is on @id, and the disk name comes from the four Images/ rules (§6)', () => {
  withFixture(dir => {
    const u = byId(readPackage2022(dir, VOL1), 'A1G1');
    const { bodyMd, figures } = normalizeUnit(u, { year: '2022', cdnKey: 'volume1' });
    assert.deepEqual(figures, ['image-a1g1-stairway-terms.svg'],
      'the conref is a publishing-session path and resolves nothing; @id is the key');
    assert.match(bodyMd, /!\[Figure A1G1: Stairway terms\]/);
    assert.match(bodyMd, /quarter landings - 2 flights/, '@longdescref is the figure legend, not a reference (§11)');
  });
});

test('CALS tables render — 2022 is tgroup/row/entry, not tr/td (§10)', () => {
  withFixture(dir => {
    const u = byId(readPackage2022(dir, VOL1), 'A1G1');
    const { bodyMd } = normalizeUnit(u, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /### Table A1G1a — Limits/);
    assert.match(bodyMd, /^\| Climate zone \| Eastern \|$/m);
    assert.match(bodyMd, /^\| 1 \| 0\.12 \|$/m);
    assert.match(bodyMd, /Note to the table/);
  });
});

test('XMLs/ is enumerated RECURSIVELY — three glossary terms hide in directories (§2.1)', () => {
  withFixture(dir => {
    const diagnostics = {};
    // A flat readdir throws EISDIR on `XMLs/glossary-CO2-e/`, or silently loses what is inside it.
    assert.doesNotThrow(() => readPackage2022(dir, VOL1, { diagnostics }));
    assert.equal(diagnostics.glossary.entries, 7, 'the nested entry is censused with the rest');
    assert.equal(diagnostics.glossary.only2025, 2, 'and it is one of the two 2025-only ones');
  });
});

test('glossary entries carry the category the web_url router needs (§7)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    assert.equal(units.find(u => u.term === 'Accessway' && !u.state).category, 'glossary');
    assert.equal(units.find(u => u.term === 'ABCB').category, 'abbreviation');
    assert.ok(units.find(u => u.term === 'Accessway' && u.state === 'NSW'), 'state glossary senses too');
    assert.equal(units.filter(u => u.term === 'Control layer').length, 0,
      '30 entries per package are 2025-only and must not be published as NCC 2022 definitions');
  });
});

test('a glossary entry the map inlines nowhere is rescued, with the national sense\'s category (§7)', () => {
  withFixture(dir => {
    const wa = readPackage2022(dir, VOL1).find(u => u.term === 'Existing building' && u.state === 'WA');
    assert.ok(wa, 'volume-two ships exactly one of these and nothing else would reach it');
    assert.equal(wa.category, 'glossary', 'taken from the national sense of the same term');
  });
});

test('topicset/@summary is content — the Section abstract exists nowhere else (§11)', () => {
  withFixture(dir => {
    const u = readPackage2022(dir, VOL1).find(x => x.containerKind === 'ncc-section' && x.sectionNum === 'A');
    assert.ok(u, 'a Section with a summary gets an overview unit');
    assert.match(normalizeUnit(u, { year: '2022', cdnKey: 'volume1' }).bodyMd,
      /Section A contains the governing requirements/);
  });
});

test('an unknown element in the map fails loud, naming the element and its path', () => {
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1), /mystery-tag/);
  }, {
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="G" section-num="Section A"><mystery-tag/></topicset></abcb-map>',
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('a conref target that is simply absent fails loud; a shipped-broken one is reported', () => {
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1), /nowhere-file\.xml/);
  }, {
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="G" section-num="Section A"><part outputclass="ncc-part"><num>A1</num><title>P</title>'
      + '<subtopic>' + clauseref('nowhere-file.xml') + '</subtopic></part></topicset></abcb-map>',
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('ERROR_IN_RESOLVING_URI conrefs are recorded, not thrown on (4 in volume-three)', () => {
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL1, { diagnostics });
    assert.ok(units.length, 'the rest of the publication still reads');
    assert.equal(diagnostics.brokenConrefs.length, 1);
    assert.match(diagnostics.brokenConrefs[0], /ERROR_IN_RESOLVING_URI/);
  }, {
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="G" section-num="Section A"><part outputclass="ncc-part"><num>A1</num><title>P</title>'
      + '<subtopic>' + clauseref('ERROR_IN_RESOLVING_URI:B7D2-general-requirements.xml') + clauseref('A1G1-scope.xml')
      + '</subtopic></part></topicset></abcb-map>',
    // This map holds no glossary, so a state glossary entry in the package could not be placed.
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('--sections slices on the derived section num', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1, { sections: ['A'] });
    assert.ok(units.some(u => u.sectionNum === 'A'));
    assert.ok(!units.some(u => u.sectionNum === '1'), 'Schedule 1 is out of scope');
  });
});

test('a slice that excludes a 2025-duplicate TWIN still reads (§4.1)', () => {
  // The duplicate check asks "is this designation already in the corpus". Asking the EMITTED
  // units makes the answer depend on the slice, so a slice that leaves the twin out turns a
  // reconciled duplicate into a throw. Measured on the real volume-one before the fix:
  // `--sections A` and `--sections C` both threw, because F3V1's twin lives in Section F --
  // and Task 11's pilot is `--sections A,C`. It is asked of the files the walk RESOLVED instead.
  withFixture(dir => {
    for (const sections of [['G'], ['F'], ['F', 'G'], null]) {
      const units = readPackage2022(dir, VOL1, { sections });
      assert.ok(units.length, `sections=${JSON.stringify(sections)} produced nothing`);
      assert.equal(units.filter(u => u.id === 'F3D2').length, sections && !sections.includes('F') ? 0 : 1);
    }
  }, {
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="Health and amenity" section-num="Section F">'
      + '<part outputclass="ncc-part" id="_F3"><num>F3</num><title>Roof and wall cladding</title>'
      + '<subtopic>' + clauseref('F3D2-roof-coverings.xml') + '</subtopic></part>'
      + '<part outputclass="ncc-part" id="_F1"><num>F1</num><title>Surface water management</title>'
      + '<subtopic><clauseref outputclass="clausref-ncc" xt:type="insert" xt:dateTime="2024-03-15T00:00:00">'
      + '<clause conref="F1D12-roof-coverings.xml" id="_stub2" outputclass="ncc-clause"><sptc/><title/><archive-num/></clause>'
      + '</clauseref></subtopic></part></topicset>'
      + '<topicset navtitle="Ancillary provisions" section-num="Section G">'
      + '<part outputclass="ncc-part" id="_G1"><num>G1</num><title>Minor structures</title>'
      + '<subtopic>' + clauseref('A1G1-scope.xml') + '</subtopic></part></topicset></abcb-map>',
    'XMLs/F3D2-roof-coverings.xml': `<?xml version="1.0"?><clause ${XT} id="_f3d2" outputclass="ncc-clause">`
      + '<sptc>F3D2</sptc><title>Roof coverings</title><archive-num/>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>Roof coverings must.</p></subclause></clause>',
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('a citation whose wrapper has no NCC 2022 content is DROPPED AND RECORDED (§6.2)', () => {
  // 32-34 table wrappers and 11 figure wrappers per package have no base-view content, and 14
  // live 2022 citations point at them: B1P1 loses all three minimum-annual-reliability-index
  // tables. The markdown gives a reader no signal that a cited table had no 2022 content, so the
  // record is the only place the loss can be seen -- and §5.3 calls an omission a reader cannot
  // detect the worst class there is.
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL1, { diagnostics });
    assert.deepEqual(diagnostics.droppedCitations,
      [{ host: 'A1G1-scope.xml', wrapper: 'table-a1g1-limits.xml', kind: 'table' }]);
    const body = normalizeUnit(byId(units, 'A1G1'), { year: '2022', cdnKey: 'volume1' }).bodyMd;
    assert.doesNotMatch(body, /Table A1G1a/, 'a 2025-draft table is never published as NCC 2022 law');
  }, {
    // The wrapper's only <table> is a 2024 insertion, so the base view leaves it empty.
    'XMLs/table-a1g1-limits.xml': `<?xml version="1.0"?><table-reference ${XT} id="_tab1"><num>A1G1a</num>`
      + '<title>Limits</title><table xt:type="insert" xt:dateTime="2024-08-30T11:12:31"><tgroup cols="1">'
      + '<colspec colname="c1" colnum="1"/><tbody><row><entry>0.10</entry></row></tbody></tgroup></table></table-reference>',
  });
});

test('BODY_TAGS_2022 tells the renderer which children belong to another unit', () => {
  for (const t of ['clause', 'clauseref', 'subtopic', 'part', 'specification', 'part-variation',
    'clause-variation', 'abcb-glossentry', 'page', 'topicset']) {
    assert.ok(BODY_TAGS_2022.skip.has(t), `${t} must be skipped when rendering an enclosing unit body`);
  }
  assert.ok(!BODY_TAGS_2022.skip.has('subclause'), 'subclause is prose and renders inline');
});

/* ================================================================= *
 * 5. Integration parity against the real packages (§1.3, §5, §6, §7). *
 * ================================================================= */

const pkgDir = doc => `.cache/extracted/${doc.pkg}`;
const have = fs.existsSync(pkgDir(VOL1));
const cache = new Map();
const readReal = doc => {
  if (!cache.has(doc.key)) {
    const diagnostics = {};
    cache.set(doc.key, { units: readPackage2022(pkgDir(doc), doc, { diagnostics }), diagnostics });
  }
  return cache.get(doc.key);
};

// Every number below is transcribed from docs/content-model-2022.md, which was measured against
// these packages over four review rounds. They are the acceptance criteria; a mismatch is
// information about the reader OR about the document, and is reported rather than tuned away.
const PARITY = {
  // §1.3, classified over every root <clause> file in the package
  membership: {
    'volume-one': { clauses: 1554, unchanged: 1475, renumbered: 20, only2022: 27, only2025: 32 },
    'volume-two': { clauses: 1341, unchanged: 1273, renumbered: 20, only2022: 19, only2025: 29 },
    'volume-three': { clauses: 1424, unchanged: 1328, renumbered: 34, only2022: 27, only2025: 35 },
    'housing-provisions': { clauses: 1399, unchanged: 1325, renumbered: 22, only2022: 19, only2025: 33 },
  },
  // §2 root-element census
  roots: {
    'volume-one': { 'abcb-glossentry': 543, 'abcb-map': 4, clause: 1554, 'image-reference': 229, page: 26, 'part/ncc-part': 81, 'part/standard-part': 12, specification: 49, 'table-reference': 419 },
    'volume-two': { 'abcb-glossentry': 544, 'abcb-map': 4, clause: 1341, 'image-reference': 194, page: 21, 'part/ncc-part': 56, 'part/standard-part': 12, specification: 42, 'table-reference': 428 },
    'volume-three': { 'abcb-glossentry': 543, 'abcb-map': 4, clause: 1424, 'image-reference': 229, page: 24, 'part/ncc-part': 61, 'part/standard-part': 16, specification: 42, 'table-reference': 449 },
    'housing-provisions': { 'abcb-glossentry': 543, 'abcb-map': 4, clause: 1399, 'image-reference': 336, page: 7, 'part/ncc-part': 37, 'part/standard-part': 64, specification: 41, 'table-reference': 549 },
  },
  // §4.1 map reconciliation, base view
  // `insertOnly` is §4.1's "A says 2025, B says 2022" column. All five are DUPLICATES of clauses
  // the base map already reaches, which is where this reader parts company with that section's
  // conclusion -- see the assertion block in read-2022.mjs.
  map: {
    'volume-one': { mapped: 1164, insertOnly: 5, insertOnlyDuplicates: 5, mappedNo2022: 0, brokenConref: 0 },
    'volume-two': { mapped: 238, insertOnly: 0, insertOnlyDuplicates: 0, mappedNo2022: 0, brokenConref: 0 },
    'volume-three': { mapped: 344, insertOnly: 0, insertOnlyDuplicates: 0, mappedNo2022: 9, brokenConref: 4 },
    'housing-provisions': { mapped: 288, insertOnly: 0, insertOnlyDuplicates: 0, mappedNo2022: 0, brokenConref: 0 },
  },
  // §5.3 / §5.3.2, counted over the pointers that survive the base view
  variations: {
    'volume-one': { del: 30, delText: 22, repl: 119, target2025: 2 },
    'volume-two': { del: 33, delText: 24, repl: 98, target2025: 2 },
    'volume-three': { del: 31, delText: 22, repl: 114, target2025: 2 },
    'housing-provisions': { del: 35, delText: 28, repl: 99, target2025: 3 },
  },
  // §5.4 — 114 elements are 73 identities
  partVariations: {
    'volume-one': { elements: 31, identities: 17 },
    'volume-two': { elements: 18, identities: 14 },
    'volume-three': { elements: 16, identities: 13 },
    'housing-provisions': { elements: 49, identities: 29 },
  },
  // §6.1 — distinct resolved disk files, base view
  figures: {
    'volume-one': { distinct: 218, baseEmptyWrappers: 11 },
    'volume-two': { distinct: 183, baseEmptyWrappers: 11 },
    'volume-three': { distinct: 218, baseEmptyWrappers: 11 },
    'housing-provisions': { distinct: 323, baseEmptyWrappers: 11 },
  },
  // §7 — 543 entries, 30 of them 2025-only
  glossary: {
    'volume-one': { entries: 543, only2025: 30, national: 499, NSW: 20, SA: 8, TAS: 6, VIC: 6, WA: 4 },
    'volume-two': { entries: 544, only2025: 30, national: 499, NSW: 20, SA: 8, TAS: 6, VIC: 6, WA: 5 },
    'volume-three': { entries: 543, only2025: 30, national: 499, NSW: 20, SA: 8, TAS: 6, VIC: 6, WA: 4 },
    'housing-provisions': { entries: 543, only2025: 30, national: 499, NSW: 20, SA: 8, TAS: 6, VIC: 6, WA: 4 },
  },
};

for (const doc of DOCUMENTS_2022) {
  test(`${doc.key}: root census matches §2`, { skip: !have }, () => {
    const { diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.roots, PARITY.roots[doc.key]);
  });

  test(`${doc.key}: edition membership matches §1.3`, { skip: !have }, () => {
    const { diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.membership, PARITY.membership[doc.key]);
  });

  test(`${doc.key}: map reconciliation matches §4.1`, { skip: !have }, () => {
    const { diagnostics } = readReal(doc);
    assert.deepEqual({
      mapped: diagnostics.map.mapped,
      insertOnly: diagnostics.map.insertOnly,
      insertOnlyDuplicates: diagnostics.map.insertOnlyDuplicates,
      mappedNo2022: diagnostics.map.mappedNo2022,
      brokenConref: diagnostics.brokenConrefs.length,
    }, PARITY.map[doc.key]);
  });

  test(`${doc.key}: state variations match §5.3 and §5.3.2`, { skip: !have }, () => {
    const { units, diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.clauseVariations, PARITY.variations[doc.key]);
    // The census above covers the WHOLE package; emission covers only the clauses this
    // publication's map reaches. They are different populations on purpose -- `XMLs/` is a shared
    // authoring pool, and Volume Two ships 2,642 files for a publication of 238 clauses (§3) --
    // so what is checked here is that every pointer the reader MET became a unit.
    // A state clause reaches the corpus by two routes, and both must work: a `clause-variation`
    // pointer on a national clause, and a clauseref the map lists directly (the 40 whose title
    // reads "NT INSERT Clause"). The pointer-derived units are therefore a SUBSET of the emitted
    // state units, never the whole of them.
    const emitted = units.filter(u => u.kind === 'clause' && u.state);
    const { del, repl } = diagnostics.stateClauseUnits;
    assert.ok(emitted.length >= del + repl, 'every pointer-derived unit is in the emitted set');
    assert.ok(del > 0 && repl > 0, 'both kinds of pointer produce units');
    assert.ok(del <= diagnostics.clauseVariations.del
      && repl <= diagnostics.clauseVariations.repl - diagnostics.clauseVariations.target2025,
    'emission cannot exceed the package-wide census');
    for (const u of emitted) assert.ok(u.id, `${u.title} [${u.state}]: a state unit still needs its clause id`);
  });

  test(`${doc.key}: part-variation identities match §5.4`, { skip: !have }, () => {
    const { diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.partVariations, PARITY.partVariations[doc.key]);
  });

  test(`${doc.key}: the figure join resolves and matches §6.1`, { skip: !have }, () => {
    const { diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.figures, PARITY.figures[doc.key]);
  });

  test(`${doc.key}: glossary census matches §7`, { skip: !have }, () => {
    const { units, diagnostics } = readReal(doc);
    assert.deepEqual(diagnostics.glossary, PARITY.glossary[doc.key]);
    const emitted = units.filter(u => u.kind === 'glossary');
    assert.equal(emitted.length, PARITY.glossary[doc.key].entries - PARITY.glossary[doc.key].only2025);
    // One entry corpus-wide has no national sense in any map, so which Schedule 1 sub-page
    // publishes it cannot be established. It is emitted with a null category — fail closed, and
    // reported — rather than dropped or filed under a guessed page.
    assert.deepEqual(diagnostics.uncategorisedGlossary,
      doc.key === 'volume-two' ? ['glossary-Existing-building-WA.xml'] : []);
    for (const u of emitted) {
      if (diagnostics.uncategorisedGlossary.length && u.term === 'Existing building') continue;
      assert.ok(u.category, `${u.term}: category routes web_url`);
    }
  });

  test(`${doc.key}: no unit carries 2025-draft markup`, { skip: !have }, () => {
    // THE question. A base-view failure produces a corpus that is wrong self-consistently, so it
    // is checked two ways over every emitted subtree: no milestone marker survives to reach the
    // renderer (§9.1), and no element inside a unit still carries a 2025-cycle insert mark.
    const { units } = readReal(doc);
    let checked = 0;
    for (const u of units) {
      const who = `${doc.key} ${u.kind} ${u.id ?? u.term ?? u.title}`;
      assert.ok(!/insText|delText/.test(u.node.toString()), `${who}: tracked markup survived`);
      (function scan(el) {
        checked++;
        assert.ok(baseViewKeeps(el), `${who}: <${el.nodeName}> is 2025-draft text inside a 2022 unit`);
        for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) scan(c);
      })(u.node);
    }
    assert.ok(checked > 10000, `only ${checked} elements walked — the check is not reaching the bodies`);
  });
}

test('volume-one: known 2022 identities, and the 2025 draft renumbering is absent', { skip: !have }, () => {
  const { units } = readReal(VOL1);
  assert.ok(byId(units, 'A5G7'), 'A5G7 present');
  assert.equal(byId(units, 'A5G7').supersedes, '2019: A5.6');
  assert.ok(byId(units, 'F3D2'), 'NCC 2022 numbering');
  assert.equal(byId(units, 'F1D12'), undefined, 'the 2025 draft renumbering must not ship as 2022');
  assert.equal(units.filter(u => u.sectionNum === 'K').length, 0,
    'Section K (embodied carbon) exists only through a 2024 tracked insertion');
  assert.ok(units.some(u => u.kind === 'clause' && u.id === 'F4D10' && u.state === 'NSW'));
});

test('housing-provisions: the Part-level NSW disapplications survive', { skip: !have }, () => {
  const { units } = readReal(HP);
  const nsw = units.filter(u => u.kind === 'page' && u.state === 'NSW');
  assert.ok(nsw.length, 'Part-level state units are emitted');
  const md = nsw.map(u => normalizeUnit(u, { year: '2022', cdnKey: 'housing' }).bodyMd).join('\n');
  assert.match(md, /left blank/);
});

test('every unit normalizes without an error, across all four packages', { skip: !have }, () => {
  for (const doc of DOCUMENTS_2022) {
    for (const u of readReal(doc).units) {
      assert.doesNotThrow(() => normalizeUnit(u, { year: '2022', cdnKey: doc.cdnKey }),
        `${doc.key}: ${u.kind} ${u.id ?? u.term ?? u.title}`);
    }
  }
});

test('a Part can be a jurisdiction\'s own — the state threads into its overview and its clauses (§4)', () => {
  withFixture(dir => {
    const units = readPackage2022(dir, VOL1);
    // Nine Part numbers corpus-wide are claimed by more than one <part> in a single map —
    // volume-one's I4 by NSW, TAS, VIC and WA — each holding only that state's clauses. Read the
    // attribute on clauses alone and four Part overviews derive ONE national filename.
    const tas = units.find(u => u.kind === 'page' && u.containerNum === 'A1' && u.state === 'TAS');
    assert.ok(tas, 'the Tasmanian Part overview keeps its jurisdiction');
    assert.match(normalizeUnit(tas, { year: '2022', cdnKey: 'volume1' }).bodyMd, /Tasmanian Part overview/);
    assert.equal(byId(units, 'A1G9', 'TAS')?.state, 'TAS', 'a clause under it inherits the Part state');
    const national = units.find(u => u.kind === 'page' && u.containerNum === 'A1' && !u.state && !u.node.getAttribute('variation'));
    assert.ok(national, 'the national Part overview is still emitted alongside it');
  });
});

test('a clause reachable only through a 2025 insertion is a DUPLICATE, not a rescue (§4.1)', () => {
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL1, { diagnostics });
    // F1D12-roof-coverings.xml has base sptc F3D2 and is byte-identical to F3D2-roof-coverings.xml,
    // which the base map DOES reach. Emitting it too writes the clause twice.
    assert.equal(units.filter(u => u.id === 'F3D2' && !u.state).length, 1);
    assert.equal(diagnostics.map.insertOnly, 1);
    assert.equal(diagnostics.map.insertOnlyDuplicates, 1);
  }, {
    'XMLs/F3D2-roof-coverings.xml': `<?xml version="1.0"?><clause ${XT} id="_f3d2" outputclass="ncc-clause">`
      + '<sptc>F3D2</sptc><title>Roof coverings</title><archive-num/>'
      + '<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>Roof coverings must.</p></subclause></clause>',
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="Health and amenity" section-num="Section F">'
      + '<part outputclass="ncc-part" id="_F3"><num>F3</num><title>Roof and wall cladding</title>'
      + '<subtopic>' + clauseref('F3D2-roof-coverings.xml') + '</subtopic></part>'
      + '<part outputclass="ncc-part" id="_F1"><num>F1</num><title>Surface water management</title>'
      + '<subtopic><clauseref outputclass="clausref-ncc" xt:type="insert" xt:dateTime="2024-03-15T00:00:00">'
      + '<clause conref="F1D12-roof-coverings.xml" id="_stub2" outputclass="ncc-clause"><sptc/><title/><archive-num/></clause>'
      + '</clauseref></subtopic></part></topicset></abcb-map>',
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('a clause reachable only through a 2025 insertion, and supplied by nothing else, fails loud', () => {
  withFixture(dir => {
    // Neither membership signal covers it, and the container the map offers belongs to the draft,
    // so there is no safe default — least of all filing it under the 2025 Part.
    assert.throws(() => readPackage2022(dir, VOL1), /reaches it only through a 2025 insertion/);
  }, {
    'XMLs/FlattenedFile.xml': `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1"><title>T</title>`
      + '<topicset navtitle="Health and amenity" section-num="Section F">'
      + '<part outputclass="ncc-part" id="_F1" xt:type="insert" xt:dateTime="2024-03-15T00:00:00">'
      + '<num>F1</num><title>Surface water management</title>'
      + '<subtopic>' + clauseref('F1D12-roof-coverings.xml') + '</subtopic></part></topicset></abcb-map>',
    'XMLs/glossary-Existing-building-WA.xml': null,
  });
});

test('an element marked under TWO spellings at once is judged by all of them (§1.1)', () => {
  // volume-one's 10-8-3-Ventilation-… carries a bare `type="insert" dateTime="2022-01-13"` beside
  // an `xt:type="insert" xt:dateTime="2024-03-12"`: inserted in the NCC 2022 cycle and again in
  // the 2025 one. Pairing "the last type" with "the last dateTime" would answer differently
  // depending on which spelling the source wrote last.
  const both = (a, b) => parse(`<image-reference ${XT} ${a} ${b}/>`).documentElement;
  const cycle2022 = 'type="insert" dateTime="2022-01-13T12:41:32"';
  const cycle2025 = 'xt:type="insert" xt:dateTime="2024-03-12T07:53:35"';
  assert.equal(baseViewKeeps(both(cycle2022, cycle2025)), false);
  assert.equal(baseViewKeeps(both(cycle2025, cycle2022)), false, 'the answer cannot depend on attribute order');
  // A 2024 DELETE is kept (it is NCC 2022 text the draft removes), so that pairing survives.
  assert.equal(baseViewKeeps(both(cycle2022, 'xt:type="delete" xt:dateTime="2024-03-12T07:53:35"')), true);
  // A <=2022 delete is dropped, and one mark saying drop is enough however the others read.
  assert.equal(baseViewKeeps(both('type="delete" dateTime="2021-06-01T00:00:00"',
    'xt:type="insert" xt:dateTime="2021-06-01T00:00:00"')), false, 'unanimity, not majority');
});

test('the leading-token figure rule refuses an ambiguous match rather than guessing (§6.1)', () => {
  // Rule 5 exists for one wrapper per package (`image-S46C2-…`, href `10145_0.2.0.png`) and is the
  // only rule that can match on a token as short as `10`. Taking the codepoint-first of several
  // candidates would attach a WRONG figure and say nothing — fail-open in a fail-loud module.
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1), /leading-token rule.*matches 2 files/s);
  }, {
    'XMLs/image-a1g1-stairway-terms.xml': '<?xml version="1.0"?><image-reference id="_fig1"><num>A1G1</num>'
      + '<title>Stairway terms</title><image alt="T" href="/tmp/QppServer/10145_0.2.0.png"/></image-reference>',
    'Images/image-a1g1-stairway-terms.svg': null,
    'Images/image-A1G1-first.svg': '<svg/>',
    'Images/image-A1G1-second.svg': '<svg/>',
  });
});

/* ================================================================= *
 * 7. R51 — the clauseref identity join, and the omissions it forces.  *
 * ================================================================= */

// A clauseref that STATES its target's identity, so these tests exercise the production path
// rather than the "identity not stated" tolerance the older fixtures rely on.
const identifiedRef = (conref, clauseId, titleId) =>
  `<clauseref outputclass="clausref-ncc"><clause conref="${conref}" id="${clauseId}" outputclass="ncc-clause">`
  + `<sptc/><title id="${titleId}"/><archive-num/></clause></clauseref>`;

const mapWith = refs => `<?xml version="1.0"?><abcb-map ${XT} publishing-id="vol1" publishing-year="2025" short-title="Volume One">`
  + '<title>NCC 2025 Volume One</title>'
  + '<topicset navtitle="Governing requirements" section-num="Section A" summary="Section A abstract.">'
  + '<part outputclass="ncc-part" id="_A1"><num>A1</num><title>Interpreting the NCC</title>'
  + '<intro-part><p>Part overview prose.</p></intro-part>'
  + `<subtopic subtopic-type="governance">${refs}</subtopic></part></topicset></abcb-map>`;

/** A clause file whose root @id and <title> @id are both spelled explicitly. */
const identifiedClause = (sptc, title, body, clauseId, titleId) =>
  `<?xml version="1.0"?><?Xpress productLine="ncc-clause" ?><clause ${XT} id="${clauseId}" outputclass="ncc-clause">`
  + `<sptc>${sptc}</sptc><title id="${titleId}">${title}</title><archive-num/>`
  + `<subclause outputclass="subclause"><title>SubClause</title><num>1</num><p>${body}</p></subclause></clause>`;

test('R56: both stated identities disagree and NOTHING holds the target — the clause is OMITTED', () => {
  // The measured defect, in miniature: the map names C1O1 and states an identity the package's
  // file of that name does not carry, because that file is Volume ONE's fire Objective. Emitting
  // it is how corpus/2022/volume-three/c1o1 came to publish it under "NCC 2022 V3 C1O1", linked to
  // the Plumbing Code's Part C1 page. No package holds the wanted id, so there is nothing to
  // recover and omission is the only honest answer.
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL3, { diagnostics });
    assert.equal(units.filter(u => u.id === 'C1O1').length, 0, 'the wrong-publication clause is not emitted');
    assert.deepEqual(diagnostics.omittedClauses.map(o => [o.clause, o.reason]),
      [['C1O1', 'map-identity-unresolved']]);
    assert.match(diagnostics.omittedClauses[0].evidence, /sanitary plumbing installation/,
      'the ruling travels with the omission, so the report can print why');
    assert.ok(diagnostics.unfiredRulings.length > 0,
      'volume-three\'s other rulings did not fire here — RECORDED, not thrown, for the build to assert');
  }, {
    'XMLs/FlattenedFile.xml': mapWith(identifiedRef('C1O1-objective.xml', '_wanted', '_wantedTitle')),
    'XMLs/C1O1-objective.xml':
      identifiedClause('C1O1', 'Objective', 'Another publication text.', '_other', '_otherTitle'),
  });
});

test('R60: a recovery reads ONE file from the sibling package the ruling names', { skip: !have }, () => {
  // R56 said do not read across packages, because a shared UUID is an inference. R60 lifts that for
  // four clauses where the inference was removed: the direction was proved from content AND from
  // ncc.abcb.gov.au on both sides, and the correct text sits in this repo at exactly the id the map
  // names. Deemed-to-Satisfy provisions are substantive law, and omitting them while the text is on
  // disk is a worse answer than reading one file under a ruling that quotes the published sentence.
  const diagnostics = {};
  const units = readPackage2022('.cache/extracted/ncc-2022-volume-one', VOL1, { diagnostics });
  const b1d1 = units.find(u => u.kind === 'clause' && u.id === 'B1D1' && !u.state);
  assert.ok(b1d1, 'V1 B1D1 is published again');
  const { bodyMd } = normalizeUnit(b1d1, { year: '2022', cdnKey: 'volume1' });
  assert.match(bodyMd, /Performance Requirements B1P1 to B1P4 are satisfied by complying with B1D2 to B1D6/,
    'the published V1 B1D1, fetched from the page this file\'s own web_url names');
  assert.doesNotMatch(bodyMd, /cold water service/, 'and not the Volume Three clause that shipped in this zip');
  assert.deepEqual(diagnostics.recoveredClauses.map(r => [r.clause, r.from]),
    [['B1D1', 'volume-three'], ['C2D1', 'volume-three']]);
  for (const r of diagnostics.recoveredClauses) {
    assert.ok(r.published.length > 40, 'the ruling carries the sentence ncc.abcb.gov.au publishes');
  }
});

test('R51: a disagreement that has NOT been ruled on fails the read', () => {
  // What makes the list a ruling rather than a licence: only the enumerated conrefs are omitted,
  // and anything else of the same shape stops the build instead of quietly shipping.
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1),
      /states clause @id _wanted \/ title @id _wantedTitle[\s\S]*no file in this package carries the stated identity/);
  }, {
    'XMLs/FlattenedFile.xml': mapWith(identifiedRef('A1G1-scope.xml', '_wanted', '_wantedTitle')),
  });
});

test('R51: where the stated identity IS in the package, the clauseref follows it', () => {
  // Rule 2 — a filename is not an identity, so when the map's own statement resolves here, THAT
  // file is the target. Inert on the real 2022 packages (0 redirects); implemented because it is
  // what makes the omission above a consequence of the join rather than an arbitrary exception.
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL1, { diagnostics });
    const emitted = units.find(u => u.id === 'A1G1');
    assert.ok(emitted, 'a clause was emitted for the clauseref');
    const { bodyMd } = normalizeUnit(emitted, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /the clause the map means/, 'the identity won, not the filename');
    assert.equal(diagnostics.identityRedirects, 1);
    assert.equal(diagnostics.omittedClauses.length, 0, 'a resolvable disagreement is not an omission');
  }, {
    'XMLs/FlattenedFile.xml': mapWith(identifiedRef('A1G1-scope.xml', '_realTarget', '_realTargetTitle')),
    'XMLs/A1G1-scope.xml': identifiedClause('A1G1', 'Scope', 'the WRONG file under the right name.', '_decoy', '_decoyTitle'),
    'XMLs/A1G1-scope-actual.xml':
      identifiedClause('A1G1', 'Scope', 'the clause the map means.', '_realTarget', '_realTargetTitle'),
  });
});

test('R51: a title-only disagreement fails rather than choosing a signal', () => {
  // Never observed in any package (measured: root-only 1, title-only 0), so which identity to
  // believe has not been established. Guessing would publish a clause under a title the map says
  // belongs to a different one — the same class of defect, one attribute smaller.
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1), /No clauseref in any package has this shape/);
  }, {
    'XMLs/FlattenedFile.xml': mapWith(identifiedRef('A1G1-scope.xml', '_agree', '_disagree')),
    'XMLs/A1G1-scope.xml': identifiedClause('A1G1', 'Scope', 'Body.', '_agree', '_actualTitle'),
  });
});

test('R52: an UNENUMERATED stale root id fails — a shared title @id is not proof of identity', () => {
  // Measured: 33 title @ids are reused across different filenames in these packages, including
  // same-package pairs whose designations differ (F1D12/F3D2, F1V1/F3V1, HP's B4P4 against the
  // others' B4P3). So a wrong file that happens to share the wanted title id presents in exactly
  // the B3F1 shape below. Tolerating that shape as a CLASS would publish it without a word; one
  // enumerated ruling with its evidence costs nothing and closes the hole.
  withFixture(dir => {
    assert.throws(() => readPackage2022(dir, VOL1), /A shared title @id is NOT proof of identity/);
  }, {
    'XMLs/FlattenedFile.xml': mapWith(identifiedRef('A1G1-scope.xml', '_wanted', '_sharedTitle')),
    'XMLs/A1G1-scope.xml': identifiedClause('A1G1', 'Scope', 'Body.', '_actual', '_sharedTitle'),
  });
});

test('R52: the enumerated stale root id keeps the conref join — the B3F1 shape', () => {
  // volume-three's B3F1 clauseref carries the SAME <clause @id> as the B2F1 clauseref two
  // subtopics earlier — an authoring copy-paste — while its <title @id> and its conref both
  // correctly name B3F1. Following the @id alone would publish heated-water text as B3F1, or
  // (B2F1 having been emitted already) drop B3F1 as a duplicate. Both are regressions on a file
  // that is currently correct, which is why the join needs BOTH identities to disagree.
  withFixture(dir => {
    const diagnostics = {};
    const units = readPackage2022(dir, VOL3, { diagnostics });
    const emitted = units.find(u => u.id === 'B3F1');
    assert.ok(emitted, 'B3F1 is still published');
    const { bodyMd } = normalizeUnit(emitted, { year: '2022', cdnKey: 'volume1' });
    assert.match(bodyMd, /non-drinking water/, 'and it is its own text, not the file the stale id names');
    assert.equal(diagnostics.omittedClauses.length, 0);
    assert.equal(diagnostics.identityRedirects, 0);
  }, {
    'XMLs/FlattenedFile.xml': mapWith(
      identifiedRef('B2F1-heated-water.xml', '_shared', '_b2f1Title')
      + identifiedRef('B3F1-non-drinking-water-supply.xml', '_shared', '_b3f1Title')),
    'XMLs/B2F1-heated-water.xml':
      identifiedClause('B2F1', 'Heated water supply', 'Heated water text.', '_shared', '_b2f1Title'),
    'XMLs/B3F1-non-drinking-water-supply.xml':
      identifiedClause('B3F1', 'Non-drinking water supply', 'Fixtures provided with non-drinking water.', '_b3f1', '_b3f1Title'),
  });
});

test('R51: every ruling names a volume, a conref and evidence a reader can check', () => {
  assert.ok(OMITTED_2022_CLAUSES.length, 'the list is not vacuously valid');
  const volumes = new Set(DOCUMENTS_2022.map(d => d.key));
  const seen = new Set();
  for (const e of OMITTED_2022_CLAUSES) {
    assert.ok(volumes.has(e.volume), `${e.clause}: ${e.volume} is not a document of this edition`);
    assert.match(e.conref, /\.xml$/, `${e.clause}: the conref is the filename the map states`);
    assert.ok(e.evidence.length >= 80, `${e.clause}: evidence is a measurement, not a label`);
    const key = `${e.volume}|${e.conref}`;
    assert.ok(!seen.has(key), `${key} is ruled on twice`);
    seen.add(key);
  }
  // Keyed on volume AND conref: the same filename is ruled on in volume-one and volume-three for
  // opposite halves of one swap, so a key on either alone would collapse the two rulings into one.
  assert.equal(recoveredClause('volume-one', 'B1D1-deemed-to-satisfy-provisions.xml').from, 'volume-three');
  assert.equal(recoveredClause('volume-three', 'B1D1-deemed-to-satisfy-provisions.xml').from, 'volume-one');
  assert.equal(recoveredClause('volume-two', 'B1D1-deemed-to-satisfy-provisions.xml'), null);
  assert.equal(omittedClause('volume-one', 'A1G1-scope.xml'), null);

  // One clauseref, one disposition — enforced at import, asserted here so the property is visible.
  for (const r of RECOVERED_2022_CLAUSES) {
    assert.equal(omittedClause(r.volume, r.conref), null, 'a clauseref is recovered or omitted, never both');
    assert.notEqual(r.from, r.volume, 'a recovery reads a SIBLING package');
    assert.ok(volumes.has(r.from), 'the sibling is a document of this edition');
    assert.ok(r.published.length > 40, 'the ruling quotes the sentence ncc.abcb.gov.au publishes');
    assert.ok(/^_[0-9a-f-]{36}$/.test(r.wantedId), 'the ruling records the identity the map states');
  }
  for (const e of STALE_ROOT_ID_CLAUSEREFS) {
    assert.ok(e.evidence.length >= 80, 'evidence is a measurement, not a label');
    assert.equal(staleRootId(e.volume, e.conref), e);
    assert.equal(staleRootId('volume-two', e.conref), null, 'the key is volume + conref');
  }
});

test('R55: the reader COUNTS clauserefs that state fewer than both identities', () => {
  // The counter build.mjs asserts on. Measured 0 of 2,061 in all four packages, so nothing in the
  // real data exercises it — and a guard that has never been seen to fire is a guard nobody knows
  // works. Two of the three clauserefs below state neither identity, one states both.
  withFixture(dir => {
    const diagnostics = {};
    readPackage2022(dir, VOL1, { diagnostics });
    assert.equal(diagnostics.map.mapped, 3);
    assert.equal(diagnostics.map.identityUnstated, 2,
      'both under-specified clauserefs are counted; the fully-stated one is not');
  }, {
    'XMLs/FlattenedFile.xml': mapWith(
      clauseref('A1G1-scope.xml')                                        // states neither
      + '<clauseref outputclass="clausref-ncc"><clause conref="B1D2-x.xml" id="_b1d2" '
      + 'outputclass="ncc-clause"><sptc/><title/><archive-num/></clause></clauseref>'  // id only
      + identifiedRef('B1D3-y.xml', '_b1d3', '_b1d3Title')),             // states both
    'XMLs/B1D2-x.xml': identifiedClause('B1D2', 'X', 'Body X.', '_b1d2', '_b1d2Title'),
    'XMLs/B1D3-y.xml': identifiedClause('B1D3', 'Y', 'Body Y.', '_b1d3', '_b1d3Title'),
  });
});

test('R60: a recovered clause citing a figure or table wrapper is REFUSED, not guessed', () => {
  // Latent today — all four recoveries carry only <xref> — and worth closing because the failure
  // would be silent. The unit is emitted under THIS package's filename, so a wrapper conref would
  // resolve against THIS package's wrapper index: the wrong figure attached, or an unresolvable
  // one dropped without a word. A wrong table of numeric limits is the defect class this pipeline
  // exists to prevent, so the recovery refuses rather than resolving against the wrong index.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncc-2022-sibling-'));
  try {
    // A sibling package holding the wanted identity, whose clause cites a table wrapper.
    const sibDir = path.join(tmp, DOCUMENTS_2022.find(d => d.key === 'volume-three').pkg, 'XMLs');
    fs.mkdirSync(sibDir, { recursive: true });
    fs.writeFileSync(path.join(sibDir, 'B1D1-deemed-to-satisfy-provisions.xml'),
      '<?xml version="1.0"?><?Xpress productLine="ncc-clause" ?>'
      + '<clause id="_00602d3a-be90-4fa0-9215-2a79f954937c" outputclass="ncc-clause">'
      + '<sptc>B1D1</sptc><title id="_50d46460-6dd7-402e-a1cf-53d1146449ff">Deemed-to-Satisfy Provisions</title>'
      + '<archive-num/><subclause outputclass="subclause"><title>SubClause</title><num>1</num>'
      + '<p>See the table.</p><table-reference conref="/tmp/QppServer/z.xml" id="_t1"/></subclause></clause>');
    const pkgDir = path.join(tmp, DOCUMENTS_2022[0].pkg);
    fixturePackage({}, pkgDir);
    fs.writeFileSync(path.join(pkgDir, 'XMLs', 'FlattenedFile.xml'),
      mapWith(identifiedRef('B1D1-deemed-to-satisfy-provisions.xml',
        '_00602d3a-be90-4fa0-9215-2a79f954937c', '_50d46460-6dd7-402e-a1cf-53d1146449ff')));
    fs.writeFileSync(path.join(pkgDir, 'XMLs', 'B1D1-deemed-to-satisfy-provisions.xml'),
      identifiedClause('B1D1', 'Deemed-to-Satisfy Provisions', 'The wrong publication.', '_other', '_otherTitle'));
    assert.throws(() => readPackage2022(pkgDir, VOL1, { diagnostics: {} }),
      /cites a <table-reference>[\s\S]*wrapper index rather than volume-three's/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
