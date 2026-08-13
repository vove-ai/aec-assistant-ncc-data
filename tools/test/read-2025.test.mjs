import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readDocument2025,
  overviewChildren,
  DOCUMENTS_2025,
  BODY_SKIP_TAGS,
} from '../src/read-2025.mjs';

const VOL1 = DOCUMENTS_2025[0];
const VOL2 = DOCUMENTS_2025[1];
const VOL3 = DOCUMENTS_2025[2];
const HP = DOCUMENTS_2025[3];
const LHD = DOCUMENTS_2025[4];

const wrap = inner => `<?xml version="1.0"?><ncc-volume publishing-id="vol1">${inner}</ncc-volume>`;
const wrapStandard = inner =>
  `<?xml version="1.0"?><ncc-standard publishing-id="livable">${inner}</ncc-standard>`;

/* ------------------------------------------------------------------ *
 * (a) Fixture tests — every measured trap, as a hand-written document. *
 * ------------------------------------------------------------------ */

test('finds clauses under subtopic (the vol1-3 dominant container)', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <part id="p" num="A1"><title>Interp</title><subtopic id="st" subtopic-type="governance">
    <clause id="c1"><sptc>A1G1</sptc><title>Scope</title><p>Body.</p></clause></subtopic></part>
    </ncc-section>`), VOL1);
  const c = units.find(u => u.id === 'A1G1');
  assert.ok(c, 'clause under subtopic must be found');
  assert.equal(c.sectionNum, 'A');
  assert.equal(c.containerNum, 'A1');
  assert.equal(c.containerKind, 'part');
  assert.equal(c.kind, 'clause');
});

test('finds clauses under specification (sibling of part, not child)', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <specification id="sp" num="1"><title>Fire-resistance</title>
    <clause id="c"><sptc>S1C1</sptc><title>Scope</title><p>B.</p></clause></specification></ncc-section>`), VOL1);
  assert.ok(units.find(u => u.id === 'S1C1'), 'specification clauses must be walked');
  assert.equal(units.find(u => u.id === 'S1C1').containerKind, 'specification');
  assert.equal(units.find(u => u.id === 'S1C1').containerNum, '1');
});

test('clause-variation carries its own state; sptc from attribute', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A2"><title>P</title>
    <clause id="c"><sptc>A2G2</sptc><title>T</title><p>National.</p>
      <clause-variation id="v" type="REPLACE" state="NSW" sptc="A2G2" num=""><title>T</title><p>NSW text.</p></clause-variation>
    </clause></part></ncc-section>`), VOL1);
  const v = units.find(u => u.state === 'NSW');
  assert.ok(v, 'clause-variation nested in clause must be emitted (XSD correction)');
  assert.equal(v.id, 'A2G2');
  const nat = units.find(u => u.id === 'A2G2' && u.state === null);
  assert.ok(nat, 'national clause still emitted');
});

test('state inherits downward but own attribute wins', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part-variation id="pv" state="VIC" num="A5"><title>PV</title>
    <clause id="c1"><sptc>A5G4</sptc><title>T1</title><p>x</p></clause>
    <clause-variation id="c2" state="NT" sptc="A5G5" type="REPLACE" num=""><title>T2</title><p>y</p></clause-variation>
    </part-variation></ncc-section>`), VOL1);
  assert.equal(units.find(u => u.id === 'A5G4').state, 'VIC', 'inherited');
  assert.equal(units.find(u => u.id === 'A5G5').state, 'NT', 'own attribute wins');
});

test('ncc-section state reaches units below it (jurisdiction schedules)', () => {
  // Measured: <ncc-section num="5" type="schedule" state="NSW"> holds <page> children.
  // Reading state only from part-level containers drops it and collides eight ways.
  const units = readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="5" state="NSW"><title>New South Wales</title>
    <page id="pg"><title>NSW introduction</title><content id="c"><p>Applies in NSW.</p></content></page>
    </ncc-section>`), VOL1);
  const pg = units.find(u => u.kind === 'page');
  assert.equal(pg.state, 'NSW', 'page must inherit the schedule section state');
  assert.equal(pg.sectionNum, '5');
  assert.equal(pg.sectionType, 'schedule');
});

test('glossary entries take their term from <glossterm>, not <title>', () => {
  // Measured: 493 glossentry>glossterm, 0 glossentry>title. Reading <title> fails on every entry.
  const units = readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="1"><title>Definitions</title>
    <ncc-glossary id="g" type="Glossary"><title>Glossary</title>
    <glossentry category="term" id="e1"><glossterm id="gt">Accessway</glossterm>
    <glossdef><content id="c"><p>A continuous accessible path of travel.</p></content></glossdef>
    <glossentry-variation id="e1v" type="REPLACE" state="QLD" category="term">
      <glossterm id="gt2">Accessway</glossterm>
      <glossdef><content id="c2"><p>QLD text.</p></content></glossdef>
    </glossentry-variation>
    </glossentry></ncc-glossary></ncc-section>`), VOL1);
  const g = units.filter(u => u.kind === 'glossary');
  assert.equal(g.length, 2, 'entry + nested variation');
  assert.equal(g[0].term, 'Accessway');
  assert.equal(g[0].state, null);
  assert.equal(g[0].sectionType, 'schedule');
  assert.equal(g[1].term, 'Accessway');
  assert.equal(g[1].state, 'QLD', 'nested glossentry-variation carries its own state');
});

test('glossentry without a glossterm fails loud', () => {
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="1"><title>D</title>
    <ncc-glossary id="g" type="Glossary"><title>G</title>
    <glossentry category="term" id="e1"><glossdef><content id="c"><p>x</p></content></glossdef></glossentry>
    </ncc-glossary></ncc-section>`), VOL1), /glossterm/);
});

test('unknown element outside the allowlist throws (fail-loud)', () => {
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <mystery-tag><clause id="c"><sptc>A9G9</sptc><title>T</title></clause></mystery-tag></ncc-section>`), VOL1),
  /mystery-tag/);
});

test('fail-loud report names the element AND its context path', () => {
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><mystery-tag/></part></ncc-section>`), VOL1),
  /ncc-volume\/ncc-section\[A\]\/part\[A1\]\/mystery-tag/);
});

test('prose reached by structural recursion throws — it is never walked into', () => {
  // The failure mode this guards: widening DESCEND_TAGS with a prose tag to silence a throw.
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><p>bare prose under a container</p></part></ncc-section>`), VOL1),
  /<p>/);
});

/* ---- container-overview units (R3 / trap 1) ---- */

test('a part with an intro-part emits a container-overview unit', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <part id="p" num="A1"><title>Interpreting the NCC</title>
      <intro-part id="ip"><content id="c"><p>This Part explains…</p></content></intro-part>
      <subtopic id="st" subtopic-type="governance">
        <clause id="c1"><sptc>A1G1</sptc><title>Scope</title><p>Body.</p></clause>
      </subtopic></part></ncc-section>`), VOL1);
  const ov = units.filter(u => u.kind === 'page');
  assert.equal(ov.length, 1, 'exactly one overview unit for the part');
  assert.equal(ov[0].containerKind, 'part');
  assert.equal(ov[0].containerNum, 'A1');
  assert.equal(ov[0].title, 'Interpreting the NCC');
  assert.equal(ov[0].id, null);
  assert.equal(ov[0].node.nodeName, 'part');
  assert.deepEqual(overviewChildren(ov[0].node).map(n => n.nodeName), ['intro-part']);
});

test('overview covers container-level and subtopic-level callouts, never clauses', () => {
  // Measured vol-one: part>callout 13, subtopic>callout 6. Pointing the unit at <intro-part>
  // alone drops 54 explanatory boxes across the five documents.
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>Gov</title>
    <part id="p" num="A6"><title>Building classification</title>
      <intro-part id="ip"><content id="c"><p>Intro.</p></content></intro-part>
      <callout id="co1" callout-type="explanatory"><content id="c1"><p>Part-level box.</p></content></callout>
      <subtopic id="st" subtopic-type="governance">
        <clause id="cl"><sptc>A6G1</sptc><title>Scope</title><p>Body.</p></clause>
        <callout id="co2" callout-type="explanatory"><content id="c2"><p>Difficult classifications.</p></content></callout>
      </subtopic></part></ncc-section>`), VOL1);
  const ov = units.find(u => u.kind === 'page');
  assert.ok(ov, 'part still emits one overview unit');
  assert.deepEqual(overviewChildren(ov.node).map(n => n.getAttribute('id')), ['ip', 'co1', 'co2'],
    'intro-part + part callout + subtopic callout, in document order');
  assert.equal(units.filter(u => u.kind === 'page').length, 1, 'callouts do not become units of their own');
  assert.ok(units.find(u => u.id === 'A6G1'), 'the clause is still emitted separately');
});

test('part-variation content becomes a state-carrying overview unit (Volume Two H6 trap)', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="H"><title>H</title>
    <part id="p" num="H6"><title>Energy efficiency</title>
      <intro-part id="ip"><content id="ci"><p>National intro.</p></content></intro-part>
      <part-variation id="pv" type="DELETE" state="NSW" num="H6">
        <content id="c"><p>This Part has deliberately been left blank.</p></content>
      </part-variation>
    </part></ncc-section>`), VOL2);
  const ov = units.filter(u => u.kind === 'page');
  assert.equal(ov.length, 2, 'national part overview + NSW part-variation overview');
  const nsw = ov.find(u => u.state === 'NSW');
  assert.ok(nsw, 'the NSW overview must exist and carry its state, or it overwrites the national file');
  assert.equal(nsw.containerKind, 'part-variation');
  assert.equal(nsw.containerNum, 'H6');
  assert.equal(nsw.title, 'Energy efficiency', 'title inherited from the part it varies');
  assert.equal(ov.find(u => u.state === null).containerKind, 'part');
});

test('a specification notice becomes the specification overview unit', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <specification id="sp" num="44"><title>Spec 44</title>
      <notice>This specification has been deliberately left blank.</notice>
    </specification></ncc-section>`), VOL1);
  const ov = units.filter(u => u.kind === 'page');
  assert.equal(ov.length, 1);
  assert.equal(ov[0].containerKind, 'specification');
  assert.equal(ov[0].containerNum, '44');
  assert.deepEqual(overviewChildren(ov[0].node).map(n => n.nodeName), ['notice']);
});

test('a container with no prose of its own emits no overview unit', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><subtopic id="st" subtopic-type="x">
    <clause id="c"><sptc>A1G1</sptc><title>T</title><p>b</p></clause></subtopic></part></ncc-section>`), VOL1);
  assert.equal(units.filter(u => u.kind === 'page').length, 0);
});

test('prose owned by no container fails loud rather than vanishing', () => {
  // Nothing above ncc-section can own prose, so prose parked at the document root would be
  // dropped in silence. It throws instead.
  assert.throws(() => readDocument2025(wrap(`<content id="c"><p>orphan prose</p></content>
    <ncc-section id="s" type="section" num="A"><title>G</title></ncc-section>`), VOL1),
  /no container owns it/);
});

test('prose under a transparent element is claimed by the container above it', () => {
  // ncc-glossary is transparent, so an ncc-section is the nearest thing that can own this.
  const units = readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="1"><title>Definitions</title>
    <ncc-glossary id="g" type="Glossary"><title>G</title>
    <intro-part id="ip"><content id="c"><p>How to read these definitions.</p></content></intro-part>
    </ncc-glossary></ncc-section>`), VOL1);
  const ov = units.filter(u => u.kind === 'page');
  assert.equal(ov.length, 1);
  assert.equal(ov[0].containerKind, 'ncc-section');
  assert.equal(ov[0].containerNum, '1');
  assert.deepEqual(overviewChildren(ov[0].node).map(n => n.getAttribute('id')), ['ip']);
});

/* ---- below-unit variations, pointers, the standard schema ---- */

test('subclause-variation stays inline in its clause — not a unit', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><subtopic id="st" subtopic-type="x">
    <clause id="c"><sptc>A1G4</sptc><title>Interpretation</title>
      <subclause id="sc" sptc="A1G4" num="1"><content id="c1"><num>(1)</num><p>National.</p></content></subclause>
      <subclause-variation id="scv" type="INSERT" state="TAS" sptc="A1G4" num="7">
        <title>Interpretation</title><content id="c2"><num>(7)</num><p>Tasmanian insertion.</p></content>
      </subclause-variation>
    </clause></subtopic></part></ncc-section>`), VOL1);
  assert.equal(units.length, 1, 'one clause unit only');
  assert.equal(units[0].id, 'A1G4');
  assert.equal(units[0].state, null);
  assert.equal(units[0].node.getElementsByTagName('subclause-variation').length, 1,
    'the TAS insertion stays in the clause subtree for the renderer');
});

test('variation pointers emit nothing and do not throw', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="5" state="NSW"><title>NSW</title>
    <schedule-part id="sp" reference="_r" num="3"><title>Section 3</title>
      <variation tag="clause" reference="_x" num="" sptc="A2G2" type="REPLACE"/>
      <intro-part-reference reference="_y"/><callout-reference reference="_z"/>
    </schedule-part></ncc-section>`), VOL1);
  assert.equal(units.length, 0, 'a jurisdiction schedule is an index into content emitted elsewhere');
});

test('a variation element with element children fails loud (unmodelled shape)', () => {
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="schedule" num="5" state="NSW"><title>NSW</title>
    <schedule-part id="sp" reference="_r" num="3"><title>S3</title>
      <variation tag="clause" reference="_x" num="" sptc="A2G2" type="REPLACE">
        <clause id="c"><sptc>A2G2</sptc><title>T</title></clause>
      </variation></schedule-part></ncc-section>`), VOL1), /variation/);
});

test('an unparseable document throws instead of returning zero units', () => {
  // Either the parser rejects it or the walker's own guard does; silently returning [] would
  // let a truncated download look like a document with nothing in it.
  assert.throws(() => readDocument2025('', VOL1), /root element|did not parse/i);
  assert.throws(() => readDocument2025('<ncc-volume><oops/></ncc-volume>', VOL1), /unknown element <oops>/);
});

test('bare text under a structural element fails loud', () => {
  // Structural elements are not mixed content anywhere in the corpus; text here is prose the
  // walker would otherwise step straight over.
  assert.throws(() => readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title>loose sentence</part></ncc-section>`), VOL1),
  /text directly under <part>/);
});

test('a clause with no sptc gets id null, never an empty string', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><subtopic id="st" subtopic-type="x">
    <clause id="c"><sptc></sptc><title>T</title></clause></subtopic></part></ncc-section>`), VOL1);
  assert.equal(units[0].id, null);
});

test('standard-clause under ncc-standard is a clause unit', () => {
  const units = readDocument2025(wrapStandard(`<title>LHD</title>
    <ncc-section id="s" type="other" num=""><title>Livable housing design</title>
    <part id="p" num="1"><title>Introduction</title>
      <standard-clause id="c"><sptc>1.1</sptc><title>Scope</title>
      <content id="ct"><p>Body.</p></content></standard-clause>
    </part></ncc-section>`), LHD);
  assert.equal(units.length, 1);
  assert.equal(units[0].kind, 'clause');
  assert.equal(units[0].id, '1.1');
  assert.equal(units[0].volume, 'livable-housing');
});

test('building classes and supersedes are read off the clause', () => {
  const units = readDocument2025(wrap(`<ncc-section id="s" type="section" num="A"><title>G</title>
    <part id="p" num="A1"><title>T</title><subtopic id="st" subtopic-type="x">
    <clause id="c" building="Class 1a,Class 10c"><sptc>A1G1</sptc><title>T</title>
    <archive-num>A1.1</archive-num></clause></subtopic></part></ncc-section>`), VOL1);
  assert.equal(units[0].buildingClasses, 'Class 1a,Class 10c');
  assert.equal(units[0].supersedes, 'A1.1');
  assert.equal(units[0].edition, '2025');
});

test('slice mode filters every ncc-section with a non-empty num (R4)', () => {
  const doc = wrap(`
    <ncc-section id="s0" type="other" num=""><title>Front</title>
      <page id="pg0"><title>Front page</title><content id="c0"><p>x</p></content></page></ncc-section>
    <ncc-section id="sa" type="section" num="A"><title>A</title>
      <part id="pa" num="A1"><title>T</title><subtopic id="sta" subtopic-type="x">
      <clause id="ca"><sptc>A1G1</sptc><title>T</title></clause></subtopic></part></ncc-section>
    <ncc-section id="sb" type="section" num="B"><title>B</title>
      <part id="pb" num="B1"><title>T</title><subtopic id="stb" subtopic-type="x">
      <clause id="cb"><sptc>B1D1</sptc><title>T</title></clause></subtopic></part></ncc-section>
    <ncc-section id="s5" type="schedule" num="5" state="NSW"><title>NSW</title>
      <page id="pg5"><title>NSW</title><content id="c5"><p>x</p></content></page></ncc-section>`);
  const units = readDocument2025(doc, VOL1, { sections: ['A'] });
  assert.deepEqual([...new Set(units.map(u => u.sectionNum))].sort(), ['', 'A']);
  assert.ok(units.find(u => u.id === 'A1G1'));
  assert.equal(units.find(u => u.id === 'B1D1'), undefined, 'section B filtered out');
  assert.equal(units.filter(u => u.sectionNum === '5').length, 0,
    'schedules have a non-empty num and are filtered too');
});

test('BODY_SKIP_TAGS tells the renderer which children belong to another unit', () => {
  for (const t of ['clause', 'clause-variation', 'standard-clause', 'glossentry-variation',
    'part', 'part-variation', 'specification', 'spec-topic']) {
    assert.ok(BODY_SKIP_TAGS.has(t), `${t} must be skipped when rendering an enclosing unit body`);
  }
  assert.ok(!BODY_SKIP_TAGS.has('subclause-variation'), 'below-unit variations render inline');
  assert.ok(!BODY_SKIP_TAGS.has('subtopic'), 'subtopic is transparent — descend to reach its callouts');
});

/* ------------------------------------------------------------- *
 * (b) Integration parity against the real corpus.                *
 * Constants derive from the controller census (parent -> child   *
 * element counts), not from this walker's output.                *
 * ------------------------------------------------------------- */

const path = key => `.cache/extracted/${DOCUMENTS_2025.find(d => d.key === key).pkg}/contents.xml`;
const CACHE = path('volume-one');
const have = fs.existsSync(CACHE);

const read = doc => readDocument2025(fs.readFileSync(path(doc.key), 'utf8'), doc);
const tally = units => ({
  clause: units.filter(u => u.kind === 'clause').length,
  glossary: units.filter(u => u.kind === 'glossary').length,
  page: units.filter(u => u.kind === 'page' && u.node.nodeName === 'page').length,
  overview: units.filter(u => u.kind === 'page' && u.node.nodeName !== 'page').length,
});

// clause  = <clause> + <clause-variation> + <standard-clause> elements
// glossary = <glossentry> + <glossentry-variation> elements (incl. nested)
// page     = <page> elements
// overview = containers carrying prose of their own
const PARITY = {
  'volume-one': { clause: 894 + 391, glossary: 493 + 44 + 19, page: 26, overview: 72 + 13 + 1 },
  'volume-two': { clause: 208 + 68, glossary: 493 + 44 + 19, page: 20, overview: 21 + 2 + 2 },
  'volume-three': { clause: 252 + 146, glossary: 493 + 44 + 19, page: 22, overview: 30 },
  'housing-provisions': { clause: 283 + 55, glossary: 493 + 44 + 19, page: 5, overview: 1 + 16 },
  'livable-housing': { clause: 15, glossary: 0, page: 3, overview: 0 },
};

for (const doc of DOCUMENTS_2025) {
  test(`${doc.key}: full walk parity (fail-loud over the whole document)`, { skip: !have }, () => {
    const units = read(doc);
    assert.deepEqual(tally(units), PARITY[doc.key]);
  });
}

test('volume-one: known units, states and containers are present', { skip: !have }, () => {
  const units = read(VOL1);
  assert.ok(units.find(u => u.id === 'A5G7'), 'A5G7 present');
  assert.ok(units.find(u => u.id === 'A5G4' && u.state === 'VIC'), 'A5G4 VIC variation present');
  assert.ok(units.find(u => u.kind === 'glossary' && u.term === 'Accredited Testing Laboratory'),
    'glossary term read from <glossterm>');
  // Part I4 exists five times over, once per state — the filename collision trap 1 records.
  const i4 = units.filter(u => u.kind === 'page' && u.containerNum === 'I4' && u.node.nodeName === 'part');
  assert.deepEqual(i4.map(u => u.state).sort(), ['NSW', 'SA', 'TAS', 'VIC', 'WA']);
  // Every unit reachable from a jurisdiction schedule section carries that state.
  for (const u of units.filter(u => u.sectionType === 'schedule' && u.sectionNum === '5')) {
    assert.equal(u.state, 'NSW', `${u.id ?? u.title} in schedule 5 must be NSW`);
  }
});

test('volume-two: the H6/H8 part-variation overviews survive with their state', { skip: !have }, () => {
  const units = read(VOL2);
  const h6 = units.find(u => u.containerKind === 'part-variation' && u.containerNum === 'H6');
  const h8 = units.find(u => u.containerKind === 'part-variation' && u.containerNum === 'H8');
  assert.equal(h6?.state, 'TAS');
  assert.equal(h8?.state, 'NSW');
  assert.equal(h6.title, 'Energy efficiency');
  assert.ok(overviewChildren(h6.node).length > 0, 'the overview node holds real prose');
});

test('livable-housing is not empty — 15 standard-clause units', { skip: !have }, () => {
  const units = read(LHD);
  assert.equal(units.filter(u => u.kind === 'clause').length, 15);
  assert.ok(units.every(u => u.volume === 'livable-housing' && u.edition === '2025'));
});

test('every unit carries the context a filename needs', { skip: !have }, () => {
  for (const doc of [VOL1, VOL2, VOL3, HP, LHD]) {
    for (const u of read(doc)) {
      assert.equal(u.volume, doc.key);
      assert.equal(typeof u.sectionNum, 'string');
      assert.ok(u.kind === 'glossary' || u.sectionType !== null, `${doc.key}: sectionType missing`);
      assert.ok(u.node && u.node.nodeType === 1);
      if (u.kind === 'clause') assert.ok(u.id, `${doc.key}: clause unit without an id`);
      if (u.kind === 'glossary') assert.ok(u.term, `${doc.key}: glossary unit without a term`);
    }
  }
});

test('slice mode over the real corpus keeps section A and drops the rest', { skip: !have }, () => {
  const units = readDocument2025(fs.readFileSync(CACHE, 'utf8'), VOL1, { sections: ['A', 'C'] });
  assert.ok(units.every(u => ['A', 'C', ''].includes(u.sectionNum)));
  assert.ok(units.find(u => u.id === 'A5G7'));
  assert.ok(units.length < read(VOL1).length);
});

test('walking is deterministic — same input, identical unit sequence', { skip: !have }, () => {
  const xml = fs.readFileSync(path('volume-two'), 'utf8');
  const key = us => us.map(u => `${u.kind}|${u.id}|${u.term}|${u.state}|${u.containerNum}`).join('\n');
  assert.equal(key(readDocument2025(xml, VOL2)), key(readDocument2025(xml, VOL2)));
});

test('no element is silently dropped: everything is owned or explicitly structural',
  { skip: !have }, () => {
    for (const doc of [VOL1, VOL2, VOL3, HP, LHD]) {
      const units = read(doc);
      const root = units[0].node.ownerDocument.documentElement;
      // Subtrees handed to a unit: unit nodes, and (for overviews) the container's own prose.
      const handed = new Set();
      for (const u of units) {
        if (u.node.nodeName === 'page' || u.kind !== 'page') handed.add(u.node);
        else for (const c of overviewChildren(u.node)) handed.add(c);
      }
      const structural = new Set(['ncc-volume', 'ncc-standard', 'ncc-section', 'part', 'part-variation',
        'specification', 'spec-topic', 'schedule-part', 'schedule-spec', 'schedule-part-variation',
        'schedule-referenced-document', 'subtopic', 'ncc-glossary', 'title', 'h2', 'variation',
        'intro-part-reference', 'callout-reference']);
      const orphans = new Map();
      const visit = (el, owned) => {
        for (let n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType !== 1) continue;
          const inside = owned || handed.has(n);
          if (!inside && !structural.has(n.nodeName)) {
            orphans.set(n.nodeName, (orphans.get(n.nodeName) ?? 0) + 1);
          }
          if (!inside) visit(n, false);
        }
      };
      if (!structural.has(root.nodeName)) orphans.set(root.nodeName, 1);
      visit(root, false);
      assert.deepEqual([...orphans], [], `${doc.key}: elements outside every unit`);
    }
  });
