// normalize.test.mjs — the format contract.
//
// Test 1 is the acceptance criterion for the whole repo: a glossary cross-reference must not
// split a sentence, because the defect this corpus exists to fix is a phrase grep that finds
// nothing when it crosses a reference boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { normalizeUnit } from '../src/normalize.mjs';
import { BODY_SKIP_TAGS, BODY_TAGS_2025, DOCUMENTS_2025, overviewChildren, readDocument2025 } from '../src/read-2025.mjs';
import { BODY_TAGS_2022 } from '../src/read-2022.mjs';

const el = s => new DOMParser().parseFromString(s, 'text/xml').documentElement;
const opts = { year: '2025', cdnKey: 'volume1' };
// `bodyTags` is the edition's body vocabulary, and normalizeUnit REFUSES a unit without one:
// which child tags belong to another unit is a property of the reader, not of the renderer.
const unit = (node, extra = {}) => ({ node, kind: 'clause', id: 'T1', title: 'T', bodyTags: BODY_TAGS_2025, ...extra });
const md = (xml, o = opts, extra) => normalizeUnit(unit(el(xml), extra), o).bodyMd;
const CDN = 'https://cdn.aecassistant.com.au/images/ncc';

/* ============================================================ *
 * 1. The phrase test — both editions' cross-reference element.  *
 * ============================================================ */

test('xrefs inline as plain prose — phrase grep works across the boundary', () => {
  const n = el(`<clause><title>T</title><subclause><num>1</num><p>A ceiling is deemed to have a <xref type="abcb-glossentry">resistance to the incipient spread of fire</xref> to the space above itself if—</p></subclause></clause>`);
  const { bodyMd, definedTerms } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /deemed to have a resistance to the incipient spread of fire to the space above itself/);
  assert.deepEqual(definedTerms, ['resistance to the incipient spread of fire']);
  assert.ok(!bodyMd.split('\n').some(l => /deemed to have a\s*$/.test(l)), 'no line break at xref boundary');
});

test('2025 <a> is the same rule as 2022 <xref>, on the real clause>subclause>content>num+p shape', () => {
  // R15 + R16: <xref> does not exist in 2025; <a type="abcb-glossentry"> does, and num is a
  // sibling of p inside a <content> wrapper.
  const n = el(`<clause><sptc>A5G7</sptc><title>Resistance to the incipient spread of fire</title>`
    + `<subclause sptc="A5G7" num="1"><content><num>(1) </num>`
    + `<p>A ceiling is deemed to have a <a href="#_617607ac" type="abcb-glossentry">resistance to the incipient spread of fire</a> to the space above itself if—</p>`
    + `</content></subclause></clause>`);
  const { bodyMd, definedTerms } = normalizeUnit(unit(n, { id: 'A5G7' }), opts);
  const line = bodyMd.split('\n').find(l => l.includes('deemed'));
  assert.equal(line,
    '**(1)** A ceiling is deemed to have a resistance to the incipient spread of fire to the space above itself if—');
  assert.deepEqual(definedTerms, ['resistance to the incipient spread of fire']);
});

test('defined terms come from both glossary link types, deduped in document order', () => {
  const n = el(`<clause><title>T</title><content>`
    + `<p>See <a href="#a" type="abcb-glossentry">fire source feature</a> and <a href="#b" type="glossterm">Performance Solution</a>.</p>`
    + `<p>Again <a href="#a" type="abcb-glossentry">fire source feature</a>, plus <a href="#c" type="clause">C2D2</a>.</p>`
    + `</content></clause>`);
  const { definedTerms } = normalizeUnit(unit(n), opts);
  assert.deepEqual(definedTerms, ['fire source feature', 'Performance Solution'],
    'clause cross-references are not defined terms');
});

/* ============================================================ *
 * 2. Sub-clause numbering and ordered lists.                    *
 * ============================================================ */

test('subclause numbering and alpha-default lists', () => {
  const n = el(`<clause><title>T</title><subclause><num>1</num><p>Intro—</p>
    <ol><li><p>first;</p></li><li><p>second.</p><ol><li><p>inner.</p></li></ol></li></ol></subclause></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /\*\*\(1\)\*\* Intro—/);
  assert.match(bodyMd, /^\(a\) first;/m);
  // Census correction to the brief: the level below alpha is lower-roman in the NCC, not alpha.
  // Evidence: 180 prose references of the form "(a)(i)" / "S1C2(d)(iv)" across the five 2025
  // documents and ZERO of the form "(a)(a)"; the corpus even names a figure
  // "…in-accordance-with-F8D6(1)(a)(i).svg". Alpha at both levels makes "F8D6(1)(a)(i)"
  // unresolvable in the file that contains it.
  assert.match(bodyMd, /^ {2}\(i\) inner\./m, 'nested list indents and restarts as roman');
});

test('explicit numbered list style honored', () => {
  const n = el(`<clause><title>T</title><ol class="numbered"><li><p>one</p></li></ol></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^\(1\) one/m);
});

test('a declared style always beats the depth default', () => {
  // 15 nested <ol class="alpha"> and 6 nested <ol class="lower-roman"> exist in the corpus.
  const n = el(`<clause><title>T</title><ol class="alpha"><li>outer<ol class="alpha"><li>still alpha</li></ol></li></ol></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^ {2}\(a\) still alpha/m);
  const r = el(`<clause><title>T</title><ol class="lower-roman"><li>roman at top</li></ol></clause>`);
  assert.match(normalizeUnit(unit(r), opts).bodyMd, /^\(i\) roman at top/m);
});

test('the default follows the PARENT list style, not absolute depth (the livable-housing shape)', () => {
  // LHD runs numbered -> alpha(declared) -> undeclared, and cites "(a)(v)" and "(b)(ii)" in its
  // own prose. An absolute-depth ladder would have labelled that third level "(A)".
  const n = el(`<standard-clause><sptc>1.1</sptc><title>T</title><content>`
    + `<ol class="numbered"><li>top<ol class="alpha"><li>mid<ol><li>leaf</li></ol></li></ol></li></ol>`
    + `</content></standard-clause>`);
  const b = normalizeUnit(unit(n, { id: '1.1' }), opts).bodyMd;
  assert.match(b, /^\(1\) top/m);
  assert.match(b, /^ {2}\(a\) mid/m);
  assert.match(b, /^ {4}\(i\) leaf/m);
});

test('the undeclared ladder is alpha / lower-roman / upper-alpha', () => {
  // Third level: 18 prose references of the form "(i)(A)" / "(iii)(B)", zero of "(i)(a)".
  const n = el(`<clause><title>T</title><ol class="alpha"><li>L0<ol><li>L1<ol><li>L2</li></ol></li></ol></li></ol></clause>`);
  const b = normalizeUnit(unit(n), opts).bodyMd;
  assert.match(b, /^\(a\) L0/m);
  assert.match(b, /^ {2}\(i\) L1/m);
  assert.match(b, /^ {4}\(A\) L2/m);
});

test('list labels increment past the tenth item in every style', () => {
  const items = Array.from({ length: 11 }, (_, i) => `<li>item${i}</li>`).join('');
  const alpha = normalizeUnit(unit(el(`<clause><title>T</title><ol class="alpha">${items}</ol></clause>`)), opts).bodyMd;
  assert.match(alpha, /^\(k\) item10/m);
  const roman = normalizeUnit(unit(el(`<clause><title>T</title><ol class="lower-roman">${items}</ol></clause>`)), opts).bodyMd;
  assert.match(roman, /^\(xi\) item10/m);
  const num = normalizeUnit(unit(el(`<clause><title>T</title><ol class="numbered">${items}</ol></clause>`)), opts).bodyMd;
  assert.match(num, /^\(11\) item10/m);
});

test('table notes are numbered, because the corpus cites them as "Note 10"', () => {
  const n = el(`<clause><title>T</title><table-reference num="1" sptc=""><title>Adoption</title>`
    + `<table><thead><tr><th>S</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>`
    + `<desc-note><ol><li>1 May 2006</li><li>1 May 2010</li></ol></desc-note></table-reference></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^> \(1\) 1 May 2006/m);
});

test('unordered lists become dashes', () => {
  const n = el(`<clause><title>T</title><ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul></clause>`);
  const b = normalizeUnit(unit(n), opts).bodyMd;
  assert.match(b, /^- one$/m);
  assert.match(b, /^ {2}- deep$/m);
});

test('a list item with several paragraphs keeps each paragraph on its own line', () => {
  const n = el(`<clause><title>T</title><ol class="alpha"><li>delete and insert:<p><strong>6.5.1 General</strong></p><p>Each fixture must have a trap.</p></li></ol></clause>`);
  const lines = normalizeUnit(unit(n), opts).bodyMd.split('\n');
  assert.ok(lines.includes('(a) delete and insert:'));
  assert.ok(lines.includes('  **6.5.1 General**'));
  assert.ok(lines.includes('  Each fixture must have a trap.'));
});

/* ============================================================ *
 * 3. Figures.                                                   *
 * ============================================================ */

test('img becomes CDN figure link and is recorded', () => {
  const n = el(`<clause><title>T</title><p>See figure.</p><img src="image-A2G1-ncc-compliance-structure.svg"/></clause>`);
  const { bodyMd, figures } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /!\[[^\]]*\]\(https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/volume1\/image-A2G1-ncc-compliance-structure\.svg\)/);
  assert.deepEqual(figures, ['image-A2G1-ncc-compliance-structure.svg']);
});

test('image-reference supplies the figure designation and caption (R14)', () => {
  const n = el(`<clause><title>T</title><image-reference id="x" num="A2G1"><title>NCC compliance structure</title>`
    + `<img src="image-A2G1-ncc-compliance-structure.svg"/><desc-note><p>Explanatory only.</p></desc-note></image-reference></clause>`);
  const { bodyMd, figures } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /^!\[Figure A2G1: NCC compliance structure\]\(https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/volume1\/image-A2G1-ncc-compliance-structure\.svg\)$/m);
  assert.match(bodyMd, /^> Explanatory only\.$/m, 'the figure note is a blockquote');
  assert.deepEqual(figures, ['image-A2G1-ncc-compliance-structure.svg']);
});

test('an empty <title/> and empty num still produce a valid figure link', () => {
  const n = el(`<clause><title>T</title><image-reference num=""><title/><img src="image-cc-by NCC 2025.svg"/></image-reference></clause>`);
  const { bodyMd, figures } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /^!\[Figure\]\(https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/volume1\/image-cc-by%20NCC%202025\.svg\)$/m);
  assert.deepEqual(figures, ['image-cc-by NCC 2025.svg']);
});

test('parentheses in a filename are percent-encoded so the markdown link cannot close early', () => {
  const n = el(`<clause><title>T</title><image-reference num="F8D5c"><title>Roof space</title>`
    + `<img src="image-F8D5c-(explanatory)-example-of-multi-pitched-roof-space.svg"/></image-reference></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /image-F8D5c-%28explanatory%29-example-of-multi-pitched-roof-space\.svg\)$/m);
  assert.ok(!/\(explanatory\)/.test(bodyMd), 'raw parens would terminate the link destination');
});

test('cdnKey and year thread into the URL for every document', () => {
  const n = el(`<clause><title>T</title><img src="a.svg"/></clause>`);
  assert.match(normalizeUnit(unit(n), { year: '2022', cdnKey: 'housing' }).bodyMd,
    new RegExp(`${CDN.replace(/[.]/g, '\\.')}/2022/housing/a\\.svg`));
});

test('figures are deduped but keep document order', () => {
  const n = el(`<clause><title>T</title><img src="b.svg"/><img src="a.svg"/><img src="b.svg"/></clause>`);
  assert.deepEqual(normalizeUnit(unit(n), opts).figures, ['b.svg', 'a.svg']);
});

/* ============================================================ *
 * 4. Tables.                                                    *
 * ============================================================ */

test('tables render as GFM with flattened cells', () => {
  const n = el(`<clause><title>T</title><table><tr><th>FRL</th><th>Min</th></tr><tr><td>90/90/90</td><td>Yes\n really</td></tr></table></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /\| FRL \| Min \|/);
  assert.match(bodyMd, /\| 90\/90\/90 \| Yes really \|/);
});

test('rowspan and colspan duplicate cells so every row has the same width, and warn', () => {
  const n = el(`<clause><title>T</title><table>`
    + `<thead><tr><th rowspan="2">Element</th><th colspan="2">FRL</th></tr></thead>`
    + `<tbody><tr><td>A</td><td>B</td></tr></tbody></table></clause>`);
  const { bodyMd, warnings } = normalizeUnit(unit(n), opts);
  const rows = bodyMd.split('\n').filter(l => l.startsWith('|'));
  assert.equal(rows[0], '| Element | FRL | FRL |');
  assert.equal(rows[1], '| --- | --- | --- |');
  assert.equal(rows[2], '| Element | A | B |', 'the rowspan cell repeats into the second row');
  assert.ok(warnings.some(w => w.startsWith('table-irregular:')));
});

test('a two-row header keeps both rows verbatim — row 2 becomes the first body row, with a warning', () => {
  // 151 of the 651 corpus tables have two header rows; GFM allows exactly one. Merging them would
  // fabricate text ("A — B") that is in no source table, so both rows are kept as they are.
  const n = el(`<clause><title>T</title><table>`
    + `<thead><tr><th rowspan="2">Element</th><th colspan="2">FRL</th></tr>`
    + `<tr><th>Level 1</th><th>Level 2</th></tr></thead>`
    + `<tbody><tr><td>Wall</td><td>60</td><td>90</td></tr></tbody></table></clause>`);
  const { bodyMd, warnings } = normalizeUnit(unit(n), opts);
  const rows = bodyMd.split('\n').filter(l => l.startsWith('|'));
  assert.deepEqual(rows, [
    '| Element | FRL | FRL |',
    '| --- | --- | --- |',
    '| Element | Level 1 | Level 2 |',
    '| Wall | 60 | 90 |',
  ]);
  assert.ok(warnings.some(w => w.startsWith('table-multirow-header:')));
});

test('a pipe in cell text is escaped so it cannot break the table', () => {
  const n = el(`<clause><title>T</title><table><tr><th>h</th></tr><tr><td>a|b</td></tr></table></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^\| a\\\|b \|$/m);
});

test('table-reference emits a heading, then the table, then its notes', () => {
  const n = el(`<clause><title>T</title><table-reference id="t" num="B1P1 (explanatory)" sptc="B1P1">`
    + `<title>Approximate equivalent probabilities of failure</title>`
    + `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>`
    + `<desc-note><p>For the purposes of this table…</p></desc-note></table-reference></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /^### Table B1P1 \(explanatory\) — Approximate equivalent probabilities of failure$/m);
  assert.ok(bodyMd.indexOf('### Table') < bodyMd.indexOf('| a |'));
  assert.match(bodyMd, /^> For the purposes of this table…$/m);
});

/* ============================================================ *
 * 5. Blocks, callouts, headings, state variations.              *
 * ============================================================ */

test('callouts become blockquotes, one line per paragraph, title in bold', () => {
  const n = el(`<clause><title>T</title><callout><title>Explanatory information</title>`
    + `<content><p>First note.</p><p>Second note.</p></content></callout></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.match(bodyMd, /^> \*\*Explanatory information\*\*$/m);
  assert.match(bodyMd, /^>$/m, 'blank blockquote line separates blocks');
  assert.match(bodyMd, /^> First note\.$/m);
  assert.match(bodyMd, /^> Second note\.$/m);
});

test('section headings render once — the h2/h3 duplicate of <title> is dropped', () => {
  const n = el(`<page><title>P</title><content><section><title>Attribution</title><h2>Attribution</h2>`
    + `<p>Use of all or part of this publication…</p>`
    + `<section><title>Deeper</title><h3>Deeper</h3><p>More.</p></section></section></content></page>`);
  const { bodyMd } = normalizeUnit(unit(n, { kind: 'page', id: null, title: 'P' }), opts);
  assert.equal(bodyMd.match(/Attribution/g).length, 1, 'heading emitted exactly once');
  assert.match(bodyMd, /^## Attribution$/m);
  assert.match(bodyMd, /^### Deeper$/m);
});

test('an h2/h3 that differs from its sibling title is not dropped', () => {
  const n = el(`<page><title>P</title><content><section><title>One</title><h2>Two</h2><p>x</p></section></content></page>`);
  const { bodyMd } = normalizeUnit(unit(n, { kind: 'page', id: null }), opts);
  assert.match(bodyMd, /^## One$/m);
  assert.match(bodyMd, /^## Two$/m);
});

test('subclause-variation is labelled so varied text is never mistaken for national text', () => {
  const n = el(`<clause><sptc>A1G4</sptc><title>Interpretation</title>`
    + `<subclause><content><num>(6)</num><p>National text.</p></content>`
    + `<subclause-variation type="INSERT" state="TAS" sptc="A1G4" num="7"><title>Interpretation</title>`
    + `<content><num>(7) </num><p>The Director of Building Control may issue written advice.</p></content>`
    + `</subclause-variation></subclause></clause>`);
  const { bodyMd } = normalizeUnit(unit(n, { id: 'A1G4' }), opts);
  assert.match(bodyMd, /^\*\*TAS variation \(INSERT\) — Interpretation\*\*$/m);
  assert.match(bodyMd, /^\*\*\(7\)\*\* The Director of Building Control may issue written advice\.$/m);
  assert.ok(bodyMd.indexOf('TAS variation') < bodyMd.indexOf('Director'));
});

test('a notice survives verbatim on one line', () => {
  const text = 'This specification has been deliberately left blank. Specification 44 of the ABCB Housing Provisions 2025 does not apply in NSW.';
  const n = el(`<specification><title>S44</title><notice>${text}</notice></specification>`);
  const { bodyMd } = normalizeUnit(
    { node: n, kind: 'page', id: null, title: 'S44', overview: true, bodyTags: BODY_TAGS_2025 }, opts);
  assert.ok(bodyMd.split('\n').includes(text));
});

test('signage survives verbatim, block or inline', () => {
  const n = el(`<clause><title>T</title><content><signage>WARNING — SLIDING FIRE DOOR</signage></content>`
    + `<content><ol class="alpha"><li>a sign stating <signage>FIRE SAFETY DOOR</signage>; and</li></ol></content></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.ok(bodyMd.split('\n').includes('WARNING — SLIDING FIRE DOOR'));
  assert.ok(bodyMd.split('\n').includes('(a) a sign stating FIRE SAFETY DOOR; and'));
});

test('resources become a link list', () => {
  const n = el(`<clause><title>T</title><resources><link href="https://example.org/h.pdf" title="Handbook"/></resources></clause>`);
  assert.match(normalizeUnit(unit(n), opts).bodyMd, /^- \[Handbook\]\(https:\/\/example\.org\/h\.pdf\)$/m);
});

test('glossary bodies render the definition and the acronym, never the term itself', () => {
  const n = el(`<glossentry category="glossary"><glossterm>Aluminium Composite Panel (ACP)</glossterm>`
    + `<glossdef><content><p>Flat or profiled aluminium sheet material.</p></content></glossdef>`
    + `<glossBody><glossAlt><glossAcronym>ACP</glossAcronym></glossAlt></glossBody></glossentry>`);
  const { bodyMd } = normalizeUnit(
    { node: n, kind: 'glossary', id: null, term: 'Aluminium Composite Panel (ACP)', title: 'Aluminium Composite Panel (ACP)', bodyTags: BODY_TAGS_2025 }, opts);
  assert.match(bodyMd, /^Flat or profiled aluminium sheet material\.$/m);
  assert.match(bodyMd, /^Acronym: ACP$/m);
  assert.ok(!/^Aluminium Composite Panel/m.test(bodyMd), 'the term is the H1, not the body');
});

/* ============================================================ *
 * 6. Inline marks and links.                                    *
 * ============================================================ */

test('inline marks: bold, italic, sup/sub as-is, tracked insertions as plain text', () => {
  const n = el(`<clause><title>T</title><content><p>Area 300 m<sup>2</sup> and H<sub>2</sub>O with `
    + `<strong>must</strong> and <i>i</i> and <em>j</em> and<ins> the design of buildings</ins>.</p></content></clause>`);
  const line = normalizeUnit(unit(n), opts).bodyMd.split('\n').find(l => l.includes('Area'));
  assert.equal(line, 'Area 300 m2 and H2O with **must** and *i* and *j* and the design of buildings.');
});

test('internal cross-references inline as text; external URLs keep their link', () => {
  const n = el(`<clause><title>T</title><content>`
    + `<p>Refer <a href="#_8dd" type="ncc-clause">A5G6</a> and <a href="https://www.abcb.gov.au/">Australian Building Codes Board</a>.</p>`
    + `<p>Broken <a href="Planning Act 2023 | Acts">Planning Act 2023</a>.</p></content></clause>`);
  const b = normalizeUnit(unit(n), opts).bodyMd;
  assert.match(b, /^Refer A5G6 and \[Australian Building Codes Board\]\(https:\/\/www\.abcb\.gov\.au\/\)\.$/m);
  assert.match(b, /^Broken Planning Act 2023\.$/m, 'an href that is not a URL is dropped, not emitted');
});

/* ============================================================ *
 * 7. MathML.                                                    *
 * ============================================================ */

test('MathML flattens to a linear, greppable form and the MathType annotation is dropped', () => {
  const n = el(`<clause><title>T</title><content><p>Given <equation-inline><mathML><math><semantics>`
    + `<mrow><msub><mi>P</mi><mi>F</mi></msub><mo>=</mo><mfrac><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow><mrow><mi>b</mi></mrow></mfrac>`
    + `<msqrt><mrow><mi>x</mi><mi>y</mi></mrow></msqrt><msup><mi>σ</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup></mrow>`
    + `<annotation encoding="MathType-MTEF">MathType@MTEF@5@5@+= feaahCart1ev3aqatCvAUfeB</annotation>`
    + `</semantics></math></mathML><img src=""/></equation-inline> holds.</p></content></clause>`);
  const { bodyMd, warnings, figures } = normalizeUnit(unit(n), opts);
  const line = bodyMd.split('\n').find(l => l.includes('Given'));
  assert.equal(line, 'Given P_F=(a+1)/b√(xy)σ^(−1) holds.');
  assert.ok(!/MathType/.test(bodyMd), 'the MTEF annotation is an alternate encoding, never corpus text');
  assert.deepEqual(figures, [], 'the empty <img/> inside an equation is not a figure');
  assert.equal(warnings.filter(w => w.startsWith('mathml-flattened:')).length, 1);
});

test('equation-block is its own block; mfenced, mover and msubsup all linearise', () => {
  const n = el(`<clause><title>T</title><content><equation-block><mathML><math><semantics><mrow>`
    + `<mfenced close="]" open="["><mrow><mover accent="true"><mi>R</mi><mo>¯</mo></mover></mrow></mfenced>`
    + `<msubsup><mi>C</mi><mi>S</mi><mn>2</mn></msubsup>`
    + `</mrow></semantics></math></mathML><img src=""/></equation-block></content></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.ok(bodyMd.split('\n').includes('[R¯]C_S^2'));
});

/* ============================================================ *
 * 8. Fail-loud, unit isolation, determinism.                    *
 * ============================================================ */

test('unknown inline element throws with unit identity', () => {
  const n = el(`<clause><title>T</title><p>x <wat>y</wat></p></clause>`);
  assert.throws(() => normalizeUnit(unit(n), opts), /wat.*T1/s);
});

test('unknown block element throws with unit identity', () => {
  const n = el(`<clause><title>T</title><sidebar><p>y</p></sidebar></clause>`);
  assert.throws(() => normalizeUnit(unit(n), opts), /sidebar.*T1/s);
});

test('the throw names a glossary unit by its term when it has no id', () => {
  const n = el(`<glossentry><glossterm>fire source feature</glossterm><glossdef><content><p>a <zz/></p></content></glossdef></glossentry>`);
  assert.throws(() => normalizeUnit({ node: n, kind: 'glossary', id: null, term: 'fire source feature', bodyTags: BODY_TAGS_2025 }, opts),
    /zz.*fire source feature/s);
});

test('an img with no src outside an equation throws rather than emitting a dead link', () => {
  const n = el(`<clause><title>T</title><image-reference num="X"><title>T</title><img src=""/></image-reference></clause>`);
  assert.throws(() => normalizeUnit(unit(n), opts), /src.*T1/s);
});

test("a unit's body is its own content only — nested variations belong to their own file (R1)", () => {
  const n = el(`<clause><sptc>C1</sptc><title>T</title>`
    + `<subclause><content><num>(1)</num><p>National requirement.</p></content></subclause>`
    + `<clause-variation state="NSW" sptc="C1" type="REPLACE"><title>T</title>`
    + `<subclause><content><num>(1)</num><p>New South Wales requirement.</p></content></subclause></clause-variation></clause>`);
  const { bodyMd } = normalizeUnit(unit(n, { id: 'C1' }), opts);
  assert.match(bodyMd, /National requirement/);
  assert.ok(!/New South Wales requirement/.test(bodyMd), 'phrase grep must not return the wrong jurisdiction');
});

test('an overview unit renders only the container prose, never the clauses beneath it (R19)', () => {
  const n = el(`<part num="A1"><title>Interpretation</title><intro-part><content><p>This Part contains…</p></content></intro-part>`
    + `<subtopic><clause><sptc>A1G1</sptc><title>Scope</title><subclause><content><num>(1)</num><p>Clause text.</p></content></subclause></clause>`
    + `<callout><content><p>Subtopic-level guidance.</p></content></callout></subtopic></part>`);
  const { bodyMd } = normalizeUnit(
    { node: n, kind: 'page', id: null, title: 'Interpretation', overview: true, bodyTags: BODY_TAGS_2025 }, opts);
  assert.match(bodyMd, /This Part contains…/);
  assert.match(bodyMd, /Subtopic-level guidance/, 'callouts under a subtopic belong to the Part overview');
  assert.ok(!/Clause text/.test(bodyMd), 'the clause has its own file');
});

test('paragraphs are single lines (never hard-wrapped)', () => {
  const long = 'word '.repeat(120).trim();
  const n = el(`<clause><title>T</title><p>${long}</p></clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.ok(bodyMd.split('\n').includes(long));
});

test('pretty-printed source indentation never leaks into prose', () => {
  const n = el(`<clause>
      <title>T</title>
      <content>
        <p>
          A ceiling is deemed
          to have a resistance.
        </p>
      </content>
    </clause>`);
  const { bodyMd } = normalizeUnit(unit(n), opts);
  assert.equal(bodyMd, 'A ceiling is deemed to have a resistance.');
});

test('normalizing is deterministic and side-effect free', () => {
  const xml = `<clause><sptc>A1</sptc><title>T</title><content><p>See <a href="#a" type="abcb-glossentry">term</a>.</p><img src="f.svg"/></content></clause>`;
  const a = normalizeUnit(unit(el(xml)), opts);
  const b = normalizeUnit(unit(el(xml)), opts);
  assert.ok(a.bodyMd.length > 0 && a.definedTerms.length === 1 && a.figures.length === 1);
  assert.deepEqual(a, b);
  const u = unit(el(xml));
  normalizeUnit(u, opts);
  assert.deepEqual(normalizeUnit(u, opts), a, 're-normalizing the same node gives the same answer');
});

/* ============================================================ *
 * 9. The corpus. Skipped when .cache is absent.                  *
 * ============================================================ */

const pathOf = key => `.cache/extracted/${DOCUMENTS_2025.find(d => d.key === key).pkg}/contents.xml`;
const have = fs.existsSync(pathOf('volume-one'));
const FIGURE_RE = /^!\[[^\]\n]*\]\(https:\/\/cdn\.aecassistant\.com\.au\/images\/ncc\/2025\/(volume1|volume2|volume3|housing|livable_housing)\/[^\s()]+\)$/;
const WARNING_CATEGORIES = new Set([
  'mathml-flattened', 'table-irregular', 'table-multirow-header', 'orphan-num', 'list-depth',
]);

// A paragraph made only of text and inline marks that render as-is must survive as ONE line,
// character for character. This is the phrase-grep property, asserted over the whole corpus.
// Text nodes never reach the set — they are skipped before it is consulted.
const PLAIN_INLINE = new Set(['a', 'sup', 'sub', 'ins', 'signage']);
function isPlainParagraph(p) {
  const stack = [p];
  while (stack.length) {
    const n = stack.pop();
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) return false;
      if (!PLAIN_INLINE.has(c.nodeName)) return false;
      if (c.nodeName === 'a' && /^https?:/.test(c.getAttribute('href') ?? '')) return false;
      stack.push(c);
    }
  }
  return true;
}

// Which <p> elements belong to THIS unit — decided STRUCTURALLY, from the tree, never from what
// happens to be in the output. Deciding it from the output is how the first version of this
// assertion became a tautology: it skipped exactly the paragraphs that would have failed it.
// Mirrors normalize.mjs's own body selection: the unit's roots, minus any subtree owned by a
// nested unit or a skipped container.
const UNIT_IDENTITY_TAGS = new Set(['title', 'sptc', 'glossterm']);
function ownParagraphs(unit, unitNodes) {
  const out = [];
  const walk = (node, depth) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (unitNodes.has(c) || BODY_SKIP_TAGS.has(c.nodeName)) continue;   // another unit's file
      if (depth === 0 && UNIT_IDENTITY_TAGS.has(c.nodeName)) continue;    // the H1 / frontmatter
      if (c.nodeName === 'p') out.push(c);
      walk(c, depth + 1);
    }
  };
  if (unit.overview) for (const r of overviewChildren(unit.node)) walk(r, 1);
  else walk(unit.node, 0);
  return out;
}

for (const doc of DOCUMENTS_2025) {
  test(`${doc.key}: every unit normalizes, and the format invariants hold`, { skip: !have }, () => {
    const units = readDocument2025(fs.readFileSync(pathOf(doc.key), 'utf8'), doc);
    assert.ok(units.length > 0);
    const unitNodes = new Set(units.map(x => x.node));
    let chars = 0, withBody = 0, paragraphs = 0;
    const seenCategories = new Set();
    for (const u of units) {
      const who = `${doc.key} ${u.id ?? u.term ?? u.title}`;
      const { bodyMd, definedTerms, figures, warnings } = normalizeUnit(u, { year: '2025', cdnKey: doc.cdnKey });
      chars += bodyMd.length;
      if (bodyMd.length) withBody++;

      assert.ok(!/MathType@MTEF/.test(bodyMd), `${who}: MTEF annotation leaked into the corpus`);
      assert.ok(!/\n[ \t]+\n/.test(bodyMd), `${who}: whitespace-only line`);
      assert.ok(!/\n\n\n/.test(bodyMd), `${who}: more than one blank line between blocks`);
      for (const line of bodyMd.split('\n')) {
        assert.ok(!/\s$/.test(line), `${who}: trailing whitespace on ${JSON.stringify(line.slice(-40))}`);
        if (line.startsWith('![')) assert.match(line, FIGURE_RE, `${who}: malformed figure link`);
      }
      for (const w of warnings) {
        const category = w.split(':')[0];
        assert.ok(WARNING_CATEGORIES.has(category), `${who}: unknown warning category ${w}`);
        seenCategories.add(category);
      }
      for (const t of definedTerms) assert.ok(t && t === t.trim(), `${who}: bad defined term ${JSON.stringify(t)}`);
      for (const f of figures) assert.ok(f && !/[\\/]/.test(f), `${who}: bad figure name ${JSON.stringify(f)}`);

      // THE phrase-grep property, over every paragraph the unit owns. A paragraph's text must be
      // the suffix of some single line — prefixes ("**(1)** ", "> ", "(a) ", indentation) are
      // legitimate, a line break anywhere inside the sentence is the defect this repo exists to
      // fix. Asserted unconditionally: no paragraph is exempt.
      const lines = bodyMd.split('\n');
      for (const p of ownParagraphs(u, unitNodes)) {
        if (!isPlainParagraph(p)) continue;
        const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;                                   // 4 empty <p/> in the corpus
        paragraphs++;
        assert.ok(lines.some(l => l.endsWith(text)),
          `${who}: paragraph does not survive as one line: ${JSON.stringify(text.slice(0, 80))}`);
      }
    }
    // Guard against a normalizer that passes every invariant by emitting nothing — including the
    // paragraph assertion above, which is vacuous if no paragraph is ever collected.
    assert.ok(withBody / units.length > 0.95, `${doc.key}: only ${withBody}/${units.length} units have a body`);
    assert.ok(chars / units.length > 200, `${doc.key}: mean body ${Math.round(chars / units.length)} chars — too thin`);
    assert.ok(paragraphs > units.length, `${doc.key}: only ${paragraphs} paragraphs checked across ${units.length} units`);
    // Pins the report's "0 in both". Either firing means a real shape the census never saw.
    assert.ok(!seenCategories.has('orphan-num'), `${doc.key}: a <num> had no paragraph to label`);
    assert.ok(!seenCategories.has('list-depth'), `${doc.key}: an <ol> nested past the style ladder`);
  });
}

// The strongest no-silent-drop check available: walk each unit's own subtree independently of
// normalize.mjs's allowlist and require every text node to appear in the rendered body. An
// element that fell through a rule without throwing would take its text with it, and show here.
test('every text node in every unit reaches its rendered body — nothing is dropped', { skip: !have }, () => {
  const IDENTITY = new Set(['title', 'sptc', 'glossterm']);
  const DROPPED = new Set(['annotation']);   // MathType MTEF: an alternate encoding, dropped by rule
  const collapse = s => (s ?? '').replace(/\s+/g, ' ').trim();
  let units = 0, checked = 0;

  const texts = (node, out, unitNodes, depth) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { const t = collapse(c.data); if (t) out.push(t); continue; }
      if (c.nodeType !== 1 || DROPPED.has(c.nodeName)) continue;
      if (depth === 0 && (IDENTITY.has(c.nodeName) || BODY_SKIP_TAGS.has(c.nodeName))) continue;
      if (depth > 0 && unitNodes.has(c)) continue;   // a nested unit's subtree is its own file
      texts(c, out, unitNodes, depth + 1);
    }
  };

  for (const doc of DOCUMENTS_2025) {
    const all = readDocument2025(fs.readFileSync(pathOf(doc.key), 'utf8'), doc);
    const unitNodes = new Set(all.map(u => u.node));
    for (const u of all) {
      units++;
      const { bodyMd } = normalizeUnit(u, { year: '2025', cdnKey: doc.cdnKey });
      const out = [];
      if (u.overview) for (const r of overviewChildren(u.node)) texts(r, out, unitNodes, 1);
      else texts(u.node, out, unitNodes, 0);
      for (const t of out) {
        checked++;
        assert.ok(bodyMd.includes(t),
          `${doc.key} ${u.id ?? u.term ?? u.title}: text vanished from the body: ${JSON.stringify(t.slice(0, 90))}`);
      }
    }
  }
  assert.equal(units, 4770, 'all five documents walked');
  assert.ok(checked > 120000, `expected the whole corpus, checked ${checked} text nodes`);
});

test('volume-one: the A5G7 phrase matches on a single line (the acceptance criterion)', { skip: !have }, () => {
  const vol1 = DOCUMENTS_2025.find(d => d.key === 'volume-one');
  const units = readDocument2025(fs.readFileSync(pathOf('volume-one'), 'utf8'), vol1);
  const a5g7 = units.find(u => u.id === 'A5G7' && !u.state);
  assert.ok(a5g7, 'A5G7 is in the corpus');
  const { bodyMd, definedTerms } = normalizeUnit(a5g7, { year: '2025', cdnKey: vol1.cdnKey });
  const phrase = 'deemed to have a resistance to the incipient spread of fire to the space above itself';
  const hits = bodyMd.split('\n').filter(l => l.includes(phrase));
  assert.equal(hits.length, 1, `the phrase must match on exactly one line; body was:\n${bodyMd}`);
  // No "(1)" label: A5G7's single subclause carries num="1" as an ATTRIBUTE but has no <num>
  // element, and the published NCC prints no label for it. Measured: of 1363 single-subclause
  // clauses only 5 carry a <num> element, while all 902 multi-subclause clauses number every
  // one. The <num> element is the publisher's print-this-label signal; the attribute is not.
  assert.equal(hits[0], `A ceiling is ${phrase} if—`);
  assert.ok(!bodyMd.includes('**(1)**'), 'a label the NCC does not print must not be invented');
  assert.deepEqual(definedTerms,
    ['resistance to the incipient spread of fire', 'Standard Fire Test', 'Accredited Testing Laboratory']);
  assert.match(bodyMd, /^\(a\) it is identical with a prototype/m);
  assert.match(bodyMd, /^ {2}\(i\) describes the method and conditions of the test/m);
});

test('volume-one: a national clause never carries its own state variation text (R1)', { skip: !have }, () => {
  const vol1 = DOCUMENTS_2025.find(d => d.key === 'volume-one');
  const units = readDocument2025(fs.readFileSync(pathOf('volume-one'), 'utf8'), vol1);
  const byNode = new Map(units.map(u => [u.node, u]));
  const collapse = n => (n.textContent ?? '').replace(/\s+/g, ' ').trim();

  // The check is source-driven, not output-driven: a REPLACE variation legitimately restates the
  // whole national clause (A5G4 VIC does), so shared text proves nothing. Only a sentence that
  // exists in the nested unit and NOT in the parent's own retained children is evidence of a leak.
  let nested = 0, probed = 0;
  for (const u of units) {
    for (let c = u.node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || !byNode.has(c)) continue;
      nested++;
      let ownSource = '';
      for (let k = u.node.firstChild; k; k = k.nextSibling) {
        if (k.nodeType === 1 && !BODY_SKIP_TAGS.has(k.nodeName)) ownSource += ` ${collapse(k)}`;
      }
      const unique = collapse(c).split(/(?<=[.;:—])\s+/).filter(s => s.length > 45 && !ownSource.includes(s));
      if (!unique.length) continue;
      probed++;
      const parent = normalizeUnit(u, { year: '2025', cdnKey: vol1.cdnKey }).bodyMd;
      for (const sentence of unique) {
        assert.ok(!parent.includes(sentence),
          `${u.id ?? u.term}: text belonging to the nested <${c.nodeName}> leaked into the parent body: `
          + JSON.stringify(sentence.slice(0, 60)));
      }
    }
  }
  assert.ok(nested > 100, `expected many nested units, saw ${nested}`);
  assert.ok(probed > 50, `expected many nested units with text of their own, saw ${probed}`);
});

/* ============================================================ *
 * 9. The 2022 vocabulary. Same renderer, different spellings —  *
 *    see docs/content-model-2022.md §9.1 and §10.               *
 * ============================================================ */

const unit22 = (node, extra = {}) =>
  ({ node, kind: 'clause', id: 'T22', title: 'T', bodyTags: BODY_TAGS_2022, ...extra });
const md22 = (xml, extra) => normalizeUnit(unit22(el(xml), extra), { year: '2022', cdnKey: 'volume1' }).bodyMd;

test('CALS tables render: tgroup is transparent, colspec is metadata, row/entry are tr/td', () => {
  const body = md22('<clause><title>T</title><table-reference><num>J4D6b</num><title>Solar admittance</title>'
    + '<table><tgroup cols="2"><colspec colname="c1" colnum="1"/><colspec colname="c2" colnum="2"/>'
    + '<thead><row><entry>Climate zone</entry><entry>Eastern</entry></row></thead>'
    + '<tbody><row><entry>1</entry><entry>0.12</entry></row><row><entry>2</entry><entry>0.13</entry></row></tbody>'
    + '</tgroup></table><desc-note><p>Note 1.</p></desc-note></table-reference></clause>');
  assert.match(body, /^### Table J4D6b — Solar admittance$/m, 'num is a CHILD element in 2022, not an attribute');
  assert.match(body, /^\| Climate zone \| Eastern \|$/m);
  assert.match(body, /^\| --- \| --- \|$/m);
  assert.match(body, /^\| 2 \| 0\.13 \|$/m);
  assert.match(body, /^> Note 1\.$/m);
});

test('CALS spans are the SAME grid rule under different attribute names — morerows and namest/nameend', () => {
  // The real Table C3D3, transcribed from
  // `.cache/extracted/ncc-2022-volume-one/XMLs/table-C3D3-maximum-size-of-fire-compartments-or-atria.xml`.
  // `morerows="1"` is CALS for rowspan=2, and it is the ONLY thing keeping "Max volume—48 000 m3"
  // under "Type A construction". Ignore it and every cell of the second row shifts one column
  // left — the corpus then publishes 33 000 m3 as Type A's limit, which is Type B's. A wrongly
  // placed numeric limit is the worst thing a compliance corpus can emit, and it is silent.
  const body = md22('<clause><title>T</title><table-reference><num>C3D3</num><title>Maximum size</title>'
    + '<table><tgroup cols="4">'
    + '<colspec colname="001" colnum="1"/><colspec colname="002" colnum="2"/>'
    + '<colspec colname="003" colnum="3"/><colspec colname="004" colnum="4"/>'
    + '<thead><row><entry>Classification</entry><entry>Type A construction</entry>'
    + '<entry>Type B construction</entry><entry>Type C construction</entry></row></thead>'
    + '<tbody><row><entry morerows="1">5, 9b or 9c</entry><entry>Max floor area—8 000 m2</entry>'
    + '<entry>Max floor area—5 500 m2</entry><entry>Max floor area—3 000 m2</entry></row>'
    + '<row><entry>Max volume—48 000 m3</entry><entry>Max volume—33 000 m3</entry>'
    + '<entry>max volume—18 000 m3</entry></row></tbody>'
    + '</tgroup></table></table-reference></clause>');
  const rows = body.split('\n').filter(l => l.startsWith('|'));
  assert.deepEqual(rows, [
    '| Classification | Type A construction | Type B construction | Type C construction |',
    '| --- | --- | --- | --- |',
    '| 5, 9b or 9c | Max floor area—8 000 m2 | Max floor area—5 500 m2 | Max floor area—3 000 m2 |',
    '| 5, 9b or 9c | Max volume—48 000 m3 | Max volume—33 000 m3 | max volume—18 000 m3 |',
  ]);

  // Horizontal spans are named, not counted: `namest`/`nameend` reference two `colspec/@colname`s,
  // so the width comes from the colspec ORDER of this tgroup and cannot be read off the entry.
  const spanned = md22('<clause><title>T</title><table-reference><num>X</num><title>T</title>'
    + '<table><tgroup cols="3">'
    + '<colspec colname="c1" colnum="1"/><colspec colname="c2" colnum="2"/><colspec colname="c3" colnum="3"/>'
    + '<thead><row><entry>Element</entry><entry namest="c2" nameend="c3">FRL</entry></row></thead>'
    + '<tbody><row><entry>Wall</entry><entry>60</entry><entry>90</entry></row></tbody>'
    + '</tgroup></table></table-reference></clause>');
  const srows = spanned.split('\n').filter(l => l.startsWith('|'));
  assert.deepEqual(srows, ['| Element | FRL | FRL |', '| --- | --- | --- |', '| Wall | 60 | 90 |']);

  // …and a colname is a KEY, not a number. Table S1C2a's colspecs really are ordered
  // 001, 002, 006, 005, 004, 003, and its header really does span `namest="002" nameend="003"`.
  // By position that is five columns — which is what the published table shows; by numeric name it
  // is two, which would put three FRL columns under no heading at all.
  const s1c2a = md22('<clause><title>T</title><table-reference><num>S1C2a</num><title>Masonry</title>'
    + '<table><tgroup cols="6">'
    + '<colspec colname="001" colnum="1"/><colspec colname="002" colnum="2"/><colspec colname="006" colnum="3"/>'
    + '<colspec colname="005" colnum="4"/><colspec colname="004" colnum="5"/><colspec colname="003" colnum="6"/>'
    + '<thead><row><entry morerows="1">Masonry type</entry>'
    + '<entry nameend="003" namest="002">Minimum thickness (mm) of principal material for FRLs</entry></row>'
    + '<row><entry>60/60/60</entry><entry>90/90/90</entry><entry>120/120/120</entry>'
    + '<entry>180/180/180</entry><entry>240/240/240</entry></row></thead>'
    + '<tbody><row><entry>Calcium silicate</entry>'
    + '<entry morerows="2" nameend="003" namest="002">See clause S1C2(d)(iv)</entry></row>'
    + '<row><entry>Concrete</entry></row><row><entry>Fired clay</entry></row></tbody>'
    + '</tgroup></table></table-reference></clause>');
  const arows = s1c2a.split('\n').filter(l => l.startsWith('|'));
  const see = 'See clause S1C2(d)(iv)';
  assert.deepEqual(arows, [
    `| Masonry type | ${Array(5).fill('Minimum thickness (mm) of principal material for FRLs').join(' | ')} |`,
    '| --- | --- | --- | --- | --- | --- |',
    '| Masonry type | 60/60/60 | 90/90/90 | 120/120/120 | 180/180/180 | 240/240/240 |',
    `| Calcium silicate | ${Array(5).fill(see).join(' | ')} |`,
    `| Concrete | ${Array(5).fill(see).join(' | ')} |`,
    `| Fired clay | ${Array(5).fill(see).join(' | ')} |`,
  ]);
});

test('a CALS span naming a column that does not exist THROWS — it cannot be placed by guessing', () => {
  // The alternative to throwing is placing the cell somewhere plausible, which is how a numeric
  // limit ends up under the wrong heading with nothing in the output to show for it.
  assert.throws(() => md22('<clause><title>T</title><table-reference><num>X</num><title>T</title>'
    + '<table><tgroup cols="2"><colspec colname="c1" colnum="1"/><colspec colname="c2" colnum="2"/>'
    + '<tbody><row><entry namest="c1" nameend="c9">A</entry></row></tbody>'
    + '</tgroup></table></table-reference></clause>'), /c9/);
  assert.throws(() => md22('<clause><title>T</title><table-reference><num>X</num><title>T</title>'
    + '<table><tgroup cols="2"><colspec colname="c1" colnum="1"/><colspec colname="c2" colnum="2"/>'
    + '<tbody><row><entry morerows="oops">A</entry></row></tbody>'
    + '</tgroup></table></table-reference></clause>'), /morerows/);
});

test('a figure reads href-resolved src, and @longdescref is the legend, not a reference', () => {
  const { bodyMd, figures } = normalizeUnit(unit22(el(
    '<clause><title>T</title><image-reference><num>11.2.1</num><title>Stairway terms</title>'
    + '<image alt="Stairway terms" src="image-11-2-1-stairway-terms.svg" href="/tmp/QppServer/x.svg"'
    + ' longdescref="(a) quarter landings - 2 flights. (b) continuous stairway - 1 flight."/>'
    + '</image-reference></clause>')), { year: '2022', cdnKey: 'housing' });
  assert.deepEqual(figures, ['image-11-2-1-stairway-terms.svg']);
  assert.match(bodyMd, /!\[Figure 11\.2\.1: Stairway terms\]\(.*\/2022\/housing\/image-11-2-1-stairway-terms\.svg\)/);
  assert.match(bodyMd, /^\(a\) quarter landings - 2 flights\. \(b\) continuous stairway - 1 flight\.$/m);
});

test('a callout says WHICH kind of box it is — 2025 records no equivalent', () => {
  assert.match(md22('<clause><title>T</title><callout><callout-type ncc-info-type="exemption"/>'
    + '<p>This does not apply to a Class 10 building.</p></callout></clause>'), /^> \*\*Exemption\*\*$/m);
  assert.match(md22('<clause><title>T</title><callout><callout-type ncc-info-type="notes"/>'
    + '<title>Roof space ventilation</title><p>Guidance.</p></callout></clause>'),
  /^> \*\*Notes — Roof space ventilation\*\*$/m);
});

test('boilerplate titles that restate an attribute never reach the corpus', () => {
  // <title>SubClause</title> 11,520 times, "<STATE> REPLACE Definition" 30 times. Both restate
  // attributes the frontmatter already carries; both would otherwise be published as prose.
  const sub = md22('<clause><title>T</title><subclause outputclass="subclause"><title>SubClause</title>'
    + '<num>1</num><p>The provision.</p></subclause></clause>');
  assert.equal(sub, '**(1)** The provision.');
  const gloss = normalizeUnit({
    node: el('<abcb-glossentry variation="NSW"><glossterm>Accessway</glossterm>'
      + '<glossdef outputclass="glossdef"><title>NSW REPLACE Definition</title><p>The NSW sense.</p></glossdef></abcb-glossentry>'),
    kind: 'glossary', id: null, term: 'Accessway', title: 'Accessway', state: 'NSW', bodyTags: BODY_TAGS_2022,
  }, { year: '2022', cdnKey: 'volume1' }).bodyMd;
  assert.equal(gloss, 'The NSW sense.');
});

test('a whole provision carried in @deleted-text is rendered — three carriers (§5.0)', () => {
  // A childless DELETE pointer IS the unit; a subclause carries the same attribute below unit
  // level; and the 33 pointers with no attribute fall back to their own element text.
  assert.equal(normalizeUnit(unit22(el('<clause-variation deleted-text="F4D10 does not apply in NSW."'
    + ' variation="NSW" variation-type="DELETE">NSW DELETE Clause</clause-variation>')),
  { year: '2022', cdnKey: 'volume1' }).bodyMd, 'F4D10 does not apply in NSW.');
  assert.equal(normalizeUnit(unit22(el('<clause-variation variation="NT" variation-type="DELETE">NT DELETE Clause</clause-variation>')),
    { year: '2022', cdnKey: 'volume1' }).bodyMd, 'NT DELETE Clause');
  assert.match(md22('<clause><title>T</title><subclause outputclass="subclause"><title>SubClause</title>'
    + '<num>1</num><p>National.</p><subclause deleted-text="This subclause does not apply in VIC."'
    + ' variation="VIC" variation-type="DELETE"><title>VIC DELETE SubClause</title></subclause></subclause></clause>'),
  /\*\*VIC variation \(DELETE\)\*\*\n\nThis subclause does not apply in VIC\./);
});

test('a Section abstract lives in topicset/@summary and exists nowhere else (§11)', () => {
  assert.equal(normalizeUnit({
    node: el('<topicset navtitle="Ancillary provisions" section-num="Section G" summary="Section G contains requirements for specific components."/>'),
    kind: 'page', overview: true, id: null, title: 'Ancillary provisions', bodyTags: BODY_TAGS_2022,
  }, { year: '2022', cdnKey: 'volume1' }).bodyMd, 'Section G contains requirements for specific components.');
});

test('an equation keeps its MathML and drops the base64 raster both editions carry', () => {
  const body = md22('<clause><title>T</title><subclause outputclass="subclause"><title>SubClause</title>'
    + '<equation-block><mathML><math><semantics><mtable><mtr><mtd><msub><mi>C</mi><mi>R</mi></msub>'
    + '<mo>=</mo><mn>1</mn></mtd></mtr><mtr><mtd><msub><mi>C</mi><mi>S</mi></msub><mo>=</mo><mn>2</mn></mtd></mtr>'
    + '</mtable><annotation encoding="MathType-MTEF">MathType@MTEF@5@5@base64…</annotation></semantics></math></mathML>'
    + '<image content-type="gif">R0lGODlhSgAyAPAAAP…</image></equation-block></subclause></clause>');
  assert.equal(body, 'C_R=1; C_S=2');
  assert.ok(!/MathType@MTEF/.test(body), 'the MTEF annotation never reaches the corpus');
  assert.ok(!/R0lGODlh/.test(body), "the raster fallback is not a figure and has no href to resolve");
});

test('a unit with no bodyTags is refused rather than rendered against the wrong edition', () => {
  assert.throws(() => normalizeUnit({ node: el('<clause><title>T</title><p>x</p></clause>'), kind: 'clause', id: 'T' }, opts),
    /carries no bodyTags/);
});

test('an authoring placeholder is not a figure designation', () => {
  // The cover pages carry <num><placeholder>[NUMBER]</placeholder></num>, and read-2022.mjs's
  // `supersedesOf` already guards `archive-num` against the same element. Without the same guard
  // here, 8 units ship `![Figure [NUMBER]: Front Cover - Volume Two](…)`.
  const body = md22('<page outputclass="page"><title>Front Cover</title>'
    + '<image-reference><num><placeholder outputclass="placeholder">[NUMBER]</placeholder></num>'
    + '<title>Front Cover - Volume Two</title><image alt="c" src="cover-front-vol2.pdf" href="../Images/cover-front-vol2.pdf"/>'
    + '</image-reference></page>', { kind: 'page', id: null, title: 'Front Cover' });
  assert.match(body, /^!\[Figure: Front Cover - Volume Two\]/m);
  assert.ok(!/\[NUMBER\]/.test(body), 'the placeholder never ships as content');
});
